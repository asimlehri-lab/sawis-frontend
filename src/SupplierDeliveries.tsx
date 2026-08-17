import { DAY_NAMES, fmtDate, nextDeliveryDate } from "./App";
import type { PurchaseOrder, Supplier } from "./api";

interface Props {
  supplierId: string;
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
  onBack: () => void;
  onOpenPO: (id: string) => void;
  onNewPO: (supplierId: string, expectedDateISO: string) => void;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shortDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export default function SupplierDeliveries({
  supplierId,
  suppliers,
  purchaseOrders,
  onBack,
  onOpenPO,
  onNewPO,
}: Props) {
  const supplier = suppliers.find((s) => s.id === supplierId);

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
        <td className="num">£{Number(po.total).toFixed(2)}</td>
      </tr>
    );
  }

  return (
    <div>
      <button className="back-link" onClick={onBack}>
        ← All purchase orders
      </button>

      <div className="detail-head">
        <h1 className="page-title" style={{ margin: 0 }}>
          {supplier.name}
        </h1>
      </div>
      <p className="muted detail-sub">
        {supplier.delivery_day !== null ? `Delivers every ${DAY_NAMES[supplier.delivery_day]}` : "No regular delivery day set"}
        {nextLabel ? ` · next delivery ${nextLabel}` : ""}
        {supplier.min_order_value ? ` · £${Number(supplier.min_order_value).toFixed(0)} minimum order` : ""}
      </p>

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
        )}
      </div>

      {history.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Order history</h2>
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
      )}
    </div>
  );
}
