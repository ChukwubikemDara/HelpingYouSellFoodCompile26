"use client";

/**
 * Store details form, used by onboarding (POST /api/merchants) and the store
 * page (PATCH /api/merchants/{id}): name, category, address, phone, closing
 * time, default discount and a short menu of regular items (about five).
 *
 * "Use my current location" sends lat/lng from the browser. Nothing else
 * locates the store (there is no geocoding), so without it the store has no
 * location: it does not show on the map and sorts last by distance. A save
 * without a new location keeps the one the store already has.
 */
import { useState } from "react";
import { InlineMessage } from "@/components/States";
import { errorMessage } from "@/lib/client/api";
import { centsToInput, formatPhone, parseCents, toE164 } from "@/lib/client/format";
import { isLocalTime } from "@/lib/clock";
import {
  MERCHANT_CATEGORIES,
  RULES,
  type CreateMerchantRequest,
  type MenuItem,
  type Merchant,
  type MerchantCategory,
} from "@/lib/contract";

const CATEGORY_LABEL: Record<MerchantCategory, string> = {
  bakery: "Bakery",
  cafe: "Cafe",
  restaurant: "Restaurant",
};

interface MenuRow {
  name: string;
  price: string;
}

type LocationState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "located"; lat: number; lng: number }
  | { status: "failed"; message: string };

type Errors = Partial<Record<"name" | "category" | "address" | "phone" | "closesAt" | "discount" | "menu", string>>;

const blankRows = (n: number): MenuRow[] => Array.from({ length: n }, () => ({ name: "", price: "" }));

const NO_LOCATION = "Without a location, your store is not on the map and sorts last by distance.";

function initialMenu(merchant: Merchant | null): MenuRow[] {
  if (!merchant) return blankRows(5);
  const rows = merchant.menu.map((item) => ({ name: item.name, price: centsToInput(item.price_cents) }));
  return rows.length >= 5 ? rows : [...rows, ...blankRows(5 - rows.length)];
}

export interface StoreFormProps {
  /** The store to edit, or null to create one. */
  initial: Merchant | null;
  submitLabel: string;
  busyLabel: string;
  /** Saves the body; throws to show the API's message. */
  onSave: (body: CreateMerchantRequest) => Promise<void>;
  /** Shown under the button after a save that stays on the page. */
  savedText?: string | null;
  /** Keep the button disabled after a successful save (the page navigates away). */
  leavesAfterSave?: boolean;
}

export function StoreForm({ initial, submitLabel, busyLabel, onSave, savedText, leavesAfterSave }: StoreFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState<MerchantCategory | "">(initial?.category ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [phone, setPhone] = useState(initial ? formatPhone(initial.phone) : "");
  const [closesAt, setClosesAt] = useState(initial?.closes_at ?? "");
  // Starting value only; the merchant changes it here and the price is still set per deal.
  const [discount, setDiscount] = useState(String(initial?.default_discount_pct ?? 50));
  const [menu, setMenu] = useState<MenuRow[]>(() => initialMenu(initial));
  const [location, setLocation] = useState<LocationState>({ status: "idle" });
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const hasSavedLocation = initial !== null && initial.lat !== null && initial.lng !== null;

  function locate() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocation({ status: "failed", message: `This browser cannot share your location. ${NO_LOCATION}` });
      return;
    }
    setLocation({ status: "locating" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({
          status: "located",
          lat: Math.round(pos.coords.latitude * 1e6) / 1e6,
          lng: Math.round(pos.coords.longitude * 1e6) / 1e6,
        });
      },
      (err) => {
        setLocation({
          status: "failed",
          message:
            err.code === err.PERMISSION_DENIED
              ? `Location is turned off for this site. ${NO_LOCATION} To add it, allow location in your browser settings and try again.`
              : `Could not get your location. ${NO_LOCATION} Try again at the store.`,
        });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }

  function updateRow(i: number, patch: Partial<MenuRow>) {
    setMenu((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function validate(): { errors: Errors; body: CreateMerchantRequest | null } {
    const e: Errors = {};
    if (!name.trim()) e.name = "Enter your store name.";
    if (!category) e.category = "Choose a category.";
    if (!address.trim()) e.address = "Enter your store address.";
    const e164 = toE164(phone);
    if (!e164) e.phone = "Enter a 10-digit US phone number.";
    if (!isLocalTime(closesAt)) e.closesAt = "Enter your closing time.";
    const pct = /^\d{1,2}$/.test(discount.trim()) ? Number(discount.trim()) : Number.NaN;
    if (Number.isNaN(pct) || pct < RULES.DEFAULT_DISCOUNT_PCT_MIN || pct > RULES.DEFAULT_DISCOUNT_PCT_MAX) {
      e.discount = `Use a whole number from ${RULES.DEFAULT_DISCOUNT_PCT_MIN} to ${RULES.DEFAULT_DISCOUNT_PCT_MAX}.`;
    }
    const items: MenuItem[] = [];
    for (const row of menu) {
      const itemName = row.name.trim();
      const cents = parseCents(row.price);
      if (!itemName && cents === null) continue;
      if (!itemName) {
        e.menu = "Enter a name for each menu price.";
        break;
      }
      if (cents === null) {
        e.menu = `Enter the regular price for ${itemName}.`;
        break;
      }
      if (Number.isNaN(cents) || cents <= 0) {
        e.menu = `Enter a price like 4.00 for ${itemName}.`;
        break;
      }
      items.push({ name: itemName, price_cents: cents });
    }
    if (Object.keys(e).length > 0) return { errors: e, body: null };
    const body: CreateMerchantRequest = {
      name: name.trim(),
      category: category as MerchantCategory,
      address: address.trim(),
      phone: e164 as string,
      closes_at: closesAt,
      default_discount_pct: pct,
      menu: items,
    };
    if (location.status === "located") {
      body.lat = location.lat;
      body.lng = location.lng;
    }
    return { errors: e, body };
  }

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (busy) return;
    const { errors: e, body } = validate();
    setErrors(e);
    if (!body) {
      setSubmitError("Fix the fields marked above, then save.");
      return;
    }
    setBusy(true);
    setSubmitError(null);
    try {
      await onSave(body);
    } catch (err) {
      setSubmitError(errorMessage(err));
      setBusy(false);
      return;
    }
    if (leavesAfterSave) return;
    if (location.status === "located") setLocation({ status: "idle" });
    setBusy(false);
  }

  let locationLine: React.ReactNode = null;
  if (location.status === "located") {
    locationLine = (
      <p className="fine muted" role="status">
        Location added. It saves with this form. Students nearby can sort by distance.
      </p>
    );
  } else if (location.status === "failed") {
    locationLine = (
      <p className="error" role="alert">
        {location.message}
      </p>
    );
  } else if (hasSavedLocation) {
    locationLine = <p className="fine muted">Your store has a location. If you moved, use your current location again at the store.</p>;
  } else if (initial !== null) {
    locationLine = <p className="fine muted">Your store has no location yet. {NO_LOCATION}</p>;
  }

  return (
    <form className="stack-lg" onSubmit={onSubmit} noValidate>
      <label className="field">
        <span className="label">Store name</span>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="organization"
          aria-invalid={errors.name ? true : undefined}
        />
        {errors.name && <span className="field-error">{errors.name}</span>}
      </label>

      <label className="field">
        <span className="label">Category</span>
        <select
          className="select"
          value={category}
          onChange={(e) => setCategory(e.target.value as MerchantCategory | "")}
          aria-invalid={errors.category ? true : undefined}
        >
          <option value="">Choose one</option>
          {MERCHANT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        {errors.category && <span className="field-error">{errors.category}</span>}
      </label>

      <div className="stack">
        <label className="field">
          <span className="label">Address</span>
          <input
            className="input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            autoComplete="street-address"
            placeholder="123 College Ave, State College, PA"
            aria-invalid={errors.address ? true : undefined}
          />
          {errors.address && <span className="field-error">{errors.address}</span>}
        </label>
        <div className="stack">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={locate}
            disabled={location.status === "locating"}
          >
            {location.status === "locating" ? "Finding your location…" : "Use my current location"}
          </button>
          {locationLine}
        </div>
      </div>

      <label className="field">
        <span className="label">Store phone</span>
        <input
          className="input"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="(814) 555-0100"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          aria-invalid={errors.phone ? true : undefined}
        />
        {errors.phone && <span className="field-error">{errors.phone}</span>}
      </label>

      <label className="field">
        <span className="label">Closing time</span>
        <input
          className="input"
          type="time"
          step={300}
          value={closesAt}
          onChange={(e) => setClosesAt(e.target.value)}
          aria-invalid={errors.closesAt ? true : undefined}
        />
        <span className="hint">Your usual closing time. Deals end then unless you set another time.</span>
        {errors.closesAt && <span className="field-error">{errors.closesAt}</span>}
      </label>

      <label className="field">
        <span className="label">Default discount (%)</span>
        <input
          className="input"
          inputMode="numeric"
          pattern="[0-9]*"
          value={discount}
          onChange={(e) => setDiscount(e.target.value)}
          aria-invalid={errors.discount ? true : undefined}
        />
        <span className="hint">
          From {RULES.DEFAULT_DISCOUNT_PCT_MIN} to {RULES.DEFAULT_DISCOUNT_PCT_MAX}. A starting point only: you set the
          price on each deal.
        </span>
        {errors.discount && <span className="field-error">{errors.discount}</span>}
      </label>

      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label">
          <h2>Regular menu</h2>
        </legend>
        <p className="muted">About five items you sell most days, with regular prices. We use them to suggest deal prices.</p>
        <div className="menu-row fine muted" aria-hidden="true">
          <span>Item</span>
          <span>Price ($)</span>
        </div>
        {menu.map((row, i) => (
          <div className="menu-row" key={i}>
            <input
              className="input"
              aria-label={`Menu item ${i + 1} name`}
              placeholder={i === 0 ? "Butter croissant" : ""}
              value={row.name}
              onChange={(e) => updateRow(i, { name: e.target.value })}
            />
            <input
              className="input"
              aria-label={`Menu item ${i + 1} regular price in dollars`}
              inputMode="decimal"
              placeholder={i === 0 ? "4.00" : ""}
              value={row.price}
              onChange={(e) => updateRow(i, { price: e.target.value })}
            />
          </div>
        ))}
        <button type="button" className="link" onClick={() => setMenu((rows) => [...rows, ...blankRows(1)])}>
          Add another item
        </button>
        {errors.menu && <p className="error">{errors.menu}</p>}
      </fieldset>

      <div className="stack">
        <InlineMessage error text={submitError} />
        {!submitError && <InlineMessage text={busy ? null : (savedText ?? null)} />}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? busyLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}
