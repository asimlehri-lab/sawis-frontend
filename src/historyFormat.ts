import { formatMoney } from "./api";
import type { HistoryEvent } from "./api";

// Wording and number formatting for the History timelines (Items and
// Recipes read their events the same way).

const MINUS = "−";

export function fmtPrice(value: string, currency?: string | null): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  // Prices per gram/ml are tiny, so keep up to 4 decimals but never show
  // a trailing zero past the usual 2 (5.5000 -> 5.50, 0.0123 -> 0.0123).
  const decimals = n.toFixed(4).replace(/0+$/, "").split(".")[1]?.length ?? 0;
  return formatMoney(n, currency, Math.max(2, decimals));
}

/** A cost per portion: always pence, however many decimals the server keeps. */
export function fmtMoney2(value: string | number, currency?: string | null): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return formatMoney(n, currency, 2);
}

export function fmtQty(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString("en-GB", { maximumFractionDigits: 3 });
}

function fmtSigned(value: string, unit: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  const body = Math.abs(n).toLocaleString("en-GB", { maximumFractionDigits: 3 });
  return `${n < 0 ? MINUS : "+"}${body} ${unit}`.trim();
}

/** "£5.00 → £6.00 per kg", "+2 kg", "Milk → Milk, Egg"; null when the title says it all. */
export function changeText(e: HistoryEvent, currency?: string | null): string | null {
  if (e.kind === "stock") return fmtSigned(e.new_value, e.unit);
  if (e.action === "created") return null;
  if (e.kind === "auto") return `${fmtMoney2(e.old_value, currency)} → ${fmtMoney2(e.new_value, currency)} per portion`;
  // An import replaces a recipe's lines wholesale; the server writes the summary.
  if (e.field === "Ingredients") return e.new_value;
  if (e.field === "Amount") return `${e.context}: ${e.old_value} → ${e.new_value}`;
  const none = "none";
  let from: string;
  let to: string;
  switch (e.value_type) {
    case "money":
      from = e.old_value ? fmtPrice(e.old_value, currency) : none;
      to = e.new_value ? fmtPrice(e.new_value, currency) : none;
      break;
    case "percent":
      from = e.old_value ? `${e.old_value}%` : none;
      to = e.new_value ? `${e.new_value}%` : none;
      break;
    case "qty":
      from = e.old_value ? fmtQty(e.old_value) : none;
      to = e.new_value ? fmtQty(e.new_value) : none;
      break;
    default:
      from = e.old_value || none;
      to = e.new_value || none;
  }
  const unit = e.unit ? ` ${e.unit}` : "";
  if (e.action === "added") return `${to}${unit}`;
  if (e.action === "removed") return `${from}${unit}`;
  return `${from} → ${to}${unit}`;
}

const STOCK_WORDS: Record<string, { verb: string; plain: string }> = {
  purchase: { verb: "received a delivery", plain: "Delivery received" },
  waste: { verb: "logged waste", plain: "Waste logged" },
  count_adjust: { verb: "adjusted the count", plain: "Count adjusted" },
  transfer: { verb: "moved stock", plain: "Stock moved" },
  po_reopen: { verb: "reversed a delivery", plain: "Delivery reversed" },
};

const FIELD_WORDS: Record<string, string> = {
  SKU: "SKU",
  "VAT rate": "VAT rate",
  "POS ID": "POS ID",
  Contains: "allergens it contains",
  "May contain": "may-contain allergens",
};

/** `verb` reads after a name ("Maria changed…"); `plain` stands alone when nobody is recorded. */
export function describe(e: HistoryEvent): { verb: string; plain: string } {
  if (e.kind === "stock") {
    const words = STOCK_WORDS[e.action] ?? { verb: e.field.toLowerCase(), plain: e.field };
    // A delivery names who it came from, in the sentence itself so a long
    // supplier name wraps like any other text instead of crowding the tags.
    const from = e.meta?.supplier;
    return from && (e.action === "purchase" || e.action === "po_reopen")
      ? { verb: `${words.verb} from ${from}`, plain: `${words.plain} from ${from}` }
      : words;
  }
  if (e.field === "Item" && e.action === "created") return { verb: "created this item", plain: "Item created" };
  if (e.field === "Recipe" && e.action === "created") return { verb: "created this recipe", plain: "Recipe created" };
  if (e.field === "Ingredient") {
    if (e.action === "added") return { verb: "added an ingredient", plain: "Ingredient added" };
    if (e.action === "removed") return { verb: "removed an ingredient", plain: "Ingredient removed" };
    return { verb: "swapped an ingredient", plain: "Ingredient swapped" };
  }
  if (e.field === "Amount") return { verb: "changed an amount", plain: "Amount changed" };
  if (e.field === "Ingredients") return { verb: "updated the ingredients", plain: "Ingredients updated" };
  if (e.field === "Price") {
    if (e.action === "added")
      return { verb: `linked ${e.context} as a supplier`, plain: `${e.context} linked as a supplier` };
    if (e.action === "removed")
      return { verb: `removed ${e.context} as a supplier`, plain: `${e.context} removed as a supplier` };
    return { verb: `changed the ${e.context} price`, plain: `${e.context} price changed` };
  }
  if (e.field === "Held in") {
    return e.action === "added"
      ? { verb: "started holding it", plain: "Started being held" }
      : { verb: "stopped holding it", plain: "Stopped being held" };
  }
  if (e.field === "Status") {
    return e.new_value === "Archived"
      ? { verb: "archived it", plain: "Archived" }
      : { verb: "restored it", plain: "Restored" };
  }
  if (e.field === "Category") return { verb: "moved it to another category", plain: "Moved to another category" };
  const word = FIELD_WORDS[e.field] ?? e.field.toLowerCase();
  return { verb: `changed the ${word}`, plain: `${e.field} changed` };
}

export type DotTone = "up" | "down" | "stock" | "details" | "auto" | "ingredients" | "price";

export function dotTone(e: HistoryEvent): DotTone {
  if (e.kind === "stock") return "stock";
  if (e.kind === "auto") return "auto";
  if (e.kind === "ingredients") return "ingredients";
  if (e.kind === "price") return "price";
  if (e.kind === "cost") {
    if (e.delta_pct !== null) return e.delta_pct > 0 ? "up" : "down";
    if (e.action === "removed") return "down";
    return "up";
  }
  return "details";
}

function num(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** What a recipe change did to cost per portion, for the pill and the second line. */
export function costEffect(
  e: HistoryEvent,
  currency?: string | null
): { pill: string | null; tone: "caution" | "good"; line: string | null } | null {
  const meta = e.meta ?? {};
  if (e.field === "Menu price" && meta.fc_before !== undefined && meta.fc_after !== undefined) {
    const a = num(meta.fc_before);
    const b = num(meta.fc_after);
    if (a === null || b === null) return null;
    return { pill: `Food cost ${a.toFixed(1)}% → ${b.toFixed(1)}%`, tone: b <= a ? "good" : "caution", line: null };
  }
  const before = e.kind === "auto" ? num(e.old_value) : num(meta.cost_before);
  const after = e.kind === "auto" ? num(e.new_value) : num(meta.cost_after);
  if (before === null || after === null) return null;
  const delta = after - before;
  const pill =
    Math.abs(delta) < 0.005 ? null : `${delta > 0 ? "+" : MINUS}${fmtMoney2(Math.abs(delta), currency)}`;
  return {
    pill,
    tone: delta > 0 ? "caution" : "good",
    line: e.kind === "auto" ? null : `Cost ${fmtMoney2(before, currency)} → ${fmtMoney2(after, currency)} per portion`,
  };
}

/** Under an item's price line: how many recipes the move reaches and the biggest swing per portion. */
export function priceReach(e: HistoryEvent, currency?: string | null): string | null {
  const meta = e.meta ?? {};
  const n = num(meta.recipes);
  const delta = num(meta.recipe_delta);
  if (!n || delta === null || !meta.recipe_name) return null;
  const amount = `${fmtMoney2(Math.abs(delta), currency)} ${delta > 0 ? "more" : "less"} per portion`;
  return n === 1
    ? `Used in 1 recipe: ${meta.recipe_name} costs ${amount}`
    : `Used in ${n} recipes: ${meta.recipe_name} moves most, ${amount}`;
}

/** The headline for an Automatic entry, e.g. "Oat Milk price went up, so it costs more". */
export function autoHeadline(e: HistoryEvent): string {
  const meta = e.meta ?? {};
  const name = meta.name ?? e.context;
  const before = num(e.old_value);
  const after = num(e.new_value);
  const more = before !== null && after !== null && after > before;
  if (meta.cause === "recipe") return `${name} costs ${more ? "more" : "less"} per portion, so this does too`;
  const pa = num(meta.old_price);
  const pb = num(meta.new_price);
  const went = pa !== null && pb !== null && pb > pa ? "up" : "down";
  return `${name} price went ${went}, so it costs ${more ? "more" : "less"}`;
}

/** The detail line under an Automatic entry: which price moved, and who moved it. */
export function autoCause(e: HistoryEvent, currency?: string | null): string | null {
  const meta = e.meta ?? {};
  if (!meta.old_price || !meta.new_price) return null;
  const name = meta.name ?? e.context;
  const unit = meta.price_unit ? ` ${meta.price_unit}` : "";
  const by = meta.by ? `, changed by ${meta.by}${meta.cause === "recipe" ? " in the recipe" : " on the item"}` : "";
  return `${name} ${fmtPrice(meta.old_price, currency)} → ${fmtPrice(meta.new_price, currency)}${unit}${by}`;
}

export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
