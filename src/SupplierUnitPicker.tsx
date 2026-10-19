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
  // "auto" = kg/g or L/ml (the size is known), "pack" = saved on the item.
  kind: "auto" | "pack";
}

const AUTO_CANDIDATES = ["g", "kg", "ml", "L"];
const SUGGESTED_NAMES = ["carton", "case", "box", "bag", "bottle", "tray", "pack", "tub", "jar", "tin"];

function tidy(n: number): string {
  return Number(n.toFixed(4)).toLocaleString("en-GB", { maximumFractionDigits: 4 });
}

// What a pack holds, in the unit people say it in: 1,500 ml reads "1.5 L".
function pretty(item: CatalogItem, qty: number): string {
  if (item.base_unit === "ml" && qty >= 1000) return `${tidy(qty / 1000)} L`;
  if (item.base_unit === "g" && qty >= 1000) return `${tidy(qty / 1000)} kg`;
  return `${tidy(qty)} ${item.base_unit}`;
}

// A hint for the size box that fits the unit being typed in.
function sizeHint(item: CatalogItem, unit: string, isPack: boolean): string {
  if (isPack) return "12";
  const u = unit || item.base_unit;
  if (u === "L") return "1.5";
  if (u === "kg") return "2.5";
  if (u === "ml" || u === "g") return "500";
  return "24";
}

function buildOptions(item: CatalogItem, unit: string, packQty: string): Option[] {
  const out: Option[] = (item.stock_units ?? []).map((u) => ({ name: u.name, qty: Number(u.qty), kind: "pack" as const }));
  const has = (n: string) => out.some((o) => o.name.toLowerCase() === n.toLowerCase());
  for (const c of AUTO_CANDIDATES) {
    const f = autoFactor(c, item.base_unit);
    if (f !== null && c !== item.base_unit && !has(c)) out.push({ name: c, qty: f, kind: "auto" });
  }
  // A unit already on the line (taught by this supplier's catalogue, or a
  // pack just added) that the item's own list does not hold yet.
  if (unit && unit !== item.base_unit && !has(unit)) {
    const f = unitFactor(item, unit, packQty);
    if (f) out.push({ name: unit, qty: f, kind: "pack" });
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
  // The unit the size is typed in: "" = the item's base unit.
  const [qtyUnit, setQtyUnit] = useState("");
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
    setQtyUnit("");
    setErr(null);
  }

  async function save() {
    if (!item || saving) return;
    const n = name.trim();
    const typed = Number(qty);
    const unitFactorNow = qtyUnit === "" ? 1 : options.find((o) => o.name === qtyUnit)?.qty ?? 0;
    const q = Number((typed * unitFactorNow).toFixed(4));
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
      setErr(`Say how much one ${n} holds.`);
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
            {o.name} ({o.kind === "pack" ? pretty(item, o.qty) : `${tidy(o.qty)} ${item.base_unit}`})
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
              placeholder={sizeHint(item, qtyUnit, options.find((o) => o.name === qtyUnit)?.kind === "pack")}
              aria-label="How much one pack holds"
              onChange={(e) => setQty(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  save();
                }
              }}
            />
            <select
              className="sup-unit-qtyunit"
              value={qtyUnit}
              aria-label="Unit for the size"
              onChange={(e) => setQtyUnit(e.target.value)}
            >
              <option value="">{item.base_unit}</option>
              {options
                .filter((o) => o.kind === "auto")
                .map((o) => (
                  <option key={o.name} value={o.name}>
                    {o.name}
                  </option>
                ))}
              {options
                .filter((o) => o.kind === "pack")
                .map((o) => (
                  <option key={o.name} value={o.name}>
                    {o.name} ({pretty(item, o.qty)})
                  </option>
                ))}
            </select>
          </div>
          {(() => {
            const typed = Number(qty);
            const f = qtyUnit === "" ? 1 : options.find((o) => o.name === qtyUnit)?.qty ?? 0;
            if (!(typed > 0) || !f) return null;
            const total = typed * f;
            const label = name.trim() || "pack";
            return (
              <p className="sup-unit-sum">
                1 {label} = {tidy(typed)} {qtyUnit || item.base_unit}
                {qtyUnit ? ` = ${tidy(total)} ${item.base_unit}` : ""}
              </p>
            );
          })()}
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
