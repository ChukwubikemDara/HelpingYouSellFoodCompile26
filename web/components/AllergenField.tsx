"use client";

/**
 * "Allergens (you must confirm)". null = not answered (blocks publish),
 * [] = none, chosen explicitly with "None". The listing assistant never fills
 * this unless the merchant stated it.
 */
import { useId, useState } from "react";

/** The nine major US food allergens, as lowercase names like the contract example. */
export const COMMON_ALLERGENS = [
  { value: "milk", label: "Milk" },
  { value: "egg", label: "Egg" },
  { value: "wheat", label: "Wheat" },
  { value: "soy", label: "Soy" },
  { value: "peanut", label: "Peanuts" },
  { value: "tree nut", label: "Tree nuts" },
  { value: "fish", label: "Fish" },
  { value: "shellfish", label: "Shellfish" },
  { value: "sesame", label: "Sesame" },
] as const;

const COMMON = new Set<string>(COMMON_ALLERGENS.map((a) => a.value));

const norm = (s: string) => s.trim().toLowerCase();

function parseOther(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(",")) {
    const v = norm(part);
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

export function AllergenField({
  value,
  onChange,
  error,
  highlight,
}: {
  value: string[] | null;
  onChange: (next: string[] | null) => void;
  error?: string;
  /** Accent background while the merchant still has to answer. */
  highlight: boolean;
}) {
  const id = useId();
  const [otherText, setOtherText] = useState(() =>
    (value ?? []).filter((a) => !COMMON.has(norm(a))).join(", "),
  );
  const chosen = new Set((value ?? []).map(norm));
  const isNone = value !== null && value.length === 0;

  function emit(common: string[], other: string) {
    const list = [...common, ...parseOther(other).filter((o) => !common.includes(o))];
    onChange(list.length > 0 ? list : null);
  }

  function toggle(v: string, on: boolean) {
    const common = COMMON_ALLERGENS.map((a) => a.value as string).filter((c) => (c === v ? on : chosen.has(c)));
    emit(common, otherText);
  }

  const commonChosen = () => COMMON_ALLERGENS.map((a) => a.value as string).filter((c) => chosen.has(c));

  return (
    <fieldset className={highlight ? "allergens missing" : "allergens"} aria-describedby={error ? `${id}-err` : undefined}>
      <legend className="label">
        Allergens (you must confirm)
        {value === null && <span className="error"> · needs your answer</span>}
      </legend>
      <p className="fine muted">Only you can confirm this. Required before publishing.</p>
      <div className="chips">
        {COMMON_ALLERGENS.map((a) => {
          const on = chosen.has(a.value);
          return (
            <label key={a.value} className={on ? "chip chip-on" : "chip"}>
              <input type="checkbox" checked={on} onChange={(e) => toggle(a.value, e.target.checked)} />
              {a.label}
            </label>
          );
        })}
        <label className={isNone ? "chip chip-none chip-on" : "chip chip-none"}>
          <input
            type="checkbox"
            checked={isNone}
            onChange={(e) => {
              if (e.target.checked) {
                setOtherText("");
                onChange([]);
              } else {
                onChange(null);
              }
            }}
          />
          None
        </label>
      </div>
      <label className="field" style={{ marginTop: 12 }}>
        <span className="label">Other allergens</span>
        <input
          className="input"
          value={otherText}
          placeholder="Separate with commas"
          onChange={(e) => {
            setOtherText(e.target.value);
            emit(commonChosen(), e.target.value);
          }}
        />
      </label>
      {error && (
        <p id={`${id}-err`} className="error" style={{ marginTop: 4 }}>
          {error}
        </p>
      )}
    </fieldset>
  );
}
