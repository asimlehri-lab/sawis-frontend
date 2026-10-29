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
