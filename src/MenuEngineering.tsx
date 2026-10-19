import { useEffect, useState } from "react";
import { formatMoney } from "./api";
import type { ReportsMenuRow } from "./api";
import { GROUPS, MIN_DISHES, ORDER, buildMenuGroups, niceStep } from "./menuGroups";
import type { GroupKey } from "./menuGroups";

// "Which dishes earn their place": every dish sold in the period placed by
// how much of the menu it sells (across) and how much each one earns
// (up). The dashed lines are this period's averages, which split the
// chart into four groups, each with a plain-English next step. Same idea
// as classic menu engineering, with names a kitchen would actually say.

export default function MenuEngineering({
  rows,
  currency,
  readOnly,
  onOpenRecipe,
}: {
  rows: ReportsMenuRow[];
  currency?: string;
  readOnly?: boolean;
  // Opens the dish's recipe page (not offered on the printed report).
  onOpenRecipe?: (recipeId: string) => void;
}) {
  const built = buildMenuGroups(rows);
  const [filter, setFilter] = useState<GroupKey | "all">("all");
  const [picked, setPicked] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  // Size of the plot, so dish names can be laid out without running into each
  // other or out of the chart.
  const [quadEl, setQuadEl] = useState<HTMLDivElement | null>(null);
  const [quadSize, setQuadSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!quadEl || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setQuadSize({ w: quadEl.clientWidth, h: quadEl.clientHeight }));
    ro.observe(quadEl);
    return () => ro.disconnect();
  }, [quadEl]);

  if (!built.ok) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        {built.count === 0
          ? "No dishes sold in this period yet."
          : `This chart needs at least ${MIN_DISHES} dishes with a sale and a full ingredient cost; there ${built.count === 1 ? "is" : "are"} ${built.count} so far.`}
      </p>
    );
  }

  const { dishes, xCut, yCut, hidden } = built;
  const maxMix = Math.max(...dishes.map((d) => d.mix));
  const xStep = niceStep(maxMix * 1.08);
  const xMax = Math.ceil((maxMix * 1.08) / xStep) * xStep;
  const maxGp = Math.max(...dishes.map((d) => d.gp));
  const minGp = Math.min(0, ...dishes.map((d) => d.gp));
  const yStep = niceStep(maxGp - minGp);
  const yMax = Math.ceil((maxGp * 1.08) / yStep) * yStep;
  const yMin = Math.floor(minGp / yStep) * yStep;
  const xp = (m: number) => (m / xMax) * 100;
  const yp = (g: number) => 100 - ((g - yMin) / (yMax - yMin)) * 100;
  const xTicks: number[] = [];
  for (let v = 0; v <= xMax + 1e-9; v += xStep) xTicks.push(v);
  const yTicks: number[] = [];
  for (let v = yMin; v <= yMax + 1e-9; v += yStep) yTicks.push(v);

  // The six best sellers get their name beside the dot: on the right if it
  // fits, else on the left, keeping clear of other dots when it can, and no
  // name is drawn over one already placed (the dot can still be tapped for
  // its details).
  const labelSide = new Map<string, "r" | "l">();
  {
    const { w, h } = quadSize;
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const clash = (b: { x0: number; x1: number; y0: number; y1: number }) =>
      placed.some((p) => b.x0 < p.x1 && b.x1 > p.x0 && b.y0 < p.y1 && b.y1 > p.y0);
    for (const d of [...dishes].sort((a, b) => b.qty - a.qty).slice(0, 6)) {
      if (w <= 0 || h <= 0) {
        labelSide.set(d.id, xp(d.mix) > 55 ? "l" : "r");
        continue;
      }
      const cx = (xp(d.mix) / 100) * w;
      const cy = (yp(d.gp) / 100) * h;
      const tw = Math.min(300, d.name.length * 6.6 + 4);
      const boxes = {
        r: { x0: cx + 12, x1: cx + 12 + tw, y0: cy - 12, y1: cy + 12 },
        l: { x0: cx - 12 - tw, x1: cx - 12, y0: cy - 12, y1: cy + 12 },
      };
      const overDot = (b: { x0: number; x1: number; y0: number; y1: number }) =>
        dishes.some((o) => {
          if (o.id === d.id) return false;
          const ox = (xp(o.mix) / 100) * w;
          const oy = (yp(o.gp) / 100) * h;
          return ox > b.x0 - 6 && ox < b.x1 + 6 && oy > b.y0 - 4 && oy < b.y1 + 4;
        });
      // First choice keeps clear of other dots; failing that, the name may
      // pass over a dot rather than be left out.
      const choices = [
        ["r", true],
        ["l", true],
        ["r", false],
        ["l", false],
      ] as const;
      for (const [side, strict] of choices) {
        const b = boxes[side];
        if (b.x0 < 0 || b.x1 > w || clash(b) || (strict && overDot(b))) continue;
        placed.push(b);
        labelSide.set(d.id, side);
        break;
      }
    }
  }
  const byGroup = (k: GroupKey) => dishes.filter((d) => d.group === k).sort((a, b) => b.qty - a.qty);
  const shownId = hover ?? picked;
  const shown = dishes.find((d) => d.id === shownId) ?? null;
  const list = (filter === "all" ? [...dishes] : byGroup(filter)).sort((a, b) => b.qty - a.qty);
  const money = (n: number) => formatMoney(n, currency, 2);
  const xc = xp(xCut);
  const yc = yp(yCut);

  return (
    <div className="rp-me">
      <div className="rp-me-main">
        <div className="rp-quad-wrap">
          <div className="rp-quad-ytitle" aria-hidden="true">
            Earns more per dish →
          </div>
          <div className="rp-quad-yaxis" aria-hidden="true">
            {yTicks.map((t) => (
              <span key={t} style={{ top: `${yp(t)}%` }}>
                {formatMoney(t, currency, 0)}
              </span>
            ))}
          </div>
          <div className="rp-quad" ref={setQuadEl} role="group" aria-label="Dishes by how much they sell and how much each earns">
            <div className="rp-qt gems" style={{ left: 0, top: 0, width: `${xc}%`, height: `${yc}%` }} />
            <div className="rp-qt headliners" style={{ left: `${xc}%`, top: 0, right: 0, height: `${yc}%` }} />
            <div className="rp-qt chop" style={{ left: 0, top: `${yc}%`, width: `${xc}%`, bottom: 0 }} />
            <div className="rp-qt crowd" style={{ left: `${xc}%`, top: `${yc}%`, right: 0, bottom: 0 }} />
            {yTicks.map((t) => (
              <div key={t} className={`rp-qgrid ${t === 0 ? "base" : ""}`} style={{ top: `${yp(t)}%` }} />
            ))}
            <div className="rp-qavg v" style={{ left: `${xc}%` }} />
            <div className="rp-qavg h" style={{ top: `${yc}%` }} />
            <span className="rp-qname gems">{GROUPS.gems.name}</span>
            <span className="rp-qname headliners">{GROUPS.headliners.name}</span>
            <span className="rp-qname chop">{GROUPS.chop.name}</span>
            <span className="rp-qname crowd">{GROUPS.crowd.name}</span>
            {dishes.map((d) => {
              const dim = filter !== "all" && d.group !== filter;
              const style = { left: `${xp(d.mix)}%`, top: `${yp(d.gp)}%` };
              const cls = `rp-dot g-${d.group} ${dim ? "dim" : ""} ${d.id === shownId ? "on" : ""}`;
              const aria = `${d.name}, ${GROUPS[d.group].name}, ${d.mix.toFixed(1)} percent of dishes sold, ${money(d.gp)} profit per dish`;
              return (
                <span key={d.id}>
                  {readOnly ? (
                    <span className={cls} style={style} aria-label={aria} role="img" />
                  ) : (
                    <button
                      type="button"
                      className={cls}
                      style={style}
                      aria-label={aria}
                      onClick={() => setPicked(d.id === picked ? null : d.id)}
                      onMouseEnter={() => setHover(d.id)}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover(d.id)}
                      onBlur={() => setHover(null)}
                    />
                  )}
                  {labelSide.has(d.id) && !dim && (
                    <span className={`rp-dot-label${labelSide.get(d.id) === "l" ? " left" : ""}`} style={{ left: `${xp(d.mix)}%`, top: `${yp(d.gp)}%` }}>
                      {d.name}
                    </span>
                  )}
                </span>
              );
            })}
            {xTicks.map((t) => (
              <span key={t} className="rp-quad-xtick" style={{ left: `${xp(t)}%` }}>
                {t}%
              </span>
            ))}
          </div>
          <div className="rp-quad-xtitle" aria-hidden="true">
            Sells more →
          </div>
        </div>
        <p className="rp-hint" style={{ marginTop: 0 }}>
          Each dot is a dish. Dashed lines are this period’s averages ({xCut.toFixed(1)}% of dishes sold, {money(yCut)} profit per dish).
          {!readOnly && " Tap a dot to see it."}
        </p>
        {shown && (
          <div className="rp-detail" aria-live="polite">
            <div className="rp-detail-h">
              <span className={`rp-gsw g-${shown.group}`} /> {shown.name}
              <span className="rp-detail-g">{GROUPS[shown.group].name}</span>
            </div>
            <div className="rp-detail-s">
              {shown.mix.toFixed(1)}% of dishes sold · {shown.qty} sold · {money(shown.gp)} profit per dish
            </div>
            <div className="rp-detail-a">
              <b>{GROUPS[shown.group].verb}</b> {GROUPS[shown.group].action}
            </div>
            {onOpenRecipe && !readOnly && (
              <button type="button" className="open-link rp-detail-open" onClick={() => onOpenRecipe(shown.id)}>
                Open recipe →
              </button>
            )}
          </div>
        )}
      </div>

      <div className="rp-me-side">
        {ORDER.map((k) => {
          const members = byGroup(k);
          const names = members.slice(0, 4).map((d) => d.name).join(", ") + (members.length > 4 ? ` and ${members.length - 4} more` : "");
          const inner = (
            <>
              <div className="rp-gcard-h">
                <span className={`rp-gsw g-${k}`} />
                <span className="rp-gcard-name">{GROUPS[k].name}</span>
                <span className="rp-gcard-n">
                  {members.length} dish{members.length === 1 ? "" : "es"}
                </span>
              </div>
              <div className="rp-gcard-d">{names || "None this period"}</div>
              <div className="rp-gcard-a">
                <b>{GROUPS[k].verb}</b> {GROUPS[k].action}
              </div>
            </>
          );
          return readOnly ? (
            <div key={k} className="rp-gcard">
              {inner}
            </div>
          ) : (
            <button
              type="button"
              key={k}
              className={`rp-gcard ${filter === k ? "on" : ""}`}
              aria-pressed={filter === k}
              onClick={() => setFilter(filter === k ? "all" : k)}
            >
              {inner}
            </button>
          );
        })}
        {hidden > 0 && (
          <p className="rp-hint" style={{ margin: 0 }}>
            {hidden} dish{hidden === 1 ? " is" : "es are"} not shown: no sales value, or an ingredient with no price on file. Fix the price and it appears here.
          </p>
        )}
      </div>

      {!readOnly && (
        <div className={`rp-me-list ${filter === "all" ? "rp-narrow-only" : ""}`}>
          <div className="rp-me-list-h">
            <b>{filter === "all" ? "All dishes" : GROUPS[filter].name}</b> · {list.length}
            {filter !== "all" && (
              <button type="button" className="open-link" onClick={() => setFilter("all")}>
                Show all
              </button>
            )}
          </div>
          {list.map((d) => (
            <button
              type="button"
              key={d.id}
              className={`rp-me-row ${d.id === picked ? "on" : ""}`}
              onClick={() => setPicked(d.id === picked ? null : d.id)}
            >
              <span className={`rp-gsw g-${d.group}`} />
              <span className="rp-me-row-n">
                {d.name}
                <small>
                  {GROUPS[d.group].name} · {d.qty} sold
                </small>
              </span>
              <span className="rp-me-row-v">
                {money(d.gp)}
                <small>per dish</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
