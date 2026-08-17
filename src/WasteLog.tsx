import { useState } from "react";
import { createStockMovement, createWasteEvent } from "./api";
import type { CatalogItem, ItemSupplierRow, Location, StockMovementRow, WasteEventRow } from "./api";

interface Props {
  accessToken: string;
  items: CatalogItem[];
  locations: Location[];
  itemSupplierLinks: ItemSupplierRow[];
  wasteEvents: WasteEventRow[] | null;
  wasteError: string | null;
  stockMovements: StockMovementRow[];
  onChanged: () => void;
}

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

const DEPARTMENTS: { value: "kitchen" | "bar" | "foh"; label: string }[] = [
  { value: "kitchen", label: "Kitchen" },
  { value: "bar", label: "Bar" },
  { value: "foh", label: "Front of house" },
];

function reasonLabel(value: string): string {
  return REASONS.find((r) => r.value === value)?.label ?? value;
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) +
    " " +
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  );
}

interface MergedRow {
  id: string;
  itemName: string;
  qty: number;
  reason: string;
  unitCost: number;
  value: number;
  occurredAt: string | null;
}

export default function WasteLog({
  accessToken,
  items,
  locations,
  itemSupplierLinks,
  wasteEvents,
  wasteError,
  stockMovements,
  onChanged,
}: Props) {
  const [selectedItem, setSelectedItem] = useState("");
  const [selectedLocation, setSelectedLocation] = useState(locations[0]?.id ?? "");
  const [selectedDept, setSelectedDept] = useState<"kitchen" | "bar" | "foh">("kitchen");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState(REASONS[0].value);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [reasonFilter, setReasonFilter] = useState<string>("all");

  const activeItems = items.filter((i) => !i.archived);
  const selectedItemObj = activeItems.find((i) => i.id === selectedItem) ?? null;

  function cheapestPrice(itemId: string): number | null {
    const prices = itemSupplierLinks.filter((l) => l.item === itemId).map((l) => Number(l.unit_price));
    if (!prices.length) return null;
    return Math.min(...prices);
  }

  const unitCost = selectedItem ? cheapestPrice(selectedItem) : null;

  function handleItemChange(itemId: string) {
    setSelectedItem(itemId);
    const item = activeItems.find((i) => i.id === itemId);
    if (item && item.holdings.length > 0) {
      // Prefer a holding at the currently-selected location; otherwise take the first.
      const match = item.holdings.find((h) => h.location === selectedLocation) ?? item.holdings[0];
      setSelectedLocation(match.location);
      setSelectedDept(match.department as "kitchen" | "bar" | "foh");
    }
  }

  async function handleLogWaste(e: React.FormEvent) {
    e.preventDefault();
    const qtyNum = Number(qty);
    if (!selectedItem) {
      setFormError("Choose an item.");
      return;
    }
    if (!selectedLocation) {
      setFormError("Choose a location.");
      return;
    }
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setFormError("Quantity must be a positive number.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const event = await createWasteEvent(accessToken, {
        location: selectedLocation,
        item: selectedItem,
        qty: qtyNum.toFixed(3),
        reason,
      });
      try {
        await createStockMovement(accessToken, {
          location: selectedLocation,
          item: selectedItem,
          department: selectedDept,
          qty_delta: (-qtyNum).toFixed(3),
          movement_type: "waste",
          unit_cost: (unitCost ?? 0).toFixed(2),
          source_type: "waste_event",
          source_id: event.id,
        });
      } catch (movErr) {
        setFormError(
          "Waste was logged, but updating stock levels failed" +
            (movErr instanceof Error ? `: ${movErr.message}` : ".") +
            " Stock may be out of sync until this is corrected."
        );
      }
      setSuccessMsg(
        `Logged ${qtyNum.toFixed(2)} ${selectedItemObj?.base_unit ?? ""} of ${selectedItemObj?.name ?? "item"}.`
      );
      setQty("");
      onChanged();
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not log waste.");
    } finally {
      setSaving(false);
    }
  }

  const merged: MergedRow[] = (wasteEvents ?? []).map((ev) => {
    const mv = stockMovements.find((m) => m.source_type === "waste_event" && m.source_id === ev.id);
    const cost = mv ? Number(mv.unit_cost) : cheapestPrice(ev.item) ?? 0;
    return {
      id: ev.id,
      itemName: ev.item_name,
      qty: Number(ev.qty),
      reason: ev.reason,
      unitCost: cost,
      value: Number(ev.qty) * cost,
      occurredAt: mv?.occurred_at ?? null,
    };
  });

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const cutoff = sevenDaysAgo.toISOString();
  const last7 = merged.filter((r) => r.occurredAt && r.occurredAt >= cutoff);
  const wasteValue7d = last7.reduce((sum, r) => sum + r.value, 0);
  const reasonTotals7d: Record<string, number> = {};
  last7.forEach((r) => {
    reasonTotals7d[r.reason] = (reasonTotals7d[r.reason] ?? 0) + r.value;
  });
  const topReason7d = Object.entries(reasonTotals7d).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const reasonTotalsAll: Record<string, number> = {};
  merged.forEach((r) => {
    reasonTotalsAll[r.reason] = (reasonTotalsAll[r.reason] ?? 0) + r.value;
  });
  const breakdown = Object.entries(reasonTotalsAll).sort((a, b) => b[1] - a[1]);
  const maxBreakdown = breakdown.length ? breakdown[0][1] : 0;

  const filteredRecent = merged
    .filter((r) => reasonFilter === "all" || r.reason === reasonFilter)
    .slice()
    .sort((a, b) => (b.occurredAt ?? "").localeCompare(a.occurredAt ?? ""));

  return (
    <>
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Waste value (7 days)</div>
          <div className="kpi-value">£{wasteValue7d.toFixed(2)}</div>
          <div className="kpi-sub">
            {last7.length} event{last7.length === 1 ? "" : "s"} logged
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Top reason (7 days)</div>
          <div className="kpi-value" style={{ fontSize: 18 }}>
            {topReason7d ? reasonLabel(topReason7d) : "—"}
          </div>
          <div className="kpi-sub">
            {topReason7d ? `£${(reasonTotals7d[topReason7d] ?? 0).toFixed(2)} of last 7 days' waste` : "No waste logged yet"}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Waste events (7 days)</div>
          <div className="kpi-value">{last7.length}</div>
          <div className="kpi-sub">Waste % of sales isn't tracked yet — no sales data source</div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Log waste</h2>
        <form onSubmit={handleLogWaste}>
          <div className="fgrid">
            <div className="field">
              <label>Item</label>
              <select value={selectedItem} onChange={(e) => handleItemChange(e.target.value)} required>
                <option value="">Select an item…</option>
                {activeItems.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name}
                  </option>
                ))}
              </select>
              {selectedItem && (
                <div className="waste-cost-hint">
                  {unitCost !== null ? `£${unitCost.toFixed(2)} / ${selectedItemObj?.base_unit}` : "No supplier price recorded"}
                </div>
              )}
            </div>
            <div className="field">
              <label>Quantity {selectedItemObj ? `(${selectedItemObj.base_unit})` : ""}</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label>Reason</label>
              <select value={reason} onChange={(e) => setReason(e.target.value)}>
                {REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="fgrid" style={{ marginTop: 14 }}>
            <div className="field">
              <label>Location</label>
              <select value={selectedLocation} onChange={(e) => setSelectedLocation(e.target.value)}>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Department</label>
              <select value={selectedDept} onChange={(e) => setSelectedDept(e.target.value as "kitchen" | "bar" | "foh")}>
                {DEPARTMENTS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ display: "flex", alignItems: "flex-end" }}>
              <button
                className="btn-primary"
                type="submit"
                disabled={saving || !selectedItem || !selectedLocation || !locations.length}
                style={{ width: "100%" }}
              >
                {saving ? "Logging…" : "Log waste"}
              </button>
            </div>
          </div>
          {formError && (
            <p className="error" style={{ marginTop: 10 }}>
              {formError}
            </p>
          )}
          {successMsg && <div className="success-banner">✓ {successMsg}</div>}
          {!locations.length && (
            <p className="error" style={{ marginTop: 10 }}>
              No locations yet — add one before logging waste.
            </p>
          )}
        </form>
      </div>

      <div className="waste-cols">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Recent waste</h2>
          {wasteError && <p className="error">{wasteError}</p>}
          {!wasteError && wasteEvents === null && <p className="muted">Loading…</p>}
          {wasteEvents !== null && merged.length === 0 && <p className="muted">No waste logged yet.</p>}
          {merged.length > 0 && (
            <>
              <div className="chip-row">
                <button
                  type="button"
                  className={`chip ${reasonFilter === "all" ? "active" : ""}`}
                  onClick={() => setReasonFilter("all")}
                >
                  All ({merged.length})
                </button>
                {REASONS.filter((r) => merged.some((m) => m.reason === r.value)).map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    className={`chip ${reasonFilter === r.value ? "active" : ""}`}
                    onClick={() => setReasonFilter(r.value)}
                  >
                    {r.label} ({merged.filter((m) => m.reason === r.value).length})
                  </button>
                ))}
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Item</th>
                    <th>Reason</th>
                    <th className="num">Qty</th>
                    <th className="num">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecent.map((r) => (
                    <tr key={r.id}>
                      <td className="muted">{fmtWhen(r.occurredAt)}</td>
                      <td>{r.itemName}</td>
                      <td className="muted">{reasonLabel(r.reason)}</td>
                      <td className="num">{r.qty.toFixed(2)}</td>
                      <td className="num">£{r.value.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>By reason</h2>
          {breakdown.length === 0 && <p className="muted">No waste logged yet.</p>}
          {breakdown.map(([reasonVal, total]) => (
            <div className="bar-row" key={reasonVal}>
              <div className="bar-label">{reasonLabel(reasonVal)}</div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${maxBreakdown ? (total / maxBreakdown) * 100 : 0}%` }} />
              </div>
              <div className="bar-val">£{total.toFixed(2)}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
