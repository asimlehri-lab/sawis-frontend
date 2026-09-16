import { useEffect, useMemo, useState } from "react";
import { fetchSaleDates } from "./api";
import Loader from "./Loader";

interface Props {
  accessToken: string;
  location: string;
  // Which grid to show. "day" and "week" share the same day-grid --
  // _period_bounds on the backend treats "week" as a rolling 7 days
  // ENDING on whatever single date is picked (not a Mon-Sun calendar
  // week), so picking a week is really just picking its last day. "month"
  // gets its own year grid since a month is picked as a whole unit.
  mode: "day" | "week" | "month";
  // The date (YYYY-MM-DD) to open centred on -- typically whatever's
  // currently selected, so re-opening the picker doesn't lose your place.
  initialDate: string;
  title: string;
  onSelect: (dateKey: string) => void;
  onClose: () => void;
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

// Local-date key, deliberately not toISOString() -- same reasoning as
// NotificationCalendar.tsx's dateKey: avoids landing on the wrong
// calendar day near midnight for anyone west of Greenwich.
function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function mondayOf(d: Date): Date {
  const dow = (d.getDay() + 6) % 7;
  return addDays(d, -dow);
}

// Fixed 6-row/42-day grid, same as NotificationCalendar.tsx, so the modal
// doesn't resize between months of different lengths.
function monthGrid(cursor: Date): Date[] {
  const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = mondayOf(firstOfMonth);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

// Picking a "week" here means picking its last day -- the 7-day window is
// [day-6 .. day] inclusive, matching _period_bounds on the backend exactly.
function weekWindowKeys(d: Date): Set<string> {
  return new Set(Array.from({ length: 7 }, (_, i) => dateKey(addDays(d, -i))));
}

export default function PeriodPicker({ accessToken, location, mode, initialDate, title, onSelect, onClose }: Props) {
  const initial = useMemo(() => new Date(`${initialDate}T00:00:00`), [initialDate]);
  const [cursor, setCursor] = useState(initial);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [dates, setDates] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!location) return;
    let cancelled = false;
    fetchSaleDates(accessToken, location)
      .then((d) => {
        if (!cancelled) setDates(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load sales history.");
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, location]);

  const dateSet = useMemo(() => new Set(dates ?? []), [dates]);
  const monthsWithData = useMemo(() => {
    const s = new Set<string>();
    (dates ?? []).forEach((d) => s.add(d.slice(0, 7))); // "YYYY-MM"
    return s;
  }, [dates]);

  const todayKey = dateKey(new Date());
  const initialKey = dateKey(initial);

  function goPrev() {
    setCursor((c) =>
      mode === "month" ? new Date(c.getFullYear() - 1, 0, 1) : new Date(c.getFullYear(), c.getMonth() - 1, 1)
    );
  }
  function goNext() {
    setCursor((c) =>
      mode === "month" ? new Date(c.getFullYear() + 1, 0, 1) : new Date(c.getFullYear(), c.getMonth() + 1, 1)
    );
  }
  function goToday() {
    setCursor(new Date());
  }

  const highlighted = mode === "week" && hoverKey ? weekWindowKeys(new Date(`${hoverKey}T00:00:00`)) : null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide xwide cal-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cal-head">
          <h2>{title}</h2>
          <button type="button" className="btn-ghost small" onClick={onClose}>
            Close
          </button>
        </div>

        {mode !== "month" && (
          <div className="cal-toolbar">
            <div className="cal-nav">
              <button type="button" className="btn-ghost small" onClick={goPrev} aria-label="Previous month">
                ‹
              </button>
              <b className="cal-label">{cursor.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</b>
              <button type="button" className="btn-ghost small" onClick={goNext} aria-label="Next month">
                ›
              </button>
              <button type="button" className="btn-ghost small" onClick={goToday}>
                Today
              </button>
            </div>
            {mode === "week" && <span className="muted" style={{ fontSize: 11.5 }}>Pick the last day of the week you want.</span>}
          </div>
        )}

        {mode === "month" && (
          <div className="cal-toolbar">
            <div className="cal-nav">
              <button type="button" className="btn-ghost small" onClick={goPrev} aria-label="Previous year">
                ‹
              </button>
              <b className="cal-label">{cursor.getFullYear()}</b>
              <button type="button" className="btn-ghost small" onClick={goNext} aria-label="Next year">
                ›
              </button>
              <button type="button" className="btn-ghost small" onClick={goToday}>
                This month
              </button>
            </div>
          </div>
        )}

        {error && <p className="error">{error}</p>}
        {!error && !dates && <Loader size="compact" label="Loading sales history…" />}

        {!error && dates && mode !== "month" && (
          <>
            <div className="cal-weekday-row">
              {WEEKDAY_LABELS.map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>
            <div className="cal-grid" onMouseLeave={() => setHoverKey(null)}>
              {monthGrid(cursor).map((d) => {
                const key = dateKey(d);
                const inMonth = d.getMonth() === cursor.getMonth();
                const hasData = dateSet.has(key);
                const isSelected = key === initialKey;
                const inHoveredWeek = highlighted?.has(key) ?? false;
                return (
                  <button
                    key={key}
                    type="button"
                    className={[
                      "cal-day",
                      inMonth ? "" : "cal-day-outside",
                      key === todayKey ? "cal-day-today" : "",
                      isSelected ? "cal-day-selected" : "",
                      inHoveredWeek ? "cal-day-in-week" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onMouseEnter={() => setHoverKey(key)}
                    onClick={() => onSelect(key)}
                  >
                    <span className="cal-day-num">{d.getDate()}</span>
                    {hasData && (
                      <span className="cal-day-dots">
                        <span className="cal-dot cal-dot-data" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="cal-legend">
              <span>
                <span className="cal-dot cal-dot-data" /> Has sales data
              </span>
            </div>
          </>
        )}

        {!error && dates && mode === "month" && (
          <div className="cal-year-grid">
            {MONTH_LABELS.map((label, i) => {
              const monthDate = new Date(cursor.getFullYear(), i, 1);
              const key = dateKey(monthDate);
              const monthKey = `${cursor.getFullYear()}-${pad2(i + 1)}`;
              const hasData = monthsWithData.has(monthKey);
              const isSelected = monthKey === initialKey.slice(0, 7);
              const isThisMonth = monthKey === todayKey.slice(0, 7);
              return (
                <button
                  key={label}
                  type="button"
                  className={[
                    "cal-month-cell",
                    isThisMonth ? "cal-day-today" : "",
                    isSelected ? "cal-day-selected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => onSelect(key)}
                >
                  <span>{label}</span>
                  {hasData && <span className="cal-dot cal-dot-data" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
