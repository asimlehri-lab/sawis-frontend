const API_URL = "https://sawis-backend.onrender.com";

export interface Membership {
  id: string;
  user: string;
  name: string;
  email: string;
  role: "admin" | "manager" | "finance" | "staff";
  location: string | null;
  location_name: string | null;
  department: string | null;
  job_title: string;
}

export interface Me {
  id: string;
  email: string;
  name: string;
  org: { id: string; name: string };
  memberships: Membership[];
}

interface TokenPair {
  access: string;
  refresh: string;
}

interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface ItemHolding {
  id: string;
  item: string;
  location: string;
  department: string;
  section: string | null;
  section_name: string | null;
  par_level: string;
}

export interface CatalogItem {
  id: string;
  name: string;
  sku: string | null;
  base_unit: string;
  category: string | null;
  category_name: string | null;
  vat_rate: string | null;
  effective_vat_rate: string | null;
  archived: boolean;
  holdings: ItemHolding[];
}

async function authedFetch(path: string, accessToken: string) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Request failed (${res.status}) for ${path}`);
  }
  return res.json();
}

export async function login(email: string, password: string): Promise<TokenPair> {
  const res = await fetch(`${API_URL}/api/auth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new Error("Login failed — check your email and password.");
  }
  return res.json();
}

export async function getMe(accessToken: string): Promise<Me> {
  return authedFetch("/api/tenancy/me/", accessToken);
}

export async function fetchItems(accessToken: string): Promise<CatalogItem[]> {
  const data: Paginated<CatalogItem> = await authedFetch("/api/catalog/items/", accessToken);
  return data.results;
}

export const BASE_UNITS = ["g", "kg", "ml", "L", "ea", "portion", "btl", "case", "dozen"];

export interface NewItemInput {
  name: string;
  sku: string;
  base_unit: string;
  vat_rate: string | null;
}

export async function createItem(accessToken: string, input: NewItemInput): Promise<CatalogItem> {
  const res = await fetch(`${API_URL}/api/catalog/items/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (body && typeof body === "object") {
      const messages = Object.entries(body).map(
        ([field, errs]) => `${field}: ${Array.isArray(errs) ? errs.join(", ") : errs}`
      );
      throw new Error(messages.join(" · ") || "Could not create item.");
    }
    throw new Error("Could not create item.");
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Settings: bulk CSV import (Items)
// ---------------------------------------------------------------------------

export interface BulkItemInput {
  name: string;
  sku?: string;
  base_unit: string;
  category?: string;
  vat_rate?: string | null;
  department?: "kitchen" | "bar" | "foh";
}

export interface BulkItemImportResult {
  created: CatalogItem[];
  // Names of items that already existed by name and so weren't
  // duplicated — but had no ItemHolding at `location` yet, so one was
  // created for them. Re-running the same CSV through this screen is
  // the supported way to backfill holdings for items that were
  // imported before ItemHolding creation existed here.
  holdings_backfilled: string[];
}

// `location` is required server-side — every imported item also gets an
// ItemHolding there (par_level 0) so it's immediately visible/trackable
// in Inventory instead of existing only as an untracked catalog row.
// Rows matching an existing item by name aren't duplicated — instead the
// backend just backfills a missing holding for that existing item, if any.
export async function bulkImportItems(
  accessToken: string,
  location: string,
  items: BulkItemInput[]
): Promise<BulkItemImportResult> {
  const res = await fetch(`${API_URL}/api/catalog/items/bulk_import/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ location, items }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg = (body && (body.detail || body.error)) || "Could not import these items.";
    throw new Error(Array.isArray(msg) ? msg.join(" ") : msg);
  }
  return res.json();
}

export interface RecipeLine {
  id: string;
  recipe: string;
  line_type: "item" | "recipe";
  item: string | null;
  item_name: string | null;
  sub_recipe: string | null;
  sub_recipe_name: string | null;
  qty: string;
  unit: string;
  unit_cost: number;
  line_cost: number;
}

export interface Recipe {
  id: string;
  org: string;
  kind: "dish" | "sub";
  name: string;
  yield_qty: string;
  yield_unit: string;
  menu_price: string | null;
  // Food vs drink — only meaningful when kind === "dish". Defaults to
  // "food" server-side, so every recipe imported/created before this
  // existed shows as Food until someone marks it a drink. Purely a
  // Champions-ranking split, no effect on costing.
  menu_group: "food" | "drink";
  lines: RecipeLine[];
  batch_cost: number;
  per_portion_cost: number;
  plate_food_cost_pct: number | null;
}

export const YIELD_UNITS = ["plate", "portion", "kg", "litre"];

export interface NewRecipeInput {
  kind: "dish" | "sub";
  name: string;
  yield_qty: string;
  yield_unit: string;
  menu_price?: string;
}

export async function fetchRecipes(accessToken: string): Promise<Recipe[]> {
  const data: Paginated<Recipe> = await authedFetch("/api/catalog/recipes/", accessToken);
  return data.results;
}

export async function createRecipe(accessToken: string, input: NewRecipeInput): Promise<Recipe> {
  const res = await fetch(`${API_URL}/api/catalog/recipes/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (body && typeof body === "object") {
      const messages = Object.entries(body).map(
        ([field, errs]) => `${field}: ${Array.isArray(errs) ? errs.join(", ") : errs}`
      );
      throw new Error(messages.join(" · ") || "Could not create recipe.");
    }
    throw new Error("Could not create recipe.");
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Settings: bulk CSV import (Recipes + ingredients)
// ---------------------------------------------------------------------------

export interface BulkRecipeLineInput {
  item_id?: string;
  item_name: string;
  qty: string;
  unit: string;
}

export interface BulkRecipeInput {
  name: string;
  kind: "dish" | "sub";
  yield_qty: string;
  yield_unit: string;
  menu_price?: string | null;
  lines: BulkRecipeLineInput[];
}

export interface BulkRecipeImportResult {
  recipes: Recipe[];
  items_created: string[];
  // Names of already-existing (matched) ingredient items that had no
  // ItemHolding at `location` yet and had one backfilled — same
  // reasoning as BulkItemImportResult.holdings_backfilled.
  holdings_backfilled: string[];
}

// Backend creates any ingredient with no item_id as a brand-new Item on
// the fly (plus an ItemHolding at `location`, required) — see
// RecipeViewSet.bulk_import / _guess_base_unit. The frontend's review
// step is what makes that safe: it shows exactly which ingredient names
// have no match before the user confirms.
export async function bulkImportRecipes(
  accessToken: string,
  location: string,
  recipes: BulkRecipeInput[]
): Promise<BulkRecipeImportResult> {
  const res = await fetch(`${API_URL}/api/catalog/recipes/bulk_import/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ location, recipes }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg = (body && (body.detail || body.error)) || "Could not import these recipes.";
    throw new Error(Array.isArray(msg) ? msg.join(" ") : msg);
  }
  return res.json();
}

export async function fetchRecipe(accessToken: string, id: string): Promise<Recipe> {
  return authedFetch(`/api/catalog/recipes/${id}/`, accessToken);
}

export interface RecipePatch {
  name?: string;
  yield_qty?: string;
  yield_unit?: string;
  menu_price?: string | null;
  menu_group?: "food" | "drink";
}

export async function updateRecipe(accessToken: string, id: string, patch: RecipePatch): Promise<Recipe> {
  const res = await fetch(`${API_URL}/api/catalog/recipes/${id}/`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("Could not save changes.");
  return res.json();
}

export interface NewRecipeLineInput {
  recipe: string;
  line_type: "item" | "recipe";
  item?: string;
  sub_recipe?: string;
  qty: string;
  unit: string;
}

export async function createRecipeLine(accessToken: string, input: NewRecipeLineInput): Promise<RecipeLine> {
  const res = await fetch(`${API_URL}/api/catalog/recipe-lines/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (body && typeof body === "object") {
      const messages = Object.entries(body).map(
        ([field, errs]) => `${field}: ${Array.isArray(errs) ? errs.join(", ") : errs}`
      );
      throw new Error(messages.join(" · ") || "Could not add ingredient.");
    }
    throw new Error("Could not add ingredient.");
  }
  return res.json();
}

export async function deleteRecipeLine(accessToken: string, lineId: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/catalog/recipe-lines/${lineId}/`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Could not remove ingredient.");
}

export interface Category {
  id: string;
  org: string;
  name: string;
  default_vat_rate: string;
}

export async function fetchCategories(accessToken: string): Promise<Category[]> {
  const data: Paginated<Category> = await authedFetch("/api/catalog/categories/", accessToken);
  return data.results;
}

export interface Location {
  id: string;
  org: string;
  name: string;
  timezone: string;
  // Rent + labour + other fixed monthly costs, set by hand in Settings.
  // Only used to estimate End of day's net margin — null means net
  // margin can't be computed yet, and the report says so rather than
  // guessing zero overhead.
  monthly_overhead: string | null;
}

export async function fetchLocations(accessToken: string): Promise<Location[]> {
  const data: Paginated<Location> = await authedFetch("/api/tenancy/locations/", accessToken);
  return data.results;
}

export async function updateLocation(
  accessToken: string,
  id: string,
  patch: { monthly_overhead?: string | null }
): Promise<Location> {
  const res = await fetch(`${API_URL}/api/tenancy/locations/${id}/`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("Could not save changes.");
  return res.json();
}

export async function fetchMemberships(accessToken: string): Promise<Membership[]> {
  const data: Paginated<Membership> = await authedFetch("/api/tenancy/memberships/", accessToken);
  return data.results;
}

export interface NewMemberInput {
  email: string;
  name: string;
  password?: string;
  role: "admin" | "manager" | "finance" | "staff";
  location: string | null;
  department: "kitchen" | "bar" | "foh" | null;
  job_title: string;
}

export async function createMember(accessToken: string, input: NewMemberInput): Promise<Membership> {
  const res = await fetch(`${API_URL}/api/tenancy/memberships/add_member/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (body && typeof body === "object") {
      const messages = Object.entries(body).map(
        ([field, errs]) => `${field}: ${Array.isArray(errs) ? errs.join(", ") : errs}`
      );
      throw new Error(messages.join(" · ") || "Could not add this team member.");
    }
    throw new Error("Could not add this team member.");
  }
  return res.json();
}

export interface MembershipPatch {
  role?: "admin" | "manager" | "finance" | "staff";
  department?: "kitchen" | "bar" | "foh" | null;
  location?: string | null;
  job_title?: string;
}

export async function updateMembership(accessToken: string, id: string, patch: MembershipPatch): Promise<Membership> {
  const res = await fetch(`${API_URL}/api/tenancy/memberships/${id}/`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("Could not update this team member.");
  return res.json();
}

export async function deleteMembership(accessToken: string, id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/tenancy/memberships/${id}/`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg = (body && (body.detail || body.error)) || "Could not remove this team member.";
    throw new Error(msg);
  }
}

export async function fetchItem(accessToken: string, id: string): Promise<CatalogItem> {
  return authedFetch(`/api/catalog/items/${id}/`, accessToken);
}

export interface ItemPatch {
  name?: string;
  sku?: string;
  category?: string | null;
  vat_rate?: string | null;
  base_unit?: string;
  archived?: boolean;
}

export async function updateItem(accessToken: string, id: string, patch: ItemPatch): Promise<CatalogItem> {
  const res = await fetch(`${API_URL}/api/catalog/items/${id}/`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("Could not save changes.");
  return res.json();
}

export interface NewHoldingInput {
  item: string;
  location: string;
  department: string;
  section: string | null;
  par_level: string;
}

export async function createItemHolding(accessToken: string, input: NewHoldingInput): Promise<ItemHolding> {
  const res = await fetch(`${API_URL}/api/catalog/item-holdings/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (body && typeof body === "object") {
      const messages = Object.entries(body).map(
        ([field, errs]) => `${field}: ${Array.isArray(errs) ? errs.join(", ") : errs}`
      );
      throw new Error(messages.join(" · ") || "Could not add holding.");
    }
    throw new Error("Could not add holding.");
  }
  return res.json();
}

export async function updateItemHolding(
  accessToken: string,
  id: string,
  patch: { par_level?: string; section?: string | null }
): Promise<ItemHolding> {
  const res = await fetch(`${API_URL}/api/catalog/item-holdings/${id}/`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("Could not save par level.");
  return res.json();
}

export async function deleteItemHolding(accessToken: string, id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/catalog/item-holdings/${id}/`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Could not remove holding.");
}

export async function deleteItem(accessToken: string, id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/catalog/items/${id}/`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg =
      (body && (body.detail || body.error || body.message)) ||
      "Could not delete this item — it may already have recorded stock activity.";
    throw new Error(msg);
  }
}

export async function fetchOnHand(
  accessToken: string,
  itemId: string,
  locationId: string,
  department: string
): Promise<number> {
  const data = await authedFetch(
    `/api/ledger/stock-movements/on_hand/?item=${itemId}&location=${locationId}&department=${department}`,
    accessToken
  );
  return Number(data.on_hand) || 0;
}

export interface Supplier {
  id: string;
  org: string;
  name: string;
  contact_email: string | null;
  delivery_day: number | null;
  min_order_value: string | null;
}

export async function fetchSuppliers(accessToken: string): Promise<Supplier[]> {
  const data: Paginated<Supplier> = await authedFetch("/api/catalog/suppliers/", accessToken);
  return data.results;
}

export interface NewSupplierInput {
  name: string;
  contact_email: string | null;
  delivery_day?: number | null;
  min_order_value?: string | null;
}

export async function createSupplier(accessToken: string, input: NewSupplierInput): Promise<Supplier> {
  const res = await fetch(`${API_URL}/api/catalog/suppliers/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (body && typeof body === "object") {
      const messages = Object.entries(body).map(
        ([field, errs]) => `${field}: ${Array.isArray(errs) ? errs.join(", ") : errs}`
      );
      throw new Error(messages.join(" · ") || "Could not create supplier.");
    }
    throw new Error("Could not create supplier.");
  }
  return res.json();
}

export interface SupplierItemRow {
  id: string;
  supplier: string;
  raw_name: string;
  unit: string;
  price: string;
  imported_at: string;
}

export async function fetchSupplierItems(accessToken: string): Promise<SupplierItemRow[]> {
  const data: Paginated<SupplierItemRow> = await authedFetch("/api/catalog/supplier-items/", accessToken);
  return data.results;
}

export interface NewSupplierItemInput {
  supplier: string;
  raw_name: string;
  unit: string;
  price: string;
}

export async function createSupplierItem(
  accessToken: string,
  input: NewSupplierItemInput
): Promise<SupplierItemRow> {
  const res = await fetch(`${API_URL}/api/catalog/supplier-items/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Could not store "${input.raw_name}".`);
  return res.json();
}

export interface ItemSupplierRow {
  id: string;
  item: string;
  supplier: string;
  supplier_name: string;
  unit_price: string;
  min_order_qty: string | null;
  last_ordered_at: string | null;
  matched_from: string | null;
}

export async function fetchItemSuppliers(accessToken: string): Promise<ItemSupplierRow[]> {
  const data: Paginated<ItemSupplierRow> = await authedFetch("/api/catalog/item-suppliers/", accessToken);
  return data.results;
}

export interface NewItemSupplierInput {
  item: string;
  supplier: string;
  unit_price: string;
  matched_from?: string;
}

export async function createItemSupplier(
  accessToken: string,
  input: NewItemSupplierInput
): Promise<ItemSupplierRow> {
  const res = await fetch(`${API_URL}/api/catalog/item-suppliers/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (body && typeof body === "object") {
      const messages = Object.entries(body).map(
        ([field, errs]) => `${field}: ${Array.isArray(errs) ? errs.join(", ") : errs}`
      );
      throw new Error(messages.join(" · ") || "Could not link supplier.");
    }
    throw new Error("Could not link supplier.");
  }
  return res.json();
}

export interface POLineRow {
  id: string;
  po: string;
  item: string;
  item_name: string;
  department: "kitchen" | "bar" | "foh";
  qty: string;
  unit_price: string;
  received_qty: string | null;
  received_unit_price: string | null;
  line_total: string;
}

export interface PurchaseOrder {
  id: string;
  location: string;
  location_name: string;
  supplier: string;
  supplier_name: string;
  status: "draft" | "awaiting" | "sent" | "received" | "amended";
  expected_date: string | null;
  received_date: string | null;
  created_by: string;
  lines: POLineRow[];
  total: string;
}

export async function fetchPurchaseOrders(accessToken: string): Promise<PurchaseOrder[]> {
  const data: Paginated<PurchaseOrder> = await authedFetch("/api/procurement/purchase-orders/", accessToken);
  return data.results;
}

export async function fetchPurchaseOrder(accessToken: string, id: string): Promise<PurchaseOrder> {
  return authedFetch(`/api/procurement/purchase-orders/${id}/`, accessToken);
}

export interface NewPOInput {
  location: string;
  supplier: string;
  expected_date?: string | null;
}

export async function createPurchaseOrder(accessToken: string, input: NewPOInput): Promise<PurchaseOrder> {
  const res = await fetch(`${API_URL}/api/procurement/purchase-orders/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (body && typeof body === "object") {
      const messages = Object.entries(body).map(
        ([field, errs]) => `${field}: ${Array.isArray(errs) ? errs.join(", ") : errs}`
      );
      throw new Error(messages.join(" · ") || "Could not create purchase order.");
    }
    throw new Error("Could not create purchase order.");
  }
  return res.json();
}

export interface POPatch {
  status?: PurchaseOrder["status"];
  expected_date?: string | null;
  received_date?: string | null;
}

export async function updatePurchaseOrder(
  accessToken: string,
  id: string,
  patch: POPatch
): Promise<PurchaseOrder> {
  const res = await fetch(`${API_URL}/api/procurement/purchase-orders/${id}/`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("Could not save changes.");
  return res.json();
}

export interface NewPOLineInput {
  po: string;
  item: string;
  department: "kitchen" | "bar" | "foh";
  qty: string;
  unit_price: string;
}

export async function createPOLine(accessToken: string, input: NewPOLineInput): Promise<POLineRow> {
  const res = await fetch(`${API_URL}/api/procurement/po-lines/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (body && typeof body === "object") {
      const messages = Object.entries(body).map(
        ([field, errs]) => `${field}: ${Array.isArray(errs) ? errs.join(", ") : errs}`
      );
      throw new Error(messages.join(" · ") || "Could not add line.");
    }
    throw new Error("Could not add line.");
  }
  return res.json();
}

export interface ReceiveLineOverride {
  id: string;
  received_qty: string;
  received_unit_price: string;
}

export async function receivePurchaseOrder(
  accessToken: string,
  id: string,
  lines: ReceiveLineOverride[]
): Promise<PurchaseOrder> {
  const res = await fetch(`${API_URL}/api/procurement/purchase-orders/${id}/receive/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ lines }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg = (body && (body.detail || body.error)) || "Could not receive this delivery.";
    throw new Error(Array.isArray(msg) ? msg.join(" ") : msg);
  }
  return res.json();
}

export async function deletePOLine(accessToken: string, id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/procurement/po-lines/${id}/`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Could not remove line.");
}

export interface POLinePatch {
  qty?: string;
  unit_price?: string;
  department?: "kitchen" | "bar" | "foh";
}
export async function updatePOLine(accessToken: string, id: string, patch: POLinePatch): Promise<POLineRow> {
  const res = await fetch(`${API_URL}/api/procurement/po-lines/${id}/`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("Could not update line.");
  return res.json();
}

// ---------------------------------------------------------------------------
// Waste log
// ---------------------------------------------------------------------------

export interface WasteEventRow {
  id: string;
  location: string;
  item: string;
  item_name: string;
  qty: string;
  reason: string;
  logged_by: string;
}

export async function fetchWasteEvents(accessToken: string): Promise<WasteEventRow[]> {
  const data: Paginated<WasteEventRow> = await authedFetch("/api/ledger/waste-events/", accessToken);
  return data.results;
}

export interface NewWasteEventInput {
  location: string;
  item: string;
  qty: string;
  reason: string;
}

export async function createWasteEvent(accessToken: string, input: NewWasteEventInput): Promise<WasteEventRow> {
  const res = await fetch(`${API_URL}/api/ledger/waste-events/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (body && typeof body === "object") {
      const messages = Object.entries(body).map(
        ([field, errs]) => `${field}: ${Array.isArray(errs) ? errs.join(", ") : errs}`
      );
      throw new Error(messages.join(" · ") || "Could not log waste.");
    }
    throw new Error("Could not log waste.");
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// End of day: sales CSV import
// ---------------------------------------------------------------------------

export interface SaleLineRow {
  id: string;
  sale: string;
  recipe: string;
  recipe_name: string;
  qty: number;
  gross_amount: string;
}

export interface SaleRow {
  id: string;
  location: string;
  source: string;
  occurred_at: string;
  external_ref: string | null;
  covers: number | null;
  lines: SaleLineRow[];
  // Ingredient names that couldn't be depleted because they have no
  // ItemHolding at this sale's location — not an error, just an honest
  // "this part didn't happen" flag instead of silently overclaiming.
  skipped_depletion_items: string[];
}

export interface ImportSaleLineInput {
  recipe: string;
  qty: number;
  gross_amount: string;
}

export interface ImportSalesInput {
  location: string;
  occurred_at: string;
  covers?: number;
  lines: ImportSaleLineInput[];
}

// Backend also walks each line's recipe and posts stock-depleting
// StockMovements — see apps/ledger/viewsets.py's import_sales action.
export async function importSales(accessToken: string, input: ImportSalesInput): Promise<SaleRow> {
  const res = await fetch(`${API_URL}/api/ledger/sales/import_sales/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (body && typeof body === "object") {
      const messages = Object.entries(body).map(
        ([field, errs]) => `${field}: ${Array.isArray(errs) ? errs.join(", ") : errs}`
      );
      throw new Error(messages.join(" · ") || "Could not import this sale.");
    }
    throw new Error("Could not import this sale.");
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// End of day: the KPI/comparison/Champions report
// ---------------------------------------------------------------------------

export interface EodPeriodMetrics {
  net_sales: number;
  covers: number | null;
  // true when SOME (but not all) sales in this range have a covers
  // value — so `covers` is a real but incomplete total, not the full
  // picture. Absent entirely (undefined) is treated the same as false.
  covers_partial?: boolean;
  cogs: number;
  food_cost_pct: number | null;
  gross_margin_pct: number | null;
  net_margin_pct: number | null;
  // Ingredient names depleted this period with no supplier price on
  // file at the time — their cost wasn't counted, so food_cost_pct is a
  // likely undercount. Only present on the "current" period.
  zero_cost_items?: string[];
}

export interface EodAverageMetrics {
  net_sales: number;
  covers: number | null;
  food_cost_pct: number | null;
  gross_margin_pct: number | null;
  // How many of the rolling-average windows this was built from
  // (window_count) actually had any sales (populated_count) — a
  // brand-new pilot won't have 4 weeks/3 months of real history for a
  // while, so an average built from mostly-empty windows should read as
  // "not enough history yet" rather than a confident-looking number.
  window_count: number;
  populated_count: number;
}

export interface EodChampionEntry {
  recipe_id: string;
  name: string;
  qty: number;
  revenue: number;
  cost: number;
  gp: number;
  margin_pct: number | null;
  growth_pct?: number;
}

export interface EodChampionGroup {
  hero: EodChampionEntry;
  most_sold: EodChampionEntry;
  top_margin: EodChampionEntry | null;
  trending_up: EodChampionEntry | null;
}

export interface EodReport {
  period: "today" | "week" | "month";
  range: { start: string; end: string };
  previous_range: { start: string; end: string };
  location: string;
  // false when this location has no monthly_overhead set — net_margin_pct
  // will be null throughout until someone sets it in Settings.
  overhead_configured: boolean;
  current: EodPeriodMetrics;
  previous: EodPeriodMetrics;
  average: EodAverageMetrics | null;
  champions: {
    food: EodChampionGroup | null;
    drink: EodChampionGroup | null;
  };
}

// Computes the whole report server-side from real ledger data — see
// SaleViewSet.eod_report in apps/ledger/viewsets.py. `date` defaults to
// today if omitted.
export async function fetchEodReport(
  accessToken: string,
  location: string,
  period: "today" | "week" | "month",
  date?: string
): Promise<EodReport> {
  const params = new URLSearchParams({ location, period });
  if (date) params.set("date", date);
  return authedFetch(`/api/ledger/sales/eod_report/?${params.toString()}`, accessToken);
}

// ---------------------------------------------------------------------------
// Reports — the longer-horizon, finance-oriented dashboard
// ---------------------------------------------------------------------------

export interface ReportsTrendPoint {
  label: string;
  food_cost_pct: number | null;
}

export interface ReportsMenuRow {
  recipe_id: string;
  name: string;
  menu_group: "food" | "drink";
  qty: number;
  revenue: number;
  cost: number;
  food_cost_pct: number | null;
  gp_per_unit: number;
  gp_contribution: number;
}

export interface ReportsSummary {
  period: "week" | "month" | "lastmonth";
  range: { start: string; end: string };
  location: string;
  net_sales: number;
  food_cost_pct: number | null;
  gross_profit_pct: number | null;
  waste_cost: number;
  // null when there were no sales this period (would be a divide-by-zero) —
  // distinct from a real 0%.
  waste_pct: number | null;
  // £ value of what stock counts found different from theoretical stock
  // this period — negative means shrinkage, positive means a count found
  // more than the ledger expected. 0 isn't "no counts done", it's "counts
  // matched exactly" — same as everywhere else, no counts done at all
  // just means this stays 0 rather than showing an honest gap, since the
  // backend has no way to distinguish "no counts" from "counts matched."
  variance: number;
  // Ingredient names sold this period with no supplier price on file —
  // food_cost_pct (and anything derived from it) is a likely undercount.
  zero_cost_items: string[];
  trend: ReportsTrendPoint[];
  menu: ReportsMenuRow[];
}

// Computes the whole dashboard server-side from real ledger data — see
// SaleViewSet.reports_summary in apps/ledger/viewsets.py. `date` defaults
// to today if omitted.
export async function fetchReportsSummary(
  accessToken: string,
  location: string,
  period: "week" | "month" | "lastmonth",
  date?: string
): Promise<ReportsSummary> {
  const params = new URLSearchParams({ location, period });
  if (date) params.set("date", date);
  return authedFetch(`/api/ledger/sales/reports_summary/?${params.toString()}`, accessToken);
}

// The ledger is append-only and has no auto-posting signals, so every write
// that should move stock (waste, count adjustments, …) must also POST a
// StockMovement itself — see StockMovementViewSet.on_hand / apps/ledger.
export interface StockMovementRow {
  id: string;
  location: string;
  item: string;
  item_name: string;
  department: "kitchen" | "bar" | "foh";
  qty_delta: string;
  movement_type: "purchase" | "sale" | "waste" | "count_adjust" | "transfer";
  unit_cost: string;
  source_type: string;
  source_id: string;
  occurred_at: string;
}

export async function fetchStockMovements(accessToken: string): Promise<StockMovementRow[]> {
  const data: Paginated<StockMovementRow> = await authedFetch("/api/ledger/stock-movements/", accessToken);
  return data.results;
}

export interface NewStockMovementInput {
  location: string;
  item: string;
  department: "kitchen" | "bar" | "foh";
  qty_delta: string;
  movement_type: "purchase" | "sale" | "waste" | "count_adjust" | "transfer";
  unit_cost: string;
  source_type: string;
  source_id: string;
}

export async function createStockMovement(
  accessToken: string,
  input: NewStockMovementInput
): Promise<StockMovementRow> {
  const res = await fetch(`${API_URL}/api/ledger/stock-movements/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("Could not record the stock movement for this entry.");
  return res.json();
}

// ---------------------------------------------------------------------------
// Inventory: sections, stock counts, count assignments/lines
// ---------------------------------------------------------------------------

export interface Section {
  id: string;
  location: string;
  name: string;
}

export async function fetchSections(accessToken: string): Promise<Section[]> {
  const data: Paginated<Section> = await authedFetch("/api/catalog/sections/", accessToken);
  return data.results;
}

export async function createSection(
  accessToken: string,
  input: { location: string; name: string }
): Promise<Section> {
  const res = await fetch(`${API_URL}/api/catalog/sections/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg = (body && (body.detail || body.name?.[0])) || "Could not create this section.";
    throw new Error(Array.isArray(msg) ? msg.join(" ") : String(msg));
  }
  return res.json();
}

export async function updateSection(accessToken: string, id: string, patch: { name?: string }): Promise<Section> {
  const res = await fetch(`${API_URL}/api/catalog/sections/${id}/`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("Could not rename this section.");
  return res.json();
}

export async function deleteSection(accessToken: string, id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/catalog/sections/${id}/`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg = (body && (body.detail || body.error)) || "Could not delete this section.";
    throw new Error(msg);
  }
}

export interface CountAssignmentRow {
  id: string;
  count: string;
  section: string;
  section_name: string;
  assigned_to: string | null;
  assigned_to_name: string | null;
  status: "to_do" | "in_progress" | "complete";
}

export interface CountLineRow {
  id: string;
  count: string;
  item: string;
  item_name: string;
  counted_qty: string;
  reason: string | null;
  note: string | null;
  counted_by: string | null;
}

export interface StockCountRow {
  id: string;
  location: string;
  status: "open" | "closed";
  counted_at: string | null;
  assignments: CountAssignmentRow[];
  lines: CountLineRow[];
}

export async function fetchStockCounts(accessToken: string): Promise<StockCountRow[]> {
  const data: Paginated<StockCountRow> = await authedFetch("/api/ledger/stock-counts/", accessToken);
  return data.results;
}

export async function createStockCount(accessToken: string, location: string): Promise<StockCountRow> {
  const res = await fetch(`${API_URL}/api/ledger/stock-counts/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ location, status: "open" }),
  });
  if (!res.ok) throw new Error("Could not start a stock count.");
  return res.json();
}

export async function updateStockCount(
  accessToken: string,
  id: string,
  patch: { status?: "open" | "closed"; counted_at?: string }
): Promise<StockCountRow> {
  const res = await fetch(`${API_URL}/api/ledger/stock-counts/${id}/`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("Could not update this stock count.");
  return res.json();
}

export async function createCountAssignment(
  accessToken: string,
  input: { count: string; section: string; assigned_to?: string | null; status?: string }
): Promise<CountAssignmentRow> {
  const res = await fetch(`${API_URL}/api/ledger/count-assignments/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("Could not create this assignment.");
  return res.json();
}

export async function updateCountAssignment(
  accessToken: string,
  id: string,
  patch: { assigned_to?: string | null; status?: "to_do" | "in_progress" | "complete" }
): Promise<CountAssignmentRow> {
  const res = await fetch(`${API_URL}/api/ledger/count-assignments/${id}/`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("Could not update this assignment.");
  return res.json();
}

export interface NewCountLineInput {
  count: string;
  item: string;
  counted_qty: string;
  reason?: string | null;
  note?: string | null;
}

export async function createCountLine(accessToken: string, input: NewCountLineInput): Promise<CountLineRow> {
  const res = await fetch(`${API_URL}/api/ledger/count-lines/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (body && typeof body === "object") {
      const messages = Object.entries(body).map(
        ([field, errs]) => `${field}: ${Array.isArray(errs) ? errs.join(", ") : errs}`
      );
      throw new Error(messages.join(" · ") || "Could not save this count line.");
    }
    throw new Error("Could not save this count line.");
  }
  return res.json();
}