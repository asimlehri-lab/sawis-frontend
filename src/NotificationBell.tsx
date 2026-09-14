import { useEffect, useRef, useState } from "react";
import type { CatalogItem, Location, StockMovementRow } from "./api";

interface Props {
  items: CatalogItem[];
  locations: Location[];
  stockMovements: StockMovementRow[];
  onViewReorder: () => void;
}

interface ReorderAlert {
  key: string;
  itemName: string;
  locationName: string;
  onHand: number;
  parLevel: number;
  baseUnit: string;
}

// The notification bell in the sidebar's top-left corner. Phase 1 of the
// SAWIS notification plan -- covers one alert type (items below par) using
// data the app already has, with no new backend endpoint. Later phases
// (delivery-coming-soon / inventory-check-due reminders, a persisted
// Notification record, email) need a real scheduled job on the backend and
// are deliberately not part of this component -- see the notification plan
// doc for the full phased build.
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
export default function NotificationBell({ items, locations, stockMovements, onViewReorder }: Props) {
  const [open, setOpen] = useState(false);
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
        <svg viewBox="0 0 24 24" className="bell-icon" aria-hidden="true">
          <path d="M12 3.4c-.94 0-1.7.76-1.7 1.7v.46C7.75 6.1 5.9 8.46 5.9 11.3v3.5L4.2 17.3c-.3.44.02 1.03.55 1.03h14.5c.53 0 .84-.6.55-1.03l-1.7-2.5v-3.5c0-2.84-1.85-5.2-4.4-5.74V5.1c0-.94-.76-1.7-1.7-1.7Z" />
          <path d="M9.7 19.3a2.3 2.3 0 0 0 4.6 0Z" />
        </svg>
        {alerts.length > 0 && <span className="notif-badge">{alerts.length}</span>}
      </button>
      <span className="notif-date">{today}</span>

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
    </div>
  );
}
