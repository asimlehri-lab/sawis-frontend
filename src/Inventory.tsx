import { Fragment, useEffect, useState } from "react";
import {
  createCountAssignment,
  createCountLine,
  createSection,
  createStockCount,
  createStockMovement,
  deleteSection,
  fetchOnHand,
  updateCountAssignment,
  updateItemHolding,
  updateSection,
  updateStockCount,
} from "./api";
import type {
  CatalogItem,
  ItemSupplierRow,
  Location,
  Me,
  Membership,
  Section,
  StockCountRow,
  StockMovementRow,
} from "./api";

interface Props {
  accessToken: string;
  me: Me;
  items: CatalogItem[];
  locations: Location[];
  sections: Section[];
  sectionsError: string | null;
  stockCounts: StockCountRow[] | null;
  stockCountsError: string | null;
  itemSupplierLinks: ItemSupplierRow[];
  stockMovements: StockMovementRow[];
  memberships: Membership[];
  onSectionsChanged: () => void;
  onStockCountsChanged: () => void;
  onItemsChanged: () => void;
}

const DEPARTMENTS: { value: "kitchen" | "bar" | "foh"; label: string }[] = [
  { value: "kitchen", label: "Kitchen" },
  { value: "bar", label: "Bar" },
  { value: "foh", label: "Front of house" },
];

const REASONS = [
  { value: "spoilage", label: "Spoilage" },
  { value: "breakage", label: "Breakage / spill" },
  { value: "over_portioning", label: "Over-portioning" },
  { value: "miscount", label: "Miscount" },
  { value: "theft", label: "Theft suspected" },
  { value: "short_delivery", label: "Delivery short" },
  { value: "used_in_special", label: "Used in special" },
  { value: "other", label: "Other" },
];

function deptLabel(v: string): string {
  return DEPARTMENTS.find((d) => d.value === v)?.label ?? v;
}

function reasonLabel(v: string): string {
  return REASONS.find((r) => r.value === v)?.label ?? v;
}

// Purely cosmetic — no backend field for this, just a friendly guess from
// the section's name so Manage Sections/Count Sheets don't read as a bare
// list of grey boxes. Falls back to a neutral "store" icon.
function sectionIcon(name: string): { emoji: string; cls: string } {
  const n = name.toLowerCase();
  if (n.includes("freez")) return { emoji: "❄", cls: "ic-freeze" };
  if (n.includes("fridge") || n.includes("chill") || n.includes("cold")) return { emoji: "🧊", cls: "ic-fridge" };
  if (n.includes("bar") || n.includes("wine") || n.includes("cellar")) return { emoji: "🍷", cls: "ic-bar" };
  return { emoji: "📦", cls: "ic-dry" };
}

function staffLabel(m: Membership): string {
  const name = m.name || m.email;
  return m.job_title ? `${name} — ${m.job_title}` : name;
}

interface FlatHolding {
  id: string;
  itemId: string;
  itemName: string;
  baseUnit: string;
  department: "kitchen" | "bar" | "foh";
  section: string | null;
  sectionName: string | null;
  parLevel: number;
}

export default function Inventory({
  accessToken,
  me,
  items,
  locations,
  sections,
  sectionsError,
  stockCounts,
  stockCountsError,
  itemSupplierLinks,
  stockMovements,
  memberships,
  onSectionsChanged,
  onStockCountsChanged,
  onItemsChanged,
}: Props) {
  const [tab, setTab] = useState<"live" | "count" | "sections">("live");
  const [activeLocation, setActiveLocation] = useState(locations[0]?.id ?? "");
  const [onHand, setOnHand] = useState<Record<string, number>>({});
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!activeLocation && locations.length) setActiveLocation(locations[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations]);

  const activeItems = items.filter((i) => !i.archived);
  const holdingsAtLocation: FlatHolding[] = activeItems.flatMap((it) =>
    it.holdings
      .filter((h) => h.location === activeLocation)
      .map((h) => ({
        id: h.id,
        itemId: it.id,
        itemName: it.name,
        baseUnit: it.base_unit,
        department: h.department as "kitchen" | "bar" | "foh",
        section: h.section,
        sectionName: h.section_name,
        parLevel: Number(h.par_level),
      }))
  );

  useEffect(() => {
    if (!activeLocation || holdingsAtLocation.length === 0) return;
    let cancelled = false;
    Promise.all(
      holdingsAtLocation.map((h) =>
        fetchOnHand(accessToken, h.itemId, activeLocation, h.department).then((qty) => [h.id, qty] as const)
      )
    ).then((pairs) => {
      if (cancelled) return;
      setOnHand(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, activeLocation, items.length, refreshTick]);

  function cheapestPrice(itemId: string): number | null {
    const prices = itemSupplierLinks.filter((l) => l.item === itemId).map((l) => Number(l.unit_price));
    if (!prices.length) return null;
    return Math.min(...prices);
  }

  const sectionsHere = sections.filter((s) => s.location === activeLocation);
  const staffHere = memberships.filter((m) => m.location === activeLocation || m.location === null);

  function refreshOnHand() {
    setRefreshTick((t) => t + 1);
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div className="rtabs">
          {(["live", "count", "sections"] as const).map((t) => (
            <button key={t} className={`rtab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
              {t === "live" ? "Live stock" : t === "count" ? "Count sheets" : "Manage sections"}
            </button>
          ))}
        </div>
        {locations.length > 0 && (
          <select
            value={activeLocation}
            onChange={(e) => setActiveLocation(e.target.value)}
            style={{
              fontFamily: "inherit",
              fontSize: 13,
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "8px 10px",
              background: "var(--surface)",
              color: "var(--ink)",
            }}
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {!locations.length && <p className="muted">No locations yet — add one before using Inventory.</p>}

      {locations.length > 0 && tab === "live" && (
        <LiveStockTab
          holdings={holdingsAtLocation}
          onHand={onHand}
          cheapestPrice={cheapestPrice}
          stockCounts={stockCounts ?? []}
          activeLocation={activeLocation}
          stockMovements={stockMovements}
        />
      )}

      {locations.length > 0 && tab === "sections" && (
        <SectionsTab
          accessToken={accessToken}
          activeLocation={activeLocation}
          sections={sectionsHere}
          sectionsError={sectionsError}
          holdings={holdingsAtLocation}
          onSectionsChanged={onSectionsChanged}
          onItemsChanged={() => {
            onItemsChanged();
            refreshOnHand();
          }}
        />
      )}

      {locations.length > 0 && tab === "count" && (
        <CountSheetsTab
          accessToken={accessToken}
          me={me}
          staff={staffHere}
          activeLocation={activeLocation}
          sections={sectionsHere}
          holdings={holdingsAtLocation}
          onHand={onHand}
          cheapestPrice={cheapestPrice}
          stockCounts={stockCounts}
          stockCountsError={stockCountsError}
          onStockCountsChanged={() => {
            onStockCountsChanged();
            refreshOnHand();
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Live stock
// ---------------------------------------------------------------------------

function LiveStockTab({
  holdings,
  onHand,
  cheapestPrice,
  stockCounts,
  activeLocation,
  stockMovements,
}: {
  holdings: FlatHolding[];
  onHand: Record<string, number>;
  cheapestPrice: (itemId: string) => number | null;
  stockCounts: StockCountRow[];
  activeLocation: string;
  stockMovements: StockMovementRow[];
}) {
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState<"all" | "kitchen" | "bar" | "foh">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const stockValue = holdings.reduce((sum, h) => sum + (onHand[h.id] ?? 0) * (cheapestPrice(h.itemId) ?? 0), 0);
  const belowPar = holdings.filter((h) => (onHand[h.id] ?? 0) < h.parLevel).length;
  const countsHere = stockCounts.filter((c) => c.location === activeLocation);
  const lastCounted = countsHere
    .filter((c) => c.counted_at)
    .sort((a, b) => (b.counted_at ?? "").localeCompare(a.counted_at ?? ""))[0];
  const openCount = countsHere.find((c) => c.status === "open");

  const filtered = holdings.filter((h) => {
    if (deptFilter !== "all" && h.department !== deptFilter) return false;
    if (search && !h.itemName.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <>
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Stock value</div>
          <div className="kpi-value">£{stockValue.toFixed(2)}</div>
          <div className="kpi-sub">
            {holdings.length} item{holdings.length === 1 ? "" : "s"} tracked
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Items below par</div>
          <div className="kpi-value">{belowPar}</div>
          <div className="kpi-sub">out of {holdings.length}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Last count</div>
          <div className="kpi-value" style={{ fontSize: 18 }}>
            {lastCounted?.counted_at ? new Date(lastCounted.counted_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "Never"}
          </div>
          <div className="kpi-sub">{openCount ? "A count is currently open" : "No count in progress"}</div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Stock on hand</h2>
        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
          <input
            placeholder="Search items…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flex: 1,
              minWidth: 180,
              fontFamily: "inherit",
              fontSize: 13,
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "8px 10px",
              background: "var(--surface)",
            }}
          />
          <div className="rtabs" style={{ margin: 0 }}>
            {(["all", "kitchen", "bar", "foh"] as const).map((d) => (
              <button key={d} className={`rtab ${deptFilter === d ? "on" : ""}`} onClick={() => setDeptFilter(d)}>
                {d === "all" ? "All" : deptLabel(d)}
              </button>
            ))}
          </div>
        </div>

        {holdings.length === 0 && <p className="muted">Nothing stocked at this location yet.</p>}
        {holdings.length > 0 && filtered.length === 0 && <p className="muted">No items match.</p>}
        {filtered.length > 0 && (
          <table className="tbl">
            <thead>
              <tr>
                <th>Item</th>
                <th>Department</th>
                <th>Section</th>
                <th className="num">On hand</th>
                <th className="num">Par</th>
                <th>Status</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((h) => {
                const oh = onHand[h.id];
                const low = oh !== undefined && oh < h.parLevel;
                const expanded = expandedId === h.id;
                const rowMovements = stockMovements
                  .filter((m) => m.item === h.itemId && m.location === activeLocation && m.department === h.department)
                  .slice()
                  .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
                  .slice(0, 10);
                return (
                  <Fragment key={h.id}>
                    <tr className="clickable" onClick={() => setExpandedId(expanded ? null : h.id)}>
                      <td>{h.itemName}</td>
                      <td className="muted">{deptLabel(h.department)}</td>
                      <td className="muted">{h.sectionName ?? "—"}</td>
                      <td className="num">
                        {oh === undefined ? "…" : oh.toFixed(2)} {h.baseUnit}
                      </td>
                      <td className="num">{h.parLevel.toFixed(2)}</td>
                      <td>
                        <span className={`badge ${low ? "b-low" : "b-ok"}`}>{low ? "Low" : "OK"}</span>
                      </td>
                      <td className="num">£{((oh ?? 0) * (cheapestPrice(h.itemId) ?? 0)).toFixed(2)}</td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={7} style={{ background: "var(--bg)" }}>
                          {rowMovements.length === 0 && (
                            <p className="muted" style={{ margin: "8px 4px" }}>
                              No ledger activity recorded yet.
                            </p>
                          )}
                          {rowMovements.length > 0 && (
                            <table className="tbl" style={{ margin: "6px 0" }}>
                              <thead>
                                <tr>
                                  <th>When</th>
                                  <th>Type</th>
                                  <th className="num">Qty</th>
                                  <th className="num">Unit cost</th>
                                  <th>Source</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rowMovements.map((m) => (
                                  <tr key={m.id}>
                                    <td className="muted">
                                      {new Date(m.occurred_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                                    </td>
                                    <td>{m.movement_type}</td>
                                    <td className="num">{Number(m.qty_delta) > 0 ? "+" : ""}{Number(m.qty_delta).toFixed(2)}</td>
                                    <td className="num">£{Number(m.unit_cost).toFixed(2)}</td>
                                    <td className="muted">{m.source_type}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Manage sections
// ---------------------------------------------------------------------------

function SectionsTab({
  accessToken,
  activeLocation,
  sections,
  sectionsError,
  holdings,
  onSectionsChanged,
  onItemsChanged,
}: {
  accessToken: string;
  activeLocation: string;
  sections: Section[];
  sectionsError: string | null;
  holdings: FlatHolding[];
  onSectionsChanged: () => void;
  onItemsChanged: () => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Section | null>(null);
  const [modalName, setModalName] = useState("");
  const [modalChecked, setModalChecked] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function openCreate() {
    setEditing(null);
    setModalName("");
    setModalChecked({});
    setErr(null);
    setConfirmDelete(false);
    setModalOpen(true);
  }

  function openEdit(s: Section) {
    setEditing(s);
    setModalName(s.name);
    setModalChecked(Object.fromEntries(holdings.filter((h) => h.section === s.id).map((h) => [h.id, true])));
    setErr(null);
    setConfirmDelete(false);
    setModalOpen(true);
  }

  async function handleSave() {
    if (!modalName.trim() || !activeLocation) return;
    setSaving(true);
    setErr(null);
    try {
      const sectionId = editing
        ? (await updateSection(accessToken, editing.id, { name: modalName.trim() })).id
        : (await createSection(accessToken, { location: activeLocation, name: modalName.trim() })).id;

      const toChange = holdings.filter((h) => (h.section === sectionId) !== !!modalChecked[h.id]);
      await Promise.all(
        toChange.map((h) => updateItemHolding(accessToken, h.id, { section: modalChecked[h.id] ? sectionId : null }))
      );

      setModalOpen(false);
      onSectionsChanged();
      onItemsChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save this section.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editing) return;
    setSaving(true);
    setErr(null);
    try {
      await deleteSection(accessToken, editing.id);
      setModalOpen(false);
      onSectionsChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not delete this section.");
      setSaving(false);
    }
  }

  return (
    <>
      <p className="muted" style={{ fontSize: 13, marginTop: 0, marginBottom: 16 }}>
        Sections are your permanent storage layout — set them up once and they're reused for every count. Assign who
        counts them on the <b>Count sheets</b> tab.
      </p>

      {sectionsError && <p className="error">{sectionsError}</p>}

      <div className="section-grid">
        {sections.map((s) => {
          const itemsInSection = holdings.filter((h) => h.section === s.id);
          const icon = sectionIcon(s.name);
          return (
            <div className="card section-card" key={s.id}>
              <div className="section-card-top">
                <div className={`section-icon ${icon.cls}`}>{icon.emoji}</div>
                <div>
                  <div className="section-card-name">{s.name}</div>
                  <div className="section-card-meta">
                    {itemsInSection.length} item{itemsInSection.length === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
              <div className="section-preview">
                {itemsInSection.length ? itemsInSection.map((h) => h.itemName).join(" · ") : "No items assigned yet"}
              </div>
              <div className="section-card-foot">
                <button className="open-link" onClick={() => openEdit(s)}>
                  Edit section
                </button>
              </div>
            </div>
          );
        })}
        <button className="new-section-tile" onClick={openCreate}>
          + New section
        </button>
      </div>

      {modalOpen && (
        <div className="modal-backdrop" onClick={() => !saving && setModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editing ? `Edit ${editing.name}` : "New section"}</h2>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
              {editing
                ? "Add or remove items as your storage changes — the section keeps its name and history."
                : "Group items by where they physically live, so a counter can walk one area at a time."}
            </p>
            <div className="field">
              <label>Section name</label>
              <input value={modalName} onChange={(e) => setModalName(e.target.value)} placeholder="e.g. Freezer no. 2" autoFocus />
            </div>
            <div className="field">
              <label>Items in this section</label>
              {holdings.length === 0 && <p className="muted" style={{ fontSize: 12.5 }}>No items stocked at this location yet.</p>}
              <div className="item-checklist">
                {holdings.map((h) => (
                  <label key={h.id} className="item-check">
                    <input
                      type="checkbox"
                      checked={!!modalChecked[h.id]}
                      onChange={(e) => setModalChecked((c) => ({ ...c, [h.id]: e.target.checked }))}
                    />
                    {h.itemName} <span className="muted">({deptLabel(h.department)})</span>
                  </label>
                ))}
              </div>
            </div>
            {err && <p className="error">{err}</p>}
            <div className="modal-actions">
              {editing && !confirmDelete && (
                <button type="button" className="btn-ghost" style={{ marginRight: "auto", color: "var(--brick)" }} onClick={() => setConfirmDelete(true)}>
                  Delete
                </button>
              )}
              {editing && confirmDelete && (
                <button type="button" className="btn-danger" style={{ marginRight: "auto" }} onClick={handleDelete} disabled={saving}>
                  {saving ? "Deleting…" : "Confirm delete"}
                </button>
              )}
              <button type="button" className="btn-ghost" onClick={() => setModalOpen(false)} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={handleSave} disabled={saving || !modalName.trim()}>
                {saving ? "Saving…" : editing ? "Save changes" : "Create section"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Count sheets
// ---------------------------------------------------------------------------

function CountSheetsTab({
  accessToken,
  me,
  staff,
  activeLocation,
  sections,
  holdings,
  onHand,
  cheapestPrice,
  stockCounts,
  stockCountsError,
  onStockCountsChanged,
}: {
  accessToken: string;
  me: Me;
  staff: Membership[];
  activeLocation: string;
  sections: Section[];
  holdings: FlatHolding[];
  onHand: Record<string, number>;
  cheapestPrice: (itemId: string) => number | null;
  stockCounts: StockCountRow[] | null;
  stockCountsError: string | null;
  onStockCountsChanged: () => void;
}) {
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);

  const openCount = (stockCounts ?? []).find((c) => c.location === activeLocation && c.status === "open");

  async function handleStartCount() {
    setStarting(true);
    setErr(null);
    try {
      await createStockCount(accessToken, activeLocation);
      onStockCountsChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not start a stock count.");
    } finally {
      setStarting(false);
    }
  }

  async function handleCloseCount() {
    if (!openCount) return;
    try {
      await updateStockCount(accessToken, openCount.id, { status: "closed", counted_at: new Date().toISOString() });
      onStockCountsChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not close this count.");
    }
  }

  async function handleAssign(sectionId: string, userId: string) {
    if (!openCount) return;
    const existing = openCount.assignments.find((a) => a.section === sectionId);
    try {
      if (existing) {
        await updateCountAssignment(accessToken, existing.id, { assigned_to: userId || null });
      } else {
        await createCountAssignment(accessToken, { count: openCount.id, section: sectionId, assigned_to: userId || null });
      }
      onStockCountsChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not update the assignment.");
    }
  }

  if (stockCountsError) return <p className="error">{stockCountsError}</p>;

  if (!openCount) {
    return (
      <div className="card" style={{ textAlign: "center", padding: "40px 24px" }}>
        <p className="muted" style={{ marginBottom: 16 }}>
          No stock count is currently open at this location.
        </p>
        <button className="btn-primary small" onClick={handleStartCount} disabled={starting}>
          {starting ? "Starting…" : "+ Start a stock count"}
        </button>
        {err && (
          <p className="error" style={{ marginTop: 12 }}>
            {err}
          </p>
        )}
      </div>
    );
  }

  const openSection = openSectionId ? sections.find((s) => s.id === openSectionId) : null;

  if (openSection) {
    return (
      <CountSheet
        accessToken={accessToken}
        count={openCount}
        section={openSection}
        holdings={holdings.filter((h) => h.section === openSection.id)}
        onHand={onHand}
        cheapestPrice={cheapestPrice}
        onBack={() => setOpenSectionId(null)}
        onSubmitted={() => {
          onStockCountsChanged();
          setOpenSectionId(null);
        }}
      />
    );
  }

  return (
    <>
      <div className="content-head">
        <h2 style={{ margin: 0 }}>Count in progress</h2>
        <button className="btn-ghost small" onClick={handleCloseCount}>
          Close count
        </button>
      </div>
      {err && <p className="error">{err}</p>}
      {sections.length === 0 && <p className="muted">No sections set up yet — add some under "Manage sections" first.</p>}
      <div className="section-grid">
        {sections.map((s) => {
          const sectionHoldings = holdings.filter((h) => h.section === s.id);
          const itemIds = Array.from(new Set(sectionHoldings.map((h) => h.itemId)));
          const countedIds = new Set(openCount.lines.map((l) => l.item));
          const doneCount = itemIds.filter((id) => countedIds.has(id)).length;
          const pct = itemIds.length ? Math.round((doneCount / itemIds.length) * 100) : 0;
          const assignment = openCount.assignments.find((a) => a.section === s.id);
          const status = doneCount === 0 ? { label: "To do", cls: "" } : doneCount < itemIds.length ? { label: "In progress", cls: "b-low" } : { label: "Complete", cls: "b-ok" };
          const icon = sectionIcon(s.name);
          const assignedStaffHere = staff.find((m) => m.user === assignment?.assigned_to);
          return (
            <div className="card section-card" key={s.id}>
              <div className="section-card-top">
                <div className={`section-icon ${icon.cls}`}>{icon.emoji}</div>
                <div>
                  <div className="section-card-name">{s.name}</div>
                  <div className="section-card-meta">
                    {itemIds.length} item{itemIds.length === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
              <div className="bar-row" style={{ padding: "10px 0 4px" }}>
                <div className="bar-track" style={{ flex: 1 }}>
                  <div className="bar-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="bar-val" style={{ width: "auto" }}>
                  {doneCount}/{itemIds.length}
                </div>
              </div>
              <div className="assign-row">
                <span className="assign-lbl">Assigned to</span>
                <select
                  className="assign-select"
                  value={assignment?.assigned_to ?? ""}
                  onChange={(e) => handleAssign(s.id, e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {!assignedStaffHere && assignment?.assigned_to_name && (
                    <option value={assignment.assigned_to ?? ""}>{assignment.assigned_to_name}</option>
                  )}
                  {staff.map((m) => (
                    <option key={m.id} value={m.user}>
                      {staffLabel(m)}
                      {m.user === me.id ? " (you)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="section-card-foot">
                <button className="open-link" onClick={() => setOpenSectionId(s.id)} disabled={itemIds.length === 0}>
                  Open sheet →
                </button>
                <span>
                  {status.label !== "To do" && <span className={`badge ${status.cls}`}>{status.label}</span>} <span className="pct">{pct}%</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function CountSheet({
  accessToken,
  count,
  section,
  holdings,
  onHand,
  cheapestPrice,
  onBack,
  onSubmitted,
}: {
  accessToken: string;
  count: StockCountRow;
  section: Section;
  holdings: FlatHolding[];
  onHand: Record<string, number>;
  cheapestPrice: (itemId: string) => number | null;
  onBack: () => void;
  onSubmitted: () => void;
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function variance(h: FlatHolding): number | null {
    const q = qty[h.id];
    if (!checked[h.id] || q === undefined || q === "") return null;
    const num = Number(q);
    if (!Number.isFinite(num)) return null;
    return num - (onHand[h.id] ?? 0);
  }

  function handleTick(h: FlatHolding, isChecked: boolean) {
    setChecked((c) => ({ ...c, [h.id]: isChecked }));
    if (isChecked) {
      // Prefill with the expected quantity — most items will match, so the
      // counter only has to touch items that actually differ.
      setQty((q) => ({ ...q, [h.id]: (onHand[h.id] ?? 0).toFixed(2) }));
    } else {
      setQty((q) => ({ ...q, [h.id]: "" }));
      if (openNoteId === h.id) setOpenNoteId(null);
    }
  }

  function handleQtyChange(h: FlatHolding, value: string) {
    setQty((q) => ({ ...q, [h.id]: value }));
    const num = Number(value);
    const off = value !== "" && Number.isFinite(num) && Math.abs(num - (onHand[h.id] ?? 0)) > 0.001;
    if (off && !reason[h.id] && !note[h.id]) {
      setOpenNoteId(h.id);
    } else if (!off && openNoteId === h.id) {
      setOpenNoteId(null);
    }
  }

  const done = holdings.filter((h) => checked[h.id]).length;
  const pct = holdings.length ? Math.round((done / holdings.length) * 100) : 0;

  async function handleSubmit() {
    setSaving(true);
    setErr(null);
    try {
      for (const h of holdings) {
        if (!checked[h.id]) continue;
        const q = qty[h.id];
        if (q === undefined || q === "") continue;
        const countedQty = Number(q);
        if (!Number.isFinite(countedQty) || countedQty < 0) continue;
        const varQty = variance(h);
        const line = await createCountLine(accessToken, {
          count: count.id,
          item: h.itemId,
          counted_qty: countedQty.toFixed(3),
          reason: varQty && varQty !== 0 ? reason[h.id] ?? "miscount" : null,
          note: varQty && varQty !== 0 ? note[h.id] || null : null,
        });
        if (varQty && varQty !== 0) {
          await createStockMovement(accessToken, {
            location: section.location,
            item: h.itemId,
            department: h.department,
            qty_delta: varQty.toFixed(3),
            movement_type: "count_adjust",
            unit_cost: (cheapestPrice(h.itemId) ?? 0).toFixed(2),
            source_type: "count_line",
            source_id: line.id,
          });
        }
      }
      onSubmitted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save this count sheet.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <button className="back-link" onClick={onBack}>
        ← All sections
      </button>
      <div className="content-head" style={{ marginTop: 8 }}>
        <h2 style={{ margin: 0 }}>{section.name}</h2>
      </div>
      <div className="prog-wrap">
        <div className="prog-t">
          <span>Counted</span>
          <b>
            {done} / {holdings.length}
          </b>
        </div>
        <div className="bar-track">
          <div className="bar-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {err && <p className="error">{err}</p>}
      {holdings.length === 0 && <p className="muted">No items assigned to this section.</p>}

      <div className="count-list">
        {holdings.map((h) => {
          const varQty = variance(h);
          const off = varQty !== null && Math.abs(varQty) > 0.001;
          const hasNote = !!(reason[h.id] || note[h.id]);
          const isOpen = openNoteId === h.id;
          const btnCls = hasNote ? "note-btn-sm has" : off ? "note-btn-sm need" : "note-btn-sm";
          const btnTxt = hasNote ? "💬 note" : off ? "+ why?" : "+ note";
          return (
            <div key={h.id} className={`count-row ${checked[h.id] ? "done" : ""}`}>
              <div className="count-row-main">
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, minWidth: 170 }}>
                  <input type="checkbox" checked={!!checked[h.id]} onChange={(e) => handleTick(h, e.target.checked)} />
                  {h.itemName}
                </label>
                <span className="muted" style={{ fontSize: 11.5, fontFamily: "monospace" }}>
                  system says {(onHand[h.id] ?? 0).toFixed(2)} {h.baseUnit}
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="—"
                  disabled={!checked[h.id]}
                  value={qty[h.id] ?? ""}
                  onChange={(e) => handleQtyChange(h, e.target.value)}
                  style={{ width: 96, fontFamily: "monospace", textAlign: "right", border: "1.5px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}
                />
                <span className="cunit muted" style={{ fontSize: 12.5, minWidth: 40 }}>
                  {h.baseUnit}
                </span>
                <span className={`cvar ${varQty === null ? "v-none" : off ? (varQty < 0 ? "v-short" : "v-over") : "v-ok"}`} style={{ minWidth: 100, textAlign: "right", fontFamily: "monospace", fontSize: 12.5, fontWeight: 700 }}>
                  {varQty === null ? "—" : !off ? "✓ matches" : `${varQty > 0 ? "+" : "−"}${Math.abs(varQty).toFixed(2)} ${h.baseUnit}`}
                </span>
                <button type="button" className={btnCls} onClick={() => setOpenNoteId(isOpen ? null : h.id)}>
                  {btnTxt}
                </button>
              </div>
              {hasNote && !isOpen && (
                <div className="note-show">
                  <b>{reason[h.id] ? reasonLabel(reason[h.id]) : "Note"}</b>
                  {note[h.id] ? ` — ${note[h.id]}` : ""}
                </div>
              )}
              {isOpen && (
                <div className="note-panel">
                  <div className="note-h">{off ? `Why is this ${varQty! < 0 ? "short" : "over"} by ${Math.abs(varQty!).toFixed(2)} ${h.baseUnit}?` : "Add a note for this item"}</div>
                  <div className="chip-row" style={{ marginBottom: 8 }}>
                    {REASONS.map((r) => (
                      <button
                        key={r.value}
                        type="button"
                        className={`chip ${reason[h.id] === r.value ? "active" : ""}`}
                        onClick={() => setReason((rs) => ({ ...rs, [h.id]: rs[h.id] === r.value ? "" : r.value }))}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                  <textarea
                    className="note-in"
                    placeholder="Add detail — e.g. 3kg found spoiled at the back, binned"
                    value={note[h.id] ?? ""}
                    onChange={(e) => setNote((n) => ({ ...n, [h.id]: e.target.value }))}
                  />
                  <div className="note-foot">
                    <button type="button" className="btn-ghost small" onClick={() => setOpenNoteId(null)}>
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="modal-actions" style={{ marginTop: 16 }}>
        <button className="btn-ghost" onClick={onBack}>
          Cancel
        </button>
        <button className="btn-primary" onClick={handleSubmit} disabled={saving || done === 0}>
          {saving ? "Saving…" : `Submit ${section.name}`}
        </button>
      </div>
    </div>
  );
}
