import type { Location, Me } from "./api";

// "All locations": the value the location tabs use for every location added up.
export const ALL_LOCATIONS = "all";

const MANAGER_ROLES = ["admin", "manager", "finance"];

// The All tab is for managers who can look at more than one location: either
// a manager role that is not tied to a single location, or manager roles at
// two or more locations. Staff never see it.
export function canSeeAllLocations(me: Me, locations: Location[]): boolean {
  if (locations.length < 2) return false;
  const mine = me.memberships.filter((m) => MANAGER_ROLES.includes(m.role));
  if (mine.some((m) => m.location === null)) return true;
  return new Set(mine.map((m) => m.location)).size > 1;
}

const CURRENCY_WORD: Record<string, string> = { EUR: "Euro", GBP: "Pound", USD: "Dollar" };

// "Euro locations: Vienna, Graz"
export function currencyBlockTitle(currency: string, names: string[]): string {
  const word = CURRENCY_WORD[currency] ?? currency;
  return `${word} locations: ${names.join(", ")}`;
}

// A food/drink cost target for several locations at once: each location's own
// target, weighted by what it sold, so a busy location counts for more. Falls
// back to 30, the same default a single location uses.
export function blendedTarget(rows: { id: string; net_sales: number }[], locations: Location[], kind: "food" | "drink"): number {
  let weight = 0;
  let total = 0;
  for (const r of rows) {
    const loc = locations.find((l) => l.id === r.id);
    const t = Number(kind === "food" ? loc?.target_food_cost_pct : loc?.target_drink_cost_pct) || 30;
    const w = Number(r.net_sales) || 0;
    weight += w;
    total += t * w;
  }
  if (weight > 0) return Math.round((total / weight) * 10) / 10;
  const first = locations.find((l) => rows.some((r) => r.id === l.id));
  return Number(kind === "food" ? first?.target_food_cost_pct : first?.target_drink_cost_pct) || 30;
}
