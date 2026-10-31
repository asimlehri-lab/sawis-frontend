import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { formatMoney } from "./api";

// A unit price box with an optional "Line total" box beside it. Type either one and the other
// follows: the price always works out as total / qty (and /(1+VAT) when the total includes VAT).
// Whichever was typed last wins, so typing the total keeps that total when the quantity changes.

function trimNum(n: number): string {
  if (!Number.isFinite(n)) return "";
  return String(Number(n.toPrecision(10)));
}

// Money with as many decimals as the number needs (up to 6), never fewer than 2.
export function unitMoney(n: number, currency?: string): string {
  let d = 2;
  for (; d < 6; d++) if (Math.abs(Number(n.toFixed(d)) - n) < 1e-9) break;
  return formatMoney(n, currency, d);
}

// The same price in a second, handier unit: per g and per kg, per ml and per litre.
const OTHER_UNIT: Record<string, { unit: string; mult: number }> = {
  g: { unit: "kg", mult: 1000 },
  kg: { unit: "g", mult: 0.001 },
  ml: { unit: "L", mult: 1000 },
  l: { unit: "ml", mult: 0.001 },
};

interface Props {
  qty: string;
  price: string;
  onPrice: (v: string) => void;
  // VAT % as typed on the form (blank = none).
  vatPct?: string;
  // price / factor = price per base unit. Leave out when the price is already per base unit.
  factor?: number | null;
  baseUnit?: string;
  currency?: string;
  label?: string;
  // Table cell: no label, small input, link underneath.
  compact?: boolean;
  inputStyle?: CSSProperties;
  onTyped?: () => void;
}

export default function LinePriceInput({
  qty,
  price,
  onPrice,
  vatPct = "",
  factor = 1,
  baseUnit = "",
  currency,
  label = "Unit price",
  compact = false,
  inputStyle,
  onTyped,
}: Props) {
  const [open, setOpen] = useState(false);
  const [totalText, setTotalText] = useState("");
  const [last, setLast] = useState<"price" | "total">("price");
  const [withVat, setWithVat] = useState(false);
  const emitted = useRef<string | null>(null);

  const q = Number(qty);
  const vat = Number(vatPct);
  const vatMult = withVat && vatPct.trim() !== "" && Number.isFinite(vat) && vat > 0 ? 1 + vat / 100 : 1;

  function applyTotal(t: string) {
    const T = Number(t);
    if (t.trim() === "" || !Number.isFinite(T) || !(q > 0)) return;
    const p = trimNum(T / vatMult / q);
    emitted.current = p;
    onPrice(p);
  }

  // Quantity or VAT changed while the total is the figure that was typed: keep the total, move the price.
  useEffect(() => {
    if (open && last === "total") applyTotal(totalText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qty, withVat, vatPct]);

  // The form changed the price itself (new item, new unit): the total box goes back to following it.
  useEffect(() => {
    if (last === "total" && price !== emitted.current) setLast("price");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [price]);

  const fromPrice = q > 0 && price.trim() !== "" && Number.isFinite(Number(price)) ? q * Number(price) * vatMult : null;
  const shownTotal = last === "total" ? totalText : fromPrice != null ? trimNum(Number(fromPrice.toFixed(4))) : "";

  const perBase = Number(price) / (factor || 1);
  const other = OTHER_UNIT[baseUnit.toLowerCase()];
  const showReadout = open && baseUnit !== "" && factor != null && Number.isFinite(perBase) && perBase > 0;

  const priceInput = (
    <input
      className={compact ? "par-in" : undefined}
      type="number"
      min="0"
      step="any"
      style={inputStyle}
      value={price}
      onChange={(e) => {
        setLast("price");
        emitted.current = null;
        onPrice(e.target.value);
        onTyped?.();
      }}
    />
  );

  const box = open && (
    <div className="lt-box">
      <div className="lt-row">
        <label className="lt-label">Line total{vatMult > 1 ? " (with VAT)" : ""}</label>
        <input
          type="number"
          min="0"
          step="any"
          value={shownTotal}
          placeholder="0.00"
          onChange={(e) => {
            setTotalText(e.target.value);
            setLast("total");
            applyTotal(e.target.value);
            onTyped?.();
          }}
        />
      </div>
      <label className="lt-vat">
        <input type="checkbox" checked={withVat} onChange={(e) => setWithVat(e.target.checked)} /> The total includes VAT (as on Amazon)
      </label>
      {withVat && (vatPct.trim() === "" || !(vat > 0)) && <div className="lt-note">Set the VAT % above so the VAT can be taken off.</div>}
      {showReadout && (
        <div className="lt-readout">
          = {unitMoney(perBase, currency)} per {baseUnit}
          {other ? ` · ${unitMoney(perBase * other.mult, currency)} per ${other.unit}` : ""}
        </div>
      )}
      <button
        type="button"
        className="link-btn"
        onClick={() => {
          setOpen(false);
          setLast("price");
        }}
      >
        Hide line total
      </button>
    </div>
  );

  const link = !open && (
    <button type="button" className="link-btn lt-link" onClick={() => setOpen(true)}>
      {compact ? "Type total" : "Know the line total instead? Type it"}
    </button>
  );

  if (compact) {
    return (
      <div className="lt-compact">
        {priceInput}
        {link}
        {box}
      </div>
    );
  }
  return (
    <div className="field">
      <label>{label}</label>
      {priceInput}
      {link}
      {box}
    </div>
  );
}
