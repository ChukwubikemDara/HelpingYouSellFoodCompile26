import { randomUUID } from "node:crypto";
import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { PutCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { DbConfig } from "../db/config";
import type { Deal, DealRecord, Merchant, ReservationRecord, Summary } from "../db/models";
import { Store } from "../db/store";
import { codeKey, limitKey } from "../db/reservation-transactions";
import { liveEditCommand, publishCommand } from "../db/deal-transactions";
import { nonEmptyString, cents, phone, utc, localDate } from "../validation/primitives";
import { createDraft, type ManualDealInput } from "./deal-draft";
import { ReservationService } from "./reservations";
import { DomainError, notFound, validation } from "./errors";
import type { MerchantAccount } from "../auth/accounts";
export class Marketplace {
  readonly reservations: ReservationService;
  constructor(public readonly store: Store, public readonly tables: DbConfig["tables"], public readonly clock = () => new Date().toISOString()) {
    this.reservations = new ReservationService(store.db, tables, clock);
  }
  async merchant(id: string): Promise<Merchant> { return await this.store.get<Merchant>(this.tables.merchants, id) ?? notFound(); }
  async deal(id: string): Promise<DealRecord> { return await this.store.get<DealRecord>(this.tables.deals, id) ?? notFound(); }
  async dto(record: DealRecord): Promise<Deal> {
    const m = await this.merchant(record.merchant_id); const { version: _, ...fields } = record;
    return { ...fields, status: record.status !== "draft" && record.status !== "cancelled" && record.pickup_end && utc(record.pickup_end) <= utc(this.clock()) ? "expired" : record.status,
      merchant: { id: m.id, name: m.name, category: m.category, address: m.address, lat: m.lat, lng: m.lng }, distance_m: null };
  }
  async deals() { return (await this.store.all<DealRecord>(this.tables.deals)).filter(d => d.id.startsWith("d_")); }
  async allReservations() { return (await this.store.all<ReservationRecord>(this.tables.reservations)).filter(r => r.id.startsWith("r_")); }
  own(account: MerchantAccount, id: string) { if (!account.merchant_id || account.merchant_id !== id) notFound(); }
  validateMerchant(body: Omit<Merchant, "id" | "plan_status">) {
    for (const field of ["name", "address", "closes_at"] as const) nonEmptyString(body[field], field);
    phone(body.phone);
    if (!["bakery", "cafe", "restaurant"].includes(body.category)) validation("Select a valid category.");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(body.closes_at)) validation("Closing time must use HH:mm.");
    if (!Number.isInteger(body.default_discount_pct) || body.default_discount_pct < 10 || body.default_discount_pct > 90) validation("Discount must be an integer from 10 to 90.");
    if (!Array.isArray(body.menu)) validation("Menu must be a list.");
    for (const item of body.menu) { if (!item || typeof item !== "object") validation("Invalid menu item."); nonEmptyString(item.name, "menu item name"); cents(item.price_cents); }
    if ((body.lat === null) !== (body.lng === null)) validation("Send both latitude and longitude.");
    if (body.lat !== null && (!Number.isFinite(body.lat) || Math.abs(body.lat) > 90 || !Number.isFinite(body.lng) || Math.abs(body.lng!) > 180)) validation("Invalid location.");
  }
  async onboard(account: MerchantAccount, body: Omit<Merchant, "id" | "plan_status">) {
    const merchant: Merchant = { id: `m_${randomUUID()}`, name: body.name, category: body.category, address: body.address,
      phone: body.phone, closes_at: body.closes_at, default_discount_pct: body.default_discount_pct, menu: body.menu,
      lat: body.lat ?? null, lng: body.lng ?? null, plan_status: "none" };
    this.validateMerchant(merchant);
    try {
      await this.store.db.send(new TransactWriteCommand({ TransactItems: [
        { Put: { TableName: this.tables.merchants, Item: merchant, ConditionExpression: "attribute_not_exists(id)" } },
        { Update: { TableName: this.tables.merchants, Key: { id: account.id }, UpdateExpression: "SET merchant_id = :merchant",
          ConditionExpression: "merchant_id = :null", ExpressionAttributeValues: { ":merchant": merchant.id, ":null": null } } },
      ] }));
    } catch (error) {
      if (error instanceof TransactionCanceledException && error.CancellationReasons?.some(r => r.Code === "ConditionalCheckFailed")) validation("This account already has a store.");
      throw error;
    }
    return merchant;
  }
  async editMerchant(account: MerchantAccount, id: string, patch: Partial<Merchant>) {
    this.own(account, id);
    const allowed = ["name", "category", "address", "phone", "closes_at", "default_discount_pct", "menu", "lat", "lng"];
    if (Object.keys(patch).some(k => !allowed.includes(k))) validation("This merchant field cannot be edited.");
    const existing = await this.merchant(id); this.validateMerchant({ ...existing, ...patch });
    if (!Object.keys(patch).length) return existing;
    const names: Record<string, string> = {}; const values: Record<string, unknown> = {};
    const expression = Object.entries(patch).map(([key, value], i) => { names[`#f${i}`] = key; values[`:v${i}`] = value; return `#f${i} = :v${i}`; });
    const result = await this.store.db.send(new UpdateCommand({ TableName: this.tables.merchants, Key: { id },
      UpdateExpression: `SET ${expression.join(", ")}`, ConditionExpression: "attribute_exists(id)", ExpressionAttributeNames: names, ExpressionAttributeValues: values, ReturnValues: "ALL_NEW" }));
    return result.Attributes as Merchant;
  }
  async create(account: MerchantAccount, body: ManualDealInput) {
    if (!account.merchant_id) validation("Set up your store first.");
    const draft = createDraft(await this.merchant(account.merchant_id), body, this.clock());
    await this.store.put(this.tables.deals, draft, true); return this.dto(draft);
  }
  async edit(account: MerchantAccount, id: string, patch: Partial<DealRecord>) {
    const d = await this.deal(id); this.own(account, d.merchant_id);
    if (d.status === "live") {
      if (Object.values(patch).some(value => value === null)) validation("Live deal fields cannot be null.");
      const result = await this.store.db.send(liveEditCommand(this.tables.deals, d, d.merchant_id, patch as Parameters<typeof liveEditCommand>[3], this.clock()));
      return this.dto(result.Attributes as DealRecord);
    }
    if (d.status !== "draft") validation("Only drafts and live deals can be edited.");
    const allowed = ["title", "items", "original_price_cents", "deal_price_cents", "kind", "quantity_total", "max_per_customer", "pickup_start", "pickup_end", "allergens", "note"];
    if (Object.keys(patch).some(k => !allowed.includes(k))) validation("This draft field cannot be edited.");
    const validated = createDraft(await this.merchant(d.merchant_id), { ...d, ...patch }, this.clock());
    const updated: DealRecord = { ...validated, id: d.id, created_at: d.created_at, version: d.version + 1 };
    await this.store.db.send(new PutCommand({ TableName: this.tables.deals, Item: updated,
      ConditionExpression: "#version = :version AND #status = :draft",
      ExpressionAttributeNames: { "#version": "version", "#status": "status" }, ExpressionAttributeValues: { ":version": d.version, ":draft": "draft" } }));
    return this.dto(updated);
  }
  async publish(account: MerchantAccount, id: string) {
    const d = await this.deal(id); this.own(account, d.merchant_id);
    const result = await this.store.db.send(publishCommand(this.tables.deals, d, await this.merchant(d.merchant_id), this.clock(), process.env.PLAN_GATE === "1"));
    return this.dto(result.Attributes as DealRecord);
  }
  async cancelDeal(account: MerchantAccount, id: string) {
    const d = await this.deal(id); this.own(account, d.merchant_id);
    if (d.status === "cancelled") { await this.maintenance(); return this.dto(await this.deal(id)); }
    if (!d.pickup_end && d.status !== "draft" || d.status === "expired" || d.status !== "draft" && utc(d.pickup_end!) <= utc(this.clock())) validation("This deal has already ended.");
    await this.store.db.send(new UpdateCommand({ TableName: this.tables.deals, Key: { id },
      UpdateExpression: "SET #status = :cancelled ADD #version :one", ConditionExpression: "#version = :version",
      ExpressionAttributeNames: { "#version": "version", "#status": "status" }, ExpressionAttributeValues: { ":version": d.version, ":cancelled": "cancelled", ":one": 1 } }));
    // Cancelled state is a durable marker. Every API request resumes an interrupted cascade.
    await this.maintenance(); return this.dto(await this.deal(id));
  }
  async donated(account: MerchantAccount, id: string) {
    const d = await this.deal(id); this.own(account, d.merchant_id);
    if ((await this.dto(d)).status !== "expired" || !d.quantity_left) validation("Only expired deals with units left can be marked donated.");
    const result = await this.store.db.send(new UpdateCommand({ TableName: this.tables.deals, Key: { id },
      UpdateExpression: "SET unsold_action = :donated ADD #version :one", ConditionExpression: "#version = :version",
      ExpressionAttributeNames: { "#version": "version" }, ExpressionAttributeValues: { ":donated": "donated", ":one": 1, ":version": d.version }, ReturnValues: "ALL_NEW" }));
    return this.dto(result.Attributes as DealRecord);
  }
  async maintenance() {
    for (const r of await this.allReservations()) {
      if (r.status !== "reserved") continue;
      for (let attempt = 0; attempt < 8; attempt++) {
        const current = await this.store.get<ReservationRecord>(this.tables.reservations, r.id);
        if (current?.status !== "reserved") break;
        const d = await this.deal(r.deal_id);
        try {
          if (d.status === "cancelled") {
            await this.store.db.send(new TransactWriteCommand({ TransactItems: [
              { Update: { TableName: this.tables.reservations, Key: { id: r.id }, UpdateExpression: "SET #status = :cancelled",
                ConditionExpression: "#status = :reserved", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":cancelled": "cancelled", ":reserved": "reserved" } } },
              { Update: { TableName: this.tables.deals, Key: { id: d.id }, UpdateExpression: "ADD quantity_left :quantity, #version :one",
                ConditionExpression: "#version = :version AND #status = :cancelled", ExpressionAttributeNames: { "#version": "version", "#status": "status" },
                ExpressionAttributeValues: { ":quantity": r.quantity, ":one": 1, ":version": d.version, ":cancelled": "cancelled" } } },
              { Delete: { TableName: this.tables.reservations, Key: { id: codeKey(r.merchant_id, r.pickup_code) }, ConditionExpression: "reservation_id = :id", ExpressionAttributeValues: { ":id": r.id } } },
              { Update: { TableName: this.tables.reservations, Key: { id: limitKey(r.customer_id, r.deal_id) }, UpdateExpression: "ADD units :delta", ConditionExpression: "units >= :quantity", ExpressionAttributeValues: { ":delta": -r.quantity, ":quantity": r.quantity } } },
            ] }));
          } else if (d.pickup_end && Date.parse(this.clock()) >= Date.parse(d.pickup_end) + 900_000) {
            await this.reservations.markNoShow(r.id);
          }
          break;
        } catch (error) {
          if (!(error instanceof TransactionCanceledException) || !error.CancellationReasons?.some(reason => reason.Code === "ConditionalCheckFailed" || reason.Code === "TransactionConflict") || attempt === 7) throw error;
        }
      }
    }
  }
  async summary(account: MerchantAccount, id: string, date: string): Promise<Summary> {
    this.own(account, id);
    const deals = (await this.deals()).filter(d => d.merchant_id === id && localDate(d.created_at) === date);
    const ids = new Set(deals.map(d => d.id)); const reservations = (await this.allReservations()).filter(r => ids.has(r.deal_id));
    const pickups = reservations.filter(r => r.status === "picked_up");
    const units_listed = deals.filter(d => d.published_at !== null).reduce((sum, d) => sum + (d.quantity_total ?? 0), 0);
    const units_picked_up = pickups.reduce((sum, r) => sum + r.quantity, 0);
    const fee = Number(process.env.PLATFORM_FEE_CENTS_PER_PICKUP ?? "0");
    if (!Number.isSafeInteger(fee) || fee < 0) throw new Error("Invalid platform fee configuration");
    return { date, units_listed, units_picked_up, units_no_show: reservations.filter(r => r.status === "no_show").reduce((sum, r) => sum + r.quantity, 0),
      units_unsold: Math.max(0, units_listed - units_picked_up), recovered_cents: pickups.reduce((sum, r) => sum + r.total_cents, 0), platform_fee_cents: fee * pickups.length, if_discarded_cents: 0 };
  }
}
