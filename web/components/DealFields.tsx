"use client";

/** The editable deal fields, shared by draft review and the manual listing form. */
import { AllergenField } from "@/components/AllergenField";
import { endsNextDay, type DealForm, type DealFormErrors, type DealFormField } from "@/lib/client/deal-form";
import { centsToInput, formatCents, parseCents } from "@/lib/client/format";
import { RULES } from "@/lib/contract";

/** The merchant's default discount applied to a regular price, as the listing agent does it. */
function defaultDealPrice(originalCents: number, pct: number): number | null {
  const step = RULES.PRICE_STEP_CENTS;
  let price = Math.floor((originalCents * (100 - pct)) / 100 / step) * step;
  if (price >= originalCents) price = originalCents - step;
  return price > 0 ? price : null;
}

function percentOff(original: number | null, price: number | null): string | null {
  if (original === null || price === null || Number.isNaN(original) || Number.isNaN(price)) return null;
  if (original <= 0 || price >= original) return null;
  return `${Math.round(((original - price) / original) * 100)}% off`;
}

export function DealFields({
  form,
  onChange,
  errors,
  highlightMissing,
  showUnitSize,
  defaultDiscountPct,
  readOnlyTitle,
}: {
  form: DealForm;
  onChange: (patch: Partial<DealForm>) => void;
  errors: DealFormErrors;
  /** Draft review: empty contract fields get the accent background. */
  highlightMissing: boolean;
  showUnitSize: boolean;
  defaultDiscountPct: number;
  readOnlyTitle?: boolean;
}) {
  const isEmpty = (f: DealFormField) => {
    const v = form[f];
    return v === null || (typeof v === "string" && v.trim() === "");
  };
  const cls = (f: DealFormField) => (highlightMissing && isEmpty(f) ? "missing" : undefined);
  const err = (f: DealFormField) => (errors[f] ? <span className="field-error">{errors[f]}</span> : null);
  const invalid = (f: DealFormField) => (errors[f] ? true : undefined);

  const original = parseCents(form.original);
  const price = parseCents(form.price);
  const off = percentOff(original, price);
  const suggested =
    form.price.trim() === "" && original !== null && !Number.isNaN(original) && original > 0
      ? defaultDealPrice(original, defaultDiscountPct)
      : null;

  return (
    <div className="stack">
      {!readOnlyTitle && (
        <label className="field">
          <span className="label">Title</span>
          <input
            className="input"
            value={form.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Croissants (2-pack)"
            aria-invalid={invalid("title")}
          />
          {err("title")}
        </label>
      )}

      {showUnitSize && (
        <label className="field">
          <span className="label">Items in one unit</span>
          <input
            className="input"
            inputMode="numeric"
            pattern="[0-9]*"
            value={form.unitSize}
            onChange={(e) => onChange({ unitSize: e.target.value })}
            aria-invalid={invalid("unitSize")}
          />
          <span className="hint">Use 1 unless you sell packs or boxes.</span>
          {err("unitSize")}
        </label>
      )}

      <div className="grid-2">
        <div className={cls("original")}>
          <label className="field">
            <span className="label">Regular price ($)</span>
            <input
              className="input"
              inputMode="decimal"
              placeholder="8.00"
              value={form.original}
              onChange={(e) => onChange({ original: e.target.value })}
              aria-invalid={invalid("original")}
            />
            {err("original")}
          </label>
        </div>
        <div className={cls("price")}>
          <label className="field">
            <span className="label">Deal price ($)</span>
            <input
              className="input"
              inputMode="decimal"
              placeholder="4.00"
              value={form.price}
              onChange={(e) => onChange({ price: e.target.value })}
              aria-invalid={invalid("price")}
            />
            {off && <span className="hint">{off}</span>}
            {err("price")}
          </label>
          {suggested !== null && (
            <button type="button" className="link link-accent" onClick={() => onChange({ price: centsToInput(suggested) })}>
              Use {defaultDiscountPct}% off: {formatCents(suggested)}
            </button>
          )}
        </div>
      </div>

      <div className="grid-2">
        <div className={cls("quantity")}>
          <label className="field">
            <span className="label">Quantity available</span>
            <input
              className="input"
              inputMode="numeric"
              pattern="[0-9]*"
              value={form.quantity}
              onChange={(e) => onChange({ quantity: e.target.value })}
              aria-invalid={invalid("quantity")}
            />
            {err("quantity")}
          </label>
        </div>
        <label className="field">
          <span className="label">Limit per person</span>
          <input
            className="input"
            inputMode="numeric"
            pattern="[0-9]*"
            value={form.maxPerCustomer}
            onChange={(e) => onChange({ maxPerCustomer: e.target.value })}
            aria-invalid={invalid("maxPerCustomer")}
          />
          {err("maxPerCustomer")}
        </label>
      </div>

      <div className="grid-2">
        <label className="field">
          <span className="label">Pickup from</span>
          <input
            className="input"
            type="time"
            step={300}
            value={form.start}
            onChange={(e) => onChange({ start: e.target.value })}
            aria-invalid={invalid("start")}
          />
          {err("start")}
        </label>
        <div className={cls("end")}>
          <label className="field">
            <span className="label">Pickup until</span>
            <input
              className="input"
              type="time"
              step={300}
              value={form.end}
              onChange={(e) => onChange({ end: e.target.value })}
              aria-invalid={invalid("end")}
            />
            {err("end")}
            {!errors.end && endsNextDay(form) && <span className="hint">Ends after midnight, on the next day.</span>}
          </label>
        </div>
      </div>

      <AllergenField
        value={form.allergens}
        onChange={(allergens) => onChange({ allergens })}
        error={errors.allergens}
        highlight={highlightMissing && form.allergens === null}
      />

      <label className="field">
        <span className="label">Note for customers (optional)</span>
        <textarea
          className="textarea"
          style={{ minHeight: 88 }}
          value={form.note}
          onChange={(e) => onChange({ note: e.target.value })}
          placeholder="Baked this morning."
        />
      </label>
    </div>
  );
}
