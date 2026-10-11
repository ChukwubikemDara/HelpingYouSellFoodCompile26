import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { Customer } from "./models";
import { nonEmptyString, phone, utc } from "../validation/primitives";
import { validation } from "../services/errors";
export type CustomerRecord = Customer & { password_hash: string };
export const phoneKey = (value: string) => `guard:phone:${value}`;
/** Auth layer supplies a salted password hash, never plaintext. */
export function createCustomerCommand(table: string, customer: Customer, passwordHash: string) {
  nonEmptyString(customer.id, "customer id"); nonEmptyString(customer.name, "name");
  nonEmptyString(passwordHash, "password hash"); phone(customer.phone);
  if (!customer.id.startsWith("c_") || customer.blocked || customer.no_show_count !== 0) validation("Invalid new customer.");
  const record: CustomerRecord = { ...customer, created_at: utc(customer.created_at), password_hash: passwordHash };
  return new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: table, Item: record, ConditionExpression: "attribute_not_exists(id)" } },
    { Put: { TableName: table, Item: { id: phoneKey(customer.phone), customer_id: customer.id }, ConditionExpression: "attribute_not_exists(id)" } },
  ] });
}
/** Explicit projection prevents accidental password hash leakage. */
export function customerDto(record: CustomerRecord): Customer {
  return { id: record.id, name: record.name, phone: record.phone, no_show_count: record.no_show_count,
    blocked: record.blocked, created_at: record.created_at };
}
