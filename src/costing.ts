// What an item costs per base unit, the same rule the backend costs recipes with
// (apps/catalog/costing.py): the default supplier's price when that supplier is linked
// with a price above zero, otherwise the cheapest price above zero. A link priced at 0
// means "no price yet" and never counts. Returns null when no supplier has a price (the
// caller then falls back to the item's target cost, as the backend does).

export interface PricedLink {
  supplier: string;
  unit_price: string | number;
}

export interface EffectiveCost<T extends PricedLink> {
  link: T;
  price: number;
  basis: "default" | "cheapest";
}

export function effectiveCost<T extends PricedLink>(
  links: T[],
  defaultSupplier: string | null | undefined
): EffectiveCost<T> | null {
  const priced = links.filter((l) => Number(l.unit_price) > 0);
  if (priced.length === 0) return null;
  if (defaultSupplier) {
    const d = priced.find((l) => l.supplier === defaultSupplier);
    if (d) return { link: d, price: Number(d.unit_price), basis: "default" };
  }
  const cheapest = priced.reduce((m, l) => (Number(l.unit_price) < Number(m.unit_price) ? l : m));
  return { link: cheapest, price: Number(cheapest.unit_price), basis: "cheapest" };
}
