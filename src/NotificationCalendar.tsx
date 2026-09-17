import { useEffect, useMemo, useState } from "react";
import type { PurchaseOrder, Supplier } from "./api";
import { fetchPurchaseOrders } from "./api";
import Loader from "./Loader";

interface Props {
  accessToken: string;
  suppliers: Supplier[];
  onOpenPO: (id: string) => void;
  onOpenSupplier: (id: string) => void;
  onClose: () => void;
}

type ViewMode = "month" | "week";
type MarkerKind = "expected" | "received";
interface DayMarker {
  po: PurchaseOrder;
  kind: MarkerKind;
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

// Local-date key, deliberately not toISOString() -- that's UTC-based and can
// land on the wrong calendar day near midnight for anyone west of Greenwich.
// expected_date/received_date come back from the backend as plain
// "YYYY-MM-DD" strings (a DRF DateField), so this is what they're compared
// against directly, with no Date round-trip on that side at all.
function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

// Monday of the week containing d (0=Mon..6=Sun), matching App.tsx's own
// nextDeliveryDate() convention elsewhere in the app.
function mondayOf(d: Date): Date {
  const dow = (d.getDay() + 6) % 7;
  return addDays(d, -dow);
}

// A fixed 6-row/42-day grid (rather than a variable 4-6 rows depending on
// the month) so the modal doesn't visibly resize as you page between months.
function monthGrid(cursor: Date): Date[] {
  const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = mondayOf(firstOfMonth);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

function weekGrid(cursor: Date): Date[] {
  const start = mondayOf(cursor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

function fmtDay(key: string): string {
  const d = new Date(`${key}T00:00:00`);
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

// The delivery calendar -- Phase 2 of the SAWIS notification plan. Opens
// when the date next to the notification icon (NotificationBell.tsx) is
// clicked. Needs no new backend endpoint: PurchaseOrder.expected_date/
// received_date already exist and already come back denormalized with
// supplier_name/location_name, so there's nothing to join client-side.
//
// Fetches its own copy of every PurchaseOrder on open (not shared with
// App.tsx's top-level state) -- this is opened rarely compared to the
// pages that actually work with POs day to day, so a dedicated fetch each
// time it opens is simpler than threading another always-loaded array
// through the whole app, and guarantees the calendar never shows stale data
// from before a PO's dates were last edited.
export default function NotificationCalendar({ accessToken, suppliers, onOpenPO, onOpenSupplier, onClose }: Props) {
  const [pos, setPos] = useState<PurchaseOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("month");
  const [cursor, setCursor] = useState(new Date());
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

  useEffect(() => {
    fetchPurchaseOrders(accessToken)
      .then(setPos)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load deliveries."));
  }, [accessToken]);

  const markersByDay = useMemo(() => {
    const map: Record<string, DayMarker[]> = {};
    (pos ?? []).forEach((po) => {
      if (po.expected_date) {
        (map[po.expected_date] ??= []).push({ po, kind: "expected" });
      }
      if (po.received_date) {
        (map[po.received_date] ??= []).push({ po, kind: "received" });
      }
    });
    return map;
  }, [pos]);

  // Suppliers' delivery_day is a weekly recurring pattern, not a dated PO --
  // grouped by weekday (0=Mon..6=Sun, matching mondayOf's convention below)
  // rather than by a specific date, so every occurrence of that weekday in
  // the visible grid shows the same reminder. Archived suppliers are left
  // out -- no longer being ordered from, so no point flagging their old
  // delivery day.
  const suppliersByWeekday = useMemo(() => {
    const map: Record<number, Supplier[]> = {};
    suppliers.forEach((s) => {
      if (s.archived || s.delivery_day === null) return;
      (map[s.delivery_day] ??= []).push(s);
    });
    return map;
  }, [suppliers]);

  const todayKey = dateKey(new Date());
  const gridDays = view === "month" ? monthGrid(cursor) : weekGrid(cursor);

  const monthLabel = cursor.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const weekDays = view === "week" ? gridDays : null;
  const weekLabel = weekDays
    ? `${weekDays[0].toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${weekDays[6].toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
    : "";

  function goPrev() {
    setSelectedDayKey(null);
    setCursor((c) => (view === "month" ? new Date(c.getFullYear(), c.getMonth() - 1, 1) : addDays(c, -7)));
  }
  function goNext() {
    setSelectedDayKey(null);
    setCursor((c) => (view === "month" ? new Date(c.getFullYear(), c.getMonth() + 1, 1) : addDays(c, 7)));
  }
  function goToday() {
    setSelectedDayKey(null);
    setCursor(new Date());
  }

  const selectedEntries = selectedDayKey ? markersByDay[selectedDayKey] ?? [] : [];
  const selectedScheduled = selectedDayKey
    ? suppliersByWeekday[(new Date(`${selectedDayKey}T00:00:00`).getDay() + 6) % 7] ?? []
    : [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide xwide cal-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cal-head">
          <h2>Delivery calendar</h2>
          <button type="button" className="btn-ghost small" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="cal-toolbar">
          <div className="cal-nav">
            <button type="button" className="btn-ghost small" onClick={goPrev} aria-label="Previous">
              ‹
            </button>
            <b className="cal-label">{view === "month" ? monthLabel : weekLabel}</b>
            <button type="button" className="btn-ghost small" onClick={goNext} aria-label="Next">
              ›
            </button>
            <button type="button" className="btn-ghost small" onClick={goToday}>
              Today
            </button>
          </div>
          <div className="cal-view-toggle">
            <button
              type="button"
              className={`cal-view-btn ${view === "month" ? "on" : ""}`}
              onClick={() => setView("month")}
            >
              Month
            </button>
            <button
              type="button"
              className={`cal-view-btn ${view === "week" ? "on" : ""}`}
              onClick={() => setView("week")}
            >
              Week
            </button>
          </div>
        </div>

        {error ? (
          <p className="error">{error}</p>
        ) : !pos ? (
          <Loader size="compact" label="Loading deliveries…" />
        ) : (
          <>
            <div className="cal-weekday-row">
              {WEEKDAY_LABELS.map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>
            <div className={`cal-grid ${view === "week" ? "cal-grid-week" : ""}`}>
              {gridDays.map((d) => {
                const key = dateKey(d);
                const entries = markersByDay[key] ?? [];
                const inMonth = view === "week" || d.getMonth() === cursor.getMonth();
                const hasExpected = entries.some((e) => e.kind === "expected");
                const hasReceived = entries.some((e) => e.kind === "received");
                const scheduled = suppliersByWeekday[(d.getDay() + 6) % 7] ?? [];
                const hasScheduled = scheduled.length > 0;
                return (
                  <button
                    key={key}
                    type="button"
                    className={[
                      "cal-day",
                      inMonth ? "" : "cal-day-outside",
                      key === todayKey ? "cal-day-today" : "",
                      key === selectedDayKey ? "cal-day-selected" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    disabled={entries.length === 0 && !hasScheduled}
                    onClick={() => setSelectedDayKey((k) => (k === key ? null : key))}
                  >
                    <span className="cal-day-num">{d.getDate()}</span>
                    {(hasExpected || hasReceived || hasScheduled) && (
                      <span className="cal-day-dots">
                        {hasExpected && <span className="cal-dot cal-dot-expected" />}
                        {hasReceived && <span className="cal-dot cal-dot-received" />}
                        {hasScheduled && <span className="cal-dot cal-dot-scheduled" />}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="cal-legend">
              <span>
                <span className="cal-dot cal-dot-expected" /> Expected
              </span>
              <span>
                <span className="cal-dot cal-dot-received" /> Received
              </span>
              <span>
                <span className="cal-dot cal-dot-scheduled" /> Supplier's regular delivery day
              </span>
            </div>

            {selectedDayKey && (
              <div className="cal-day-detail">
                <b>{fmtDay(selectedDayKey)}</b>
                {selectedEntries.length === 0 && selectedScheduled.length === 0 ? (
                  <p className="muted">No deliveries.</p>
                ) : (
                  <div className="cal-day-detail-list">
                    {selectedEntries.map((entry, i) => (
                      <button
                        key={`${entry.po.id}-${entry.kind}-${i}`}
                        type="button"
                        className="cal-day-detail-row"
                        onClick={() => onOpenPO(entry.po.id)}
                      >
                        <span className={`cal-kind-tag cal-kind-${entry.kind}`}>
                          {entry.kind === "expected" ? "Expected" : "Received"}
                        </span>
                        <span className="cal-day-detail-main">
                          <b>{entry.po.po_number || "PO"}</b>
                          <span className="muted"> · {entry.po.supplier_name}</span>
                        </span>
                        <span className="muted" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>
                          {entry.po.location_name}
                        </span>
                      </button>
                    ))}
                    {selectedScheduled.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className="cal-day-detail-row"
                        onClick={() => onOpenSupplier(s.id)}
                      >
                        <span className="cal-kind-tag cal-kind-scheduled">Scheduled</span>
                        <span className="cal-day-detail-main">
                          <b>{s.name}</b>
                          <span className="muted"> · regular delivery day</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
