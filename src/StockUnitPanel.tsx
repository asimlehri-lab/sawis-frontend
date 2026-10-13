import { useState } from "react";
import { updateItem } from "./api";
import type { CatalogItem, Supplier } from "./api";

// Shared by Inventory (quick-edit over the count sheet / Live stock) and the
// full item page. Edits only: stock unit, how many base units it holds, and
// the default supplier. Saving never touches quantities -- the ledger, counts
// and costs all stay in the item's base unit.

const COMMON_UNITS = ["bag", "box", "case", "tray", "bottle", "pack", "carton", "tub", "tin", "crate", "sack"];

function tidy(n: number): string {
  return parseFloat(n.toFixed(4)).toString();
}

// The pack a supplier sells this item in, worked out from its supplier link:
// the raw price per pack divided by the price per base unit gives the number
// of base units in one pack. Null when the link has no pack on file.
function packFromLink(item: CatalogItem, supplierId: string | null): { unit: string; qty: number; supplier: string } | null {
  const links = item.supplier_links.filter((l) => l.supplier_unit && l.supplier_unit !== item.base_unit);
  const ordered = [...links.filter((l) => l.supplier === supplierId), ...links.filter((l) => l.supplier !== supplierId)];
  for (const l of ordered) {
    const raw = Number(l.supplier_unit_price);
    const per = Number(l.unit_price);
    if (raw > 0 && per > 0) return { unit: l.supplier_unit, qty: Math.round((raw / per) * 100) / 100, supplier: l.supplier_name };
  }
  return null;
}

export default function StockUnitPanel({
  accessToken,
  item,
  suppliers,
  onClose,
  onSaved,
  onOpenItem,
}: {
  accessToken: string;
  item: CatalogItem;
  suppliers: Supplier[];
  onClose: () => void;
  onSaved: (updated: CatalogItem) => void;
  onOpenItem?: (itemId: string) => void;
}) {
  const [unit, setUnit] = useState(item.stock_unit);
  const [qty, setQty] = useState(item.stock_unit_qty ? tidy(Number(item.stock_unit_qty)) : "");
  const [supplier, setSupplier] = useState(item.default_supplier ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestion = packFromLink(item, supplier || null);
  const showSuggestion = !!suggestion && (suggestion.unit !== unit.trim() || Number(qty) !== suggestion.qty);

  async function save(clear: boolean) {
    setError(null);
    const name = clear ? "" : unit.trim();
    if (name && !(Number(qty) > 0)) {
      setError(`Say how many ${item.base_unit} are in one ${name}.`);
      return;
    }
    setSaving(true);
    try {
      const updated = await updateItem(accessToken, item.id, {
        stock_unit: name,
        stock_unit_qty: name ? qty : null,
        default_supplier: supplier || null,
      });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !saving && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Stock unit — {item.name}</h2>
        <p className="hint">
          How this item is kept on the shelf. Counts can then be typed in {unit.trim() || "this unit"} or in {item.base_unit}; everything
          is still recorded in {item.base_unit}, so costs and history do not change.
        </p>
        <div className="field">
          <label>Stock unit</label>
          <input
            list="stock-unit-options"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="e.g. bag, box, case"
            maxLength={20}
            autoFocus
          />
          <datalist id="stock-unit-options">
            {COMMON_UNITS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </div>
        <div className="field">
          <label>
            How many {item.base_unit} in one {unit.trim() || "stock unit"}?
          </label>
          <input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="e.g. 1000" />
        </div>
        {showSuggestion && suggestion && (
          <p className="hint">
            {suggestion.supplier} sells this as 1 {suggestion.unit} = {tidy(suggestion.qty)} {item.base_unit}.{" "}
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setUnit(suggestion.unit);
                setQty(tidy(suggestion.qty));
              }}
            >
              Use this
            </button>
          </p>
        )}
        <div className="field">
          <label>Default supplier</label>
          <select value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">None</option>
            {suppliers
              .filter((s) => !s.archived || s.id === supplier)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions" style={{ flexWrap: "wrap" }}>
          {onOpenItem && (
            <button type="button" className="link-btn" style={{ marginRight: "auto" }} onClick={() => onOpenItem(item.id)}>
              Open full item
            </button>
          )}
          {item.stock_unit && (
            <button type="button" className="btn-ghost" disabled={saving} onClick={() => save(true)}>
              Remove stock unit
            </button>
          )}
          <button type="button" className="btn-ghost" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={saving} onClick={() => save(false)}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
