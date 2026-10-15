import { useEffect, useState } from "react";
import { fetchItemHistory } from "./api";
import type { HistoryEvent, HistoryFilter, HistoryPriceCard, ItemHistoryData } from "./api";
import { HistoryActors, HistoryChips, HistoryTimeline } from "./HistoryParts";
import { fmtPrice, shortDate } from "./historyFormat";

// The Item page's History tab (managers and admins only -- the server
// refuses everyone else). Every logged change plus the item's stock
// movements, newest first. Read-only on purpose: entries can't be edited
// or deleted anywhere in the app.

const FILTERS: { key: HistoryFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "cost", label: "Cost" },
  { key: "stock", label: "Stock" },
  { key: "details", label: "Details" },
];

function PriceChart({ card, currency }: { card: HistoryPriceCard; currency?: string | null }) {
  const prices = card.points.map((p) => Number(p.price));
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const W = 300;
  const H = 70;
  const x = (i: number) => 6 + (i / (prices.length - 1)) * (W - 12);
  const y = (v: number) => 60 - ((v - min) / span) * 50;
  const line = prices.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = prices.length - 1;
  return (
    <svg
      className="ih-chart"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${card.unit} price from ${fmtPrice(card.earlier, currency)} to ${fmtPrice(card.current, currency)}`}
    >
      {[14, 40, 64].map((gy) => (
        <line key={gy} className="ih-grid" x1="0" x2={W} y1={gy} y2={gy} vectorEffect="non-scaling-stroke" />
      ))}
      <polygon className="ih-area" points={`${x(0)},${H - 2} ${line} ${x(last)},${H - 2}`} />
      <polyline className="ih-line" points={line} fill="none" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {/* A zero-length round-capped line is a dot that stays round when the chart stretches. */}
      <line className="ih-end" x1={x(last)} y1={y(prices[last])} x2={x(last)} y2={y(prices[last])} strokeWidth="11" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function PriceCard({ card, currency }: { card: HistoryPriceCard; currency?: string | null }) {
  const pct = card.change_pct;
  const tone = pct === null || pct === 0 ? "muted" : pct > 0 ? "caution" : "good";
  return (
    <div className="card ih-card">
      <div className="ih-eyebrow">
        Cost {card.unit} · {card.supplier}
      </div>
      <div className="ih-price-row">
        <div className="ih-price">{fmtPrice(card.current, currency)}</div>
        {pct !== null && (
          <span className={`rp-pill ${tone}`}>
            {pct > 0 ? "+" : pct < 0 ? "−" : ""}
            {Math.abs(pct)}% since {shortDate(card.earlier_at)}
          </span>
        )}
      </div>
      <PriceChart card={card} currency={currency} />
      <div className="ih-axis">
        <span>
          {shortDate(card.earlier_at)} · {fmtPrice(card.earlier, currency)}
        </span>
        <span>Now · {fmtPrice(card.current, currency)}</span>
      </div>
    </div>
  );
}

export default function ItemHistory({
  itemId,
  itemName,
  accessToken,
  currency,
}: {
  itemId: string;
  itemName: string;
  accessToken: string;
  currency?: string | null;
}) {
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const key = `${itemId}:${filter}`;
  // Loading is "the answer on screen is for a different key", so no state
  // has to be set synchronously inside the effect.
  const [result, setResult] = useState<{ key: string; data?: ItemHistoryData; error?: string } | null>(null);
  const [more, setMore] = useState<{ key: string; events: HistoryEvent[]; next: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchItemHistory(accessToken, itemId, filter)
      .then((data) => !cancelled && setResult({ key, data }))
      .catch(() => !cancelled && setResult({ key, error: "Couldn't load the history. Try again in a moment." }));
    return () => {
      cancelled = true;
    };
  }, [accessToken, itemId, filter, key]);

  const loading = result?.key !== key;
  const data = result?.data;
  const extra = more?.key === key ? more : null;
  const events = data ? [...data.events, ...(extra?.events ?? [])] : [];
  const next = extra ? extra.next : data?.next_before ?? null;

  const loadMore = () => {
    if (!next) return;
    setLoadingMore(true);
    fetchItemHistory(accessToken, itemId, filter, next)
      .then((page) => setMore({ key, events: [...(extra?.events ?? []), ...page.events], next: page.next_before }))
      .catch(() => setResult({ key, error: "Couldn't load more. Try again in a moment." }))
      .finally(() => setLoadingMore(false));
  };

  return (
    <div className="ih">
      <h2 className="ih-title">{itemName}</h2>

      {data?.price && <PriceCard card={data.price} currency={currency} />}

      <HistoryChips filters={FILTERS} value={filter} counts={data?.counts} onChange={setFilter} />

      {result?.error && <p className="error">{result.error}</p>}
      {loading && !result?.error && <p className="muted">Loading…</p>}
      {!loading && data && events.length === 0 && (
        <p className="muted">
          {filter === "all" ? "Nothing has been recorded for this item yet." : "Nothing in this group yet."}
        </p>
      )}

      {!loading && events.length > 0 && (
        <HistoryTimeline events={events} currency={currency} hasMore={!!next} loadingMore={loadingMore} onMore={loadMore} />
      )}

      {data && <HistoryActors actors={data.actors} />}

      <p className="ih-note">Only managers and admins see History. Entries can’t be edited or deleted.</p>
    </div>
  );
}
