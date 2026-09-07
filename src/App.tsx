import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import {
  login,
  refreshAccessToken,
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
  updatePurchaseOrder,
  createPOLine,
  receivePurchaseOrder,
  scanReceipt,
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
  ScannedReceipt,
  ReceiveLineOverride,
} from "./api";
import RecipeDetail from "./RecipeDetail";
import ItemDetail from "./ItemDetail";
import Loader from "./Loader";
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

// Session persistence — see the restore-on-load effect in App(). Before
// this, accessToken lived only in React state, so any page reload (or a
// browser/tab close) silently discarded it and forced a fresh sign-in even
// though the backend's access token is still valid for 8 hours and the
// refresh token for 14 days (config/settings.py SIMPLE_JWT). Storing both
// in localStorage — not just the access token — is what lets a reload
// survive past the 8-hour access-token window too, via refreshAccessToken.
const ACCESS_TOKEN_KEY = "sawis_access_token";
const REFRESH_TOKEN_KEY = "sawis_refresh_token";

function storeTokens(access: string, refresh: string) {
  localStorage.setItem(ACCESS_TOKEN_KEY, access);
  localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
}

function clearStoredTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

// The <script type="module"> tag Vite injects into index.html has a
// content-hashed filename that changes on every deploy — comparing it
// against a fresh fetch of "/" is a cheap way to notice a new version went
// live without needing a version.json file to remember to bump by hand.
// See the update-available effect in App().
function currentBundleSrc(): string | null {
  const el = document.querySelector('script[type="module"][src]');
  return el ? el.getAttribute("src") : null;
}

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

// Lightweight fuzzy match: token overlap between our own name (an Item,
// or a Supplier) and a piece of OCR'd receipt text. Same approach as
// ItemDetail.tsx's matchScore for supplier-catalogue matching — never
// used to auto-commit anything, only to rank the best guess the "Scan
// receipt" review modal pre-selects, which the user still confirms or
// corrects before anything is saved.
function matchScore(ours: string, raw: string): number {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[0-9]+(\.[0-9]+)?\s*(kg|g|ml|l|cl|oz|x|case|sack|class)?/g, " ")
      .replace(/[^a-z ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);
  const a = new Set(norm(ours));
  const b = new Set(norm(raw));
  if (!a.size) return 0;
  let hit = 0;
  a.forEach((w) => {
    if (b.has(w) || [...b].some((x) => x.startsWith(w) || w.startsWith(x))) hit++;
  });
  return hit / a.size;
}

// A row in the Scan receipt review table -- one per Textract-detected
// line item, pre-filled with a best-guess Item match the user confirms
// or corrects. Nothing here is saved until "Create purchase order."
interface ScanRow {
  description: string;
  matchedItemId: string; // "" = no confident match, user must pick one
  qty: string;
  unitPrice: string;
  confidence: number | null; // Textract's own confidence for this row, 0-100
  skip: boolean;
}

// Textract sometimes returns a price/qty with a currency symbol, thousands
// separator, or stray whitespace ("£1,234.50") -- strip everything but
// digits/decimal point so it drops straight into a numeric-style input.
function cleanNumeric(raw: string | null): string {
  if (!raw) return "";
  const cleaned = raw.replace(/[^0-9.]/g, "");
  return cleaned || "";
}

// Our own po_number is "PO-0007", but a supplier retyping it onto their
// invoice might drop the dash, the leading zeros, or the "PO" itself
// ("po0007", "7", "PO 0007") -- strip everything but letters/digits and
// compare loosely rather than requiring an exact string match.
function normalizePONumber(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^PO0*/, "");
}

// Textract's date text comes back in whatever format the receipt itself
// used ("12/08/2026", "2026-08-12", "Aug 12 2026", ...) -- try a handful of
// common shapes rather than trusting `new Date(raw)` alone, which silently
// misreads day/month order on plain slash-separated dates. Returns null
// (never a guessed date) if nothing recognisable matched.
function parseLooseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const slash = raw.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    let year = Number(slash[3]);
    if (year < 100) year += 2000;
    // UK receipts are day/month/year; if the "month" slot is >12 it must
    // actually be the day, so swap rather than silently building an
    // invalid date.
    return month > 12 ? new Date(year, day - 1, month) : new Date(year, month - 1, day);
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24);
}

// Scores how likely a scanned receipt is to belong to an already-sent PO,
// from four independent signals -- a PO number match is decisive on its
// own (worth 2), everything else is corroborating (worth 1 each), so two
// weaker signals agreeing is treated the same as one strong one. Callers
// filter to score >= 2 before offering a candidate. Purely descriptive:
// this never writes anything, it only ranks and explains a suggestion.
function scorePOMatch(
  po: PurchaseOrder,
  supplierId: string,
  scannedPONumber: string | null,
  receiptDate: string | null,
  rows: ScanRow[]
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  if (scannedPONumber) {
    const needle = normalizePONumber(scannedPONumber);
    if (needle && po.po_number && normalizePONumber(po.po_number) === needle) {
      score += 2;
      reasons.push("PO number");
    }
  }

  if (supplierId && supplierId === po.supplier) {
    score += 1;
    reasons.push("supplier");
  }

  const matchedRows = rows.filter((r) => r.matchedItemId);
  if (matchedRows.length && po.lines.length) {
    const overlap = matchedRows.filter((r) => po.lines.some((l) => l.item === r.matchedItemId)).length;
    if (overlap / matchedRows.length >= 0.5) {
      score += 1;
      reasons.push(`${overlap} of ${matchedRows.length} item${matchedRows.length === 1 ? "" : "s"}`);
    }
  }

  const parsedReceiptDate = parseLooseDate(receiptDate);
  const parsedExpected = po.expected_date ? parseLooseDate(po.expected_date) : null;
  if (parsedReceiptDate && parsedExpected && daysBetween(parsedReceiptDate, parsedExpected) <= 10) {
    score += 1;
    reasons.push("date");
  }

  return { score, reasons };
}

export default function App() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  // True only when there's a stored session worth trying to restore — a
  // brand-new visitor with nothing in localStorage skips straight to the
  // login screen with no extra flash. See the restore effect below.
  const [restoringSession, setRestoringSession] = useState(
    () => !!localStorage.getItem(ACCESS_TOKEN_KEY) || !!localStorage.getItem(REFRESH_TOKEN_KEY)
  );
  const [updateAvailable, setUpdateAvailable] = useState(false);
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
  const [importDone, setImportDone] = useState<
    { created: number; updated: number; linkedSynced: string[] } | null
  >(null);

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

  // Scan receipt (OCR) -- upload a photo, review/correct what Textract read
  // back, then create a real PurchaseOrder + POLines from it. See the
  // "Scan receipt" section further down for the review modal itself.
  const [showScanReceipt, setShowScanReceipt] = useState(false);
  const [scanFileName, setScanFileName] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ScannedReceipt | null>(null);
  const [scanSupplierId, setScanSupplierId] = useState("");
  const [scanLocationId, setScanLocationId] = useState("");
  const [scanRows, setScanRows] = useState<ScanRow[]>([]);
  const [creatingPOFromScan, setCreatingPOFromScan] = useState(false);
  const [scanCreateError, setScanCreateError] = useState<string | null>(null);
  // Set once the PO + lines are actually created, before the "mark as
  // received" step runs. If that step fails, this stays set so the modal
  // can offer "Retry" / "Leave as Sent" instead of re-submitting the form
  // and creating a second, duplicate purchase order.
  const [scanCreatedPO, setScanCreatedPO] = useState<PurchaseOrder | null>(null);
  const [retryingReceive, setRetryingReceive] = useState(false);
  const [scanShowNewSupplier, setScanShowNewSupplier] = useState(false);
  const [scanNewSupplierName, setScanNewSupplierName] = useState("");
  const [savingScanSupplier, setSavingScanSupplier] = useState(false);
  const [scanNewSupplierError, setScanNewSupplierError] = useState<string | null>(null);
  // Best-guess existing sent/awaiting order this scan might belong to --
  // scored from whichever of {PO number, supplier, item overlap, receipt
  // date vs expected date} actually matched (see scorePOMatch below).
  // Purely a suggestion, never acted on until the user explicitly ticks
  // scanUseMatchedPO; scanMatchReasons is only for explaining the guess.
  const [scanMatchedPO, setScanMatchedPO] = useState<PurchaseOrder | null>(null);
  const [scanMatchReasons, setScanMatchReasons] = useState<string[]>([]);
  const [scanUseMatchedPO, setScanUseMatchedPO] = useState(false);
  // Whatever was last passed to receivePurchaseOrder, kept around so a
  // failed-then-retried receive step (see handleRetryReceiveScan) resends
  // the same reviewed values instead of silently falling back to the PO's
  // original ordered qty/price.
  const [scanPendingOverrides, setScanPendingOverrides] = useState<ReceiveLineOverride[]>([]);
  const [scanPendingInvoiceNumber, setScanPendingInvoiceNumber] = useState<string | null>(null);

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

  // Restore a session from localStorage on load — runs once. Tries the
  // stored access token first (cheap: one request); if that fails (most
  // likely it's simply past its 8-hour lifetime) falls back to the refresh
  // token before giving up and showing the login screen. A failure here
  // could in theory also be a transient network blip rather than a truly
  // expired session, but retrying indefinitely isn't worth the complexity —
  // worst case the user just signs in again, same as before this existed.
  useEffect(() => {
    const storedAccess = localStorage.getItem(ACCESS_TOKEN_KEY);
    const storedRefresh = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!storedAccess && !storedRefresh) {
      setRestoringSession(false);
      return;
    }
    (async () => {
      try {
        if (!storedAccess) throw new Error("no access token stored");
        const profile = await getMe(storedAccess);
        setMe(profile);
        setAccessToken(storedAccess);
        return;
      } catch {
        // fall through to the refresh attempt below
      }
      try {
        if (!storedRefresh) throw new Error("no refresh token stored");
        const refreshed = await refreshAccessToken(storedRefresh);
        const profile = await getMe(refreshed.access);
        storeTokens(refreshed.access, refreshed.refresh);
        setMe(profile);
        setAccessToken(refreshed.access);
      } catch {
        clearStoredTokens();
      }
    })().finally(() => setRestoringSession(false));
  }, []);

  // Polls for a newer deployed frontend build so a long-open tab doesn't
  // silently run stale code until someone thinks to hard-refresh — this was
  // previously a manual step called out to the user after every deploy.
  // 15 minutes is arbitrary but low-cost: a missed release is noticed on
  // the next poll, not urgent enough to warrant anything shorter.
  useEffect(() => {
    const initialSrc = currentBundleSrc();
    if (!initialSrc) return; // dev server or unexpected markup — nothing to compare against
    const checkForUpdate = () => {
      fetch("/", { cache: "no-store" })
        .then((res) => res.text())
        .then((html) => {
          const tagMatch = html.match(/<script[^>]*type="module"[^>]*>/i);
          const srcMatch = tagMatch ? tagMatch[0].match(/src="([^"]+)"/) : null;
          if (srcMatch && srcMatch[1] !== initialSrc) setUpdateAvailable(true);
        })
        .catch(() => {}); // a failed check just means try again next interval
    };
    const id = setInterval(checkForUpdate, 15 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const tokens = await login(email, password);
      const profile = await getMe(tokens.access);
      storeTokens(tokens.access, tokens.refresh);
      setMe(profile);
      setAccessToken(tokens.access);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    clearStoredTokens();
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

  // Turns a sheet's raw rows (from either CSV or Excel) into the same
  // {name, unit, price} shape the bulk_import endpoint expects — the two
  // file formats converge here so nothing downstream needs to know which
  // one the supplier actually sent.
  function rowsFromCells(cellRows: unknown[][]) {
    const rows: { name: string; unit: string; price: string }[] = [];
    cellRows.forEach((cells) => {
      const parts = cells.map((c) => (c === null || c === undefined ? "" : String(c).trim()));
      if (parts.length >= 3 && parts[0] && !isNaN(Number(parts[2]))) {
        rows.push({ name: parts[0], unit: parts[1], price: parts[2] });
      }
    });
    return rows;
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    setImportError(null);
    setImportDone(null);
    const isSpreadsheet = /\.xlsx?$/i.test(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      let rows: { name: string; unit: string; price: string }[] = [];
      try {
        if (isSpreadsheet) {
          // Supplier sent an Excel workbook — read the first sheet as a
          // grid of cells rather than text, since prices/units in Excel
          // are often typed as real numbers, not strings.
          const data = new Uint8Array(reader.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: "array" });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const cellRows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false }) as unknown[][];
          rows = rowsFromCells(cellRows);
        } else {
          const text = String(reader.result || "");
          const cellRows = text
            .split(/\r?\n/)
            .filter((line) => line.trim())
            .map((line) => line.split(","));
          rows = rowsFromCells(cellRows);
        }
      } catch {
        setImportError("Could not read that file — check it's a valid CSV or Excel spreadsheet.");
        return;
      }
      setImportRows(rows);
      if (rows.length === 0) {
        setImportError('No valid rows found — each row should read name, unit, price, e.g. "Beef mince 5%, kg, 7.40".');
      }
    };
    if (isSpreadsheet) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
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
      setImportDone({
        created: result.created.length,
        updated: result.updated.length,
        linkedSynced: result.linked_prices_synced,
      });
      fetchSupplierItems(accessToken).then(setSupplierItems).catch(() => {});
      // A refreshed price may have just changed what an already-linked
      // item costs — refetch so Items/Item Detail don't keep showing the
      // pre-import price until the next unrelated reload (second gotcha).
      if (result.linked_prices_synced.length > 0) {
        fetchItems(accessToken).then(setItems).catch(() => {});
      }
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

  function resetScan() {
    setScanFileName(null);
    setScanError(null);
    setScanResult(null);
    setScanSupplierId("");
    setScanLocationId("");
    setScanRows([]);
    setScanCreateError(null);
    setScanShowNewSupplier(false);
    setScanNewSupplierName("");
    setScanNewSupplierError(null);
    setScanCreatedPO(null);
    setScanMatchedPO(null);
    setScanMatchReasons([]);
    setScanUseMatchedPO(false);
    setScanPendingOverrides([]);
    setScanPendingInvoiceNumber(null);
  }

  async function handleCreateScanSupplier() {
    if (!accessToken || !scanNewSupplierName.trim()) return;
    setSavingScanSupplier(true);
    setScanNewSupplierError(null);
    try {
      const created = await createSupplier(accessToken, {
        name: scanNewSupplierName.trim(),
        contact_email: null,
      });
      setSuppliers((prev) => [...prev, created]);
      setScanSupplierId(created.id);
      setScanShowNewSupplier(false);
      setScanNewSupplierName("");
    } catch (err) {
      setScanNewSupplierError(err instanceof Error ? err.message : "Could not create supplier.");
    } finally {
      setSavingScanSupplier(false);
    }
  }

  function closeScanModal() {
    setShowScanReceipt(false);
    resetScan();
  }

  async function handleScanFileSelected(file: File) {
    if (!accessToken) return;
    setScanFileName(file.name);
    setScanError(null);
    setScanResult(null);
    setScanRows([]);
    setScanning(true);
    try {
      const result = await scanReceipt(accessToken, file);
      setScanResult(result);

      // Best-guess supplier: fuzzy-match the OCR'd vendor name against
      // suppliers already on file. Left blank (forcing a manual pick)
      // if nothing scores well enough to trust — same 0.5 threshold
      // ItemDetail.tsx uses for supplier-catalogue suggestions. Kept in a
      // local var (not just the state setter) so the PO-matching pass
      // below can use it in the same synchronous pass, without waiting on
      // a state update that hasn't landed yet.
      let resolvedSupplierId = "";
      if (result.vendor_name) {
        const ranked = suppliers
          .map((s) => ({ s, score: matchScore(s.name, result.vendor_name as string) }))
          .sort((a, b) => b.score - a.score);
        if (ranked[0] && ranked[0].score >= 0.5) {
          resolvedSupplierId = ranked[0].s.id;
          setScanSupplierId(resolvedSupplierId);
        }
      }

      const rows: ScanRow[] = result.line_items.map((li) => {
        const ranked = (items ?? [])
          .map((it) => ({ it, score: matchScore(it.name, li.description) }))
          .sort((a, b) => b.score - a.score);
        const best = ranked[0] && ranked[0].score >= 0.5 ? ranked[0].it.id : "";
        return {
          description: li.description,
          matchedItemId: best,
          qty: cleanNumeric(li.quantity) || "1",
          unitPrice: cleanNumeric(li.unit_price) || "0.00",
          confidence: li.confidence,
          skip: false,
        };
      });
      setScanRows(rows);

      // Does this receipt trace back to an order we already sent? Score
      // every sent/awaiting PO on four independent signals -- a supplier
      // sometimes prints our PO number on their invoice (the strongest
      // single signal, worth 2 on its own), but even without one, matching
      // supplier + item overlap + a receipt date close to the PO's expected
      // date is enough to suggest it. Never auto-applied -- the best-scoring
      // candidate above the threshold is only ever offered as a checkbox in
      // the review modal for the user to accept or ignore.
      const candidates = (purchaseOrders ?? [])
        .filter((po) => po.status === "sent" || po.status === "awaiting")
        .map((po) => ({ po, ...scorePOMatch(po, resolvedSupplierId, result.po_number, result.date, rows) }))
        .filter((c) => c.score >= 2)
        .sort((a, b) => b.score - a.score);
      if (candidates[0]) {
        setScanMatchedPO(candidates[0].po);
        setScanMatchReasons(candidates[0].reasons);
      } else {
        setScanMatchedPO(null);
        setScanMatchReasons([]);
      }
      setScanUseMatchedPO(false);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Could not scan that receipt.");
    } finally {
      setScanning(false);
    }
  }

  function updateScanRow(index: number, patch: Partial<ScanRow>) {
    setScanRows((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  const scanUnmatchedCount = scanRows.filter((r) => !r.skip && !r.matchedItemId).length;
  const scanIncludedRows = scanRows.filter((r) => !r.skip && r.matchedItemId);

  // A scanned receipt almost always means the goods are already in the
  // building -- the user confirmed this is the common case, sometimes with
  // the paperwork arriving after the delivery, never before. So unlike the
  // manual "+ New purchase order" flow (which starts as an actual draft,
  // sent ahead of a delivery still to come), a scan goes straight to
  // Received: bump status to "sent" first (receive() only accepts a
  // sent/awaiting PO), then call the *existing* receive() action with no
  // overrides, so it defaults every line's received qty/price to exactly
  // what was just scanned and confirmed in the review table -- this posts
  // real StockMovements and updates ItemSupplier prices, same as clicking
  // "Mark as Received" by hand would.
  async function markScannedPOReceived(
    po: PurchaseOrder,
    overrides: ReceiveLineOverride[] = [],
    invoiceNumber?: string | null
  ) {
    await updatePurchaseOrder(accessToken as string, po.id, { status: "sent" });
    await receivePurchaseOrder(accessToken as string, po.id, overrides, invoiceNumber);
  }

  async function handleCreatePOFromScan() {
    if (!accessToken || !scanIncludedRows.length) return;

    // Scanning found a PO number on the invoice that traces back to an
    // order we already sent, and the user confirmed it's the right one --
    // receive against that existing PO/lines instead of creating a new,
    // duplicate one.
    if (scanUseMatchedPO && scanMatchedPO) {
      setScanCreateError(null);
      setCreatingPOFromScan(true);
      try {
        const overrides: ReceiveLineOverride[] = [];
        for (const row of scanIncludedRows) {
          const line = scanMatchedPO.lines.find((l) => l.item === row.matchedItemId);
          if (line) {
            overrides.push({
              id: line.id,
              received_qty: row.qty || "0",
              received_unit_price: row.unitPrice || "0.00",
            });
          }
          // A scanned item that isn't one of the matched PO's own lines
          // (e.g. the supplier substituted or added something) can't be
          // received through this order's overrides -- it's silently left
          // out rather than guessed at; the user can add it by hand
          // afterwards if it should be on the order.
        }
        setScanCreatedPO(scanMatchedPO);
        setScanPendingOverrides(overrides);
        setScanPendingInvoiceNumber(scanResult?.invoice_number ?? null);
        await markScannedPOReceived(scanMatchedPO, overrides, scanResult?.invoice_number);
        closeScanModal();
        loadPOs(accessToken);
        setSelectedPOId(scanMatchedPO.id);
      } catch (err) {
        setScanCreateError(err instanceof Error ? err.message : "Could not receive against that order.");
      } finally {
        setCreatingPOFromScan(false);
      }
      return;
    }

    if (!scanSupplierId || !scanLocationId) return;
    setScanCreateError(null);
    setCreatingPOFromScan(true);
    try {
      // Reuses the same createPurchaseOrder/createPOLine calls the manual
      // "+ New purchase order" flow and ProcurementDetail's "add line" use
      // -- scanning only prefills the form faster, it doesn't invent any
      // new PO-creation logic.
      const created = await createPurchaseOrder(accessToken, {
        supplier: scanSupplierId,
        location: scanLocationId,
        expected_date: null,
      });
      for (const row of scanIncludedRows) {
        await createPOLine(accessToken, {
          po: created.id,
          item: row.matchedItemId,
          department: "kitchen",
          qty: row.qty || "0",
          unit_price: row.unitPrice || "0.00",
        });
      }
      // From this point on the PO and its lines are real, saved data --
      // record that immediately so a failure below can never lead to a
      // second, duplicate PO being created by retrying this function.
      setScanCreatedPO(created);
      setScanPendingOverrides([]);
      setScanPendingInvoiceNumber(scanResult?.invoice_number ?? null);

      await markScannedPOReceived(created, [], scanResult?.invoice_number);

      closeScanModal();
      loadPOs(accessToken);
      setSelectedPOId(created.id);
    } catch (err) {
      setScanCreateError(err instanceof Error ? err.message : "Could not create the purchase order.");
    } finally {
      setCreatingPOFromScan(false);
    }
  }

  // Only reachable once scanCreatedPO is set -- i.e. the PO/lines exist
  // already and only the receive step needs retrying, so this never
  // creates a second PO.
  async function handleRetryReceiveScan() {
    if (!accessToken || !scanCreatedPO) return;
    setScanCreateError(null);
    setRetryingReceive(true);
    try {
      await markScannedPOReceived(scanCreatedPO, scanPendingOverrides, scanPendingInvoiceNumber);
      closeScanModal();
      loadPOs(accessToken);
      setSelectedPOId(scanCreatedPO.id);
    } catch (err) {
      setScanCreateError(err instanceof Error ? err.message : "Still couldn't mark it received.");
    } finally {
      setRetryingReceive(false);
    }
  }

  function handleLeaveScannedPOAsSent() {
    if (!scanCreatedPO || !accessToken) return;
    closeScanModal();
    loadPOs(accessToken);
    setSelectedPOId(scanCreatedPO.id);
  }

  // Shown only when there was a stored session worth checking — see
  // restoringSession's initializer.
  if (restoringSession) {
    return (
      <div className="page">
        <div className="card" style={{ textAlign: "center" }}>
          <Loader />
        </div>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="page">
        {updateAvailable && (
          <div className="update-banner">
            A new version of SAWIS is available.
            <button onClick={() => window.location.reload()}>Refresh now</button>
          </div>
        )}
        <div className="card">
          <div className="brandmark login">S</div>
          <h1 className="wordmark">sawis</h1>
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
      {updateAvailable && (
        <div className="update-banner">
          A new version of SAWIS is available.
          <button onClick={() => window.location.reload()}>Refresh now</button>
        </div>
      )}
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
                    ⇪ Import supplier list
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
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn-ghost small" onClick={() => setShowScanReceipt(true)}>
                    📷 Scan receipt
                  </button>
                  <button className="btn-primary small" onClick={() => setShowNewPO(true)}>
                    + New purchase order
                  </button>
                </div>
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
                        <th>PO number</th>
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
                              <td className="muted">{po.po_number || "—"}</td>
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
              Suppliers usually send their full product list as a CSV or Excel spreadsheet. SAWIS
              stores it in the background so it can suggest which suppliers stock the items you
              already track.
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
              <label>Supplier list file</label>
              <input
                type="file"
                accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                onChange={handleImportFile}
              />
              <div className="vhint">
                CSV or Excel (.xlsx/.xls). One product per row: name, unit, price — e.g. "Beef mince
                5%, kg, 7.40". No header row.
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
                {importDone.linkedSynced.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    Also refreshed the live price on {importDone.linkedSynced.length} already-linked{" "}
                    item{importDone.linkedSynced.length > 1 ? "s" : ""}:{" "}
                    {importDone.linkedSynced.join(", ")}.
                  </div>
                )}
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

      {showScanReceipt && (
        <div
          className="modal-backdrop"
          onClick={() => !scanning && !creatingPOFromScan && !retryingReceive && closeScanModal()}
        >
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <h2>Scan receipt</h2>

            {!scanResult && (
              <>
                <p className="hint" style={{ marginTop: -8, marginBottom: 16 }}>
                  Upload a photo of a supplier receipt or invoice. SAWIS reads it with AWS Textract
                  and pre-fills the order for you to check and correct — nothing is saved until you
                  confirm below. Since a receipt usually means the delivery has already arrived,
                  confirming marks it Received straight away and updates stock and prices, the same
                  as manually clicking "Mark as Received."
                </p>
                <div className="field" style={{ marginBottom: 12 }}>
                  <label>Receipt photo</label>
                  <input
                    type="file"
                    accept="image/*"
                    disabled={scanning}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleScanFileSelected(file);
                    }}
                  />
                </div>
                {scanning && (
                  <div style={{ textAlign: "center", padding: "16px 0" }}>
                    <Loader size="compact" label="Reading the receipt…" />
                  </div>
                )}
                {scanError && <p className="error">{scanError}</p>}
              </>
            )}

            {scanResult && (
              <>
                <div className="im-note">
                  ✓ Scanned {scanFileName}.{" "}
                  {scanResult.vendor_name
                    ? `Detected vendor: "${scanResult.vendor_name}"${
                        scanResult.vendor_confidence !== null
                          ? ` (${scanResult.vendor_confidence.toFixed(0)}% confidence)`
                          : ""
                      }.`
                    : "No vendor name detected — pick the supplier below."}{" "}
                  {scanResult.total && `Receipt total: £${scanResult.total}.`}
                  {scanResult.invoice_number && ` Supplier's invoice number: ${scanResult.invoice_number}.`}
                </div>

                {scanMatchedPO && (
                  <div className="im-note" style={{ marginBottom: 12 }}>
                    <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={scanUseMatchedPO}
                        onChange={(e) => setScanUseMatchedPO(e.target.checked)}
                        style={{ marginTop: 3 }}
                      />
                      <span>
                        This looks like <b>{scanMatchedPO.po_number || "an existing order"}</b> for{" "}
                        {scanMatchedPO.supplier_name} ({scanMatchedPO.status}) — matched on{" "}
                        {scanMatchReasons.length > 1
                          ? `${scanMatchReasons.slice(0, -1).join(", ")} and ${scanMatchReasons[scanMatchReasons.length - 1]}`
                          : scanMatchReasons[0]}
                        . Receive against that order instead of creating a new one?
                      </span>
                    </label>
                  </div>
                )}

                <div className="field" style={{ marginBottom: 12, display: scanUseMatchedPO ? "none" : undefined }}>
                  <label>Supplier</label>
                  <select value={scanSupplierId} onChange={(e) => setScanSupplierId(e.target.value)} required>
                    <option value="">Choose a supplier…</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  {!scanShowNewSupplier ? (
                    <button
                      type="button"
                      className="mini"
                      style={{ marginTop: 8 }}
                      onClick={() => setScanShowNewSupplier(true)}
                    >
                      + New supplier
                    </button>
                  ) : (
                    <div className="new-sup">
                      <input
                        value={scanNewSupplierName}
                        onChange={(e) => setScanNewSupplierName(e.target.value)}
                        placeholder="Supplier name"
                      />
                      <div className="new-sup-row">
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => {
                            setScanShowNewSupplier(false);
                            setScanNewSupplierName("");
                            setScanNewSupplierError(null);
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="mini"
                          onClick={handleCreateScanSupplier}
                          disabled={savingScanSupplier || !scanNewSupplierName.trim()}
                        >
                          {savingScanSupplier ? "Adding…" : "Add supplier"}
                        </button>
                      </div>
                      {scanNewSupplierError && <p className="error">{scanNewSupplierError}</p>}
                    </div>
                  )}
                </div>

                <div className="field" style={{ marginBottom: 12, display: scanUseMatchedPO ? "none" : undefined }}>
                  <label>Deliver to</label>
                  <select value={scanLocationId} onChange={(e) => setScanLocationId(e.target.value)} required>
                    <option value="">Choose a location…</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>

                {scanRows.length === 0 ? (
                  <p className="muted">
                    No line items were detected on this receipt — try a clearer photo, or add lines
                    by hand after creating the order.
                  </p>
                ) : (
                  <>
                    {/* This table has more columns than the modal is wide
                        (item description + a full item picker + qty +
                        price + confidence + skip, vs. e.g. the supplier
                        import modal's 3 columns) -- scope the horizontal
                        scroll to just the table, not the whole modal, so
                        the buttons/hint text below it are never at risk
                        of scrolling out of view along with it. */}
                    <div style={{ overflowX: "auto" }}>
                      <table className="tbl" style={{ marginTop: 4, minWidth: 640 }}>
                        <thead>
                          <tr>
                            <th>On the receipt</th>
                            <th>Matched item</th>
                            <th className="num">Qty</th>
                            <th className="num">Unit price</th>
                            <th className="num">Confidence</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {scanRows.map((row, i) => (
                            <tr key={i} style={row.skip ? { opacity: 0.45 } : undefined}>
                              <td className="muted" style={{ maxWidth: 140 }}>
                                {row.description}
                              </td>
                              <td>
                                <select
                                  value={row.matchedItemId}
                                  onChange={(e) => updateScanRow(i, { matchedItemId: e.target.value })}
                                  disabled={row.skip}
                                  style={{ width: 150 }}
                                >
                                  <option value="">Pick an item…</option>
                                  {(items ?? []).map((it) => (
                                    <option key={it.id} value={it.id}>
                                      {it.name}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="num">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.001"
                                  value={row.qty}
                                  onChange={(e) => updateScanRow(i, { qty: e.target.value })}
                                  disabled={row.skip}
                                  style={{ width: 60 }}
                                />
                              </td>
                              <td className="num">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={row.unitPrice}
                                  onChange={(e) => updateScanRow(i, { unitPrice: e.target.value })}
                                  disabled={row.skip}
                                  style={{ width: 60 }}
                                />
                              </td>
                              <td className="num">
                                <span
                                  className={`badge ${
                                    row.confidence !== null && row.confidence >= 80 ? "b-ok" : "warn"
                                  }`}
                                >
                                  {row.confidence !== null ? `${row.confidence.toFixed(0)}%` : "—"}
                                </span>
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="btn-ghost small"
                                  onClick={() => updateScanRow(i, { skip: !row.skip })}
                                >
                                  {row.skip ? "Include" : "Skip"}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {scanUnmatchedCount > 0 && (
                      <p className="hint" style={{ marginTop: 8 }}>
                        {scanUnmatchedCount} row{scanUnmatchedCount === 1 ? "" : "s"} need
                        {scanUnmatchedCount === 1 ? "s" : ""} a matching item picked above before they
                        can be included — or Skip the row if it isn't a real stock item.
                      </p>
                    )}
                  </>
                )}

                {scanCreatedPO && (
                  <p className="hint">
                    The purchase order was created (and its lines saved) — only marking it received
                    failed. Retry below, or leave it as "Sent" and mark it received later from the
                    order itself.
                  </p>
                )}
                {scanCreateError && <p className="error">{scanCreateError}</p>}
              </>
            )}

            <div className="modal-actions">
              {scanCreatedPO ? (
                <>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={handleLeaveScannedPOAsSent}
                    disabled={retryingReceive}
                  >
                    Leave as Sent, open order
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleRetryReceiveScan}
                    disabled={retryingReceive}
                  >
                    {retryingReceive ? "Retrying…" : "Retry marking as received"}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="btn-ghost" onClick={closeScanModal} disabled={creatingPOFromScan}>
                    Cancel
                  </button>
                  {scanResult && (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={handleCreatePOFromScan}
                      disabled={
                        creatingPOFromScan ||
                        scanIncludedRows.length === 0 ||
                        (scanUseMatchedPO ? !scanMatchedPO : !scanSupplierId || !scanLocationId)
                      }
                    >
                      {creatingPOFromScan
                        ? "Creating…"
                        : scanUseMatchedPO && scanMatchedPO
                        ? `Confirm & mark ${scanMatchedPO.po_number || "order"} received (${
                            scanIncludedRows.length
                          } line${scanIncludedRows.length === 1 ? "" : "s"})`
                        : `Confirm & mark received (${scanIncludedRows.length} line${
                            scanIncludedRows.length === 1 ? "" : "s"
                          })`}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}