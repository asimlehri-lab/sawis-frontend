import { useEffect, useRef, useState } from "react";
import { fetchNotifications } from "./api";
import type { AppNotification, CatalogItem, Location, StockMovementRow } from "./api";
import NotificationCalendar from "./NotificationCalendar";

// How far past/future of today a persisted Notification (Phase 3 — delivery
// reminders, inventory-check-due) is still worth showing in the bell. Not a
// meaningful business cutoff, just keeps the dropdown from listing
// something that's been overdue for weeks — the backend's own
// generate_notifications command has a much longer (60-day) prune window,
// so this is purely a frontend "what's worth surfacing right now" filter.
const NOTIF_WINDOW_PAST_DAYS = 3;
const NOTIF_WINDOW_FUTURE_DAYS = 7;

function daysFromToday(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

function fmtRelativeDay(dateStr: string): string {
  const diff = daysFromToday(dateStr);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  const label = new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return diff < 0 ? `${label} · overdue` : label;
}

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
// data the app already has, with no new backend endpoint.
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
//
// Phase 3: the dropdown now also surfaces the two persisted, date-scheduled
// notification kinds (delivery reminders, inventory-check-due) alongside
// the still-live-computed reorder alert above -- fetched once on mount via
// fetchNotifications() and windowed client-side (see NOTIF_WINDOW_*), the
// same "no per-user dismissed state, just relevance-by-date" design as the
// backend's own generate_notifications command. A delivery-reminder row is
// clickable straight through to its PurchaseOrder (onOpenPO); an
// inventory-check-due row has no PO to jump to, so it's plain text.
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
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  // Fetched once on mount, same as NotificationCalendar's own PurchaseOrder
  // fetch -- this is a small, org-wide list (see NotificationViewSet), not
  // worth threading through App.tsx's top-level state for a dropdown that's
  // opened occasionally. A silent failure here just means the bell falls
  // back to reorder-only, which is exactly what it did before Phase 3.
  useEffect(() => {
    fetchNotifications(accessToken)
      .then(setNotifications)
      .catch(() => {});
  }, [accessToken]);

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

  const scheduled = notifications
    .filter((n) => daysFromToday(n.relevant_date) >= -NOTIF_WINDOW_PAST_DAYS)
    .filter((n) => daysFromToday(n.relevant_date) <= NOTIF_WINDOW_FUTURE_DAYS)
    .sort((a, b) => a.relevant_date.localeCompare(b.relevant_date));

  const totalCount = alerts.length + scheduled.length;

  const today = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  return (
    <div className="notif-row" ref={rootRef}>
      <button
        type="button"
        className={`notif-bell ${totalCount > 0 ? "has-alerts" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-label={totalCount > 0 ? `Notifications, ${totalCount} item${totalCount === 1 ? "" : "s"}` : "Notifications"}
      >
        <svg viewBox="0 0 100 100" className="cloche-mark" aria-hidden="true">
          <path className="cloche-mark-body" d="M 26 74 Q 26 34 50 34 Q 74 34 74 74" />
          <line className="cloche-mark-body" x1="20" y1="74" x2="80" y2="74" />
          <line className="cloche-mark-body" x1="50" y1="34" x2="50" y2="30" />
          <circle className="cloche-mark-knob" cx="50" cy="28" r="6" />
        </svg>
        {totalCount > 0 && <span className="notif-badge">{totalCount}</span>}
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
            <b>{totalCount === 0 ? "All caught up" : `${totalCount} notification${totalCount === 1 ? "" : "s"}`}</b>
          </div>
          {totalCount === 0 ? (
            <p className="muted" style={{ margin: "10px 14px 14px", fontSize: 12.5 }}>
              Nothing needs attention right now.
            </p>
          ) : (
            <>
              {alerts.length > 0 && (
                <>
                  <div className="notif-section-label">Below par</div>
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

              {scheduled.length > 0 && (
                <>
                  <div className="notif-section-label">Coming up</div>
                  <div className="notif-list">
                    {scheduled.map((n) =>
                      n.kind === "delivery_reminder" && n.purchase_order ? (
                        <button
                          key={n.id}
                          type="button"
                          className="notif-item notif-item-clickable"
                          onClick={() => {
                            setOpen(false);
                            onOpenPO(n.purchase_order as string);
                          }}
                        >
                          <div>
                            <b>{n.po_number || "Delivery"} due</b>
                            <span className="muted"> · {n.location_name}</span>
                            {n.supplier_name && <span className="muted"> · {n.supplier_name}</span>}
                          </div>
                          <span className="muted" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>
                            {fmtRelativeDay(n.relevant_date)}
                          </span>
                        </button>
                      ) : (
                        <div key={n.id} className="notif-item">
                          <div>
                            <b>Inventory check due</b>
                            <span className="muted"> · {n.location_name}</span>
                          </div>
                          <span className="muted" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>
                            {fmtRelativeDay(n.relevant_date)}
                          </span>
                        </div>
                      )
                    )}
                  </div>
                </>
              )}
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
