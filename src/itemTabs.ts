// The Item page's sections. History is only offered to managers and admins.
export type ItemTab = "details" | "stock" | "suppliers" | "history";

export const ITEM_TAB_LABELS: Record<ItemTab, string> = {
  details: "Details",
  stock: "Stock",
  suppliers: "Suppliers",
  history: "History",
};
