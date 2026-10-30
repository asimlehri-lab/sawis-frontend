// What an item costs per base unit, the same rule the backend costs recipes with
// (apps/catalog/costing.py): the default supplier's price when that supplier is linked
// with a price above zero (never "resting"), otherwise the cheapest price above zero among
// suppliers that are still fresh, otherwise (nothing fresh) the cheapest price anyway. A link
// priced at 0 means "no price yet" and never counts. Returns null when no supplier has a
// price (the caller then falls back to the item's target cost, as the backend does).

export interface PricedLink {
  supplier: string;
  unit_price: string | number;
  // false when nothing has happened on this link (a delivery, a price list update, or a
  // person confirming the price) within the business's fresh-days setting: it is "resting".
  price_fresh?: boolean;
}

export interface EffectiveCost<T extends PricedLink> {
  link: T;
  price: number;
  basis: "default" | "cheapest" | "stale";
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
  const fresh = priced.filter((l) => l.price_fresh !== false);
  const pool = fresh.length > 0 ? fresh : priced;
  const cheapest = pool.reduce((m, l) => (Number(l.unit_price) < Number(m.unit_price) ? l : m));
  return { link: cheapest, price: Number(cheapest.unit_price), basis: fresh.length > 0 ? "cheapest" : "stale" };
}

// Whole days since an ISO date (null when unknown).
export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}
