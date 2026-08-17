import { useEffect, useState } from "react";
import { fetchEodReport } from "./api";
import type { EodChampionEntry, EodReport as EodReportData, Location } from "./api";

interface Props {
  accessToken: string;
  locations: Location[];
}

const PERIOD_LABEL: Record<string, string> = {
  today: "yesterday",
  week: "the previous week",
  month: "the previous month",
};

const gbp = (n: number, d = 0) =>
  `£${n.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d })}`;

function pct(n: number | null, d = 1) {
  return n === null ? "—" : `${n.toFixed(d)}%`;
}

export default function EodReport({ accessToken, locations }: Props) {
  const [location, setLocation] = useState(locations[0]?.id ?? "");
  const [period, setPeriod] = useState<"today" | "week" | "month">("today");
  const [champKind, setChampKind] = useState<"food" | "drink">("food");
  const [report, setReport] = useState<EodReportData | null>(null);
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
    fetchEodReport(accessToken, location, period)
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the report.");
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
          <button className={`rtab ${period === "today" ? "on" : ""}`} onClick={() => setPeriod("today")}>
            Today
          </button>
          <button className={`rtab ${period === "week" ? "on" : ""}`} onClick={() => setPeriod("week")}>
            This week
          </button>
          <button className={`rtab ${period === "month" ? "on" : ""}`} onClick={() => setPeriod("month")}>
            This month
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {loading && !report && <p className="muted">Loading…</p>}

      {report && (
        <>
          <KpiHeader report={report} />
          <ComparisonCard report={report} />
          <ChampionsSection report={report} champKind={champKind} setChampKind={setChampKind} />
        </>
      )}
    </div>
  );
}

function KpiHeader({ report }: { report: EodReportData }) {
  const c = report.current;
  const fc = c.food_cost_pct;
  const over = fc !== null && fc > 30;
  // Same reasoning as Reports.tsx: a real dish essentially never costs £0
  // to make, so if zero_cost_items pulled food cost down, a green "On
  // target" tag would misrepresent the number as good rather than
  // incomplete — flag it at the tag/color level, not just in the note.
  const zeroCostItems = c.zero_cost_items ?? [];
  const hasZeroCostItems = zeroCostItems.length > 0;

  return (
    <div className="kpis">
      <section className="card kpi-hero">
        <p className="kl">Food cost</p>
        {fc === null ? (
          <div className="kv-empty">No sales in this period yet.</div>
        ) : (
          <>
            <div className="kpi-topline">
              <span className="kpi-big">{fc.toFixed(1)}%</span>
              {hasZeroCostItems ? (
                <span className="tag warn">Cost incomplete</span>
              ) : (
                <span className={`tag ${over ? "bad" : "good"}`}>{over ? "Over target" : "On target"}</span>
              )}
            </div>
            <div className="kpi-meter">
              <div
                className="kpi-meter-fill"
                style={{
                  width: `${Math.min((fc / 50) * 100, 100)}%`,
                  background: hasZeroCostItems ? "#8A6410" : over ? "#C2611D" : "#1D6B4F",
                }}
              />
              <div className="kpi-meter-tgt" style={{ left: `${(30 / 50) * 100}%` }} />
            </div>
            <div className="kpi-meter-lbl">
              <span>0%</span>
              <span>target 30%</span>
              <span>50%</span>
            </div>
          </>
        )}
        {hasZeroCostItems && (
          <div className="kpi-note">
            {zeroCostItems.length} ingredient{zeroCostItems.length === 1 ? "" : "s"} sold this period with no
            supplier price on file — food cost is likely understated. Link a supplier in Items to fix this:{" "}
            {zeroCostItems.join(", ")}.
          </div>
        )}
      </section>

      <section className="card">
        <p className="kl">Net sales</p>
        <div className="kv">{gbp(c.net_sales)}</div>
        <div className="ks">
          {c.covers !== null
            ? `${c.covers.toLocaleString("en-GB")} cover${c.covers === 1 ? "" : "s"}${c.covers_partial ? " (partial — not every day logged covers)" : ""}`
            : "no covers logged this period"}
        </div>
      </section>

      <section className="card">
        <p className="kl">Gross margin</p>
        <div className="kv" style={{ color: c.gross_margin_pct !== null ? (hasZeroCostItems ? "#8A6410" : "#1D6B4F") : undefined }}>
          {pct(c.gross_margin_pct)}
        </div>
        <div className="ks">{hasZeroCostItems ? "incomplete — see note above" : "after food cost"}</div>
      </section>

      <section className="card">
        <p className="kl">Net margin</p>
        <div className="kv">{report.overhead_configured ? pct(c.net_margin_pct) : "—"}</div>
        <div className="ks">
          {report.overhead_configured
            ? "after labour & overheads (est.)"
            : "set monthly overhead in Settings to see this"}
        </div>
      </section>
    </div>
  );
}

function deltaChip(cur: number, prev: number, sentiment: "more" | "cost") {
  if (!prev) return null;
  const diffPct = ((cur - prev) / prev) * 100;
  const up = cur >= prev;
  const cls = sentiment === "cost" ? (up ? "warn" : "up") : up ? "up" : "down";
  return (
    <span className={`delta ${cls}`}>
      {up ? "▲" : "▼"} {Math.abs(diffPct).toFixed(1)}%
    </span>
  );
}

const AVERAGE_LABEL: Record<string, string> = {
  today: "your average for this weekday",
  week: "your rolling 4-week average",
  month: "your rolling 3-month average",
};

function ComparisonCard({ report }: { report: EodReportData }) {
  const [mode, setMode] = useState<"previous" | "average">("previous");
  const cur = report.current;
  const avg = report.average;
  const notEnoughHistory = mode === "average" && (!avg || avg.populated_count === 0);

  // Both comparison targets already came back in the same fetch — see
  // fetchEodReport — so switching modes here is instant, no re-fetch.
  const against =
    mode === "previous"
      ? { net_sales: report.previous.net_sales, covers: report.previous.covers, food_cost_pct: report.previous.food_cost_pct }
      : avg
        ? { net_sales: avg.net_sales, covers: avg.covers, food_cost_pct: avg.food_cost_pct }
        : null;

  const label = mode === "previous" ? PERIOD_LABEL[report.period] : AVERAGE_LABEL[report.period];
  const rangeNote =
    mode === "previous"
      ? `${report.previous_range.start} – ${report.previous_range.end}`
      : avg
        ? `based on ${avg.populated_count} of the last ${avg.window_count} comparable periods with sales`
        : "";

  const rows: { l: string; cur: string; prevV: string; delta: React.ReactNode }[] = against
    ? [
        {
          l: "Net sales",
          cur: gbp(cur.net_sales),
          prevV: gbp(against.net_sales),
          delta: deltaChip(cur.net_sales, against.net_sales, "more"),
        },
        {
          l: "Covers",
          cur: cur.covers !== null ? cur.covers.toLocaleString("en-GB") : "—",
          prevV: against.covers !== null ? against.covers.toLocaleString("en-GB") : "—",
          delta: cur.covers !== null && against.covers !== null ? deltaChip(cur.covers, against.covers, "more") : null,
        },
        {
          l: "Food cost %",
          cur: pct(cur.food_cost_pct),
          prevV: pct(against.food_cost_pct),
          delta:
            cur.food_cost_pct !== null && against.food_cost_pct !== null
              ? deltaChip(cur.food_cost_pct, against.food_cost_pct, "cost")
              : null,
        },
      ]
    : [];

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div className="cmp-h">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Compare with</span>
          <select
            className="cmp-mode-select"
            value={mode}
            onChange={(e) => setMode(e.target.value as "previous" | "average")}
          >
            <option value="previous">previous period</option>
            <option value="average">rolling average</option>
          </select>
        </div>
        <span className="muted" style={{ fontSize: 11.5 }}>{rangeNote}</span>
      </div>
      {notEnoughHistory ? (
        <p className="muted" style={{ margin: 0 }}>
          Not enough trading history yet to build a rolling average for this period — check back once you've got a
          few more {report.period === "month" ? "months" : "weeks"} of sales recorded.
        </p>
      ) : (
        <div className="cmp-rows">
          {rows.map((r) => (
            <div className="cmp-cell" key={r.l}>
              <div className="cc-l">{r.l}</div>
              <div className="cc-v">{r.cur}</div>
              <div className="cc-p">
                {label} · {r.prevV}
              </div>
              {r.delta}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ChampionsSection({
  report,
  champKind,
  setChampKind,
}: {
  report: EodReportData;
  champKind: "food" | "drink";
  setChampKind: (k: "food" | "drink") => void;
}) {
  const group = report.champions[champKind];

  return (
    <section style={{ marginTop: 16 }}>
      <div className="champ-head">
        <h2 className="sec-h" style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)", fontWeight: 700, margin: 0 }}>
          Champions this period
        </h2>
        <div className="rtabs" style={{ marginBottom: 0 }}>
          <button className={`rtab ${champKind === "food" ? "on" : ""}`} onClick={() => setChampKind("food")}>
            Dishes
          </button>
          <button className={`rtab ${champKind === "drink" ? "on" : ""}`} onClick={() => setChampKind("drink")}>
            Drinks
          </button>
        </div>
      </div>

      {!group ? (
        <p className="muted" style={{ marginTop: 10 }}>
          No {champKind === "food" ? "dishes" : "drinks"} sold in this period yet — mark recipes as Food or Drink
          from the Recipes screen if this looks empty when it shouldn't.
        </p>
      ) : (
        <div className="champ-wrap" style={{ marginTop: 12 }}>
          <div className="champ-hero">
            <span className="champ-rank">Champion · best return</span>
            <div className="hero-info">
              <div className="hero-name">{group.hero.name}</div>
              <div className="hero-metric">
                {gbp(group.hero.gp, 2)} <span>gross profit</span>
              </div>
              <div className="hero-stats">
                <span className="hstat">
                  Sold<b>{group.hero.qty}</b>
                </span>
                <span className="hstat">
                  Margin<b>{pct(group.hero.margin_pct)}</b>
                </span>
                <span className="hstat">
                  Revenue<b>{gbp(group.hero.revenue, 2)}</b>
                </span>
              </div>
            </div>
          </div>

          <ChampCard label="Most sold" tone="brand" entry={group.most_sold} metric={`${group.most_sold.qty}`} unit="sold" />
          {group.top_margin && (
            <ChampCard label="Top margin" tone="blue" entry={group.top_margin} metric={pct(group.top_margin.margin_pct)} unit="GP" />
          )}
          {group.trending_up ? (
            <ChampCard
              label="Trending up"
              tone="green"
              entry={group.trending_up}
              metric={`+${Math.round(group.trending_up.growth_pct ?? 0)}%`}
              unit="vs last period"
            />
          ) : (
            <ChampPlaceholder
              label="Trending up"
              tone="green"
              note="Not enough repeat sales yet — needs a dish that sold in both this period and the previous one to measure growth."
            />
          )}
        </div>
      )}
    </section>
  );
}

function ChampCard({
  label,
  tone,
  entry,
  metric,
  unit,
}: {
  label: string;
  tone: "brand" | "blue" | "green" | "terra";
  entry: EodChampionEntry;
  metric: string;
  unit: string;
}) {
  return (
    <div className="champ">
      <div className={`champ-band tone-${tone}`}>
        <span className="champ-rank">{label}</span>
      </div>
      <div className="champ-body">
        <div className="champ-name">{entry.name}</div>
        <div className="champ-metric">
          {metric} <span>{unit}</span>
        </div>
      </div>
    </div>
  );
}

// Same card shell as ChampCard, but for a slot that's a real, built
// feature with nothing to show yet — e.g. "Trending up" before any dish
// has sold in two consecutive periods. Distinct from just omitting the
// card, which would look like the feature doesn't exist rather than
// "exists, no data yet" — same honesty pattern used elsewhere in this
// report (net margin, rolling average, zero_cost_items).
function ChampPlaceholder({
  label,
  tone,
  note,
}: {
  label: string;
  tone: "brand" | "blue" | "green" | "terra";
  note: string;
}) {
  return (
    <div className="champ">
      <div className={`champ-band tone-${tone}`}>
        <span className="champ-rank">{label}</span>
      </div>
      <div className="champ-body">
        <p className="muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.45 }}>
          {note}
        </p>
      </div>
    </div>
  );
}
