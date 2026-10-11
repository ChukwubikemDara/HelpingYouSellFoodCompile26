// In-app stand-in for the backend, used until the real one is up.
// Enabled with EXPO_PUBLIC_API_MOCK=1. Same rules as web/src/mock.ts. Mirrors the contract's shapes, status
// transitions and error codes closely enough to build every screen against.

import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Deal, Draft, ErrorCode, Merchant, Reservation, Summary } from './types'

interface Db {
  merchants: Merchant[]
  deals: Deal[]
  reservations: Reservation[]
  seq: number
}

export class MockError extends Error {
  status: number
  code: ErrorCode

  constructor(status: number, code: ErrorCode, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

const KEY = 'mock_db_v2' // bump when the seed shape changes

function hoursFromNow(h: number) {
  return new Date(Date.now() + h * 3600_000).toISOString()
}

function seed(): Db {
  const merchants: Merchant[] = [
    {
      id: 'm_1',
      name: 'Example Bakery',
      category: 'bakery',
      address: '123 College Ave, State College, PA',
      lat: 40.7934,
      lng: -77.86,
      phone: '+18145550100',
      closes_at: '18:00',
      plan_status: 'active',
      default_discount_pct: 50,
      menu_items: [
        { name: 'Croissant', price_cents: 400 },
        { name: 'Baguette', price_cents: 450 },
        { name: 'Blueberry muffin', price_cents: 350 },
        { name: 'Sourdough loaf', price_cents: 800 },
        { name: 'Cinnamon roll', price_cents: 425 },
      ],
    },
    {
      id: 'm_2',
      name: 'Allen Street Coffee',
      category: 'cafe',
      address: '110 S Allen St, State College, PA',
      lat: 40.7944,
      lng: -77.8616,
      phone: '+18145550101',
      closes_at: '20:00',
      plan_status: 'active',
      default_discount_pct: 40,
      menu_items: [
        { name: 'Bagel', price_cents: 250 },
        { name: 'Scone', price_cents: 375 },
        { name: 'Muffin', price_cents: 350 },
        { name: 'Cookie', price_cents: 275 },
      ],
    },
    {
      id: 'm_3',
      name: 'Beaver Ave Noodles',
      category: 'restaurant',
      address: '254 E Beaver Ave, State College, PA',
      lat: 40.7961,
      lng: -77.8568,
      phone: '+18145550102',
      closes_at: '21:00',
      plan_status: 'none',
    },
  ]
  const deal = (id: string, m: Merchant, rest: Partial<Deal>): Deal => ({
    id,
    merchant_id: m.id,
    merchant: { id: m.id, name: m.name, category: m.category, address: m.address, lat: m.lat, lng: m.lng },
    title: '',
    items: [],
    original_price_cents: 0,
    deal_price_cents: 0,
    kind: 'surplus',
    quantity_total: 1,
    quantity_left: 1,
    max_per_customer: 2,
    unsold_action: 'none',
    pickup_start: hoursFromNow(0),
    pickup_end: hoursFromNow(2),
    allergens: [],
    note: null,
    photo_url: null,
    status: 'live',
    created_at: new Date().toISOString(),
    ...rest,
  })
  const deals: Deal[] = [
    deal('d_1', merchants[0], {
      title: 'Croissants (2-pack)',
      items: [{ name: 'Butter croissant', qty: 2 }],
      original_price_cents: 800,
      deal_price_cents: 400,
      quantity_total: 3,
      quantity_left: 3,
      pickup_end: hoursFromNow(1),
      allergens: ['wheat', 'milk', 'egg'],
      note: 'Baked this morning.',
    }),
    deal('d_2', merchants[1], {
      title: 'Pastry box',
      items: [
        { name: 'Blueberry muffin', qty: 1 },
        { name: 'Cinnamon roll', qty: 1 },
        { name: 'Scone', qty: 1 },
      ],
      original_price_cents: 1100,
      deal_price_cents: 500,
      quantity_total: 4,
      quantity_left: 1,
      pickup_end: hoursFromNow(3),
      allergens: ['wheat', 'milk', 'egg', 'tree nuts'],
    }),
    deal('d_3', merchants[2], {
      title: 'Veggie lo mein bowl',
      items: [{ name: 'Lo mein, large', qty: 1 }],
      original_price_cents: 1300,
      deal_price_cents: 700,
      kind: 'timed',
      quantity_total: 6,
      quantity_left: 6,
      max_per_customer: 1,
      pickup_end: hoursFromNow(4),
      allergens: ['wheat', 'soy', 'sesame'],
      note: 'Slow hour special.',
    }),
  ]
  return { merchants, deals, reservations: [], seq: 10 }
}

// React Native has no localStorage, so keep the store in memory and mirror it
// to AsyncStorage so reservations survive an app reload.
let cached: Db | undefined

async function load(): Promise<Db> {
  if (cached) return cached
  try {
    const raw = await AsyncStorage.getItem(KEY)
    if (raw) return (cached = JSON.parse(raw) as Db)
  } catch {
    // corrupt or unavailable storage: fall through to a fresh seed
  }
  return (cached = seed())
}

function save(db: Db) {
  AsyncStorage.setItem(KEY, JSON.stringify(db)).catch(() => {
    // mock data just won't survive a reload
  })
}

const NO_SHOW_GRACE_MS = 15 * 60_000

// The real backend does these on a timer; here we catch up on every request.
function tick(db: Db) {
  const now = Date.now()
  for (const d of db.deals) {
    if ((d.status === 'live' || d.status === 'sold_out') && Date.parse(d.pickup_end) <= now) d.status = 'expired'
  }
  for (const r of db.reservations) {
    const deal = db.deals.find((d) => d.id === r.deal_id)!
    if (r.status === 'reserved' && Date.parse(deal.pickup_end) + NO_SHOW_GRACE_MS <= now) r.status = 'no_show'
  }
}

function notFound(what: string): never {
  throw new MockError(404, 'NOT_FOUND', `${what} not found`)
}

function invalid(message: string): never {
  throw new MockError(400, 'VALIDATION', message)
}

function withDeal(db: Db, r: Reservation): Reservation {
  return { ...r, deal: db.deals.find((d) => d.id === r.deal_id)! }
}

function sameDay(iso: string, date: string | null) {
  if (!date) return true
  const d = new Date(iso)
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return local === date
}

function newPickupCode(db: Db, merchantId: string) {
  const open = new Set(
    db.reservations
      .filter((r) => r.status === 'reserved' && withDeal(db, r).deal.merchant_id === merchantId)
      .map((r) => r.pickup_code),
  )
  for (;;) {
    const code = String(Math.floor(1000 + Math.random() * 9000))
    if (!open.has(code)) return code
  }
}

function blankDraft(db: Db, merchant: Merchant): Deal {
  const closes = new Date()
  const [h, m] = merchant.closes_at.split(':').map(Number)
  closes.setHours(h, m, 0, 0)
  if (closes.getTime() <= Date.now()) closes.setTime(Date.now() + 2 * 3600_000)
  const deal: Deal = {
    id: `d_${db.seq++}`,
    merchant_id: merchant.id,
    merchant: {
      id: merchant.id,
      name: merchant.name,
      category: merchant.category,
      address: merchant.address,
      lat: merchant.lat,
      lng: merchant.lng,
    },
    title: '',
    items: [],
    original_price_cents: null,
    deal_price_cents: null,
    kind: 'surplus',
    quantity_total: 1,
    quantity_left: 1,
    max_per_customer: 2,
    unsold_action: 'none',
    // now until closing, unless the merchant says otherwise
    pickup_start: new Date().toISOString(),
    pickup_end: closes.toISOString(),
    allergens: null,
    note: null,
    photo_url: null,
    status: 'draft',
    created_at: new Date().toISOString(),
  }
  db.deals.push(deal)
  return deal
}

// Crude stand-in for the listing assistant: one draft per "N things" in the text.
// Follows the same never-rules: no invented prices, no invented allergens.
function draftsFromText(db: Db, merchant: Merchant, text: string): Draft[] {
  const products = [...text.matchAll(/(\d+)\s+([a-z][a-z' -]*?)(?=\s*(?:,|\.|;|\band\b|\bclosing\b|\bfor\b|\bat\b|$))/gi)]
  return products.map(([, count, rawName]) => {
    const name = rawName.trim()
    const units = Number(count)
    const singular = name.toLowerCase().replace(/s$/, '')
    const onMenu = merchant.menu_items?.find((i) => i.name.toLowerCase().includes(singular))
    const deal = blankDraft(db, merchant)
    deal.title = name.charAt(0).toUpperCase() + name.slice(1)
    deal.items = [{ name: onMenu?.name ?? deal.title, qty: 1 }]
    deal.quantity_total = deal.quantity_left = units
    const missing = ['allergens']
    if (onMenu) {
      deal.original_price_cents = onMenu.price_cents
      deal.deal_price_cents = Math.round((onMenu.price_cents * (100 - (merchant.default_discount_pct ?? 50))) / 100)
    } else {
      missing.push('original_price_cents', 'deal_price_cents')
    }
    return {
      deal,
      missing_fields: missing,
      agent_notes: onMenu
        ? `Regular price from your menu (${onMenu.name}), less your default discount.`
        : 'Not on your menu and no price given, so the price is left for you to fill in.',
      estimate: {
        units,
        deal_price_cents: deal.deal_price_cents,
        assumed_sell_through: 0.6,
        expected_recovered_cents: Math.round(units * (deal.deal_price_cents ?? 0) * 0.6),
        if_discarded_cents: 0,
      },
    }
  })
}

// Once a deal is live the price and items are locked.
const EDITABLE_LIVE: (keyof Deal)[] = ['quantity_total', 'pickup_end', 'note']

const EDITABLE: (keyof Deal)[] = [
  'title',
  'items',
  'original_price_cents',
  'deal_price_cents',
  'kind',
  'quantity_total',
  'max_per_customer',
  'pickup_start',
  'pickup_end',
  'allergens',
  'note',
  'photo_url',
]

function route(db: Db, method: string, url: ReturnType<typeof parse>, body: any, merchantId: string | null): unknown {
  const path = url.pathname
  const q = url.searchParams
  let m: RegExpMatchArray | null

  if (method === 'GET' && path === '/deals') {
    const category = q.get('category')
    const deals = db.deals
      .filter((d) => (d.status === 'live' || d.status === 'sold_out') && (!category || d.merchant.category === category))
      .sort((a, b) => Date.parse(a.pickup_end) - Date.parse(b.pickup_end))
    return { deals }
  }

  if (method === 'POST' && path === '/reservations/redeem') {
    const mine = db.reservations.filter(
      (r) => r.pickup_code === body.pickup_code && withDeal(db, r).deal.merchant_id === merchantId,
    )
    const open = mine.find((r) => r.status === 'reserved')
    if (open) {
      open.status = 'picked_up'
      return withDeal(db, open)
    }
    if (mine.some((r) => r.status === 'picked_up')) {
      throw new MockError(409, 'CODE_ALREADY_USED', 'That code was already redeemed')
    }
    throw new MockError(404, 'CODE_INVALID', 'No open reservation with that code')
  }

  if (method === 'POST' && path === '/reservations') {
    const deal = db.deals.find((d) => d.id === body.deal_id) ?? notFound('Deal')
    if (deal.status === 'sold_out') throw new MockError(409, 'SOLD_OUT', 'This deal just sold out')
    if (deal.status !== 'live') throw new MockError(409, 'DEAL_NOT_LIVE', 'This deal is no longer available')
    if (!body.customer_name?.trim() || !body.customer_phone?.trim()) invalid('Name and phone are required')
    if (!(body.quantity >= 1)) invalid('Quantity must be at least 1')
    const theirs = db.reservations.filter((r) => r.customer_phone === body.customer_phone)
    if (theirs.filter((r) => r.status === 'no_show').length >= 2) {
      invalid('Reservations are blocked for this number after two missed pickups')
    }
    const held = theirs
      .filter((r) => r.deal_id === deal.id && (r.status === 'reserved' || r.status === 'picked_up'))
      .reduce((n, r) => n + r.quantity, 0)
    if (held + body.quantity > deal.max_per_customer) invalid(`Limit ${deal.max_per_customer} per customer`)
    if (body.quantity > deal.quantity_left) throw new MockError(409, 'SOLD_OUT', 'Not enough left')
    deal.quantity_left -= body.quantity
    if (deal.quantity_left === 0) deal.status = 'sold_out'
    const r: Reservation = {
      id: `r_${db.seq++}`,
      deal_id: deal.id,
      deal,
      quantity: body.quantity,
      customer_name: body.customer_name.trim(),
      customer_phone: body.customer_phone,
      total_cents: body.quantity * (deal.deal_price_cents ?? 0),
      payment_method: 'in_store',
      pickup_code: newPickupCode(db, deal.merchant_id),
      status: 'reserved',
      created_at: new Date().toISOString(),
    }
    db.reservations.push(r)
    return withDeal(db, r)
  }

  if (method === 'GET' && path === '/reservations') {
    const phone = q.get('phone')
    return { reservations: db.reservations.filter((r) => r.customer_phone === phone).map((r) => withDeal(db, r)) }
  }

  if ((m = path.match(/^\/reservations\/([^/]+)(\/cancel|\/confirm-pickup)?$/))) {
    const r = db.reservations.find((x) => x.id === m![1]) ?? notFound('Reservation')
    const deal = db.deals.find((d) => d.id === r.deal_id)!
    if (method === 'POST' && m[2] === '/cancel') {
      if (r.status !== 'reserved') invalid('Only open reservations can be cancelled')
      if (Date.parse(deal.pickup_end) <= Date.now()) invalid('The pickup window has ended')
      r.status = 'cancelled'
      deal.quantity_left += r.quantity
      if (deal.status === 'sold_out') deal.status = 'live'
    } else if (method === 'POST' && m[2] === '/confirm-pickup') {
      if (r.status !== 'reserved') invalid('This reservation is not open')
      const now = Date.now()
      if (now < Date.parse(deal.pickup_start) || now > Date.parse(deal.pickup_end)) {
        invalid('Pickup can only be confirmed during the pickup window')
      }
      r.status = 'picked_up'
    }
    return withDeal(db, r)
  }

  if (method === 'POST' && path === '/follows') return { ok: true }

  if (method === 'GET' && path === '/billing/links') {
    return { pricing_url: 'https://example.com/pricing', portal_url: 'https://example.com/billing' }
  }

  if (method === 'POST' && path === '/merchants') {
    if (!body.name?.trim() || !body.address?.trim()) invalid('Name and address are required')
    const merchant: Merchant = {
      id: `m_${db.seq++}`,
      name: body.name.trim(),
      category: body.category,
      address: body.address.trim(),
      lat: 40.7934,
      lng: -77.86,
      phone: body.phone,
      closes_at: body.closes_at,
      plan_status: 'active',
      default_discount_pct: body.default_discount_pct,
      menu_items: body.menu_items ?? [],
    }
    db.merchants.push(merchant)
    return merchant
  }

  if ((m = path.match(/^\/merchants\/([^/]+)(\/drafts|\/deals|\/reservations|\/summary)?$/))) {
    const merchant = db.merchants.find((x) => x.id === m![1]) ?? notFound('Merchant')
    const date = q.get('date')
    const deals = db.deals.filter((d) => d.merchant_id === merchant.id && sameDay(d.pickup_end, date))
    const reservations = db.reservations
      .map((r) => withDeal(db, r))
      .filter((r) => r.deal.merchant_id === merchant.id && sameDay(r.created_at, date))
    if (!m[2]) return merchant
    if (m[2] === '/drafts') {
      if (!body.text && !body.photo_base64) invalid('Send text or a photo')
      // a photo alone can't be read by the mock: no drafts, so the portal shows the manual form
      return { drafts: draftsFromText(db, merchant, body.text ?? '') }
    }
    if (m[2] === '/deals' && method === 'POST') return blankDraft(db, merchant)
    if (m[2] === '/deals') return { deals }
    if (m[2] === '/reservations') return { reservations }
    const listed = deals.filter((d) => d.status !== 'draft' && d.status !== 'cancelled')
    const picked = reservations.filter((r) => r.status === 'picked_up')
    const recovered = picked.reduce((n, r) => n + r.total_cents, 0)
    const summary: Summary = {
      date: date ?? new Date().toISOString().slice(0, 10),
      units_listed: listed.reduce((n, d) => n + d.quantity_total, 0),
      units_picked_up: picked.reduce((n, r) => n + r.quantity, 0),
      units_unsold: listed.reduce((n, d) => n + d.quantity_left, 0),
      recovered_cents: recovered,
      platform_fee_cents: Math.round(recovered * 0.15), // placeholder rate, real one comes from backend
      if_discarded_cents: 0,
    }
    return summary
  }

  if ((m = path.match(/^\/deals\/([^/]+)(\/publish|\/cancel|\/mark-donated)?$/))) {
    const deal = db.deals.find((d) => d.id === m![1]) ?? notFound('Deal')
    if (method === 'GET') return deal
    if (method === 'PATCH') {
      if (deal.status !== 'draft' && deal.status !== 'live' && deal.status !== 'sold_out') {
        invalid('This deal can no longer be edited')
      }
      const allowed = deal.status === 'draft' ? EDITABLE : EDITABLE_LIVE
      const sold = deal.quantity_total - deal.quantity_left
      Object.assign(deal, Object.fromEntries(allowed.filter((k) => k in body).map((k) => [k, body[k]])))
      if (deal.quantity_total < sold) invalid(`${sold} already reserved, quantity can't go below that`)
      deal.quantity_left = deal.quantity_total - sold
      if (deal.status !== 'draft') deal.status = deal.quantity_left === 0 ? 'sold_out' : 'live'
      return deal
    }
    if (m[2] === '/publish') {
      if (deal.status !== 'draft') invalid('Only drafts can be published')
      if (deal.allergens === null) invalid('Allergens must be answered before publishing')
      if (deal.deal_price_cents === null || deal.original_price_cents === null) invalid('Both prices are required')
      if (deal.deal_price_cents >= deal.original_price_cents) invalid('Deal price must be below the original price')
      if (deal.quantity_total < 1) invalid('Quantity must be at least 1')
      if (Date.parse(deal.pickup_end) <= Date.now()) invalid('Pickup must end in the future')
      if (Date.parse(deal.pickup_end) <= Date.parse(deal.pickup_start)) invalid('Pickup must end after it starts')
      const merchant = db.merchants.find((x) => x.id === deal.merchant_id)!
      if (merchant.plan_status !== 'active') {
        throw new MockError(402, 'PLAN_REQUIRED', 'Choose a plan before publishing')
      }
      deal.status = 'live'
      return deal
    }
    if (m[2] === '/cancel') {
      if (deal.status !== 'draft' && deal.status !== 'live') invalid('This deal cannot be cancelled')
      deal.status = 'cancelled'
      for (const r of db.reservations) {
        if (r.deal_id === deal.id && r.status === 'reserved') r.status = 'cancelled'
      }
      return deal
    }
    if (m[2] === '/mark-donated') {
      if (deal.status !== 'expired' || deal.quantity_left === 0) invalid('Only expired deals with units left')
      deal.unsold_action = 'donated'
      return deal
    }
  }

  return notFound('Route')
}

// Hermes' URL support is patchy, so split the path and query by hand.
function parse(pathAndQuery: string) {
  const [pathname, qs = ''] = pathAndQuery.split('?')
  const params = new Map(
    qs
      .split('&')
      .filter(Boolean)
      .map((pair) => pair.split('=').map(decodeURIComponent) as [string, string]),
  )
  return { pathname, searchParams: { get: (k: string) => params.get(k) ?? null } }
}

export async function mockRequest(method: string, pathAndQuery: string, body: unknown, merchantId: string | null) {
  const url = parse(pathAndQuery)
  await new Promise((r) => setTimeout(r, url.pathname.endsWith('/drafts') ? 2000 : 250))
  const db = await load()
  tick(db)
  try {
    // clone so callers can't mutate the store through a returned object
    return JSON.parse(JSON.stringify(route(db, method, url, body ?? {}, merchantId)))
  } finally {
    save(db)
  }
}
