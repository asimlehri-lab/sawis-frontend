import { useState } from "react";
import { autoFactor, createItemStockUnit, unitFactor } from "./api";
import type { CatalogItem } from "./api";

// "Order in" / "Invoiced in" picker, used on the purchase-order Add line form
// and on every row of the Scan receipt review. It offers only units the item
// already has -- its base unit, its stock units (the same list the count sheet
// and the item's Suppliers tab "Sold as" menu use), and kg/g or L/ml when the
// item is weighed or poured -- plus "+ Add a pack size" so a manager never has
// to leave the order to teach the item a new carton or bag. A new pack is saved
// as a stock unit on the item, so it shows up everywhere else too.
//
// It never writes the quantity or the price: it only tells its parent which
// unit the numbers are in, and how many of the item's base unit one of them
// holds. unit "" means the base unit, no conversion.

export interface UnitChoice {
  unit: string;
  packQty: string;
}

interface Option {
  name: string;
  qty: number;
}

const AUTO_CANDIDATES = ["g", "kg", "ml", "L"];
const SUGGESTED_NAMES = ["carton", "case", "box", "bag", "bottle", "tray", "pack", "tub", "jar", "tin"];

function tidy(n: number): string {
  return Number(n.toFixed(4)).toLocaleString("en-GB", { maximumFractionDigits: 4 });
}

function buildOptions(item: CatalogItem, unit: string, packQty: string): Option[] {
  const out: Option[] = (item.stock_units ?? []).map((u) => ({ name: u.name, qty: Number(u.qty) }));
  const has = (n: string) => out.some((o) => o.name.toLowerCase() === n.toLowerCase());
  for (const c of AUTO_CANDIDATES) {
    const f = autoFactor(c, item.base_unit);
    if (f !== null && c !== item.base_unit && !has(c)) out.push({ name: c, qty: f });
  }
  // A unit already on the line (taught by this supplier's catalogue, or a
  // pack just added) that the item's own list does not hold yet.
  if (unit && unit !== item.base_unit && !has(unit)) {
    const f = unitFactor(item, unit, packQty);
    if (f) out.push({ name: unit, qty: f });
  }
  return out;
}

interface Props {
  item: CatalogItem | undefined;
  unit: string;
  packQty: string;
  accessToken: string;
  label?: string;
  disabled?: boolean;
  onChange: (choice: UnitChoice) => void;
  // Called after a new pack size was saved on the item, so the parent can
  // reload its item list.
  onUnitAdded?: () => void;
}

export default function SupplierUnitPicker({
  item,
  unit,
  packQty,
  accessToken,
  label = "Order in",
  disabled,
  onChange,
  onUnitAdded,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!item) {
    return (
      <div className="field sup-unit">
        <label>{label}</label>
        <select disabled aria-label={label}>
          <option>Pick an item first</option>
        </select>
      </div>
    );
  }

  const options = buildOptions(item, unit, packQty);
  const selected =
    unit && unit !== item.base_unit ? options.find((o) => o.name.toLowerCase() === unit.toLowerCase())?.name ?? "" : "";

  function close() {
    setAdding(false);
    setName("");
    setQty("");
    setErr(null);
  }

  async function save() {
    if (!item || saving) return;
    const n = name.trim();
    const q = Number(qty);
    if (!n) {
      setErr("Give the pack a name, like carton or bag.");
      return;
    }
    if (n.toLowerCase() === item.base_unit.toLowerCase()) {
      setErr(`${item.base_unit} is already this item's unit. Pick it from the list.`);
      return;
    }
    const existing = options.find((o) => o.name.toLowerCase() === n.toLowerCase());
    if (existing) {
      onChange({ unit: existing.name, packQty: String(existing.qty) });
      close();
      return;
    }
    if (!(q > 0)) {
      setErr(`Say how many ${item.base_unit} are in one ${n}.`);
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const created = await createItemStockUnit(accessToken, { item: item.id, name: n, qty: String(q) });
      onChange({ unit: created.name, packQty: String(Number(created.qty)) });
      onUnitAdded?.();
      close();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save the pack size.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`field sup-unit${adding ? " adding" : ""}`}>
      <label>{label}</label>
      <select
        value={adding ? "__new" : selected}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__new") {
            setAdding(true);
            return;
          }
          close();
          if (v === "") {
            onChange({ unit: "", packQty: "1" });
            return;
          }
          const o = options.find((x) => x.name === v);
          if (o) onChange({ unit: o.name, packQty: String(o.qty) });
        }}
      >
        <option value="">{item.base_unit}</option>
        {options.map((o) => (
          <option key={o.name} value={o.name}>
            {o.name} ({tidy(o.qty)} {item.base_unit})
          </option>
        ))}
        <option value="__new">+ Add a pack size…</option>
      </select>
      {adding && (
        <div className="sup-unit-new">
          <p className="sup-unit-new-head">New pack size for {item.name}</p>
          <div className="sup-unit-new-row">
            <input
              className="sup-unit-name"
              list="sup-unit-names"
              value={name}
              placeholder="carton, bag, case…"
              aria-label="Pack name"
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  save();
                }
              }}
            />
            <datalist id="sup-unit-names">
              {SUGGESTED_NAMES.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <span className="sup-unit-eq">holds</span>
            <input
              className="sup-unit-qty"
              type="number"
              min="0"
              step="any"
              value={qty}
              placeholder="24"
              aria-label={`How many ${item.base_unit} in one pack`}
              onChange={(e) => setQty(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  save();
                }
              }}
            />
            <span className="sup-unit-eq">{item.base_unit}</span>
          </div>
          {err && (
            <p className="error" style={{ margin: "6px 0 0" }}>
              {err}
            </p>
          )}
          <div className="sup-unit-new-actions">
            <button type="button" className="btn-ghost small" onClick={close}>
              Cancel
            </button>
            <button type="button" className="mini" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save pack size"}
            </button>
          </div>
          <p className="hint" style={{ margin: "6px 0 0" }}>
            Saved on the item, so you can count and order with it.
          </p>
        </div>
      )}
    </div>
  );
}
