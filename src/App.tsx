import { useEffect, useState } from "react";
import {
  login,
  getMe,
  fetchItems,
  createItem,
  BASE_UNITS,
  fetchRecipes,
  createRecipe,
  YIELD_UNITS,
  fetchCategories,
  fetchLocations,
  fetchSuppliers,
  fetchSupplierItems,
  bulkImportSupplierItems,
  createSupplier,
  fetchPurchaseOrders,
  createPurchaseOrder,
  fetchItemSuppliers,
  fetchWasteEvents,
  fetchStockMovements,
  fetchSections,
  fetchStockCounts,
  fetchMemberships,
} from "./api";
import type {
  Me,
  CatalogItem,
  Recipe,
  Category,
  Location,
  Supplier,
  SupplierItemRow,
  PurchaseOrder,
  ItemSupplierRow,
  WasteEventRow,
  StockMovementRow,
  Section,
  StockCountRow,
  Membership,
} from "./api";
import RecipeDetail from "./RecipeDetail";
import ItemDetail from "./ItemDetail";
import ProcurementDetail from "./ProcurementDetail";
import SupplierDeliveries from "./SupplierDeliveries";
import WasteLog from "./WasteLog";
import Inventory from "./Inventory";
import Team from "./Team";
import EndOfDay from "./EndOfDay";
import Settings from "./Settings";
import Reports from "./Reports";
import "./App.css";

const NAV_ITEMS = [
  "End of day",
  "Inventory",
  "Items",
  "Procurement",
  "Recipes",
  "Waste log",
  "Reports",
  "Team",
];

export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

// Next occurrence of a weekday (0=Monday..6=Sunday), counting today as valid.
export function nextDeliveryDate(deliveryDay: number): Date {
  const today = new Date();
  const todayDow = (today.getDay() + 6) % 7;
  let diff = deliveryDay - todayDow;
  if (diff < 0) diff += 7;
  const result = new Date(today);
  result.setDate(today.getDate() + diff);
  return result;
}

export default function App() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [activePage, setActivePage] = useState("Items");

  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [showNewItem, setShowNewItem] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSku, setNewSku] = useState("");
  const [newUnit, setNewUnit] = useState(BASE_UNITS[1]);
  const [newVatPct, setNewVatPct] = useState("");
  const [savingItem, setSavingItem] = useState(false);
  const [newItemError, setNewItemError] = useState<string | null>(null);

  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  const [recipesError, setRecipesError] = useState<string | null>(null);
  const [showNewRecipe, setShowNewRecipe] = useState(false);
  const [newRecipeKind, setNewRecipeKind] = useState<"dish" | "sub">("dish");
  const [newRecipeName, setNewRecipeName] = useState("");
  const [newYieldQty, setNewYieldQty] = useState("1");
  const [newYieldUnit, setNewYieldUnit] = useState(YIELD_UNITS[0]);
  const [newMenuPrice, setNewMenuPrice] = useState("");
  const [savingRecipe, setSavingRecipe] = useState(false);
  const [newRecipeError, setNewRecipeError] = useState<string | null>(null);
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierItems, setSupplierItems] = useState<SupplierItemRow[]>([]);

  const [showImport, setShowImport] = useState(false);
  const [importSupplier, setImportSupplier] = useState("");
  const [importRows, setImportRows] = useState<{ name: string; unit: string; price: string }[]>([]);
  const [importFileName, setImportFileName] = useState("");
  const [importSaving, setImportSaving] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importDone, setImportDone] = useState<{ created: number; updated: number } | null>(null);

  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierEmail, setNewSupplierEmail] = useState("");
  const [newSupplierDay, setNewSupplierDay] = useState("");
  const [newSupplierMin, setNewSupplierMin] = useState("");
  const [savingSupplier, setSavingSupplier] = useState(false);
  const [newSupplierError, setNewSupplierError] = useState<string | null>(null);

  const [recipeFilter, setRecipeFilter] = useState<"all" | "dish" | "sub">("all");

  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[] | null>(null);
  const [poError, setPoError] = useState<string | null>(null);
  const [selectedPOId, setSelectedPOId] = useState<string | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [showNewPO, setShowNewPO] = useState(false);
  const [newPOSupplier, setNewPOSupplier] = useState("");
  const [newPOLocation, setNewPOLocation] = useState("");
  const [newPOExpected, setNewPOExpected] = useState("");
  const [savingPO, setSavingPO] = useState(false);
  const [newPOError, setNewPOError] = useState<string | null>(null);
  const [poFilter, setPoFilter] = useState<"all" | "draft" | "sent" | "received">("all");
  const [itemSupplierLinks, setItemSupplierLinks] = useState<ItemSupplierRow[]>([]);

  const [wasteEvents, setWasteEvents] = useState<WasteEventRow[] | null>(null);
  const [wasteError, setWasteError] = useState<string | null>(null);
  const [stockMovements, setStockMovements] = useState<StockMovementRow[]>([]);

  const [sections, setSections] = useState<Section[]>([]);
  const [sectionsError, setSectionsError] = useState<string | null>(null);
  const [stockCounts, setStockCounts] = useState<StockCountRow[] | null>(null);
  const [stockCountsError, setStockCountsError] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [membershipsError, setMembershipsError] = useState<string | null>(null);

  function loadItems(token: string) {
    setItemsError(null);
    fetchItems(token)
      .then(setItems)
      .catch((err) => setItemsError(err instanceof Error ? err.message : "Could not load items."));
  }

  function loadRecipes(token: string) {
    setRecipesError(null);
    fetchRecipes(token)
      .then(setRecipes)
      .catch((err) => setRecipesError(err instanceof Error ? err.message : "Could not load recipes."));
  }

  function loadPOs(token: string) {
    setPoError(null);
    fetchPurchaseOrders(token)
      .then(setPurchaseOrders)
      .catch((err) => setPoError(err instanceof Error ? err.message : "Could not load purchase orders."));
  }

  function loadWasteEvents(token: string) {
    setWasteError(null);
    fetchWasteEvents(token)
      .then(setWasteEvents)
      .catch((err) => setWasteError(err instanceof Error ? err.message : "Could not load waste log."));
    fetchStockMovements(token).then(setStockMovements).catch(() => {});
  }

  function loadSections(token: string) {
    setSectionsError(null);
    fetchSections(token)
      .then(setSections)
      .catch((err) => setSectionsError(err instanceof Error ? err.message : "Could not load sections."));
  }

  function loadStockCounts(token: string) {
    setStockCountsError(null);
    fetchStockCounts(token)
      .then(setStockCounts)
      .catch((err) => setStockCountsError(err instanceof Error ? err.message : "Could not load stock counts."));
  }

  function loadMemberships(token: string) {
    setMembershipsError(null);
    fetchMemberships(token)
      .then(setMemberships)
      .catch((err) => setMembershipsError(err instanceof Error ? err.message : "Could not load the team."));
  }

  useEffect(() => {
    if (!accessToken) return;
    if (activePage === "Items") {
      loadItems(accessToken);
      fetchCategories(accessToken).then(setCategories).catch(() => {});
      fetchLocations(accessToken).then(setLocations).catch(() => {});
      fetchSuppliers(accessToken).then(setSuppliers).catch(() => {});
      fetchSupplierItems(accessToken).then(setSupplierItems).catch(() => {});
    }
    if (activePage === "Recipes") {
      loadRecipes(accessToken);
      if (!items) loadItems(accessToken); // recipe detail needs the item picker too
    }
    if (activePage === "Procurement") {
      loadPOs(accessToken);
      if (!items) loadItems(accessToken);
      fetchLocations(accessToken).then(setLocations).catch(() => {});
      fetchSuppliers(accessToken).then(setSuppliers).catch(() => {});
      fetchItemSuppliers(accessToken).then(setItemSupplierLinks).catch(() => {});
    }
    if (activePage === "Waste log") {
      loadWasteEvents(accessToken);
      if (!items) loadItems(accessToken);
      fetchLocations(accessToken).then(setLocations).catch(() => {});
      fetchItemSuppliers(accessToken).then(setItemSupplierLinks).catch(() => {});
    }
    if (activePage === "Inventory") {
      if (!items) loadItems(accessToken);
      fetchLocations(accessToken).then(setLocations).catch(() => {});
      fetchItemSuppliers(accessToken).then(setItemSupplierLinks).catch(() => {});
      loadSections(accessToken);
      loadStockCounts(accessToken);
      fetchStockMovements(accessToken).then(setStockMovements).catch(() => {});
      loadMemberships(accessToken);
    }
    if (activePage === "Team") {
      loadMemberships(accessToken);
      fetchLocations(accessToken).then(setLocations).catch(() => {});
    }
    if (activePage === "End of day") {
      loadRecipes(accessToken);
      if (!items) loadItems(accessToken);
      fetchLocations(accessToken).then(setLocations).catch(() => {});
      fetchSuppliers(accessToken).then(setSuppliers).catch(() => {});
      fetchItemSuppliers(accessToken).then(setItemSupplierLinks).catch(() => {});
    }
    if (activePage === "Settings") {
      if (!items) loadItems(accessToken);
      loadRecipes(accessToken);
      fetchLocations(accessToken).then(setLocations).catch(() => {});
    }
    if (activePage === "Reports") {
      fetchLocations(accessToken).then(setLocations).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, activePage]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const tokens = await login(email, password);
      const profile = await getMe(tokens.access);
      setMe(profile);
      setAccessToken(tokens.access);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    setMe(null);
    setAccessToken(null);
    setItems(null);
    setRecipes(null);
    setSelectedRecipeId(null);
    setSelectedItemId(null);
    setEmail("");
    setPassword("");
  }

  function goToNav(label: string) {
    setActivePage(label);
    setSelectedRecipeId(null);
    setSelectedItemId(null);
    setShowImport(false);
    setSelectedPOId(null);
    setSelectedSupplierId(null);
    setShowNewPO(false);
  }

  function openNewPOForSupplier(supplierId: string, expectedDateISO: string) {
    setNewPOSupplier(supplierId);
    setNewPOLocation("");
    setNewPOExpected(expectedDateISO);
    setNewPOError(null);
    setShowNewPO(true);
  }

  function resetNewItemForm() {
    setNewName("");
    setNewSku("");
    setNewUnit(BASE_UNITS[1]);
    setNewVatPct("");
    setNewItemError(null);
  }

  async function handleCreateItem(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setNewItemError(null);
    setSavingItem(true);
    try {
      const vatFraction = newVatPct.trim() === "" ? null : (Number(newVatPct) / 100).toFixed(4);
      const created = await createItem(accessToken, { name: newName, sku: newSku, base_unit: newUnit, vat_rate: vatFraction });
      setShowNewItem(false);
      resetNewItemForm();
      loadItems(accessToken);
      setSelectedItemId(created.id);
    } catch (err) {
      setNewItemError(err instanceof Error ? err.message : "Could not create item.");
    } finally {
      setSavingItem(false);
    }
  }

  function resetImport() {
    setImportSupplier("");
    setImportRows([]);
    setImportFileName("");
    setImportError(null);
    setImportDone(null);
    setShowNewSupplier(false);
    setNewSupplierName("");
    setNewSupplierEmail("");
    setNewSupplierDay("");
    setNewSupplierMin("");
    setNewSupplierError(null);
  }

  async function handleCreateSupplier() {
    if (!accessToken || !newSupplierName.trim()) return;
    setSavingSupplier(true);
    setNewSupplierError(null);
    try {
      const created = await createSupplier(accessToken, {
        name: newSupplierName.trim(),
        contact_email: newSupplierEmail.trim() || null,
        delivery_day: newSupplierDay === "" ? null : Number(newSupplierDay),
        min_order_value: newSupplierMin.trim() === "" ? null : Number(newSupplierMin).toFixed(2),
      });
      setSuppliers((prev) => [...prev, created]);
      setImportSupplier(created.id);
      setShowNewSupplier(false);
      setNewSupplierName("");
      setNewSupplierEmail("");
      setNewSupplierDay("");
      setNewSupplierMin("");
    } catch (err) {
      setNewSupplierError(err instanceof Error ? err.message : "Could not create supplier.");
    } finally {
      setSavingSupplier(false);
    }
  }

  function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    setImportError(null);
    setImportDone(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const rows: { name: string; unit: string; price: string }[] = [];
      text.split(/\r?\n/).forEach((line) => {
        if (!line.trim()) return;
        const parts = line.split(",").map((p) => p.trim());
        if (parts.length >= 3 && parts[0] && !isNaN(Number(parts[2]))) {
          rows.push({ name: parts[0], unit: parts[1], price: parts[2] });
        }
      });
      setImportRows(rows);
      if (rows.length === 0) {
        setImportError('No valid rows found — each line should read "name,unit,price", e.g. "Beef mince 5%,kg,7.40".');
      }
    };
    reader.readAsText(file);
  }

  async function handleImportSubmit() {
    if (!accessToken || !importSupplier || importRows.length === 0) return;
    setImportSaving(true);
    setImportError(null);
    try {
      // One bulk request instead of one POST per row — the backend upserts
      // by (supplier, raw_name), so re-running an updated CSV refreshes
      // existing lines' price/unit in place instead of duplicating them.
      const result = await bulkImportSupplierItems(accessToken, {
        supplier: importSupplier,
        rows: importRows.map((r) => ({ name: r.name, unit: r.unit, price: r.price })),
      });
      setImportDone({ created: result.created.length, updated: result.updated.length });
      fetchSupplierItems(accessToken).then(setSupplierItems).catch(() => {});
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Something went wrong partway through the import.");
    } finally {
      setImportSaving(false);
    }
  }

  function resetNewRecipeForm() {
    setNewRecipeKind("dish");
    setNewRecipeName("");
    setNewYieldQty("1");
    setNewYieldUnit(YIELD_UNITS[0]);
    setNewMenuPrice("");
    setNewRecipeError(null);
  }

  async function handleCreateRecipe(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setNewRecipeError(null);
    setSavingRecipe(true);
    try {
      const created = await createRecipe(accessToken, {
        kind: newRecipeKind,
        name: newRecipeName,
        yield_qty: newYieldQty,
        yield_unit: newYieldUnit,
        ...(newRecipeKind === "dish" ? { menu_price: newMenuPrice } : {}),
      });
      setShowNewRecipe(false);
      resetNewRecipeForm();
      loadRecipes(accessToken);
      setSelectedRecipeId(created.id); // jump straight into the new recipe to add ingredients
    } catch (err) {
      setNewRecipeError(err instanceof Error ? err.message : "Could not create recipe.");
    } finally {
      setSavingRecipe(false);
    }
  }

  function resetNewPOForm() {
    setNewPOSupplier("");
    setNewPOLocation("");
    setNewPOExpected("");
    setNewPOError(null);
  }

  async function handleCreatePO(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken || !newPOSupplier || !newPOLocation) return;
    setNewPOError(null);
    setSavingPO(true);
    try {
      const created = await createPurchaseOrder(accessToken, {
        supplier: newPOSupplier,
        location: newPOLocation,
        expected_date: newPOExpected || null,
      });
      setShowNewPO(false);
      resetNewPOForm();
      loadPOs(accessToken);
      setSelectedPOId(created.id);
    } catch (err) {
      setNewPOError(err instanceof Error ? err.message : "Could not create purchase order.");
    } finally {
      setSavingPO(false);
    }
  }

  if (!me) {
    return (
      <div className="page">
        <div className="card">
          <div className="brandmark">S</div>
          <h1>sawis</h1>
          <p className="muted">Sign in to your back office</p>
          <form onSubmit={handleSubmit}>
            <label>
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label>
              Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brandmark small">S</div>
          <div>
            <b>sawis</b>
            <span>back office</span>
          </div>
        </div>
        <nav>
          {NAV_ITEMS.map((label) => (
            <button
              key={label}
              className={`nav-btn ${activePage === label ? "active" : ""}`}
              onClick={() => goToNav(label)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="ava">{(me.name || me.email).slice(0, 2).toUpperCase()}</div>
          <div>
            <b>{me.name || me.email}</b>
            <span>{me.org.name}</span>
          </div>
        </div>
        {me.memberships.some((m) => m.role === "admin") && (
          <button
            className={`nav-btn ${activePage === "Settings" ? "active" : ""}`}
            style={{ marginBottom: 4 }}
            onClick={() => goToNav("Settings")}
          >
            ⚙ Settings
          </button>
        )}
        <button className="btn-ghost logout" onClick={handleLogout}>
          Log out
        </button>
      </aside>

      <main className="content">
        {activePage === "Recipes" && selectedRecipeId && accessToken ? (
          <RecipeDetail
            recipeId={selectedRecipeId}
            accessToken={accessToken}
            items={items ?? []}
            allRecipes={recipes ?? []}
            onBack={() => setSelectedRecipeId(null)}
            onChanged={() => loadRecipes(accessToken)}
            onOpenRecipe={(id) => setSelectedRecipeId(id)}
          />
        ) : activePage === "Items" && selectedItemId && accessToken ? (
          <ItemDetail
            itemId={selectedItemId}
            accessToken={accessToken}
            userEmail={me.email}
            categories={categories}
            locations={locations}
            suppliers={suppliers}
            supplierItems={supplierItems}
            onBack={() => setSelectedItemId(null)}
            onChanged={() => loadItems(accessToken)}
            onCategoriesChanged={() => fetchCategories(accessToken).then(setCategories).catch(() => {})}
          />
        ) : activePage === "Procurement" && selectedPOId && accessToken ? (
          <ProcurementDetail
            poId={selectedPOId}
            accessToken={accessToken}
            items={items ?? []}
            suppliers={suppliers}
            itemSupplierLinks={itemSupplierLinks}
            onBack={() => setSelectedPOId(null)}
            onChanged={() => loadPOs(accessToken)}
            onOpenPO={(id) => setSelectedPOId(id)}
            backLabel={
              selectedSupplierId ? `← ${suppliers.find((s) => s.id === selectedSupplierId)?.name ?? "supplier"}` : undefined
            }
          />
        ) : activePage === "Procurement" && selectedSupplierId && accessToken ? (
          <SupplierDeliveries
            supplierId={selectedSupplierId}
            suppliers={suppliers}
            purchaseOrders={purchaseOrders ?? []}
            onBack={() => setSelectedSupplierId(null)}
            onOpenPO={(id) => setSelectedPOId(id)}
            onNewPO={openNewPOForSupplier}
          />
        ) : (
          <>
            <div className="content-head">
              <h1 className="page-title">{activePage}</h1>
              {activePage === "Items" && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn-ghost small" onClick={() => setShowImport(true)}>
                    ⇪ Import supplier list (CSV)
                  </button>
                  <button className="btn-primary small" onClick={() => setShowNewItem(true)}>
                    + New item
                  </button>
                </div>
              )}
              {activePage === "Recipes" && (
                <button className="btn-primary small" onClick={() => setShowNewRecipe(true)}>
                  + New recipe
                </button>
              )}
              {activePage === "Procurement" && (
                <button className="btn-primary small" onClick={() => setShowNewPO(true)}>
                  + New purchase order
                </button>
              )}
            </div>

            {activePage === "Items" && (
              <>
                {itemsError && <p className="error">{itemsError}</p>}
                {!itemsError && !items && <p className="muted">Loading items…</p>}
                {items && items.length === 0 && <p className="muted">No items yet.</p>}
                {items && items.length > 0 && (
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Category</th>
                        <th>Unit</th>
                        <th className="num">VAT</th>
                        <th className="num">Holdings</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it) => (
                        <tr key={it.id} className="clickable" onClick={() => setSelectedItemId(it.id)}>
                          <td className="dish">{it.name}</td>
                          <td className="muted">{it.category_name || "—"}</td>
                          <td className="muted">{it.base_unit}</td>
                          <td className="num">
                            {it.effective_vat_rate ? `${Number(it.effective_vat_rate) * 100}%` : "—"}
                          </td>
                          <td className="num">{it.holdings.length}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}

            {activePage === "Recipes" && (
              <>
                {recipesError && <p className="error">{recipesError}</p>}
                {!recipesError && !recipes && <p className="muted">Loading recipes…</p>}
                {recipes && recipes.length > 0 && (
                  <div className="rtabs">
                    {(["all", "dish", "sub"] as const).map((f) => (
                      <button
                        key={f}
                        className={`rtab ${recipeFilter === f ? "on" : ""}`}
                        onClick={() => setRecipeFilter(f)}
                      >
                        {f === "all" ? "All" : f === "dish" ? "Dishes" : "Sub-recipes"}
                      </button>
                    ))}
                  </div>
                )}
                {recipes && recipes.length === 0 && <p className="muted">No recipes yet.</p>}
                {recipes && recipes.length > 0 && (
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Recipe</th>
                        <th className="num">Yield</th>
                        <th className="num">Batch cost</th>
                        <th className="num">Cost / unit</th>
                        <th className="num">Menu price</th>
                        <th className="num">Food cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recipes
                        .filter((r) => recipeFilter === "all" || r.kind === recipeFilter)
                        .map((r) => {
                          const usedInCount = recipes.filter((other) =>
                            other.lines.some((l) => l.line_type === "recipe" && l.sub_recipe === r.id)
                          ).length;
                          return (
                            <tr key={r.id} className="clickable" onClick={() => setSelectedRecipeId(r.id)}>
                              <td className="dish">
                                {r.name || <span className="muted">Untitled</span>}
                                <span className={`kind-tag ${r.kind}`}>{r.kind === "sub" ? "Sub-recipe" : "Dish"}</span>
                                <div className="rsub">
                                  {r.kind === "sub"
                                    ? usedInCount === 0
                                      ? "not used yet"
                                      : `used in ${usedInCount} recipe${usedInCount === 1 ? "" : "s"}`
                                    : `${r.lines.length} line${r.lines.length === 1 ? "" : "s"}`}
                                </div>
                              </td>
                              <td className="num">
                                {r.yield_qty} {r.yield_unit}
                              </td>
                              <td className="num">£{Number(r.batch_cost).toFixed(2)}</td>
                              <td className="num">£{Number(r.per_portion_cost).toFixed(2)}</td>
                              <td className="num">{r.menu_price ? `£${Number(r.menu_price).toFixed(2)}` : "—"}</td>
                              <td className="num">
                                {r.plate_food_cost_pct !== null ? `${r.plate_food_cost_pct.toFixed(1)}%` : "—"}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                )}
              </>
            )}

            {activePage === "Procurement" && (
              <>
                {poError && <p className="error">{poError}</p>}
                {!poError && !purchaseOrders && <p className="muted">Loading purchase orders…</p>}

                {suppliers.some((s) => s.delivery_day !== null) && (
                  <div className="deliv-strip">
                    <div className="deliv-label">Next supplier deliveries</div>
                    <div className="deliv-cards">
                      {suppliers
                        .filter((s) => s.delivery_day !== null)
                        .map((s) => ({ s, date: nextDeliveryDate(s.delivery_day as number) }))
                        .sort((a, b) => a.date.getTime() - b.date.getTime())
                        .map(({ s, date }) => (
                          <div
                            className="deliv-card clickable"
                            key={s.id}
                            onClick={() => setSelectedSupplierId(s.id)}
                          >
                            <b>{s.name}</b>
                            <span>{date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {purchaseOrders && purchaseOrders.length > 0 && (
                  <div className="rtabs">
                    {(["all", "draft", "sent", "received"] as const).map((f) => (
                      <button
                        key={f}
                        className={`rtab ${poFilter === f ? "on" : ""}`}
                        onClick={() => setPoFilter(f)}
                      >
                        {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                      </button>
                    ))}
                  </div>
                )}

                {purchaseOrders && purchaseOrders.length === 0 && <p className="muted">No purchase orders yet.</p>}
                {purchaseOrders && purchaseOrders.length > 0 && (
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Supplier</th>
                        <th>Location</th>
                        <th>Status</th>
                        <th>Expected</th>
                        <th className="num">Lines</th>
                        <th className="num">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {purchaseOrders
                        .filter((po) => poFilter === "all" || po.status === poFilter)
                        .map((po) => {
                          const supplier = suppliers.find((s) => s.id === po.supplier);
                          const belowMin =
                            po.status === "draft" &&
                            supplier?.min_order_value &&
                            Number(po.total) < Number(supplier.min_order_value);
                          return (
                            <tr key={po.id} className="clickable" onClick={() => setSelectedPOId(po.id)}>
                              <td className="dish">{po.supplier_name}</td>
                              <td className="muted">{po.location_name}</td>
                              <td>
                                <span className={`postatus ps-${po.status}`}>
                                  {po.status.charAt(0).toUpperCase() + po.status.slice(1)}
                                </span>
                                {belowMin && <span className="postatus ps-awaiting" style={{ marginLeft: 6 }}>Below min</span>}
                              </td>
                              <td className="muted">{fmtDate(po.expected_date)}</td>
                              <td className="num">{po.lines.length}</td>
                              <td className="num">£{Number(po.total).toFixed(2)}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                )}
              </>
            )}

            {activePage === "Waste log" && accessToken && (
              <WasteLog
                accessToken={accessToken}
                items={items ?? []}
                locations={locations}
                itemSupplierLinks={itemSupplierLinks}
                wasteEvents={wasteEvents}
                wasteError={wasteError}
                stockMovements={stockMovements}
                onChanged={() => loadWasteEvents(accessToken)}
              />
            )}

            {activePage === "Inventory" && accessToken && me && (
              <Inventory
                accessToken={accessToken}
                me={me}
                items={items ?? []}
                locations={locations}
                sections={sections}
                sectionsError={sectionsError}
                stockCounts={stockCounts}
                stockCountsError={stockCountsError}
                itemSupplierLinks={itemSupplierLinks}
                stockMovements={stockMovements}
                memberships={memberships}
                onSectionsChanged={() => loadSections(accessToken)}
                onStockCountsChanged={() => loadStockCounts(accessToken)}
                onItemsChanged={() => loadItems(accessToken)}
              />
            )}

            {activePage === "Team" && accessToken && me && (
              <Team
                accessToken={accessToken}
                me={me}
                memberships={memberships}
                membershipsError={membershipsError}
                locations={locations}
                onChanged={() => loadMemberships(accessToken)}
              />
            )}

            {activePage === "End of day" && accessToken && (
              <EndOfDay
                accessToken={accessToken}
                locations={locations}
                recipes={recipes ?? []}
                items={items ?? []}
                itemSupplierLinks={itemSupplierLinks}
              />
            )}

            {activePage === "Settings" && accessToken && me.memberships.some((m) => m.role === "admin") && (
              <Settings
                accessToken={accessToken}
                items={items ?? []}
                recipes={recipes ?? []}
                locations={locations}
                onItemsChanged={() => loadItems(accessToken)}
                onRecipesChanged={() => loadRecipes(accessToken)}
              />
            )}

            {activePage === "Reports" && accessToken && <Reports accessToken={accessToken} locations={locations} />}

            {activePage !== "Items" &&
              activePage !== "Recipes" &&
              activePage !== "Procurement" &&
              activePage !== "Waste log" &&
              activePage !== "Inventory" &&
              activePage !== "Team" &&
              activePage !== "End of day" &&
              activePage !== "Settings" &&
              activePage !== "Reports" && <p className="muted">Coming soon — this screen is next on the list.</p>}
          </>
        )}
      </main>

      {showNewItem && (
        <div className="modal-backdrop" onClick={() => setShowNewItem(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>New item</h2>
            <form onSubmit={handleCreateItem}>
              <label>
                Name
                <input value={newName} onChange={(e) => setNewName(e.target.value)} required />
              </label>
              <label>
                SKU <span className="optional">optional</span>
                <input value={newSku} onChange={(e) => setNewSku(e.target.value)} />
              </label>
              <label>
                Base unit
                <select value={newUnit} onChange={(e) => setNewUnit(e.target.value)}>
                  {BASE_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                VAT rate % <span className="optional">optional</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={newVatPct}
                  onChange={(e) => setNewVatPct(e.target.value)}
                  placeholder="e.g. 20"
                />
              </label>
              {newItemError && <p className="error">{newItemError}</p>}
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setShowNewItem(false);
                    resetNewItemForm();
                  }}
                >
                  Cancel
                </button>
                <button className="btn-primary" type="submit" disabled={savingItem}>
                  {savingItem ? "Saving…" : "Create item"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showNewRecipe && (
        <div className="modal-backdrop" onClick={() => setShowNewRecipe(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>New recipe</h2>
            <div className="seg">
              <button
                type="button"
                className={`seg-btn ${newRecipeKind === "dish" ? "on" : ""}`}
                onClick={() => setNewRecipeKind("dish")}
              >
                <b>A dish</b>
                <small>sold on the menu · has a price</small>
              </button>
              <button
                type="button"
                className={`seg-btn sub ${newRecipeKind === "sub" ? "on" : ""}`}
                onClick={() => setNewRecipeKind("sub")}
              >
                <b>A sub-recipe</b>
                <small>in-house prep, used in other recipes</small>
              </button>
            </div>
            <form onSubmit={handleCreateRecipe}>
              <label>
                Name
                <input value={newRecipeName} onChange={(e) => setNewRecipeName(e.target.value)} required />
              </label>
              <label>
                Batch yields
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={newYieldQty}
                  onChange={(e) => setNewYieldQty(e.target.value)}
                  required
                />
              </label>
              <label>
                Yield unit
                <select value={newYieldUnit} onChange={(e) => setNewYieldUnit(e.target.value)}>
                  {YIELD_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </label>
              {newRecipeKind === "dish" && (
                <label>
                  Menu price
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={newMenuPrice}
                    onChange={(e) => setNewMenuPrice(e.target.value)}
                    required
                  />
                </label>
              )}
              {newRecipeError && <p className="error">{newRecipeError}</p>}
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setShowNewRecipe(false);
                    resetNewRecipeForm();
                  }}
                >
                  Cancel
                </button>
                <button className="btn-primary" type="submit" disabled={savingRecipe}>
                  {savingRecipe ? "Saving…" : "Create recipe"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showImport && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setShowImport(false);
            resetImport();
          }}
        >
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <h2>Import a supplier's catalogue</h2>
            <p className="hint" style={{ marginTop: -8, marginBottom: 16 }}>
              Suppliers usually send their full product list as a CSV. SAWIS stores it in the
              background so it can suggest which suppliers stock the items you already track.
            </p>

            <div className="field" style={{ marginBottom: 12 }}>
              <label>Supplier</label>
              <select value={importSupplier} onChange={(e) => setImportSupplier(e.target.value)}>
                <option value="">Choose a supplier…</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {!showNewSupplier ? (
                <button
                  type="button"
                  className="mini"
                  style={{ marginTop: 8 }}
                  onClick={() => setShowNewSupplier(true)}
                >
                  + New supplier
                </button>
              ) : (
                <div className="new-sup">
                  <input
                    value={newSupplierName}
                    onChange={(e) => setNewSupplierName(e.target.value)}
                    placeholder="Supplier name"
                  />
                  <input
                    value={newSupplierEmail}
                    onChange={(e) => setNewSupplierEmail(e.target.value)}
                    placeholder="Contact email (optional)"
                  />
                  <select value={newSupplierDay} onChange={(e) => setNewSupplierDay(e.target.value)}>
                    <option value="">No fixed delivery day</option>
                    {DAY_NAMES.map((name, i) => (
                      <option key={i} value={i}>
                        Delivers {name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={newSupplierMin}
                    onChange={(e) => setNewSupplierMin(e.target.value)}
                    placeholder="Minimum order value £ (optional)"
                  />
                  <div className="new-sup-row">
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => {
                        setShowNewSupplier(false);
                        setNewSupplierName("");
                        setNewSupplierEmail("");
                        setNewSupplierError(null);
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="mini"
                      onClick={handleCreateSupplier}
                      disabled={savingSupplier || !newSupplierName.trim()}
                    >
                      {savingSupplier ? "Adding…" : "Add supplier"}
                    </button>
                  </div>
                  {newSupplierError && <p className="error">{newSupplierError}</p>}
                </div>
              )}
            </div>

            <div className="field" style={{ marginBottom: 12 }}>
              <label>CSV file</label>
              <input type="file" accept=".csv,text/csv" onChange={handleCsvFile} />
              <div className="vhint">
                One product per line: name,unit,price — e.g. "Beef mince 5%,kg,7.40". No header row.
              </div>
            </div>

            {importFileName && !importError && importRows.length > 0 && importDone === null && (
              <div className="im-note">
                ✓ <b>{importRows.length} products</b> read from {importFileName}.
              </div>
            )}

            {importRows.length > 0 && importDone === null && (
              <table className="im-tbl">
                <thead>
                  <tr>
                    <th>Product line</th>
                    <th>Unit</th>
                    <th className="num">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {importRows.slice(0, 8).map((r, i) => (
                    <tr key={i}>
                      <td>{r.name}</td>
                      <td>{r.unit}</td>
                      <td className="num">£{Number(r.price).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {importRows.length > 8 && importDone === null && (
              <p className="muted" style={{ fontSize: 12 }}>
                …and {importRows.length - 8} more.
              </p>
            )}

            {importDone !== null && (
              <div className="im-note">
                ✓ <b>
                  {importDone.created} new{importDone.updated > 0 ? `, ${importDone.updated} updated` : ""}.
                </b>{" "}
                Open items to see matching suggestions.
              </div>
            )}

            {importError && <p className="error">{importError}</p>}

            <div className="modal-actions">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setShowImport(false);
                  resetImport();
                }}
              >
                {importDone !== null ? "Close" : "Cancel"}
              </button>
              {importDone === null && (
                <button
                  className="btn-primary"
                  disabled={importSaving || !importSupplier || importRows.length === 0}
                  onClick={handleImportSubmit}
                >
                  {importSaving ? "Storing…" : `Store ${importRows.length || ""} products`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showNewPO && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setShowNewPO(false);
            resetNewPOForm();
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>New purchase order</h2>
            <form onSubmit={handleCreatePO}>
              <label>
                Supplier
                <select value={newPOSupplier} onChange={(e) => setNewPOSupplier(e.target.value)} required>
                  <option value="">Choose a supplier…</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Deliver to
                <select value={newPOLocation} onChange={(e) => setNewPOLocation(e.target.value)} required>
                  <option value="">Choose a location…</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Expected date <span className="optional">optional</span>
                <input type="date" value={newPOExpected} onChange={(e) => setNewPOExpected(e.target.value)} />
              </label>
              {newPOError && <p className="error">{newPOError}</p>}
              {(!suppliers.length || !locations.length) && (
                <p className="error">
                  {!suppliers.length ? "No suppliers yet. " : ""}
                  {!locations.length ? "No locations yet. " : ""}
                  Add them in the admin panel first.
                </p>
              )}
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setShowNewPO(false);
                    resetNewPOForm();
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn-primary"
                  type="submit"
                  disabled={savingPO || !suppliers.length || !locations.length}
                >
                  {savingPO ? "Creating…" : "Create purchase order"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}