import { formatMoney } from "./api";
import type { HeldCandidate } from "./priceListChanges";
import { fmtQty, keepLabel, needsAmount, pct, perBase, reasonText, adoptLabel } from "./priceCheck";
import type { Decision } from "./priceCheck";

// The "Needs your decision" cards of the price list import review: a line that is already
// linked to an item and would change how its unit converts, or jump in price. Nothing here
// changes unless the person chooses to use the new value; the default is to keep what is saved.

// The cost per base unit the person's choice would give (null until it can be worked out).
function newPerBase(c: HeldCandidate, d: Decision): number | null {
  const typed = Number(d.qty);
  if (c.reason === "unit") return perBase(c.next.price, c.next.pack ?? (typed > 0 ? typed : null));
  if (c.reason === "pack") return perBase(c.next.price, c.next.pack);
  if (d.choice === "size") return perBase(c.next.price, typed > 0 ? typed : null);
  return perBase(c.next.price, c.cur.pack);
}

interface Props {
  cards: HeldCandidate[];
  decisions: Record<string, Decision>;
  currency: string;
  onChange: (key: string, d: Decision) => void;
}

export default function PriceCheckCards({ cards, decisions, currency, onChange }: Props) {
  return (
    <div className="pc-cards">
      {cards.map((c) => {
        const d = decisions[c.key] ?? { choice: "keep", qty: "" };
        const curPer = perBase(c.cur.price, c.cur.pack);
        const preview =
          d.choice === "keep"
            ? c.reason === "price"
              ? perBase(c.next.price, c.cur.pack)
              : c.reason === "pack"
                ? perBase(c.next.price, c.next.pack)
                : c.next.pack
                  ? perBase(c.next.price, c.next.pack)
                  : null
            : newPerBase(c, d);
        const asksAmount = c.reason === "unit" ? needsAmount(c.reason, c.next) : false;
        return (
          <div className="pc-card" key={c.key}>
            <div className="pc-h">
              <b>{c.name}</b>
              <span className="pc-why">{reasonText(c.reason, { ...c.cur }, { ...c.next })}</span>
            </div>
            <div className="pc-linked">
              Linked to <b>{c.item}</b>, which you count and cost in {c.baseUnit}
            </div>
            <div className="pc-cmp">
              <div className="pc-box">
                <small>Saved today</small>
                <div className="pc-big">
                  {c.cur.unit} · {formatMoney(c.cur.price, currency)}
                </div>
                <div className="pc-per">
                  {fmtQty(c.cur.pack)} {c.baseUnit} per {c.cur.unit}
                  {curPer !== null && <> = {formatMoney(curPer, currency, 4)} per {c.baseUnit}</>}
                </div>
              </div>
              <div className="pc-arrow" aria-hidden="true">→</div>
              <div className="pc-box pc-new">
                <small>New list says</small>
                <div className="pc-big">
                  {c.next.unit} · {formatMoney(c.next.price, currency)}
                  {c.reason === "price" && c.cur.price > 0 && (
                    <span className="pc-up"> ({pct(c.cur.price, c.next.price) > 0 ? "+" : ""}{pct(c.cur.price, c.next.price)}%)</span>
                  )}
                </div>
                <div className="pc-per">
                  {c.next.pack ? `${fmtQty(c.next.pack)} ${c.baseUnit} per ${c.next.unit}` : `amount per ${c.next.unit} not in the list`}
                </div>
              </div>
            </div>
            {preview !== null && curPer !== null && (
              <div className="pc-effect">
                If you use it, <b>{c.item} would cost {formatMoney(preview, currency, 4)} per {c.baseUnit} instead of {formatMoney(curPer, currency, 4)}</b>{" "}
                ({pct(curPer, preview) > 0 ? "+" : ""}{pct(curPer, preview)}%). Recipes and stock value move by the same percentage.
              </div>
            )}
            <div className="pc-opts">
              <label className={`pc-opt ${d.choice === "keep" ? "sel" : ""}`}>
                <input type="radio" name={`pc-${c.key}`} checked={d.choice === "keep"} onChange={() => onChange(c.key, { ...d, choice: "keep" })} />
                <span>
                  <b>{keepLabel(c.reason, { unit: c.cur.unit, price: c.cur.price, pack: c.cur.pack }, c.baseUnit, currency)}</b>
                  <small>
                    {c.item} stays at {curPer !== null ? formatMoney(curPer, currency, 4) : "its current cost"} per {c.baseUnit}. The line is marked Price check
                    until a manager decides.
                  </small>
                </span>
              </label>
              <label className={`pc-opt ${d.choice === "use" ? "sel" : ""}`}>
                <input type="radio" name={`pc-${c.key}`} checked={d.choice === "use"} onChange={() => onChange(c.key, { ...d, choice: "use" })} />
                <span>
                  <b>{adoptLabel(c.reason, { unit: c.next.unit, price: c.next.price, pack: c.next.pack }, c.baseUnit, currency)}</b>
                  {c.reason === "price" && <small>Same {fmtQty(c.cur.pack)} {c.baseUnit} per {c.cur.unit}, the price really changed</small>}
                  {c.reason === "unit" && asksAmount && <small>You tell SAWIS how much one {c.next.unit} holds</small>}
                </span>
              </label>
              {c.reason === "unit" && asksAmount && d.choice === "use" && (
                <div className="pc-qty">
                  How many {c.baseUnit} are in one {c.next.unit}?
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={d.qty}
                    onChange={(e) => onChange(c.key, { ...d, qty: e.target.value })}
                    aria-label={`${c.baseUnit} in one ${c.next.unit}`}
                  />
                  {c.baseUnit}
                </div>
              )}
              {c.reason === "price" && (
                <label className={`pc-opt ${d.choice === "size" ? "sel" : ""}`}>
                  <input type="radio" name={`pc-${c.key}`} checked={d.choice === "size"} onChange={() => onChange(c.key, { ...d, choice: "size" })} />
                  <span>
                    <b>The size changed, not just the price</b>
                    <small>The {c.next.unit} now holds a different amount</small>
                  </span>
                </label>
              )}
              {c.reason === "price" && d.choice === "size" && (
                <div className="pc-qty">
                  How many {c.baseUnit} in one {c.next.unit}?
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={d.qty}
                    onChange={(e) => onChange(c.key, { ...d, qty: e.target.value })}
                    aria-label={`${c.baseUnit} in one ${c.next.unit}`}
                  />
                  {c.baseUnit}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
