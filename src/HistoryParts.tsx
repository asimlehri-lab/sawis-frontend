import type { HistoryEvent } from "./api";
import {
  autoCause,
  autoHeadline,
  changeText,
  costEffect,
  dayLabel,
  describe,
  dotTone,
  timeLabel,
} from "./historyFormat";
import type { DotTone } from "./historyFormat";

// Pieces shared by the Item and Recipe History tabs: the day-grouped
// timeline, the filter chips and the "who touched it" bars.

const ICONS: Record<DotTone, string> = {
  up: "M7 17 17 7M9 7h8v8",
  down: "M7 7l10 10M17 9v8H9",
  stock: "M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8",
  details: "M4 20h4L19 9l-4-4L4 16z",
  ingredients: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
  price: "M12 3v18M16 7.5H10a2.5 2.5 0 0 0 0 5h4a2.5 2.5 0 0 1 0 5H8",
  auto: "M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5",
};

function Dot({ e }: { e: HistoryEvent }) {
  const tone = dotTone(e);
  return (
    <span className={`ih-dot ${tone}`}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={e.action === "created" ? "M12 5v14M5 12h14" : ICONS[tone]} />
      </svg>
    </span>
  );
}

function Row({ e, currency, last }: { e: HistoryEvent; currency?: string | null; last: boolean }) {
  const words = describe(e);
  const change = changeText(e, currency);
  const effect = costEffect(e, currency);
  const pct = e.delta_pct;
  const auto = e.kind === "auto";
  return (
    <div className="ih-row">
      <div className="ih-rail">
        <Dot e={e} />
        {!last && <span className="ih-stem" />}
      </div>
      <div className="ih-body">
        <div className="ih-text">
          {auto ? (
            <>
              <b>Automatic</b> · {autoHeadline(e)}
            </>
          ) : e.actor_name ? (
            <>
              <b>{e.actor_name}</b> {words.verb}
            </>
          ) : (
            words.plain
          )}
        </div>
        <div className="ih-meta">
          {change && <span className="ih-change">{change}</span>}
          {effect?.pill && <span className={`rp-pill ${effect.tone}`}>{effect.pill}</span>}
          {!effect && pct !== null && pct !== 0 && (
            <span className={`rp-pill ${pct > 0 ? "caution" : "good"}`}>
              {pct > 0 ? "+" : "−"}
              {Math.abs(pct)}%
            </span>
          )}
          {e.context && e.field !== "Price" && e.field !== "Amount" && !auto && <span className="ih-tag">{e.context}</span>}
          {e.source && !auto && <span className="ih-tag">{e.source}</span>}
          <span className="ih-time">{timeLabel(e.at)}</span>
        </div>
        {effect?.line && <div className="ih-sub">{effect.line}</div>}
        {auto && autoCause(e, currency) && <div className="ih-sub">{autoCause(e, currency)}</div>}
      </div>
    </div>
  );
}

export function HistoryTimeline({
  events,
  currency,
  hasMore,
  loadingMore,
  onMore,
}: {
  events: HistoryEvent[];
  currency?: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
}) {
  return (
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
      {hasMore && (
        <button type="button" className="btn-ghost ih-more" onClick={onMore} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Show earlier"}
        </button>
      )}
    </div>
  );
}

export function HistoryChips<K extends string>({
  filters,
  value,
  counts,
  onChange,
}: {
  filters: { key: K; label: string }[];
  value: K;
  counts?: Record<string, number>;
  onChange: (key: K) => void;
}) {
  return (
    <div className="chip-row ih-chips" role="tablist" aria-label="Filter history">
      {filters.map((f) => (
        <button
          key={f.key}
          type="button"
          role="tab"
          aria-selected={value === f.key}
          className={`chip ih-chip ${value === f.key ? "active" : ""}`}
          onClick={() => onChange(f.key)}
        >
          {f.label}
          {counts && <span className="ih-chip-n">{counts[f.key] ?? 0}</span>}
        </button>
      ))}
    </div>
  );
}

export function HistoryActors({ actors, className = "" }: { actors: { name: string; count: number }[]; className?: string }) {
  if (actors.length === 0) return null;
  const top = Math.max(...actors.map((a) => a.count));
  return (
    <div className={`card ih-card ${className}`}>
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
