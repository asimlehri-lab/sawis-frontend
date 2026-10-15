import { useEffect, useState } from "react";
import { fetchReportsSummary } from "./api";
import type { Location, ReportsSummary } from "./api";
import PasswordConfirmModal from "./PasswordConfirmModal";
import ReportPdfModal from "./ReportPdfModal";
import type { PdfSections } from "./ReportPdfModal";
import ReportPrintSheet from "./ReportPrintSheet";
import { FoodCostBars } from "./ReportCharts";
import MenuEngineering from "./MenuEngineering";
import { CategoryCard, MenuTable, ReportTiles, SplitBar, WasteCard, ZeroCostNote } from "./ReportParts";
import { sectionHeadStyle } from "./reportFormat";

interface Props {
  accessToken: string;
  locations: Location[];
  isAdmin: boolean;
}

type Tab = "overview" | "menu" | "waste" | "category";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "menu", label: "Menu engineering" },
  { key: "waste", label: "Waste" },
  { key: "category", label: "Cost by category" },
];

const COMPARED_WITH: Record<ReportsSummary["period"], string> = {
  week: "the 7 days before",
  month: "the same days last month",
  lastmonth: "the month before",
};

const PERIOD_TITLE: Record<ReportsSummary["period"], string> = {
  week: "Weekly report",
  month: "Monthly report",
  lastmonth: "Monthly report",
};

export default function Reports({ accessToken, locations, isAdmin }: Props) {
  const [location, setLocation] = useState(locations[0]?.id ?? "");
  // CSV export and PDF download are restricted to admins and gated behind a
  // password re-confirmation (see PasswordConfirmModal / ReportPdfModal) --
  // this report includes per-dish cost and margin data.
  const [confirmingExport, setConfirmingExport] = useState(false);
  const [choosingPdf, setChoosingPdf] = useState(false);
  const [printing, setPrinting] = useState<PdfSections | null>(null);
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
  const [period, setPeriod] = useState<"week" | "month" | "lastmonth">("week");
  const [tab, setTab] = useState<Tab>("overview");
  const [report, setReport] = useState<ReportsSummary | null>(null);
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
    fetchReportsSummary(accessToken, location, period)
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load reports.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, location, period]);

  // Printing: the sheet is mounted first (setPrinting), then the browser's
  // print window opens once it has rendered, and the sheet is removed again
  // when that window closes. The page title becomes the suggested PDF file
  // name for the moment it is open.
  useEffect(() => {
    if (!printing || !report) return;
    const previousTitle = document.title;
    document.title = `SAWIS report ${report.range.start} to ${report.range.end}`;
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
  }, [printing, report]);

  if (!locations.length) {
    return <p className="error">No locations yet — add one before there's anything to report on.</p>;
  }

  const periodName = period === "week" ? "the last 7 days" : period === "month" ? "this month" : "last month";

  return (
    <div className="rp-page">
      <div className="eod-toolbar">
        {locations.length > 1 && (
          <select value={location} onChange={(e) => setLocation(e.target.value)} aria-label="Location">
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        <div className="rtabs" style={{ marginBottom: 0 }}>
          <button className={`rtab ${period === "week" ? "on" : ""}`} onClick={() => setPeriod("week")}>
            This week
          </button>
          <button className={`rtab ${period === "month" ? "on" : ""}`} onClick={() => setPeriod("month")}>
            This month
          </button>
          <button className={`rtab ${period === "lastmonth" ? "on" : ""}`} onClick={() => setPeriod("lastmonth")}>
            Last month
          </button>
        </div>
        {report && isAdmin && (
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

      {confirmingExport && report && (
        <PasswordConfirmModal
          accessToken={accessToken}
          title="Confirm your password"
          description="This exports the menu performance report, including per-dish cost and margin figures. Re-enter your password to continue."
          onConfirmed={() => {
            setConfirmingExport(false);
            exportMenuCsv(report);
          }}
          onClose={() => setConfirmingExport(false)}
        />
      )}
      {choosingPdf && report && (
        <ReportPdfModal
          accessToken={accessToken}
          context={`${activeLocation?.name ?? "This location"} · ${periodName}.`}
          onConfirmed={(sections) => {
            setChoosingPdf(false);
            setPrinting(sections);
          }}
          onClose={() => setChoosingPdf(false)}
        />
      )}
      {printing && report && (
        <ReportPrintSheet
          report={report}
          currency={currency}
          venue={activeLocation?.name ?? ""}
          title={PERIOD_TITLE[report.period]}
          sections={printing}
          target={foodTarget}
          foodTarget={foodTarget}
          drinkTarget={drinkTarget}
        />
      )}

      {error && <p className="error">{error}</p>}
      {loading && !report && <p className="muted">Loading…</p>}

      {report && (
        <>
          <div className="rp-range">
            {report.range.start} – {report.range.end} · compared with {COMPARED_WITH[report.period]}
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

          {tab === "overview" && (
            <div className="rp-stack">
              <ReportTiles report={report} currency={currency} target={foodTarget} />
              <ZeroCostNote report={report} />
              <section className="card rp-card">
                <h2 style={sectionHeadStyle}>Food cost % by {report.period === "week" ? "day" : "week"}</h2>
                {report.trend.every((t) => t.food_cost_pct === null) ? (
                  <p className="muted" style={{ margin: 0 }}>
                    No sales recorded in this period yet.
                  </p>
                ) : (
                  <FoodCostBars key={`${location}-${period}`} trend={report.trend} target={foodTarget} currency={currency} />
                )}
              </section>
              <SplitBar report={report} currency={currency} />
              <div className="rp-two">
                <WasteCard report={report} currency={currency} />
                <CategoryCard report={report} currency={currency} />
              </div>
            </div>
          )}

          {tab === "menu" && (
            <div className="rp-stack">
              <section className="card rp-card">
                <h2 style={sectionHeadStyle}>Which dishes earn their place</h2>
                <MenuEngineering key={`${location}-${period}`} rows={report.menu} currency={currency} />
              </section>
              <MenuTable rows={report.menu} currency={currency} foodTarget={foodTarget} drinkTarget={drinkTarget} />
            </div>
          )}

          {tab === "waste" && (
            <div className="rp-stack">
              <WasteCard report={report} currency={currency} wide />
            </div>
          )}

          {tab === "category" && (
            <div className="rp-stack">
              <CategoryCard report={report} currency={currency} wide />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Real client-side export -- builds the CSV straight from the same data
// already on screen, no extra request or library.
function exportMenuCsv(report: ReportsSummary) {
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
  a.download = `menu-performance_${report.range.start}_to_${report.range.end}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
