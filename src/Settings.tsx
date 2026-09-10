import { useState } from "react";
import * as XLSX from "xlsx";
import { bulkImportItems, bulkImportRecipes, updateLocation, BASE_UNITS } from "./api";
import type { CatalogItem, Location, Recipe } from "./api";
import MenuListImportModal from "./MenuListImportModal";
import type { ParsedMenuRow } from "./MenuListImportModal";
import SearchSelect from "./SearchSelect";

interface Props {
  accessToken: string;
  items: CatalogItem[];
  recipes: Recipe[];
  locations: Location[];
  // App.tsx caches `items`/`recipes` and only reloads them on demand — a
  // bulk import here changes them server-side (new items, new or
  // backfilled ItemHoldings, new recipes) without App.tsx knowing, so
  // Inventory (which reads stock purely from the cached `items[].holdings`)
  // would keep showing pre-import data until something calls these.
  onItemsChanged: () => void;
  onRecipesChanged: () => void;
}

// Shared by both import panels — a small hand-rolled CSV parser that
// handles quoted fields with embedded commas, same approach as
// EndOfDay.tsx (no library dependency for this simple a format).
// `delimiter` defaults to "," but the menu-list-prefill path below
// passes ";" — POS exports of that shape are semicolon-delimited
// (German-locale Excel default), matching the sample the user provided.
function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((f) => f.trim() !== "")) rows.push(row);
  }
  return rows;
}

function headerIndex(header: string[], name: string): number {
  return header.map((h) => h.trim().toLowerCase()).indexOf(name);
}

// Same header cell, several acceptable spellings — used where a column
// name is more likely to vary (e.g. "pos_id" vs the bare "id" a POS
// menu-list export already uses).
function headerIndexAny(header: string[], names: string[]): number {
  for (const name of names) {
    const idx = headerIndex(header, name);
    if (idx > -1) return idx;
  }
  return -1;
}

// Triggers a real client-side file download of a CSV built from a header
// + rows — same pattern as Reports.tsx's exportMenuCsv (no extra request
// or library needed for this simple a format).
function downloadCsv(filename: string, header: string[], rows: string[][]) {
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Same comma/dot decimal-separator heuristic as App.tsx's cleanNumeric —
// duplicated locally rather than imported since it's not exported there
// (mirrors this file's existing parseCsv/EndOfDay.tsx precedent of small
// self-contained parsing helpers per file). Used for menu-list exports'
// "Preis"/price column, which is often German-locale comma-decimal.
function cleanNumeric(raw: string | null): string {
  if (!raw) return "";
  let cleaned = raw.replace(/[^0-9.,]/g, "");
  if (!cleaned) return "";
  const commaCount = (cleaned.match(/,/g) || []).length;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    cleaned = lastComma > lastDot ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned.replace(/,/g, "");
  } else if (commaCount === 1 && cleaned.length - lastComma - 1 === 2) {
    cleaned = cleaned.replace(",", ".");
  } else {
    cleaned = cleaned.replace(/,/g, "");
  }
  return cleaned;
}

export default function Settings({ accessToken, items, recipes, locations, onItemsChanged, onRecipesChanged }: Props) {
  return (
    <>
      <p className="muted" style={{ fontSize: 13, marginTop: 0, marginBottom: 16 }}>
        Bulk-import a customer's existing menu and stock catalogue from a spreadsheet, instead of adding everything
        one at a time. Import items first, then recipes — recipe ingredients match against whatever items already
        exist.
      </p>
      <ItemsImportPanel accessToken={accessToken} items={items} locations={locations} onItemsChanged={onItemsChanged} />
      <div style={{ height: 20 }} />
      <RecipesImportPanel
        accessToken={accessToken}
        items={items}
        recipes={recipes}
        locations={locations}
        onItemsChanged={onItemsChanged}
        onRecipesChanged={onRecipesChanged}
      />
      <div style={{ height: 20 }} />
      <OverheadPanel accessToken={accessToken} locations={locations} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Monthly overhead — feeds End of day's net margin estimate
// ---------------------------------------------------------------------------

function OverheadPanel({ accessToken, locations }: { accessToken: string; locations: Location[] }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  function valueFor(loc: Location) {
    return values[loc.id] ?? loc.monthly_overhead ?? "";
  }

  async function handleSave(loc: Location) {
    const raw = valueFor(loc).trim();
    setSaving((s) => ({ ...s, [loc.id]: true }));
    setErrors((e) => ({ ...e, [loc.id]: "" }));
    setSaved((s) => ({ ...s, [loc.id]: false }));
    try {
      await updateLocation(accessToken, loc.id, { monthly_overhead: raw === "" ? null : raw });
      setSaved((s) => ({ ...s, [loc.id]: true }));
    } catch (e) {
      setErrors((er) => ({ ...er, [loc.id]: e instanceof Error ? e.message : "Could not save this." }));
    } finally {
      setSaving((s) => ({ ...s, [loc.id]: false }));
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Monthly overhead</h2>
      <p className="hint">
        Rent, labour and other fixed monthly costs per location — set once here so End of day can estimate a real
        net margin (gross margin minus a share of this figure) instead of just food cost. Leave blank if you'd
        rather not estimate net margin yet; nothing else on the site needs this.
      </p>
      {!locations.length && <p className="muted">No locations yet.</p>}
      {locations.map((loc) => (
        <div key={loc.id} className="price-row" style={{ alignItems: "center" }}>
          <label>{loc.name}</label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {errors[loc.id] && <span className="error" style={{ padding: "4px 8px" }}>{errors[loc.id]}</span>}
            {saved[loc.id] && !errors[loc.id] && <span className="badge b-ok">Saved</span>}
            <span className="muted">£</span>
            <input
              className="price-in"
              type="number"
              min="0"
              step="1"
              placeholder="e.g. 8000"
              value={valueFor(loc)}
              onChange={(e) => {
                setValues((v) => ({ ...v, [loc.id]: e.target.value }));
                setSaved((s) => ({ ...s, [loc.id]: false }));
              }}
            />
            <button
              type="button"
              className="btn-ghost small"
              disabled={saving[loc.id]}
              onClick={() => handleSave(loc)}
            >
              {saving[loc.id] ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Items import
// ---------------------------------------------------------------------------

interface ItemRow {
  name: string;
  sku: string;
  base_unit: string;
  category: string;
  vat_rate: string;
  department: string;
  par_level: string;
  exists: boolean;
  include: boolean;
}

function ItemsImportPanel({
  accessToken,
  items,
  locations,
  onItemsChanged,
}: {
  accessToken: string;
  items: CatalogItem[];
  locations: Location[];
  onItemsChanged: () => void;
}) {
  const [location, setLocation] = useState(locations[0]?.id ?? "");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ItemRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; holdingsBackfilled: number } | null>(null);

  const existingNames = new Set(items.map((i) => i.name.trim().toLowerCase()));

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError(null);
    setImportError(null);
    setResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      const table = parseCsv(String(reader.result || ""));
      if (table.length < 2) {
        setParseError("No rows found after the header.");
        setRows([]);
        return;
      }
      const header = table[0];
      const nameIdx = headerIndex(header, "name");
      const skuIdx = headerIndex(header, "sku");
      const unitIdx = headerIndex(header, "unit");
      const catIdx = headerIndex(header, "category");
      const vatIdx = headerIndex(header, "vat");
      const deptIdx = headerIndex(header, "department");
      const parIdx = headerIndexAny(header, ["par_level", "par"]);
      if (nameIdx === -1 || unitIdx === -1) {
        setParseError(`Expected at least "name,unit" columns — found: ${header.join(", ")}`);
        setRows([]);
        return;
      }
      const parsed: ItemRow[] = [];
      for (const r of table.slice(1)) {
        const name = (r[nameIdx] || "").trim();
        const unitRaw = (r[unitIdx] || "").trim();
        const base_unit = BASE_UNITS.find((u) => u.toLowerCase() === unitRaw.toLowerCase()) || "";
        if (!name || !base_unit) continue;
        // A non-numeric par cell (typo, stray text) is treated as blank
        // rather than sent through — better to silently default to 0
        // server-side than to send garbage the backend would also just
        // reject back to 0 anyway.
        const parRaw = parIdx > -1 ? (r[parIdx] || "").trim() : "";
        const par_level = parRaw && !isNaN(Number(parRaw)) && Number(parRaw) >= 0 ? parRaw : "";
        parsed.push({
          name,
          sku: skuIdx > -1 ? (r[skuIdx] || "").trim() : "",
          base_unit,
          category: catIdx > -1 ? (r[catIdx] || "").trim() : "",
          vat_rate: vatIdx > -1 ? (r[vatIdx] || "").trim() : "",
          department: deptIdx > -1 ? (r[deptIdx] || "").trim().toLowerCase() : "",
          par_level,
          exists: existingNames.has(name.toLowerCase()),
          include: true,
        });
      }
      setRows(parsed);
      if (parsed.length === 0) {
        setParseError('No valid rows found — check "unit" matches a real base unit (g, kg, ml, L, ea, portion, btl, case, dozen).');
      }
    };
    reader.readAsText(file);
  }

  function toggleInclude(i: number) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, include: !r.include } : r)));
  }

  // Rows matching an existing item by name are still sent — the backend
  // won't duplicate the Item, it just backfills a missing stock holding
  // for it at the selected location if one doesn't already exist there.
  // This is what makes re-running the same CSV a real way to fix items
  // that got imported before ItemHolding creation existed here.
  const importable = rows.filter((r) => r.include);
  const existingIncluded = rows.filter((r) => r.exists && r.include).length;

  async function handleImport() {
    if (importable.length === 0 || !location) return;
    setImporting(true);
    setImportError(null);
    try {
      const res = await bulkImportItems(
        accessToken,
        location,
        importable.map((r) => ({
          name: r.name,
          sku: r.sku || undefined,
          base_unit: r.base_unit,
          category: r.category || undefined,
          vat_rate: r.vat_rate ? (Number(r.vat_rate) / 100).toFixed(4) : null,
          department: (r.department || undefined) as "kitchen" | "bar" | "foh" | undefined,
          par_level: r.par_level || undefined,
        }))
      );
      setResult({ created: res.created.length, holdingsBackfilled: res.holdings_backfilled.length });
      setRows([]);
      setFileName("");
      onItemsChanged();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Could not import these items.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Import items</h2>

      {locations.length > 1 && (
        <div className="field" style={{ maxWidth: 280, marginBottom: 12 }}>
          <label>Location</label>
          <select value={location} onChange={(e) => setLocation(e.target.value)}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="field" style={{ marginBottom: 12 }}>
        <label>CSV file</label>
        <input type="file" accept=".csv,text/csv" onChange={handleFile} />
        <div className="vhint">
          Header row required: <code>name,sku,unit,category,vat,department,par_level</code> — only{" "}
          <code>name</code> and <code>unit</code> are required. <code>sku</code>/<code>category</code>/
          <code>vat</code> (as a % number) can be left blank. <code>department</code> is optional too (
          <code>kitchen</code>, <code>bar</code> or <code>foh</code>) and defaults to Kitchen — it decides where
          each item's stock holding is created at the location below. <code>par_level</code> is optional and
          defaults to 0 if blank — it only sets the par on a holding this import actually creates (a brand-new
          item, or backfilling a missing holding for an existing item); it never changes the par on a holding
          that already exists. e.g. "Beef mince 5%,,kg,Meat,20,kitchen,3".
        </div>
      </div>

      {!locations.length && <p className="error">No locations yet — add one before importing items.</p>}
      {parseError && <p className="error">{parseError}</p>}
      {importError && <p className="error">{importError}</p>}

      {!result && rows.length > 0 && (
        <>
          <div className="im-note">
            ✓ <b>{rows.length} rows</b> read from {fileName}.
            {existingIncluded > 0 &&
              ` ${existingIncluded} already exist by name — they won't be duplicated, but will get a stock holding at the location above if they don't have one yet.`}
          </div>
          <table className="tbl" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Unit</th>
                <th className="num">VAT</th>
                <th className="num">Par</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={!r.include ? { opacity: 0.45 } : undefined}>
                  <td>{r.name}</td>
                  <td className="muted">{r.category || "—"}</td>
                  <td className="muted">{r.base_unit}</td>
                  <td className="num">{r.vat_rate ? `${r.vat_rate}%` : "—"}</td>
                  <td className="num">{r.par_level || "0"}</td>
                  <td>
                    {r.exists ? (
                      <span className="badge b-low">Already exists — will add holding</span>
                    ) : (
                      <span className="badge b-ok">New</span>
                    )}
                  </td>
                  <td>
                    <button type="button" className="btn-ghost small" onClick={() => toggleInclude(i)}>
                      {r.include ? "Skip" : "Include"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="modal-actions" style={{ marginTop: 16 }}>
            <button
              className="btn-primary"
              onClick={handleImport}
              disabled={importing || importable.length === 0 || !location}
            >
              {importing ? "Importing…" : `Import ${importable.length} item${importable.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </>
      )}

      {result !== null && (
        <div className="im-note" style={{ marginTop: 12 }}>
          ✓ <b>
            {result.created} item{result.created === 1 ? "" : "s"}
          </b>{" "}
          created.
          {result.holdingsBackfilled > 0 &&
            ` ${result.holdingsBackfilled} existing item${
              result.holdingsBackfilled === 1 ? "" : "s"
            } got a stock holding added at this location.`}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recipes import
// ---------------------------------------------------------------------------

interface RecipeRow {
  recipeName: string;
  posId: string;
  menuCategory: string;
  kind: "dish" | "sub";
  yield_qty: string;
  yield_unit: string;
  menu_price: string;
  ingredientRaw: string;
  qty: string;
  unit: string;
  matchedItemId: string | null;
}

function RecipesImportPanel({
  accessToken,
  items,
  recipes,
  locations,
  onItemsChanged,
  onRecipesChanged,
}: {
  accessToken: string;
  items: CatalogItem[];
  recipes: Recipe[];
  locations: Location[];
  onItemsChanged: () => void;
  onRecipesChanged: () => void;
}) {
  const [location, setLocation] = useState(locations[0]?.id ?? "");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<RecipeRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    created: number;
    updated: number;
    itemsCreated: string[];
    holdingsBackfilled: number;
  } | null>(null);

  function matchItem(name: string): string | null {
    const norm = name.trim().toLowerCase();
    const found = items.find((i) => i.name.trim().toLowerCase() === norm);
    return found ? found.id : null;
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError(null);
    setImportError(null);
    setResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      const table = parseCsv(String(reader.result || ""));
      if (table.length < 2) {
        setParseError("No rows found after the header.");
        setRows([]);
        return;
      }
      const header = table[0];
      const recIdx = headerIndex(header, "recipe");
      const posIdIdx = headerIndexAny(header, ["pos_id", "id"]);
      const catIdx = headerIndexAny(header, ["menu_category", "category", "gruppe"]);
      const kindIdx = headerIndex(header, "kind");
      const yqIdx = headerIndex(header, "yield_qty");
      const yuIdx = headerIndex(header, "yield_unit");
      const priceIdx = headerIndex(header, "menu_price");
      const ingIdx = headerIndex(header, "ingredient");
      const qtyIdx = headerIndex(header, "qty");
      const unitIdx = headerIndex(header, "unit");
      if (recIdx === -1 || ingIdx === -1 || qtyIdx === -1) {
        setParseError(
          `Expected at least "recipe,ingredient,qty" columns — found: ${header.join(", ")}`
        );
        setRows([]);
        return;
      }
      const parsed: RecipeRow[] = [];
      for (const r of table.slice(1)) {
        const recipeName = (r[recIdx] || "").trim();
        const ingredientRaw = (r[ingIdx] || "").trim();
        const qty = (r[qtyIdx] || "").trim();
        if (!recipeName) continue;
        // A recipe row is allowed to carry no ingredient at all (e.g. a
        // row prefilled from a menu-list export — see
        // handlePrefillFromMenuList below — that the customer hasn't
        // gotten to yet, or a recipe whose metadata is just being
        // updated): what's rejected is a HALF-filled ingredient (a name
        // with no qty, or a qty with no name), which is more likely a
        // typo than an intentional blank row.
        if ((ingredientRaw && !qty) || (!ingredientRaw && qty)) continue;
        const kindRaw = (kindIdx > -1 ? r[kindIdx] : "").trim().toLowerCase();
        parsed.push({
          recipeName,
          posId: (posIdIdx > -1 ? r[posIdIdx] : "").trim(),
          menuCategory: (catIdx > -1 ? r[catIdx] : "").trim(),
          kind: kindRaw === "sub" ? "sub" : "dish",
          yield_qty: (yqIdx > -1 ? r[yqIdx] : "").trim() || "1",
          yield_unit: (yuIdx > -1 ? r[yuIdx] : "").trim() || "plate",
          menu_price: (priceIdx > -1 ? r[priceIdx] : "").trim(),
          ingredientRaw,
          qty,
          unit: (unitIdx > -1 ? r[unitIdx] : "").trim(),
          matchedItemId: ingredientRaw ? matchItem(ingredientRaw) : null,
        });
      }
      setRows(parsed);
      if (parsed.length === 0) setParseError("No valid rows found — check the recipe/ingredient/qty columns.");
    };
    reader.readAsText(file);
  }

  // "Import menu list" — reads the customer's existing POS menu export
  // (any name/format — a generic recipe/name column, an optional
  // id/pos_id column, an optional category/gruppe column, an optional
  // price/preis column, in either CSV, semicolon-CSV, or Excel) and
  // returns just the recipe metadata rows — never ingredients, since
  // this kind of file never has ingredient data at all. Shared by the
  // primary "Import menu list" flow below (which opens
  // MenuListImportModal for in-app ingredient picking) and the
  // "Prefill from your menu list" advanced option (which turns the same
  // rows into a downloadable spreadsheet template instead).
  //
  // Handles the one real quirk this format tends to have: a POS export
  // sometimes prints a category name as its own bare row (only the
  // category column populated) rather than repeating it on every dish
  // row -- that bare row's value is carried forward onto every following
  // dish row until the next one.
  async function parseMenuListFile(file: File): Promise<ParsedMenuRow[]> {
    const isExcel = /\.xlsx?$/i.test(file.name);
    let table: string[][];
    if (isExcel) {
      const buf = await file.arrayBuffer();
      const workbook = XLSX.read(buf, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
      table = raw.map((row) => row.map((c) => (c === undefined || c === null ? "" : String(c))));
    } else {
      const text = await file.text();
      // Sniff the delimiter rather than assuming — a semicolon-delimited
      // POS export is common (German-locale Excel default), but a
      // customer may have re-saved it in a comma locale.
      const delimiter = text.split("\n")[0].includes(";") ? ";" : ",";
      table = parseCsv(text, delimiter);
    }
    if (table.length < 2) throw new Error("No rows found after the header.");
    const header = table[0];
    const grpIdx = headerIndexAny(header, ["gruppe", "menu_category", "category"]);
    const idIdx = headerIndexAny(header, ["id", "pos_id"]);
    const nameIdx = headerIndexAny(header, ["artikel", "recipe", "name", "dish"]);
    const priceIdx = headerIndexAny(header, ["preis", "menu_price", "price"]);
    if (nameIdx === -1) {
      throw new Error(`Couldn't find a recipe name column — found: ${header.join(", ")}`);
    }
    const parsed: ParsedMenuRow[] = [];
    let currentGroup = "";
    for (const r of table.slice(1)) {
      const group = grpIdx > -1 ? (r[grpIdx] || "").trim() : "";
      const dish = (r[nameIdx] || "").trim();
      if (group && !dish) {
        // A bare category row — no dish on it, just a new heading to
        // apply to the item rows that follow.
        currentGroup = group;
        continue;
      }
      if (!dish) continue;
      parsed.push({
        recipeName: dish,
        posId: idIdx > -1 ? (r[idIdx] || "").trim() : "",
        menuCategory: group || currentGroup,
        menuPrice: priceIdx > -1 ? cleanNumeric(r[priceIdx]) : "",
      });
    }
    if (parsed.length === 0) throw new Error("No recipe rows found in that file.");
    return parsed;
  }

  // Primary path: parse the menu list, then open MenuListImportModal so
  // the user picks ingredients per dish in-app instead of typing them
  // into a spreadsheet.
  const [menuListRows, setMenuListRows] = useState<ParsedMenuRow[] | null>(null);
  const [menuListFileName, setMenuListFileName] = useState("");
  const [menuListError, setMenuListError] = useState<string | null>(null);

  async function handleMenuListFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMenuListError(null);
    try {
      const parsed = await parseMenuListFile(file);
      setMenuListFileName(file.name);
      setMenuListRows(parsed);
    } catch (err) {
      setMenuListError(err instanceof Error ? err.message : "Could not read that file.");
    }
    e.target.value = "";
  }

  // Advanced path: same parse, but hands the result back as a
  // downloadable copy of the ingredient-column CSV template below
  // (recipe/pos_id/menu_category/menu_price pre-filled, ingredient/qty/
  // unit left blank) for anyone who'd rather bulk-edit a spreadsheet.
  const [prefillError, setPrefillError] = useState<string | null>(null);

  async function handlePrefillFromMenuList(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPrefillError(null);
    try {
      const parsed = await parseMenuListFile(file);
      downloadCsv(
        "recipe-ingredients-template.csv",
        ["recipe", "pos_id", "menu_category", "kind", "yield_qty", "yield_unit", "menu_price", "ingredient", "qty", "unit"],
        parsed.map((r) => [r.recipeName, r.posId, r.menuCategory, "dish", "1", "plate", r.menuPrice, "", "", ""])
      );
    } catch (err) {
      setPrefillError(err instanceof Error ? err.message : "Could not read that file.");
    }
    e.target.value = "";
  }

  function updateRow(i: number, patch: Partial<RecipeRow>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  // First occurrence of each recipe name supplies the header fields
  // (kind/yield/menu price/pos_id/menu_category); later rows for the
  // same recipe are ingredient lines only, matching the "one row per
  // ingredient" CSV shape. Grouped by name (not pos_id) since that's
  // what repeats down the CSV rows for a given recipe — pos_id is
  // carried along on the group's first row and used below purely to
  // decide create-vs-update against what's already in SAWIS.
  const recipeOrder: string[] = [];
  const grouped = new Map<string, RecipeRow[]>();
  for (const r of rows) {
    const key = r.recipeName.trim().toLowerCase();
    if (!grouped.has(key)) {
      recipeOrder.push(key);
      grouped.set(key, []);
    }
    grouped.get(key)!.push(r);
  }
  const newItemNames = new Set(
    rows.filter((r) => !r.matchedItemId && r.ingredientRaw).map((r) => r.ingredientRaw.trim().toLowerCase())
  );
  const recipesByPosId = new Map(recipes.filter((r) => r.pos_id).map((r) => [r.pos_id, r]));
  const recipesByName = new Map(recipes.map((r) => [r.name.trim().toLowerCase(), r]));

  // What a group's first row will match against server-side (see
  // RecipeViewSet.bulk_import's upsert: pos_id first, else name) — used
  // to show "will update" vs "will create" before the user confirms,
  // and how many of that recipe's existing ingredient lines will be
  // replaced by this import.
  function matchFor(first: RecipeRow): Recipe | undefined {
    if (first.posId && recipesByPosId.has(first.posId)) return recipesByPosId.get(first.posId);
    return recipesByName.get(first.recipeName.trim().toLowerCase());
  }

  async function handleImport() {
    if (rows.length === 0 || !location) return;
    setImporting(true);
    setImportError(null);
    try {
      const payload = recipeOrder.map((key) => {
        const group = grouped.get(key)!;
        const first = group[0];
        return {
          name: first.recipeName,
          kind: first.kind,
          yield_qty: first.yield_qty,
          yield_unit: first.yield_unit,
          menu_price: first.kind === "dish" && first.menu_price ? first.menu_price : null,
          pos_id: first.posId || undefined,
          menu_category: first.menuCategory || undefined,
          lines: group
            .filter((r) => r.ingredientRaw && r.qty)
            .map((r) => ({
              item_id: r.matchedItemId || undefined,
              item_name: r.ingredientRaw,
              qty: r.qty,
              unit: r.unit,
            })),
        };
      });
      const res = await bulkImportRecipes(accessToken, location, payload);
      setResult({
        created: res.created,
        updated: res.updated,
        itemsCreated: res.items_created,
        holdingsBackfilled: res.holdings_backfilled.length,
      });
      setRows([]);
      setFileName("");
      onRecipesChanged();
      if (res.items_created.length > 0 || res.holdings_backfilled.length > 0) onItemsChanged();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Could not import these recipes.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Import recipes</h2>

      {locations.length > 1 && (
        <div className="field" style={{ maxWidth: 280, marginBottom: 12 }}>
          <label>Location</label>
          <select value={location} onChange={(e) => setLocation(e.target.value)}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="field" style={{ marginBottom: 14 }}>
        <label>Import menu list</label>
        <input type="file" accept=".csv,text/csv,.xlsx,.xls" onChange={handleMenuListFile} />
        {menuListError && <p className="error" style={{ marginTop: 6 }}>{menuListError}</p>}
        <div className="vhint">
          Upload your menu export from your POS or till system (CSV or Excel — a recipe/dish name column is all
          that's required; ID, category, and price columns are picked up automatically if present). You'll then
          pick each dish's ingredients from your existing items on screen — nothing to type into a spreadsheet.
        </div>
      </div>

      {menuListRows && (
        <MenuListImportModal
          accessToken={accessToken}
          items={items}
          recipes={recipes}
          location={location}
          fileName={menuListFileName}
          rows={menuListRows}
          onClose={() => setMenuListRows(null)}
          onItemsChanged={onItemsChanged}
          onRecipesChanged={() => {
            onRecipesChanged();
            setMenuListRows(null);
          }}
        />
      )}

      <details className="field" style={{ marginBottom: 12 }}>
        <summary className="mini-link">Advanced: use a spreadsheet template instead</summary>
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              className="btn-ghost small"
              onClick={() =>
                downloadCsv(
                  "recipe-ingredients-template.csv",
                  ["recipe", "pos_id", "menu_category", "kind", "yield_qty", "yield_unit", "menu_price", "ingredient", "qty", "unit"],
                  [
                    ["Spaghetti Bolognese", "101", "Mains", "dish", "1", "plate", "14.50", "Spaghetti", "0.15", "kg"],
                    ["", "", "", "", "", "", "", "Beef mince 5%", "0.12", "kg"],
                    ["", "", "", "", "", "", "", "Tomato passata", "0.1", "l"],
                  ]
                )
              }
            >
              ⇩ Download blank template
            </button>
            <span className="muted" style={{ fontSize: 12 }}>or</span>
            <label className="btn-ghost small" style={{ cursor: "pointer" }}>
              ⇩ Prefill from your menu list
              <input
                type="file"
                accept=".csv,text/csv,.xlsx,.xls"
                onChange={handlePrefillFromMenuList}
                style={{ display: "none" }}
              />
            </label>
          </div>
          {prefillError && <p className="error" style={{ marginTop: 6 }}>{prefillError}</p>}
          <div className="vhint">
            The blank template has one example dish already filled in. The prefill option reads the same menu-list
            file as the import above and hands back this template with <code>recipe</code>/<code>pos_id</code>/
            <code>menu_category</code>/<code>menu_price</code> already filled in from it — add an ingredient row (or
            several) under each dish by hand, then upload the result below.
          </div>

          <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
            <label>CSV file</label>
            <input type="file" accept=".csv,text/csv" onChange={handleFile} />
            <div className="vhint">
              One row per ingredient. Header row:{" "}
              <code>recipe,pos_id,menu_category,kind,yield_qty,yield_unit,menu_price,ingredient,qty,unit</code>.
              Repeat the recipe name (and its <code>pos_id</code>/<code>menu_category</code>, though only the first
              row of each recipe needs them) on every ingredient row that belongs to it — only <code>recipe</code>,
              {" "}<code>ingredient</code> and <code>qty</code> are required, the rest default sensibly. A recipe
              whose <code>pos_id</code> (or, failing that, name) already matches one in SAWIS gets <b>updated</b> —
              its ingredient list is replaced by what's in this file — rather than creating a duplicate; anything
              new is <b>created</b>. Any ingredient that doesn't match an existing item will <b>create a new item
              automatically</b> (with a stock holding at the location below, in the Kitchen department) — reviewed
              below before you confirm.
            </div>
          </div>
        </div>
      </details>

      {!locations.length && <p className="error">No locations yet — add one before importing recipes.</p>}
      {parseError && <p className="error">{parseError}</p>}
      {importError && <p className="error">{importError}</p>}

      {!result && rows.length > 0 && (
        <>
          <div className="im-note">
            ✓ <b>{recipeOrder.length} recipe{recipeOrder.length === 1 ? "" : "s"}</b>, {rows.length} ingredient
            line{rows.length === 1 ? "" : "s"} read from {fileName}.
            {newItemNames.size > 0 && ` ${newItemNames.size} new item${newItemNames.size === 1 ? "" : "s"} will be created.`}
          </div>
          <table className="tbl" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>Recipe</th>
                <th>Ingredient (from CSV)</th>
                <th>Matched item</th>
                <th className="num">Qty</th>
                <th>Unit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const isFirstOfGroup = i === 0 || rows[i - 1].recipeName.trim().toLowerCase() !== r.recipeName.trim().toLowerCase();
                const match = isFirstOfGroup ? matchFor(r) : undefined;
                const existingLineCount = match ? match.lines.filter((l) => l.line_type === "item").length : 0;
                return (
                  <tr key={i}>
                    <td>
                      {isFirstOfGroup ? (
                        <>
                          <b>{r.recipeName}</b>
                          <div className="muted" style={{ fontSize: 11 }}>
                            {r.kind} · yields {r.yield_qty} {r.yield_unit}
                            {r.kind === "dish" && r.menu_price ? ` · £${r.menu_price}` : ""}
                            {r.posId ? ` · POS ${r.posId}` : ""}
                            {r.menuCategory ? ` · ${r.menuCategory}` : ""}
                          </div>
                          {match ? (
                            <div className="badge b-low" style={{ marginTop: 3 }}>
                              Will update — matched by {r.posId && match.pos_id === r.posId ? "POS ID" : "name"}
                              {existingLineCount > 0 ? `, replaces ${existingLineCount} existing ingredient line${existingLineCount === 1 ? "" : "s"}` : ""}
                            </div>
                          ) : (
                            <div className="badge b-ok" style={{ marginTop: 3 }}>
                              Will create new recipe
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="muted">↳</span>
                      )}
                    </td>
                    <td>{r.ingredientRaw || <span className="muted">— (no ingredients on this row)</span>}</td>
                    <td>
                      {!r.ingredientRaw ? (
                        <span className="muted">—</span>
                      ) : r.matchedItemId ? (
                        <span className="badge b-ok">{items.find((it) => it.id === r.matchedItemId)?.name}</span>
                      ) : (
                        <>
                          <span className="badge b-low" style={{ marginRight: 6 }}>
                            Will create new item
                          </span>
                          <SearchSelect
                            value=""
                            onChange={(val) => updateRow(i, { matchedItemId: val || null })}
                            placeholder="— or match existing —"
                            aria-label="Match existing item"
                            style={{ width: 200 }}
                            options={items.map((it) => ({ value: it.id, label: it.name }))}
                          />
                        </>
                      )}
                    </td>
                    <td className="num">{r.qty || "—"}</td>
                    <td className="muted">{r.unit || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="modal-actions" style={{ marginTop: 16 }}>
            <button className="btn-primary" onClick={handleImport} disabled={importing || !location}>
              {importing
                ? "Importing…"
                : `Import ${recipeOrder.length} recipe${recipeOrder.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </>
      )}

      {result && (
        <div className="im-note" style={{ marginTop: 12 }}>
          ✓ {result.created > 0 && <><b>{result.created} recipe{result.created === 1 ? "" : "s"}</b> created</>}
          {result.created > 0 && result.updated > 0 && " and "}
          {result.updated > 0 && <><b>{result.updated} recipe{result.updated === 1 ? "" : "s"}</b> updated</>}
          {result.created === 0 && result.updated === 0 && "Nothing imported"}.
          {result.itemsCreated.length > 0 &&
            ` ${result.itemsCreated.length} new item${result.itemsCreated.length === 1 ? "" : "s"} created: ${result.itemsCreated.join(", ")}.`}
          {result.holdingsBackfilled > 0 &&
            ` ${result.holdingsBackfilled} matched ingredient${
              result.holdingsBackfilled === 1 ? "" : "s"
            } got a stock holding added at this location.`}
        </div>
      )}
    </div>
  );
}
