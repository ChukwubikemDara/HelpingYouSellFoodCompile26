import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { DealRecord, Merchant } from "./models";
import { validatePublish } from "../validation/deals";
import { DomainError, notFound, validation } from "../services/errors";
import { utc } from "../validation/primitives";
export function publishCommand(table: string, deal: DealRecord, merchant: Merchant, now: string, planGate = false) {
  if (deal.merchant_id !== merchant.id) notFound();
  if (planGate && merchant.plan_status !== "active") throw new DomainError("PLAN_REQUIRED", "Choose a plan before publishing.", 402);
  if (deal.status !== "draft") validation("Only drafts can be published.");
  validatePublish(deal, now);
  return new UpdateCommand({ TableName: table, Key: { id: deal.id },
    UpdateExpression: "SET #status = :live, published_at = :now, quantity_left = :total ADD #version :one",
    ConditionExpression: "#version = :version AND #status = :draft AND merchant_id = :merchant",
    ExpressionAttributeNames: { "#status": "status", "#version": "version" },
    ExpressionAttributeValues: { ":live": "live", ":draft": "draft", ":now": utc(now), ":total": deal.quantity_total,
      ":one": 1, ":version": deal.version, ":merchant": merchant.id }, ReturnValues: "ALL_NEW" });
}
export function liveEditCommand(table: string, deal: DealRecord, merchantId: string,
  patch: { quantity_total?: number; pickup_end?: string; note?: string; deal_price_cents?: number }, now: string) {
  if (deal.merchant_id !== merchantId) notFound();
  // Contract permits edits to live only; sold_out is not silently expanded here.
  if (deal.status !== "live" || !deal.pickup_end || utc(deal.pickup_end) <= utc(now)) validation("Only live deals can be edited.");
  if (Object.keys(patch).some(k => !["quantity_total", "pickup_end", "note", "deal_price_cents"].includes(k))) validation("This field cannot be edited while live.");
  const total = patch.quantity_total ?? deal.quantity_total!;
  const allocated = deal.quantity_total! - deal.quantity_left!;
  if (!Number.isSafeInteger(total) || total < 1 || total < allocated) validation("Quantity cannot be below units already reserved.");
  const price = patch.deal_price_cents ?? deal.deal_price_cents!;
  if (!Number.isSafeInteger(price) || price < 0 || price > deal.deal_price_cents!) validation("A live price can only be lowered.");
  const end = utc(patch.pickup_end ?? deal.pickup_end);
  if (end <= utc(now) || end <= utc(deal.pickup_start)) validation("Pickup end must be after now and pickup start.");
  if (patch.note !== undefined && typeof patch.note !== "string") validation("Note must be text.");
  return new UpdateCommand({ TableName: table, Key: { id: deal.id },
    UpdateExpression: "SET quantity_total = :total, quantity_left = :left, deal_price_cents = :price, pickup_end = :end, note = :note, #status = :next ADD #version :one",
    ConditionExpression: "#version = :version AND #status = :live AND merchant_id = :merchant AND pickup_end > :now",
    ExpressionAttributeNames: { "#status": "status", "#version": "version" },
    ExpressionAttributeValues: { ":total": total, ":left": total - allocated, ":price": price, ":end": end,
      ":note": patch.note ?? deal.note, ":next": total === allocated ? "sold_out" : "live", ":one": 1,
      ":version": deal.version, ":live": "live", ":merchant": merchantId, ":now": utc(now) }, ReturnValues: "ALL_NEW" });
}
