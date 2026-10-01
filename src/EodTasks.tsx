import { useEffect, useState } from "react";
import { costBand, costBandColor, fetchNotifications, fetchStockCounts } from "./api";
import type { AppNotification, CatalogItem, CostBand, Location, Me, Recipe, StockCountRow, StockMovementRow } from "./api";

interface Props {
  me: Me;
  accessToken: string;
  location: string;
  locations: Location[];
  recipes: Recipe[];
  items: CatalogItem[];
  stockMovements: StockMovementRow[];
  onOpenRecipe: (id: string) => void;
  onOpenPO: (id: string) => void;
  onViewReorder: () => void;
  onNavigateApp: (label: string) => void;
}

// Same windowing as NotificationBell.tsx's own "Coming up" section -- kept
// as its own copy rather than a shared import so this tab and the bell can
// keep evolving independently (same reasoning as onHandFor below).
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

const sectionHeadStyle: React.CSSProperties = {
  fontSize: 13,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--muted)",
  fontWeight: 700,
  margin: 0,
};

function locationNameOf(locations: Location[], id: string): string {
  return locations.find((l) => l.id === id)?.name ?? "Unknown location";
}

// Tinted background to pair with costBandColor()'s solid border/icon
// colour, same "soft fill + solid border" treatment Inventory's section
// cards use for their own complete/overdue states.
function bandSoftColor(band: CostBand): string {
  return band === "good" ? "var(--good-soft)" : band === "caution" ? "var(--caution-soft)" : "var(--brick-soft)";
}

// The End of day > Tasks tab -- role-gated "what SAWIS has found and needs
// action" overview, per the brief given 2026-09-30: not a manually-authored
// checklist template, but a live read of real system state, auto-resolving
// the moment the underlying issue is fixed. Admin/manager/finance get the
// sensitive/financial view (cost-vs-target, below-par -> reorder); staff
// get their own assigned duties (inventory count, waste log). Deliberately
// two entirely separate components below rather than one with branches
// throughout -- the two roles' tasks share almost no data or markup, and
// the split itself is the whole point ("Separate lists per role").
//
// Nothing here is a new backend endpoint -- every task type is computed
// from data this app already fetches elsewhere (recipes' own
// plate_food_cost_pct + Location's cost targets for the cost gauge, the
// same stock-movement-ledger math NotificationBell already does for below-
// par, and StockCount/CountAssignment for staff's assigned counts). If a
// task type is ever added that genuinely needs an aggregate the ledger
// can't answer cheaply client-side, that's the point to add a backend
// endpoint -- not before.
export default function EodTasks({
  me,
  accessToken,
  location,
  locations,
  recipes,
  items,
  stockMovements,
  onOpenRecipe,
  onOpenPO,
  onViewReorder,
  onNavigateApp,
}: Props) {
  const isManagerOrAbove = me.memberships.some(
    (m) => m.role === "admin" || m.role === "manager" || m.role === "finance"
  );

  // Fetched once here (not per-role-view) since only one of the two views
  // below ever mounts at a time, and this is the same small org-wide list
  // NotificationBell already fetches for its own "Coming up" section.
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  useEffect(() => {
    fetchNotifications(accessToken).then(setNotifications).catch(() => {});
  }, [accessToken]);

  return isManagerOrAbove ? (
    <ManagerTasks
      locations={locations}
      location={location}
      recipes={recipes}
      items={items}
      stockMovements={stockMovements}
      notifications={notifications}
      onOpenRecipe={onOpenRecipe}
      onOpenPO={onOpenPO}
      onViewReorder={onViewReorder}
    />
  ) : (
    <StaffTasks
      me={me}
      accessToken={accessToken}
      location={location}
      locations={locations}
      stockMovements={stockMovements}
      notifications={notifications}
      onNavigateApp={onNavigateApp}
    />
  );
}

function ManagerTasks({
  location,
  locations,
  recipes,
  items,
  stockMovements,
  notifications,
  onOpenRecipe,
  onOpenPO,
  onViewReorder,
}: {
  location: string;
  locations: Location[];
  recipes: Recipe[];
  items: CatalogItem[];
  stockMovements: StockMovementRow[];
  notifications: AppNotification[];
  onOpenRecipe: (id: string) => void;
  onOpenPO: (id: string) => void;
  onViewReorder: () => void;
}) {
  // Delivery reminders (Phase 3 notifications, generated daily server-side
  // from each PurchaseOrder's expected_date) -- ordering/financial in
  // nature, so grouped with the rest of this manager-only view rather than
  // staff's. Inventory-check-due notifications go to StaffTasks instead
  // (see below) -- that one's an operational "go count something" prompt.
  const upcomingDeliveries = notifications
    .filter((n) => n.kind === "delivery_reminder")
    .filter((n) => daysFromToday(n.relevant_date) >= -NOTIF_WINDOW_PAST_DAYS)
    .filter((n) => daysFromToday(n.relevant_date) <= NOTIF_WINDOW_FUTURE_DAYS)
    .sort((a, b) => a.relevant_date.localeCompare(b.relevant_date));
  // This tab's own location picker feeds the cost targets below (targets
  // are per-location, per Settings > Locations); below-par stays
  // unscoped, same as NotificationBell, since a holding already carries
  // its own location and a manager overseeing multiple sites shouldn't
  // have low stock at site B hidden just because site A is selected here.
  const activeLocation = locations.find((l) => l.id === location);
  const foodTarget = activeLocation ? Number(activeLocation.target_food_cost_pct) || 30 : 30;
  const drinkTarget = activeLocation ? Number(activeLocation.target_drink_cost_pct) || 30 : 30;

  const costBreaches = recipes
    .filter((r) => r.kind === "dish" && r.plate_food_cost_pct !== null && r.plate_food_cost_pct > 0)
    .map((r) => {
      const target = r.menu_group === "drink" ? drinkTarget : foodTarget;
      const pct = r.plate_food_cost_pct as number;
      return { id: r.id, name: r.name, pct, target, over: pct - target, band: costBand(pct, target) };
    })
    .filter((r) => r.over > 0)
    .sort((a, b) => b.over - a.over);

  // Identical math to NotificationBell.tsx's onHandFor/alerts -- on-hand
  // derived client-side from the stock_movement ledger (sum of qty_delta
  // per item/location/department) rather than a per-holding API call.
  // Kept as a literal copy, not a shared import, so this tab and the bell
  // can each evolve independently without one refactor risking the other.
  function onHandFor(itemId: string, locId: string, department: string): number {
    return stockMovements
      .filter((m) => m.item === itemId && m.location === locId && m.department === department)
      .reduce((sum, m) => sum + Number(m.qty_delta), 0);
  }

  const belowPar = items
    .filter((it) => !it.archived)
    .flatMap((it) =>
      it.holdings
        .map((h) => ({
          key: h.id,
          itemName: it.name,
          locationName: locationNameOf(locations, h.location),
          onHand: onHandFor(it.id, h.location, h.department),
          parLevel: Number(h.par_level),
          baseUnit: it.base_unit,
        }))
        .filter((a) => a.onHand < a.parLevel)
    )
    .sort((a, b) => a.onHand - a.parLevel - (b.onHand - b.parLevel));

  return (
    <div>
      <p className="muted" style={{ marginTop: -4, marginBottom: 16, fontSize: 12.5 }}>
        What SAWIS has found that needs your attention — staff don't see this tab's contents, since it's cost and
        ordering data. Nothing here needs dismissing by hand: an item drops off the moment the number behind it does.
      </p>

      <section className="card task-section">
        <div className="task-section-head">
          <h2 style={sectionHeadStyle}>Cost breaching target</h2>
          <span className={`tag ${costBreaches.length ? "bad" : "good"}`}>
            {costBreaches.length ? `${costBreaches.length} over target` : "All on target"}
          </span>
        </div>
        {costBreaches.length === 0 ? (
          <p className="task-empty">Every dish is within its food/drink-cost target.</p>
        ) : (
          <div className="task-grid">
            {costBreaches.slice(0, 11).map((r) => {
              const scaleMax = Math.max(r.target * 2, 50);
              return (
                <button
                  key={r.id}
                  type="button"
                  className="task-box task-box-clickable"
                  style={{ borderColor: costBandColor(r.band), background: bandSoftColor(r.band) }}
                  onClick={() => onOpenRecipe(r.id)}
                >
                  <div className="task-box-icon" style={{ background: costBandColor(r.band) }}>💰</div>
                  <div className="task-box-name">{r.name}</div>
                  <div className="task-box-meta">
                    {r.pct.toFixed(1)}% · target {r.target}%
                  </div>
                  <div className="gauge-track">
                    <div
                      className="gauge-fill"
                      style={{
                        width: `${Math.min((r.pct / scaleMax) * 100, 100)}%`,
                        background: costBandColor(r.band),
                      }}
                    />
                    <div className="gauge-tgt" style={{ left: `${Math.min((r.target / scaleMax) * 100, 100)}%` }} />
                  </div>
                </button>
              );
            })}
            {costBreaches.length > 11 && (
              <div className="task-empty">+{costBreaches.length - 11} more over target — see Recipes for the full list.</div>
            )}
          </div>
        )}
      </section>

      <section className="card task-section">
        <div className="task-section-head">
          <h2 style={sectionHeadStyle}>Items below par</h2>
          <span className={`tag ${belowPar.length ? "bad" : "good"}`}>
            {belowPar.length ? `${belowPar.length} to reorder` : "All stocked"}
          </span>
        </div>
        {belowPar.length === 0 ? (
          <p className="task-empty">Nothing is below par right now.</p>
        ) : (
          <>
            <div className="task-grid">
              {belowPar.slice(0, 11).map((a) => (
                <button key={a.key} type="button" className="task-box task-box-clickable task-box-bad" onClick={onViewReorder}>
                  <div className="task-box-icon" style={{ background: "var(--caution)" }}>📦</div>
                  <div className="task-box-name">{a.itemName}</div>
                  <div className="task-box-meta">{a.locationName}</div>
                  <div className="task-box-stat" style={{ color: "var(--caution)" }}>
                    {a.onHand.toFixed(2)} / {a.parLevel} {a.baseUnit}
                  </div>
                </button>
              ))}
              {belowPar.length > 11 && <div className="task-empty">+{belowPar.length - 11} more below par.</div>}
            </div>
            <button type="button" className="btn-ghost small" style={{ marginTop: 10 }} onClick={onViewReorder}>
              Go to reorder list →
            </button>
          </>
        )}
      </section>

      <section className="card task-section">
        <div className="task-section-head">
          <h2 style={sectionHeadStyle}>Upcoming deliveries</h2>
          <span className={`tag ${upcomingDeliveries.length ? "warn" : "good"}`}>
            {upcomingDeliveries.length ? `${upcomingDeliveries.length} due soon` : "None due soon"}
          </span>
        </div>
        {upcomingDeliveries.length === 0 ? (
          <p className="task-empty">Nothing expected in the next {NOTIF_WINDOW_FUTURE_DAYS} days.</p>
        ) : (
          <div className="task-grid">
            {upcomingDeliveries.slice(0, 11).map((n) => {
              const days = daysFromToday(n.relevant_date);
              const boxCls = days < 0 ? "task-box-overdue" : days <= 1 ? "task-box-warn" : "";
              const iconBg = days < 0 ? "var(--brick)" : days <= 1 ? "var(--warn)" : "var(--muted)";
              return (
                <button
                  key={n.id}
                  type="button"
                  className={`task-box task-box-clickable ${boxCls}`}
                  onClick={() => n.purchase_order && onOpenPO(n.purchase_order)}
                >
                  <div className="task-box-icon" style={{ background: iconBg }}>🚚</div>
                  <div className="task-box-name">{n.po_number || "Delivery"}</div>
                  <div className="task-box-meta">
                    {n.location_name}
                    {n.supplier_name && ` · ${n.supplier_name}`}
                  </div>
                  <div className="task-box-stat" style={{ color: iconBg }}>
                    {fmtRelativeDay(n.relevant_date)}
                  </div>
                </button>
              );
            })}
            {upcomingDeliveries.length > 11 && (
              <div className="task-empty">+{upcomingDeliveries.length - 11} more expected soon.</div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function StaffTasks({
  me,
  accessToken,
  location,
  locations,
  stockMovements,
  notifications,
  onNavigateApp,
}: {
  me: Me;
  accessToken: string;
  location: string;
  locations: Location[];
  stockMovements: StockMovementRow[];
  notifications: AppNotification[];
  onNavigateApp: (label: string) => void;
}) {
  // Fetched once on mount -- not worth threading fetchStockCounts through
  // App.tsx's top-level state for a tab that's opened occasionally, same
  // call as NotificationBell/NotificationCalendar already make for their
  // own once-on-mount data.
  const [stockCounts, setStockCounts] = useState<StockCountRow[]>([]);

  useEffect(() => {
    fetchStockCounts(accessToken).then(setStockCounts).catch(() => {});
  }, [accessToken]);

  const myAssignments = stockCounts
    .filter((c) => c.status === "open")
    .flatMap((c) =>
      c.assignments
        .filter((a) => a.assigned_to === me.id && a.status !== "complete")
        .map((a) => ({ ...a, locationName: locationNameOf(locations, c.location) }))
    );

  // A staff member's own membership carries their location; fall back to
  // whichever location this tab (End of day) currently has selected if
  // they somehow have no staff membership on file.
  const myStaffLocation = me.memberships.find((m) => m.role === "staff")?.location ?? location;
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const wasteLoggedToday = stockMovements.some(
    (m) => m.movement_type === "waste" && m.location === myStaffLocation && m.occurred_at.slice(0, 10) === todayStr
  );

  // The location-wide scheduled reminder (Settings > Locations >
  // Inventory check day), not a specific person's assignment -- that's
  // myAssignments above (CountAssignment). This is "your location's due
  // for a count soon," shown to everyone at that location since a
  // schedule-based reminder has no assignee yet to route it to.
  const upcomingChecks = notifications
    .filter((n) => n.kind === "inventory_check_due")
    .filter((n) => daysFromToday(n.relevant_date) >= -NOTIF_WINDOW_PAST_DAYS)
    .filter((n) => daysFromToday(n.relevant_date) <= NOTIF_WINDOW_FUTURE_DAYS)
    .sort((a, b) => a.relevant_date.localeCompare(b.relevant_date));

  return (
    <div>
      <p className="muted" style={{ marginTop: -4, marginBottom: 16, fontSize: 12.5 }}>
        What's on your plate today — once it's done, it drops off this list on its own.
      </p>

      <section className="card task-section">
        <div className="task-section-head">
          <h2 style={sectionHeadStyle}>Inventory counts assigned to you</h2>
          <span className={`tag ${myAssignments.length ? "bad" : "good"}`}>
            {myAssignments.length ? `${myAssignments.length} to do` : "None right now"}
          </span>
        </div>
        {myAssignments.length === 0 ? (
          <p className="task-empty">Nothing assigned to you right now.</p>
        ) : (
          <div className="task-grid">
            {myAssignments.map((a) => {
              const inProgress = a.status === "in_progress";
              const iconBg = inProgress ? "var(--warn)" : "var(--caution)";
              return (
                <button
                  key={a.id}
                  type="button"
                  className={`task-box task-box-clickable ${inProgress ? "task-box-warn" : "task-box-bad"}`}
                  onClick={() => onNavigateApp("Inventory")}
                >
                  <div className="task-box-icon" style={{ background: iconBg }}>🧮</div>
                  <div className="task-box-name">{a.section_name}</div>
                  <div className="task-box-meta">{a.locationName}</div>
                  <div className="task-box-stat" style={{ color: iconBg }}>
                    {inProgress ? "In progress" : "To do"}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="card task-section">
        <div className="task-section-head">
          <h2 style={sectionHeadStyle}>Inventory check coming up</h2>
          <span className={`tag ${upcomingChecks.length ? "warn" : "good"}`}>
            {upcomingChecks.length ? `${upcomingChecks.length} due soon` : "None due soon"}
          </span>
        </div>
        {upcomingChecks.length === 0 ? (
          <p className="task-empty">No inventory check due in the next {NOTIF_WINDOW_FUTURE_DAYS} days.</p>
        ) : (
          <div className="task-grid">
            {upcomingChecks.map((n) => {
              const days = daysFromToday(n.relevant_date);
              const boxCls = days < 0 ? "task-box-overdue" : days <= 1 ? "task-box-warn" : "";
              const iconBg = days < 0 ? "var(--brick)" : days <= 1 ? "var(--warn)" : "var(--muted)";
              return (
                <button
                  key={n.id}
                  type="button"
                  className={`task-box task-box-clickable ${boxCls}`}
                  onClick={() => onNavigateApp("Inventory")}
                >
                  <div className="task-box-icon" style={{ background: iconBg }}>🧮</div>
                  <div className="task-box-name">Inventory check due</div>
                  <div className="task-box-meta">{n.location_name}</div>
                  <div className="task-box-stat" style={{ color: iconBg }}>
                    {fmtRelativeDay(n.relevant_date)}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="card task-section">
        <div className="task-section-head">
          <h2 style={sectionHeadStyle}>Waste log</h2>
          <span className={`tag ${wasteLoggedToday ? "good" : "warn"}`}>
            {wasteLoggedToday ? "Done for today" : "Not logged yet"}
          </span>
        </div>
        {wasteLoggedToday ? (
          <p className="task-empty">Waste has been logged today — nothing more to do here.</p>
        ) : (
          <button type="button" className="btn-ghost small" style={{ marginTop: 10 }} onClick={() => onNavigateApp("Waste log")}>
            Log today's waste →
          </button>
        )}
      </section>
    </div>
  );
}
