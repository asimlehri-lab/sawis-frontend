import { useState } from "react";
import * as XLSX from "xlsx";
import { bulkImportItems, bulkImportRecipes, updateLocation, BASE_UNITS, CURRENCY_OPTIONS, currencySymbol } from "./api";
import type { CatalogItem, CurrencyCode, Location, Recipe } from "./api";
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

// Same idea as downloadCsv, but for the two prebuilt .xlsx template files
// below (built with openpyxl -- one example row already filled in,
// dropdowns on the constrained columns, a Read-me sheet). Embedded as
// base64 rather than served as a static asset: this repo has no public/
// folder to link one from, and there's no reason to round-trip through the
// server for a fixed template file that never changes per-tenant.
function downloadXlsxTemplate(filename: string, base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Regenerate these with the sawis-import tooling (build_xlsx.py /
// build_recipes_final.py) if either template's columns ever change.
const ITEMS_TEMPLATE_XLSX_B64 =
  "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";
const RECIPE_TEMPLATE_XLSX_B64 =
  "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";

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
      <LocationSettingsPanel accessToken={accessToken} locations={locations} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Per-location settings — currency (display only) + monthly overhead (feeds
// End of day's net margin estimate)
// ---------------------------------------------------------------------------

function LocationSettingsPanel({ accessToken, locations }: { accessToken: string; locations: Location[] }) {
  const [overheadValues, setOverheadValues] = useState<Record<string, string>>({});
  const [currencyValues, setCurrencyValues] = useState<Record<string, CurrencyCode>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  function overheadFor(loc: Location) {
    return overheadValues[loc.id] ?? loc.monthly_overhead ?? "";
  }
  function currencyFor(loc: Location) {
    return currencyValues[loc.id] ?? loc.currency;
  }

  async function handleSave(loc: Location) {
    const raw = overheadFor(loc).trim();
    setSaving((s) => ({ ...s, [loc.id]: true }));
    setErrors((e) => ({ ...e, [loc.id]: "" }));
    setSaved((s) => ({ ...s, [loc.id]: false }));
    try {
      await updateLocation(accessToken, loc.id, {
        currency: currencyFor(loc),
        monthly_overhead: raw === "" ? null : raw,
      });
      setSaved((s) => ({ ...s, [loc.id]: true }));
    } catch (e) {
      setErrors((er) => ({ ...er, [loc.id]: e instanceof Error ? e.message : "Could not save this." }));
    } finally {
      setSaving((s) => ({ ...s, [loc.id]: false }));
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Locations</h2>
      <p className="hint">
        Currency changes which symbol this location's own prices/reports show — display only, no exchange-rate
        conversion. Monthly overhead (rent, labour, other fixed costs) feeds End of day's net margin estimate;
        leave blank to skip that estimate.
      </p>
      {!locations.length && <p className="muted">No locations yet.</p>}
      {locations.map((loc) => (
        <div key={loc.id} className="price-row" style={{ alignItems: "center", flexWrap: "wrap" }}>
          <label>{loc.name}</label>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {errors[loc.id] && <span className="error" style={{ padding: "4px 8px" }}>{errors[loc.id]}</span>}
            {saved[loc.id] && !errors[loc.id] && <span className="badge b-ok">Saved</span>}
            <select
              value={currencyFor(loc)}
              onChange={(e) => {
                setCurrencyValues((v) => ({ ...v, [loc.id]: e.target.value as CurrencyCode }));
                setSaved((s) => ({ ...s, [loc.id]: false }));
              }}
            >
              {CURRENCY_OPTIONS.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              className="price-in"
              type="number"
              min="0"
              step="1"
              placeholder="Overhead, e.g. 8000"
              value={overheadFor(loc)}
              onChange={(e) => {
                setOverheadValues((v) => ({ ...v, [loc.id]: e.target.value }));
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
  supplier: string;
  cost: string;
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
  const [result, setResult] = useState<{
    created: number;
    holdingsBackfilled: number;
    suppliersCreated: number;
    supplierLinksSet: number;
  } | null>(null);

  const existingNames = new Set(items.map((i) => i.name.trim().toLowerCase()));

  // Same CSV-or-Excel convergence pattern already used by the supplier
  // catalogue import (App.tsx's handleImportFile) and this file's own
  // parseMenuListFile below: Excel cells come back as real numbers/dates,
  // not strings, so every cell is stringified before the rest of the
  // parser (identical either way) ever sees it.
  function rowsToTable(cellRows: unknown[][]): string[][] {
    return cellRows.map((row) => row.map((c) => (c === null || c === undefined ? "" : String(c).trim())));
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError(null);
    setImportError(null);
    setResult(null);
    const isSpreadsheet = /\.xlsx?$/i.test(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      let table: string[][];
      try {
        if (isSpreadsheet) {
          const workbook = XLSX.read(reader.result as ArrayBuffer, { type: "array" });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
          table = rowsToTable(raw);
        } else {
          table = parseCsv(String(reader.result || ""));
        }
      } catch {
        setParseError("Could not read that file — check it's a valid CSV or Excel spreadsheet.");
        setRows([]);
        return;
      }
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
      const supplierIdx = headerIndexAny(header, ["supplier", "supplier_name"]);
      const costIdx = headerIndexAny(header, ["cost", "price", "unit_price", "unit_cost"]);
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
        // Same "silently drop instead of sending garbage" treatment as
        // par_level above. supplier/cost only mean anything as a pair —
        // handleImport below only sends them through when both are
        // present on a row, so a cost with no supplier name (or vice
        // versa) just quietly does nothing rather than erroring.
        const costRaw = costIdx > -1 ? (r[costIdx] || "").trim() : "";
        const cost = costRaw && !isNaN(Number(costRaw)) && Number(costRaw) >= 0 ? costRaw : "";
        const supplier = supplierIdx > -1 ? (r[supplierIdx] || "").trim() : "";
        parsed.push({
          name,
          sku: skuIdx > -1 ? (r[skuIdx] || "").trim() : "",
          base_unit,
          category: catIdx > -1 ? (r[catIdx] || "").trim() : "",
          vat_rate: vatIdx > -1 ? (r[vatIdx] || "").trim() : "",
          department: deptIdx > -1 ? (r[deptIdx] || "").trim().toLowerCase() : "",
          par_level,
          supplier,
          cost,
          exists: existingNames.has(name.toLowerCase()),
          include: true,
        });
      }
      setRows(parsed);
      if (parsed.length === 0) {
        setParseError('No valid rows found — check "unit" matches a real base unit (g, kg, ml, L, ea, portion, btl, case, dozen).');
      }
    };
    if (isSpreadsheet) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
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
          // Only sent through as a pair — a row with just one of the two
          // filled in sends neither, since the backend treats them as one
          // unit (see BulkItemInput.supplier/cost in api.ts).
          supplier: r.supplier && r.cost ? r.supplier : undefined,
          cost: r.supplier && r.cost ? r.cost : undefined,
        }))
      );
      // Defensive against an older backend that hasn't picked up the
      // supplier/cost change yet (or any future field this screen doesn't
      // know about) -- `res.suppliers_created`/`res.supplier_links_set`
      // would come back undefined rather than an empty array in that case,
      // and reading `.length` off undefined used to crash the whole import
      // result right after a real, successful import. `|| []` makes a
      // stale backend just show 0 for the new counts instead of erroring.
      setResult({
        created: (res.created || []).length,
        holdingsBackfilled: (res.holdings_backfilled || []).length,
        suppliersCreated: (res.suppliers_created || []).length,
        supplierLinksSet: (res.supplier_links_set || []).length,
      });
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
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            className="btn-ghost small"
            onClick={() =>
              downloadCsv(
                "items-import-template.csv",
                ["name", "sku", "unit", "category", "vat", "department", "par_level", "supplier", "cost"],
                [["Beef mince 5%", "", "kg", "Meat", "20", "kitchen", "3", "ACME Foods", "4.20"]]
              )
            }
          >
            ⇩ Download blank CSV template
          </button>
          <button
            type="button"
            className="btn-ghost small"
            onClick={() => downloadXlsxTemplate("items-import-template.xlsx", ITEMS_TEMPLATE_XLSX_B64)}
          >
            ⇩ Download blank Excel template
          </button>
        </div>
        <div className="vhint" style={{ marginTop: 6, marginBottom: 10 }}>
          Both blank templates have one example item already filled in, including <code>supplier</code>/
          <code>cost</code> — delete that row or just overwrite it with your own.
        </div>
      </div>

      <div className="field" style={{ marginBottom: 12 }}>
        <label>CSV or Excel file</label>
        <input type="file" accept=".csv,text/csv,.xlsx,.xls" onChange={handleFile} />
        <div className="vhint">
          Header row: <code>name,sku,unit,category,vat,department,par_level,supplier,cost</code> — only{" "}
          <code>name</code>/<code>unit</code> required. See the templates above for column details.
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
                <th>Supplier</th>
                <th className="num">Cost</th>
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
                  <td className="muted">{r.supplier && r.cost ? r.supplier : "—"}</td>
                  <td className="num">{r.supplier && r.cost ? r.cost : "—"}</td>
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
          {result.supplierLinksSet > 0 &&
            ` ${result.supplierLinksSet} item${result.supplierLinksSet === 1 ? "" : "s"} got a supplier + cost linked${
              result.suppliersCreated > 0
                ? ` (${result.suppliersCreated} new supplier${result.suppliersCreated === 1 ? "" : "s"} created)`
                : ""
            }.`}
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
  // "food" | "drink" | "" -- blank means "don't touch" server-side (see
  // RecipeViewSet.bulk_import's docstring): leaves an existing recipe's
  // classification alone on update, defaults a brand-new recipe to Food.
  // Only meaningful on a group's first row (same as kind/yield/etc) --
  // later ingredient-only rows for the same recipe carry "" and are
  // ignored, matching how those other header fields already work.
  menuGroup: string;
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

  // Same CSV-or-Excel convergence pattern used by ItemsImportPanel.handleFile
  // and this file's own parseMenuListFile -- Excel cells come back as real
  // numbers/dates, not strings, so every cell is stringified before the
  // rest of the parser (identical either way) ever sees it.
  function rowsToTable(cellRows: unknown[][]): string[][] {
    return cellRows.map((row) => row.map((c) => (c === null || c === undefined ? "" : String(c).trim())));
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError(null);
    setImportError(null);
    setResult(null);
    const isSpreadsheet = /\.xlsx?$/i.test(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      let table: string[][];
      try {
        if (isSpreadsheet) {
          const workbook = XLSX.read(reader.result as ArrayBuffer, { type: "array" });
          // The real-data template ships ingredient rows grouped/collapsed
          // under each recipe's first row via Excel's outline feature --
          // sheet_to_json still returns every row regardless of collapsed
          // state, so nothing extra is needed to read through that here.
          const sheetName = workbook.SheetNames.includes("Recipes") ? "Recipes" : workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];
          const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
          table = rowsToTable(raw);
        } else {
          table = parseCsv(String(reader.result || ""));
        }
      } catch {
        setParseError("Could not read that file — check it's a valid CSV or Excel spreadsheet.");
        setRows([]);
        return;
      }
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
      const groupIdx = headerIndexAny(header, ["menu_group", "food_drink", "food/drink", "type"]);
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
        const groupRaw = (groupIdx > -1 ? r[groupIdx] : "").trim().toLowerCase();
        parsed.push({
          recipeName,
          posId: (posIdIdx > -1 ? r[posIdIdx] : "").trim(),
          menuCategory: (catIdx > -1 ? r[catIdx] : "").trim(),
          kind: kindRaw === "sub" ? "sub" : "dish",
          yield_qty: (yqIdx > -1 ? r[yqIdx] : "").trim() || "1",
          yield_unit: (yuIdx > -1 ? r[yuIdx] : "").trim() || "plate",
          menu_price: (priceIdx > -1 ? r[priceIdx] : "").trim(),
          menuGroup: groupRaw === "food" || groupRaw === "drink" ? groupRaw : "",
          ingredientRaw,
          qty,
          unit: (unitIdx > -1 ? r[unitIdx] : "").trim(),
          matchedItemId: ingredientRaw ? matchItem(ingredientRaw) : null,
        });
      }
      setRows(parsed);
      if (parsed.length === 0) setParseError("No valid rows found — check the recipe/ingredient/qty columns.");
    };
    if (isSpreadsheet) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
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
          menu_group: (first.menuGroup || undefined) as "food" | "drink" | undefined,
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
                  ["recipe", "pos_id", "menu_category", "kind", "yield_qty", "yield_unit", "menu_price", "menu_group", "ingredient", "qty", "unit"],
                  [
                    ["Spaghetti Bolognese", "101", "Mains", "dish", "1", "plate", "14.50", "food", "Spaghetti", "0.15", "kg"],
                    ["", "", "", "", "", "", "", "", "Beef mince 5%", "0.12", "kg"],
                    ["", "", "", "", "", "", "", "", "Tomato passata", "0.1", "l"],
                  ]
                )
              }
            >
              ⇩ Download blank CSV template
            </button>
            <button
              type="button"
              className="btn-ghost small"
              onClick={() => downloadXlsxTemplate("recipe-import-template.xlsx", RECIPE_TEMPLATE_XLSX_B64)}
            >
              ⇩ Download blank Excel template
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
            Both templates have one example dish filled in — see the templates for column details. Prefill
            reads your menu-list file and hands back the CSV template with dish details pre-filled; add ingredient
            rows by hand, then upload below.
          </div>

          <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
            <label>CSV or Excel file</label>
            <input type="file" accept=".csv,text/csv,.xlsx,.xls" onChange={handleFile} />
            <div className="vhint">
              One row per ingredient. Header row:{" "}
              <code>recipe,pos_id,menu_category,kind,yield_qty,yield_unit,menu_price,menu_group,ingredient,qty,unit</code>
              — only <code>recipe</code>/<code>ingredient</code>/<code>qty</code> required. Matches an existing
              recipe by <code>pos_id</code> or name and updates it; unmatched ingredients create a new item.
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
                            {r.kind === "dish" && r.menu_price
                              ? ` · ${currencySymbol(locations.find((l) => l.id === location)?.currency)}${r.menu_price}`
                              : ""}
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
