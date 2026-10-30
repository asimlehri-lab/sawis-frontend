import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { fetchLastImportDate, formatMoney, importSales } from "./api";
import type { CatalogItem, ItemSupplierRow, Location, Me, Recipe, StockMovementRow } from "./api";
import Reorder from "./Reorder";
import EodReport from "./EodReport";
import LocationTabs from "./LocationTabs";
import { ALL_LOCATIONS, canSeeAllLocations } from "./locationScope";
import { PickLocationPrompt } from "./AllLocationsParts";
import EodTasks from "./EodTasks";
import SearchSelect from "./SearchSelect";
import { confidentGuess, rankNames } from "./dishMatch";
import ScanEodSales from "./ScanEodSales";
import { fetchSquareStatus, fmtSquareDate, fmtSquareDateTime, type SquareConnection } from "./squareApi";

interface Props {
  accessToken: string;
  me: Me;
  locations: Location[];
  recipes: Recipe[];
  items: CatalogItem[];
  itemSupplierLinks: ItemSupplierRow[];
  stockMovements: StockMovementRow[];
  // Which tab to mount on -- defaults to "overview" (the normal nav-click
  // behavior). The notification bell's "View reorder list" button passes
  // "reorder" so it lands directly there. This component only exists while
  // App.tsx's activePage === "End of day" (conditional render), so a fresh
  // read of this prop on every mount is enough -- no sync effect needed.
  initialTab?: "overview" | "reorder" | "tasks";
  // Jumps to a recipe's own detail page (Recipes tab) -- used by the Tasks
  // tab's cost-breach rows. Lives at the App.tsx level since it's a
  // cross-page navigation, not something EndOfDay owns.
  onOpenRecipe: (id: string, tab?: "history") => void;
  // Opens a PurchaseOrder's detail page (Procurement tab) -- used by the
  // Tasks tab's upcoming-deliveries rows. Same callback shape as
  // NotificationBell's own onOpenPO in App.tsx.
  onOpenPO: (id: string) => void;
  // Opens an Item's detail page (Items tab) -- used by the Tasks tab's
  // "Latest updates" news rows for new/updated items.
  onOpenItem: (id: string, tab?: "history") => void;
  onReviewAllergens: () => void;
  onItemsChanged: () => void;
  // Cross-page nav for the Tasks tab (e.g. "Inventory" for an assigned
  // count, "Waste log" for the reminder) -- same goToNav App.tsx already
  // uses for its own sidebar.
  onNavigateApp: (label: string) => void;
  // Opens a supplier's Price list on a line waiting for a price check (Actions tab).
  onOpenPriceCheck: (supplierId: string, lineId: string) => void;
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

// "2026-07-01" -> "1 Jul 2026" (used by the monthly-summary pop-up).
function fmtSummaryDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
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

export default function EndOfDay({
  accessToken,
  me,
  locations,
  recipes,
  items,
  itemSupplierLinks,
  stockMovements,
  initialTab,
  onOpenRecipe,
  onOpenPO,
  onOpenItem,
  onReviewAllergens,
  onItemsChanged,
  onNavigateApp,
  onOpenPriceCheck,
}: Props) {
  // Sales (and importing sales) is manager-only data -- the backend 403s it
  // for staff, so staff land on Actions and never see the Sales tab at all.
  const isManagerOrAbove = me.memberships.some(
    (m) => m.role === "admin" || m.role === "manager" || m.role === "finance"
  );
  const [tab, setTab] = useState<"overview" | "reorder" | "tasks">(
    isManagerOrAbove ? (initialTab ?? "overview") : "tasks"
  );
  const [location, setLocation] = useState(locations[0]?.id ?? "");
  // Square connection (managers only; the endpoint is manager-gated). Stays
  // null when Square is not connected or cannot be reached, which just keeps
  // the "manual CSV upload" wording below.
  const [square, setSquare] = useState<SquareConnection | null>(null);
  useEffect(() => {
    if (!isManagerOrAbove) return;
    let cancelled = false;
    fetchSquareStatus(accessToken)
      .then((s) => {
        if (!cancelled) setSquare(s.connection);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [accessToken, isManagerOrAbove]);
  // "all" is the All tab: every location added up. Only the Sales tab can
  // show that; importing, Actions and Reorder belong to one location.
  const isAll = location === ALL_LOCATIONS;
  const squareRow = square?.links.find((l) => l.location === location) ?? null;
  const squareLink = squareRow !== null;
  const showAllTab = isManagerOrAbove && canSeeAllLocations(me, locations);
  // locations loads asynchronously (App.tsx only fetches it once activePage
  // becomes "End of day" -- see the effect keyed on activePage there) -- if
  // this component's first render happens before that resolves, the
  // useState initializer above bakes in "" for good, since it only ever
  // runs once. With a single location the picker below doesn't even render
  // (only shown when locations.length > 1), so there's no way to fix
  // `location` by hand either -- every import (CSV or scan) just fails with
  // "No location selected" and no way to recover short of a lucky reload.
  // Confirmed live: a single-location org (Vienna) hit exactly this.
  // Fill it in as soon as locations actually arrives. Deliberately not a
  // useEffect: React's "adjust state while rendering" pattern (comparing
  // against a snapshot of the last-seen prop, right here in the render
  // body) applies the fix in the same render pass instead of one tick
  // later, and this project's lint config (react-hooks/set-state-in-effect)
  // flags setState-in-effect outright. Same fix already proven in
  // Settings.tsx's import panels for the identical race.
  const [locationsSeen, setLocationsSeen] = useState(locations);
  if (locations !== locationsSeen) {
    setLocationsSeen(locations);
    if (!location && locations[0]?.id) setLocation(locations[0].id);
  }
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  // Which format the last-parsed file was, and (for the POS export, which
  // aggregates many transaction lines into fewer review rows) how many
  // raw lines that came from — purely so the review modal can say
  // "aggregated from N lines" instead of leaving the row-count drop
  // unexplained. null/0 before anything's been parsed yet.
  const [sourceFormat, setSourceFormat] = useState<"simple" | "pos" | "excel" | null>(null);
  const [rawLineCount, setRawLineCount] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [showScanTest, setShowScanTest] = useState(false);
  // How the import review is laid out: one line per dish (match it once and
  // it applies to every day) or one line per dish per day, with a filter,
  // a search box and a menu-category filter on top of either.
  const [importView, setImportView] = useState<"dish" | "day">("dish");
  const [importFilter, setImportFilter] = useState<"all" | "needs" | "matched" | "skipped">("all");
  const [importSearch, setImportSearch] = useState("");
  const [importCategory, setImportCategory] = useState("");
  // Dishes whose match came from "Use best guesses", so they stay marked
  // "Suggested" until the person changes or confirms them.
  const [guessedKeys, setGuessedKeys] = useState<Set<string>>(new Set());
  // Set when the chosen file is the till's monthly item report
  // ("Artikelbericht"): one total per dish for the whole month, with no
  // sales per day, so there is nothing to record on a date. We tell the user
  // in a pop-up instead of showing the generic "unrecognised file" error.
  const [monthlySummary, setMonthlySummary] = useState<{
    fileName: string;
    from: string;
    to: string;
    dishes: number;
    units: number;
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    sales: number;
    dishes: number;
    revenue: number;
    skipped: number;
    // Rows left out because that recipe was already recorded for that date
    // (a re-import of days already in the ledger) -- nothing is counted twice.
    alreadyRecorded: number;
    undepletedIngredients: string[];
  } | null>(null);

  // "Last imported" + the (currently manual-only) source line under the
  // compact import control — see the last_import backend action for why
  // this reads created_at, not the date inside the file.
  const [lastImportedAt, setLastImportedAt] = useState<string | null>(null);
  const [lastImportLoading, setLastImportLoading] = useState(false);

  function refreshLastImport(loc: string) {
    if (!loc || loc === ALL_LOCATIONS) return;
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
  //
  // The actual row-walking/aggregation logic lives in aggregatePosRows
  // below, shared with the .xlsx path (Format 3) — the same columns, the
  // same aggregation, just read from a workbook sheet instead of a
  // semicolon-delimited text file. Returns null if the header doesn't
  // look like this format at all.
  function parsePosExport(text: string): ParsedRow[] | null {
    return aggregatePosRows(parseCsv(text, ";"));
  }

  // A raw table cell, from either source: a CSV cell is always a string;
  // an Excel cell SheetJS hands back can be a genuine JS number (most POS
  // exports store Menge/Gesamt as real numeric cells, not formatted
  // text) or a Date (when the workbook is read with cellDates: true, as
  // parsePosExcelTable below does). Keeping the aggregation logic
  // cell-type-aware here, rather than coercing everything to a string up
  // front, avoids a real bug: parseGermanNumber assumes a comma decimal
  // ("83,50"), and blindly stringifying a genuine number 83.5 first would
  // feed it "83.5" — read as "8350" by parseGermanNumber's dot-stripping,
  // silently 100x too large.
  type PosCell = string | number | Date | undefined;

  function cellToText(v: PosCell): string {
    if (v === undefined || v === null) return "";
    if (v instanceof Date) return v.toISOString();
    return typeof v === "number" ? String(v) : v.trim();
  }

  function cellToNumber(v: PosCell): number {
    if (typeof v === "number") return v;
    return parseGermanNumber(cellToText(v));
  }

  function cellToDateKey(v: PosCell): string {
    if (v instanceof Date) {
      return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
    }
    return normalizePosDate(cellToText(v).split(" ")[0]);
  }

  // Shared by both the CSV POS export (Format 2) and the .xlsx POS export
  // (Format 3, see parsePosExcelTable) — same expected columns
  // (Datum/Uhrzeit, optional ArtikelID, Artikelbezeichnung, Menge,
  // Gesamt), matched case-insensitively, same aggregation by (date,
  // ArtikelID-or-name). This is a first pass built from the till's known
  // CSV column layout — the .xlsx path hasn't been tried yet against a
  // real item-level Excel export from this till, only against the plain
  // Datum/Uhrzeit;ArtikelID;Artikelbezeichnung;Menge;Gesamt shape already
  // proven via CSV. If a real export turns out to use different column
  // names, this returns null (same "unrecognised format" message as any
  // other unmatched file) rather than silently importing anything wrong
  // — safe to try, worth revisiting once a real file is in hand.
  function aggregatePosRows(table: PosCell[][]): ParsedRow[] | null {
    if (table.length < 1) return null;
    const header = table[0].map((h) => cellToText(h));
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
      const date = cellToDateKey(r[dateIdx]);
      const name = cellToText(r[nameIdx]);
      if (!date || !name) continue;
      const posId = artikelIdIdx > -1 ? cellToText(r[artikelIdIdx]) : "";
      const qty = cellToNumber(r[qtyIdx]);
      const revenue = cellToNumber(r[totalIdx]);
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

  // Format 3 — the same POS export, as an .xlsx/.xls workbook instead of
  // a semicolon CSV (most POS/till software offers both from the same
  // export screen). Reads the first sheet as a plain array-of-arrays
  // (header: 1, so row 0 is the header row exactly like the CSV path) —
  // cellDates: true so a date column comes back as a real JS Date rather
  // than an Excel day-serial number, which cellToDateKey above already
  // knows how to handle directly.
  function parsePosExcelTable(file: File): Promise<PosCell[][]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const wb = XLSX.read(reader.result, { type: "array", cellDates: true });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const table = XLSX.utils.sheet_to_json<PosCell[]>(sheet, { header: 1, blankrows: false });
          resolve(table);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  // The till's monthly item report ("Artikelbericht"): first cell says so,
  // then "Kategorie;Titel;Anzahl;Betrag;SUMME" and one total per dish for
  // the whole month. Returns a short description of it, or null if the file
  // is anything else. Never imports anything.
  function describeMonthlySummary(table: PosCell[][], name: string) {
    const first = table[0]?.map((c) => cellToText(c).replace(/^\uFEFF/, "").toLowerCase()) ?? [];
    if (first[0] !== "artikelbericht") return null;
    // Blank rows are dropped by both readers, so find the header row by its text.
    const headAt = table.findIndex((r) => cellToText(r[0]).toLowerCase() === "kategorie" && cellToText(r[1]).toLowerCase() === "titel");
    if (headAt === -1) return null;
    const days: string[] = [];
    let section = "";
    let dishes = 0;
    let units = 0;
    for (const r of table.slice(headAt + 1)) {
      const a = cellToText(r[0]);
      const b = cellToText(r[1]);
      if (["ARTIKELGRUPPEN", "TAGE", "UMSATZSTEUER", "SERVICE/USER", "GESAMTSUMME"].includes(a)) {
        section = a;
        if (a === "GESAMTSUMME") units = Math.round(cellToNumber(r[2]));
        continue;
      }
      if (section === "TAGE") {
        if (b) days.push(b.replace(/\./g, "-"));
      } else if (section === "ARTIKELGRUPPEN" && a === "" && b !== "" && cellToText(r[2]) !== "") {
        dishes++;
      }
    }
    return { fileName: name, from: days[0] ?? "", to: days[days.length - 1] ?? "", dishes, units };
  }

  // Applies a parse result (or a null "didn't recognise this") the same
  // way regardless of which of the three formats/readers produced it —
  // shared by processFile's text branch (Formats 1/2) and its .xlsx
  // branch (Format 3) below so the outcome handling can't drift between
  // them.
  function applyParseResult(parsed: ParsedRow[] | null, format: "simple" | "pos" | "excel" | null) {
    if (parsed === null) {
      setParseError(
        'Unrecognised file — expected either the simple "date,dish,qty,revenue" template, or a sales export ' +
          "from your till with one line per sale (as a CSV or Excel file)."
      );
      setRows([]);
      setSourceFormat(null);
      return;
    }
    setSourceFormat(format);
    setRows(parsed);
    if (parsed.length === 0) {
      setParseError(
        format === "simple"
          ? "No valid rows found — check the date/dish/qty/revenue columns."
          : "No valid sales lines found in this POS export."
      );
    } else {
      setShowImportModal(true);
    }
  }

  function processFile(file: File) {
    setFileName(file.name);
    resetReviewControls();
    setMonthlySummary(null);
    setParseError(null);
    setImportError(null);
    setResult(null);

    const isExcel = /\.xlsx?$/i.test(file.name);
    if (isExcel) {
      parsePosExcelTable(file)
        .then((table) => {
          const summary = describeMonthlySummary(table, file.name);
          if (summary) {
            setMonthlySummary(summary);
            setRows([]);
            setSourceFormat(null);
            return;
          }
          const parsed = aggregatePosRows(table);
          applyParseResult(parsed, parsed !== null ? "excel" : null);
        })
        .catch(() => {
          setParseError("Could not read this Excel file.");
          setRows([]);
          setSourceFormat(null);
        });
      return;
    }

    readFileSmart(file)
      .then((text) => {
        const summary = describeMonthlySummary(parseCsv(text, ";"), file.name);
        if (summary) {
          setMonthlySummary(summary);
          setRows([]);
          setSourceFormat(null);
          return;
        }
        const simple = parseSimpleCsv(text);
        const parsed = simple !== null ? simple : parsePosExport(text);
        const format: "simple" | "pos" | null = simple !== null ? "simple" : parsed !== null ? "pos" : null;
        applyParseResult(parsed, format);
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

  function resetReviewControls() {
    setImportView("dish");
    setImportFilter("all");
    setImportSearch("");
    setImportCategory("");
    setGuessedKeys(new Set());
  }

  function closeImportModal() {
    resetReviewControls();
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

  const dishKey = (name: string) => name.trim().toLowerCase();
  const currency = locations.find((l) => l.id === location)?.currency;
  const money = (n: number) => formatMoney(n, currency);

  // One entry per dish name in the file, however many days it appears on.
  interface DishGroup {
    key: string;
    name: string;
    days: number;
    qty: number;
    revenue: number;
    status: "needs" | "matched" | "skipped";
    matchedId: string | null;
    mixed: boolean;
  }
  const groups: DishGroup[] = (() => {
    const map = new Map<string, { name: string; idx: number[]; dates: Set<string>; qty: number; revenue: number }>();
    rows.forEach((r, i) => {
      const key = dishKey(r.dishRaw);
      const g = map.get(key) ?? { name: r.dishRaw.trim(), idx: [], dates: new Set<string>(), qty: 0, revenue: 0 };
      g.idx.push(i);
      g.dates.add(r.date);
      g.qty += r.qty;
      g.revenue += Number(r.revenue) || 0;
      map.set(key, g);
    });
    const out: DishGroup[] = [];
    map.forEach((g, key) => {
      const active = g.idx.map((i) => rows[i]).filter((r) => !r.skip);
      const ids = new Set(active.map((r) => r.matchedRecipeId).filter(Boolean) as string[]);
      const status = active.length === 0 ? "skipped" : active.some((r) => !r.matchedRecipeId) ? "needs" : "matched";
      out.push({
        key,
        name: g.name,
        days: g.dates.size,
        qty: g.qty,
        revenue: g.revenue,
        status,
        matchedId: ids.size ? Array.from(ids)[0] : null,
        mixed: ids.size > 1,
      });
    });
    const order = { needs: 0, matched: 1, skipped: 2 };
    return out.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
  })();
  const recipeById = (id: string | null) => (id ? dishRecipes.find((d) => d.id === id) : undefined);
  const importCategories = Array.from(
    new Set(dishRecipes.map((d) => (d.menu_category || "").trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));
  const searchQ = importSearch.trim().toLowerCase();
  function passesReview(raw: string, status: "needs" | "matched" | "skipped", matchedId: string | null): boolean {
    if (importFilter !== "all" && importFilter !== status) return false;
    const rec = recipeById(matchedId);
    if (searchQ && !raw.toLowerCase().includes(searchQ) && !(rec && rec.name.toLowerCase().includes(searchQ))) return false;
    if (importCategory && (!rec || (rec.menu_category || "").trim() !== importCategory)) return false;
    return true;
  }
  const visibleGroups = groups.filter((g) => passesReview(g.name, g.status, g.matchedId));
  const rowStatus = (r: ParsedRow): "needs" | "matched" | "skipped" =>
    r.skip ? "skipped" : r.matchedRecipeId ? "matched" : "needs";
  const visibleRowIdx = rows
    .map((_, i) => i)
    .filter((i) => passesReview(rows[i].dishRaw, rowStatus(rows[i]), rows[i].matchedRecipeId));
  const groupCounts = {
    all: groups.length,
    needs: groups.filter((g) => g.status === "needs").length,
    matched: groups.filter((g) => g.status === "matched").length,
    skipped: groups.filter((g) => g.status === "skipped").length,
  };
  const dayCount = new Set(rows.map((r) => r.date)).size;
  const guessable = groups.filter((g) => g.status === "needs" && confidentGuess(g.name, dishRecipes)).length;

  function setGroupMatch(key: string, recipeId: string | null, guessed = false) {
    setRows((rs) => rs.map((r) => (dishKey(r.dishRaw) === key ? { ...r, matchedRecipeId: recipeId } : r)));
    setGuessedKeys((prev) => {
      const next = new Set(prev);
      if (guessed) next.add(key);
      else next.delete(key);
      return next;
    });
  }
  function setGroupSkip(key: string, skip: boolean) {
    setRows((rs) => rs.map((r) => (dishKey(r.dishRaw) === key ? { ...r, skip } : r)));
  }
  // Fills in every dish that has one clear best match. Nothing is imported
  // by this; the dishes stay marked "Suggested" so they can be checked.
  function useBestGuesses() {
    const picks = new Map<string, string>();
    for (const g of groups) {
      if (g.status !== "needs") continue;
      const c = confidentGuess(g.name, dishRecipes);
      if (c) picks.set(g.key, c.id);
    }
    setRows((rs) =>
      rs.map((r) => {
        const id = picks.get(dishKey(r.dishRaw));
        return id && !r.skip && !r.matchedRecipeId ? { ...r, matchedRecipeId: id } : r;
      })
    );
    setGuessedKeys((prev) => new Set([...prev, ...picks.keys()]));
  }

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
      let alreadyRecorded = 0;
      for (const [date, dateRows] of byDate) {
        // "covers" is a per-day figure, not per-dish — the CSV can only
        // really carry one constant value per date, so the first row
        // that has one wins for the whole day.
        const covers = dateRows.find((r) => r.covers !== null)?.covers ?? undefined;
        let sale;
        try {
          sale = await importSales(accessToken, {
            location,
            occurred_at: date,
            covers,
            lines: dateRows.map((r) => ({
              recipe: r.matchedRecipeId as string,
              qty: r.qty,
              gross_amount: r.revenue,
            })),
          });
        } catch (e) {
          // A day whose every recipe is already recorded is refused by the
          // server so nothing is counted twice. That is not a failure when
          // re-importing a whole month: note it and carry on with the next day.
          if (e instanceof Error && /already recorded for this date/i.test(e.message)) {
            alreadyRecorded += dateRows.length;
            continue;
          }
          throw e;
        }
        salesCreated++;
        for (const name of sale.skipped_depletion_items || []) undepleted.add(name);
        // Count only the recipes the server actually added; the rest were
        // already recorded for this date and were skipped.
        const addedRecipeIds = new Set((sale.lines || []).map((l) => l.recipe));
        for (const r of dateRows) {
          if (addedRecipeIds.has(r.matchedRecipeId as string)) {
            dishesTotal += r.qty;
            revenueTotal += Number(r.revenue) || 0;
          } else {
            alreadyRecorded++;
          }
        }
      }
      setResult({
        sales: salesCreated,
        dishes: dishesTotal,
        revenue: revenueTotal,
        skipped: rows.length - importableRows.length,
        alreadyRecorded,
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
      {isManagerOrAbove && <LocationTabs locations={locations} value={location} onChange={setLocation} allowAll={showAllTab} />}
      {isManagerOrAbove && isAll && (
        <p className="lnote">Importing and scanning sales work one location at a time. Pick a location to use them.</p>
      )}
      {isManagerOrAbove && !isAll && (
      <div className="eod-head">
        <div className="eod-import">
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
                  Three file shapes accepted — detected automatically from the header row.
                  <br />
                  <br />
                  <b>Simple CSV</b> — header <code>date,dish,qty,revenue</code>, e.g. "2026-08-15,
                  Cheeseburger,12,144.00". Dates as YYYY-MM-DD. "dish" must match a recipe name (not case-sensitive)
                  — anything that doesn't match can be matched by hand after upload. An optional{" "}
                  <code>covers</code> column (diners served that day) feeds the Overview tab's per-cover numbers —
                  same value on every row for that date.
                  <br />
                  <br />
                  <b>Raw POS export</b> — the till's own sales report with one line per sale, as a CSV or as an Excel
                  file (it needs the date and time, the item name, the quantity and the total, and usually has an item
                  ID too). Its many rows per sale
                  are added up automatically into one line per dish per day. Matches by the recipe's POS ID first,
                  then by name.
                  <br />
                  <br />
                  A monthly item report (one total per dish for the whole month) has no sales per day, so it cannot be
                  imported.
                </span>
              </span>
            </div>
            <input
              type="file"
              accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={handleFileInput}
              disabled={!locations.length}
              aria-label="Import sales file"
            />
          </div>

          {parseError && (
            <p className="error" style={{ fontSize: 11.5, marginTop: 6, marginBottom: 0, textAlign: "right" }}>
              {parseError}
            </p>
          )}

          <button type="button" className="btn-ghost eod-scan-btn" onClick={() => setShowScanTest(true)}>
            📷 Scan end-of-day sales
          </button>

          <div className="eod-import-meta">
            {!locations.length
              ? "No locations yet"
              : lastImportLoading
              ? "Checking last import…"
              : squareLink
              ? lastImportedAt
                ? `Last CSV import ${fmtImportedAt(lastImportedAt)}`
                : ""
              : lastImportedAt
              ? `Last imported ${fmtImportedAt(lastImportedAt)}`
              : "No sales imported yet"}
            {squareLink ? (
              <span className={`eod-source ${square?.status === "needs_reconnect" ? "warn" : ""}`}>
                {square?.status === "needs_reconnect"
                  ? "Square needs reconnecting (Settings → Integrations)"
                  : `Source: Square · last synced ${fmtSquareDateTime(square?.last_synced_at ?? null)} · ${squareRow?.last_day_pulled ? `sales pulled up to ${fmtSquareDate(squareRow.last_day_pulled)}` : "no days pulled yet"}`}
                {square && square.status === "active" && square.unmatched_count > 0
                  ? ` · ${square.unmatched_count} ${square.unmatched_count === 1 ? "line needs" : "lines need"} matching (Settings → Integrations)`
                  : ""}
                {" · a CSV upload still works"}
              </span>
            ) : (
              <span className="eod-source">Source: manual CSV upload</span>
            )}
          </div>
        </div>
      </div>
      )}

      {showScanTest && !isAll && (
        <ScanEodSales
          accessToken={accessToken}
          location={location}
          dishRecipes={dishRecipes}
          currency={locations.find((l) => l.id === location)?.currency}
          onImported={() => refreshLastImport(location)}
          onClose={() => setShowScanTest(false)}
        />
      )}

      <div className="rtabs" style={{ marginBottom: 16 }}>
        {isManagerOrAbove && (
          <button className={`rtab ${tab === "overview" ? "on" : ""}`} onClick={() => setTab("overview")}>
            Sales
          </button>
        )}
        <button className={`rtab ${tab === "tasks" ? "on" : ""}`} onClick={() => setTab("tasks")}>
          Actions
        </button>
        {isManagerOrAbove && (
          <button className={`rtab ${tab === "reorder" ? "on" : ""}`} onClick={() => setTab("reorder")}>
            Reorder
          </button>
        )}
      </div>

      {tab === "overview" && isManagerOrAbove && <EodReport
          accessToken={accessToken}
          locations={locations}
          location={location}
          isAdmin={me.memberships.some((m) => m.role === "admin")}
        />}

      {tab === "tasks" && isAll && (
        <PickLocationPrompt
          title="Actions work one location at a time"
          text="Counts, checks and stock belong to a location."
          locations={locations}
          onPick={setLocation}
        />
      )}

      {tab === "tasks" && !isAll && (
        <EodTasks
          me={me}
          accessToken={accessToken}
          location={location}
          locations={locations}
          recipes={recipes}
          items={items}
          stockMovements={stockMovements}
          onOpenRecipe={onOpenRecipe}
          onOpenPO={onOpenPO}
          onOpenItem={onOpenItem}
          onReviewAllergens={onReviewAllergens}
          onItemsChanged={onItemsChanged}
          onViewReorder={() => setTab("reorder")}
          onNavigateApp={onNavigateApp}
          onOpenPriceCheck={onOpenPriceCheck}
        />
      )}

      {tab === "reorder" && isManagerOrAbove && isAll && (
        <PickLocationPrompt
          title="Reorder works one location at a time"
          text="Stock levels and orders belong to a location."
          locations={locations}
          onPick={setLocation}
        />
      )}

      {tab === "reorder" && isManagerOrAbove && !isAll && (
        <Reorder
          key={location}
          accessToken={accessToken}
          items={items}
          locations={locations}
          location={location}
          itemSupplierLinks={itemSupplierLinks}
        />
      )}

      {monthlySummary && (
        <div className="modal-backdrop" onClick={() => setMonthlySummary(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>This file is a monthly summary</h2>
            <p>
              <b>{monthlySummary.fileName}</b> only has the total sold for each dish over the whole month
              {monthlySummary.from && monthlySummary.to
                ? ` (${fmtSummaryDate(monthlySummary.from)} to ${fmtSummaryDate(monthlySummary.to)})`
                : ""}
              {monthlySummary.dishes > 0 ? `: ${monthlySummary.dishes} items` : ""}
              {monthlySummary.units > 0 ? `, ${monthlySummary.units.toLocaleString("en-GB")} sold` : ""}.
            </p>
            <p>
              There are no sales recorded per day in it, so SAWIS cannot add them to End of day, and nothing has been
              imported.
            </p>
            <p>
              To import sales, use a sales export from your till with one line per sale, showing the date, the dish
              name, the quantity and the amount. Or use the simple template, with one row per dish per day:{" "}
              <code>date,dish,qty,revenue</code>.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn-primary" onClick={() => setMonthlySummary(null)}>
                OK
              </button>
            </div>
          </div>
        </div>
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
                      {groups.length} dish{groups.length === 1 ? "" : "es"}
                    </b>{" "}
                    on {dayCount} day{dayCount === 1 ? "" : "s"} ({rows.length} lines){" "}
                    {sourceFormat === "pos" || sourceFormat === "excel"
                      ? `added up from ${rawLineCount} transaction line${rawLineCount === 1 ? "" : "s"} in ${fileName}.`
                      : `read from ${fileName}.`}
                    {groupCounts.needs > 0 &&
                      ` ${groupCounts.needs} dish${groupCounts.needs === 1 ? " needs" : "es need"} matching before ${groupCounts.needs === 1 ? "it" : "they"} can be imported. Match a dish once and it applies to every day.`}
                  </div>
                )}
                <div className="eod-rv-bar">
                  <input
                    type="search"
                    className="eod-rv-search"
                    placeholder="Find a dish…"
                    value={importSearch}
                    onChange={(e) => setImportSearch(e.target.value)}
                    aria-label="Find a dish"
                  />
                  {importCategories.length > 0 && (
                    <select
                      className="eod-rv-cat"
                      value={importCategory}
                      onChange={(e) => setImportCategory(e.target.value)}
                      aria-label="Menu category"
                    >
                      <option value="">All categories</option>
                      {importCategories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  )}
                  <div className="eod-rv-view" role="group" aria-label="Layout">
                    <button type="button" className={`chip ${importView === "dish" ? "active" : ""}`} onClick={() => setImportView("dish")}>
                      By dish
                    </button>
                    <button type="button" className={`chip ${importView === "day" ? "active" : ""}`} onClick={() => setImportView("day")}>
                      By day
                    </button>
                  </div>
                </div>

                <div className="chip-row">
                  {(
                    [
                      { key: "all", label: `All (${groupCounts.all})` },
                      { key: "needs", label: `Needs matching (${groupCounts.needs})` },
                      { key: "matched", label: `Matched (${groupCounts.matched})` },
                      { key: "skipped", label: `Skipped (${groupCounts.skipped})` },
                    ] as { key: "all" | "needs" | "matched" | "skipped"; label: string }[]
                  ).map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      className={`chip ${importFilter === f.key ? "active" : ""}`}
                      onClick={() => setImportFilter(f.key)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {guessable > 0 && (
                  <div className="eod-rv-guess">
                    <span>
                      {guessable} unmatched dish{guessable === 1 ? " has" : "es have"} one clear best match (same name, same size).
                    </span>
                    <button type="button" className="btn-ghost small" onClick={useBestGuesses}>
                      Use best guesses ({guessable})
                    </button>
                  </div>
                )}

                {importView === "dish" ? (
                  <div className="table-scroll">
                    <table className="tbl" style={{ marginTop: 4 }}>
                      <thead>
                        <tr>
                          <th>Dish (from file)</th>
                          <th className="num">Qty</th>
                          <th className="num">Revenue</th>
                          <th>Matched recipe</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleGroups.map((g) => {
                          const guesses = g.status === "needs" ? rankNames(g.name, dishRecipes, 3, 0.45) : [];
                          return (
                            <tr key={g.key} style={g.status === "skipped" ? { opacity: 0.45 } : undefined}>
                              <td>
                                {g.name}
                                <div className="muted" style={{ fontSize: 11.5 }}>
                                  {g.days} day{g.days === 1 ? "" : "s"}
                                </div>
                              </td>
                              <td className="num">{g.qty}</td>
                              <td className="num">{money(g.revenue)}</td>
                              <td>
                                {g.status === "matched" ? (
                                  <div className="eod-rv-matched">
                                    <span className="badge b-ok">
                                      {g.mixed ? "Several recipes" : recipeById(g.matchedId)?.name}
                                    </span>
                                    {guessedKeys.has(g.key) && <span className="badge warn">Suggested</span>}
                                    <button type="button" className="btn-ghost small" onClick={() => setGroupMatch(g.key, null)}>
                                      Change
                                    </button>
                                  </div>
                                ) : g.status === "needs" ? (
                                  <>
                                    <SearchSelect
                                      value=""
                                      onChange={(val) => val && setGroupMatch(g.key, val)}
                                      placeholder="Pick a recipe…"
                                      aria-label="Matched recipe"
                                      options={dishRecipes.map((d) => ({ value: d.id, label: d.name }))}
                                    />
                                    {guesses.length > 0 && (
                                      <div className="sq-sugg">
                                        <span>Did you mean</span>
                                        {guesses.map((s) => (
                                          <button key={s.id} type="button" className="sq-chip" onClick={() => setGroupMatch(g.key, s.id)}>
                                            {s.name}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <span className="muted">Skipped</span>
                                )}
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="btn-ghost small"
                                  onClick={() => setGroupSkip(g.key, g.status !== "skipped")}
                                >
                                  {g.status === "skipped" ? "Include" : "Skip"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {visibleGroups.length === 0 && <p className="muted">No dishes match these filters.</p>}
                  </div>
                ) : (
                  <div className="table-scroll">
                    <table className="tbl" style={{ marginTop: 4 }}>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Dish (from file)</th>
                          <th>Matched recipe</th>
                          <th className="num">Qty</th>
                          <th className="num">Revenue</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRowIdx.map((i) => {
                          const r = rows[i];
                          return (
                            <tr key={i} style={r.skip ? { opacity: 0.45 } : undefined}>
                              <td className="muted">{r.date}</td>
                              <td>{r.dishRaw}</td>
                              <td>
                                {r.matchedRecipeId ? (
                                  <span className="badge b-ok">{recipeById(r.matchedRecipeId)?.name}</span>
                                ) : (
                                  <SearchSelect
                                    value=""
                                    onChange={(val) => updateRow(i, { matchedRecipeId: val || null })}
                                    disabled={r.skip}
                                    placeholder="Pick a recipe…"
                                    aria-label="Matched recipe"
                                    options={dishRecipes.map((d) => ({ value: d.id, label: d.name }))}
                                  />
                                )}
                              </td>
                              <td className="num">{r.qty}</td>
                              <td className="num">{money(Number(r.revenue) || 0)}</td>
                              <td>
                                <button type="button" className="btn-ghost small" onClick={() => updateRow(i, { skip: !r.skip })}>
                                  {r.skip ? "Include" : "Skip"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {visibleRowIdx.length === 0 && <p className="muted">No lines match these filters.</p>}
                  </div>
                )}
              </>
            )}

            {result && (
              <div className="im-note">
                ✓ <b>
                  {result.sales} sale{result.sales === 1 ? "" : "s"}
                </b>{" "}
                imported — {result.dishes} dishes, {money(result.revenue)} revenue.
                {result.skipped > 0 && ` ${result.skipped} row${result.skipped === 1 ? "" : "s"} skipped.`}
                {result.alreadyRecorded > 0 &&
                  ` ${result.alreadyRecorded} row${result.alreadyRecorded === 1 ? " was" : "s were"} already recorded for that date and left as they were.`}{" "}
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
