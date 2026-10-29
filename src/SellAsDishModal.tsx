import { useEffect, useMemo, useState } from "react";
import {
  costBand,
  defaultCurrency,
  defaultTargetCostPct,
  fetchSellCandidates,
  formatMoney,
  sellItemsAsDishes,
} from "./api";
import type { Recipe, SellCandidate } from "./api";

// "Sell as a dish": turns bought-in items that are sold as they are (a
// lollypop, a can of cola) into dishes. A dish with one ingredient line --
// the item -- so stock, cost and allergens keep working with no new concept.
// One item opens the full pop-up (price, margin or mark-up, live food cost);
// several open a table with a price per row.

type Mode = "price" | "margin" | "markup";
type Group = "food" | "drink";

interface Row {
  name: string;
  qty: string;
  mode: Mode;
  text: string;
  group: Group;
  category: string;
}

interface Props {
  accessToken: string;
  itemIds: string[];
  locations: { currency?: string; target_food_cost_pct?: string; target_drink_cost_pct?: string }[];
  onClose: () => void;
  // created = the new dishes; openId = the one to jump into, if the person asked.
  onCreated: (created: Recipe[], openId: string | null) => void;
  onOpenDish?: (recipeId: string) => void;
}

const ROUND_CHOICES: { value: string; label: string }[] = [
  { value: "0.05", label: "5p" },
  { value: "0.1", label: "10p" },
  { value: "0.5", label: "50p" },
  { value: "0", label: "No rounding" },
];

// The selling price that lands exactly on the food cost target, rounded UP to
// the step (so the food cost ends at or just under the target).
function suggestPrice(costPerSale: number, targetPct: number, step: number): number | null {
  if (!(costPerSale > 0) || !(targetPct > 0)) return null;
  const raw = costPerSale / (targetPct / 100);
  const p = step > 0 ? Math.ceil(raw / step - 1e-9) * step : raw;
  return Math.round(p * 100) / 100;
}

function priceFrom(row: Row, costPerSale: number): number | null {
  const t = row.text.trim();
  if (!t) return null;
  const v = Number(t);
  if (!Number.isFinite(v) || v < 0) return null;
  if (row.mode === "price") return v;
  if (costPerSale <= 0) return null;
  if (row.mode === "margin") return v >= 100 ? null : costPerSale / (1 - v / 100);
  return costPerSale * (1 + v / 100);
}

function textFor(mode: Mode, price: number, costPerSale: number): string {
  if (mode === "price") return price.toFixed(2);
  if (costPerSale <= 0 || price <= 0) return "";
  return mode === "margin"
    ? (((price - costPerSale) / price) * 100).toFixed(1)
    : (((price - costPerSale) / costPerSale) * 100).toFixed(0);
}

function unitWord(unit: string) {
  return unit === "ea" ? "each" : unit === "btl" ? "bottle" : unit;
}

export default function SellAsDishModal({ accessToken, itemIds, locations, onClose, onCreated, onOpenDish }: Props) {
  const currency = defaultCurrency(locations);
  const key = itemIds.join(",");
  // The last answer, tagged with the items it was asked for: "loading" is
  // simply "the answer on screen is for other items".
  const [answer, setAnswer] = useState<{ key: string; data: SellCandidate[] | null; error: string | null } | null>(null);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [round, setRound] = useState("0.05");
  const [bulkTarget, setBulkTarget] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loading = answer?.key !== key;
  const data = answer?.key === key ? answer.data : null;
  const loadError = answer?.key === key ? answer.error : null;

  useEffect(() => {
    let cancelled = false;
    fetchSellCandidates(accessToken, itemIds)
      .then((list) => {
        if (cancelled) return;
        const step = 0.05;
        const next: Record<string, Row> = {};
        list.forEach((c) => {
          const qty = c.default_qty ?? "";
          const cost = Number(c.cost) * Number(qty || 0);
          const target = defaultTargetCostPct(locations, "food");
          const s = suggestPrice(cost, target, step);
          next[c.item] = { name: c.name, qty, mode: "price", text: s !== null ? s.toFixed(2) : "", group: "food", category: "" };
        });
        setRows(next);
        setAnswer({ key, data: list, error: null });
      })
      .catch((e) => {
        if (!cancelled) setAnswer({ key, data: null, error: e instanceof Error ? e.message : "Could not check these items." });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, key]);

  const todo = useMemo(() => (data ?? []).filter((c) => !c.dish && !c.archived), [data]);
  const already = useMemo(() => (data ?? []).filter((c) => c.dish), [data]);
  const single = itemIds.length === 1;

  function patch(id: string, p: Partial<Row>) {
    setRows((r) => ({ ...r, [id]: { ...r[id], ...p } }));
  }

  function costPerSale(c: SellCandidate): number {
    return Number(c.cost) * Number(rows[c.item]?.qty || 0);
  }
  function targetOf(c: SellCandidate): number {
    return defaultTargetCostPct(locations, rows[c.item]?.group ?? "food");
  }

  function changeMode(c: SellCandidate, mode: Mode) {
    const r = rows[c.item];
    const p = priceFrom(r, costPerSale(c));
    patch(c.item, { mode, text: p !== null ? textFor(mode, p, costPerSale(c)) : "" });
  }

  function applyTarget(pct: number) {
    const step = Number(round);
    setRows((prev) => {
      const next = { ...prev };
      todo.forEach((c) => {
        const r = next[c.item];
        const s = suggestPrice(Number(c.cost) * Number(r.qty || 0), pct, step);
        if (s !== null) next[c.item] = { ...r, mode: "price", text: s.toFixed(2) };
      });
      return next;
    });
  }

  // Row problems shown next to the Create button, so the first click never
  // dead-ends in a server error.
  function problem(c: SellCandidate): string | null {
    const r = rows[c.item];
    if (!r) return null;
    if (!r.name.trim()) return "Give the dish a name.";
    if (!(Number(r.qty) > 0)) return `Say how many ${unitWord(c.base_unit)} go into one sale.`;
    const p = priceFrom(r, costPerSale(c));
    if (p === null || !(p > 0)) return `Set a selling price for ${r.name || c.name}.`;
    return null;
  }
  const firstProblem = todo.map(problem).find((p) => p !== null) ?? null;

  async function create(openAfter: boolean) {
    if (firstProblem || !todo.length) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await sellItemsAsDishes(
        accessToken,
        todo.map((c) => {
          const r = rows[c.item];
          const p = priceFrom(r, costPerSale(c)) ?? 0;
          return {
            item: c.item,
            price: (Math.round(p * 100) / 100).toFixed(2),
            qty: r.qty,
            name: r.name.trim(),
            menu_group: r.group,
            ...(r.category.trim() ? { menu_category: r.category.trim() } : {}),
          };
        })
      );
      onCreated(res.created, openAfter && res.created.length === 1 ? res.created[0].id : null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not create the dishes.");
      setSaving(false);
    }
  }

  function close() {
    if (!saving) onClose();
  }

  const title = single ? `Sell ${data?.[0]?.name ?? "item"} as a dish` : `Sell ${itemIds.length} items as dishes`;

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className={`modal sad ${single ? "" : "wide"}`} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {loading && <p className="muted">Checking the items…</p>}
        {loadError && <p className="error">{loadError}</p>}

        {!loading && data && todo.length === 0 && (
          <>
            <p className="muted">
              {already.length > 0
                ? "These are already sold as dishes, so there is nothing to create."
                : "There is nothing to create from these items."}
            </p>
            {already.map((c) => (
              <p key={c.item} style={{ margin: "4px 0" }}>
                {c.name} →{" "}
                <button type="button" className="open-link" onClick={() => c.dish && onOpenDish?.(c.dish.id)}>
                  Open dish {c.dish?.name}
                </button>
              </p>
            ))}
            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={close}>
                Close
              </button>
            </div>
          </>
        )}

        {!loading && data && todo.length > 0 && single && (() => {
          const c = todo[0];
          const r = rows[c.item];
          if (!r) return null;
          const cps = costPerSale(c);
          const price = priceFrom(r, cps);
          const target = targetOf(c);
          const hasCost = cps > 0;
          const fc = price && price > 0 && hasCost ? (cps / price) * 100 : null;
          const band = costBand(fc, target);
          const sugg = suggestPrice(cps, target, Number(round));
          const counted = c.default_qty !== null;
          return (
            <>
              <p className="muted sad-lead">
                Creates a dish with this item as its only ingredient. The cost follows the supplier price, so it stays right
                when the price changes.
              </p>
              <form onSubmit={(e) => { e.preventDefault(); void create(true); }}>
                <label>
                  Dish name
                  <input value={r.name} onChange={(e) => patch(c.item, { name: e.target.value })} required />
                </label>
                <p className="hint" style={{ margin: "-6px 0 12px" }}>
                  Use the name your till prints, so End of day sales match it.
                </p>
                <div className="sad-row2">
                  <label>
                    One sale uses
                    <span className="sad-inline">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={r.qty}
                        style={{ width: 96 }}
                        onChange={(e) => {
                          // Keep the price the person sees when the portion changes.
                          const p = priceFrom(r, cps);
                          const nq = e.target.value;
                          const ncps = Number(c.cost) * Number(nq || 0);
                          patch(c.item, { qty: nq, ...(r.mode !== "price" && p !== null ? { text: textFor(r.mode, p, ncps) } : {}) });
                        }}
                      />
                      <span className="sad-unit">{unitWord(c.base_unit)}</span>
                    </span>
                  </label>
                  <div className="sad-cost">
                    <span className="sad-kl">Cost per sale</span>
                    <b>{hasCost ? formatMoney(cps, currency, cps < 0.1 ? 4 : 2) : "—"}</b>
                    <small>
                      {c.cost_source === "supplier"
                        ? `Cheapest supplier price, ${formatMoney(Number(c.cost), currency, Number(c.cost) < 0.1 ? 4 : 2)} per ${unitWord(c.base_unit)}`
                        : c.cost_source === "target"
                          ? "From the target cost on the item"
                          : "No price yet"}
                    </small>
                  </div>
                </div>
                {!counted && !r.qty && (
                  <p className="hint" style={{ marginTop: 6 }}>
                    This item is kept in {c.base_unit}. Type how much goes into one sale, for example 330 for a 330 ml bottle.
                  </p>
                )}

                {!hasCost && (
                  <p className="hint sad-warn">
                    {Number(r.qty) > 0
                      ? "This item has no supplier price or target cost yet, so the food cost cannot be worked out. Type the selling price now; the food cost appears once a price is on the item's Suppliers tab."
                      : "Add the portion size to see the cost."}
                  </p>
                )}

                <p className="sad-kl" style={{ margin: "14px 0 6px" }}>Set the price by</p>
                <div className="sad-tabs" role="tablist">
                  {(["price", "margin", "markup"] as Mode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="tab"
                      aria-selected={r.mode === m}
                      className={r.mode === m ? "on" : ""}
                      disabled={m !== "price" && !hasCost}
                      onClick={() => changeMode(c, m)}
                    >
                      {m === "price" ? "Price" : m === "margin" ? "Margin %" : "Mark-up %"}
                    </button>
                  ))}
                </div>
                <div className="sad-setrow">
                  <label className="sad-l" htmlFor="sad-input">
                    {r.mode === "price"
                      ? "Menu price"
                      : r.mode === "margin"
                        ? "Margin (profit as % of the price)"
                        : "Mark-up (profit as % of the cost)"}
                  </label>
                  <input
                    id="sad-input"
                    className="price-in"
                    type="number"
                    min="0"
                    step={r.mode === "price" ? "0.01" : "0.5"}
                    value={r.text}
                    onChange={(e) => patch(c.item, { text: e.target.value })}
                  />
                </div>
                {sugg !== null && (
                  <button type="button" className="sad-chip" onClick={() => patch(c.item, { mode: "price", text: sugg.toFixed(2) })}>
                    Use <b>{formatMoney(sugg, currency)}</b> · your {target}% food cost target, rounded up
                  </button>
                )}

                <div className="sad-prev">
                  <div className="fc-hero" style={{ padding: "6px 0 2px" }}>
                    <div className={`big ${band === "good" ? "good" : band === "caution" ? "over" : "danger"}`}>
                      {fc !== null ? `${fc.toFixed(1)}%` : "—"}
                    </div>
                    <div className="tgt">food cost per sale · target {target}%</div>
                    <div className="meter">
                      <div className="fill" style={{ width: `${Math.min(fc ?? 0, 100)}%`, background: band === "good" ? "var(--good)" : band === "caution" ? "var(--caution)" : "var(--brick)" }} />
                      <div className="tgtm" style={{ left: `${Math.min(target, 100)}%` }} />
                    </div>
                  </div>
                  <div className="metric">
                    <span className="ml">Menu price</span>
                    <span className="mv">{price !== null ? formatMoney(price, currency) : "—"}</span>
                  </div>
                  <div className="metric">
                    <span className="ml">Gross profit per sale</span>
                    <span className="mv">{price !== null && hasCost ? formatMoney(price - cps, currency) : "—"}</span>
                  </div>
                </div>

                <details className="sad-more">
                  <summary>More details (optional)</summary>
                  <div className="sad-row2" style={{ marginTop: 10 }}>
                    <label>
                      Food or drink
                      <select value={r.group} onChange={(e) => patch(c.item, { group: e.target.value as Group })}>
                        <option value="food">Food</option>
                        <option value="drink">Drink</option>
                      </select>
                    </label>
                    <label>
                      Menu category
                      <input value={r.category} placeholder="e.g. Sweets" onChange={(e) => patch(c.item, { category: e.target.value })} />
                    </label>
                  </div>
                </details>

                <p className="perplate" style={{ marginTop: 12 }}>
                  Each sale takes <b>{r.qty || "0"} {unitWord(c.base_unit)}</b> off {c.name} stock. Allergens come from the item.
                  Overhead is not included.
                </p>
                {(saveError || (firstProblem && r.qty !== "")) && <p className="error">{saveError ?? firstProblem}</p>}
                <div className="modal-actions">
                  <button type="button" className="btn-ghost" onClick={close} disabled={saving}>
                    Cancel
                  </button>
                  <button type="button" className="btn-ghost" disabled={saving || !!firstProblem} onClick={() => void create(false)}>
                    Create dish
                  </button>
                  <button type="submit" className="btn-primary" disabled={saving || !!firstProblem}>
                    {saving ? "Creating…" : "Create and open dish"}
                  </button>
                </div>
              </form>
            </>
          );
        })()}

        {!loading && data && todo.length > 0 && !single && (
          <>
            <div className="sad-bulkbar">
              <label style={{ margin: 0 }}>
                Price them at a food cost of{" "}
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={bulkTarget}
                  placeholder={String(defaultTargetCostPct(locations, "food"))}
                  onChange={(e) => setBulkTarget(e.target.value)}
                  style={{ width: 70, display: "inline-block", margin: "0 4px" }}
                />{" "}
                %
              </label>
              <label style={{ margin: 0 }}>
                Round up to{" "}
                <select value={round} onChange={(e) => setRound(e.target.value)} style={{ display: "inline-block", width: "auto", margin: "0 0 0 4px" }}>
                  {ROUND_CHOICES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn-ghost small"
                onClick={() => applyTarget(Number(bulkTarget) > 0 ? Number(bulkTarget) : defaultTargetCostPct(locations, "food"))}
              >
                Apply to all
              </button>
            </div>
            <div className="table-scroll">
              <table className="tbl sad-tbl">
                <thead>
                  <tr>
                    <th>Dish name</th>
                    <th className="num">One sale uses</th>
                    <th className="num">Cost</th>
                    <th className="num">Menu price</th>
                    <th className="num">Food cost</th>
                    <th className="num">Profit</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {todo.map((c) => {
                    const r = rows[c.item];
                    if (!r) return null;
                    const cps = costPerSale(c);
                    const price = priceFrom(r, cps);
                    const hasCost = cps > 0;
                    const target = targetOf(c);
                    const fc = price && price > 0 && hasCost ? (cps / price) * 100 : null;
                    const band = costBand(fc, target);
                    return (
                      <tr key={c.item}>
                        <td className="nm">
                          <input value={r.name} onChange={(e) => patch(c.item, { name: e.target.value })} aria-label="Dish name" />
                        </td>
                        <td className="num">
                          <span className="sad-amt">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={r.qty}
                              onChange={(e) => patch(c.item, { qty: e.target.value })}
                              aria-label={`${c.name} amount per sale`}
                            />
                            <span className="muted">{unitWord(c.base_unit)}</span>
                          </span>
                        </td>
                        <td className="num">{hasCost ? formatMoney(cps, currency, cps < 0.1 ? 4 : 2) : <span className="muted">no price</span>}</td>
                        <td className="num">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={r.mode === "price" ? r.text : price !== null ? price.toFixed(2) : ""}
                            onChange={(e) => patch(c.item, { mode: "price", text: e.target.value })}
                            aria-label={`${c.name} menu price`}
                          />
                        </td>
                        <td className="num" style={{ color: fc === null ? undefined : band === "good" ? "var(--good)" : band === "caution" ? "var(--caution)" : "var(--brick)" }}>
                          {fc !== null ? `${fc.toFixed(1)}%` : "—"}
                        </td>
                        <td className="num">{price !== null && hasCost ? formatMoney(price - cps, currency) : "—"}</td>
                        <td>
                          <select value={r.group} onChange={(e) => patch(c.item, { group: e.target.value as Group })} aria-label="Food or drink">
                            <option value="food">Food</option>
                            <option value="drink">Drink</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="hint" style={{ margin: "10px 0 0" }}>
              Names start as the item name. Use the name your till prints so End of day sales match.
              {already.length > 0 && ` Skipped, already a dish: ${already.map((c) => c.name).join(", ")}.`}
            </p>
            {(saveError || firstProblem) && <p className="error">{saveError ?? firstProblem}</p>}
            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={close} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="btn-primary" disabled={saving || !!firstProblem} onClick={() => void create(false)}>
                {saving ? "Creating…" : `Create ${todo.length} dishes`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
