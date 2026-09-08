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

// Basic CSV parser (handles quoted fields with embedded delimiters) — no
// library needed for either format this screen accepts. `delim` defaults
// to comma for the simple date/dish/qty/revenue template; the raw POS
// export (see parsePosExport below) passes ";" instead.
function parseCsv(text: string, delim: string = ","): string[][] {
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
    } else if (c === delim) {
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

// German-locale numbers ("1,00", "1.234,56") — thousands dots then a
// comma decimal — as used throughout the raw POS export (Menge, Gesamt).
function parseGermanNumber(raw: string): number {
  const cleaned = raw.trim().replace(/\./g, "").replace(",", ".");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

// The POS export's date column is "YYYY/MM/DD HH:MM" in the one real file
// seen so far, but this also accepts DD/MM/YYYY and DD.MM.YYYY defensively
// in case a different till/export settings produces one of those instead.
// Always returns YYYY-MM-DD (or "" if unrecognisable) to match the shape
// the rest of this screen already works in.
function normalizePosDate(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (s.includes("/")) {
    const [a, b, c] = s.split("/");
    if (!a || !b || !c) return "";
    return a.length === 4
      ? `${a}-${b.padStart(2, "0")}-${c.padStart(2, "0")}` // YYYY/MM/DD
      : `${c}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`; // DD/MM/YYYY
  }
  if (s.includes(".")) {
    const [a, b, c] = s.split(".");
    if (!a || !b || !c) return "";
    return `${c}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`; // DD.MM.YYYY
  }
  return "";
}

// Reads a file as text, auto-detecting encoding: tries strict UTF-8 first
// (what the simple date/dish/qty/revenue template is always saved as),
// and falls back to windows-1252 if that fails — the raw POS export comes
// straight off a Windows till in that encoding, not UTF-8 (confirmed
// against the real dep_umsatz*.csv file: umlaut bytes that aren't valid
// UTF-8 sequences). windows-1252 is a superset of the ISO-8859-1 bytes
// that file actually uses, so it decodes it correctly too.
function readFileSmart(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const buf = reader.result as ArrayBuffer;
      try {
        resolve(new TextDecoder("utf-8", { fatal: true }).decode(buf));
      } catch {
        resolve(new TextDecoder("windows-1252").decode(buf));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
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
  // Which format the last-parsed file was, and (for the POS export, which
  // aggregates many transaction lines into fewer review rows) how many
  // raw lines that came from — purely so the review modal can say
  // "aggregated from N lines" instead of leaving the row-count drop
  // unexplained. null/0 before anything's been parsed yet.
  const [sourceFormat, setSourceFormat] = useState<"simple" | "pos" | null>(null);
  const [rawLineCount, setRawLineCount] = useState(0);
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

  // A POS ID match (when the row has one and it's on file) always wins —
  // it's the more reliable of the two, since dish names can be renamed or
  // formatted slightly differently between the till and SAWIS. Falls back
  // to an exact (trimmed, case-insensitive) name match, same as before.
  function matchRecipe(name: string, posId?: string): string | null {
    if (posId) {
      const byId = dishRecipes.find((r) => r.pos_id && r.pos_id.trim() === posId.trim());
      if (byId) return byId.id;
    }
    const norm = name.trim().toLowerCase();
    const found = dishRecipes.find((r) => r.name.trim().toLowerCase() === norm);
    return found ? found.id : null;
  }

  // Format 1 — the simple template this screen has always accepted:
  // header "date,dish,qty,revenue" (+ optional "covers"), one row per
  // dish per day already. Returns null if the header doesn't match (so
  // processFile can try the other format instead), not if it matches but
  // has zero data rows.
  function parseSimpleCsv(text: string): ParsedRow[] | null {
    const table = parseCsv(text, ",");
    if (table.length < 1) return null;
    const header = table[0].map((h) => h.trim().toLowerCase());
    const dateIdx = header.indexOf("date");
    const dishIdx = header.indexOf("dish");
    const qtyIdx = header.indexOf("qty");
    const revIdx = header.indexOf("revenue");
    if (dateIdx === -1 || dishIdx === -1 || qtyIdx === -1 || revIdx === -1) return null;
    const coversIdx = header.indexOf("covers");
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
    setRawLineCount(parsed.length);
    return parsed;
  }

  // Format 2 — the raw semicolon-delimited POS export (e.g.
  // dep_umsatz2026.08.csv): one row per transaction line, not per
  // dish-per-day, so several rows can share the same date + item (a
  // "Belegreferenz"/receipt groups the lines of one sale, but that's not
  // what we aggregate by here — the whole day's total per item is what
  // this screen actually needs). Aggregated by (date, ArtikelID or, if
  // that's blank, the lowercased name) before matching, so the review
  // table shows one row per dish per day exactly like format 1 does.
  // Returns null if the header doesn't look like this format at all.
  function parsePosExport(text: string): ParsedRow[] | null {
    const table = parseCsv(text, ";");
    if (table.length < 1) return null;
    const header = table[0].map((h) => h.trim());
    const idx = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
    const dateIdx = idx("Datum/Uhrzeit");
    const artikelIdIdx = idx("ArtikelID");
    const nameIdx = idx("Artikelbezeichnung");
    const qtyIdx = idx("Menge");
    const totalIdx = idx("Gesamt");
    if (dateIdx === -1 || nameIdx === -1 || qtyIdx === -1 || totalIdx === -1) return null;

    const agg = new Map<string, { date: string; posId: string; name: string; qty: number; revenue: number }>();
    let rawLines = 0;
    for (const r of table.slice(1)) {
      const date = normalizePosDate((r[dateIdx] || "").split(" ")[0]);
      const name = (r[nameIdx] || "").trim();
      if (!date || !name) continue;
      const posId = artikelIdIdx > -1 ? (r[artikelIdIdx] || "").trim() : "";
      const qty = parseGermanNumber(r[qtyIdx] || "0");
      const revenue = parseGermanNumber(r[totalIdx] || "0");
      if (qty <= 0) continue;
      rawLines++;
      const key = `${date}|${posId || name.toLowerCase()}`;
      const existing = agg.get(key);
      if (existing) {
        existing.qty += qty;
        existing.revenue += revenue;
      } else {
        agg.set(key, { date, posId, name, qty, revenue });
      }
    }
    setRawLineCount(rawLines);
    const parsed: ParsedRow[] = [];
    for (const a of agg.values()) {
      parsed.push({
        date: a.date,
        dishRaw: a.name,
        qty: Math.round(a.qty),
        revenue: a.revenue.toFixed(2),
        covers: null,
        matchedRecipeId: matchRecipe(a.name, a.posId),
        skip: false,
      });
    }
    return parsed;
  }

  function processFile(file: File) {
    setFileName(file.name);
    setParseError(null);
    setImportError(null);
    setResult(null);
    readFileSmart(file)
      .then((text) => {
        const simple = parseSimpleCsv(text);
        const parsed = simple !== null ? simple : parsePosExport(text);
        const format: "simple" | "pos" | null = simple !== null ? "simple" : parsed !== null ? "pos" : null;
        if (parsed === null) {
          setParseError(
            'Unrecognised file — expected either "date,dish,qty,revenue" columns, or a POS export with ' +
              '"Datum/Uhrzeit;ArtikelID;Artikelbezeichnung;Menge;Gesamt" columns.'
          );
          setRows([]);
          setSourceFormat(null);
          return;
        }
        setSourceFormat(format);
        setRows(parsed);
        if (parsed.length === 0) {
          setParseError(
            format === "pos"
              ? "No valid sales lines found in this POS export."
              : "No valid rows found — check the date/dish/qty/revenue columns."
          );
        } else {
          setShowImportModal(true);
        }
      })
      .catch(() => {
        setParseError("Could not read this file.");
        setRows([]);
        setSourceFormat(null);
      });
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
    setSourceFormat(null);
    setRawLineCount(0);
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
                  Two file types accepted — detected automatically from the header row.
                  <br />
                  <br />
                  <b>Simple CSV</b> — header <code>date,dish,qty,revenue</code>, e.g. "2026-08-15,
                  Cheeseburger,12,144.00". Dates as YYYY-MM-DD. "dish" must match a recipe name (not case-sensitive)
                  — anything that doesn't match can be matched by hand after upload. An optional{" "}
                  <code>covers</code> column (diners served that day) feeds the Overview tab's per-cover numbers —
                  same value on every row for that date.
                  <br />
                  <br />
                  <b>Raw POS export</b> — the till's own semicolon-separated report (columns include{" "}
                  <code>Datum/Uhrzeit</code>, <code>ArtikelID</code>, <code>Artikelbezeichnung</code>,{" "}
                  <code>Menge</code>, <code>Gesamt</code>). Its many rows per sale are added up automatically into
                  one line per dish per day. Matches by the recipe's POS ID first, then by name.
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
                    ✓{" "}
                    <b>
                      {rows.length} {sourceFormat === "pos" ? "dishes" : "rows"}
                    </b>{" "}
                    {sourceFormat === "pos"
                      ? `added up from ${rawLineCount} transaction line${rawLineCount === 1 ? "" : "s"} in ${fileName}.`
                      : `read from ${fileName}.`}
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
