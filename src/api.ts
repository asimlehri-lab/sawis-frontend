// Backend base URL. Overridable per Vercel environment via VITE_API_URL
// (Production -> the live Frankfurt backend, Preview -> the staging backend),
// so a `staging` branch never has to diverge from `main` on this line and
// cause a merge conflict every time staging is promoted. Falls back to the
// production URL for local dev too, per the "frontend always talks to
// production" convention documented in the project handoff.
const API_URL = import.meta.env.VITE_API_URL || "https://sawis-backend-1.onrender.com";

// Currency is a per-Location display setting (Settings → Locations) — which
// symbol/format a location's own prices and reports show, not a live
// exchange rate. Numbers stay exactly as entered; nothing is converted
// between currencies. Items/Recipes/Suppliers (and their prices) are
// org-wide, not per-location, so the same stored price can show under a
// different symbol depending which location's currency you're viewing it
// from — screens with no single location in view (Item/Recipe detail) fall
// back to the org's first location's currency via `defaultCurrency()`.
export type CurrencyCode = "EUR" | "GBP";
export const CURRENCY_OPTIONS: { code: CurrencyCode; label: string }[] = [
  { code: "EUR", label: "Euro (€)" },
  { code: "GBP", label: "British pound (£)" },
];
const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = { EUR: "€", GBP: "£" };

export function currencySymbol(code: string | null | undefined): string {
  return CURRENCY_SYMBOLS[(code as CurrencyCode) ?? "GBP"] ?? "£";
}

// Formats a money amount with the right symbol, 2 decimal places by
// default (pass `d` for a different precision, e.g. 0 for a rounded
// minimum-order threshold).
export function formatMoney(n: number, currency?: string | null, d = 2): string {
  return `${currencySymbol(currency)}${n.toLocaleString("en-GB", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })}`;
}

// Fallback currency for screens with no single location in view (an item's
// or recipe's own price is org-wide, not tied to one location) — the org's
// first location's currency, or GBP if there are no locations yet.
export function defaultCurrency(locations: { currency?: string }[]): CurrencyCode {
  return (locations[0]?.currency as CurrencyCode) ?? "GBP";
}

// Supplier unit/pack conversion — shared by ItemDetail's "Link" flow, the
// Scan receipt review table, and the supplier catalogue importer. A
// supplier very often prices things in a different unit than the item is
// actually costed/used in (a syrup invoiced per kg but used in grams on a
// recipe; a case of 24 bottles invoiced as one line). Getting this
// conversion wrong silently corrupts recipe costing, so every one of those
// three screens funnels through convertToBaseUnit() below rather than
// sending a supplier's raw price straight into ItemSupplier.unit_price /
// POLine.unit_price.
//
// This is a deliberate parallel copy of the UNIT_FAMILY/UNIT_BASE/
// autoFactor helper already living in ItemDetail.tsx (built earlier for an
// unrelated "change item's base unit" modal) rather than a shared import —
// that existing feature works today and isn't worth the risk of a refactor
// just to dedupe a ~15-line lookup table.
type UnitFamily = "weight" | "volume" | "count";
export const UNIT_FAMILY: Record<string, UnitFamily> = {
  g: "weight", kg: "weight", ml: "volume", L: "volume",
  ea: "count", portion: "count", btl: "count", case: "count", dozen: "count",
};
const UNIT_BASE: Record<string, number> = { g: 1, kg: 1000, ml: 1, L: 1000 };

// How many of `to` one `from` actually contains (e.g. autoFactor("kg","g")
// = 1000). Only computable when both units are the same family and that
// family isn't "count" — a supplier "case" or "dozen" carries no fixed
// numeric relationship to the item's base unit on its own; that has to be
// a human-entered pack size instead (see base_qty_per_unit below).
export function autoFactor(from: string, to: string): number | null {
  const famFrom = UNIT_FAMILY[from];
  const famTo = UNIT_FAMILY[to];
  if (!famFrom || famFrom !== famTo || famFrom === "count") return null;
  return UNIT_BASE[from] / UNIT_BASE[to];
}

// Converts a supplier's raw per-unit price into a true price per the
// item's base_unit, given how many base_units one supplier unit contains
// (base_qty_per_unit — from autoFactor() when known automatically, or a
// number the user typed in for a pack/case). Returns null (rather than
// throwing or silently dividing by a bad number) when qtyPerUnit isn't a
// usable positive number, so callers can block submission instead of
// storing a corrupted cost.
export function convertToBaseUnit(supplierPrice: number, qtyPerUnit: number | null | undefined): number | null {
  if (!Number.isFinite(supplierPrice)) return null;
  if (!qtyPerUnit || !Number.isFinite(qtyPerUnit) || qtyPerUnit <= 0) return null;
  return supplierPrice / qtyPerUnit;
}

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
  // Most recent real sign-in — null means never signed in since login
  // tracking was turned on, not necessarily "never used the account."
  last_login: string | null;
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
  default_supplier: string | null;
  archived: boolean;
  holdings: ItemHolding[];
  // Included so the Items list can be searched by a supplier's own item
  // code, not just by our SKU/name -- see ItemSupplierRow.supplier_sku.
  supplier_links: ItemSupplierRow[];
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

// Every list endpoint is paginated server-side (DRF PageNumberPagination,
// PAGE_SIZE=50 -- see config/settings.py) -- a plain authedFetch() only
// ever returns page 1, silently dropping anything past the 50th row. This
// follows `next` until it runs out and returns every row. Found the hard
// way: importing 201 recipes left only the first 50 visible anywhere in
// the frontend (Recipes list, End of day's sales-import matcher, etc.),
// since every fetchX() below used to read `.results` off a single-page
// response directly.
//
// `next` is a DRF-built absolute URL (scheme+host+path+query) -- on Render,
// without SECURE_PROXY_SSL_HEADER configured, Django can't tell the
// original request came in over https and may build it as a plain http://
// URL, which the browser silently blocks as mixed content from this
// https:// app. Sidestepping that entirely: only the path+query is ever
// taken from `next`, always refetched against our own known API_URL, never
// whatever host/scheme the backend actually returned.
async function authedFetchAllPages<T>(path: string, accessToken: string): Promise<T[]> {
  const results: T[] = [];
  let next: string | null = path;
  while (next) {
    const { pathname, search } = new URL(next, API_URL);
    const res = await fetch(`${API_URL}${pathname}${search}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Request failed (${res.status}) for ${pathname}`);
    }
    const data: Paginated<T> = await res.json();
    results.push(...data.results);
    next = data.next;
  }
  return results;
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

// The refresh half of the pair `login()` returns. The backend's SIMPLE_JWT
// config (config/settings.py) has ROTATE_REFRESH_TOKENS=True, so a
// successful call also returns a NEW refresh token — always store whichever
// one comes back, not just the access token, or the next refresh will use a
// stale one. Access tokens live 8 hours, refresh tokens 14 days; this is
// what lets a signed-in session survive a page reload (see App.tsx's
// restore-on-load effect) instead of forcing a fresh sign-in every time.
export async function refreshAccessToken(refreshToken: string): Promise<TokenPair> {
  const res = await fetch(`${API_URL}/api/auth/token/refresh/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh: refreshToken }),
  });
  if (!res.ok) {
    throw new Error("Session expired — please sign in again.");
  }
  return res.json();
}

export async function fetchItems(accessToken: string): Promise<CatalogItem[]> {
  return authedFetchAllPages<CatalogItem>("/api/catalog/items/", accessToken);
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
  // Optional par level for the ItemHolding this import creates at
  // `location`. Omitted/blank defaults to 0 server-side, same as before
  // this field existed. Only ever applied when a NEW holding is created
  // (a brand-new item, or backfilling a missing holding for an existing
  // item) -- never overwrites an already-set par level on a holding that
  // already exists, matching bulk_import's existing "never clobber what's
  // already there" behavior.
  par_level?: string;
  // Optional supplier name + per-unit cost, provided together. When both
  // are present the backend finds-or-creates a Supplier by this name,
  // upserts a SupplierItem (the background catalogue row) for this item's
  // name at this price, and links it to the item via ItemSupplier -- the
  // same end state as manually importing a supplier catalogue and then
  // clicking "Link" on the item, done in one step. Re-importing the same
  // row later refreshes the price on both the SupplierItem and the
  // ItemSupplier link. Providing only one of the two does nothing --
  // there's no such thing as a cost with no supplier or vice versa.
  supplier?: string;
  cost?: string;
}

export interface BulkItemImportResult {
  created: CatalogItem[];
  // Names of items that already existed by name and so weren't
  // duplicated — but had no ItemHolding at `location` yet, so one was
  // created for them. Re-running the same CSV through this screen is
  // the supported way to backfill holdings for items that were
  // imported before ItemHolding creation existed here.
  holdings_backfilled: string[];
  // Names of NEW suppliers created because no existing supplier at this
  // org matched the given name (case-insensitive). An empty array doesn't
  // mean no supplier/cost data was processed -- it just means every named
  // supplier already existed.
  suppliers_created: string[];
  // Names of items whose supplier link (unit_price + the underlying
  // SupplierItem price) was set or refreshed by this import's supplier/
  // cost columns.
  supplier_links_set: string[];
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
  // The POS system's own ID for this dish -- shown and searchable so a
  // long menu can be found by the number on a till report, not just by
  // name. Also what a future POS sales import matches against first.
  // Purely a lookup aid, never required, never auto-generated.
  pos_id: string;
  // A lightweight grouping label for the menu (e.g. "Coffee", "Green
  // Tea") -- distinct from menu_group. Purely for filtering/browsing a
  // long menu; no effect on costing or reporting.
  menu_category: string;
  lines: RecipeLine[];
  batch_cost: number;
  per_portion_cost: number;
  plate_food_cost_pct: number | null;
}

export const YIELD_UNITS = ["plate", "portion", "glass", "kg", "litre"];

export interface NewRecipeInput {
  kind: "dish" | "sub";
  name: string;
  yield_qty: string;
  yield_unit: string;
  menu_price?: string;
}

export async function fetchRecipes(accessToken: string): Promise<Recipe[]> {
  return authedFetchAllPages<Recipe>("/api/catalog/recipes/", accessToken);
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
  // POS ID and menu category, both optional — when `pos_id` matches an
  // existing recipe (or, failing that, the name does, case-insensitive),
  // the backend UPDATES that recipe instead of creating a duplicate, and
  // replaces its ingredient lines with the ones in this row. See
  // RecipeViewSet.bulk_import's upsert docstring.
  pos_id?: string;
  menu_category?: string;
  // Optional, same "only applied when provided" treatment as pos_id/
  // menu_category — omit it and an existing recipe's menu_group is left
  // alone. Only the "Import menu list" modal sends this (a Food/Drink
  // picker per row); the Advanced CSV template has no equivalent column.
  menu_group?: "food" | "drink";
  lines: BulkRecipeLineInput[];
}

export interface BulkRecipeImportResult {
  // NOTE: the backend deliberately does NOT return the full created/
  // updated Recipe objects here (no `recipes` field) — for a large
  // import (200+ dishes from a real POS menu export), serializing every
  // recipe with its nested lines and cost fields was slow enough to
  // blow past the request timeout even though the import itself had
  // already committed. Neither caller of bulkImportRecipes reads a
  // `recipes` field, so it was dropped rather than optimized — see
  // RecipeViewSet.bulk_import's docstring on the backend for the full
  // story.
  created: number;
  updated: number;
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
  pos_id?: string;
  menu_category?: string;
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
  return authedFetchAllPages<Category>("/api/catalog/categories/", accessToken);
}

export interface NewCategoryInput {
  name: string;
  default_vat_rate: string;
}

export async function createCategory(accessToken: string, input: NewCategoryInput): Promise<Category> {
  const res = await fetch(`${API_URL}/api/catalog/categories/`, {
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
      throw new Error(messages.join(" · ") || "Could not create category.");
    }
    throw new Error("Could not create category.");
  }
  return res.json();
}

export interface Location {
  id: string;
  org: string;
  name: string;
  timezone: string;
  // Display currency for this location's own prices/reports — see the
  // CurrencyCode/formatMoney notes above. Defaults to GBP server-side.
  currency: CurrencyCode;
  // Rent + labour + other fixed monthly costs, set by hand in Settings.
  // Only used to estimate End of day's net margin — null means net
  // margin can't be computed yet, and the report says so rather than
  // guessing zero overhead.
  monthly_overhead: string | null;
}

export async function fetchLocations(accessToken: string): Promise<Location[]> {
  return authedFetchAllPages<Location>("/api/tenancy/locations/", accessToken);
}

export async function updateLocation(
  accessToken: string,
  id: string,
  patch: { currency?: CurrencyCode; monthly_overhead?: string | null }
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
  return authedFetchAllPages<Membership>("/api/tenancy/memberships/", accessToken);
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
  default_supplier?: string | null;
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
  return authedFetchAllPages<Supplier>("/api/catalog/suppliers/", accessToken);
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
  // How many of the eventually-linked Item's base_unit one `unit` above
  // actually contains (e.g. "1000" when unit="kg" and the item is costed
  // in grams). Defaults to "1" server-side ("no conversion") for rows that
  // never set it, so this is always present even from an import that
  // predates the field.
  base_qty_per_unit: string;
  imported_at: string;
}

export async function fetchSupplierItems(accessToken: string): Promise<SupplierItemRow[]> {
  return authedFetchAllPages<SupplierItemRow>("/api/catalog/supplier-items/", accessToken);
}

export interface NewSupplierItemInput {
  supplier: string;
  raw_name: string;
  unit: string;
  price: string;
  base_qty_per_unit?: string;
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

export interface BulkImportSupplierItemsInput {
  supplier: string;
  rows: { name: string; unit: string; price: string; base_qty_per_unit?: string }[];
}

export interface BulkImportSupplierItemsResult {
  created: SupplierItemRow[];
  updated: SupplierItemRow[];
  // Names of Items whose already-confirmed ItemSupplier link got its
  // unit_price refreshed to match a row that updated an existing raw
  // catalogue line — see SupplierItemViewSet.bulk_import. Without this,
  // a re-import only ever touched the background catalogue table, never
  // the price an already-linked item actually costs against.
  linked_prices_synced: string[];
}

// Upserts by (supplier, raw_name) on the backend instead of one create-only
// POST per row — re-importing a supplier's catalogue with updated prices
// now refreshes the existing lines rather than piling up duplicates. See
// SupplierItemViewSet.bulk_import.
export async function bulkImportSupplierItems(
  accessToken: string,
  input: BulkImportSupplierItemsInput
): Promise<BulkImportSupplierItemsResult> {
  const res = await fetch(`${API_URL}/api/catalog/supplier-items/bulk_import/`, {
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
      throw new Error(messages.join(" · ") || "Could not import the catalogue.");
    }
    throw new Error("Could not import the catalogue.");
  }
  return res.json();
}

export interface ItemSupplierRow {
  id: string;
  item: string;
  supplier: string;
  supplier_name: string;
  // ALWAYS a true price per the item's own base_unit -- see
  // apps/catalog/models.py ItemSupplier.unit_price. Never the supplier's
  // raw per-pack/per-kg price; that's supplier_unit_price below.
  unit_price: string;
  // The unit/pack as the supplier actually sells it (e.g. "kg", "case") --
  // blank means "same as the item's base_unit, no conversion on file".
  // Display-only; unit_price above is always the source of truth for cost.
  supplier_unit: string;
  // The raw price as actually invoiced, per supplier_unit -- null when
  // supplier_unit is blank/unknown. Shown alongside unit_price so the user
  // sees their own supplier's price, not just our converted figure.
  supplier_unit_price: string | null;
  min_order_qty: string | null;
  last_ordered_at: string | null;
  matched_from: string | null;
  // The SUPPLIER's own product code for this item -- distinct from
  // Item.sku (our own internal code). A lookup aid only, never required.
  supplier_sku: string;
}

export async function fetchItemSuppliers(accessToken: string): Promise<ItemSupplierRow[]> {
  return authedFetchAllPages<ItemSupplierRow>("/api/catalog/item-suppliers/", accessToken);
}

export interface NewItemSupplierInput {
  item: string;
  supplier: string;
  unit_price: string;
  supplier_unit?: string;
  supplier_unit_price?: string;
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

export async function updateItemSupplier(
  accessToken: string,
  id: string,
  patch: {
    supplier_sku?: string;
    unit_price?: string;
    supplier_unit?: string;
    supplier_unit_price?: string | null;
    min_order_qty?: string | null;
  }
): Promise<ItemSupplierRow> {
  const res = await fetch(`${API_URL}/api/catalog/item-suppliers/${id}/`, {
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
  // As-invoiced unit/qty, frozen on this line at receive time (e.g. "L" /
  // "1" even though qty/received_qty above are always the true, converted
  // per-item.base_unit figures) -- blank/null whenever no conversion was
  // needed. See PurchaseOrderViewSet.receive / the supplier unit/pack
  // conversion feature.
  supplier_unit: string;
  supplier_qty: string | null;
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
  // Our own reference (e.g. "PO-0007"), generated server-side at creation --
  // never blank for a new PO, though an older PO created before this field
  // existed can be "".
  po_number: string;
  // The supplier's own invoice/receipt number -- unknown until the delivery
  // arrives, so null until then (set by hand, or picked up from a scan).
  invoice_number: string | null;
  created_by: string;
  lines: POLineRow[];
  total: string;
}

export async function fetchPurchaseOrders(accessToken: string): Promise<PurchaseOrder[]> {
  return authedFetchAllPages<PurchaseOrder>("/api/procurement/purchase-orders/", accessToken);
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
  invoice_number?: string | null;
  // Only actually accepted by the API while the order is still a draft --
  // see PurchaseOrderSerializer.validate_po_number on the backend.
  po_number?: string;
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

export interface ScannedReceiptLineItem {
  description: string;
  quantity: string | null;
  unit_price: string | null;
  confidence: number | null;
}

export interface ScannedReceipt {
  vendor_name: string | null;
  vendor_confidence: number | null;
  date: string | null;
  date_confidence: number | null;
  total: string | null;
  total_confidence: number | null;
  // A supplier sometimes prints OUR purchase order number back onto their
  // invoice/delivery note -- used client-side to suggest matching an
  // existing sent/awaiting PO instead of always creating a new one.
  po_number: string | null;
  po_number_confidence: number | null;
  // The supplier's OWN invoice/receipt number -- separate from po_number
  // above (that's ours, this is theirs).
  invoice_number: string | null;
  invoice_number_confidence: number | null;
  line_items: ScannedReceiptLineItem[];
}

// Uploads a receipt/invoice photo to the backend, which runs it through
// AWS Textract and hands back the parsed fields. No PurchaseOrder or
// POLine gets created by this call -- matching the vendor to a Supplier
// and each line item to an Item both happen client-side afterwards (see
// the Scan receipt modal in App.tsx), the same fuzzy-match-then-confirm
// pattern already used by the supplier-catalogue import and End of day's
// sales CSV importer.
export async function scanReceipt(accessToken: string, file: File): Promise<ScannedReceipt> {
  const formData = new FormData();
  formData.append("image", file);
  // No Content-Type header here on purpose -- the browser sets the
  // multipart boundary itself when the body is a FormData; setting it
  // by hand breaks the upload.
  const res = await fetch(`${API_URL}/api/procurement/scan-receipt/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error((body && typeof body === "object" && body.detail) || "Could not scan that receipt.");
  }
  return res.json();
}

export interface ReceiveLineOverride {
  id: string;
  // Always true per-item.base_unit values -- any supplier-side unit/pack
  // conversion must already have happened client-side before this is sent.
  received_qty: string;
  received_unit_price: string;
  // Optional, display-only: the raw unit/price as the supplier actually
  // invoiced it (e.g. "kg" / "12.00"), so the receiving ItemSupplier link
  // remembers the supplier's own pricing alongside the converted figure.
  // Omit entirely (don't send empty strings) to leave whatever's already
  // on file untouched -- see PurchaseOrderViewSet.receive.
  supplier_unit?: string;
  supplier_unit_price?: string;
  // The as-invoiced quantity in that same supplier_unit (e.g. "1" for "1
  // L") -- frozen directly onto this POLine (not ItemSupplier) so a
  // received order always shows the unit/qty its own invoice actually
  // used, letting the user cross-check the two side by side.
  supplier_qty?: string;
}

export async function receivePurchaseOrder(
  accessToken: string,
  id: string,
  lines: ReceiveLineOverride[],
  invoiceNumber?: string | null
): Promise<PurchaseOrder> {
  const res = await fetch(`${API_URL}/api/procurement/purchase-orders/${id}/receive/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(invoiceNumber ? { lines, invoice_number: invoiceNumber } : { lines }),
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
  return authedFetchAllPages<WasteEventRow>("/api/ledger/waste-events/", accessToken);
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

// Powers the "Last imported" line on End of day's compact import control —
// reads back when a CSV was actually uploaded (Sale.created_at), not the
// business date inside the file (Sale.occurred_at).
export async function fetchLastImportDate(accessToken: string, location: string): Promise<string | null> {
  const params = new URLSearchParams({ location });
  const data: { last_imported_at: string | null } = await authedFetch(
    `/api/ledger/sales/last_import/?${params.toString()}`,
    accessToken
  );
  return data.last_imported_at;
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
  return authedFetchAllPages<StockMovementRow>("/api/ledger/stock-movements/", accessToken);
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
  return authedFetchAllPages<Section>("/api/catalog/sections/", accessToken);
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
  return authedFetchAllPages<StockCountRow>("/api/ledger/stock-counts/", accessToken);
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

export interface ScannedCountRow {
  item_text: string;
  qty_text: string;
  confidence: number | null;
}

// Uploads a photo of a filled-in, printed count sheet (see the "Print
// sheets" button in Inventory.tsx's Count sheets tab) to the backend, which
// runs it through AWS Textract and hands back the raw rows it found. No
// CountLine or StockMovement gets created by this call -- matching each
// row's item text to a real Item, and saving the result, both happen
// client-side in CountSheet, the same fuzzy-match-then-confirm pattern
// already used by Scan receipt and the supplier-catalogue import.
export async function scanCountSheet(accessToken: string, file: File): Promise<{ rows: ScannedCountRow[] }> {
  const formData = new FormData();
  formData.append("image", file);
  // No Content-Type header here on purpose -- the browser sets the
  // multipart boundary itself when the body is a FormData; setting it
  // by hand breaks the upload.
  const res = await fetch(`${API_URL}/api/ledger/scan-count-sheet/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error((body && typeof body === "object" && body.detail) || "Could not scan that count sheet.");
  }
  return res.json();
}