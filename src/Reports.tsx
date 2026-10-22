import { useEffect, useRef, useState } from "react";
import { fetchReportsAll, fetchReportsSummary } from "./api";
import type { Location, ReportsAll, ReportsLocationRow, ReportsSummary } from "./api";
import LocationTabs from "./LocationTabs";
import { ALL_LOCATIONS, blendedTarget, currencyBlockTitle } from "./locationScope";
import { PickLocationPrompt, ReportsByLocation, UnitsSoldCard } from "./AllLocationsParts";
import PasswordConfirmModal from "./PasswordConfirmModal";
import ReportPdfModal from "./ReportPdfModal";
import type { PdfSections } from "./ReportPdfModal";
import ReportPrintSheet from "./ReportPrintSheet";
import { FoodCostBars } from "./ReportCharts";
import MenuEngineering from "./MenuEngineering";
import { BreakEvenCard, CategoryCard, MenuTable, ReportTiles, SplitBar, WasteCard, ZeroCostNote } from "./ReportParts";
import { sectionHeadStyle } from "./reportFormat";
import { addDays, addMonths, monthEndOf, monthLabel, monthStartOf, mondayOf, todayIso, weekLabel } from "./reportPeriod";

interface Props {
  accessToken: string;
  locations: Location[];
  isAdmin: boolean;
  // Managers who can look at several locations get an All tab.
  canSeeAll?: boolean;
  // Menu engineering's "Open recipe" jumps to the dish; coming back lands on that tab.
  initialTab?: "overview" | "menu" | "waste" | "category";
  onOpenRecipe?: (id: string) => void;
}

type Tab = "overview" | "menu" | "waste" | "category";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "menu", label: "Menu map" },
  { key: "waste", label: "Waste" },
  { key: "category", label: "Cost by category" },
];

const COMPARED_WITH: Record<ReportsSummary["period"], string> = {
  week: "the 7 days before",
  month: "the month before (the same number of days, while this month is still going)",
  lastmonth: "the month before",
};

const PERIOD_TITLE: Record<ReportsSummary["period"], string> = {
  week: "Weekly report",
  month: "Monthly report",
  lastmonth: "Monthly report",
};

// One screenful of report: a single location, or one currency's worth of
// locations added up (All).
interface Block {
  key: string;
  title: string | null;
  report: ReportsSummary;
  currency?: string;
  foodTarget: number;
  drinkTarget: number;
  rows: ReportsLocationRow[] | null;
}

export default function Reports({ accessToken, locations, isAdmin, canSeeAll, initialTab, onOpenRecipe }: Props) {
  const [location, setLocation] = useState(locations[0]?.id ?? "");
  // CSV export and PDF download are restricted to admins and gated behind a
  // password re-confirmation (see PasswordConfirmModal / ReportPdfModal) --
  // this report includes per-dish cost and margin data.
  const [confirmingExport, setConfirmingExport] = useState(false);
  const [choosingPdf, setChoosingPdf] = useState(false);
  const [printing, setPrinting] = useState<PdfSections | null>(null);
  const isAll = location === ALL_LOCATIONS;
  const currency = locations.find((l) => l.id === location)?.currency;
  // This location's own food/drink-cost-% targets (Settings > Locations),
  // defaulting to 30 if this location somehow has neither set. The
  // report's single top-line food-cost % blends food+drink sales
  // together, so it compares against the food target as a reference line
  // -- only the per-dish table (which knows each row's own menu_group)
  // actually splits food vs drink.
  const activeLocation = locations.find((l) => l.id === location);
  const foodTarget = activeLocation ? Number(activeLocation.target_food_cost_pct) || 30 : 30;
  const drinkTarget = activeLocation ? Number(activeLocation.target_drink_cost_pct) || 30 : 30;
  // Which week or month is on screen. null means "now": the last 7 days, or
  // the month so far. A chosen week is Monday to Sunday; a chosen month is a
  // whole calendar month.
  const [mode, setMode] = useState<"week" | "month">("week");
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [monthStart, setMonthStart] = useState<string | null>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const today = todayIso();
  const curMonday = mondayOf(today);
  const curMonth = monthStartOf(today);
  const period: "week" | "month" = mode;
  const reqDate = mode === "week" ? (weekStart ? addDays(weekStart, 6) : undefined) : monthStart ? monthEndOf(monthStart) : undefined;
  const reqKey = `${location}-${period}-${reqDate ?? "now"}`;
  const atNow = mode === "week" ? weekStart === null : monthStart === null;
  const shownStart = mode === "week" ? (weekStart ?? curMonday) : (monthStart ?? curMonth);
  const periodLabel =
    mode === "week" ? (weekStart ? weekLabel(weekStart) : "Last 7 days") : monthStart ? monthLabel(monthStart) : `${monthLabel(curMonth)} so far`;
  const unit = mode === "week" ? "week" : "month";

  function step(dir: -1 | 1) {
    if (mode === "week") {
      const n = addDays(shownStart, dir * 7);
      setWeekStart(n >= curMonday ? null : n);
    } else {
      const n = addMonths(shownStart, dir);
      setMonthStart(n >= curMonth ? null : n);
    }
  }

  function jumpTo(v: string) {
    if (!v) return;
    if (mode === "week") {
      const m = mondayOf(v);
      setWeekStart(m >= curMonday ? null : m);
    } else {
      const ms = monthStartOf(v);
      setMonthStart(ms >= curMonth ? null : ms);
    }
  }

  function openCalendar() {
    const el = dateRef.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
      el.click();
    }
  }
  const [tab, setTab] = useState<Tab>(initialTab ?? "overview");
  const [report, setReport] = useState<ReportsSummary | null>(null);
  const [allData, setAllData] = useState<ReportsAll | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!location && locations[0]) setLocation(locations[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations]);

  useEffect(() => {
    if (!location) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const request =
      location === ALL_LOCATIONS
        ? fetchReportsAll(accessToken, period, reqDate).then((data) => {
            if (!cancelled) {
              setAllData(data);
              setReport(null);
            }
          })
        : fetchReportsSummary(accessToken, location, period, reqDate).then((data) => {
            if (!cancelled) {
              setReport(data);
              setAllData(null);
            }
          });
    request
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load reports.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, location, period, reqDate]);

  // What is on screen as blocks: the one report, or one block per currency
  // under All (euro locations and pound locations are never added together).
  const groups = isAll && allData ? allData.groups : [];
  const blocks: Block[] =
    isAll && allData
      ? groups.map((g) => ({
          key: g.currency,
          title: groups.length > 1 ? currencyBlockTitle(g.currency, g.location_names) : null,
          report: g.report,
          currency: g.currency,
          foodTarget: blendedTarget(g.by_location, locations, "food"),
          drinkTarget: blendedTarget(g.by_location, locations, "drink"),
          rows: g.by_location,
        }))
      : !isAll && report
      ? [{ key: location, title: null, report, currency, foodTarget, drinkTarget, rows: null }]
      : [];
  // Export and print work on one report at a time: a location, or All when
  // every location uses one currency.
  const printable: Block | null = blocks.length === 1 ? blocks[0] : null;
  const venueName = isAll ? "All locations" : activeLocation?.name ?? "";
  const headRange = blocks[0]?.report.range ?? null;
  const headPeriod = blocks[0]?.report.period ?? null;

  // Printing: the sheet is mounted first (setPrinting), then the browser's
  // print window opens once it has rendered, and the sheet is removed again
  // when that window closes. The page title becomes the suggested PDF file
  // name for the moment it is open.
  useEffect(() => {
    if (!printing || !printable) return;
    const previousTitle = document.title;
    document.title = `SAWIS report ${printable.report.range.start} to ${printable.report.range.end}`;
    const done = () => {
      document.title = previousTitle;
      setPrinting(null);
    };
    window.addEventListener("afterprint", done, { once: true });
    const t = window.setTimeout(() => window.print(), 250);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("afterprint", done);
      document.title = previousTitle;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printing, report, allData]);

  if (!locations.length) {
    return <p className="error">No locations yet — add one before there's anything to report on.</p>;
  }

  return (
    <div className="rp-page">
      <LocationTabs locations={locations} value={location} onChange={setLocation} allowAll={canSeeAll} />
      <div className="eod-toolbar">
        <div className="rtabs" style={{ marginBottom: 0 }} role="group" aria-label="Weekly or monthly report">
          <button className={`rtab ${mode === "week" ? "on" : ""}`} aria-pressed={mode === "week"} onClick={() => setMode("week")}>
            Week
          </button>
          <button className={`rtab ${mode === "month" ? "on" : ""}`} aria-pressed={mode === "month"} onClick={() => setMode("month")}>
            Month
          </button>
        </div>
        <div className="rp-nav">
          <button type="button" className="rp-nav-btn" aria-label={`Previous ${unit}`} onClick={() => step(-1)}>
            ‹
          </button>
          <div className="rp-nav-pick">
            <button type="button" className="rp-nav-label" onClick={openCalendar} aria-label={`${periodLabel}. Choose another ${unit} from the calendar`}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
                <path d="M3.5 10h17M8 3v4M16 3v4" />
              </svg>
              {periodLabel}
            </button>
            <input
              ref={dateRef}
              type="date"
              className="rp-date-input"
              tabIndex={-1}
              value={shownStart}
              max={today}
              aria-label={`Pick any day in the ${unit} you want`}
              onChange={(e) => jumpTo(e.target.value)}
            />
          </div>
          <button type="button" className="rp-nav-btn" aria-label={`Next ${unit}`} disabled={atNow} onClick={() => step(1)}>
            ›
          </button>
          {!atNow && (
            <button type="button" className="open-link" onClick={() => (mode === "week" ? setWeekStart(null) : setMonthStart(null))}>
              {mode === "week" ? "Back to last 7 days" : "Back to this month"}
            </button>
          )}
        </div>
        {printable && isAdmin && (
          <div className="rp-actions">
            <button className="btn-ghost small" onClick={() => setConfirmingExport(true)}>
              Export CSV
            </button>
            <button className="btn-primary small" onClick={() => setChoosingPdf(true)}>
              Download PDF
            </button>
          </div>
        )}
      </div>

      {confirmingExport && printable && (
        <PasswordConfirmModal
          accessToken={accessToken}
          title="Confirm your password"
          description="This exports the menu performance report, including per-dish cost and margin figures. Re-enter your password to continue."
          onConfirmed={() => {
            setConfirmingExport(false);
            exportMenuCsv(printable.report, venueName);
          }}
          onClose={() => setConfirmingExport(false)}
        />
      )}
      {choosingPdf && printable && (
        <ReportPdfModal
          accessToken={accessToken}
          context={`${venueName || "This location"} · ${periodLabel}.`}
          onConfirmed={(sections) => {
            setChoosingPdf(false);
            setPrinting(sections);
          }}
          onClose={() => setChoosingPdf(false)}
        />
      )}
      {printing && printable && (
        <ReportPrintSheet
          report={printable.report}
          currency={printable.currency}
          venue={venueName}
          title={PERIOD_TITLE[printable.report.period]}
          sections={printing}
          target={printable.foodTarget}
          foodTarget={printable.foodTarget}
          drinkTarget={printable.drinkTarget}
        />
      )}

      {error && <p className="error">{error}</p>}
      {loading && blocks.length === 0 && <p className="muted">Loading…</p>}

      {blocks.length > 0 && headRange && headPeriod && (
        <>
          <div className="rp-range">
            {headRange.start} – {headRange.end} · compared with {COMPARED_WITH[headPeriod]}
          </div>
          <div className="rp-tabs" role="tablist" aria-label="Report sections">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                className={`rp-tab ${tab === t.key ? "on" : ""}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "overview" &&
            blocks.map((b) => (
              <div key={b.key} className="lblock">
                {b.title && <h2 className="lblock-h">{b.title}</h2>}
                <div className="rp-stack">
                  <ReportTiles report={b.report} currency={b.currency} target={b.foodTarget} />
                  <ZeroCostNote report={b.report} />
                  {b.rows && <ReportsByLocation kind="overview" rows={b.rows} currency={b.currency ?? ""} locations={locations} />}
                  <section className="card rp-card">
                    <h2 style={sectionHeadStyle}>Food cost % by {b.report.period === "week" ? "day" : "week"}</h2>
                    {b.report.trend.every((t) => t.food_cost_pct === null) ? (
                      <p className="muted" style={{ margin: 0 }}>
                        No sales recorded in this period yet.
                      </p>
                    ) : (
                      <FoodCostBars key={`${reqKey}-${b.key}`} trend={b.report.trend} target={b.foodTarget} currency={b.currency} />
                    )}
                  </section>
                  <SplitBar report={b.report} currency={b.currency} />
                  <BreakEvenCard report={b.report} currency={b.currency} />
                  <div className="rp-two">
                    <WasteCard report={b.report} currency={b.currency} />
                    <CategoryCard report={b.report} currency={b.currency} />
                  </div>
                </div>
              </div>
            ))}

          {tab === "menu" &&
            (isAll && blocks.length > 1 && allData ? (
              <div className="rp-stack">
                <PickLocationPrompt
                  title="Revenue and profit per dish need one currency"
                  text="Your locations use different currencies, so revenue and profit per dish cannot be added up. Pick a location to see the map with real profit figures."
                  locations={locations}
                  onPick={setLocation}
                />
                <UnitsSoldCard units={allData.menu_units} />
              </div>
            ) : (
              blocks.map((b) => (
                <div key={b.key} className="rp-stack">
                  <section className="card rp-card">
                    <h2 style={sectionHeadStyle}>Which dishes earn their place</h2>
                    <MenuEngineering key={`${reqKey}-${b.key}`} rows={b.report.menu} currency={b.currency} onOpenRecipe={onOpenRecipe} />
                  </section>
                  <MenuTable rows={b.report.menu} currency={b.currency} foodTarget={b.foodTarget} drinkTarget={b.drinkTarget} />
                </div>
              ))
            ))}

          {tab === "waste" &&
            blocks.map((b) => (
              <div key={b.key} className="lblock">
                {b.title && <h2 className="lblock-h">{b.title}</h2>}
                <div className="rp-stack">
                  <WasteCard report={b.report} currency={b.currency} wide />
                  {b.rows && <ReportsByLocation kind="waste" rows={b.rows} currency={b.currency ?? ""} locations={locations} />}
                </div>
              </div>
            ))}

          {tab === "category" &&
            blocks.map((b) => (
              <div key={b.key} className="lblock">
                {b.title && <h2 className="lblock-h">{b.title}</h2>}
                <div className="rp-stack">
                  <CategoryCard report={b.report} currency={b.currency} wide />
                  {b.rows && <ReportsByLocation kind="category" rows={b.rows} currency={b.currency ?? ""} locations={locations} />}
                </div>
              </div>
            ))}
        </>
      )}
    </div>
  );
}

// Real client-side export -- builds the CSV straight from the same data
// already on screen, no extra request or library.
function exportMenuCsv(report: ReportsSummary, venue = "") {
  const header = ["Dish", "Sold", "Revenue", "Cost", "Food cost %", "GP per dish", "GP contribution"];
  const lines = report.menu.map((r) => [
    r.name,
    String(r.qty),
    r.revenue.toFixed(2),
    r.cost.toFixed(2),
    r.food_cost_pct !== null ? r.food_cost_pct.toFixed(1) : "",
    r.gp_per_unit.toFixed(2),
    r.gp_contribution.toFixed(2),
  ]);
  const csv = [header, ...lines]
    .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `menu-performance${venue === "All locations" ? "_all-locations" : ""}_${report.range.start}_to_${report.range.end}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
