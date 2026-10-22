import { formatMoney, currencySymbol, costBand, effectiveTargetPct } from "./api";
import type { ReportsMenuRow, ReportsSummary } from "./api";
import { HBars, KpiTile, Sparkline } from "./ReportCharts";
import type { PillTone } from "./ReportCharts";
import { compareLabel, pct, sectionHeadStyle, signed, signedMoney } from "./reportFormat";

// The presentational pieces of the Reports page, shared by the screen
// itself and by the PDF print sheet (ReportPrintSheet.tsx) so the two can
// never drift apart.

export function ReportTiles({ report, currency, target }: { report: ReportsSummary; currency?: string; target: number }) {
  const prev = report.previous;
  const cmp = compareLabel(report.period);
  const fc = report.food_cost_pct;
  const gp = report.gross_profit_pct;
  const band = costBand(fc, target);
  // A dish essentially never costs £0 to make -- when ingredients have no
  // supplier price on file, a reassuring green "On target" would mislead,
  // so the tiles say the cost is incomplete instead.
  const incomplete = report.zero_cost_items.length > 0;
  const trend = report.trend;

  const salesPill: { text: string; tone: PillTone } =
    prev.net_sales > 0
      ? {
          text: `${signed(((report.net_sales - prev.net_sales) / prev.net_sales) * 100, 1, "%")} ${cmp}`,
          tone: report.net_sales >= prev.net_sales ? "good" : "caution",
        }
      : { text: "Nothing earlier to compare", tone: "muted" };

  const fcPill: { text: string; tone: PillTone } | undefined =
    fc !== null && prev.food_cost_pct !== null
      ? { text: `${signed(fc - prev.food_cost_pct, 1, " pts")} ${cmp}`, tone: fc <= prev.food_cost_pct ? "good" : "caution" }
      : undefined;

  const gpPill: { text: string; tone: PillTone } | undefined =
    gp !== null && prev.gross_profit_pct !== null
      ? { text: `${signed(gp - prev.gross_profit_pct, 1, " pts")} ${cmp}`, tone: gp >= prev.gross_profit_pct ? "good" : "caution" }
      : undefined;

  const wasteDiff = report.waste_cost - prev.waste_cost;
  const wastePill: { text: string; tone: PillTone } =
    prev.waste_cost === 0 && report.waste_cost === 0
      ? { text: "No waste logged", tone: "muted" }
      : { text: `${wasteDiff < 0 ? "−" : "+"}${formatMoney(Math.abs(wasteDiff), currency, 0)} ${cmp}`, tone: wasteDiff <= 0 ? "good" : "caution" };

  const v = report.variance;
  const variancePill: { text: string; tone: PillTone } =
    v < 0 ? { text: "Shrinkage", tone: "caution" } : v > 0 ? { text: "Surplus", tone: "good" } : { text: "No difference found", tone: "muted" };

  return (
    <div className="rp-tiles">
      <KpiTile
        span
        label="Net sales"
        value={formatMoney(report.net_sales, currency, 0)}
        pill={salesPill}
        spark={<Sparkline values={trend.map((t) => t.net_sales)} label="Net sales across the period" />}
      />
      <KpiTile
        label="Food cost"
        value={fc === null ? "—" : `${fc.toFixed(1)}%`}
        valueTone={fc === null ? undefined : incomplete ? "warn" : band === "good" ? "good" : band === "caution" ? "caution" : "danger"}
        pill={incomplete ? { text: "Cost incomplete", tone: "warn" } : fcPill}
        sub={fc === null ? "No sales yet" : `Target ${target}%`}
        spark={<Sparkline values={trend.map((t) => t.food_cost_pct)} label="Food cost % across the period" />}
      />
      <KpiTile
        label="Gross profit"
        value={pct(gp)}
        valueTone={gp !== null && incomplete ? "warn" : undefined}
        pill={incomplete && gp !== null ? { text: "Cost incomplete", tone: "warn" } : gpPill}
        sub="of net sales"
        spark={<Sparkline values={trend.map((t) => t.gross_profit_pct)} label="Gross profit % across the period" />}
      />
      <KpiTile
        label="Waste"
        value={formatMoney(report.waste_cost, currency, 0)}
        pill={wastePill}
        sub={report.waste_pct === null ? "No sales to compare" : `${pct(report.waste_pct)} of sales`}
        spark={<Sparkline tone="caution" values={trend.map((t) => t.waste_cost)} label="Waste cost across the period" />}
      />
      <KpiTile
        label="Stock variance"
        value={signedMoney(v, currency, 0)}
        valueTone={v < 0 ? "danger" : v > 0 ? "good" : undefined}
        pill={variancePill}
        sub={report.net_sales > 0 && v !== 0 ? `${pct((Math.abs(v) / report.net_sales) * 100)} of sales` : "From stock counts"}
        spark={<Sparkline tone="caution" values={trend.map((t) => t.variance)} label="Stock variance across the period" />}
      />
    </div>
  );
}

export function ZeroCostNote({ report }: { report: ReportsSummary }) {
  if (report.zero_cost_items.length === 0) return null;
  return (
    <div className="kpi-note">
      {report.zero_cost_items.length} ingredient{report.zero_cost_items.length === 1 ? "" : "s"} sold this period with no
      supplier price on file — food cost and gross profit are likely understated. Link a supplier in Items to fix this:{" "}
      {report.zero_cost_items.join(", ")}.
    </div>
  );
}

export function WasteCard({ report, currency, wide }: { report: ReportsSummary; currency?: string; wide?: boolean }) {
  const rows = report.waste_by_reason;
  const max = Math.max(...rows.map((r) => r.cost), 0);
  return (
    <section className="card rp-card">
      <div className="rp-card-h">
        <h2 style={sectionHeadStyle}>Waste by reason</h2>
        <span className="rp-card-total">{formatMoney(report.waste_cost, currency, 0)} this period</span>
      </div>
      {rows.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          No waste logged in this period.
        </p>
      ) : (
        <HBars
          tone="caution"
          rows={rows.map((r) => ({
            key: r.reason,
            label: r.label,
            amount: formatMoney(r.cost, currency, 0),
            share: `${r.share_pct.toFixed(0)}%`,
            pct: max ? (r.cost / max) * 100 : 0,
          }))}
        />
      )}
      {wide && rows.length > 0 && report.waste_pct !== null && (
        <p className="rp-hint" style={{ margin: 0 }}>
          That is {pct(report.waste_pct)} of net sales. Waste is read from the Waste log; stock lost at a count shows under Stock variance.
        </p>
      )}
    </section>
  );
}

export function CategoryCard({ report, currency, wide }: { report: ReportsSummary; currency?: string; wide?: boolean }) {
  const rows = report.cost_by_category;
  const total = rows.reduce((s, r) => s + r.cost, 0);
  const max = Math.max(...rows.map((r) => r.cost), 0);
  return (
    <section className="card rp-card">
      <div className="rp-card-h">
        <h2 style={sectionHeadStyle}>Ingredient cost by category</h2>
        <span className="rp-card-total">{formatMoney(total, currency, 0)} this period</span>
      </div>
      {rows.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          Nothing has been used up by sales in this period yet.
        </p>
      ) : (
        <HBars
          tone="brand"
          rows={rows.map((r) => ({
            key: r.category,
            label: r.category,
            amount: formatMoney(r.cost, currency, 0),
            share: `${r.share_pct.toFixed(0)}%`,
            pct: max ? (r.cost / max) * 100 : 0,
          }))}
        />
      )}
      {wide && rows.length > 0 && (
        <p className="rp-hint" style={{ margin: 0 }}>
          This is the cost of the ingredients behind the dishes sold, split by item category. It adds up to the cost in Food cost %.
        </p>
      )}
    </section>
  );
}

export function SplitBar({ report, currency }: { report: ReportsSummary; currency?: string }) {
  const fc = report.food_cost_pct;
  const gp = report.gross_profit_pct;

  return (
    <section className="card rp-card">
      <h2 style={{ ...sectionHeadStyle, marginBottom: 4 }}>Where each {currencySymbol(currency)} of sales went</h2>
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
          <div className="trend-legend" style={{ marginTop: 4 }}>
            <span className="trend-lg-item">
              <i className="sw sw-over" /> Food cost · {pct(fc)}
            </span>
            <span className="trend-lg-item">
              <i className="sw sw-under" /> Gross profit · {pct(gp)}
            </span>
          </div>
          {report.zero_cost_items.length > 0 && (
            <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
              Some ingredient costs are missing this period, so this split leans more green than it really is.
            </p>
          )}
        </>
      )}
    </section>
  );
}

export function BreakEvenCard({ report, currency }: { report: ReportsSummary; currency?: string }) {
  const be = report.break_even;
  const when = report.period === "week" ? "this week" : report.period === "month" ? "this month" : "last month";
  const parts: [string, number | null][] = [
    ["Rent", be.parts.rent],
    ["Labour", be.parts.labour],
    ["Utilities", be.parts.utilities],
    ["Other", be.parts.other],
  ];
  const shown = parts.filter(([, v]) => v !== null && v > 0);
  const need = be.sales_needed_period;
  const covered = need !== null && need > 0 ? Math.min(100, (be.sales_this_period / need) * 100) : 0;
  return (
    <section className="card rp-card">
      <h2 style={{ ...sectionHeadStyle, marginBottom: 4 }}>Break-even on monthly overhead</h2>
      {!be.configured ? (
        <p className="muted" style={{ margin: 0 }}>
          Add your monthly overhead (rent, labour, utilities) in Settings → Locations to see how much you need to sell
          each month to cover it.
        </p>
      ) : be.sales_needed_month === null || need === null ? (
        <p className="muted" style={{ margin: 0 }}>
          Monthly overhead is {formatMoney(be.monthly_overhead ?? 0, currency, 0)}. Break-even needs sales in this
          period to work out your margin; none are recorded yet.
        </p>
      ) : (
        <>
          <div className="be-head">
            <span className="be-big">{formatMoney(be.sales_needed_month, currency, 0)}</span>
            <span className="muted">of sales needed each month to break even</span>
          </div>
          <p className="rp-hint">
            Of every {currencySymbol(currency)}1 you sell, {currencySymbol(currency)}
            {((be.gross_profit_pct ?? 0) / 100).toFixed(2)} is left after ingredients. To cover your{" "}
            {formatMoney(be.monthly_overhead ?? 0, currency, 0)} of monthly overhead you need{" "}
            {formatMoney(be.monthly_overhead ?? 0, currency, 0)} ÷ {((be.gross_profit_pct ?? 0) / 100).toFixed(2)} ={" "}
            {formatMoney(be.sales_needed_month, currency, 0)} in sales.
          </p>
          <div className="be-bar" role="img" aria-label={`Sales ${when} against the break-even amount`}>
            <div className={`be-fill ${covered >= 100 ? "met" : ""}`} style={{ width: `${covered}%` }} />
          </div>
          <div className="be-line">
            <span>
              Sales {when}: <b>{formatMoney(be.sales_this_period, currency, 0)}</b>
            </span>
            <span>
              Needed {when}: <b>{formatMoney(need, currency, 0)}</b>
              {be.sales_this_period >= need ? " · covered" : ""}
            </span>
          </div>
          <p className={`be-result ${covered >= 100 ? "good" : "short"}`}>
            {be.sales_this_period >= need
              ? `${formatMoney(((be.sales_this_period - need) * (be.gross_profit_pct ?? 0)) / 100, currency, 0)} left ${when} after ingredients and monthly overhead.`
              : `${formatMoney(need - be.sales_this_period, currency, 0)} more in sales needed ${when} to break even.`}
          </p>
          {shown.length > 0 && (
            <p className="rp-hint">
              Monthly overhead: {shown.map(([k, v]) => `${k} ${formatMoney(v ?? 0, currency, 0)}`).join(" · ")}
            </p>
          )}
          {be.partial && (
            <p className="rp-hint">Some of these locations have no overhead set, so the amount needed is likely higher.</p>
          )}
          {report.zero_cost_items.length > 0 && (
            <p className="rp-hint">Some ingredient costs are missing, so the real amount needed is likely higher.</p>
          )}
        </>
      )}
    </section>
  );
}

export function MenuTable({
  rows,
  currency,
  foodTarget,
  drinkTarget,
}: {
  rows: ReportsMenuRow[];
  currency?: string;
  foodTarget: number;
  drinkTarget: number;
}) {
  return (
    <section className="card rp-card">
      <h2 style={{ ...sectionHeadStyle, marginBottom: 4 }}>Menu performance</h2>
      {rows.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          No dishes sold in this period yet.
        </p>
      ) : (
        <div className="table-scroll">
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
              {rows.map((r) => {
                const rowTarget = effectiveTargetPct(r.target_cost_pct, r.menu_group === "drink" ? drinkTarget : foodTarget);
                const rowBand = costBand(r.food_cost_pct, rowTarget);
                const rowBadgeClass = rowBand === "good" ? "b-ok" : rowBand === "caution" ? "b-low" : "b-bad";
                return (
                  <tr key={r.recipe_id}>
                    <td className="dish">{r.name}</td>
                    <td className="num">{r.qty}</td>
                    <td className="num">
                      {r.food_cost_pct === null ? (
                        "—"
                      ) : r.food_cost_pct === 0 ? (
                        // A flat 0.0% almost always means an ingredient had no
                        // supplier price on file, not that margin is perfect.
                        <span
                          className="badge warn"
                          title="Likely incomplete — a real dish essentially never costs £0 to make. Check this recipe's ingredients for one with no supplier price on file."
                        >
                          0.0%*
                        </span>
                      ) : (
                        <span className={`badge ${rowBadgeClass}`} title={`Target: ${rowTarget}% (${r.menu_group})`}>
                          {r.food_cost_pct.toFixed(1)}%
                        </span>
                      )}
                    </td>
                    <td className="num">{formatMoney(r.gp_per_unit, currency, 2)}</td>
                    <td className="num">{formatMoney(r.gp_contribution, currency, 2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
