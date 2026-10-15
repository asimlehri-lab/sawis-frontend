import { useEffect, useState } from "react";
import { fetchRecipeHistory } from "./api";
import type { HistoryEvent, RecipeHistoryCost, RecipeHistoryData, RecipeHistoryFilter } from "./api";
import { HistoryActors, HistoryChips, HistoryTimeline } from "./HistoryParts";
import { fmtMoney2, shortDate } from "./historyFormat";

// The Recipe page's History tab (managers and admins only): what people
// changed and what it did to cost per portion, plus the Automatic lines
// for ingredient price moves nobody typed into the recipe. Read-only --
// entries can't be edited or deleted anywhere in the app.

const FILTERS: { key: RecipeHistoryFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "ingredients", label: "Ingredients" },
  { key: "price", label: "Price" },
  { key: "details", label: "Details" },
  { key: "auto", label: "Automatic" },
];

function short(text: string, max = 13): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function CostSteps({ card, currency }: { card: RecipeHistoryCost; currency?: string | null }) {
  const costs = card.points.map((p) => Number(p.cost));
  const n = costs.length;
  const min = Math.min(...costs);
  const max = Math.max(...costs);
  const W = 300;
  const H = 150;
  const x = (i: number) => 10 + (i / (n - 1)) * (W - 20);
  const y = (v: number) => (max === min ? 70 : 100 - ((v - min) / (max - min)) * 60);
  const path: string[] = [`${x(0)},${y(costs[0])}`];
  for (let i = 1; i < n; i++) path.push(`${x(i)},${y(costs[i - 1])}`, `${x(i)},${y(costs[i])}`);
  const labelled = card.points.map((p, i) => ({ p, i })).filter(({ p, i }) => i > 0 && p.label).slice(-4);
  return (
    <svg
      className="ih-steps"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Cost per portion from ${fmtMoney2(card.earlier, currency)} to ${fmtMoney2(card.current, currency)} over ${n - 1} changes`}
    >
      {[30, 70, 110].map((gy) => (
        <line key={gy} className="ih-grid" x1="0" x2={W} y1={gy} y2={gy} />
      ))}
      <polyline className="ih-line" points={path.join(" ")} fill="none" strokeWidth="2.4" strokeLinejoin="round" />
      {costs.slice(1, -1).map((c, k) => (
        <circle key={k} className="ih-node" cx={x(k + 1)} cy={y(c)} r="3.5" strokeWidth="2" />
      ))}
      <circle className="ih-end-dot" cx={x(n - 1)} cy={y(costs[n - 1])} r="5" strokeWidth="2" />
      {labelled.map(({ p, i }) => (
        <text key={i} className="ih-steps-label" x={Math.min(Math.max(x(i), 28), W - 28)} y="142" textAnchor="middle">
          {short(p.label)}
        </text>
      ))}
    </svg>
  );
}

function CostCard({ card, currency }: { card: RecipeHistoryCost; currency?: string | null }) {
  const delta = Number(card.current) - Number(card.earlier);
  const flat = Math.abs(delta) < 0.005;
  return (
    <div className="card ih-card ih-first">
      <div className="ih-eyebrow">Cost per portion · last 30 days</div>
      <div className="ih-price-row">
        <div className="ih-price">{fmtMoney2(card.current, currency)}</div>
        <span className={`rp-pill ${flat ? "muted" : delta > 0 ? "caution" : "good"}`}>
          {flat ? "No change" : `${delta > 0 ? "+" : "−"}${fmtMoney2(Math.abs(delta), currency)} since ${shortDate(card.earlier_at)}`}
        </span>
      </div>
      <CostSteps card={card} currency={currency} />
    </div>
  );
}

function TodayCard({ today, currency }: { today: RecipeHistoryData["today"]; currency?: string | null }) {
  return (
    <div className="card ih-card ih-last">
      <div className="ih-eyebrow">Today</div>
      <div className="ih-today">
        {today.menu_price !== null && (
          <div>
            <span>Menu price</span>
            <b>{fmtMoney2(today.menu_price, currency)}</b>
          </div>
        )}
        <div>
          <span>Cost per portion</span>
          <b>{fmtMoney2(today.cost_per_portion, currency)}</b>
        </div>
        {today.food_cost_pct !== null && (
          <div>
            <span>Food cost</span>
            <b>{today.food_cost_pct.toFixed(1)}%</b>
          </div>
        )}
      </div>
    </div>
  );
}

export default function RecipeHistory({
  recipeId,
  accessToken,
  currency,
}: {
  recipeId: string;
  accessToken: string;
  currency?: string | null;
}) {
  const [filter, setFilter] = useState<RecipeHistoryFilter>("all");
  const key = `${recipeId}:${filter}`;
  // Loading is "the answer on screen is for a different key", so no state
  // has to be set synchronously inside the effect.
  const [result, setResult] = useState<{ key: string; data?: RecipeHistoryData; error?: string } | null>(null);
  const [more, setMore] = useState<{ key: string; events: HistoryEvent[]; next: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchRecipeHistory(accessToken, recipeId, filter)
      .then((data) => !cancelled && setResult({ key, data }))
      .catch(() => !cancelled && setResult({ key, error: "Couldn't load the history. Try again in a moment." }));
    return () => {
      cancelled = true;
    };
  }, [accessToken, recipeId, filter, key]);

  const loading = result?.key !== key;
  const data = result?.data;
  const extra = more?.key === key ? more : null;
  const events = data ? [...data.events, ...(extra?.events ?? [])] : [];
  const next = extra ? extra.next : data?.next_before ?? null;

  const loadMore = () => {
    if (!next) return;
    setLoadingMore(true);
    fetchRecipeHistory(accessToken, recipeId, filter, next)
      .then((page) => setMore({ key, events: [...(extra?.events ?? []), ...page.events], next: page.next_before }))
      .catch(() => setResult({ key, error: "Couldn't load more. Try again in a moment." }))
      .finally(() => setLoadingMore(false));
  };

  return (
    <div className="ih ih-wide">
      <p className="muted ih-lede">
        What changed this dish, and what it did to the cost. Edits by people, and automatic cost moves when an
        ingredient’s price changed.
      </p>
      <div className="ih-cols">
        <div className="ih-main">
          <HistoryChips filters={FILTERS} value={filter} counts={data?.counts} onChange={setFilter} />
          {result?.error && <p className="error">{result.error}</p>}
          {loading && !result?.error && <p className="muted">Loading…</p>}
          {!loading && data && events.length === 0 && (
            <p className="muted">
              {filter === "all" ? "Nothing has been recorded for this recipe yet." : "Nothing in this group yet."}
            </p>
          )}
          {!loading && events.length > 0 && (
            <HistoryTimeline events={events} currency={currency} hasMore={!!next} loadingMore={loadingMore} onMore={loadMore} />
          )}
        </div>
        <div className="ih-side">
          {data?.cost && <CostCard card={data.cost} currency={currency} />}
          {data && <TodayCard today={data.today} currency={currency} />}
          {data && <HistoryActors actors={data.actors} className="ih-last" />}
        </div>
      </div>
      <p className="ih-note">Only managers and admins see History. Entries can’t be edited or deleted.</p>
    </div>
  );
}
