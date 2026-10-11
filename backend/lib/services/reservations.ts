import { randomUUID } from "node:crypto";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { Customer, DealRecord, Merchant, Reservation, ReservationRecord } from "../db/models";
import { Repository } from "../db/repository";
import { assertReservable, cancelCommand, codeKey, limitKey, noShowCommand, pickupCommand, reserveCommand, type Tables } from "../db/reservation-transactions";
import { generatePickupCode } from "./pickup-code";
import { DomainError, notFound, validation } from "./errors";
import { requireCustomer, requireMerchant, type Principal } from "../auth/principal";
import { utc } from "../validation/primitives";

export class ReservationService {
  private deals: Repository; private reservations: Repository; private customers: Repository; private merchants: Repository;
  constructor(private client: DynamoDBDocumentClient, private tables: Tables & { merchants: string },
    private clock: () => string = () => new Date().toISOString()) {
    this.deals = new Repository(client, tables.deals); this.reservations = new Repository(client, tables.reservations);
    this.customers = new Repository(client, tables.customers); this.merchants = new Repository(client, tables.merchants);
  }
  private async required<T extends { id: string }>(repo: Repository, id: string): Promise<T> {
    return await repo.get<T>(id) ?? notFound();
  }
  async dto(record: ReservationRecord): Promise<Reservation> {
    const deal = await this.required<DealRecord>(this.deals, record.deal_id);
    const merchant = await this.required<Merchant>(this.merchants, deal.merchant_id);
    const { version: _version, ...fields } = deal;
    const { merchant_id: _merchantId, ...reservation } = record;
    return { ...reservation, deal: { ...fields,
      status: deal.status !== "draft" && deal.status !== "cancelled" && deal.pickup_end && utc(deal.pickup_end) <= utc(this.clock()) ? "expired" : deal.status,
      merchant: { id: merchant.id, name: merchant.name, category: merchant.category, address: merchant.address, lat: merchant.lat, lng: merchant.lng },
      distance_m: null } };
  }
  private async retry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 12; attempt++) {
      try { return await operation(); }
      catch (error) {
        if (!(error instanceof TransactionCanceledException) ||
          !error.CancellationReasons?.some(r => r.Code === "ConditionalCheckFailed" || r.Code === "TransactionConflict")) throw error;
        if (attempt === 11) throw new DomainError("VALIDATION", "The deal changed. Please refresh and try again.", 422);
        await new Promise(resolve => setTimeout(resolve, Math.min(10 * 2 ** attempt, 200)));
      }
    }
    throw new Error("Unreachable");
  }
  async reserve(principal: Principal | null, input: { deal_id: string; quantity: number }): Promise<Reservation> {
    const { customer_id } = requireCustomer(principal);
    return this.retry(async () => {
      const now = utc(this.clock());
      const customer = await this.required<Customer>(this.customers, customer_id);
      const deal = await this.required<DealRecord>(this.deals, input.deal_id);
      assertReservable(deal, customer, input.quantity, now);
      const limit = await this.reservations.get<{ id: string; units: number }>(limitKey(customer_id, deal.id));
      if ((limit?.units ?? 0) + input.quantity > deal.max_per_customer) validation(`You can reserve at most ${deal.max_per_customer} units of this deal.`);
      const record: ReservationRecord = {
        id: `r_${randomUUID()}`, deal_id: deal.id, merchant_id: deal.merchant_id, customer_id,
        customer_name: customer.name, customer_phone: customer.phone, quantity: input.quantity,
        unit_price_cents: deal.deal_price_cents!, total_cents: input.quantity * deal.deal_price_cents!,
        payment_method: "in_store", pickup_code: generatePickupCode(), status: "reserved", created_at: now,
      };
      await this.client.send(reserveCommand(this.tables, deal, customer, record, now));
      return this.dto(record);
    });
  }
  async cancel(principal: Principal | null, id: string): Promise<Reservation> {
    const { customer_id } = requireCustomer(principal);
    return this.retry(async () => {
      const record = await this.required<ReservationRecord>(this.reservations, id);
      if (record.customer_id !== customer_id) notFound();
      if (record.status === "cancelled") return this.dto(record);
      const deal = await this.required<DealRecord>(this.deals, record.deal_id);
      await this.client.send(cancelCommand(this.tables, deal, record, customer_id, this.clock()));
      return this.dto({ ...record, status: "cancelled" });
    });
  }
  async confirmPickup(principal: Principal | null, id: string): Promise<Reservation> {
    const { customer_id } = requireCustomer(principal);
    return this.retry(async () => {
      const record = await this.required<ReservationRecord>(this.reservations, id);
      if (record.customer_id !== customer_id) notFound();
      if (record.status === "picked_up") return this.dto(record);
      const deal = await this.required<DealRecord>(this.deals, record.deal_id);
      await this.client.send(pickupCommand(this.tables, deal, record, this.clock()));
      return this.dto({ ...record, status: "picked_up" });
    });
  }
  async redeem(principal: Principal | null, pickupCode: string): Promise<Reservation> {
    const { merchant_id } = requireMerchant(principal);
    if (!/^\d{4}$/.test(pickupCode)) validation("Pickup code must contain four digits.");
    return this.retry(async () => {
      const lock = await this.reservations.get<{ id: string; reservation_id: string }>(codeKey(merchant_id, pickupCode));
      if (!lock) {
        // No open claim: distinguish a used code from an unknown one, scoped to this merchant.
        let cursor: string | undefined;
        do {
          const page = await this.reservations.query<ReservationRecord>("merchant_id-index", merchant_id, 100, cursor);
          if (page.items.some(r => r.pickup_code === pickupCode && r.status === "picked_up")) {
            throw new DomainError("CODE_ALREADY_USED", "This pickup code has already been used.", 409);
          }
          cursor = page.nextCursor;
        } while (cursor);
        throw new DomainError("CODE_INVALID", "No open reservation matches this code.", 404);
      }
      const record = await this.required<ReservationRecord>(this.reservations, lock.reservation_id);
      if (record.merchant_id !== merchant_id) notFound();
      const deal = await this.required<DealRecord>(this.deals, record.deal_id);
      await this.client.send(pickupCommand(this.tables, deal, record, this.clock()));
      return this.dto({ ...record, status: "picked_up" });
    });
  }
  /** Internal maintenance entry point; never expose as an unprotected public route. */
  async markNoShow(id: string): Promise<void> {
    return this.retry(async () => {
      const record = await this.required<ReservationRecord>(this.reservations, id);
      if (record.status !== "reserved") return;
      const deal = await this.required<DealRecord>(this.deals, record.deal_id);
      const customer = await this.required<Customer>(this.customers, record.customer_id);
      await this.client.send(noShowCommand(this.tables, deal, record, customer, this.clock()));
    });
  }
}
