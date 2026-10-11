/**
 * Single-table layout of the DynamoDB Store driver.
 *
 * One table, string partition key `PK` and sort key `SK`, four overloaded
 * global secondary indexes (GSI1-GSI4, projection ALL). infra/template.yaml
 * creates the same table; tests/store/dynamodb.test.ts checks that the
 * template and `tableDefinition()` agree. docs/AWS.md documents every item
 * type and access pattern.
 *
 * Attribute naming:
 * - Record fields are stored as top-level attributes with their record names
 *   (snake_case). Nullable fields are stored as DynamoDB NULL, never omitted.
 * - Key attributes are upper case (PK, SK, GSIn PK/SK).
 * - Driver-internal attributes start with "_" (see INTERNAL_PREFIX).
 * Reads strip both groups, so a new record field round-trips without changes
 * here.
 */
import type { CreateTableCommandInput } from "@aws-sdk/client-dynamodb";
import { utcKey } from "@/lib/clock";

export const PK = "PK";
export const SK = "SK";

export const GSI = {
  GSI1: { name: "GSI1", pk: "GSI1PK", sk: "GSI1SK" },
  GSI2: { name: "GSI2", pk: "GSI2PK", sk: "GSI2SK" },
  GSI3: { name: "GSI3", pk: "GSI3PK", sk: "GSI3SK" },
  GSI4: { name: "GSI4", pk: "GSI4PK", sk: "GSI4SK" },
} as const;

export type GsiName = keyof typeof GSI;

/** Every key attribute (table and indexes). All are strings. */
export const KEY_ATTRIBUTES: readonly string[] = [
  PK,
  SK,
  ...Object.values(GSI).flatMap((g) => [g.pk, g.sk]),
];

/** Driver-internal attribute prefix. Never part of a record. */
export const INTERNAL_PREFIX = "_";

/** Internal: entity type, for people reading the table in the console. */
export const TYPE_ATTR = "_type";
/** Internal (deal): utcKey(pickup_end), compared as a string in reserve's condition. */
export const PICKUP_END_KEY_ATTR = "_pek";
/** Internal (deal): `_q#<customer_id>` = that customer's reserved + picked_up quantity on the deal. */
export const CUSTOMER_QTY_PREFIX = "_q#";
/**
 * Internal (deal): `_o#<reservation_id>` marks a reservation created on the deal
 * and not cancelled. Added by reserve, removed by cancelReservation and
 * cancelDeal. A picked-up reservation keeps its marker; cancelDeal re-reads the
 * reservations and only touches those still `reserved`.
 */
export const OPEN_RES_PREFIX = "_o#";

/** True for key attributes and driver-internal attributes. */
export function isInternalAttribute(name: string): boolean {
  return name.startsWith(INTERNAL_PREFIX) || KEY_ATTRIBUTES.includes(name);
}

/**
 * Escape a key component so composite keys stay unambiguous even if a value
 * contains the "#" separator ("%" -> "%25", "#" -> "%23").
 */
export function enc(value: string): string {
  return value.replace(/%/g, "%25").replace(/#/g, "%23");
}

/**
 * Sort-key suffix that sorts after every `<utcKey>#<id>` with the same
 * utcKey: utcKey() is always 24 characters and "$" (0x24) > "#" (0x23). A key
 * condition `SK > utcKey(t) + AFTER` therefore means "created strictly after t".
 */
export const AFTER = "$";

/** `<utcKey(instant)>#<id>`: sorts by instant, then id. */
export function timeSortKey(instant: string, id: string): string {
  return `${utcKey(instant)}#${id}`;
}

/** Base-table keys of every item type. */
export const keys = {
  account: (id: string) => ({ [PK]: `ACCOUNT#${enc(id)}`, [SK]: "ACCOUNT" }),
  email: (email: string) => ({ [PK]: `EMAIL#${enc(email)}`, [SK]: "EMAIL" }),
  session: (id: string) => ({ [PK]: `MSESSION#${enc(id)}`, [SK]: "MSESSION" }),
  customer: (id: string) => ({ [PK]: `CUSTOMER#${enc(id)}`, [SK]: "CUSTOMER" }),
  phone: (phone: string) => ({ [PK]: `PHONE#${enc(phone)}`, [SK]: "PHONE" }),
  token: (id: string) => ({ [PK]: `CTOKEN#${enc(id)}`, [SK]: "CTOKEN" }),
  merchant: (id: string) => ({ [PK]: `MERCHANT#${enc(id)}`, [SK]: "MERCHANT" }),
  owner: (accountId: string) => ({ [PK]: `OWNER#${enc(accountId)}`, [SK]: "OWNER" }),
  deal: (id: string) => ({ [PK]: `DEAL#${enc(id)}`, [SK]: "DEAL" }),
  reservation: (id: string) => ({ [PK]: `RES#${enc(id)}`, [SK]: "RES" }),
  pickupCode: (merchantId: string, code: string) => ({
    [PK]: `CODE#${enc(merchantId)}#${enc(code)}`,
    [SK]: "CODE",
  }),
  follow: (customerId: string, merchantId: string) => ({
    [PK]: `FOLLOW#${enc(customerId)}`,
    [SK]: `M#${enc(merchantId)}`,
  }),
  followPartition: (customerId: string) => `FOLLOW#${enc(customerId)}`,
  notification: (id: string) => ({ [PK]: `NOTIF#${enc(id)}`, [SK]: "NOTIF" }),
  notificationDedupe: (customerId: string, dedupeKey: string) => ({
    [PK]: `NDEDUPE#${enc(customerId)}#${enc(dedupeKey)}`,
    [SK]: "NDEDUPE",
  }),
  suggestion: (merchantId: string, id: string) => ({
    [PK]: `SUGG#${enc(merchantId)}`,
    [SK]: `S#${enc(id)}`,
  }),
  suggestionPartition: (merchantId: string) => `SUGG#${enc(merchantId)}`,
} as const;

/** GSI partition-key values (the "list" side of each access pattern). */
export const indexKeys = {
  /** GSI1: a merchant's deals, sorted by created_at. */
  merchantDeals: (merchantId: string) => `MERCHANT#${enc(merchantId)}#DEALS`,
  /** GSI2: a merchant's deals of one local date, sorted by created_at. */
  merchantDealsByDate: (merchantId: string, localDate: string) =>
    `MERCHANT#${enc(merchantId)}#DEALS#${enc(localDate)}`,
  /** GSI3 (sparse): deals with stored status live and a pickup_end, sorted by pickup_end. */
  openDeals: () => "OPEN_DEALS",
  /** GSI1: a customer's reservations, sorted by created_at. */
  customerReservations: (customerId: string) => `CUSTOMER#${enc(customerId)}#RES`,
  /** GSI2: a deal's reservations, sorted by created_at. */
  dealReservations: (dealId: string) => `DEAL#${enc(dealId)}#RES`,
  /** GSI3: a merchant's reservations of one local date, sorted by created_at. */
  merchantReservationsByDate: (merchantId: string, localDate: string) =>
    `MERCHANT#${enc(merchantId)}#RES#${enc(localDate)}`,
  /** GSI4: a merchant's reservations that used one pickup code, sorted by created_at. */
  merchantPickupCode: (merchantId: string, code: string) =>
    `MERCHANT#${enc(merchantId)}#CODE#${enc(code)}`,
  /** GSI1: a customer's notifications, sorted by created_at. */
  customerNotifications: (customerId: string) => `CUSTOMER#${enc(customerId)}#NOTIF`,
  /** GSI1: a merchant's followers, sorted by customer id. */
  merchantFollowers: (merchantId: string) => `MERCHANT#${enc(merchantId)}#FOLLOWERS`,
} as const;

/**
 * CreateTable input for the table the driver expects. Used by tests (dynalite)
 * and kept equal to the Table resource in infra/template.yaml.
 */
export function tableDefinition(tableName: string): CreateTableCommandInput {
  return {
    TableName: tableName,
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: KEY_ATTRIBUTES.map((name) => ({ AttributeName: name, AttributeType: "S" })),
    KeySchema: [
      { AttributeName: PK, KeyType: "HASH" },
      { AttributeName: SK, KeyType: "RANGE" },
    ],
    GlobalSecondaryIndexes: Object.values(GSI).map((g) => ({
      IndexName: g.name,
      KeySchema: [
        { AttributeName: g.pk, KeyType: "HASH" },
        { AttributeName: g.sk, KeyType: "RANGE" },
      ],
      Projection: { ProjectionType: "ALL" },
    })),
  };
}

/** TransactWriteItems accepts at most this many actions. */
export const MAX_TRANSACT_ITEMS = 100;
/** BatchGetItem accepts at most this many keys. */
export const MAX_BATCH_GET = 100;
