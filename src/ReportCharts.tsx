import { useState } from "react";
import type { ReactNode } from "react";
import { formatMoney } from "./api";
import type { ReportsTrendPoint } from "./api";
import { fmtDay, fmtShort } from "./reportFormat";

// Small, dependency-free chart pieces for the Reports page: HTML/CSS bars
// and an SVG sparkline, same approach as the food-cost trend that was
// already here. They read their colours from CSS tokens (see the rp-*
// rules in App.css), so dark mode and the print sheet both follow.

export function Sparkline({ values, tone = "brand", label }: { values: (number | null)[]; tone?: "brand" | "caution"; label: string }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  if (pts.length < 2) return <div className="rp-spark-empty" aria-hidden="true" />;
  const W = 120;
  const H = 34;
  const pad = 4;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const span = max - min || 1;
  const n = values.length - 1 || 1;
  const x = (i: number) => 2 + (i / n) * (W - 4);
  const y = (v: number) => (max === min ? H / 2 : H - pad - ((v - min) / span) * (H - 2 * pad));
  const last = pts[pts.length - 1];
  return (
    <svg className={`rp-spark ${tone}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="none">
      <polyline points={pts.map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ")} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {/* A zero-length round-capped line is a dot that stays round when the chart stretches. */}
      <line className="rp-spark-end" x1={x(last.i)} y1={y(last.v)} x2={x(last.i)} y2={y(last.v)} strokeWidth="7" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export type PillTone = "good" | "caution" | "warn" | "muted";

export function KpiTile({
  label,
  value,
  valueTone,
  pill,
  sub,
  spark,
  span,
}: {
  label: string;
  value: string;
  valueTone?: "good" | "caution" | "warn" | "danger";
  pill?: { text: string; tone: PillTone };
  sub?: string;
  spark?: ReactNode;
  span?: boolean;
}) {
  return (
    <div className={`rp-tile ${span ? "rp-tile-span" : ""}`}>
      <div className="rp-tile-label">{label}</div>
      <div className={`rp-tile-value ${valueTone ?? ""}`}>{value}</div>
      {pill && <span className={`rp-pill ${pill.tone}`}>{pill.text}</span>}
      {sub && <div className="rp-tile-sub">{sub}</div>}
      {spark}
    </div>
  );
}

// Food cost % per day (or per week of the month): one bar each, over-target
// bars in the caution colour, a dashed target line, and a detail line
// under the chart for the bar you tap -- the worst day to start with, since
// that's the one worth asking about. Phones can't hover, so tap, not
// tooltip.
export function FoodCostBars({
  trend,
  target,
  currency,
  readOnly,
}: {
  trend: ReportsTrendPoint[];
  target: number;
  currency?: string;
  readOnly?: boolean;
}) {
  const values = trend.map((t) => t.food_cost_pct);
  const known = values.filter((v): v is number => v !== null);
  const worst = known.length ? values.indexOf(Math.max(...known)) : -1;
  const [picked, setPicked] = useState<number | null>(null);
  const sel = picked ?? worst;
  const scaleMax = Math.ceil(Math.max(target + 10, (known.length ? Math.max(...known) : 0) + 5) / 10) * 10;
  const showValues = trend.length <= 8;
  const selPoint = sel >= 0 ? trend[sel] : null;

  const when = (t: ReportsTrendPoint) => (t.start === t.end ? fmtDay(t.start) : `${t.label} · ${fmtShort(t.start)} – ${fmtShort(t.end)}`);

  return (
    <div>
      <div className="rp-plot-wrap">
        <div className="rp-yaxis" aria-hidden="true">
          <span style={{ bottom: "100%" }}>{scaleMax}%</span>
          <span style={{ bottom: "50%" }}>{scaleMax / 2}%</span>
          <span style={{ bottom: 0 }}>0%</span>
        </div>
        <div className="rp-plot">
          <div className="rp-grid" style={{ bottom: "50%" }} />
          <div className="rp-grid" style={{ bottom: "100%" }} />
          <div className="rp-grid base" style={{ bottom: 0 }} />
          <div className="rp-target" style={{ bottom: `${(target / scaleMax) * 100}%` }} />
          <div className="rp-bars">
            {trend.map((t, i) => {
              const v = t.food_cost_pct;
              const h = v === null ? 0 : Math.max((v / scaleMax) * 100, 1.5);
              const over = v !== null && v > target;
              const text = v === null ? `${when(t)}: no sales` : `${when(t)}: ${v.toFixed(1)}%${over ? ", over target" : ""}`;
              const inner = (
                <>
                  {showValues && v !== null && (
                    <span className="rp-bar-val" style={{ bottom: `calc(${h}% + 3px)` }}>
                      {v.toFixed(1)}
                    </span>
                  )}
                  <span
                    className={`rp-bar ${v === null ? "empty" : over ? "over" : "under"} ${i === sel ? "sel" : ""}`}
                    style={{ height: v === null ? 3 : `${h}%` }}
                  />
                </>
              );
              return readOnly ? (
                <div className="rp-bar-col" key={t.start} title={text}>
                  {inner}
                </div>
              ) : (
                <button type="button" className="rp-bar-col" key={t.start} aria-label={text} aria-pressed={i === sel} onClick={() => setPicked(i)}>
                  {inner}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="rp-xaxis">
        {trend.map((t) => (
          <span key={t.start}>{t.label}</span>
        ))}
      </div>
      <div className="rp-legend">
        <span>
          <i className="rp-sw under" /> On target
        </span>
        <span>
          <i className="rp-sw over" /> Over target
        </span>
        <span>
          <i className="rp-sw tgt" /> {target}% target
        </span>
      </div>
      {selPoint && (
        <div className="rp-detail" aria-live="polite">
          <div className="rp-detail-h">
            {when(selPoint)}
            {selPoint.food_cost_pct !== null ? ` · ${selPoint.food_cost_pct.toFixed(1)}%` : ""}
          </div>
          <div className="rp-detail-s">
            {selPoint.food_cost_pct === null
              ? "No sales recorded."
              : `${formatMoney((selPoint.net_sales * selPoint.food_cost_pct) / 100, currency, 0)} of ingredients on ${formatMoney(selPoint.net_sales, currency, 0)} sales`}
          </div>
        </div>
      )}
      {!readOnly && trend.length > 0 && <div className="rp-hint">Tap a bar to see that {trend[0].start === trend[0].end ? "day" : "week"}.</div>}
    </div>
  );
}

export interface BarRow {
  key: string;
  label: string;
  amount: string;
  share: string;
  pct: number;
}

// Label and amount on one line, the bar underneath on its own line --
// reads the same on a phone as on a desktop (no label column to squeeze).
export function HBars({ rows, tone }: { rows: BarRow[]; tone: "brand" | "caution" }) {
  return (
    <div className="rp-hbars">
      {rows.map((r) => (
        <div key={r.key}>
          <div className="rp-hbar-h">
            <span>{r.label}</span>
            <span>
              <b>{r.amount}</b> <span className="rp-hbar-share">· {r.share}</span>
            </span>
          </div>
          <div className="rp-hbar-track" role="img" aria-label={`${r.label}: ${r.amount}, ${r.share}`}>
            <div className={`rp-hbar-fill ${tone}`} style={{ width: `${Math.max(r.pct, 1.5)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
