import { autoFactor } from "./api";
import type { CatalogItem } from "./api";

// Shared bits for talking about an item's units: used by the Order in /
// Invoiced in picker and by the "add a stock unit" box on the item page.

export interface UnitOption {
  name: string;
  qty: number;
  // "auto" = kg/g or L/ml (the size is known), "pack" = saved on the item.
  kind: "auto" | "pack";
}

export const AUTO_CANDIDATES = ["g", "kg", "ml", "L"];

export function tidy(n: number): string {
  return Number(n.toFixed(4)).toLocaleString("en-GB", { maximumFractionDigits: 4 });
}

// What a pack holds, in the unit people say it in: 1,500 ml reads "1.5 L".
export function pretty(item: CatalogItem, qty: number): string {
  if (item.base_unit === "ml" && qty >= 1000) return `${tidy(qty / 1000)} L`;
  if (item.base_unit === "g" && qty >= 1000) return `${tidy(qty / 1000)} kg`;
  return `${tidy(qty)} ${item.base_unit}`;
}

// A hint for the size box that fits the unit being typed in.
export function sizeHint(item: CatalogItem, unit: string, isPack: boolean): string {
  if (isPack) return "12";
  const u = unit || item.base_unit;
  if (u === "L") return "1.5";
  if (u === "kg") return "2.5";
  if (u === "ml" || u === "g") return "500";
  return "24";
}

// The units an item already has besides its base unit: its saved packs, then
// kg/g or L/ml when the item is weighed or poured and no pack has that name.
export function packOptions(item: CatalogItem): UnitOption[] {
  const out: UnitOption[] = (item.stock_units ?? []).map((u) => ({ name: u.name, qty: Number(u.qty), kind: "pack" as const }));
  const has = (n: string) => out.some((o) => o.name.toLowerCase() === n.toLowerCase());
  for (const c of AUTO_CANDIDATES) {
    const f = autoFactor(c, item.base_unit);
    if (f !== null && c !== item.base_unit && !has(c)) out.push({ name: c, qty: f, kind: "auto" });
  }
  return out;
}

export interface NameChip {
  name: string;
  // A size to fill in as well, in the item's base unit, when the name says it
  // (a kg is 1,000 g, a dozen is 12).
  qty?: number;
}

// One-tap names for a new pack, chosen for what the item is measured in.
export function nameChips(item: CatalogItem, withSizes: boolean): NameChip[] {
  const base = item.base_unit;
  let all: NameChip[];
  if (base === "g") all = [{ name: "kg", qty: 1000 }, { name: "bag" }, { name: "sack" }, { name: "tub" }, { name: "tin" }];
  else if (base === "kg") all = [{ name: "bag" }, { name: "sack" }, { name: "box" }, { name: "tub" }];
  else if (base === "ml") all = [{ name: "L", qty: 1000 }, { name: "bottle" }, { name: "carton" }, { name: "jug" }, { name: "can" }];
  else if (base === "L") all = [{ name: "bottle" }, { name: "carton" }, { name: "jug" }, { name: "can" }];
  else all = [{ name: "box" }, { name: "case" }, { name: "tray" }, { name: "pack" }, { name: "dozen", qty: 12 }];
  const taken = new Set((item.stock_units ?? []).map((u) => u.name.toLowerCase()));
  taken.add(base.toLowerCase());
  return all.filter((c) => !taken.has(c.name.toLowerCase())).map((c) => (withSizes ? c : { name: c.name }));
}
