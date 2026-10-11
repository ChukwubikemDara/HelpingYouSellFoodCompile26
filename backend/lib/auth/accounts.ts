import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { createCustomerCommand, customerDto, phoneKey, type CustomerRecord } from "../db/customer-transactions";
import { Store } from "../db/store";
import type { DbConfig } from "../db/config";
import { DomainError, validation } from "../services/errors";
import { nonEmptyString, phone } from "../validation/primitives";
const scrypt = promisify(scryptCallback);
export interface MerchantAccount { id: string; email: string; password_hash: string; merchant_id: string | null }
type Session = { id: string; role: "customer" | "merchant"; subject: string; expires_at?: string };
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const accountKey = (email: string) => `account:${digest(email)}`;
const sessionKey = (token: string) => `session:${digest(token)}`;
export async function hashPassword(password: string): Promise<string> {
  nonEmptyString(password, "password");
  if (password.length < 8 || password.length > 256) validation("Password must contain 8–256 characters.");
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}
async function verifyPassword(password: string, hash: string) {
  const [salt, hex] = hash.split(":");
  const derived = await scrypt(password, salt, 64) as Buffer;
  const expected = Buffer.from(hex, "hex");
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}
export class Accounts {
  constructor(private store: Store, private tables: DbConfig["tables"]) {}
  private async session(role: Session["role"], subject: string) {
    const token = randomBytes(32).toString("base64url");
    await this.store.put(role === "customer" ? this.tables.customers : this.tables.merchants,
      { id: sessionKey(token), role, subject, ...(role === "merchant" ? { expires_at: new Date(Date.now() + 86400000).toISOString() } : {}) }, true);
    return token;
  }
  async customerSignup(body: { name: string; phone: string; password: string }) {
    nonEmptyString(body.name, "name"); phone(body.phone);
    const customer: CustomerRecord = { id: `c_${randomUUID()}`, name: body.name.trim(), phone: body.phone,
      no_show_count: 0, blocked: false, created_at: new Date().toISOString(), password_hash: await hashPassword(body.password) };
    try { await this.store.db.send(createCustomerCommand(this.tables.customers, customer, customer.password_hash)); }
    catch (error) {
      if (error instanceof TransactionCanceledException && error.CancellationReasons?.some(r => r.Code === "ConditionalCheckFailed"))
        throw new DomainError("ACCOUNT_EXISTS", "An account already uses this phone number.", 409);
      throw error;
    }
    return { token: await this.session("customer", customer.id), customer: customerDto(customer) };
  }
  async customerSignin(body: { phone: string; password: string }) {
    phone(body.phone); nonEmptyString(body.password, "password");
    if (body.password.length > 256) validation("Password is too long.");
    const guard = await this.store.get<{ customer_id: string }>(this.tables.customers, phoneKey(body.phone));
    const customer = guard ? await this.store.get<CustomerRecord>(this.tables.customers, guard.customer_id) : undefined;
    // Hash a dummy value too, so unknown accounts do not skip the password KDF.
    if (!await verifyPassword(body.password, customer?.password_hash ?? `00000000000000000000000000000000:${"00".repeat(64)}`) || !customer)
      throw new DomainError("BAD_CREDENTIALS", "Phone or password is incorrect.", 401);
    return { token: await this.session("customer", customer.id), customer: customerDto(customer) };
  }
  async customer(token: string | undefined) {
    const session = token ? await this.store.get<Session>(this.tables.customers, sessionKey(token)) : undefined;
    const customer = session?.role === "customer" ? await this.store.get<CustomerRecord>(this.tables.customers, session.subject) : undefined;
    if (!customer) throw new DomainError("UNAUTHORIZED", "Sign in to continue.", 401);
    return customerDto(customer);
  }
  private email(value: string) {
    nonEmptyString(value, "email"); const email = value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) validation("Enter a valid email.");
    return email;
  }
  async merchantSignup(body: { email: string; password: string }) {
    const email = this.email(body.email);
    const account: MerchantAccount = { id: accountKey(email), email, password_hash: await hashPassword(body.password), merchant_id: null };
    try { await this.store.put(this.tables.merchants, account, true); }
    catch (error) { if (error instanceof ConditionalCheckFailedException) throw new DomainError("ACCOUNT_EXISTS", "An account already uses this email.", 409); throw error; }
    return this.session("merchant", account.id);
  }
  async merchantSignin(body: { email: string; password: string }) {
    const email = this.email(body.email); nonEmptyString(body.password, "password");
    if (body.password.length > 256) validation("Password is too long.");
    const account = await this.store.get<MerchantAccount>(this.tables.merchants, accountKey(email));
    if (!await verifyPassword(body.password, account?.password_hash ?? `00000000000000000000000000000000:${"00".repeat(64)}`) || !account)
      throw new DomainError("BAD_CREDENTIALS", "Email or password is incorrect.", 401);
    return this.session("merchant", account.id);
  }
  async merchant(token: string | undefined): Promise<MerchantAccount> {
    const session = token ? await this.store.get<Session>(this.tables.merchants, sessionKey(token)) : undefined;
    const account = session?.role === "merchant" && session.expires_at && Date.parse(session.expires_at) > Date.now() ? await this.store.get<MerchantAccount>(this.tables.merchants, session.subject) : undefined;
    if (!account) throw new DomainError("UNAUTHORIZED", "Sign in to continue.", 401);
    return account;
  }
  async signout(role: Session["role"], token?: string) {
    if (token) await this.store.remove(role === "customer" ? this.tables.customers : this.tables.merchants, sessionKey(token));
  }
}
