import { useEffect, useRef, useState } from "react";
import type { CatalogItem, Location, StockMovementRow } from "./api";
import NotificationCalendar from "./NotificationCalendar";

interface Props {
  items: CatalogItem[];
  locations: Location[];
  stockMovements: StockMovementRow[];
  accessToken: string;
  onViewReorder: () => void;
  onOpenPO: (id: string) => void;
}

interface ReorderAlert {
  key: string;
  itemName: string;
  locationName: string;
  onHand: number;
  parLevel: number;
  baseUnit: string;
}

// The notification bell, top-right of the content header (see App.tsx's
// <main> -- a small persistent bar above every page, separate from the
// sidebar's brand mark, per a UX call on Sep 14 2026: a bell that shakes
// right next to the logo competes with the brand for attention, and
// top-right is where users actually expect to find alerts). Phase 1 of the
// SAWIS notification plan -- covers one alert type (items below par) using
// data the app already has, with no new backend endpoint. Later phases
// (delivery-coming-soon / inventory-check-due reminders, a persisted
// Notification record, email) need a real scheduled job on the backend and
// are deliberately not part of this component -- see the notification plan
// doc for the full phased build.
//
// The icon is SAWIS's own cloche mark (the same dome-and-knob shape as
// Loader.tsx's loading animation), not a generic bell glyph -- it rings
// (rotates back and forth) instead of lifting straight up, but it's
// recognizably the same brand symbol either way.
//
// On-hand is derived from the stock_movement ledger client-side (summing
// qty_delta per item/location/department, the same append-only-ledger
// principle every other screen in the app is built on) rather than calling
// the on_hand endpoint per holding the way Reorder.tsx/Inventory.tsx do for
// one selected location at a time -- that would mean one request per
// holding per location just to light up a badge. Fine at today's data
// volume; if stock_movement ever grows large enough for this to matter, the
// right fix is a small backend summary endpoint, not more client-side
// filtering.
//
// Deliberately no persisted "seen"/"dismissed" state -- the bell always
// reflects what's true right now. An item drops off the list the moment
// it's restocked, and nothing can go stale by being dismissed while still
// genuinely low (the option chosen when this was scoped with the user).
//
// Phase 2 (Sep 14 2026): today's date is now clickable, opening
// NotificationCalendar.tsx -- the delivery calendar. Kept as a separate
// component/file rather than folded in here since it has its own real data
// dependency (every PurchaseOrder) and its own fairly involved month/week
// grid -- this file stays focused on the alert-list dropdown.
export default function NotificationBell({
  items,
  locations,
  stockMovements,
  accessToken,
  onViewReorder,
  onOpenPO,
}: Props) {
  const [open, setOpen] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  function locationName(id: string): string {
    return locations.find((l) => l.id === id)?.name ?? "Unknown location";
  }

  function onHandFor(itemId: string, locationId: string, department: string): number {
    return stockMovements
      .filter((m) => m.item === itemId && m.location === locationId && m.department === department)
      .reduce((sum, m) => sum + Number(m.qty_delta), 0);
  }

  const alerts: ReorderAlert[] = items
    .filter((it) => !it.archived)
    .flatMap((it) =>
      it.holdings
        .map((h) => ({
          key: h.id,
          itemName: it.name,
          locationName: locationName(h.location),
          onHand: onHandFor(it.id, h.location, h.department),
          parLevel: Number(h.par_level),
          baseUnit: it.base_unit,
        }))
        .filter((a) => a.onHand < a.parLevel)
    );

  const today = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  return (
    <div className="notif-row" ref={rootRef}>
      <button
        type="button"
        className={`notif-bell ${alerts.length > 0 ? "has-alerts" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-label={alerts.length > 0 ? `Notifications, ${alerts.length} item${alerts.length === 1 ? "" : "s"} below par` : "Notifications"}
      >
        <svg viewBox="0 0 100 100" className="cloche-mark" aria-hidden="true">
          <path className="cloche-mark-body" d="M 26 74 Q 26 34 50 34 Q 74 34 74 74" />
          <line className="cloche-mark-body" x1="20" y1="74" x2="80" y2="74" />
          <line className="cloche-mark-body" x1="50" y1="34" x2="50" y2="30" />
          <circle className="cloche-mark-knob" cx="50" cy="28" r="6" />
        </svg>
        {alerts.length > 0 && <span className="notif-badge">{alerts.length}</span>}
      </button>
      <button
        type="button"
        className="notif-date"
        onClick={() => {
          setOpen(false);
          setShowCalendar(true);
        }}
      >
        {today}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-panel-head">
            <b>{alerts.length === 0 ? "All caught up" : `${alerts.length} below par`}</b>
          </div>
          {alerts.length === 0 ? (
            <p className="muted" style={{ margin: "10px 14px 14px", fontSize: 12.5 }}>
              Nothing is below par right now.
            </p>
          ) : (
            <>
              <div className="notif-list">
                {alerts.map((a) => (
                  <div key={a.key} className="notif-item">
                    <div>
                      <b>{a.itemName}</b>
                      <span className="muted"> · {a.locationName}</span>
                    </div>
                    <span className="muted" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>
                      {a.onHand.toFixed(2)} / {a.parLevel} {a.baseUnit}
                    </span>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="btn-ghost small notif-view-btn"
                onClick={() => {
                  setOpen(false);
                  onViewReorder();
                }}
              >
                View reorder list →
              </button>
            </>
          )}
        </div>
      )}

      {showCalendar && (
        <NotificationCalendar
          accessToken={accessToken}
          onClose={() => setShowCalendar(false)}
          onOpenPO={(id) => {
            setShowCalendar(false);
            onOpenPO(id);
          }}
        />
      )}
    </div>
  );
}
