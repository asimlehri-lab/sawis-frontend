import { useEffect, useState } from "react";
import { fetchLastImportDate, importSales } from "./api";
import type { CatalogItem, ItemSupplierRow, Location, Recipe } from "./api";
import Reorder from "./Reorder";
import EodReport from "./EodReport";

interface Props {
  accessToken: string;
  locations: Location[];
  recipes: Recipe[];
  items: CatalogItem[];
  itemSupplierLinks: ItemSupplierRow[];
}

interface ParsedRow {
  date: string;
  dishRaw: string;
  qty: number;
  revenue: string;
  covers: number | null;
  matchedRecipeId: string | null;
  skip: boolean;
}

// Basic CSV parser (handles quoted fields with embedded commas) — no
// library needed for the simple date/dish/qty/revenue template this
// screen expects.
function parseCsv(text: string): string[][] {
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
    } else if (c === ",") {
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

function parseMoney(raw: string): string {
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num.toFixed(2) : "0.00";
}

// "Today, 14:32" / "15 Aug, 09:10" — a compact at-a-glance answer to "when
// did someone last actually run an import," not a full timestamp.
function fmtImportedAt(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const datePart = sameDay ? "Today" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const timePart = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${datePart}, ${timePart}`;
}

export default function EndOfDay({ accessToken, locations, recipes, items, itemSupplierLinks }: Props) {
  const [tab, setTab] = useState<"overview" | "reorder">("overview");
  const [location, setLocation] = useState(locations[0]?.id ?? "");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    sales: number;
    dishes: number;
    revenue: number;
    skipped: number;
    undepletedIngredients: string[];
  } | null>(null);

  // "Last imported" + the (currently manual-only) source line under the
  // compact import control — see the last_import backend action for why
  // this reads created_at, not the date inside the file.
  const [lastImportedAt, setLastImportedAt] = useState<string | null>(null);
  const [lastImportLoading, setLastImportLoading] = useState(false);

  function refreshLastImport(loc: string) {
    if (!loc) return;
    setLastImportLoading(true);
    fetchLastImportDate(accessToken, loc)
      .then(setLastImportedAt)
      .catch(() => setLastImportedAt(null))
      .finally(() => setLastImportLoading(false));
  }

  useEffect(() => {
    refreshLastImport(location);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  const dishRecipes = recipes.filter((r) => r.kind === "dish");

  function matchRecipe(name: string): string | null {
    const norm = name.trim().toLowerCase();
    const found = dishRecipes.find((r) => r.name.trim().toLowerCase() === norm);
    return found ? found.id : null;
  }

  function processFile(file: File) {
    setFileName(file.name);
    setParseError(null);
    setImportError(null);
    setResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const table = parseCsv(text);
      if (table.length < 2) {
        setParseError("No rows found after the header.");
        setRows([]);
        return;
      }
      const header = table[0].map((h) => h.trim().toLowerCase());
      const dateIdx = header.indexOf("date");
      const dishIdx = header.indexOf("dish");
      const qtyIdx = header.indexOf("qty");
      const revIdx = header.indexOf("revenue");
      const coversIdx = header.indexOf("covers");
      if (dateIdx === -1 || dishIdx === -1 || qtyIdx === -1 || revIdx === -1) {
        setParseError(`Expected columns "date,dish,qty,revenue" in the first row — found: ${table[0].join(", ")}`);
        setRows([]);
        return;
      }
      const parsed: ParsedRow[] = [];
      for (const r of table.slice(1)) {
        const date = (r[dateIdx] || "").trim();
        const dishRaw = (r[dishIdx] || "").trim();
        const qtyNum = Number((r[qtyIdx] || "").trim());
        if (!date || !dishRaw || !Number.isFinite(qtyNum) || qtyNum <= 0) continue;
        const coversRaw = coversIdx > -1 ? (r[coversIdx] || "").trim() : "";
        const coversNum = coversRaw ? Math.round(Number(coversRaw)) : NaN;
        parsed.push({
          date,
          dishRaw,
          qty: Math.round(qtyNum),
          revenue: parseMoney(r[revIdx] || "0"),
          covers: Number.isFinite(coversNum) && coversNum > 0 ? coversNum : null,
          matchedRecipeId: matchRecipe(dishRaw),
          skip: false,
        });
      }
      setRows(parsed);
      if (parsed.length === 0) {
        setParseError("No valid rows found — check the date/dish/qty/revenue columns.");
      } else {
        setShowImportModal(true);
      }
    };
    reader.readAsText(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = ""; // so picking the same filename again still fires onChange
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  function closeImportModal() {
    setShowImportModal(false);
    setRows([]);
    setFileName("");
    setParseError(null);
    setImportError(null);
    setResult(null);
  }

  function updateRow(i: number, patch: Partial<ParsedRow>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  const unmatchedCount = rows.filter((r) => !r.skip && !r.matchedRecipeId).length;
  const importableRows = rows.filter((r) => !r.skip && r.matchedRecipeId);

  async function handleImport() {
    if (!location || importableRows.length === 0) return;
    setImporting(true);
    setImportError(null);
    try {
      const byDate = new Map<string, ParsedRow[]>();
      for (const r of importableRows) {
        const list = byDate.get(r.date) ?? [];
        list.push(r);
        byDate.set(r.date, list);
      }
      let salesCreated = 0;
      let dishesTotal = 0;
      let revenueTotal = 0;
      const undepleted = new Set<string>();
      for (const [date, dateRows] of byDate) {
        // "covers" is a per-day figure, not per-dish — the CSV can only
        // really carry one constant value per date, so the first row
        // that has one wins for the whole day.
        const covers = dateRows.find((r) => r.covers !== null)?.covers ?? undefined;
        const sale = await importSales(accessToken, {
          location,
          occurred_at: date,
          covers,
          lines: dateRows.map((r) => ({
            recipe: r.matchedRecipeId as string,
            qty: r.qty,
            gross_amount: r.revenue,
          })),
        });
        salesCreated++;
        for (const name of sale.skipped_depletion_items || []) undepleted.add(name);
        for (const r of dateRows) {
          dishesTotal += r.qty;
          revenueTotal += Number(r.revenue) || 0;
        }
      }
      setResult({
        sales: salesCreated,
        dishes: dishesTotal,
        revenue: revenueTotal,
        skipped: rows.length - importableRows.length,
        undepletedIngredients: Array.from(undepleted).sort(),
      });
      setRows([]);
      setFileName("");
      refreshLastImport(location);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Could not import these sales.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <div className="eod-head">
        <div className="eod-import">
          {locations.length > 1 && (
            <select className="eod-import-loc" value={location} onChange={(e) => setLocation(e.target.value)}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}

          <div
            className="eod-dropzone"
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <div className={`eod-dropzone-box${dragOver ? " dragover" : ""}`}>
              <span className="info-tooltip">
                ⇪ Import sales
                <span className="info-tooltip-body">
                  <b>CSV file</b> — header row required: <code>date,dish,qty,revenue</code>, e.g. "2026-08-15,
                  Cheeseburger,12,144.00". Dates as YYYY-MM-DD. "dish" must match a recipe name (not case-sensitive)
                  — anything that doesn't match can be matched by hand after upload. An optional{" "}
                  <code>covers</code> column (diners served that day) feeds the Overview tab's per-cover numbers —
                  same value on every row for that date.
                </span>
              </span>
            </div>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileInput}
              disabled={!locations.length}
              aria-label="Import sales CSV"
            />
          </div>

          {parseError && (
            <p className="error" style={{ fontSize: 11.5, marginTop: 6, marginBottom: 0, textAlign: "right" }}>
              {parseError}
            </p>
          )}

          <div className="eod-import-meta">
            {!locations.length
              ? "No locations yet"
              : lastImportLoading
              ? "Checking last import…"
              : lastImportedAt
              ? `Last imported ${fmtImportedAt(lastImportedAt)}`
              : "No sales imported yet"}
            {/* Manual-only for now — once a POS connects directly, this line
                is where its name + a live/connected/disconnected traffic
                light (green/amber/red) will replace "Manual CSV upload". */}
            <span className="eod-source">Source: manual CSV upload</span>
          </div>
        </div>
      </div>

      <div className="rtabs" style={{ marginBottom: 16 }}>
        <button className={`rtab ${tab === "overview" ? "on" : ""}`} onClick={() => setTab("overview")}>
          Overview
        </button>
        <button className={`rtab ${tab === "reorder" ? "on" : ""}`} onClick={() => setTab("reorder")}>
          Reorder
        </button>
      </div>

      {tab === "overview" && <EodReport accessToken={accessToken} locations={locations} />}

      {tab === "reorder" && (
        <Reorder accessToken={accessToken} items={items} locations={locations} itemSupplierLinks={itemSupplierLinks} />
      )}

      {showImportModal && (
        <div className="modal-backdrop" onClick={() => !importing && closeImportModal()}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Import sales CSV</h2>

            {importError && <p className="error">{importError}</p>}

            {!result && rows.length > 0 && (
              <>
                {fileName && (
                  <div className="im-note">
                    ✓ <b>{rows.length} rows</b> read from {fileName}.
                    {unmatchedCount > 0 && ` ${unmatchedCount} need matching below before they can be imported.`}
                  </div>
                )}
                <table className="tbl" style={{ marginTop: 10 }}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Dish (from CSV)</th>
                      <th>Matched recipe</th>
                      <th className="num">Qty</th>
                      <th className="num">Revenue</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} style={r.skip ? { opacity: 0.45 } : undefined}>
                        <td className="muted">{r.date}</td>
                        <td>{r.dishRaw}</td>
                        <td>
                          {r.matchedRecipeId ? (
                            <span className="badge b-ok">
                              {dishRecipes.find((d) => d.id === r.matchedRecipeId)?.name}
                            </span>
                          ) : (
                            <select
                              value=""
                              onChange={(e) => updateRow(i, { matchedRecipeId: e.target.value || null })}
                              disabled={r.skip}
                            >
                              <option value="">Pick a recipe…</option>
                              {dishRecipes.map((d) => (
                                <option key={d.id} value={d.id}>
                                  {d.name}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td className="num">{r.qty}</td>
                        <td className="num">£{(Number(r.revenue) || 0).toFixed(2)}</td>
                        <td>
                          <button
                            type="button"
                            className="btn-ghost small"
                            onClick={() => updateRow(i, { skip: !r.skip })}
                          >
                            {r.skip ? "Include" : "Skip"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {result && (
              <div className="im-note">
                ✓ <b>
                  {result.sales} sale{result.sales === 1 ? "" : "s"}
                </b>{" "}
                imported — {result.dishes} dishes, £{result.revenue.toFixed(2)} revenue.
                {result.skipped > 0 && ` ${result.skipped} row${result.skipped === 1 ? "" : "s"} skipped.`}{" "}
                {result.undepletedIngredients.length === 0
                  ? "Stock has been depleted for every matched ingredient."
                  : `Stock was depleted for every ingredient that has a stock holding at this location. ${result.undepletedIngredients.length} ingredient${result.undepletedIngredients.length === 1 ? " has" : "s have"} no holding here yet and could not be depleted: ${result.undepletedIngredients.join(", ")}. Add a stock holding for ${result.undepletedIngredients.length === 1 ? "it" : "them"} in Inventory (or re-import via Settings) to track it going forward.`}
              </div>
            )}

            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={closeImportModal} disabled={importing}>
                {result !== null ? "Close" : "Cancel"}
              </button>
              {result === null && (
                <button
                  className="btn-primary"
                  onClick={handleImport}
                  disabled={importing || !location || importableRows.length === 0}
                >
                  {importing
                    ? "Importing…"
                    : `Import ${importableRows.length} sale${importableRows.length === 1 ? "" : "s"}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
