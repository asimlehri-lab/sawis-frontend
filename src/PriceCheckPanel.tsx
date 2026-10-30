import { useState } from "react";
import { formatMoney } from "./api";
import type { PriceCheckReason } from "./api";
import { fmtQty, keepLabel, needsAmount, pct, perBase, reasonText, adoptLabel } from "./priceCheck";
import type { Side } from "./priceCheck";

// One price check waiting for a manager or admin: what is saved, what the newest list says, what
// using it would do to the item's cost, and the choice: use the new list, keep current, or decide
// later. Used on the supplier's Price list tab and on the receive-delivery screen.

interface Props {
  name: string;
  item: string;
  baseUnit: string;
  reason: PriceCheckReason;
  cur: Side;
  next: Side;
  currency: string;
  busy?: boolean;
  error?: string | null;
  // Prefilled amount per unit (e.g. read from the invoice).
  initialQty?: string;
  qtyNote?: string;
  // The button to highlight when something (an invoice) says which one is right.
  emphasise?: "keep" | "use";
  onUse: (qty?: string) => void;
  onKeep: () => void;
  onLater: () => void;
  // Hide the side-by-side boxes when the screen already shows the comparison.
  compact?: boolean;
}

export default function PriceCheckPanel({
  name, item, baseUnit, reason, cur, next, currency, busy, error, initialQty, qtyNote, emphasise, onUse, onKeep, onLater, compact,
}: Props) {
  const [qty, setQty] = useState(initialQty ?? "");
  const [sizeChanged, setSizeChanged] = useState(false);
  const asksAmount = needsAmount(reason, next) || (reason === "price" && sizeChanged);
  const typed = Number(qty);
  const usablePack = asksAmount ? (typed > 0 ? typed : null) : reason === "price" ? cur.pack : next.pack;
  const curPer = perBase(cur.price, cur.pack);
  const newPer = perBase(next.price, usablePack);
  const ready = !asksAmount || typed > 0;
  const useCls = emphasise === "keep" ? "btn-ghost small" : "btn-primary small";
  const keepCls = emphasise === "keep" ? "btn-primary small" : "btn-ghost small";
  return (
    <div className="pc-card">
      <div className="pc-h">
        <b>{name}</b>
        <span className="pc-why">{reasonText(reason, cur, next)}</span>
      </div>
      <div className="pc-linked">
        Linked to <b>{item}</b>. Currently costed at {curPer !== null ? formatMoney(curPer, currency, 4) : "its saved price"} per {baseUnit}.
      </div>
      {!compact && (
        <div className="pc-cmp">
          <div className="pc-box">
            <small>Current</small>
            <div className="pc-big">{cur.unit} · {formatMoney(cur.price, currency)}</div>
            <div className="pc-per">{cur.pack ? `${fmtQty(cur.pack)} ${baseUnit} per ${cur.unit}` : ""}</div>
          </div>
          <div className="pc-arrow" aria-hidden="true">→</div>
          <div className="pc-box pc-new">
            <small>New list</small>
            <div className="pc-big">
              {next.unit} · {formatMoney(next.price, currency)}
              {reason === "price" && cur.price > 0 && <span className="pc-up"> ({pct(cur.price, next.price) > 0 ? "+" : ""}{pct(cur.price, next.price)}%)</span>}
            </div>
            <div className="pc-per">{next.pack ? `${fmtQty(next.pack)} ${baseUnit} per ${next.unit}` : `amount per ${next.unit} not in the list`}</div>
          </div>
        </div>
      )}
      {curPer !== null && newPer !== null && (
        <div className="pc-effect">
          If you use it, <b>{item} would cost {formatMoney(newPer, currency, 4)} per {baseUnit} instead of {formatMoney(curPer, currency, 4)}</b>{" "}
          ({pct(curPer, newPer) > 0 ? "+" : ""}{pct(curPer, newPer)}%). Recipes and stock value move by the same percentage.
        </div>
      )}
      {asksAmount && (
        <div className="pc-qty" style={{ marginLeft: 0 }}>
          How many {baseUnit} are in one {next.unit}?
          <input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} aria-label={`${baseUnit} in one ${next.unit}`} />
          {baseUnit}
          {qtyNote && <span className="pc-sub">{qtyNote}</span>}
          {newPer !== null && <span className="pc-res">→ {formatMoney(newPer, currency, 4)} per {baseUnit}</span>}
        </div>
      )}
      {reason === "price" && !sizeChanged && (
        <div className="pc-sub" style={{ marginTop: 6 }}>
          Did the size change as well?{" "}
          <button type="button" className="link-btn" onClick={() => setSizeChanged(true)}>
            Enter the amount per {next.unit}
          </button>
        </div>
      )}
      {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}
      <div className="pc-actions">
        <button type="button" className={useCls} disabled={busy || !ready} onClick={() => onUse(asksAmount ? qty : undefined)}>
          {adoptLabel(reason, next, baseUnit, currency)}
        </button>
        <button type="button" className={keepCls} disabled={busy} onClick={onKeep}>
          {keepLabel(reason, cur, baseUnit, currency)}
        </button>
        <button type="button" className="btn-ghost small" disabled={busy} onClick={onLater}>
          Decide later
        </button>
      </div>
    </div>
  );
}
