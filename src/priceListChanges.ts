import type { PriceCheckReason } from "./api";

// Compares the lines about to be imported with what is already on the supplier's
// Price list, so the person can see before importing what will change: a unit that
// differs (which leaves an already-linked item's price alone, see the backend
// bulk_import), a price that moved a lot, or a line that is new.

export interface ExistingLine {
  name: string;
  unit: string;
  price: number;
  // Name of the item this line is already linked to, if any.
  linkedItem: string | null;
  // How much one unit holds in that item's own unit, and what that unit is.
  pack?: number;
  baseUnit?: string | null;
}

export type LineChange =
  | { kind: "new" }
  | { kind: "same" }
  | { kind: "unit"; oldUnit: string; linkedItem: string | null }
  | { kind: "price"; oldPrice: number; ratio: number; linkedItem: string | null };

// A price that moves by half or more (up or down) is worth a second look.
export const BIG_MOVE = 1.5;

export function indexExisting(lines: ExistingLine[]): Map<string, ExistingLine> {
  const m = new Map<string, ExistingLine>();
  lines.forEach((l) => m.set(l.name.trim().toLowerCase(), l));
  return m;
}

export function compareLine(
  row: { name: string; unit: string; price: string | number },
  existing: Map<string, ExistingLine>
): LineChange {
  const old = existing.get(row.name.trim().toLowerCase());
  if (!old) return { kind: "new" };
  if (old.unit.trim().toLowerCase() !== row.unit.trim().toLowerCase()) {
    return { kind: "unit", oldUnit: old.unit, linkedItem: old.linkedItem };
  }
  const price = Number(row.price);
  if (old.price > 0 && price > 0) {
    const ratio = price / old.price;
    if (Math.abs(ratio - 1) > 0.005) return { kind: "price", oldPrice: old.price, ratio, linkedItem: old.linkedItem };
  }
  return { kind: "same" };
}

export function isBigMove(c: LineChange): boolean {
  return c.kind === "price" && (c.ratio >= BIG_MOVE || c.ratio <= 1 / BIG_MOVE);
}

export interface ChangeSummary {
  unitLinked: number;
  unitOther: number;
  bigMoves: number;
  priceChanged: number;
  fresh: number;
}

export function summarise(
  rows: { name: string; unit: string; price: string | number }[],
  existing: Map<string, ExistingLine>
): ChangeSummary {
  const s: ChangeSummary = { unitLinked: 0, unitOther: 0, bigMoves: 0, priceChanged: 0, fresh: 0 };
  rows.forEach((r) => {
    const c = compareLine(r, existing);
    if (c.kind === "new") s.fresh++;
    else if (c.kind === "unit") {
      if (c.linkedItem) s.unitLinked++;
      else s.unitOther++;
    }
    else if (c.kind === "price") {
      s.priceChanged++;
      if (isBigMove(c)) s.bigMoves++;
    }
  });
  return s;
}

// A row that changes how an already-linked line converts to the item's own unit (or jumps in
// price) is never applied on its own: the person decides in the import review, and anything
// left undecided is held as a "price check" on the Price list tab. Mirrors the backend
// (price_check.py), which is the one that actually enforces it.
export interface HeldCandidate {
  key: string;
  name: string;
  reason: PriceCheckReason;
  item: string;
  baseUnit: string;
  cur: { unit: string; price: number; pack: number };
  next: { unit: string; price: number; pack: number | null };
}

export function heldCandidates(
  rows: { name: string; unit: string; price: string | number; base_qty_per_unit?: string }[],
  existing: Map<string, ExistingLine>
): HeldCandidate[] {
  const out: HeldCandidate[] = [];
  rows.forEach((r) => {
    const old = existing.get(r.name.trim().toLowerCase());
    if (!old || !old.linkedItem) return;
    const price = Number(r.price);
    const oldPack = old.pack && old.pack > 0 ? old.pack : 1;
    const givenPack = r.base_qty_per_unit ? Number(r.base_qty_per_unit) : null;
    let reason: PriceCheckReason | null = null;
    if (old.unit.trim().toLowerCase() !== r.unit.trim().toLowerCase()) reason = "unit";
    else if (givenPack !== null && givenPack > 0 && givenPack !== oldPack) reason = "pack";
    else if (old.price > 0 && price > 0 && (price / old.price >= BIG_MOVE || price / old.price <= 1 / BIG_MOVE)) reason = "price";
    if (!reason) return;
    out.push({
      key: r.name.trim().toLowerCase(),
      name: r.name,
      reason,
      item: old.linkedItem,
      baseUnit: old.baseUnit ?? "unit",
      cur: { unit: old.unit, price: old.price, pack: oldPack },
      next: { unit: r.unit, price, pack: givenPack && givenPack > 0 ? givenPack : reason === "price" ? oldPack : null },
    });
  });
  return out;
}
