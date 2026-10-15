import { Fragment, useEffect, useRef, useState } from "react";
import Loader from "./Loader";
import FilterBar from "./FilterBar";
import type { FilterFacet, FilterValues } from "./FilterBar";
import {
  createCountAssignment,
  createCountLine,
  createHoldingSection,
  createSection,
  createStockCount,
  createStockMovement,
  deleteHoldingSection,
  deleteSection,
  fetchOnHand,
  fetchPurchaseOrders,
  formatMoney,
  markSectionCounted,
  scanCountSheet,
  updateCountAssignment,
  updateHoldingSection,
  updateSection,
  updateStockCount,
} from "./api";
import type {
  CatalogItem,
  ItemSupplierRow,
  Location,
  Me,
  Membership,
  ScannedCountRow,
  Section,
  StockCountRow,
  ItemStockUnit,
  PurchaseOrder,
  StockMovementRow,
} from "./api";

interface Props {
  accessToken: string;
  me: Me;
  items: CatalogItem[];
  locations: Location[];
  sections: Section[];
  sectionsError: string | null;
  stockCounts: StockCountRow[] | null;
  stockCountsError: string | null;
  itemSupplierLinks: ItemSupplierRow[];
  stockMovements: StockMovementRow[];
  memberships: Membership[];
  onSectionsChanged: () => void;
  onStockCountsChanged: () => void;
  onItemsChanged: () => void;
  onOpenItem?: (itemId: string) => void;
}

const DEPARTMENTS: { value: "kitchen" | "bar" | "foh"; label: string }[] = [
  { value: "kitchen", label: "Kitchen" },
  { value: "bar", label: "Bar" },
  { value: "foh", label: "Front of house" },
];

const REASONS = [
  { value: "spoilage", label: "Spoilage" },
  { value: "breakage", label: "Breakage / spill" },
  { value: "over_portioning", label: "Over-portioning" },
  { value: "miscount", label: "Miscount" },
  { value: "theft", label: "Theft suspected" },
  { value: "short_delivery", label: "Delivery short" },
  { value: "used_in_special", label: "Used in special" },
  { value: "other", label: "Other" },
];

function deptLabel(v: string): string {
  return DEPARTMENTS.find((d) => d.value === v)?.label ?? v;
}

function reasonLabel(v: string): string {
  return REASONS.find((r) => r.value === v)?.label ?? v;
}

// Purely cosmetic — no backend field for this, just a friendly guess from
// the section's name so Manage Sections/Count Sheets don't read as a bare
// list of grey boxes. Falls back to a neutral "store" icon.
// "2026-10-08" -> "8 Oct", for Section.next_count_due badges/summaries.
// The literal "T00:00:00" keeps this a local-midnight Date rather than a
// UTC one, so the displayed day never shifts by one depending on the
// viewer's timezone offset from UTC.
function formatDueDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function sectionIcon(name: string): { emoji: string; cls: string } {
  const n = name.toLowerCase();
  if (n.includes("freez")) return { emoji: "❄", cls: "ic-freeze" };
  if (n.includes("fridge") || n.includes("chill") || n.includes("cold")) return { emoji: "🧊", cls: "ic-fridge" };
  if (n.includes("bar") || n.includes("wine") || n.includes("cellar")) return { emoji: "🍷", cls: "ic-bar" };
  return { emoji: "📦", cls: "ic-dry" };
}

function staffLabel(m: Membership): string {
  const name = m.name || m.email;
  return m.job_title ? `${name} — ${m.job_title}` : name;
}

// Duplicated from App.tsx/ItemDetail.tsx (established convention in this
// codebase for small local helpers) -- fuzzy-matches an OCR'd item_text
// from a scanned count sheet against our own item names, same 0.5
// confidence threshold used everywhere else this pattern appears.
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

// Duplicated from App.tsx -- turns a handwritten-then-OCR'd quantity like
// "3,5" or "12" into a clean numeric string, same European/UK decimal
// disambiguation logic used for scanned receipts.
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

// One place an item is kept: a section, the stock unit that section counts it
// in, and an optional maximum (base unit) that only warns on a count sheet.
interface FlatPlacement {
  id: string;
  section: string;
  sectionName: string;
  stockUnitId: string;
  stockUnit: string;
  stockUnitQty: number | null;
  maxQty: number | null;
}

// An item at this location and department. `placements` lists every section it
// sits in. The section fields below are only filled in by holdingsInSection(),
// which gives the view of the item from inside one section (that section's
// unit and maximum); on Live stock they stay empty and stockUnit is only set
// when every section counts the item in the same unit.
interface FlatHolding {
  id: string;
  itemId: string;
  itemName: string;
  baseUnit: string;
  placements: FlatPlacement[];
  placementId: string;
  maxQty: number | null;
  // The stock unit this section counts this item in (chosen in Manage sections),
  // e.g. bag = 1000 g. Counts can be typed in either unit but are saved in baseUnit.
  stockUnitId: string;
  stockUnit: string;
  stockUnitQty: number | null;
  // Every stock unit the item has (for the Manage sections picker).
  itemStockUnits: ItemStockUnit[];
  department: "kitchen" | "bar" | "foh";
  section: string | null;
  sectionName: string | null;
  parLevel: number;
  category: string | null;
  categoryName: string | null;
}

// The items kept in one section, each seen from inside that section.
function holdingsInSection(holdings: FlatHolding[], sectionId: string): FlatHolding[] {
  return holdings.flatMap((h) => {
    const p = h.placements.find((x) => x.section === sectionId);
    if (!p) return [];
    return [
      {
        ...h,
        section: sectionId,
        sectionName: p.sectionName,
        placementId: p.id,
        maxQty: p.maxQty,
        stockUnitId: p.stockUnitId,
        stockUnit: p.stockUnit,
        stockUnitQty: p.stockUnitQty,
      },
    ];
  });
}

// One unit a count can be typed in: the base unit, or one of the item's stock
// units (bag = 1000 g). `factor` is how many base units make one of it.
interface CountUnit {
  key: string;
  name: string;
  factor: number;
}

// The unit this section counts the item in (the first box), else the base unit.
function primaryUnit(h: FlatHolding): CountUnit {
  return h.stockUnit && h.stockUnitQty
    ? { key: h.stockUnitId || "section", name: h.stockUnit, factor: h.stockUnitQty }
    : { key: "base", name: h.baseUnit, factor: 1 };
}

// Every other unit a counter can add with the + button (base unit first).
function otherUnits(h: FlatHolding): CountUnit[] {
  const p = primaryUnit(h);
  const all: CountUnit[] = [
    { key: "base", name: h.baseUnit, factor: 1 },
    ...h.itemStockUnits.filter((u) => Number(u.qty) > 0).map((u) => ({ key: u.id, name: u.name, factor: Number(u.qty) })),
  ];
  return all.filter((u) => u.key !== p.key && !(u.name === p.name && u.factor === p.factor));
}

function unitFactor(h: FlatHolding, key: string): number {
  if (key === "base") return 1;
  const u = h.itemStockUnits.find((x) => x.id === key);
  return u && Number(u.qty) > 0 ? Number(u.qty) : 1;
}

const fmtCount = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 3 });

// "2.5 bag (2,500 g)" in the unit a section counts in, or plain "2,500 g" when there is none.
function sectionQty(h: FlatHolding, baseQty: number): string {
  const base = `${parseFloat(baseQty.toFixed(2))} ${h.baseUnit}`;
  return h.stockUnit && h.stockUnitQty ? `${inStockUnit(h, baseQty)} (${base})` : base;
}

// "2.5 bag" for a base-unit quantity, or "" when the item has no stock unit.
function inStockUnit(h: FlatHolding, baseQty: number): string {
  if (!h.stockUnit || !h.stockUnitQty) return "";
  return `${parseFloat((baseQty / h.stockUnitQty).toFixed(2))} ${h.stockUnit}`;
}

export default function Inventory({
  accessToken,
  me,
  items,
  locations,
  sections,
  sectionsError,
  stockCounts,
  stockCountsError,
  itemSupplierLinks,
  stockMovements,
  memberships,
  onSectionsChanged,
  onStockCountsChanged,
  onItemsChanged,
  onOpenItem,
}: Props) {
  const [tab, setTab] = useState<"live" | "count" | "sections">("live");
  const [activeLocation, setActiveLocation] = useState(locations[0]?.id ?? "");
  const [onHand, setOnHand] = useState<Record<string, number>>({});
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!activeLocation && locations.length) setActiveLocation(locations[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations]);

  const activeItems = items.filter((i) => !i.archived);
  const holdingsAtLocation: FlatHolding[] = activeItems.flatMap((it) =>
    it.holdings
      .filter((h) => h.location === activeLocation)
      .map((h) => {
        const placements: FlatPlacement[] = h.placements.map((p) => ({
          id: p.id,
          section: p.section,
          sectionName: p.section_name,
          stockUnitId: p.stock_unit ?? "",
          stockUnit: p.stock_unit_name ?? "",
          stockUnitQty: p.stock_unit && p.stock_unit_qty ? Number(p.stock_unit_qty) : null,
          maxQty: p.max_qty !== null ? Number(p.max_qty) : null,
        }));
        // A single stock-unit hint for the whole item, only when every section counts it in the same unit.
        const unitIds = new Set(placements.map((p) => p.stockUnitId));
        const shared = placements.length > 0 && unitIds.size === 1 ? placements[0] : null;
        return {
          id: h.id,
          itemId: it.id,
          itemName: it.name,
          baseUnit: it.base_unit,
          placements,
          placementId: "",
          maxQty: null,
          stockUnitId: shared?.stockUnitId ?? "",
          stockUnit: shared?.stockUnit ?? "",
          stockUnitQty: shared?.stockUnitQty ?? null,
          itemStockUnits: it.stock_units,
          department: h.department as "kitchen" | "bar" | "foh",
          section: null,
          sectionName: null,
          parLevel: Number(h.par_level),
          category: it.category,
          categoryName: it.category_name,
        };
      })
  );

  useEffect(() => {
    if (!activeLocation || holdingsAtLocation.length === 0) return;
    let cancelled = false;
    Promise.all(
      holdingsAtLocation.map((h) =>
        fetchOnHand(accessToken, h.itemId, activeLocation, h.department).then((qty) => [h.id, qty] as const)
      )
    ).then((pairs) => {
      if (cancelled) return;
      setOnHand(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, activeLocation, items.length, refreshTick]);

  function cheapestPrice(itemId: string): number | null {
    const prices = itemSupplierLinks.filter((l) => l.item === itemId).map((l) => Number(l.unit_price));
    if (!prices.length) return null;
    return Math.min(...prices);
  }

  const sectionsHere = sections.filter((s) => s.location === activeLocation);
  const staffHere = memberships.filter((m) => m.location === activeLocation || m.location === null);
  // Managing sections (create/rename/delete, which items live in each) is a
  // manager job; staff just count. The backend enforces the same split.
  const canManage = me.memberships.some((m) => m.role === "admin" || m.role === "manager" || m.role === "finance");

  function refreshOnHand() {
    setRefreshTick((t) => t + 1);
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div className="rtabs">
          {(canManage ? (["live", "count", "sections"] as const) : (["live", "count"] as const)).map((t) => (
            <button key={t} className={`rtab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
              {t === "live" ? "Live stock" : t === "count" ? "Count sheets" : "Manage sections"}
            </button>
          ))}
        </div>
        {locations.length > 0 && (
          <select
            value={activeLocation}
            onChange={(e) => setActiveLocation(e.target.value)}
            style={{
              fontFamily: "inherit",
              fontSize: 13,
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "8px 10px",
              background: "var(--surface)",
              color: "var(--ink)",
            }}
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {!locations.length && <p className="muted">No locations yet — add one before using Inventory.</p>}

      {locations.length > 0 && tab === "live" && (
        <LiveStockTab
          accessToken={accessToken}
          holdings={holdingsAtLocation}
          onHand={onHand}
          cheapestPrice={cheapestPrice}
          stockCounts={stockCounts ?? []}
          activeLocation={activeLocation}
          locationName={locations.find((l) => l.id === activeLocation)?.name ?? ""}
          currency={locations.find((l) => l.id === activeLocation)?.currency}
          stockMovements={stockMovements}
        />
      )}

      {locations.length > 0 && tab === "sections" && canManage && (
        <SectionsTab
          accessToken={accessToken}
          activeLocation={activeLocation}
          sections={sectionsHere}
          sectionsError={sectionsError}
          holdings={holdingsAtLocation}
          onSectionsChanged={onSectionsChanged}
          onOpenItem={onOpenItem}
          onItemsChanged={() => {
            onItemsChanged();
            refreshOnHand();
          }}
        />
      )}

      {locations.length > 0 && tab === "count" && (
        <CountSheetsTab
          accessToken={accessToken}
          me={me}
          staff={staffHere}
          activeLocation={activeLocation}
          locationName={locations.find((l) => l.id === activeLocation)?.name ?? ""}
          sections={sectionsHere}
          holdings={holdingsAtLocation}
          onHand={onHand}
          cheapestPrice={cheapestPrice}
          stockCounts={stockCounts}
          stockCountsError={stockCountsError}
          onSectionsChanged={onSectionsChanged}
          onStockCountsChanged={() => {
            onStockCountsChanged();
            refreshOnHand();
          }}
        />
      )}

    </>
  );
}

// ---------------------------------------------------------------------------
// Live stock
// ---------------------------------------------------------------------------

// One item's stock movement over a day, a week or a month: opening on hand,
// one line per kind of movement (all sales as a single line, waste on its
// own line, and so on), closing on hand, then a day-by-day table. Worked out
// from the ledger rows already loaded, so nothing extra is fetched.
//
// A stock count that finds less than expected and is tagged with a real-loss
// reason (spoilage, breakage, theft, over-portioning) is already treated as
// waste by the Waste log and reports (the backend logs a waste event for it),
// so it is shown under Waste here too, with a note that it came from a count.
// The reasons mirror COUNT_REASONS_THAT_ARE_WASTE in apps/ledger/viewsets.py.
const COUNT_WASTE_REASONS = new Set(["spoilage", "breakage", "theft", "over_portioning"]);

type MovementKind = "purchase" | "sale" | "waste" | "count_adjust" | "other";
const KIND_LINES: { kind: MovementKind; label: string }[] = [
  { kind: "purchase", label: "Purchases received" },
  { kind: "sale", label: "Sales" },
  { kind: "waste", label: "Waste" },
  { kind: "count_adjust", label: "Count adjustments" },
  { kind: "other", label: "Other (reopened orders, transfers)" },
];

function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function shiftDay(day: string, by: number): string {
  const d = parseDay(day);
  d.setDate(d.getDate() + by);
  return localDay(d);
}

// What a purchase order line recorded about the delivery, as invoiced.
interface ReceiptInfo {
  supplierName: string;
  poNumber: string;
  supplierUnit: string;
  supplierQty: number | null;
}

function ItemMovementReview({
  holding: h,
  movements,
  countReasonByLine,
  receipts,
  onHandNow,
  currency,
}: {
  holding: FlatHolding;
  movements: StockMovementRow[];
  countReasonByLine: Record<string, string | null>;
  receipts: Record<string, ReceiptInfo>;
  onHandNow: number | undefined;
  currency?: string;
}) {
  const today = localDay(new Date());
  const [mode, setMode] = useState<"day" | "week" | "month">("week");
  const [anchor, setAnchor] = useState(today);

  // Week = the 7 days ending on the chosen date, same as the reports; month =
  // the calendar month containing it.
  const a = parseDay(anchor);
  const from =
    mode === "day" ? anchor : mode === "week" ? shiftDay(anchor, -6) : localDay(new Date(a.getFullYear(), a.getMonth(), 1));
  const to = mode === "month" ? localDay(new Date(a.getFullYear(), a.getMonth() + 1, 0)) : anchor;
  const fmtShort = (d: string, year = false) =>
    parseDay(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) });
  const periodLabel =
    mode === "day"
      ? parseDay(anchor).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
      : mode === "week"
        ? `${fmtShort(from)} – ${fmtShort(to, true)}`
        : a.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const isLatest = mode === "month" ? anchor.slice(0, 7) >= today.slice(0, 7) : to >= today;

  function step(dir: 1 | -1) {
    if (mode === "month") {
      const first = new Date(a.getFullYear(), a.getMonth() + dir, 1);
      const next = localDay(first);
      setAnchor(next.slice(0, 7) >= today.slice(0, 7) ? today : next);
    } else {
      const next = shiftDay(anchor, dir * (mode === "week" ? 7 : 1));
      setAnchor(next > today ? today : next);
    }
  }

  const dayOf = (m: StockMovementRow) => localDay(new Date(m.occurred_at));
  const kindOf = (m: StockMovementRow): { kind: MovementKind; fromCount: boolean; reason: string | null } => {
    const t = m.movement_type as string;
    if (t === "purchase" || t === "sale" || t === "waste") return { kind: t, fromCount: false, reason: null };
    if (t === "count_adjust") {
      const reason = m.source_type === "count_line" ? countReasonByLine[m.source_id] ?? null : null;
      if (Number(m.qty_delta) < 0 && reason && COUNT_WASTE_REASONS.has(reason)) return { kind: "waste", fromCount: true, reason };
      return { kind: "count_adjust", fromCount: true, reason };
    }
    return { kind: "other", fromCount: false, reason: null };
  };

  const opening = movements.filter((m) => dayOf(m) < from).reduce((sum, m) => sum + Number(m.qty_delta), 0);
  const inRange = movements.filter((m) => dayOf(m) >= from && dayOf(m) <= to).map((m) => ({ m, ...kindOf(m) }));
  const lines = KIND_LINES.map((l) => {
    const rows = inRange.filter((r) => r.kind === l.kind);
    const qty = rows.reduce((sum, r) => sum + Number(r.m.qty_delta), 0);
    const cost = rows.reduce((sum, r) => sum + Number(r.m.qty_delta) * Number(r.m.unit_cost), 0);
    const counted = rows.filter((r) => r.fromCount);
    const reasons = Array.from(new Set(counted.map((r) => (r.reason ? reasonLabel(r.reason) : "")).filter(Boolean)));
    return {
      ...l,
      count: rows.length,
      qty,
      cost,
      unitCost: qty !== 0 ? cost / qty : rows.length ? Number(rows[0].m.unit_cost) : 0,
      countedCount: counted.length,
      reasons,
    };
  }).filter((l) => l.count > 0);
  const closing = opening + lines.reduce((sum, l) => sum + l.qty, 0);

  // Each delivery in the period, with the unit the supplier invoiced it in
  // when that differs from the base unit (e.g. "2 carton (= 48 tin)").
  const deliveries = inRange
    .filter((r) => r.kind === "purchase")
    .sort((x, y) => x.m.occurred_at.localeCompare(y.m.occurred_at))
    .map((r) => {
      const info = r.m.source_type === "po_line" ? receipts[r.m.source_id] : undefined;
      return { id: r.m.id, day: dayOf(r.m), qty: Number(r.m.qty_delta), info };
    });
  const DELIVERIES_SHOWN = 6;

  // Day-by-day, only days that had movement (a quiet day would be an empty row).
  const days: string[] = [];
  for (let d = from; d <= to && d <= today; d = shiftDay(d, 1)) days.push(d);
  let running = opening;
  const dayRows = days.map((d) => {
    const rows = inRange.filter((r) => dayOf(r.m) === d);
    const sum = (k: MovementKind) => rows.filter((r) => r.kind === k).reduce((t, r) => t + Number(r.m.qty_delta), 0);
    const has = (k: MovementKind) => rows.some((r) => r.kind === k);
    running += rows.reduce((t, r) => t + Number(r.m.qty_delta), 0);
    return { d, n: rows.length, purchase: sum("purchase"), sale: sum("sale"), waste: sum("waste"), count_adjust: sum("count_adjust"), other: sum("other"), has, closing: running };
  });
  const activeDays = dayRows.filter((r) => r.n > 0);
  const quietDays = dayRows.length - activeDays.length;
  const lastActive = movements.map(dayOf).sort().pop();

  const num = (n: number) => parseFloat(n.toFixed(2));
  const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${num(Math.abs(n))} ${h.baseUnit}`;
  const cell = (n: number, present: boolean) => (present ? `${n > 0 ? "+" : n < 0 ? "−" : ""}${num(Math.abs(n))}` : "–");
  const stockEq = (n: number) => (h.stockUnit ? inStockUnit(h, Math.abs(n)) : "");

  return (
    <div className="idm">
      <div className="idm-head">
        <b>{h.itemName}</b>
        <div className="rtabs idm-modes" style={{ margin: 0 }}>
          {(["day", "week", "month"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`rtab ${mode === m ? "on" : ""}`}
              onClick={() => setMode(m)}
            >
              {m === "day" ? "Day" : m === "week" ? "Week" : "Month"}
            </button>
          ))}
        </div>
        <button type="button" className="mini" onClick={() => step(-1)} aria-label={`Previous ${mode}`}>
          ‹
        </button>
        <span className="idm-period">{periodLabel}</span>
        <button type="button" className="mini" disabled={isLatest} onClick={() => step(1)} aria-label={`Next ${mode}`}>
          ›
        </button>
        <input
          type="date"
          value={anchor}
          max={today}
          aria-label={mode === "week" ? "Last day of the week" : "Pick a date"}
          title={mode === "week" ? "The week ends on this day" : mode === "month" ? "Any day in the month" : "The day"}
          onChange={(e) => e.target.value && setAnchor(e.target.value)}
        />
        {anchor !== today && (
          <button type="button" className="link-btn" onClick={() => setAnchor(today)}>
            Today
          </button>
        )}
      </div>

      <table className="tbl idm-table">
        <thead>
          <tr>
            <th>Movement</th>
            <th className="num">Quantity</th>
            <th className="num">Unit cost</th>
            <th className="num">Cost</th>
          </tr>
        </thead>
        <tbody>
          <tr className="idm-bal">
            <td>Opening on hand</td>
            <td className="num">
              {num(opening)} {h.baseUnit}
              {h.stockUnit && <div className="muted idm-eq">{stockEq(opening)}</div>}
            </td>
            <td />
            <td />
          </tr>
          {lines.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                No stock movement in this {mode}.{" "}
                {lastActive && (
                  <button type="button" className="link-btn" onClick={() => setAnchor(lastActive)}>
                    Go to last activity ({fmtShort(lastActive)})
                  </button>
                )}
              </td>
            </tr>
          )}
          {lines.map((l) => (
            <tr key={l.kind}>
              <td>
                {l.label}{" "}
                <span className="muted">
                  · {l.count} {l.count === 1 ? "entry" : "entries"}
                </span>
                {l.kind === "purchase" && deliveries.length > 0 && (
                  <div className="muted idm-eq idm-deliv">
                    {deliveries.slice(0, DELIVERIES_SHOWN).map((d) => {
                      const converted = d.info && d.info.supplierUnit && d.info.supplierQty !== null && d.info.supplierUnit !== h.baseUnit;
                      return (
                        <div key={d.id}>
                          {fmtShort(d.day)}
                          {d.info?.supplierName ? ` · ${d.info.supplierName}` : ""}
                          {" · "}
                          {converted
                            ? `${num(d.info!.supplierQty!)} ${d.info!.supplierUnit} (= ${num(d.qty)} ${h.baseUnit})`
                            : `${num(d.qty)} ${h.baseUnit}`}
                        </div>
                      );
                    })}
                    {deliveries.length > DELIVERIES_SHOWN && <div>+ {deliveries.length - DELIVERIES_SHOWN} more deliveries</div>}
                  </div>
                )}
                {l.countedCount > 0 && (
                  <div className="muted idm-eq">
                    {l.kind === "waste"
                      ? `includes ${l.countedCount} found at a stock count${l.reasons.length ? ` (${l.reasons.join(", ")})` : ""}`
                      : l.reasons.length
                        ? `reasons given: ${l.reasons.join(", ")}`
                        : "no reason given"}
                  </div>
                )}
              </td>
              <td className="num">
                {signed(l.qty)}
                {h.stockUnit && <div className="muted idm-eq">{stockEq(l.qty)}</div>}
              </td>
              <td className="num">{formatMoney(Math.abs(l.unitCost), currency)}</td>
              <td className="num">
                {l.cost < 0 ? "−" : ""}
                {formatMoney(Math.abs(l.cost), currency)}
              </td>
            </tr>
          ))}
          <tr className="idm-bal">
            <td>Closing on hand</td>
            <td className="num">
              {num(closing)} {h.baseUnit}
              {h.stockUnit && <div className="muted idm-eq">{stockEq(closing)}</div>}
            </td>
            <td />
            <td />
          </tr>
        </tbody>
      </table>

      {mode !== "day" && activeDays.length > 0 && (
        <>
          <div className="idm-sub">Day by day ({h.baseUnit})</div>
          <div className="table-scroll">
            <table className="tbl idm-table idm-days">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="num">Purchases</th>
                  <th className="num">Sales</th>
                  <th className="num">Waste</th>
                  <th className="num">Count adj.</th>
                  <th className="num">Other</th>
                  <th className="num">Closing</th>
                </tr>
              </thead>
              <tbody>
                {activeDays.map((r) => (
                  <tr key={r.d} className="clickable" title="Show just this day" onClick={() => { setMode("day"); setAnchor(r.d); }}>
                    <td>{parseDay(r.d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</td>
                    <td className="num">{cell(r.purchase, r.has("purchase"))}</td>
                    <td className="num">{cell(r.sale, r.has("sale"))}</td>
                    <td className="num">{cell(r.waste, r.has("waste"))}</td>
                    <td className="num">{cell(r.count_adjust, r.has("count_adjust"))}</td>
                    <td className="num">{cell(r.other, r.has("other"))}</td>
                    <td className="num">
                      <b>{num(r.closing)}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {quietDays > 0 && (
            <p className="muted idm-note">
              {quietDays} day{quietDays === 1 ? "" : "s"} with no movement not shown.
            </p>
          )}
        </>
      )}
      {to >= today && from <= today && onHandNow !== undefined && Math.abs(onHandNow - closing) > 0.005 && (
        <p className="muted idm-note">
          The system currently shows {num(onHandNow)} {h.baseUnit}; the difference is from movements recorded outside the list above.
        </p>
      )}
    </div>
  );
}

function LiveStockTab({
  accessToken,
  holdings,
  onHand,
  cheapestPrice,
  stockCounts,
  activeLocation,
  locationName,
  currency,
  stockMovements,
}: {
  accessToken: string;
  holdings: FlatHolding[];
  onHand: Record<string, number>;
  cheapestPrice: (itemId: string) => number | null;
  stockCounts: StockCountRow[];
  activeLocation: string;
  locationName: string;
  currency?: string;
  stockMovements: StockMovementRow[];
}) {
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState<"all" | "kitchen" | "bar" | "foh">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Purchase orders are only needed to show the supplier's own unit on each
  // delivery in the movement review, so they are fetched the first time a row
  // is opened (not when Live stock loads).
  const [receipts, setReceipts] = useState<Record<string, ReceiptInfo>>({});
  const receiptsRequested = useRef(false);
  useEffect(() => {
    if (!expandedId || receiptsRequested.current) return;
    receiptsRequested.current = true;
    fetchPurchaseOrders(accessToken)
      .then((pos: PurchaseOrder[]) => {
        const map: Record<string, ReceiptInfo> = {};
        pos.forEach((po) =>
          po.lines.forEach((l) => {
            map[l.id] = {
              supplierName: po.supplier_name,
              poNumber: po.po_number,
              supplierUnit: l.supplier_unit || "",
              supplierQty: l.supplier_qty ? Number(l.supplier_qty) : null,
            };
          })
        );
        setReceipts(map);
      })
      .catch(() => {});
  }, [expandedId, accessToken]);
  // Faceted filter (FilterBar.tsx) -- department keeps its own existing
  // rtabs toggle above, same as Recipes' Dish/Sub-recipe split stays
  // outside its own FilterBar.
  const [liveStockFilters, setLiveStockFilters] = useState<FilterValues>({});
  // Reason given on each count line, so a count shortfall tagged spoilage etc. can be shown as waste.
  const countReasonByLine: Record<string, string | null> = {};
  stockCounts.forEach((c) => c.lines.forEach((l) => (countReasonByLine[l.id] = l.reason)));

  const stockValue = holdings.reduce((sum, h) => sum + (onHand[h.id] ?? 0) * (cheapestPrice(h.itemId) ?? 0), 0);
  const belowPar = holdings.filter((h) => (onHand[h.id] ?? 0) < h.parLevel).length;
  const countsHere = stockCounts.filter((c) => c.location === activeLocation);
  const lastCounted = countsHere
    .filter((c) => c.counted_at)
    .sort((a, b) => (b.counted_at ?? "").localeCompare(a.counted_at ?? ""))[0];
  const openCount = countsHere.find((c) => c.status === "open");

  // Category options are the distinct values actually present on this
  // location's holdings, with an explicit "" value standing in for "no
  // category" so an uncategorised holding is still filterable. Live stock
  // deliberately has no section column or filter -- sections are for counting.
  const categoryOptionsMap = new Map<string, string>();
  holdings.forEach((h) => categoryOptionsMap.set(h.category ?? "", h.categoryName ?? "No category"));
  const categoryOptions = Array.from(categoryOptionsMap, ([value, label]) => ({ value, label })).sort((a, b) =>
    a.value === "" ? 1 : b.value === "" ? -1 : a.label.localeCompare(b.label)
  );
  const liveStockFacets: FilterFacet[] = [
    {
      key: "status",
      label: "Status",
      options: [
        { value: "low", label: "Below par" },
        { value: "ok", label: "OK" },
      ],
    },
    { key: "category", label: "Category", options: categoryOptions },
  ];

  const filtered = holdings.filter((h) => {
    if (deptFilter !== "all" && h.department !== deptFilter) return false;
    if (search && !h.itemName.toLowerCase().includes(search.toLowerCase())) return false;
    const statusSel = liveStockFilters.status ?? null;
    if (statusSel !== null) {
      const isLow = onHand[h.id] !== undefined && onHand[h.id]! < h.parLevel;
      if (!statusSel.includes(isLow ? "low" : "ok")) return false;
    }
    const categorySel = liveStockFilters.category ?? null;
    if (categorySel !== null && !categorySel.includes(h.category ?? "")) return false;
    return true;
  });

  return (
    <>
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Stock value</div>
          <div className="kpi-value">{formatMoney(stockValue, currency)}</div>
          <div className="kpi-sub">
            {holdings.length} item{holdings.length === 1 ? "" : "s"} tracked
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Items below par</div>
          <div className="kpi-value">{belowPar}</div>
          <div className="kpi-sub">out of {holdings.length}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Last count</div>
          <div className="kpi-value" style={{ fontSize: 18 }}>
            {lastCounted?.counted_at ? new Date(lastCounted.counted_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "Never"}
          </div>
          <div className="kpi-sub">{openCount ? "A count is currently open" : "No count in progress"}</div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Stock on hand</h2>
          <button className="btn-ghost small" onClick={() => window.print()} disabled={holdings.length === 0}>
            🖨 Print stock report
          </button>
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 14, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
          <input
            placeholder="Search items…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flex: 1,
              minWidth: 180,
              fontFamily: "inherit",
              fontSize: 13,
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "8px 10px",
              background: "var(--surface)",
            }}
          />
          <div className="rtabs" style={{ margin: 0 }}>
            {(["all", "kitchen", "bar", "foh"] as const).map((d) => (
              <button key={d} className={`rtab ${deptFilter === d ? "on" : ""}`} onClick={() => setDeptFilter(d)}>
                {d === "all" ? "All" : deptLabel(d)}
              </button>
            ))}
          </div>
          <FilterBar
            facets={liveStockFacets}
            values={liveStockFilters}
            onChange={(key, next) => setLiveStockFilters((prev) => ({ ...prev, [key]: next }))}
          />
        </div>

        {holdings.length === 0 && <p className="muted">Nothing stocked at this location yet.</p>}
        {holdings.length > 0 && filtered.length === 0 && <p className="muted">No items match.</p>}
        {filtered.length > 0 && (
          <div className="table-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Department</th>
                  <th className="num">On hand</th>
                  <th className="num">Par</th>
                  <th>Status</th>
                  <th className="num">Value</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((h) => {
                  const oh = onHand[h.id];
                  const low = oh !== undefined && oh < h.parLevel;
                  const expanded = expandedId === h.id;
                  const rowMovements = expanded
                    ? stockMovements.filter(
                        (m) => m.item === h.itemId && m.location === activeLocation && m.department === h.department
                      )
                    : [];
                  return (
                    <Fragment key={h.id}>
                      <tr className="clickable" onClick={() => setExpandedId(expanded ? null : h.id)}>
                        <td>{h.itemName}</td>
                        <td className="muted">{deptLabel(h.department)}</td>
                        <td className="num">
                          {oh === undefined ? "…" : oh.toFixed(2)} {h.baseUnit}
                          {oh !== undefined && h.stockUnit && (
                            <div className="muted" style={{ fontSize: 11.5 }}>
                              ≈ {inStockUnit(h, oh)}
                            </div>
                          )}
                        </td>
                        <td className="num">{h.parLevel.toFixed(2)}</td>
                        <td>
                          <span className={`badge ${low ? "b-low" : "b-ok"}`}>{low ? "Low" : "OK"}</span>
                        </td>
                        <td className="num">{formatMoney((oh ?? 0) * (cheapestPrice(h.itemId) ?? 0), currency)}</td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={6} style={{ background: "var(--bg)" }}>
                            <ItemMovementReview
                              holding={h}
                              movements={rowMovements}
                              countReasonByLine={countReasonByLine}
                              receipts={receipts}
                              onHandNow={oh}
                              currency={currency}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Printable stock report -- header KPIs + one table per department,
          built from the exact same holdings/onHand/cheapestPrice data
          already driving the on-screen KPI cards and table above, so the
          printed numbers can never drift from what's shown on screen.
          Hidden on screen, shown only by @media print (App.css). */}
      <div className="print-only">
        <h1>Live stock report — {locationName || "—"}</h1>
        <p>
          <b>Stock value:</b> {formatMoney(stockValue, currency)} &nbsp;&nbsp;
          <b>Items below par:</b> {belowPar} of {holdings.length} &nbsp;&nbsp;
          <b>Last count:</b>{" "}
          {lastCounted?.counted_at
            ? new Date(lastCounted.counted_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
            : "Never"}
        </p>
        <p>
          <b>Printed:</b> {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
        </p>

        {DEPARTMENTS.map((d) => {
          const deptHoldings = holdings.filter((h) => h.department === d.value);
          if (deptHoldings.length === 0) return null;
          const deptValue = deptHoldings.reduce(
            (sum, h) => sum + (onHand[h.id] ?? 0) * (cheapestPrice(h.itemId) ?? 0),
            0
          );
          return (
            <div key={d.value} className="print-report-section">
              <h2>{d.label}</h2>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>On hand</th>
                      <th>Par</th>
                      <th>Status</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deptHoldings.map((h) => {
                      const oh = onHand[h.id] ?? 0;
                      const low = oh < h.parLevel;
                      return (
                        <tr key={h.id}>
                          <td>{h.itemName}</td>
                          <td>
                            {oh.toFixed(2)} {h.baseUnit}
                          </td>
                          <td>{h.parLevel.toFixed(2)}</td>
                          <td className={low ? "print-low" : undefined}>{low ? "Low" : "OK"}</td>
                          <td>{formatMoney(oh * (cheapestPrice(h.itemId) ?? 0), currency)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4}>
                        <b>Department subtotal</b>
                      </td>
                      <td>
                        <b>{formatMoney(deptValue, currency)}</b>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Manage sections
// ---------------------------------------------------------------------------

function SectionsTab({
  accessToken,
  activeLocation,
  sections,
  sectionsError,
  holdings,
  onSectionsChanged,
  onOpenItem,
  onItemsChanged,
}: {
  accessToken: string;
  activeLocation: string;
  sections: Section[];
  sectionsError: string | null;
  holdings: FlatHolding[];
  onSectionsChanged: () => void;
  onOpenItem?: (itemId: string) => void;
  onItemsChanged: () => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Section | null>(null);
  const [modalName, setModalName] = useState("");
  const [modalChecked, setModalChecked] = useState<Record<string, boolean>>({});
  // Stock unit chosen per ticked item in this section ('' = base unit only); a missing key keeps what is saved.
  const [modalUnit, setModalUnit] = useState<Record<string, string>>({});
  // Maximum typed per ticked item ('' = no limit); a missing key keeps what is saved.
  const [modalMax, setModalMax] = useState<Record<string, string>>({});
  // What was typed in the limit box while a stock unit is chosen (e.g. "2." on the way to 2.5 tubs).
  // modalMax stays the single source of truth, always in the base unit; this only keeps the text as
  // typed. Keyed with the unit so switching the unit drops stale text and the box shows the converted value.
  const [modalMaxDraft, setModalMaxDraft] = useState<Record<string, string>>({});
  const [modalCadence, setModalCadence] = useState<"weekly" | "monthly" | null>(null);
  const [modalDueDate, setModalDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [itemSearch, setItemSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  function openCreate() {
    setEditing(null);
    setModalName("");
    setModalChecked({});
    setModalUnit({});
    setModalMax({});
    setModalMaxDraft({});
    setModalCadence(null);
    setModalDueDate("");
    setErr(null);
    setConfirmDelete(false);
    setItemSearch("");
    setCategoryFilter("all");
    setModalOpen(true);
  }

  function openEdit(s: Section) {
    setEditing(s);
    setModalName(s.name);
    setModalChecked(Object.fromEntries(holdingsInSection(holdings, s.id).map((h) => [h.id, true])));
    setModalUnit({});
    setModalMax({});
    setModalMaxDraft({});
    setModalCadence(s.count_cadence);
    setModalDueDate(s.next_count_due ?? "");
    setErr(null);
    setConfirmDelete(false);
    setItemSearch("");
    setCategoryFilter("all");
    setModalOpen(true);
  }

  // Picking a cadence for the first time (there's nothing useful to
  // schedule without SOME due date) defaults it to today, same as
  // ticking a checkbox in the count sheet prefills with the expected
  // value -- the counter can always move it, but there's always a
  // sensible starting point rather than an empty picker.
  function handleCadenceClick(value: "weekly" | "monthly") {
    setModalCadence((c) => {
      const next = c === value ? null : value;
      if (next && !modalDueDate) setModalDueDate(new Date().toISOString().slice(0, 10));
      return next;
    });
  }

  async function handleSave() {
    if (!modalName.trim() || !activeLocation) return;
    setSaving(true);
    setErr(null);
    try {
      // Check the typed maximums before anything is saved, so a typo can't leave a half-saved section.
      for (const h of holdings) {
        if (!modalChecked[h.id]) continue;
        const text = (modalMax[h.id] ?? "").trim();
        if (text !== "" && !(Number.isFinite(Number(text)) && Number(text) >= 0)) {
          throw new Error(`The maximum for ${h.itemName} must be a number, or left blank for no limit.`);
        }
      }
      const schedule = {
        count_cadence: modalCadence,
        next_count_due: modalCadence ? modalDueDate || new Date().toISOString().slice(0, 10) : null,
      };
      const sectionId = editing
        ? (await updateSection(accessToken, editing.id, { name: modalName.trim(), ...schedule })).id
        : (await createSection(accessToken, { location: activeLocation, name: modalName.trim(), ...schedule })).id;

      // An item can sit in several sections, so ticking adds it to this one
      // (it is never moved out of another) and un-ticking removes only this one.
      const jobs: Promise<unknown>[] = [];
      for (const h of holdings) {
        const inSection = !!modalChecked[h.id];
        const p = h.placements.find((x) => x.section === sectionId);
        const unit = modalUnit[h.id] ?? p?.stockUnitId ?? "";
        const savedMax = p?.maxQty != null ? String(p.maxQty) : "";
        const maxText = (modalMax[h.id] ?? savedMax).trim();
        const max = maxText === "" ? null : maxText;
        if (inSection && !p) {
          jobs.push(createHoldingSection(accessToken, { holding: h.id, section: sectionId, stock_unit: unit || null, max_qty: max }));
        } else if (!inSection && p) {
          jobs.push(deleteHoldingSection(accessToken, p.id));
        } else if (inSection && p && (unit !== p.stockUnitId || maxText !== savedMax)) {
          jobs.push(updateHoldingSection(accessToken, p.id, { stock_unit: unit || null, max_qty: max }));
        }
      }
      await Promise.all(jobs);

      setModalOpen(false);
      onSectionsChanged();
      onItemsChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save this section.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editing) return;
    setSaving(true);
    setErr(null);
    try {
      await deleteSection(accessToken, editing.id);
      setModalOpen(false);
      onSectionsChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not delete this section.");
      setSaving(false);
    }
  }

  // "Uncategorized" buckets items with no category so they're still
  // findable via the filter rather than silently dropped from it.
  const categoryOptions = Array.from(new Set(holdings.map((h) => h.categoryName ?? "Uncategorized"))).sort((a, b) =>
    a.localeCompare(b)
  );

  const visibleHoldings = holdings.filter((h) => {
    if (categoryFilter !== "all" && (h.categoryName ?? "Uncategorized") !== categoryFilter) return false;
    if (itemSearch && !h.itemName.toLowerCase().includes(itemSearch.toLowerCase())) return false;
    return true;
  });

  const selectedCount = Object.values(modalChecked).filter(Boolean).length;
  // Ticked items sit in their own panel at the top so the selection stays in
  // view while the rest of the list scrolls below it.
  const byName = (a: FlatHolding, b: FlatHolding) => a.itemName.localeCompare(b.itemName) || a.department.localeCompare(b.department);
  const selectedVisible = visibleHoldings.filter((h) => modalChecked[h.id]).sort(byName);
  const otherVisible = visibleHoldings.filter((h) => !modalChecked[h.id]).sort(byName);

  function renderItemRow(h: FlatHolding, selected: boolean) {
    const here = editing ? h.placements.find((x) => x.section === editing.id) : undefined;
    const elsewhere = h.placements.filter((x) => x.section !== editing?.id).map((x) => x.sectionName);
    return (
      <div key={h.id} className={`il-row ${selected ? "on" : ""}`}>
        <input
          type="checkbox"
          checked={selected}
          aria-label={`${selected ? "Remove" : "Add"} ${h.itemName}`}
          onChange={(e) => setModalChecked((c) => ({ ...c, [h.id]: e.target.checked }))}
        />
        <span className="il-name" onClick={() => setModalChecked((c) => ({ ...c, [h.id]: !selected }))}>
          {h.itemName}
          {elsewhere.length > 0 && <span className="muted il-also"> also in {elsewhere.join(", ")}</span>}
        </span>
        <span className="muted il-dept">{deptLabel(h.department)}</span>
        <span className="il-unit">
          {selected &&
            (h.itemStockUnits.length > 0 ? (
              <select
                className="item-check-unit"
                aria-label={`Count ${h.itemName} in`}
                title="Which unit this section counts it in"
                value={modalUnit[h.id] ?? here?.stockUnitId ?? ""}
                onChange={(e) => setModalUnit((m) => ({ ...m, [h.id]: e.target.value }))}
              >
                <option value="">{h.baseUnit} only</option>
                {h.itemStockUnits.map((u) => (
                  <option key={u.id} value={u.id}>
                    also in {u.name} ({parseFloat(Number(u.qty).toFixed(4))} {h.baseUnit})
                  </option>
                ))}
              </select>
            ) : (
              onOpenItem && (
                <button type="button" className="link-btn" title="Stock units are set up on the item page" onClick={() => onOpenItem(h.itemId)}>
                  + stock unit
                </button>
              )
            ))}
        </span>
        <span className="il-max">
          {selected &&
            (() => {
              // The limit is typed in the unit this section counts in (a tub, say) and saved in the base unit.
              const unitId = modalUnit[h.id] ?? here?.stockUnitId ?? "";
              const unit = h.itemStockUnits.find((u) => u.id === unitId);
              const unitQty = unit ? Number(unit.qty) : 0;
              const baseText = modalMax[h.id] ?? (here?.maxQty != null ? String(here.maxQty) : "");
              const baseNum = baseText.trim() !== "" && Number.isFinite(Number(baseText)) ? Number(baseText) : null;
              const draftKey = `${h.id}|${unitId}`;
              const shown =
                unit && unitQty > 0
                  ? draftKey in modalMaxDraft
                    ? modalMaxDraft[draftKey]
                    : baseNum === null
                      ? ""
                      : String(parseFloat((baseNum / unitQty).toFixed(3)))
                  : baseText;
              const unitName = unit && unitQty > 0 ? unit.name : h.baseUnit;
              return (
                <>
                  <div className="il-max-box">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      placeholder="no limit"
                      aria-label={`Most ${h.itemName} that fits in this section, in ${unitName}`}
                      title={`The most that fits in this section, in ${unitName}. Leave blank for no limit. Counts above it show a warning, never a block.`}
                      value={shown}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (unit && unitQty > 0) {
                          setModalMaxDraft((d) => ({ ...d, [draftKey]: v }));
                          const n = Number(v);
                          if (v === "") setModalMax((m) => ({ ...m, [h.id]: "" }));
                          else if (Number.isFinite(n)) setModalMax((m) => ({ ...m, [h.id]: String(parseFloat((n * unitQty).toFixed(3))) }));
                        } else {
                          setModalMax((m) => ({ ...m, [h.id]: v }));
                        }
                      }}
                    />
                    <span className="muted il-max-unit">{unitName}</span>
                  </div>
                  {unit && unitQty > 0 && baseNum !== null && (
                    <div className="muted il-max-eq">
                      = {parseFloat(baseNum.toFixed(3))} {h.baseUnit}
                    </div>
                  )}
                </>
              );
            })()}
        </span>
      </div>
    );
  }

  // Bulk actions only ever touch what's currently visible under the
  // search/category filter -- so narrowing the list, selecting, then
  // clearing the filter never surprises the user by wiping a selection
  // they made before filtering.
  function selectAllVisible() {
    setModalChecked((c) => {
      const next = { ...c };
      visibleHoldings.forEach((h) => {
        next[h.id] = true;
      });
      return next;
    });
  }

  function clearAllVisible() {
    setModalChecked((c) => {
      const next = { ...c };
      visibleHoldings.forEach((h) => {
        next[h.id] = false;
      });
      return next;
    });
  }

  return (
    <>
      <p className="muted" style={{ fontSize: 13, marginTop: 0, marginBottom: 16 }}>
        Sections are your permanent storage layout — set them up once and they're reused for every count. Assign who
        counts them on the <b>Count sheets</b> tab.
      </p>

      {sectionsError && <p className="error">{sectionsError}</p>}

      <div className="section-grid">
        {sections.map((s) => {
          const itemsInSection = holdingsInSection(holdings, s.id);
          const icon = sectionIcon(s.name);
          return (
            <div className="card section-card" key={s.id}>
              <div className="section-card-top">
                <div className={`section-icon ${icon.cls}`}>{icon.emoji}</div>
                <div>
                  <div className="section-card-name">{s.name}</div>
                  <div className="section-card-meta">
                    {itemsInSection.length} item{itemsInSection.length === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
              <div className="section-preview">
                {itemsInSection.length ? itemsInSection.map((h) => h.itemName + (h.stockUnit ? ` (${h.stockUnit})` : "")).join(" · ") : "No items assigned yet"}
              </div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
                {s.count_cadence
                  ? `${s.count_cadence === "weekly" ? "Weekly" : "Monthly"} · next ${s.next_count_due ? formatDueDate(s.next_count_due) : "—"}`
                  : "Not scheduled"}
              </div>
              <div className="section-card-foot">
                <button className="open-link" onClick={() => openEdit(s)}>
                  Edit section
                </button>
              </div>
            </div>
          );
        })}
        <button className="new-section-tile" onClick={openCreate}>
          + New section
        </button>
      </div>

      {modalOpen && (
        <div className="modal-backdrop" onClick={() => !saving && setModalOpen(false)}>
          <div className="modal sections-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editing ? `Edit ${editing.name}` : "New section"}</h2>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
              {editing
                ? "Add or remove items as your storage changes — the section keeps its name and history."
                : "Group items by where they physically live, so a counter can walk one area at a time."}
            </p>
            <div className="field">
              <label>Section name</label>
              <input value={modalName} onChange={(e) => setModalName(e.target.value)} placeholder="e.g. Freezer no. 2" autoFocus />
            </div>
            <div className="field">
              <label>Count schedule</label>
              <div className="chip-row" style={{ marginBottom: modalCadence ? 8 : 0 }}>
                <button
                  type="button"
                  className={`chip ${modalCadence === "weekly" ? "active" : ""}`}
                  onClick={() => handleCadenceClick("weekly")}
                >
                  Weekly
                </button>
                <button
                  type="button"
                  className={`chip ${modalCadence === "monthly" ? "active" : ""}`}
                  onClick={() => handleCadenceClick("monthly")}
                >
                  Monthly
                </button>
                {!modalCadence && <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>Not scheduled — count it whenever</span>}
              </div>
              {modalCadence && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="muted" style={{ fontSize: 12.5 }}>Next due</span>
                  <input type="date" value={modalDueDate} onChange={(e) => setModalDueDate(e.target.value)} style={{ width: 160 }} />
                </div>
              )}
            </div>
            <div className="field">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
                <label style={{ marginBottom: 0 }}>Items in this section</label>
                <span className="muted" style={{ fontSize: 11.5 }}>{selectedCount} selected</span>
              </div>
              {holdings.length === 0 && <p className="muted" style={{ fontSize: 12.5 }}>No items stocked at this location yet.</p>}
              {holdings.length > 0 && (
                <>
                  <div className="item-checklist-toolbar">
                    <input
                      placeholder="Search items…"
                      value={itemSearch}
                      onChange={(e) => setItemSearch(e.target.value)}
                      className="item-checklist-search"
                    />
                    {categoryOptions.length > 1 && (
                      <select
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        className="item-checklist-category"
                      >
                        <option value="all">All categories</option>
                        {categoryOptions.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    )}
                    <button type="button" className="btn-ghost small" onClick={selectAllVisible} disabled={visibleHoldings.length === 0}>
                      Select shown
                    </button>
                    <button type="button" className="btn-ghost small" onClick={clearAllVisible} disabled={visibleHoldings.length === 0}>
                      Clear shown
                    </button>
                  </div>
                  {visibleHoldings.length === 0 && <p className="muted" style={{ fontSize: 12.5 }}>No items match.</p>}
                  <div className="il-panel il-selected">
                    <div className="il-title">In this section · {selectedVisible.length}</div>
                    <div className="il-head">
                      <span />
                      <span>Item</span>
                      <span>Department</span>
                      <span>Counted in</span>
                      <span>Most that fits</span>
                    </div>
                    {selectedVisible.length === 0 && (
                      <p className="muted il-empty">
                        {selectedCount === 0 ? "Nothing selected yet — tick items in the list below." : "No selected items match the search."}
                      </p>
                    )}
                    {selectedVisible.map((h) => renderItemRow(h, true))}
                  </div>
                  <div className="il-panel il-others">
                    <div className="il-title">Add more items · {otherVisible.length}</div>
                    {otherVisible.length === 0 && <p className="muted il-empty">Every item shown is already in this section.</p>}
                    {otherVisible.map((h) => renderItemRow(h, false))}
                  </div>
                </>
              )}
            </div>
            {err && <p className="error">{err}</p>}
            <div className="modal-actions">
              {editing && !confirmDelete && (
                <button type="button" className="btn-ghost" style={{ marginRight: "auto", color: "var(--brick)" }} onClick={() => setConfirmDelete(true)}>
                  Delete
                </button>
              )}
              {editing && confirmDelete && (
                <button type="button" className="btn-danger" style={{ marginRight: "auto" }} onClick={handleDelete} disabled={saving}>
                  {saving ? "Deleting…" : "Confirm delete"}
                </button>
              )}
              <button type="button" className="btn-ghost" onClick={() => setModalOpen(false)} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={handleSave} disabled={saving || !modalName.trim()}>
                {saving ? "Saving…" : editing ? "Save changes" : "Create section"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Count sheets
// ---------------------------------------------------------------------------

function CountSheetsTab({
  accessToken,
  me,
  staff,
  activeLocation,
  locationName,
  sections,
  holdings,
  onHand,
  cheapestPrice,
  stockCounts,
  stockCountsError,
  onSectionsChanged,
  onStockCountsChanged,
}: {
  accessToken: string;
  me: Me;
  staff: Membership[];
  activeLocation: string;
  locationName: string;
  sections: Section[];
  holdings: FlatHolding[];
  onHand: Record<string, number>;
  cheapestPrice: (itemId: string) => number | null;
  stockCounts: StockCountRow[] | null;
  stockCountsError: string | null;
  onSectionsChanged: () => void;
  onStockCountsChanged: () => void;
}) {
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);

  const openCount = (stockCounts ?? []).find((c) => c.location === activeLocation && c.status === "open");

  async function handleStartCount() {
    setStarting(true);
    setErr(null);
    try {
      await createStockCount(accessToken, activeLocation);
      onStockCountsChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not start a stock count.");
    } finally {
      setStarting(false);
    }
  }

  async function handleCloseCount() {
    if (!openCount) return;
    try {
      await updateStockCount(accessToken, openCount.id, { status: "closed", counted_at: new Date().toISOString() });
      onStockCountsChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not close this count.");
    }
  }

  async function handleAssign(sectionId: string, userId: string) {
    if (!openCount) return;
    const existing = openCount.assignments.find((a) => a.section === sectionId);
    try {
      if (existing) {
        await updateCountAssignment(accessToken, existing.id, { assigned_to: userId || null });
      } else {
        await createCountAssignment(accessToken, { count: openCount.id, section: sectionId, assigned_to: userId || null });
      }
      onStockCountsChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not update the assignment.");
    }
  }

  if (stockCountsError) return <p className="error">{stockCountsError}</p>;

  if (!openCount) {
    return (
      <div className="card" style={{ textAlign: "center", padding: "40px 24px" }}>
        <p className="muted" style={{ marginBottom: 16 }}>
          No stock count is currently open at this location.
        </p>
        <button className="btn-primary small" onClick={handleStartCount} disabled={starting}>
          {starting ? "Starting…" : "+ Start a stock count"}
        </button>
        {err && (
          <p className="error" style={{ marginTop: 12 }}>
            {err}
          </p>
        )}
      </div>
    );
  }

  const openSection = openSectionId ? sections.find((s) => s.id === openSectionId) : null;

  if (openSection) {
    return (
      <CountSheet
        accessToken={accessToken}
        count={openCount}
        section={openSection}
        holdings={holdingsInSection(holdings, openSection.id)}
        allCounts={(stockCounts ?? []).filter((c) => c.location === activeLocation)}
        onHand={onHand}
        cheapestPrice={cheapestPrice}
        onBack={() => setOpenSectionId(null)}
        onSectionsChanged={onSectionsChanged}
        onSubmitted={() => {
          onStockCountsChanged();
          setOpenSectionId(null);
        }}
      />
    );
  }

  const sectionsWithItems = sections.filter((s) => holdings.some((h) => h.placements.some((p) => p.section === s.id)));

  return (
    <>
      <div className="content-head">
        <h2 style={{ margin: 0 }}>Count in progress</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-ghost small" onClick={() => window.print()} disabled={sectionsWithItems.length === 0}>
            🖨 Print sheets
          </button>
          <button className="btn-ghost small" onClick={handleCloseCount}>
            Close count
          </button>
        </div>
      </div>

      {/* One printed page per section (Item / Par / Counted qty, the last
          column left blank) -- handed to whoever's counting that section,
          filled in by hand, then read back in via "Scan filled sheet"
          below. Hidden on screen, shown only by @media print (App.css). */}
      <div className="print-only">
        {sectionsWithItems.map((s, i) => {
          const sectionHoldings = holdingsInSection(holdings, s.id);
          return (
            <div key={s.id} className={`print-sheet-page ${i === sectionsWithItems.length - 1 ? "last" : ""}`}>
              <h1>{s.name} — Count sheet</h1>
              <p>
                <b>Location:</b> {locationName || "—"} &nbsp;&nbsp; <b>Date:</b> {new Date().toLocaleDateString()}
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Unit</th>
                      <th>Par</th>
                      <th>Counted qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sectionHoldings.map((h) => (
                      <tr key={h.id}>
                        <td>{h.itemName}</td>
                        <td>{h.baseUnit}</td>
                        <td>{h.parLevel.toFixed(2)}</td>
                        <td></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>

      {err && <p className="error">{err}</p>}
      {sections.length === 0 && <p className="muted">No sections set up yet — add some under "Manage sections" first.</p>}
      <div className="section-grid">
        {sections.map((s) => {
          const sectionHoldings = holdingsInSection(holdings, s.id);
          const itemIds = Array.from(new Set(sectionHoldings.map((h) => h.itemId)));
          // Counted in THIS section (older counts did not record a section; those count for every section).
          const countedIds = new Set(openCount.lines.filter((l) => l.section === s.id || l.section === null).map((l) => l.item));
          const doneCount = itemIds.filter((id) => countedIds.has(id)).length;
          const pct = itemIds.length ? Math.round((doneCount / itemIds.length) * 100) : 0;
          const assignment = openCount.assignments.find((a) => a.section === s.id);
          const status = doneCount === 0 ? { label: "To do", cls: "" } : doneCount < itemIds.length ? { label: "In progress", cls: "b-low" } : { label: "Complete", cls: "b-ok" };
          const icon = sectionIcon(s.name);
          const assignedStaffHere = staff.find((m) => m.user === assignment?.assigned_to);
          const today = new Date().toISOString().slice(0, 10);
          // A scheduled section's green "Complete" state tracks the
          // schedule itself -- counted since it last came due, and not
          // due again yet -- rather than whatever happens to be sitting
          // in the currently-open count's lines. That matters because one
          // StockCount often stays open for weeks across many cadence
          // cycles, so "has a line in the open count" can go stale: count
          // the Fridge today, and without this it would read green
          // forever, not just until next week's due date. A section with
          // no cadence has no schedule to track, so it keeps the simple
          // "every item has a line in the open count" read.
          const isComplete = s.count_cadence
            ? !!s.last_counted_at && !!s.next_count_due && today < s.next_count_due
            : status.label === "Complete";
          const overdue = !isComplete && !!s.count_cadence && !!s.next_count_due && s.next_count_due < today;
          let dueBadge: { label: string; cls: string } | null = null;
          if (isComplete) {
            dueBadge = s.next_count_due ? { label: `Next check ${formatDueDate(s.next_count_due)}`, cls: "" } : null;
          } else if (s.count_cadence && s.next_count_due) {
            dueBadge = overdue
              ? { label: `Overdue since ${formatDueDate(s.next_count_due)}`, cls: "warn" }
              : { label: `Due ${formatDueDate(s.next_count_due)}`, cls: "" };
          }
          return (
            <div
              className={`card section-card section-card-clickable ${isComplete ? "section-card-complete" : overdue ? "section-card-overdue" : ""}`}
              key={s.id}
              onClick={() => itemIds.length > 0 && setOpenSectionId(s.id)}
              role="button"
              tabIndex={itemIds.length > 0 ? 0 : -1}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && itemIds.length > 0) setOpenSectionId(s.id);
              }}
            >
              {isComplete && (
                <div className="section-card-done-check" title="Completed">
                  ✓
                </div>
              )}
              <div className="section-card-top">
                <div className={`section-icon ${icon.cls}`}>{icon.emoji}</div>
                <div>
                  <div className="section-card-name">{s.name}</div>
                  <div className="section-card-meta">
                    {itemIds.length} item{itemIds.length === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
              <div className="bar-row" style={{ padding: "10px 0 4px" }}>
                <div className="bar-track" style={{ flex: 1 }}>
                  <div className="bar-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="bar-val" style={{ width: "auto" }}>
                  {doneCount}/{itemIds.length}
                </div>
              </div>
              <div className="assign-row" onClick={(e) => e.stopPropagation()}>
                <span className="assign-lbl">Assigned to</span>
                <select
                  className="assign-select"
                  value={assignment?.assigned_to ?? ""}
                  onChange={(e) => handleAssign(s.id, e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {!assignedStaffHere && assignment?.assigned_to_name && (
                    <option value={assignment.assigned_to ?? ""}>{assignment.assigned_to_name}</option>
                  )}
                  {staff.map((m) => (
                    <option key={m.id} value={m.user}>
                      {staffLabel(m)}
                      {m.user === me.id ? " (you)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="section-card-foot">
                {dueBadge ? (
                  <span className={`badge ${dueBadge.cls || (isComplete ? "b-ok" : "")}`}>{dueBadge.label}</span>
                ) : (
                  <span />
                )}
                <span>
                  {status.label !== "To do" && <span className={`badge ${status.cls}`}>{status.label}</span>} <span className="pct">{pct}%</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function CountSheet({
  accessToken,
  count,
  section,
  holdings,
  allCounts,
  onHand,
  cheapestPrice,
  onBack,
  onSectionsChanged,
  onSubmitted,
}: {
  accessToken: string;
  count: StockCountRow;
  section: Section;
  holdings: FlatHolding[];
  allCounts: StockCountRow[];
  onHand: Record<string, number>;
  cheapestPrice: (itemId: string) => number | null;
  onBack: () => void;
  onSectionsChanged: () => void;
  onSubmitted: () => void;
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [qty, setQty] = useState<Record<string, string>>({});
  // What was typed in the stock-unit box (e.g. "2." while typing 2.5 bags).
  // `qty` stays the single source of truth in the base unit; this only keeps
  // the text as typed. Keyed with the unit size so editing the stock unit
  // mid-count drops stale text.
  const [stockDraft, setStockDraft] = useState<Record<string, string>>({});
  // Extra lines added with the + button, e.g. "+ 250 g" after "5 bag". The row's
  // total in the base unit is always what `qty` holds.
  const [extras, setExtras] = useState<Record<string, { unit: string; text: string }[]>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  // OCR confidence per holding, for rows the scan pre-filled -- shown as a
  // "double-check this one" hint next to the row, same "weakest field"
  // confidence Scan receipt already surfaces.
  const [scanConfidence, setScanConfidence] = useState<Record<string, number | null>>({});
  // Rows Textract read off the photo that didn't fuzzy-match any item in
  // this section -- surfaced so the counter can add them by hand rather
  // than silently losing what was written on the sheet.
  const [unmatchedScanRows, setUnmatchedScanRows] = useState<ScannedCountRow[]>([]);

  async function handleScanFileSelected(file: File) {
    setScanError(null);
    setScanning(true);
    try {
      const result = await scanCountSheet(accessToken, file);
      const newChecked: Record<string, boolean> = {};
      const newQty: Record<string, string> = {};
      const newConfidence: Record<string, number | null> = {};
      const unmatched: ScannedCountRow[] = [];

      for (const row of result.rows) {
        const ranked = holdings
          .map((h) => ({ h, score: matchScore(h.itemName, row.item_text) }))
          .sort((a, b) => b.score - a.score);
        const best = ranked[0];
        if (!best || best.score < 0.5) {
          unmatched.push(row);
          continue;
        }
        // Nothing is auto-saved from a scan -- this only pre-fills the same
        // checked/qty state the manual table already uses, so every row
        // still passes through the counter's own review before Submit.
        newChecked[best.h.id] = true;
        clearDraft(best.h);
        setExtras((x) => ({ ...x, [best.h.id]: [] }));
        const expectedScan = expectedHere(best.h);
        newQty[best.h.id] = cleanNumeric(row.qty_text) || (expectedScan === null ? "" : Math.max(0, expectedScan).toFixed(2));
        newConfidence[best.h.id] = row.confidence;
      }

      setChecked((c) => ({ ...c, ...newChecked }));
      setQty((q) => ({ ...q, ...newQty }));
      setScanConfidence((sc) => ({ ...sc, ...newConfidence }));
      setUnmatchedScanRows(unmatched);
    } catch (e) {
      setScanError(e instanceof Error ? e.message : "Could not scan that count sheet.");
    } finally {
      setScanning(false);
    }
  }

  // An item can sit in several sections, and its total on hand is the latest
  // count of each section added up. So what this section is expected to hold is
  // the system's total less what the OTHER sections last counted. An item in a
  // single section is simply compared with its total. If another section has
  // never been counted, the split is unknown: the count is saved but the total
  // is not adjusted until that section has been counted too.
  const latestCount: Record<string, { qty: number; at: string }> = {};
  allCounts.forEach((c) =>
    c.lines.forEach((l) => {
      if (!l.section) return;
      const key = `${l.item}|${l.section}`;
      if (!latestCount[key] || l.created_at > latestCount[key].at) latestCount[key] = { qty: Number(l.counted_qty), at: l.created_at };
    })
  );
  function otherSections(h: FlatHolding) {
    const known: { name: string; qty: number; at: string }[] = [];
    const unknown: string[] = [];
    h.placements
      .filter((p) => p.section !== section.id)
      .forEach((p) => {
        const last = latestCount[`${h.itemId}|${p.section}`];
        if (last) known.push({ name: p.sectionName, qty: last.qty, at: last.at });
        else unknown.push(p.sectionName);
      });
    return { known, unknown, sum: known.reduce((t, k) => t + k.qty, 0) };
  }
  // What the system expects in this section, or null when another section has never been counted.
  function expectedHere(h: FlatHolding): number | null {
    const o = otherSections(h);
    if (o.unknown.length > 0) return null;
    return (onHand[h.id] ?? 0) - o.sum;
  }
  const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  function variance(h: FlatHolding): number | null {
    const q = qty[h.id];
    if (!checked[h.id] || q === undefined || q === "") return null;
    const num = Number(q);
    if (!Number.isFinite(num)) return null;
    const expected = expectedHere(h);
    return expected === null ? null : num - expected;
  }

  // A checked row that can't actually be saved -- empty, not a number, or
  // negative (there's no such thing as a negative physical count). Used
  // both to block Submit with a clear message and to flag the row itself,
  // instead of the old behaviour of quietly dropping it with no sign
  // anything was wrong -- see the handleSubmit comment below.
  function invalidReason(h: FlatHolding): string | null {
    if (!checked[h.id]) return null;
    const q = qty[h.id];
    if (q === undefined || q === "") return "Enter a counted quantity";
    const num = Number(q);
    if (!Number.isFinite(num)) return "Enter a valid number";
    if (num < 0) return "A physical count can't be negative -- enter what's actually there";
    return null;
  }

  const draftKey = (h: FlatHolding) => `${h.id}|${h.stockUnitQty}`;
  function clearDraft(h: FlatHolding) {
    setStockDraft((d) => {
      if (!(draftKey(h) in d)) return d;
      const rest = { ...d };
      delete rest[draftKey(h)];
      return rest;
    });
  }
  // What the first box shows: what was typed there, else the saved total in this section's unit.
  function primaryText(h: FlatHolding): string {
    if (draftKey(h) in stockDraft) return stockDraft[draftKey(h)];
    const base = qty[h.id];
    if (base === undefined || base === "" || !Number.isFinite(Number(base))) return "";
    const f = primaryUnit(h).factor;
    return f === 1 ? base : parseFloat((Number(base) / f).toFixed(3)).toString();
  }
  // The row's total in the base unit, as the text `qty` keeps ("" while nothing is typed).
  function totalOf(h: FlatHolding, first: string, list: { unit: string; text: string }[]): string {
    const parts: [string, number][] = [[first, primaryUnit(h).factor], ...list.map((e): [string, number] => [e.text, unitFactor(h, e.unit)])];
    if (parts.every(([t]) => t === "")) return "";
    let sum = 0;
    for (const [t, f] of parts) {
      if (t === "") continue;
      const n = Number(t);
      if (!Number.isFinite(n)) return t;
      sum += n * f;
    }
    return parseFloat(sum.toFixed(3)).toString();
  }
  function handlePrimaryChange(h: FlatHolding, value: string) {
    setStockDraft((d) => ({ ...d, [draftKey(h)]: value }));
    handleQtyChange(h, totalOf(h, value, extras[h.id] ?? []));
  }
  // Any change to the + lines. The first box's text is frozen first, so adding a
  // line never changes what it shows.
  function setExtraLines(h: FlatHolding, next: { unit: string; text: string }[]) {
    const first = primaryText(h);
    setStockDraft((d) => ({ ...d, [draftKey(h)]: first }));
    setExtras((x) => ({ ...x, [h.id]: next }));
    handleQtyChange(h, totalOf(h, first, next));
  }
  function addExtraLine(h: FlatHolding) {
    const list = extras[h.id] ?? [];
    const opts = otherUnits(h);
    const next = opts.find((o) => !list.some((e) => e.unit === o.key)) ?? opts[0];
    if (next) setExtraLines(h, [...list, { unit: next.key, text: "" }]);
  }

  function handleTick(h: FlatHolding, isChecked: boolean) {
    setChecked((c) => ({ ...c, [h.id]: isChecked }));
    if (!isChecked) {
      clearDraft(h);
      setExtras((x) => ({ ...x, [h.id]: [] }));
    }
    if (isChecked) {
      // Prefill with the expected quantity — most items will match, so the
      // counter only has to touch items that actually differ.
      const expected = expectedHere(h);
      setQty((q) => ({ ...q, [h.id]: expected === null ? "" : Math.max(0, expected).toFixed(2) }));
    } else {
      setQty((q) => ({ ...q, [h.id]: "" }));
      if (openNoteId === h.id) setOpenNoteId(null);
    }
  }

  function handleQtyChange(h: FlatHolding, value: string) {
    setQty((q) => ({ ...q, [h.id]: value }));
    // The counter has now looked at (and possibly corrected) this row
    // themselves, so a stale "double-check this" hint from the scan no
    // longer applies.
    setScanConfidence((sc) => {
      if (!(h.id in sc)) return sc;
      const rest = { ...sc };
      delete rest[h.id];
      return rest;
    });
    const num = Number(value);
    const expectedNow = expectedHere(h);
    const off = value !== "" && Number.isFinite(num) && expectedNow !== null && Math.abs(num - expectedNow) > 0.001;
    if (off && !reason[h.id] && !note[h.id]) {
      setOpenNoteId(h.id);
    } else if (!off && openNoteId === h.id) {
      setOpenNoteId(null);
    }
  }

  const done = holdings.filter((h) => checked[h.id]).length;
  const pct = holdings.length ? Math.round((done / holdings.length) * 100) : 0;

  async function handleSubmit() {
    setErr(null);
    // Never silently drop a checked row -- a counted quantity can't be
    // negative, but quietly skipping it used to leave Submit looking
    // successful while the section's done/total count stayed wrong with
    // no explanation (this is what was behind sections getting stuck
    // showing e.g. "3/13" after a full count was submitted). Block and
    // say exactly which items need a real number instead.
    const problems = holdings.filter((h) => invalidReason(h));
    if (problems.length > 0) {
      setErr(
        `${problems.length} item${problems.length === 1 ? "" : "s"} need a valid, non-negative count before this can be submitted: ${problems
          .map((h) => h.itemName)
          .join(", ")}`
      );
      return;
    }
    setSaving(true);
    try {
      for (const h of holdings) {
        if (!checked[h.id]) continue;
        const countedQty = Number(qty[h.id]);
        const varQty = variance(h);
        const line = await createCountLine(accessToken, {
          count: count.id,
          item: h.itemId,
          counted_qty: countedQty.toFixed(3),
          section: section.id,
          reason: varQty && varQty !== 0 ? reason[h.id] ?? "miscount" : null,
          note: varQty && varQty !== 0 ? note[h.id] || null : null,
        });
        if (varQty && varQty !== 0) {
          await createStockMovement(accessToken, {
            location: section.location,
            item: h.itemId,
            department: h.department,
            qty_delta: varQty.toFixed(3),
            movement_type: "count_adjust",
            unit_cost: (cheapestPrice(h.itemId) ?? 0).toFixed(2),
            source_type: "count_line",
            source_id: line.id,
          });
        }
      }
      // If this submission (combined with anything already counted on
      // this open count) finishes every item in the section, advance its
      // schedule -- best-effort, since the count itself already saved
      // successfully and a missed schedule bump isn't worth surfacing as
      // an error to whoever's counting.
      const allItemIds = new Set(holdings.map((h) => h.itemId));
      const countedSoFar = new Set([...count.lines.map((l) => l.item), ...holdings.filter((h) => checked[h.id]).map((h) => h.itemId)]);
      const nowComplete = allItemIds.size > 0 && Array.from(allItemIds).every((id) => countedSoFar.has(id));
      if (nowComplete && section.count_cadence) {
        try {
          await markSectionCounted(accessToken, section.id);
          onSectionsChanged();
        } catch {
          // Best-effort -- the count itself already saved successfully;
          // a missed schedule bump isn't worth surfacing as an error.
        }
      }
      onSubmitted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save this count sheet.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <button className="back-link" onClick={onBack}>
        ← All sections
      </button>
      <div className="content-head" style={{ marginTop: 8 }}>
        <h2 style={{ margin: 0 }}>{section.name}</h2>
        {/* Two separate controls rather than one bare file input -- relying
            on a mobile browser's own camera/library chooser turned out to be
            unreliable in practice (some browsers only offered the library,
            not the camera, with no `capture` attribute at all). `capture`
            forces the camera directly; a plain input with no `capture`
            reliably opens the photo library/file picker instead -- so one
            button of each guarantees both paths regardless of browser quirks. */}
        <div style={{ display: "flex", gap: 8 }}>
          <label className="btn-ghost small" style={{ cursor: scanning ? "default" : "pointer", opacity: scanning ? 0.6 : 1 }}>
            📷 Take photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              disabled={scanning}
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) handleScanFileSelected(file);
              }}
            />
          </label>
          <label className="btn-ghost small" style={{ cursor: scanning ? "default" : "pointer", opacity: scanning ? 0.6 : 1 }}>
            🖼 Choose photo
            <input
              type="file"
              accept="image/*"
              disabled={scanning}
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) handleScanFileSelected(file);
              }}
            />
          </label>
        </div>
      </div>
      {scanning && (
        <div style={{ textAlign: "center", padding: "12px 0" }}>
          <Loader size="compact" label="Reading the count sheet…" />
        </div>
      )}
      {scanError && <p className="error">{scanError}</p>}
      {unmatchedScanRows.length > 0 && (
        <div className="im-note" style={{ background: "var(--warn-soft)", color: "var(--warn)" }}>
          The photo also had {unmatchedScanRows.length} row{unmatchedScanRows.length === 1 ? "" : "s"} that didn't
          match any item in this section — add these by hand if they're real counts:{" "}
          {unmatchedScanRows.map((r, i) => (
            <span key={i}>
              {i > 0 ? ", " : ""}
              <b>{r.item_text || "(blank)"}</b>
              {r.qty_text ? ` (${r.qty_text})` : ""}
            </span>
          ))}
        </div>
      )}
      <div className="prog-wrap">
        <div className="prog-t">
          <span>Counted</span>
          <b>
            {done} / {holdings.length}
          </b>
        </div>
        <div className="bar-track">
          <div className="bar-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {err && <p className="error">{err}</p>}
      {holdings.length === 0 && <p className="muted">No items assigned to this section.</p>}

      <div className="count-list">
        {holdings.map((h) => {
          const varQty = variance(h);
          const off = varQty !== null && Math.abs(varQty) > 0.001;
          const hasNote = !!(reason[h.id] || note[h.id]);
          const isOpen = openNoteId === h.id;
          const invalid = invalidReason(h);
          const btnCls = hasNote ? "note-btn-sm has" : off ? "note-btn-sm need" : "note-btn-sm";
          const btnTxt = hasNote ? "💬 note" : off ? "+ why?" : "+ note";
          const scanConf = scanConfidence[h.id];
          const lowConfidence = scanConf !== undefined && scanConf !== null && scanConf < 80;
          const pu = primaryUnit(h);
          const others = otherUnits(h);
          const lines = extras[h.id] ?? [];
          const firstText = primaryText(h);
          const totalNum = qty[h.id] === undefined || qty[h.id] === "" ? NaN : Number(qty[h.id]);
          const sumPieces = [
            ...(firstText !== "" && Number.isFinite(Number(firstText)) ? [`${fmtCount(Number(firstText))} ${pu.name}`] : []),
            ...lines
              .filter((e) => e.text !== "" && Number.isFinite(Number(e.text)))
              .map((e) => `${fmtCount(Number(e.text))} ${others.find((o) => o.key === e.unit)?.name ?? ""}`),
          ];
          const showSum = !!checked[h.id] && Number.isFinite(totalNum) && sumPieces.length > 0 && (lines.length > 0 || pu.key !== "base");
          return (
            <div key={h.id} className={`count-row ${checked[h.id] ? "done" : ""}`}>
              <div className="cr-main">
                <input
                  type="checkbox"
                  className="cr-tick"
                  aria-label={`Counted ${h.itemName}`}
                  checked={!!checked[h.id]}
                  onChange={(e) => handleTick(h, e.target.checked)}
                />
                <div className="cr-item">
                  <div className="cr-name">{h.itemName}</div>
                  {(() => {
                    const o = otherSections(h);
                    if (h.placements.length <= 1) {
                      return (
                        <div className="cr-sys">
                          System says {sectionQty(h, onHand[h.id] ?? 0)}
                        </div>
                      );
                    }
                    const total = onHand[h.id] ?? 0;
                    const expected = expectedHere(h);
                    return (
                      <>
                        <div className="cr-sys">
                          {expected === null ? (
                            <>
                              Total on hand {sectionQty(h, total)}
                            </>
                          ) : (
                            <>
                              System expects about {sectionQty(h, Math.max(0, expected))} here
                            </>
                          )}
                        </div>
                        <div className="cr-sys cr-sys-sub">
                          {expected === null
                            ? `${o.unknown.join(" and ")} ${o.unknown.length === 1 ? "hasn't" : "haven't"} been counted yet, so the total can't be checked. Your count is saved, and the total updates once ${o.unknown.length === 1 ? "it has" : "they have"} been counted.`
                            : `${parseFloat(total.toFixed(2))} ${h.baseUnit} in total; ${o.known
                                .map((k) => `${k.name} counted ${parseFloat(k.qty.toFixed(2))} on ${shortDate(k.at)}`)
                                .join(", ")}${expected < 0 ? ". Those counts add up to more than the system total." : ""}`}
                        </div>
                      </>
                    );
                  })()}
                  {lowConfidence && (
                    <span className="badge warn" title="The scan wasn't fully confident reading this handwritten number — double-check it.">
                      ⚠ check scan
                    </span>
                  )}
                </div>
                <div className="cr-counts">
                  <div className="cr-counts-row">
                    <div className="cr-field">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        placeholder="—"
                        aria-label={`Counted in ${pu.name}`}
                        disabled={!checked[h.id]}
                        value={firstText}
                        className={invalid ? "bad" : undefined}
                        onChange={(e) => handlePrimaryChange(h, e.target.value)}
                      />
                      <span className="cr-unit" title={pu.factor !== 1 ? `1 ${pu.name} = ${pu.factor} ${h.baseUnit}` : undefined}>
                        {pu.name}
                      </span>
                    </div>
                    {others.length > 0 && lines.length < others.length && (
                      <button
                        type="button"
                        className="cr-plus"
                        aria-label="Add another unit"
                        title="Add another unit"
                        disabled={!checked[h.id]}
                        onClick={() => addExtraLine(h)}
                      >
                        +
                      </button>
                    )}
                  </div>
                  {lines.map((ex, i) => (
                    <div className="cr-counts-row cr-extra" key={i}>
                      <span className="cr-plus-sign" aria-hidden="true">
                        +
                      </span>
                      <div className="cr-field">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          placeholder="—"
                          aria-label={`Also counted in ${others.find((o) => o.key === ex.unit)?.name ?? "another unit"}`}
                          value={ex.text}
                          onChange={(e) => setExtraLines(h, lines.map((l, j) => (j === i ? { ...l, text: e.target.value } : l)))}
                        />
                        <select
                          className="cr-unit-pick"
                          aria-label="Unit"
                          value={ex.unit}
                          onChange={(e) => setExtraLines(h, lines.map((l, j) => (j === i ? { ...l, unit: e.target.value } : l)))}
                        >
                          {others.map((o) => (
                            <option key={o.key} value={o.key}>
                              {o.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button
                        type="button"
                        className="cr-x"
                        aria-label="Remove this unit"
                        title="Remove"
                        onClick={() => setExtraLines(h, lines.filter((_, j) => j !== i))}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {showSum && (
                    <div className="cr-total" aria-live="polite">
                      {sumPieces.join(" + ")} = {fmtCount(totalNum)} {h.baseUnit}
                    </div>
                  )}
                  {invalid && <div className="cr-warn">⚠ {invalid}</div>}
                  {!invalid && checked[h.id] && h.maxQty !== null && Number(qty[h.id]) > h.maxQty && (
                    <div className="cr-warn" title="Only a warning — the count is saved as entered.">
                      ⚠ More than the {parseFloat(h.maxQty.toFixed(2))} {h.baseUnit}
                      {h.stockUnit ? ` (${inStockUnit(h, h.maxQty)})` : ""} that fits in this section
                    </div>
                  )}
                </div>
                <div className={`cr-var ${varQty === null ? "v-none" : off ? (varQty < 0 ? "v-short" : "v-over") : "v-ok"}`}>
                  {varQty === null ? (
                    "—"
                  ) : !off ? (
                    "✓ matches"
                  ) : (
                    <>
                      <div>
                        {varQty > 0 ? "+" : "−"}
                        {parseFloat(Math.abs(varQty).toFixed(2))} {h.baseUnit}
                      </div>
                      {h.stockUnit && h.stockUnitQty ? (
                        <div className="cr-var-sub">
                          {varQty > 0 ? "+" : "−"}
                          {inStockUnit(h, Math.abs(varQty))}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
                <button type="button" className={btnCls} onClick={() => setOpenNoteId(isOpen ? null : h.id)}>
                  {btnTxt}
                </button>
              </div>
              {hasNote && !isOpen && (
                <div className="note-show">
                  <b>{reason[h.id] ? reasonLabel(reason[h.id]) : "Note"}</b>
                  {note[h.id] ? ` — ${note[h.id]}` : ""}
                </div>
              )}
              {isOpen && (
                <div className="note-panel">
                  <div className="note-h">{off ? `Why is this ${varQty! < 0 ? "short" : "over"} by ${Math.abs(varQty!).toFixed(2)} ${h.baseUnit}?` : "Add a note for this item"}</div>
                  <div className="chip-row" style={{ marginBottom: 8 }}>
                    {REASONS.map((r) => (
                      <button
                        key={r.value}
                        type="button"
                        className={`chip ${reason[h.id] === r.value ? "active" : ""}`}
                        onClick={() => setReason((rs) => ({ ...rs, [h.id]: rs[h.id] === r.value ? "" : r.value }))}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                  <textarea
                    className="note-in"
                    placeholder="Add detail — e.g. 3kg found spoiled at the back, binned"
                    value={note[h.id] ?? ""}
                    onChange={(e) => setNote((n) => ({ ...n, [h.id]: e.target.value }))}
                  />
                  <div className="note-foot">
                    <button type="button" className="btn-ghost small" onClick={() => setOpenNoteId(null)}>
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="modal-actions" style={{ marginTop: 16 }}>
        <button className="btn-ghost" onClick={onBack}>
          Cancel
        </button>
        <button className="btn-primary" onClick={handleSubmit} disabled={saving || done === 0}>
          {saving ? "Saving…" : `Submit ${section.name}`}
        </button>
      </div>
    </div>
  );
}
