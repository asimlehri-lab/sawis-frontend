// Shared wording and sums for the "price check" screens: the import review, the supplier's
// Price list tab, and (later) End of day -> Actions and the order screens.
import { formatMoney } from "./api";
import type { PriceCheckReason, PriceListLine } from "./api";
import type { HeldCandidate } from "./priceListChanges";

export const REASON_LABEL: Record<PriceCheckReason, string> = {
  unit: "Unit changed",
  pack: "Pack size differs",
  price: "Price jumped",
};

export interface Side {
  unit: string;
  price: number;
  // How much one unit holds in the item's own unit; null when the list did not say.
  pack: number | null;
}

export function perBase(price: number, pack: number | null): number | null {
  return pack && pack > 0 ? price / pack : null;
}

export function pct(from: number, to: number): number {
  return Math.round((to / from - 1) * 100);
}

export function fmtQty(n: number): string {
  return n.toLocaleString("en-GB", { maximumFractionDigits: 4 });
}

export function reasonText(reason: PriceCheckReason, cur: Side, next: Side): string {
  if (reason === "price" && cur.price > 0) {
    const p = pct(cur.price, next.price);
    return `Price ${p > 0 ? "+" : ""}${p}%`;
  }
  return REASON_LABEL[reason];
}

// "Keep current: case · €65.00 (12,000 ml)" -- says exactly what stays.
export function keepLabel(reason: PriceCheckReason, cur: Side, baseUnit: string, currency: string): string {
  if (reason === "price") return `Keep current price ${formatMoney(cur.price, currency)} per ${cur.unit}`;
  if (reason === "pack") return `Keep current: ${fmtQty(cur.pack ?? 1)} ${baseUnit} per ${cur.unit}`;
  return `Keep current: ${cur.unit} · ${formatMoney(cur.price, currency)}${cur.pack ? ` (${fmtQty(cur.pack)} ${baseUnit})` : ""}`;
}

export function adoptLabel(reason: PriceCheckReason, next: Side, baseUnit: string, currency: string): string {
  if (reason === "price") return `Use new price ${formatMoney(next.price, currency)}`;
  if (reason === "pack") return `Use the list's ${fmtQty(next.pack ?? 1)} ${baseUnit} per ${next.unit}`;
  return `Use new list: ${next.unit} · ${formatMoney(next.price, currency)}`;
}

// Does "use the new list" need the person to say how much one unit holds?
export function needsAmount(reason: PriceCheckReason, next: Side): boolean {
  return reason === "unit" && !(next.pack && next.pack > 0);
}

// The person's choice for one line of the import review.
export interface Decision {
  choice: "keep" | "use" | "size";
  qty: string;
}

// What to send for a decision: null when the person is keeping the current values (or has not
// finished, see isIncomplete), otherwise accept plus the amount per unit where one is needed.
export function acceptFor(c: HeldCandidate, d: Decision | undefined): { accept: true; base_qty_per_unit?: string } | null {
  if (!d || d.choice === "keep") return null;
  const typed = Number(d.qty);
  if (c.reason === "unit") {
    const pack = c.next.pack ?? (typed > 0 ? typed : null);
    return pack ? { accept: true, base_qty_per_unit: String(pack) } : null;
  }
  if (c.reason === "pack") return c.next.pack ? { accept: true, base_qty_per_unit: String(c.next.pack) } : null;
  if (d.choice === "size") return typed > 0 ? { accept: true, base_qty_per_unit: String(typed) } : null;
  return { accept: true };
}

export function isIncomplete(c: HeldCandidate, d: Decision | undefined): boolean {
  return !!d && d.choice !== "keep" && acceptFor(c, d) === null;
}


// The saved and the proposed unit/price/pack of a price list line that is waiting for a check.
export function sidesOf(l: PriceListLine): { cur: Side; next: Side } | null {
  if (!l.check) return null;
  const curPack = Number(l.base_qty_per_unit) > 0 ? Number(l.base_qty_per_unit) : 1;
  const nextPack = l.check.pack ? Number(l.check.pack) : l.check.reason === "price" ? curPack : null;
  return {
    cur: { unit: l.unit, price: Number(l.price), pack: curPack },
    next: { unit: l.check.unit, price: Number(l.check.price), pack: nextPack },
  };
}
