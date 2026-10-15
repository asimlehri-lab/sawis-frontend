import { formatMoney } from "./api";
import type { HistoryEvent } from "./api";

// Wording and number formatting for the History timeline. Kept apart from
// the component so the Recipe history (next) reads its events the same way.

const MINUS = "−";

export function fmtPrice(value: string, currency?: string | null): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  // Prices per gram/ml are tiny, so keep up to 4 decimals but never show
  // a trailing zero past the usual 2 (5.5000 -> 5.50, 0.0123 -> 0.0123).
  const decimals = n.toFixed(4).replace(/0+$/, "").split(".")[1]?.length ?? 0;
  return formatMoney(n, currency, Math.max(2, decimals));
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
  Contains: "allergens it contains",
  "May contain": "may-contain allergens",
};

/** `verb` reads after a name ("Maria changed…"); `plain` stands alone when nobody is recorded. */
export function describe(e: HistoryEvent): { verb: string; plain: string } {
  if (e.kind === "stock") return STOCK_WORDS[e.action] ?? { verb: e.field.toLowerCase(), plain: e.field };
  if (e.field === "Item" && e.action === "created") return { verb: "created this item", plain: "Item created" };
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
      ? { verb: "archived this item", plain: "Item archived" }
      : { verb: "restored this item", plain: "Item restored" };
  }
  if (e.field === "Category") return { verb: "moved it to another category", plain: "Moved to another category" };
  const word = FIELD_WORDS[e.field] ?? e.field.toLowerCase();
  return { verb: `changed the ${word}`, plain: `${e.field} changed` };
}

export type DotTone = "up" | "down" | "stock" | "details";

export function dotTone(e: HistoryEvent): DotTone {
  if (e.kind === "stock") return "stock";
  if (e.kind === "cost") {
    if (e.delta_pct !== null) return e.delta_pct > 0 ? "up" : "down";
    if (e.action === "removed") return "down";
    return "up";
  }
  return "details";
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
