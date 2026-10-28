import { useState } from "react";
import { formatMoney, unitFactor, updatePOLine } from "./api";
import type { CatalogItem, POLineRow } from "./api";
import SupplierUnitPicker from "./SupplierUnitPicker";
import type { UnitChoice } from "./SupplierUnitPicker";

// Fixes one line of a Draft order: the unit it is ordered in, the quantity
// in that unit, the price per unit and the VAT. Same fields and the same
// conversion as the "Add line" form, so a line ordered in the wrong unit can
// be corrected in place instead of being deleted and typed again.

function trimNum(n: number): string {
  return Number.isFinite(n) ? String(Number(n.toPrecision(8))) : "";
}

interface Props {
  line: POLineRow;
  item: CatalogItem | undefined;
  currency?: string;
  accessToken: string;
  onClose: () => void;
  onSaved: () => void;
  onItemsChanged?: () => void;
}

export default function POLineEditModal({ line, item, currency, accessToken, onClose, onSaved, onItemsChanged }: Props) {
  const baseQty = Number(line.qty);
  const basePrice = Number(line.unit_price);
  const frozen = !!line.supplier_unit && line.supplier_qty != null && Number(line.supplier_qty) > 0;
  const f0 = frozen ? baseQty / Number(line.supplier_qty) : 1;

  const [unit, setUnit] = useState(frozen ? line.supplier_unit : "");
  const [packQty, setPackQty] = useState(frozen ? trimNum(f0) : "1");
  const [qty, setQty] = useState(frozen ? trimNum(Number(line.supplier_qty)) : trimNum(baseQty));
  const [price, setPrice] = useState(frozen ? trimNum(basePrice * f0) : trimNum(basePrice));
  const initialVat = line.effective_vat_rate ? (Number(line.effective_vat_rate) * 100).toFixed(2) : "";
  const [vat, setVat] = useState(initialVat);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = item?.base_unit ?? "";
  const converting = !!item && !!unit && unit !== base;
  const factor = item ? unitFactor(item, unit, packQty) : 1;
  const rawQty = Number(qty);
  const rawPrice = Number(price);
  const valid = Number.isFinite(rawQty) && rawQty > 0 && Number.isFinite(rawPrice) && rawPrice >= 0 && factor !== null;
  const resolved = valid && factor ? { qty: rawQty * factor, unitPrice: rawPrice / factor } : null;
  const lineTotal = Number.isFinite(rawQty) && Number.isFinite(rawPrice) ? rawQty * rawPrice : 0;

  function handleUnit(c: UnitChoice) {
    setUnit(c.unit);
    setPackQty(c.packQty);
  }

  async function save() {
    if (!resolved) {
      setError("Enter a quantity and a price, and a valid pack size if the unit is a pack.");
      return;
    }
    if (vat.trim() !== "" && !Number.isFinite(Number(vat))) {
      setError("VAT % must be a number.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updatePOLine(accessToken, line.id, {
        qty: resolved.qty.toFixed(3),
        unit_price: resolved.unitPrice.toFixed(4),
        supplier_unit: converting ? unit : "",
        supplier_qty: converting ? String(rawQty) : null,
        // Only sent when it was changed, so an inherited rate stays inherited.
        ...(vat !== initialVat ? { vat_rate: vat.trim() === "" ? null : (Number(vat) / 100).toFixed(4) } : {}),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this line.");
      setSaving(false);
    }
  }

  const priceDecimals = (n: number) => (n < 0.1 ? 4 : 2);

  return (
    <div className="modal-backdrop" onClick={() => !saving && onClose()}>
      <div className="modal" role="dialog" aria-label="Edit line" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Edit line · {line.item_name}</h2>
        <div className="fgrid fgrid-2">
          <SupplierUnitPicker
            item={item}
            unit={unit}
            packQty={packQty}
            accessToken={accessToken}
            label="Order in"
            onChange={handleUnit}
            onUnitAdded={onItemsChanged}
          />
          <div className="field">
            <label>VAT %</label>
            <input type="number" min="0" max="100" step="0.01" placeholder="—" value={vat} onChange={(e) => setVat(e.target.value)} />
          </div>
          <div className="field">
            <label>{converting ? `Qty (in ${unit})` : "Qty"}</label>
            <input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div className="field">
            <label>{converting ? `Price per ${unit}` : "Unit price"}</label>
            <input type="number" min="0" step="any" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
        </div>
        {item && (resolved || lineTotal > 0) && (
          <div className={`scan-row-total ${converting && !resolved ? "warn" : "ok"}`}>
            {resolved ? (
              <span className="scan-row-total-line">
                {`= ${Number(resolved.qty.toFixed(3)).toLocaleString("en-GB")} ${base} in total at ${formatMoney(
                  resolved.unitPrice,
                  currency,
                  priceDecimals(resolved.unitPrice)
                )} per ${base}`}
              </span>
            ) : (
              <span className="scan-row-total-line">Pick or add the pack size above to see the real total</span>
            )}
            {lineTotal > 0 && <span className="scan-row-total-line">Line total {formatMoney(lineTotal, currency)} ex VAT</span>}
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <div className="modal-actions" style={{ marginTop: 12 }}>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={save} disabled={saving || !resolved}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
