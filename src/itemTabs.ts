// The Item page's sections. History is only offered to managers and admins.
export type ItemTab = "details" | "stock" | "suppliers" | "history";

export const ITEM_TAB_LABELS: Record<ItemTab, string> = {
  details: "Details",
  stock: "Stock",
  suppliers: "Suppliers",
  history: "History",
};

// The Recipe page's sections (History is only offered to managers and admins).
export type RecipeTab = "ingredients" | "method" | "cost" | "allergens" | "history";

export const RECIPE_TAB_LABELS: Record<RecipeTab, string> = {
  ingredients: "Ingredients",
  method: "Method",
  cost: "Cost & margin",
  allergens: "Allergens",
  history: "History",
};
