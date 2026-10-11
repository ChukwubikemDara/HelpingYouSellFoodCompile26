/**
 * "fake" provider: a small deterministic rule-based extractor for local dev
 * and the e2e script. It is not the agent and is never the default in
 * production (see config.ts).
 *
 * It reads short English messages such as "6 croissants, 3 baguettes,
 * closing at 6": numbers (digits, number words, "a dozen"), boxes/packs
 * ("2 boxes of donuts, 6 per box"), "$3" (deal price) and "usually $5.50"
 * (regular price), "half off" / "30% off", "contains sesame and wheat",
 * time ranges ("3pm-5pm") and end times ("closing at 6", "until 7pm").
 * It cannot see photos: a photo with no text gives no products.
 */
import { EXTRACT_LIMITS, type ExtractInput, type ExtractModel, type ExtractOutput, type ExtractedProduct } from "./types";

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
};

const NUMBER = `(?:\\d+|${Object.keys(NUMBER_WORDS).join("|")})`;

const FILLER = new Set([
  "about",
  "around",
  "roughly",
  "approx",
  "approximately",
  "got",
  "have",
  "has",
  "we",
  "i",
  "we've",
  "i've",
  "there",
  "are",
  "is",
  "all",
  "the",
  "some",
  "our",
  "my",
  "leftover",
  "leftovers",
  "extra",
  "fresh",
  "free",
  "today",
  "tonight",
  "left",
  "remaining",
  "each",
  "at",
  "for",
  "of",
  "only",
  "just",
  "list",
  "a",
  "an",
]);

const UNIT_WORDS = new Set([
  "slice",
  "slices",
  "piece",
  "pieces",
  "cup",
  "cups",
  "bowl",
  "bowls",
  "loaf",
  "loaves",
  "bottle",
  "bottles",
]);

const CONTAINER_WORDS = new Set(["box", "boxes", "pack", "packs", "bag", "bags", "tray", "trays", "dozen", "dozens"]);

function toNumber(token: string): number | null {
  if (/^\d+$/.test(token)) return Number(token);
  return NUMBER_WORDS[token] ?? null;
}

/** "croissants" -> "croissant", "loaves" -> "loaf", "boxes" -> "box". Last word only. */
export function singularize(phrase: string): string {
  const words = phrase.split(" ");
  const last = words[words.length - 1];
  let single = last;
  if (/ves$/.test(last) && last.length > 4) single = last.replace(/ves$/, "f");
  else if (/ies$/.test(last) && last.length > 4) single = last.replace(/ies$/, "y");
  else if (/(ches|shes|xes|sses)$/.test(last)) single = last.replace(/es$/, "");
  else if (/s$/.test(last) && !/ss$/.test(last) && last.length > 3) single = last.replace(/s$/, "");
  words[words.length - 1] = single;
  return words.join(" ");
}

function cents(amount: string): number {
  return Math.round(Number(amount) * 100);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** A clock time as 24h HH:MM. Without am/pm, the next occurrence after `nowLocal`. */
export function resolveClock(hour: number, minute: number, meridiem: string | undefined, nowLocal: string): string | null {
  if (minute > 59 || hour > 23) return null;
  if (meridiem === "pm" || meridiem === "p.m.") return hour > 12 ? null : `${pad((hour % 12) + 12)}:${pad(minute)}`;
  if (meridiem === "am" || meridiem === "a.m.") return hour > 12 ? null : `${pad(hour % 12)}:${pad(minute)}`;
  if (hour >= 13 || hour === 0) return `${pad(hour)}:${pad(minute)}`;
  const now = minutesOf(nowLocal);
  const candidates = [hour % 12, (hour % 12) + 12].map((h) => h * 60 + minute);
  const next = candidates.find((value) => value > now) ?? candidates[0];
  return `${pad(Math.floor(next / 60))}:${pad(next % 60)}`;
}

interface Draft {
  name: string;
  quantity: number | null;
  unit_size: number;
  original_price_cents: number | null;
  deal_price_cents: number | null;
  discount_pct: number | null;
  allergens: string[] | null;
}

const TIME = `(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)?`;

/** Parse a message into the extract output shape. Deterministic. */
export function fakeExtract(input: Pick<ExtractInput, "text" | "now_local" | "menu_item_names">): ExtractOutput {
  if (input.text === null) return { products: [], pickup_start: null, pickup_end: null };
  let text = ` ${input.text.toLowerCase().replace(/[–—]/g, "-")} `;
  let pickupStart: string | null = null;
  let pickupEnd: string | null = null;

  // Time range: needs am/pm on at least one side ("3pm-5pm", "3-5pm").
  const range = new RegExp(`\\b${TIME}\\s*(?:-|to)\\s*${TIME}`).exec(text);
  if (range && (range[3] || range[6])) {
    const startMeridiem = range[3] ?? range[6];
    pickupStart = resolveClock(Number(range[1]), Number(range[2] ?? 0), startMeridiem, input.now_local);
    pickupEnd = resolveClock(Number(range[4]), Number(range[5] ?? 0), range[6] ?? range[3], input.now_local);
    text = text.replace(range[0], " ");
  }
  if (pickupEnd === null) {
    const end = new RegExp(`\\b(?:closing|close|closes|until|till|til|by|ends?)\\s+(?:at\\s+)?${TIME}`).exec(text);
    if (end) {
      pickupEnd = resolveClock(Number(end[1]), Number(end[2] ?? 0), end[3], input.now_local);
      text = text.replace(end[0], " ");
    }
  }
  if (pickupStart === null) {
    const start = new RegExp(`\\b(?:from|starting(?:\\s+at)?|after)\\s+${TIME}`).exec(text);
    if (start) {
      pickupStart = resolveClock(Number(start[1]), Number(start[2] ?? 0), start[3], input.now_local);
      text = text.replace(start[0], " ");
    }
  }

  // Allergen clauses become markers so they attach to the product before them.
  const allergenLists: string[][] = [];
  text = text.replace(/\bcontains?\s+([^.;\n]+)/g, (_, list: string) => {
    const items = list
      .split(/,|\band\b|&/)
      .map((item) => item.trim())
      .filter((item) => item !== "");
    allergenLists.push(items);
    return ` , __allergens${allergenLists.length - 1}__ , `;
  });

  const products: Draft[] = [];
  const segments = text.split(/[,;\n]|\band\b(?=\s+\d)|\bplus\b/);
  for (const raw of segments) {
    let segment = ` ${raw.trim().replace(/^[:\-.\s]+/, "")} `;
    if (segment.trim() === "") continue;
    const previous = products[products.length - 1];

    const marker = /__allergens(\d+)__/.exec(segment);
    if (marker) {
      if (previous) previous.allergens = allergenLists[Number(marker[1])];
      continue;
    }
    if (/\b(nothing|none|no deals?|sold out)\b/.test(segment) && !/\d/.test(segment)) continue;

    let original: number | null = null;
    let deal: number | null = null;
    segment = segment.replace(
      /\b(usually|normally|regularly|regular|reg\.?|was|originally)\s+\$\s*(\d+(?:\.\d{1,2})?)/g,
      (_, __, amount: string) => {
        original = cents(amount);
        return " ";
      },
    );
    segment = segment.replace(/\$\s*(\d+(?:\.\d{1,2})?)(\s*(each|ea|apiece|a piece))?/g, (_, amount: string) => {
      deal = cents(amount);
      return " ";
    });

    let discount: number | null = null;
    segment = segment.replace(/\bhalf\s+(off|price)\b/g, () => {
      discount = 50;
      return " ";
    });
    segment = segment.replace(/\b(\d{1,2})\s*%\s*off\b/g, (_, pct: string) => {
      discount = Number(pct);
      return " ";
    });

    let unitSize: number | null = null;
    segment = segment.replace(new RegExp(`\\b(${NUMBER})\\s+(?:per|in each|in a|a)\\s+(?:box|pack|bag|tray)\\b`, "g"), (_, n: string) => {
      unitSize = toNumber(n);
      return " ";
    });

    let quantity: number | null = null;
    let nameWords: string[] = [];
    const words = segment.trim().split(/\s+/).filter((w) => w !== "");
    const halfDozen = segment.match(/\bhalf\s+(?:a\s+)?dozen\b/);
    const aDozen = segment.match(/\b(?:a\s+)?dozen\b/);
    const numberIndex = words.findIndex((w) => toNumber(w) !== null);
    if (numberIndex >= 0) {
      quantity = toNumber(words[numberIndex]);
      const after = words.slice(numberIndex + 1);
      // "2 boxes of donuts": the container is the sale unit.
      if (after.length > 0 && CONTAINER_WORDS.has(after[0])) {
        if (after[0].startsWith("dozen")) unitSize = unitSize ?? 12;
        after.shift();
        if (after[0] === "of") after.shift();
        const inner = after.length > 0 ? toNumber(after[0]) : null;
        if (inner !== null) {
          unitSize = inner;
          after.shift();
        }
      }
      nameWords = after.length > 0 ? after : words.slice(0, numberIndex);
    } else if (halfDozen) {
      quantity = 6;
      nameWords = segment.replace(halfDozen[0], " ").trim().split(/\s+/);
    } else if (aDozen) {
      quantity = 12;
      nameWords = segment.replace(aDozen[0], " ").trim().split(/\s+/);
    } else {
      nameWords = words;
    }

    // "slices of pepperoni pizza" -> "pepperoni pizza slice".
    let unitWord: string | null = null;
    if (nameWords.length > 2 && UNIT_WORDS.has(nameWords[0]) && nameWords[1] === "of") {
      unitWord = singularize(nameWords[0]);
      nameWords = nameWords.slice(2);
    }
    let name = nameWords
      .map((w) => w.replace(/[^a-z0-9'&-]/g, ""))
      .filter((w) => w !== "" && !FILLER.has(w))
      .join(" ");
    if (name !== "") name = singularize(name);
    if (name !== "" && unitWord) name = `${name} ${unitWord}`;

    if (name === "") {
      // Details about the product before ("got about a dozen", "normally $12", "6 per box").
      if (previous) {
        if (quantity !== null && previous.quantity === null) previous.quantity = quantity;
        if (original !== null) previous.original_price_cents = original;
        if (deal !== null) previous.deal_price_cents = deal;
        if (discount !== null) previous.discount_pct = discount;
        if (unitSize !== null) previous.unit_size = unitSize;
      }
      continue;
    }

    const menuName = input.menu_item_names.find((item) => singularize(item.toLowerCase().trim()) === name);
    products.push({
      name: menuName ?? name,
      quantity: quantity !== null && quantity >= 1 ? quantity : null,
      unit_size: unitSize ?? 1,
      original_price_cents: original,
      deal_price_cents: deal,
      discount_pct: discount,
      allergens: null,
    });
  }

  const out: ExtractedProduct[] = products.slice(0, EXTRACT_LIMITS.maxProducts);
  return { products: out, pickup_start: pickupStart, pickup_end: pickupEnd };
}

export function createFakeModel(): ExtractModel {
  return {
    provider: "fake",
    modelId: null,
    async call(input) {
      const output = fakeExtract(input);
      return { toolInput: output, text: null, stopReason: "tool_use", message: null };
    },
  };
}
