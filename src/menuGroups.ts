import type { ReportsMenuRow } from "./api";

// Menu engineering groups and the maths that sorts dishes into them.

export type GroupKey = "headliners" | "crowd" | "gems" | "chop";

export const GROUPS: Record<GroupKey, { name: string; verb: string; action: string }> = {
  headliners: {
    name: "Headliners",
    verb: "Protect.",
    action: "Sell well and earn well. Keep the recipe and portion exactly as is, and put them where guests look first.",
  },
  crowd: {
    name: "Crowd pleasers",
    verb: "Reprice or trim cost.",
    action: "People love them but each one earns little. Nudge the price up or trim the ingredient cost.",
  },
  gems: {
    name: "Hidden gems",
    verb: "Promote.",
    action: "Good margin, few orders. Move them up the menu, rename them, or have staff suggest them.",
  },
  chop: {
    name: "Chop list",
    verb: "Review.",
    action: "Low sales and low profit. Rework, replace, or drop them from the menu.",
  },
};

export const ORDER: GroupKey[] = ["headliners", "crowd", "gems", "chop"];
export const MIN_DISHES = 4;

export interface Dish {
  id: string;
  name: string;
  qty: number;
  mix: number; // % of all dishes sold
  gp: number; // profit per dish
  group: GroupKey;
}

export function niceStep(max: number): number {
  for (const s of [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]) if (max / s <= 4.5) return s;
  return 1000;
}

export function buildMenuGroups(rows: ReportsMenuRow[]) {
  // A flat 0% food cost nearly always means an ingredient has no supplier
  // price on file, which would drop the dish into the wrong group -- so
  // those (and dishes with no revenue) are left out and counted instead.
  const usable = rows.filter((r) => r.qty > 0 && r.food_cost_pct !== null && r.food_cost_pct !== 0);
  const hidden = rows.length - usable.length;
  const totalQty = usable.reduce((s, r) => s + r.qty, 0);
  if (usable.length < MIN_DISHES || totalQty === 0) {
    return { ok: false as const, hidden, count: usable.length };
  }
  const xCut = 100 / usable.length;
  const yCut = usable.reduce((s, r) => s + r.gp_contribution, 0) / totalQty;
  const dishes: Dish[] = usable.map((r) => {
    const mix = (r.qty / totalQty) * 100;
    const gp = r.gp_per_unit;
    const group: GroupKey = mix >= xCut ? (gp >= yCut ? "headliners" : "crowd") : gp >= yCut ? "gems" : "chop";
    return { id: r.recipe_id, name: r.name, qty: r.qty, mix, gp, group };
  });
  return { ok: true as const, dishes, xCut, yCut, hidden };
}

