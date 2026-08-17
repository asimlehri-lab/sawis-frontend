import { useEffect, useState } from "react";
import { fetchReportsSummary } from "./api";
import type { Location, ReportsMenuRow, ReportsSummary } from "./api";

interface Props {
  accessToken: string;
  locations: Location[];
}

const TARGET_FC = 30;

const gbp = (n: number, d = 0) =>
  `£${n.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d })}`;

function pct(n: number | null, d = 1) {
  return n === null ? "—" : `${n.toFixed(d)}%`;
}

const sectionHeadStyle: React.CSSProperties = {
  fontSize: 13,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--muted)",
  fontWeight: 700,
  margin: 0,
};

export default function Reports({ accessToken, locations }: Props) {
  const [location, setLocation] = useState(locations[0]?.id ?? "");
  const [period, setPeriod] = useState<"week" | "month" | "lastmonth">("week");
  const [report, setReport] = useState<ReportsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trendAsTable, setTrendAsTable] = useState(false);

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

  if (!locations.length) {
    return <p className="error">No locations yet — add one before there's anything to report on.</p>;
  }

  return (
    <div>
      <div className="eod-toolbar">
        {locations.length > 1 && (
          <select value={location} onChange={(e) => setLocation(e.target.value)}>
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
        {report && (
          <button className="btn-primary small" style={{ marginLeft: "auto" }} onClick={() => exportMenuCsv(report)}>
            Export CSV
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}
      {loading && !report && <p className="muted">Loading…</p>}

      {report && (
        <>
          <div className="muted" style={{ marginTop: -6, marginBottom: 16, fontSize: 11.5 }}>
            {report.range.start} – {report.range.end}
          </div>
          <RptKpis report={report} />
          <TrendChart report={report} asTable={trendAsTable} setAsTable={setTrendAsTable} />
          <SplitBar report={report} />
          <MenuTable rows={report.menu} />
        </>
      )}
    </div>
  );
}

function RptKpis({ report }: { report: ReportsSummary }) {
  const fc = report.food_cost_pct;
  const fcOver = fc !== null && fc > TARGET_FC;
  const gp = report.gross_profit_pct;
  const wastePct = report.waste_pct;
  const variance = report.variance;
  // A real dish essentially never costs £0 to make — if food cost is
  // driven to (near) zero because ingredients had no supplier price on
  // file, showing a reassuring green "On target" tag would actively
  // mislead rather than just be incomplete. Same honesty pattern as the
  // zero_cost_items note itself, just extended to the tag/color, not only
  // the footnote underneath it.
  const hasZeroCostItems = report.zero_cost_items.length > 0;

  return (
    <>
      <div className="kpi-grid kpi-grid-5">
        <div className="kpi-card">
          <div className="kpi-label">Net sales</div>
          <div className="kpi-value">{gbp(report.net_sales)}</div>
          <div className="kpi-sub">this period</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Food cost</div>
          {fc === null ? (
            <div className="kv-empty">No sales yet</div>
          ) : (
            <>
              <div className="kpi-value" style={{ color: hasZeroCostItems ? "#8A6410" : fcOver ? "#C2611D" : "#1D6B4F" }}>
                {fc.toFixed(1)}%
              </div>
              <div className="kpi-sub">
                {hasZeroCostItems ? (
                  <span className="tag warn">Cost incomplete</span>
                ) : (
                  <span className={`tag ${fcOver ? "bad" : "good"}`}>{fcOver ? "Over target" : "On target"}</span>
                )}{" "}
                · target 30%
              </div>
            </>
          )}
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Gross profit</div>
          <div className="kpi-value" style={{ color: gp !== null ? (hasZeroCostItems ? "#8A6410" : "#1D6B4F") : undefined }}>
            {pct(gp)}
          </div>
          <div className="kpi-sub">{hasZeroCostItems ? "incomplete — see note below" : "of net sales"}</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Waste</div>
          <div className="kpi-value">{pct(wastePct)}</div>
          <div className="kpi-sub">{wastePct === null ? "no sales to compare" : `${gbp(report.waste_cost, 2)} of sales`}</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Stock variance</div>
          <div className="kpi-value" style={{ color: variance < 0 ? "#A33636" : variance > 0 ? "#1D6B4F" : undefined }}>
            {gbp(variance, 2)}
          </div>
          <div className="kpi-sub">
            {variance < 0 ? "shrinkage vs counts" : variance > 0 ? "surplus vs counts" : "no counts logged, or matched exactly"}
          </div>
        </div>
      </div>

      {report.zero_cost_items.length > 0 && (
        <div className="kpi-note">
          {report.zero_cost_items.length} ingredient{report.zero_cost_items.length === 1 ? "" : "s"} sold this period
          with no supplier price on file — food cost and gross profit are likely understated. Link a supplier in
          Items to fix this: {report.zero_cost_items.join(", ")}.
        </div>
      )}
    </>
  );
}

function TrendChart({
  report,
  asTable,
  setAsTable,
}: {
  report: ReportsSummary;
  asTable: boolean;
  setAsTable: (v: boolean) => void;
}) {
  const values = report.trend.map((t) => t.food_cost_pct).filter((v): v is number => v !== null);
  const hasData = values.length > 0;
  const scaleMax = Math.ceil(Math.max(TARGET_FC + 10, ...(hasData ? values : [0])) / 10) * 10;
  const tgtBottomPct = (TARGET_FC / scaleMax) * 100;

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div className="cmp-h">
        <h2 style={sectionHeadStyle}>Food cost % trend</h2>
        {hasData && (
          <button className="open-link" onClick={() => setAsTable(!asTable)}>
            {asTable ? "View as chart" : "View as table"}
          </button>
        )}
      </div>

      {!hasData ? (
        <p className="muted" style={{ margin: 0 }}>
          No sales recorded in this period yet.
        </p>
      ) : asTable ? (
        <table className="tbl" style={{ marginTop: 4 }}>
          <thead>
            <tr>
              <th>Period</th>
              <th className="num">Food cost %</th>
            </tr>
          </thead>
          <tbody>
            {report.trend.map((t) => (
              <tr key={t.label}>
                <td>{t.label}</td>
                <td className="num">{pct(t.food_cost_pct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <>
          <div className="trend-chart">
            <div className="trend-tgtline" style={{ bottom: `${tgtBottomPct}%` }} />
            {report.trend.map((t) => (
              <div className="trend-bar-col" key={t.label}>
                {t.food_cost_pct !== null ? (
                  <div
                    className={`trend-bar ${t.food_cost_pct > TARGET_FC ? "over" : "under"}`}
                    style={{ height: `${Math.max((t.food_cost_pct / scaleMax) * 100, 2)}%` }}
                    title={`${t.label}: ${t.food_cost_pct.toFixed(1)}%`}
                  />
                ) : (
                  <div className="trend-bar empty" title={`${t.label}: no sales`} />
                )}
              </div>
            ))}
          </div>
          <div className="trend-labels">
            {report.trend.map((t) => (
              <span key={t.label}>{t.label}</span>
            ))}
          </div>
          <div className="trend-legend">
            <span className="trend-lg-item">
              <i className="sw sw-under" /> On target (≤30%)
            </span>
            <span className="trend-lg-item">
              <i className="sw sw-over" /> Over target
            </span>
            <span className="trend-lg-item">
              <i className="sw sw-tgt" /> 30% target
            </span>
          </div>
        </>
      )}
    </section>
  );
}

function SplitBar({ report }: { report: ReportsSummary }) {
  const fc = report.food_cost_pct;
  const gp = report.gross_profit_pct;

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2 style={{ ...sectionHeadStyle, marginBottom: 12 }}>Where each £ of sales went</h2>
      {fc === null || gp === null ? (
        <p className="muted" style={{ margin: 0 }}>
          No sales recorded in this period yet.
        </p>
      ) : (
        <>
          <div className="split-bar">
            <div className="split-fc" style={{ width: `${fc}%` }} title={`Food cost: ${fc.toFixed(1)}%`} />
            <div className="split-gp" style={{ width: `${gp}%` }} title={`Gross profit: ${gp.toFixed(1)}%`} />
          </div>
          <div className="trend-legend" style={{ marginTop: 12 }}>
            <span className="trend-lg-item">
              <i className="sw sw-over" /> Food cost · {pct(fc)}
            </span>
            <span className="trend-lg-item">
              <i className="sw sw-under" /> Gross profit · {pct(gp)}
            </span>
          </div>
          {report.zero_cost_items.length > 0 && (
            <p className="muted" style={{ marginTop: 10, marginBottom: 0, fontSize: 11.5 }}>
              Some ingredient costs are missing this period, so this split leans more green than it really is — see
              the note above the trend chart.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function MenuTable({ rows }: { rows: ReportsMenuRow[] }) {
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2 style={{ ...sectionHeadStyle, marginBottom: 12 }}>Menu performance</h2>
      {rows.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          No dishes sold in this period yet.
        </p>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Dish</th>
              <th className="num">Sold</th>
              <th className="num">Food cost</th>
              <th className="num">GP / dish</th>
              <th className="num">GP contribution</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.recipe_id}>
                <td className="dish">{r.name}</td>
                <td className="num">{r.qty}</td>
                <td className="num">
                  {r.food_cost_pct === null ? (
                    "—"
                  ) : r.food_cost_pct === 0 ? (
                    // A dish with real ingredients essentially never costs
                    // literally £0 to make — a flat 0.0% almost always means
                    // an ingredient had no supplier price on file, not that
                    // margin is perfect. Flag it rather than badge it green.
                    <span
                      className="badge warn"
                      title="Likely incomplete — a real dish essentially never costs £0 to make. Check this recipe's ingredients for one with no supplier price on file."
                    >
                      0.0%*
                    </span>
                  ) : (
                    <span className={`badge ${r.food_cost_pct > TARGET_FC ? "b-low" : "b-ok"}`}>
                      {r.food_cost_pct.toFixed(1)}%
                    </span>
                  )}
                </td>
                <td className="num">{gbp(r.gp_per_unit, 2)}</td>
                <td className="num">{gbp(r.gp_contribution, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// Real client-side export (the reference mockup's "Export" button is a fake
// toast with no actual file) — builds the CSV straight from the same data
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
