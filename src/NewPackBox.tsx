import { useState } from "react";
import type { CatalogItem } from "./api";
import { nameChips, packOptions, pretty, sizeHint, tidy } from "./packUnits";

// "Add a pack size" box, shared by the purchase-order / scan unit picker and
// the item page's Stock units. A name (with one-tap suggestions), a number,
// and the unit that number is in, so nobody has to work out how many ml are
// in a carton of bottles: pick L, or a pack already saved, and the sum is
// shown before saving. It only collects the name and the size in the item's
// base unit; the parent saves it.

interface Props {
  item: CatalogItem;
  initialName?: string;
  // Also offer one-tap suggestions that fill in the size (kg = 1,000 g).
  presets?: boolean;
  busy?: boolean;
  error?: string | null;
  heading?: string;
  submitLabel?: string;
  hint?: string;
  // One line (name, number, unit, buttons) for wide places; stacked otherwise.
  inline?: boolean;
  // Return true when the name is already one of the item's units and was
  // handled, so no size is needed.
  onPickExisting?: (name: string) => boolean;
  onSubmit: (name: string, qtyInBase: number) => void;
  onCancel: () => void;
}

export default function NewPackBox({
  item,
  initialName = "",
  presets,
  busy,
  error,
  heading,
  submitLabel = "Save pack size",
  hint,
  inline,
  onPickExisting,
  onSubmit,
  onCancel,
}: Props) {
  const [name, setName] = useState(initialName);
  const [qty, setQty] = useState("");
  // The unit the size is typed in: "" = the item's base unit.
  const [qtyUnit, setQtyUnit] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const options = packOptions(item);
  const factor = qtyUnit === "" ? 1 : options.find((o) => o.name === qtyUnit)?.qty ?? 0;
  const typed = Number(qty);

  function submit() {
    if (busy) return;
    const n = name.trim();
    if (!n) {
      setErr("Give the pack a name, like carton or bag.");
      return;
    }
    if (n.toLowerCase() === item.base_unit.toLowerCase()) {
      setErr(`${item.base_unit} is already this item's unit.`);
      return;
    }
    if (onPickExisting?.(n)) return;
    const q = Number((typed * factor).toFixed(4));
    if (!(q > 0)) {
      setErr(`Say how much one ${n} holds.`);
      return;
    }
    setErr(null);
    onSubmit(n, q);
  }

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  const buttons = (
    <div className="sup-unit-new-actions">
      <button type="button" className="btn-ghost small" onClick={onCancel}>
        Cancel
      </button>
      <button type="button" className="mini" onClick={submit} disabled={busy}>
        {busy ? "Saving…" : submitLabel}
      </button>
    </div>
  );

  // Without sizes, leave out names the size menu already offers (kg, L).
  const chips = nameChips(item, !!presets).filter((c) => presets || !options.some((o) => o.kind === "auto" && o.name.toLowerCase() === c.name.toLowerCase()));
  const shownErr = err ?? error;

  return (
    <div className={`sup-unit-new${inline ? " inline" : ""}`}>
      {heading && <p className="sup-unit-new-head">{heading}</p>}
      <div className="sup-unit-new-row">
        {inline && <span className="sup-unit-eq">1</span>}
        <input
          className="sup-unit-name"
          value={name}
          placeholder={inline ? "name" : "carton, bag, case…"}
          aria-label="Pack name"
          maxLength={20}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onEnter}
        />
        <span className="sup-unit-eq">{inline ? "=" : "holds"}</span>
        <input
          className="sup-unit-qty"
          type="number"
          min="0"
          step="any"
          value={qty}
          placeholder={sizeHint(item, qtyUnit, options.find((o) => o.name === qtyUnit)?.kind === "pack")}
          aria-label="How much one pack holds"
          onChange={(e) => setQty(e.target.value)}
          onKeyDown={onEnter}
        />
        <select className="sup-unit-qtyunit" value={qtyUnit} aria-label="Unit for the size" onChange={(e) => setQtyUnit(e.target.value)}>
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
        {inline && buttons}
      </div>
      {chips.length > 0 && (
        <div className="sup-unit-chips" aria-label="Suggested names">
          <span className="sup-unit-eq">Suggested:</span>
          {chips.map((c) => (
            <button
              key={c.name}
              type="button"
              className="sup-unit-chip"
              onClick={() => {
                setName(c.name);
                if (c.qty) {
                  setQty(String(c.qty));
                  setQtyUnit("");
                }
                setErr(null);
              }}
            >
              {c.name}
              {c.qty ? ` = ${tidy(c.qty)} ${item.base_unit}` : ""}
            </button>
          ))}
        </div>
      )}
      {typed > 0 && factor > 0 && (
        <p className="sup-unit-sum">
          1 {name.trim() || "pack"} = {tidy(typed)} {qtyUnit || item.base_unit}
          {qtyUnit ? ` = ${tidy(typed * factor)} ${item.base_unit}` : ""}
        </p>
      )}
      {shownErr && (
        <p className="error" style={{ margin: "6px 0 0" }}>
          {shownErr}
        </p>
      )}
      {!inline && buttons}
      {hint && (
        <p className="hint" style={{ margin: "6px 0 0" }}>
          {hint}
        </p>
      )}
    </div>
  );
}
