// Fixture mode: the contract's example objects (docs/api-contract.md v0.6) copied exactly,
// served by an in-memory store that answers like the API (same paths, status codes,
// and error envelope), so sign up -> reserve -> pickup code works offline.
//
// Fixture-only behavior (the live API decides these for real):
// - Time windows are not enforced (deals do not expire, pickup can be confirmed any time),
//   so the offline flow works at any hour.
// - The store lives in memory and resets when the app reloads. Fixture tokens carry the
//   customer's id, name and phone so a session survives a reload; reservations do not.
// - The example customer c_1 (phone +18145550123) signs in with the password "password".

import type { AppNotification, Customer, Deal, Reservation } from './api';

// ---------- Contract example objects, copied exactly ----------

export const EXAMPLE_CUSTOMER: Customer = {
  id: 'c_1',
  name: 'Sam',
  phone: '+18145550123',
  no_show_count: 0,
  blocked: false,
  created_at: '2026-10-11T16:00:00-04:00',
};

export const EXAMPLE_DEAL: Deal = {
  id: 'd_1',
  merchant_id: 'm_1',
  merchant: {
    id: 'm_1',
    name: 'Example Bakery',
    category: 'bakery',
    address: '...',
    lat: 40.7934,
    lng: -77.86,
  },
  title: 'Croissants (2-pack)',
  items: [{ name: 'Butter croissant', qty: 2 }],
  original_price_cents: 800,
  deal_price_cents: 400,
  kind: 'surplus',
  quantity_total: 3,
  quantity_left: 3,
  max_per_customer: 2,
  unsold_action: 'none',
  pickup_start: '2026-10-11T17:00:00-04:00',
  pickup_end: '2026-10-11T18:00:00-04:00',
  allergens: ['wheat', 'milk', 'egg'],
  note: 'Baked this morning.',
  photo_url: null,
  status: 'live',
  created_at: '2026-10-11T15:02:00-04:00',
  published_at: '2026-10-11T15:04:00-04:00',
  distance_m: 420,
};

export const EXAMPLE_RESERVATION: Reservation = {
  id: 'r_1',
  deal_id: 'd_1',
  deal: EXAMPLE_DEAL,
  customer_id: 'c_1',
  customer_name: 'Sam',
  customer_phone: '+18145550123',
  quantity: 1,
  unit_price_cents: 400,
  total_cents: 400,
  payment_method: 'in_store',
  pickup_code: '4821',
  status: 'reserved',
  created_at: '2026-10-11T16:10:00-04:00',
};

export const EXAMPLE_NOTIFICATION: AppNotification = {
  id: 'n_1',
  type: 'new_deal',
  title: 'Example Bakery',
  body: 'Croissants (2-pack) for $4.00, pickup until 6:00 PM',
  deal_id: 'd_1',
  reservation_id: null,
  read: false,
  created_at: '2026-10-11T15:04:00-04:00',
};

export const EXAMPLE_FOLLOWS = { merchant_ids: ['m_1'] };

// ---------- In-memory store ----------

type StoredCustomer = { customer: Customer; password: string | null };
type StoredReservation = Omit<Reservation, 'deal'>;
type StoredNotification = AppNotification & { customer_id: string };

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const db = {
  customers: new Map<string, StoredCustomer>([
    [EXAMPLE_CUSTOMER.id, { customer: clone(EXAMPLE_CUSTOMER), password: 'password' }],
  ]),
  deals: new Map<string, Deal>([[EXAMPLE_DEAL.id, clone(EXAMPLE_DEAL)]]),
  reservations: [omitDeal(clone(EXAMPLE_RESERVATION))] as StoredReservation[],
  follows: new Map<string, Set<string>>([[EXAMPLE_CUSTOMER.id, new Set(EXAMPLE_FOLLOWS.merchant_ids)]]),
  notifications: [{ ...clone(EXAMPLE_NOTIFICATION), customer_id: EXAMPLE_CUSTOMER.id }] as StoredNotification[],
  nextCustomer: 2,
  nextReservation: 2,
};

function omitDeal(r: Reservation): StoredReservation {
  const { deal: _deal, ...rest } = r;
  return rest;
}

// ---------- Helpers ----------

type Res = { status: number; body: unknown };

const ok = (body: unknown, status = 200): Res => ({ status, body });
const fail = (status: number, code: string, message: string): Res => ({
  status,
  body: { error: { code, message } },
});

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** ISO 8601 with the device's offset, like 2026-10-11T17:30:00-04:00. */
function nowIso(): string {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** A deal as GET /deals/{id} and reservations return it: distance_m is only set by GET /deals. */
function dealOut(deal: Deal, distance: number | null = null): Deal {
  return { ...clone(deal), distance_m: distance };
}

function reservationOut(r: StoredReservation): Reservation {
  const deal = db.deals.get(r.deal_id);
  return { ...clone(r), deal: dealOut(deal ?? EXAMPLE_DEAL) };
}

const TOKEN_PREFIX = 'fixture.';

function tokenFor(c: Customer): string {
  return TOKEN_PREFIX + encodeURIComponent(JSON.stringify({ id: c.id, name: c.name, phone: c.phone, created_at: c.created_at }));
}

function customerForToken(token: string | null): StoredCustomer | null {
  if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
  let decoded: { id?: unknown; name?: unknown; phone?: unknown; created_at?: unknown };
  try {
    decoded = JSON.parse(decodeURIComponent(token.slice(TOKEN_PREFIX.length)));
  } catch {
    return null;
  }
  if (typeof decoded.id !== 'string') return null;
  const existing = db.customers.get(decoded.id);
  if (existing) return existing;
  // The in-memory store was reset by a reload: restore the customer from the token.
  if (typeof decoded.name !== 'string' || typeof decoded.phone !== 'string') return null;
  const restored: StoredCustomer = {
    customer: {
      id: decoded.id,
      name: decoded.name,
      phone: decoded.phone,
      no_show_count: 0,
      blocked: false,
      created_at: typeof decoded.created_at === 'string' ? decoded.created_at : nowIso(),
    },
    password: null,
  };
  db.customers.set(decoded.id, restored);
  const n = Number(decoded.id.replace(/^c_/, ''));
  if (Number.isFinite(n) && n >= db.nextCustomer) db.nextCustomer = n + 1;
  return restored;
}

function findByPhone(phone: string): StoredCustomer | undefined {
  for (const c of db.customers.values()) if (c.customer.phone === phone) return c;
  return undefined;
}

function newPickupCode(merchantId: string): string {
  const taken = new Set(
    db.reservations
      .filter((r) => r.status === 'reserved' && db.deals.get(r.deal_id)?.merchant_id === merchantId)
      .map((r) => r.pickup_code)
  );
  for (;;) {
    const code = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    if (!taken.has(code)) return code;
  }
}

const E164 = /^\+[1-9]\d{7,14}$/;

// ---------- Router ----------

type Body = Record<string, unknown> | undefined;
type QueryIn = Record<string, string | number | undefined | null>;

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function route(method: string, path: string, query: QueryIn, body: Body, token: string | null): Res {
  const seg = path.split('/').filter(Boolean).map(decodeURIComponent);

  // --- customer auth ---
  if (method === 'POST' && path === '/auth/customer/signup') {
    const name = str(body?.name)?.trim();
    const phone = str(body?.phone);
    const password = str(body?.password);
    if (!name) return fail(422, 'VALIDATION', 'Name is required.');
    if (!phone || !E164.test(phone)) return fail(422, 'VALIDATION', 'Phone must be in E.164 format.');
    if (!password || password.length < 8) return fail(422, 'VALIDATION', 'Password must be at least 8 characters.');
    const existing = findByPhone(phone);
    if (existing && existing.password !== null) {
      return fail(409, 'ACCOUNT_EXISTS', 'An account with this phone number already exists.');
    }
    const customer: Customer = existing
      ? { ...existing.customer, name }
      : {
          id: `c_${db.nextCustomer++}`,
          name,
          phone,
          no_show_count: 0,
          blocked: false,
          created_at: nowIso(),
        };
    db.customers.set(customer.id, { customer, password });
    return ok({ token: tokenFor(customer), customer: clone(customer) }, 201);
  }

  if (method === 'POST' && path === '/auth/customer/signin') {
    const phone = str(body?.phone);
    const password = str(body?.password);
    const found = phone ? findByPhone(phone) : undefined;
    if (!found || found.password === null || found.password !== password) {
      return fail(401, 'BAD_CREDENTIALS', 'Wrong phone number or password.');
    }
    return ok({ token: tokenFor(found.customer), customer: clone(found.customer) });
  }

  // --- deals (no sign-in) ---
  if (method === 'GET' && path === '/deals') {
    const lat = query.lat !== undefined && query.lat !== null ? Number(query.lat) : null;
    const lng = query.lng !== undefined && query.lng !== null ? Number(query.lng) : null;
    const hasLoc = lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng);
    const sort = query.sort ?? 'ending';
    if (sort !== 'ending' && sort !== 'distance' && sort !== 'discount') {
      return fail(422, 'VALIDATION', 'sort must be ending, distance or discount.');
    }
    if (sort === 'distance' && !hasLoc) return fail(422, 'VALIDATION', 'sort=distance needs lat and lng.');

    let deals = [...db.deals.values()].filter((d) => d.status === 'live' || d.status === 'sold_out');
    if (query.category) deals = deals.filter((d) => d.merchant.category === query.category);
    if (query.kind) deals = deals.filter((d) => d.kind === query.kind);

    const out = deals.map((d) =>
      dealOut(
        d,
        hasLoc && d.merchant.lat !== null && d.merchant.lng !== null
          ? Math.round(haversineMeters(lat as number, lng as number, d.merchant.lat, d.merchant.lng))
          : null
      )
    );
    const endMs = (d: Deal) => (d.pickup_end ? Date.parse(d.pickup_end) : Number.POSITIVE_INFINITY);
    if (sort === 'distance') {
      out.sort((a, b) => {
        if (a.distance_m === null && b.distance_m === null) return endMs(a) - endMs(b);
        if (a.distance_m === null) return 1;
        if (b.distance_m === null) return -1;
        return a.distance_m - b.distance_m;
      });
    } else if (sort === 'discount') {
      // Biggest percent off first; deals without both prices go last. Ties end soonest first.
      const off = (d: Deal) =>
        d.original_price_cents && d.deal_price_cents !== null && d.original_price_cents > 0
          ? 1 - d.deal_price_cents / d.original_price_cents
          : -1;
      out.sort((a, b) => off(b) - off(a) || endMs(a) - endMs(b));
    } else {
      out.sort((a, b) => endMs(a) - endMs(b));
    }
    return ok({ deals: out });
  }

  if (method === 'GET' && seg[0] === 'deals' && seg.length === 2) {
    const deal = db.deals.get(seg[1]);
    if (!deal || deal.status === 'draft') return fail(404, 'NOT_FOUND', 'Deal not found.');
    return ok(dealOut(deal));
  }

  // --- everything below needs a signed-in customer ---
  const me = customerForToken(token);
  const needsAuth =
    path === '/customers/me' ||
    seg[0] === 'reservations' ||
    seg[0] === 'follows' ||
    seg[0] === 'notifications' ||
    path === '/customers/me/push-token';
  if (!needsAuth) return fail(404, 'NOT_FOUND', 'Not found.');
  if (!me) return fail(401, 'UNAUTHORIZED', 'Sign in to continue.');
  const cid = me.customer.id;

  if (method === 'GET' && path === '/customers/me') return ok(clone(me.customer));

  if (method === 'POST' && path === '/customers/me/push-token') {
    if (!str(body?.expo_push_token)) return fail(422, 'VALIDATION', 'expo_push_token is required.');
    return ok({ ok: true });
  }

  // --- reservations ---
  if (method === 'POST' && path === '/reservations') {
    const dealId = str(body?.deal_id);
    const quantity = body?.quantity;
    const deal = dealId ? db.deals.get(dealId) : undefined;
    if (!deal || deal.status === 'draft') return fail(404, 'NOT_FOUND', 'Deal not found.');
    if (me.customer.blocked) {
      return fail(403, 'CUSTOMER_BLOCKED', 'You missed two pickups, so you can no longer reserve.');
    }
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) {
      return fail(422, 'VALIDATION', 'Quantity must be at least 1.');
    }
    if (deal.status === 'sold_out') return fail(409, 'SOLD_OUT', 'This deal is sold out.');
    if (deal.status !== 'live') return fail(409, 'DEAL_NOT_LIVE', 'This deal is no longer available.');
    const already = db.reservations
      .filter((r) => r.deal_id === deal.id && r.customer_id === cid && (r.status === 'reserved' || r.status === 'picked_up'))
      .reduce((n, r) => n + r.quantity, 0);
    if (already + quantity > deal.max_per_customer) {
      return fail(422, 'VALIDATION', `You can reserve up to ${deal.max_per_customer} of this deal.`);
    }
    if (quantity > deal.quantity_left) {
      return fail(409, 'SOLD_OUT', `Only ${deal.quantity_left} left.`);
    }
    deal.quantity_left -= quantity;
    if (deal.quantity_left === 0) deal.status = 'sold_out';
    const unit = deal.deal_price_cents ?? 0;
    const r: StoredReservation = {
      id: `r_${db.nextReservation++}`,
      deal_id: deal.id,
      customer_id: cid,
      customer_name: me.customer.name,
      customer_phone: me.customer.phone,
      quantity,
      unit_price_cents: unit,
      total_cents: unit * quantity,
      payment_method: 'in_store',
      pickup_code: newPickupCode(deal.merchant_id),
      status: 'reserved',
      created_at: nowIso(),
    };
    db.reservations.push(r);
    return ok(reservationOut(r), 201);
  }

  if (method === 'GET' && path === '/reservations') {
    const mine = db.reservations
      .filter((r) => r.customer_id === cid)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .map(reservationOut);
    return ok({ reservations: mine });
  }

  if (seg[0] === 'reservations' && seg.length >= 2) {
    const r = db.reservations.find((x) => x.id === seg[1] && x.customer_id === cid);
    if (!r) return fail(404, 'NOT_FOUND', 'Reservation not found.');

    if (method === 'GET' && seg.length === 2) return ok(reservationOut(r));

    if (method === 'POST' && seg[2] === 'cancel' && seg.length === 3) {
      if (r.status !== 'reserved') return fail(422, 'VALIDATION', 'Only an open reservation can be cancelled.');
      r.status = 'cancelled';
      const deal = db.deals.get(r.deal_id);
      if (deal) {
        deal.quantity_left += r.quantity;
        if (deal.status === 'sold_out' && deal.quantity_left > 0) deal.status = 'live';
      }
      return ok(reservationOut(r));
    }

    if (method === 'POST' && seg[2] === 'confirm-pickup' && seg.length === 3) {
      if (r.status !== 'reserved') return fail(422, 'VALIDATION', 'Only an open reservation can be picked up.');
      r.status = 'picked_up';
      return ok(reservationOut(r));
    }
  }

  // --- follows ---
  if (path === '/follows') {
    const set = db.follows.get(cid) ?? new Set<string>();
    if (method === 'GET') return ok({ merchant_ids: [...set] });
    if (method === 'POST') {
      const merchantId = str(body?.merchant_id);
      if (!merchantId) return fail(422, 'VALIDATION', 'merchant_id is required.');
      const known = [...db.deals.values()].some((d) => d.merchant_id === merchantId);
      if (!known) return fail(404, 'NOT_FOUND', 'Store not found.');
      set.add(merchantId);
      db.follows.set(cid, set);
      return ok({ ok: true });
    }
  }
  if (method === 'DELETE' && seg[0] === 'follows' && seg.length === 2) {
    db.follows.get(cid)?.delete(seg[1]);
    return ok({ ok: true });
  }

  // --- notifications ---
  if (method === 'GET' && path === '/notifications') {
    const since = typeof query.since === 'string' ? Date.parse(query.since) : NaN;
    const list = db.notifications
      .filter((n) => n.customer_id === cid)
      .filter((n) => (Number.isNaN(since) ? true : Date.parse(n.created_at) > since))
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .map(({ customer_id: _c, ...n }) => n);
    return ok({ notifications: list });
  }
  if (method === 'POST' && seg[0] === 'notifications' && seg[2] === 'read' && seg.length === 3) {
    const n = db.notifications.find((x) => x.id === seg[1] && x.customer_id === cid);
    if (!n) return fail(404, 'NOT_FOUND', 'Notification not found.');
    n.read = true;
    return ok({ ok: true });
  }

  return fail(404, 'NOT_FOUND', 'Not found.');
}

const LATENCY_MS = 250;

export async function fixtureRequest(
  method: string,
  path: string,
  query: QueryIn,
  body: unknown,
  token: string | null
): Promise<Res> {
  await new Promise((r) => setTimeout(r, LATENCY_MS));
  const b = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : undefined;
  return route(method, path, query, b, token);
}
