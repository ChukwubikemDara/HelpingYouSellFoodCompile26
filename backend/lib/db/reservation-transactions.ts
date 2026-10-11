import { TransactWriteCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { Customer, DealRecord, ReservationRecord } from "./models";
import { cents, nonEmptyString, positiveQuantity, utc } from "../validation/primitives";
import { DomainError, validation } from "../services/errors";

export type Tables = { deals: string; reservations: string; customers: string };
export const codeKey = (merchant: string, code: string) => `guard:code:${JSON.stringify([merchant, code])}`;
export const limitKey = (customer: string, deal: string) => `guard:limit:${JSON.stringify([customer, deal])}`;
export const usageKey = (reservation: string) => `usage:${reservation}`;

export function assertReservable(deal: DealRecord, customer: Customer, quantity: number, now: string): void {
  positiveQuantity(quantity);
  if (customer.blocked) throw new DomainError("CUSTOMER_BLOCKED", "Your account cannot make new reservations.", 403);
  if (!deal.pickup_end || utc(deal.pickup_end) <= utc(now) || !["live", "sold_out"].includes(deal.status)) {
    throw new DomainError("DEAL_NOT_LIVE", "This deal is no longer available.", 409);
  }
  if (deal.status === "sold_out" || deal.quantity_left === null || deal.quantity_left < quantity) {
    throw new DomainError("SOLD_OUT", "Not enough units remain.", 409);
  }
  if (quantity > deal.max_per_customer) validation(`You can reserve at most ${deal.max_per_customer} units of this deal.`);
  if (deal.deal_price_cents === null) validation("The deal has no price.");
}
function validateRecord(record: ReservationRecord) {
  for (const field of ["id", "deal_id", "customer_id", "merchant_id"] as const) nonEmptyString(record[field], field);
  positiveQuantity(record.quantity); cents(record.unit_price_cents); cents(record.total_cents); utc(record.created_at);
  if (!/^\d{4}$/.test(record.pickup_code)) validation("Pickup code must contain four digits.");
}
function dealWrite(tables: Tables, deal: DealRecord, quantityDelta: number, nextStatus: string, now: string) {
  // Computed state is protected by version AND stock equality. No unconditional read-modify-write.
  return { Update: {
    TableName: tables.deals, Key: { id: deal.id },
    UpdateExpression: "SET quantity_left = quantity_left + :delta, #status = :next ADD #version :one",
    ConditionExpression: "#version = :version AND quantity_left = :left AND #status = :status AND pickup_end > :now",
    ExpressionAttributeNames: { "#status": "status", "#version": "version" },
    ExpressionAttributeValues: { ":delta": quantityDelta, ":next": nextStatus, ":one": 1,
      ":version": deal.version, ":left": deal.quantity_left, ":status": deal.status, ":now": utc(now) },
  } };
}
function releaseCode(tables: Tables, record: ReservationRecord) {
  return { Delete: { TableName: tables.reservations, Key: { id: codeKey(record.merchant_id, record.pickup_code) },
    ConditionExpression: "reservation_id = :reservation", ExpressionAttributeValues: { ":reservation": record.id } } };
}
function stateChange(tables: Tables, record: ReservationRecord, nextStatus: string) {
  return { Update: { TableName: tables.reservations, Key: { id: record.id },
    UpdateExpression: "SET #status = :next",
    ConditionExpression: "#status = :reserved AND customer_id = :customer AND deal_id = :deal AND quantity = :quantity",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: { ":next": nextStatus, ":reserved": "reserved", ":customer": record.customer_id,
      ":deal": record.deal_id, ":quantity": record.quantity } } };
}
export function reserveCommand(tables: Tables, deal: DealRecord, customer: Customer, record: ReservationRecord, now: string) {
  validateRecord(record); assertReservable(deal, customer, record.quantity, now);
  if (record.status !== "reserved" || record.deal_id !== deal.id || record.customer_id !== customer.id ||
      record.merchant_id !== deal.merchant_id || record.unit_price_cents !== deal.deal_price_cents ||
      record.total_cents !== record.quantity * record.unit_price_cents || record.customer_name !== customer.name ||
      record.customer_phone !== customer.phone || record.payment_method !== "in_store") validation("Invalid reservation snapshot.");
  return new TransactWriteCommand({ TransactItems: [
    dealWrite(tables, deal, -record.quantity, deal.quantity_left === record.quantity ? "sold_out" : "live", now),
    { ConditionCheck: { TableName: tables.customers, Key: { id: customer.id },
      ConditionExpression: "attribute_exists(id) AND blocked = :false", ExpressionAttributeValues: { ":false": false } } },
    { Put: { TableName: tables.reservations, Item: record, ConditionExpression: "attribute_not_exists(id)" } },
    { Put: { TableName: tables.reservations,
      Item: { id: codeKey(record.merchant_id, record.pickup_code), reservation_id: record.id },
      ConditionExpression: "attribute_not_exists(id)" } },
    { Update: { TableName: tables.reservations, Key: { id: limitKey(customer.id, deal.id) },
      UpdateExpression: "ADD units :quantity",
      ConditionExpression: "attribute_not_exists(units) OR units <= :available",
      ExpressionAttributeValues: { ":quantity": record.quantity, ":available": deal.max_per_customer - record.quantity } } },
  ] });
}
export function cancelCommand(tables: Tables, deal: DealRecord, record: ReservationRecord, ownerCustomerId: string, now: string) {
  validateRecord(record);
  if (record.customer_id !== ownerCustomerId) throw new DomainError("NOT_FOUND", "Not found.", 404);
  if (record.status !== "reserved") validation("Only open reservations can be cancelled.");
  if (record.deal_id !== deal.id || !deal.pickup_end || utc(deal.pickup_end) <= utc(now) || !["live", "sold_out"].includes(deal.status)) validation("The cancellation window has ended.");
  return new TransactWriteCommand({ TransactItems: [
    stateChange(tables, record, "cancelled"), dealWrite(tables, deal, record.quantity, "live", now),
    releaseCode(tables, record),
    { Update: { TableName: tables.reservations, Key: { id: limitKey(record.customer_id, deal.id) },
      UpdateExpression: "ADD units :delta", ConditionExpression: "units >= :quantity",
      ExpressionAttributeValues: { ":delta": -record.quantity, ":quantity": record.quantity } } },
  ] });
}
export function pickupCommand(tables: Tables, deal: DealRecord, record: ReservationRecord, now: string) {
  validateRecord(record);
  if (record.status !== "reserved") throw new DomainError("CODE_ALREADY_USED", "This reservation is already completed.", 409);
  if (record.deal_id !== deal.id || record.merchant_id !== deal.merchant_id || !deal.pickup_end ||
      utc(now) < utc(deal.pickup_start) || utc(now) > utc(deal.pickup_end) || deal.status === "cancelled") validation("Pickup is only available during the pickup window.");
  return new TransactWriteCommand({ TransactItems: [
    stateChange(tables, record, "picked_up"),
    { ConditionCheck: { TableName: tables.deals, Key: { id: deal.id },
      ConditionExpression: "#version = :version AND merchant_id = :merchant AND #status <> :cancelled AND pickup_start <= :now AND pickup_end >= :now",
      ExpressionAttributeNames: { "#version": "version", "#status": "status" },
      ExpressionAttributeValues: { ":version": deal.version, ":merchant": record.merchant_id, ":cancelled": "cancelled", ":now": utc(now) } } },
    releaseCode(tables, record),
    // Transactional outbox: billing delivery can retry with reservation id as idempotency key.
    { Put: { TableName: tables.reservations, Item: { id: usageKey(record.id), reservation_id: record.id,
      billing_merchant_id: record.merchant_id, event_type: "picked_up", delivered: false, created_at: utc(now) },
      ConditionExpression: "attribute_not_exists(id)" } },
  ] });
}
export function noShowCommand(tables: Tables, deal: DealRecord, record: ReservationRecord, customer: Customer, now: string) {
  validateRecord(record);
  if (record.status !== "reserved" || record.deal_id !== deal.id || record.customer_id !== customer.id || !deal.pickup_end ||
      Date.parse(utc(now)) < Date.parse(utc(deal.pickup_end)) + 15 * 60_000 || deal.status === "cancelled") validation("Reservation is not due for no-show processing.");
  const nextCount = customer.no_show_count + 1;
  return new TransactWriteCommand({ TransactItems: [
    stateChange(tables, record, "no_show"), releaseCode(tables, record),
    { ConditionCheck: { TableName: tables.deals, Key: { id: deal.id },
      ConditionExpression: "#version = :version AND #status <> :cancelled",
      ExpressionAttributeNames: { "#version": "version", "#status": "status" },
      ExpressionAttributeValues: { ":version": deal.version, ":cancelled": "cancelled" } } },
    { Update: { TableName: tables.customers, Key: { id: customer.id },
      UpdateExpression: "SET no_show_count = :next, blocked = :blocked",
      ConditionExpression: "attribute_exists(id) AND no_show_count = :previous",
      ExpressionAttributeValues: { ":next": nextCount, ":blocked": customer.blocked || nextCount >= 2, ":previous": customer.no_show_count } } },
  ] });
}
export async function executeTransaction(client: DynamoDBDocumentClient, command: TransactWriteCommand): Promise<void> {
  await client.send(command);
}
