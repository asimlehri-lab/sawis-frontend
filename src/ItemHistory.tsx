import { useEffect, useState } from "react";
import { fetchItemHistory } from "./api";
import type { HistoryEvent, HistoryFilter, HistoryPriceCard, ItemHistoryData } from "./api";
import { changeText, describe, dayLabel, dotTone, fmtPrice, shortDate, timeLabel } from "./historyFormat";
import type { DotTone } from "./historyFormat";

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

const ICONS: Record<DotTone, string> = {
  up: "M7 17 17 7M9 7h8v8",
  down: "M7 7l10 10M17 9v8H9",
  stock: "M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8",
  details: "M4 20h4L19 9l-4-4L4 16z",
};

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

function Actors({ actors }: { actors: { name: string; count: number }[] }) {
  if (actors.length === 0) return null;
  const top = Math.max(...actors.map((a) => a.count));
  return (
    <div className="card ih-card">
      <div className="ih-eyebrow">Who touched it · last 90 days</div>
      <div className="ih-actors">
        {actors.map((a) => (
          <div className="ih-actor" key={a.name}>
            <span className="ih-actor-name">{a.name}</span>
            <span className="ih-actor-track" aria-hidden="true">
              <span className="ih-actor-bar" style={{ width: `${(a.count / top) * 100}%` }} />
            </span>
            <span className="ih-actor-n">{a.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ e, currency, last }: { e: HistoryEvent; currency?: string | null; last: boolean }) {
  const tone = dotTone(e);
  const words = describe(e);
  const change = changeText(e, currency);
  const pct = e.delta_pct;
  return (
    <div className="ih-row">
      <div className="ih-rail">
        <span className={`ih-dot ${tone}`}>
          {e.action === "created" ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={ICONS[tone]} />
            </svg>
          )}
        </span>
        {!last && <span className="ih-stem" />}
      </div>
      <div className="ih-body">
        <div className="ih-text">
          {e.actor_name ? (
            <>
              <b>{e.actor_name}</b> {words.verb}
            </>
          ) : (
            words.plain
          )}
        </div>
        <div className="ih-meta">
          {change && <span className="ih-change">{change}</span>}
          {pct !== null && pct !== 0 && (
            <span className={`rp-pill ${pct > 0 ? "caution" : "good"}`}>
              {pct > 0 ? "+" : "−"}
              {Math.abs(pct)}%
            </span>
          )}
          {e.context && e.field !== "Price" && <span className="ih-tag">{e.context}</span>}
          {e.source && <span className="ih-tag">{e.source}</span>}
          <span className="ih-time">{timeLabel(e.at)}</span>
        </div>
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

      <div className="chip-row ih-chips" role="tablist" aria-label="Filter history">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            className={`chip ih-chip ${filter === f.key ? "active" : ""}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            {data && <span className="ih-chip-n">{data.counts[f.key]}</span>}
          </button>
        ))}
      </div>

      {result?.error && <p className="error">{result.error}</p>}
      {loading && !result?.error && <p className="muted">Loading…</p>}
      {!loading && data && events.length === 0 && (
        <p className="muted">
          {filter === "all" ? "Nothing has been recorded for this item yet." : "Nothing in this group yet."}
        </p>
      )}

      {!loading && events.length > 0 && (
        <div className="card ih-card">
          {events.map((e, i) => {
            const day = dayLabel(e.at);
            const newDay = i === 0 || dayLabel(events[i - 1].at) !== day;
            const lastOfDay = i === events.length - 1 || dayLabel(events[i + 1].at) !== day;
            return (
              <div key={e.id}>
                {newDay && <div className="ih-day">{day}</div>}
                <Row e={e} currency={currency} last={lastOfDay} />
              </div>
            );
          })}
          {next && (
            <button type="button" className="btn-ghost ih-more" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? "Loading…" : "Show earlier"}
            </button>
          )}
        </div>
      )}

      {data && <Actors actors={data.actors} />}

      <p className="ih-note">Only managers and admins see History. Entries can’t be edited or deleted.</p>
    </div>
  );
}
