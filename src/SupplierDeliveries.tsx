import { useState } from "react";
import { DAY_NAMES, fmtDate, nextDeliveryDate } from "./App";
import { formatMoney, defaultCurrency, updateSupplier } from "./api";
import type { PurchaseOrder, Supplier, Location } from "./api";

interface Props {
  supplierId: string;
  accessToken: string;
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
  locations: Location[];
  onBack: () => void;
  onOpenPO: (id: string) => void;
  onNewPO: (supplierId: string, expectedDateISO: string) => void;
  onSupplierUpdated: (updated: Supplier) => void;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shortDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export default function SupplierDeliveries({
  supplierId,
  accessToken,
  suppliers,
  purchaseOrders,
  locations,
  onBack,
  onOpenPO,
  onNewPO,
  onSupplierUpdated,
}: Props) {
  const supplier = suppliers.find((s) => s.id === supplierId);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  if (!supplier) {
    return (
      <div>
        <button className="back-link" onClick={onBack}>
          ← All purchase orders
        </button>
        <p className="error">Supplier not found.</p>
      </div>
    );
  }

  async function handleSaveField(patch: Parameters<typeof updateSupplier>[2]) {
    setSaveError(null);
    try {
      const updated = await updateSupplier(accessToken, supplier!.id, patch);
      onSupplierUpdated(updated);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save changes.");
    }
  }

  async function handleToggleArchive() {
    setArchiving(true);
    setSaveError(null);
    try {
      const updated = await updateSupplier(accessToken, supplier!.id, {
        archived: !supplier!.archived,
      });
      onSupplierUpdated(updated);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save changes.");
    } finally {
      setArchiving(false);
    }
  }

  const next = supplier.delivery_day !== null ? nextDeliveryDate(supplier.delivery_day) : null;
  const nextISO = next ? toISODate(next) : "";
  const nextLabel = next ? shortDate(next) : null;

  const supplierPOs = purchaseOrders.filter((po) => po.supplier === supplierId);
  const open = supplierPOs
    .filter((po) => po.status === "draft" || po.status === "sent" || po.status === "awaiting")
    .sort((a, b) => (a.expected_date ?? "").localeCompare(b.expected_date ?? ""));
  const history = supplierPOs
    .filter((po) => po.status === "received" || po.status === "amended")
    .sort((a, b) =>
      (b.received_date ?? b.expected_date ?? "").localeCompare(a.received_date ?? a.expected_date ?? "")
    );

  function renderRow(po: PurchaseOrder) {
    const belowMin =
      po.status === "draft" && supplier?.min_order_value && Number(po.total) < Number(supplier.min_order_value);
    return (
      <tr key={po.id} className="clickable" onClick={() => onOpenPO(po.id)}>
        <td>
          <span className={`postatus ps-${po.status}`}>{po.status.charAt(0).toUpperCase() + po.status.slice(1)}</span>
          {belowMin && (
            <span className="postatus ps-awaiting" style={{ marginLeft: 6 }}>
              Below min
            </span>
          )}
        </td>
        <td className="muted">{po.location_name}</td>
        <td className="muted">{fmtDate(po.expected_date)}</td>
        <td className="num">{po.lines.length}</td>
        <td className="num">{formatMoney(Number(po.total), locations.find((l) => l.id === po.location)?.currency)}</td>
      </tr>
    );
  }

  return (
    <div key={supplier.id}>
      <button className="back-link" onClick={onBack}>
        ← All purchase orders
      </button>

      <div className="detail-head">
        <h1 className="page-title" style={{ margin: 0 }}>
          {supplier.name}
        </h1>
        {supplier.archived && (
          <span className="badge b-archived" style={{ marginLeft: 12 }}>
            Archived
          </span>
        )}
      </div>
      <p className="muted detail-sub">
        {supplier.delivery_day !== null ? `Delivers every ${DAY_NAMES[supplier.delivery_day]}` : "No regular delivery day set"}
        {nextLabel ? ` · next delivery ${nextLabel}` : ""}
        {supplier.min_order_value ? ` · ${formatMoney(Number(supplier.min_order_value), defaultCurrency(locations), 0)} minimum order` : ""}
      </p>

      {saveError && <p className="error">{saveError}</p>}

      <div className="card">
        <h2>Contact & terms</h2>
        <div className="fgrid fgrid-2">
          <div className="field">
            <label>Contact email</label>
            <input
              type="email"
              defaultValue={supplier.contact_email ?? ""}
              onBlur={(e) => handleSaveField({ contact_email: e.target.value || null })}
              placeholder="optional"
            />
          </div>
          <div className="field">
            <label>Contact phone</label>
            <input
              defaultValue={supplier.contact_phone}
              onBlur={(e) => handleSaveField({ contact_phone: e.target.value })}
              placeholder="optional"
            />
          </div>
          <div className="field">
            <label>Delivery day</label>
            <select
              defaultValue={supplier.delivery_day ?? ""}
              onChange={(e) =>
                handleSaveField({ delivery_day: e.target.value === "" ? null : Number(e.target.value) })
              }
            >
              <option value="">No regular delivery day</option>
              {DAY_NAMES.map((day, idx) => (
                <option key={idx} value={idx}>
                  {day}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Minimum order value</label>
            <input
              type="number"
              min="0"
              step="0.01"
              defaultValue={supplier.min_order_value ?? ""}
              onBlur={(e) =>
                handleSaveField({
                  min_order_value: e.target.value === "" ? null : Number(e.target.value).toFixed(2),
                })
              }
              placeholder="optional"
            />
          </div>
        </div>
        <div className="field" style={{ marginTop: 16 }}>
          <label>Notes</label>
          <textarea
            defaultValue={supplier.notes}
            onBlur={(e) => handleSaveField({ notes: e.target.value })}
            placeholder="optional — e.g. account number, delivery instructions"
            rows={3}
          />
        </div>
      </div>

      <div className="card">
        <div className="content-head" style={{ marginBottom: open.length ? 18 : 0 }}>
          <h2 style={{ margin: 0 }}>Open orders</h2>
          <button className="btn-ghost small" onClick={() => onNewPO(supplierId, nextISO)}>
            + New purchase order
          </button>
        </div>

        {open.length === 0 ? (
          <div style={{ padding: "8px 0 4px", textAlign: "center" }}>
            <p className="muted" style={{ marginTop: 0 }}>
              {nextLabel
                ? `No purchase order yet for the next delivery (${nextLabel}).`
                : "No open purchase orders for this supplier."}
            </p>
            <button className="btn-primary small" onClick={() => onNewPO(supplierId, nextISO)}>
              + New purchase order{nextLabel ? ` for ${nextLabel}` : ""}
            </button>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Location</th>
                  <th>Expected</th>
                  <th className="num">Lines</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>{open.map(renderRow)}</tbody>
            </table>
          </div>
        )}
      </div>

      {history.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Order history</h2>
          <div className="table-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Location</th>
                  <th>Expected</th>
                  <th className="num">Lines</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>{history.map(renderRow)}</tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Archive</h2>
        <div className="dz-row">
          <div>
            <b>{supplier.archived ? "This supplier is archived" : "Archive this supplier"}</b>
            <p className="hint" style={{ margin: "3px 0 0" }}>
              {supplier.archived
                ? "Hidden from new-item supplier suggestions and pickers, but every past order stays intact."
                : "Stops it being suggested for new items or new purchase orders, without losing any order history — reversible any time. If it's still set as an item's default supplier or has an open order, those keep working; you'll just see an \"archived\" note."}
            </p>
          </div>
          <button className="btn-ghost" onClick={handleToggleArchive} disabled={archiving}>
            {archiving ? "Saving…" : supplier.archived ? "Unarchive" : "Archive supplier"}
          </button>
        </div>
      </div>
    </div>
  );
}
