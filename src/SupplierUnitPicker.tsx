import { useState } from "react";
import { createItemStockUnit, unitFactor } from "./api";
import type { CatalogItem } from "./api";
import NewPackBox from "./NewPackBox";
import { packOptions, pretty, tidy } from "./packUnits";
import type { UnitOption } from "./packUnits";

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

function buildOptions(item: CatalogItem, unit: string, packQty: string): UnitOption[] {
  const out = packOptions(item);
  const has = (n: string) => out.some((o) => o.name.toLowerCase() === n.toLowerCase());
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
  // A unit name read off an invoice line ("pkg") that the item does not have
  // yet; offers to add it as a pack size.
  suggestName?: string;
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
  suggestName,
  onChange,
  onUnitAdded,
}: Props) {
  const [adding, setAdding] = useState(false);
  // A name read off the invoice, to start the box with.
  const [startName, setStartName] = useState("");
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
    setStartName("");
    setErr(null);
  }

  // A name that is already one of the item's units just picks that unit.
  function pickExisting(n: string): boolean {
    const existing = options.find((o) => o.name.toLowerCase() === n.toLowerCase());
    if (!existing) return false;
    onChange({ unit: existing.name, packQty: String(existing.qty) });
    close();
    return true;
  }

  async function save(n: string, q: number) {
    if (!item || saving) return;
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
      {!adding && suggestName && !unit && (
        <p className="hint sup-unit-suggest" style={{ margin: "4px 0 0" }}>
          The invoice says {"\u201c"}
          {suggestName}
          {"\u201d"}.{" "}
          <button
            type="button"
            className="open-link"
            onClick={() => {
              setStartName(suggestName);
              setAdding(true);
            }}
          >
            Add it as a pack size
          </button>
        </p>
      )}
      {adding && (
        <NewPackBox
          key={startName}
          item={item}
          initialName={startName}
          busy={saving}
          error={err}
          heading={`New pack size for ${item.name}`}
          hint="Saved on the item, so you can count and order with it."
          onPickExisting={pickExisting}
          onSubmit={save}
          onCancel={close}
        />
      )}
    </div>
  );
}
