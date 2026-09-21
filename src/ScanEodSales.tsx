import { useEffect, useRef, useState } from "react";
import { fetchAlreadyImportedRecipes, importSales, scanEndOfDaySales } from "./api";
import type { Recipe } from "./api";
import SearchSelect from "./SearchSelect";
import Loader from "./Loader";

interface Props {
  accessToken: string;
  location: string;
  // Already filtered to kind === "dish" by EndOfDay -- same list its own
  // CSV/Excel importer matches against, so a recipe found by either path
  // is found by both.
  dishRecipes: Recipe[];
  // Lets EndOfDay refresh its "Last imported" line after a successful
  // import here, same as its own handleImport does.
  onImported: () => void;
  onClose: () => void;
}

// One row per Textract-detected line on the printed end-of-day sales receipt,
// pre-filled with a best-guess dish match the user confirms or corrects.
// Nothing is saved until "Import".
interface ScanEodRow {
  description: string;
  matchedRecipeId: string; // "" = no confident match, user must pick one
  qty: string;
  amount: string;
  confidence: number | null; // Textract's own confidence for this row, 0-100
  skip: boolean;
}

// Lightweight fuzzy match: token overlap between a recipe's own name and
// a piece of OCR'd receipt text. A deliberate copy of App.tsx's own
// matchScore (used for Scan receipt's item matching), not a shared
// import -- same reasoning as HelpChat.tsx keeping its own topicMatches
// separate from App.tsx's: each is tuned for its own kind of text (a
// recipe name vs. an Item/Supplier name) and drifting independently is
// safer than one shared function trying to serve both. Never used to
// auto-commit anything, only to rank the best guess this review table
// pre-selects, which the user still confirms or corrects before import.
function matchScore(ours: string, raw: string): number {
  const norm = (s: string) =>
    s
      .toLowerCase()
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

// matchScore above only compares letters -- it strips every digit and
// unit, so "Pink Lychee Iced Tea (0.3L)" and "...(0.7L)" score identically
// on name alone. That's fine when there's only one size on the menu, but
// when the same drink exists in multiple sizes as separate recipes, a tied
// score used to fall back to whatever order the dish list happened to be
// in -- not the size actually printed on the receipt. This extracts a
// size in liters from either a recipe name or an OCR'd receipt line, so
// the ranking below can tell those recipes apart instead of guessing.
// Handles the parenthetical "(0.3L)" recipe-name convention, plain
// "0.7L"/"700ml", and Textract's tendency to OCR an Austrian decimal
// comma as a space -- "0, 7" -- which normalizes to "0.7" here. Returns
// null when no size-looking number is present, so unsized dishes (most
// food items) are unaffected and fall back to name-only matching.
function extractSizeLiters(raw: string): number | null {
  const s = raw.toLowerCase().replace(/(\d)\s*,\s*(\d)/g, "$1.$2");
  const matches = [...s.matchAll(/(\d+(?:\.\d+)?)\s?(ml|cl|l)?\b/g)];
  if (!matches.length) return null;
  const chosen = matches.find((m) => m[2]) ?? matches[matches.length - 1];
  const value = parseFloat(chosen[1]);
  if (Number.isNaN(value)) return null;
  if (chosen[2] === "ml") return value / 1000;
  if (chosen[2] === "cl") return value / 100;
  return value;
}

// Textract sometimes returns a price/qty with a currency symbol, thousands
// separator, or stray whitespace -- strip everything but digits and
// separators, then figure out which separator (if any) is the real
// decimal point. A copy of App.tsx's own cleanNumeric (same reasoning as
// matchScore above for not sharing it) -- handles both a UK/US "12.50"
// and an Austrian "12,50" the till might print.
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

// Textract hands back the receipt's date exactly as printed, in whatever
// format the till uses -- an Austrian till most commonly prints
// DD.MM.YYYY, so that's tried alongside ISO and DD/MM/YYYY. Falls back to
// today (a Sale needs *some* date, and the field below is always
// editable, so a wrong guess here is a one-click fix, never silently
// wrong).
function normalizeReceiptDate(raw: string | null): string {
  const today = new Date().toISOString().slice(0, 10);
  if (!raw) return today;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/);
  if (m) {
    const [, d, mo, y] = m;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return today;
}

export default function ScanEodSales({ accessToken, location, dishRecipes, onImported, onClose }: Props) {
  const [scanning, setScanning] = useState(false);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ScanEodRow[]>([]);
  const [rawCount, setRawCount] = useState(0);
  const [saleDate, setSaleDate] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    dishes: number;
    revenue: number;
    skipped: number;
    undepletedIngredients: string[];
    duplicateRecipes: string[];
  } | null>(null);

  // Recipe ids already recorded for this location on saleDate -- a row
  // matching one of these is excluded from import (see importableRows)
  // and shown as "Already imported" rather than silently disappearing,
  // so re-scanning/re-importing a day that's already been (partly)
  // imported only offers what's actually new. Re-fetched whenever the
  // date or location changes, same pattern as EodReport.tsx's own
  // fetch-on-dependency-change effects.
  const [alreadyImportedRecipeIds, setAlreadyImportedRecipeIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!location || !saleDate) {
      setAlreadyImportedRecipeIds(new Set());
      return;
    }
    let cancelled = false;
    fetchAlreadyImportedRecipes(accessToken, location, saleDate)
      .then((ids) => {
        if (!cancelled) setAlreadyImportedRecipeIds(new Set(ids));
      })
      .catch(() => {
        // Non-fatal -- worst case the "Already imported" hint doesn't
        // show and import_sales' own server-side duplicate check still
        // catches it, same safety net as always.
        if (!cancelled) setAlreadyImportedRecipeIds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, location, saleDate]);

  // Row DOM nodes, keyed by index -- used only by "Jump to next
  // unmatched" to scroll a row into view inside the modal's own internal
  // scroll (see "wide" on the modal itself). cursorRef tracks which row
  // the last jump landed on, so repeated clicks step through them in
  // order instead of always landing back on the first one.
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const jumpCursorRef = useRef(-1);

  function updateRow(i: number, patch: Partial<ScanEodRow>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function jumpToNextUnmatched() {
    const unmatchedIdx = rows.map((r, i) => (!r.skip && !r.matchedRecipeId ? i : -1)).filter((i) => i !== -1);
    if (unmatchedIdx.length === 0) return;
    const next = unmatchedIdx.find((i) => i > jumpCursorRef.current) ?? unmatchedIdx[0];
    jumpCursorRef.current = next;
    rowRefs.current[next]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function handleFile(file: File) {
    setFileName(file.name);
    setError(null);
    setScanning(true);
    try {
      const scanned = await scanEndOfDaySales(accessToken, file);
      const built: ScanEodRow[] = [];
      for (const li of scanned.line_items) {
        const description = (li.description ?? "").trim();
        if (!description) continue;
        // A remembered exact match (this same till description matched
        // by hand on some earlier scan -- see ReceiptLineAlias) always
        // wins over a fresh fuzzy guess. Still validated against this
        // org's current dish list in case the recipe was since removed
        // from the menu, so a stale alias can't point a row at a dish
        // that's no longer selectable here.
        const remembered = li.matched_recipe_id;
        let best = "";
        if (remembered && dishRecipes.some((r) => r.id === remembered)) {
          best = remembered;
        } else {
          const rawSize = extractSizeLiters(description);
          const ranked = dishRecipes
            .map((r) => {
              let score = matchScore(r.name, description);
              // A recipe whose own name carries a size that actively
              // disagrees with the receipt line's size can't be the right
              // match, even if the words tie -- disqualify it outright
              // rather than let list order settle the tie.
              const nameSize = extractSizeLiters(r.name);
              if (rawSize !== null && nameSize !== null && Math.abs(rawSize - nameSize) > 0.01) {
                score = 0;
              }
              return { id: r.id, score };
            })
            .sort((a, b) => b.score - a.score);
          best = ranked[0] && ranked[0].score >= 0.5 ? ranked[0].id : "";
        }
        built.push({
          description,
          matchedRecipeId: best,
          qty: cleanNumeric(li.quantity) || "1",
          amount: cleanNumeric(li.price) || "0.00",
          confidence: li.confidence,
          skip: false,
        });
      }
      setRawCount(scanned.line_items.length);
      setSaleDate(normalizeReceiptDate(scanned.receipt_date));
      setRows(built);
      if (built.length === 0) {
        setError("Textract didn't find any usable line items on this photo.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not scan that receipt.");
    } finally {
      setScanning(false);
    }
  }

  function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so picking the same filename again still fires onChange
    if (file) handleFile(file);
  }

  const unmatchedCount = rows.filter((r) => !r.skip && !r.matchedRecipeId).length;
  // A matched row whose recipe already has a sale recorded for this
  // location on saleDate is a duplicate of data already in the ledger --
  // excluded from what gets imported (see the "Already imported" badge
  // below), never silently re-sent. Recomputed from alreadyImportedRecipeIds
  // rather than baked into row state, so changing a row's matched dish
  // (or the date) re-evaluates it immediately.
  const alreadyImportedCount = rows.filter(
    (r) => !r.skip && r.matchedRecipeId && alreadyImportedRecipeIds.has(r.matchedRecipeId)
  ).length;
  const importableRows = rows.filter(
    (r) => !r.skip && r.matchedRecipeId && !alreadyImportedRecipeIds.has(r.matchedRecipeId)
  );

  // Every one of these guards used to just `return` -- clicking Import
  // while any of them were true looked like the button was simply broken
  // (no spinner, no message, nothing) instead of saying what was actually
  // wrong. Each one now sets importError so a click always produces
  // visible feedback.
  async function handleImport() {
    if (!location) {
      setImportError("No location selected — pick one at the top of End of day, then try importing again.");
      return;
    }
    if (!saleDate) {
      setImportError("Set a sale date above before importing.");
      return;
    }
    if (importableRows.length === 0) {
      setImportError(
        alreadyImportedCount > 0
          ? "Nothing new to import — every matched row is already recorded for this date."
          : "Nothing to import — match at least one row to a dish first, or skip rows you don't want."
      );
      return;
    }
    setImporting(true);
    setImportError(null);
    try {
      const sale = await importSales(accessToken, {
        location,
        occurred_at: saleDate,
        lines: importableRows.map((r) => ({
          recipe: r.matchedRecipeId,
          qty: Math.max(1, Math.round(Number(r.qty) || 0)),
          gross_amount: (Number(r.amount) || 0).toFixed(2),
          // Lets the backend remember "this till description means this
          // dish" (ReceiptLineAlias) so the same description auto-matches
          // on the next scan instead of asking again.
          raw_description: r.description,
        })),
      });
      setResult({
        dishes: importableRows.reduce((sum, r) => sum + (Math.round(Number(r.qty)) || 0), 0),
        revenue: importableRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0),
        skipped: rows.length - importableRows.length - alreadyImportedCount,
        undepletedIngredients: sale.skipped_depletion_items || [],
        duplicateRecipes: sale.skipped_duplicate_recipes || [],
      });
      onImported();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Could not import these sales.");
    } finally {
      setImporting(false);
    }
  }

  return (
    // Same reasoning as Scan receipt's modal (App.tsx): once a scan has
    // been read into rows, there's real reviewed/matched work an
    // accidental outside click shouldn't be able to wipe out.
    <div className="modal-backdrop" onClick={() => !scanning && !importing && rows.length === 0 && onClose()}>
      <div className="modal wide xwide" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Scan end-of-day sales</h2>

        {rows.length === 0 && !result && (
          <>
            <p className="hint" style={{ marginTop: -8, marginBottom: 16 }}>
              Upload a photo of the till's printed end-of-day summary (Tagessaldo). SAWIS reads it with AWS
              Textract and pre-fills the sales for you to check and correct — nothing is saved until you confirm
              below.
            </p>
            <div className="field" style={{ marginBottom: 12 }}>
              <label>Receipt photo</label>
              <div style={{ display: "flex", gap: 8 }}>
                <label
                  className="btn-ghost small"
                  style={{ cursor: scanning ? "default" : "pointer", opacity: scanning ? 0.6 : 1 }}
                >
                  📷 Take photo
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    disabled={scanning}
                    style={{ display: "none" }}
                    onChange={onFileChosen}
                  />
                </label>
                <label
                  className="btn-ghost small"
                  style={{ cursor: scanning ? "default" : "pointer", opacity: scanning ? 0.6 : 1 }}
                >
                  🖼 Choose photo
                  <input
                    type="file"
                    accept="image/*"
                    disabled={scanning}
                    style={{ display: "none" }}
                    onChange={onFileChosen}
                  />
                </label>
              </div>
            </div>
            {scanning && (
              <div style={{ textAlign: "center", padding: "16px 0" }}>
                <Loader size="compact" label="Reading the receipt…" />
              </div>
            )}
            {error && <p className="error">{error}</p>}
          </>
        )}

        {rows.length > 0 && !result && (
          <>
            <div className="im-note">
              ✓ Scanned {fileName}. Found{" "}
              <b>
                {rows.length} dish{rows.length === 1 ? "" : "es"}
              </b>
              {rawCount > rows.length
                ? ` (of ${rawCount} line${rawCount === 1 ? "" : "s"} Textract read; ${
                    rawCount - rows.length
                  } couldn't be read cleanly and ${rawCount - rows.length === 1 ? "was" : "were"} skipped)`
                : ""}
              .{unmatchedCount > 0 && ` ${unmatchedCount} need${unmatchedCount === 1 ? "s" : ""} a dish picked below before they can be imported. Not on the menu list yet? Skip it and add the dish properly under Recipes, then re-scan.`}
              {alreadyImportedCount > 0 &&
                ` ${alreadyImportedCount} ${
                  alreadyImportedCount === 1 ? "is" : "are"
                } already recorded for this date and won't be re-added — see the "Already imported" rows below.`}
              {unmatchedCount > 0 && (
                <button
                  type="button"
                  className="btn-ghost small"
                  style={{ marginLeft: 8, marginTop: 0 }}
                  onClick={jumpToNextUnmatched}
                >
                  ↓ Jump to next unmatched ({unmatchedCount})
                </button>
              )}
            </div>

            <div className="field" style={{ marginBottom: 12 }}>
              <label>Sale date</label>
              <input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
            </div>

            <div className="scan-rows">
              {rows.map((row, i) => {
                const alreadyImported =
                  !row.skip && !!row.matchedRecipeId && alreadyImportedRecipeIds.has(row.matchedRecipeId);
                return (
                <div
                  key={i}
                  ref={(el) => {
                    rowRefs.current[i] = el;
                  }}
                  className={`scan-row-card${
                    row.skip
                      ? ""
                      : alreadyImported
                      ? " scan-already-imported"
                      : row.matchedRecipeId
                      ? " scan-matched"
                      : " scan-unmatched"
                  }`}
                  style={row.skip ? { opacity: 0.45 } : undefined}
                >
                  <div className="scan-row-top">
                    <span className="muted">{row.description}</span>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                      {!row.skip && (
                        <span className={`badge ${alreadyImported ? "b-muted" : row.matchedRecipeId ? "b-ok" : "warn"}`}>
                          {alreadyImported ? "Already imported" : row.matchedRecipeId ? "Matched" : "No match"}
                        </span>
                      )}
                      <span className={`badge ${row.confidence !== null && row.confidence >= 80 ? "b-ok" : "warn"}`}>
                        {row.confidence !== null ? `${row.confidence.toFixed(0)}%` : "—"}
                      </span>
                      <button type="button" className="btn-ghost small" onClick={() => updateRow(i, { skip: !row.skip })}>
                        {row.skip ? "Include" : "Skip"}
                      </button>
                    </div>
                  </div>

                  <div className="field" style={{ marginTop: 6 }}>
                    <label>Matched dish</label>
                    <SearchSelect
                      value={row.matchedRecipeId}
                      onChange={(val) => updateRow(i, { matchedRecipeId: val })}
                      disabled={row.skip}
                      placeholder="Pick a dish…"
                      aria-label="Matched dish"
                      style={{ width: "100%" }}
                      options={dishRecipes.map((d) => ({ value: d.id, label: d.name }))}
                    />
                  </div>

                  <div className="scan-row-nums">
                    <div className="field">
                      <label>Qty</label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={row.qty}
                        onChange={(e) => updateRow(i, { qty: e.target.value })}
                        disabled={row.skip}
                      />
                    </div>
                    <div className="field">
                      <label>Amount</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.amount}
                        onChange={(e) => updateRow(i, { amount: e.target.value })}
                        disabled={row.skip}
                      />
                    </div>
                  </div>
                </div>
                );
              })}
            </div>

            {importError && (
              <p className="error" style={{ marginTop: 10 }}>
                {importError}
              </p>
            )}
          </>
        )}

        {result && (
          <div className="im-note">
            ✓ Imported — {result.dishes} dish{result.dishes === 1 ? "" : "es"}, £{result.revenue.toFixed(2)}{" "}
            revenue.
            {result.skipped > 0 && ` ${result.skipped} row${result.skipped === 1 ? "" : "s"} skipped.`}{" "}
            {result.duplicateRecipes.length > 0 &&
              ` ${result.duplicateRecipes.length} already had a sale recorded for this date and ${
                result.duplicateRecipes.length === 1 ? "wasn't" : "weren't"
              } re-added: ${result.duplicateRecipes.join(", ")}.`}{" "}
            {result.undepletedIngredients.length === 0
              ? "Stock has been depleted for every matched ingredient."
              : `Stock was depleted for every ingredient that has a stock holding at this location. ${
                  result.undepletedIngredients.length
                } ingredient${
                  result.undepletedIngredients.length === 1 ? " has" : "s have"
                } no holding here yet and could not be depleted: ${result.undepletedIngredients.join(", ")}.`}
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={importing}>
            {result !== null ? "Close" : "Cancel"}
          </button>
          {rows.length > 0 && result === null && (
            // Only "importing" disables this -- the location/date/
            // zero-rows cases used to disable it too, which meant a click
            // in any of those states did nothing at all (a disabled
            // button never fires onClick), with no way to tell the user
            // why. Leaving it clickable lets handleImport's own guards
            // explain what's missing instead of the button just looking
            // broken.
            <button type="button" className="btn-primary" onClick={handleImport} disabled={importing}>
              {importing ? "Importing…" : `Import ${importableRows.length} sale${importableRows.length === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
