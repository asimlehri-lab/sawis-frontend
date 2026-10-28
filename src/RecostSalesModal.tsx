import { useEffect, useMemo, useState } from "react";
import { formatMoney, recostSales } from "./api";
import type { RecostResult } from "./api";

// Recalculate the cost of sales for a date range. A sold dish keeps the cost
// its ingredients had when the sales file was imported, so a price or unit
// fixed afterwards does not change old days. This shows what would change,
// lets the person tick the ingredients to re-price at today's price, and
// applies it.

interface Props {
  accessToken: string;
  location: string;
  locationName: string;
  currency?: string;
  from: string;
  to: string;
  onClose: () => void;
  onApplied: () => void;
}

function pct(n: number | null | undefined) {
  return n === null || n === undefined ? "—" : `${n.toFixed(1)}%`;
}

function unitCost(n: number, currency?: string) {
  const d = n >= 1 ? 2 : n >= 0.1 ? 3 : 4;
  return formatMoney(n, currency, d);
}

export default function RecostSalesModal({ accessToken, location, locationName, currency, from, to, onClose, onApplied }: Props) {
  const [dateFrom, setDateFrom] = useState(from);
  const [dateTo, setDateTo] = useState(to);
  // The last answer, tagged with the dates it was asked for: "loading" is
  // simply "the answer on screen is for other dates".
  const [answer, setAnswer] = useState<{ key: string; data: RecostResult | null; error: string | null } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [done, setDone] = useState<{ items: number; movements: number } | null>(null);

  const validDates = !!dateFrom && !!dateTo && dateTo >= dateFrom;
  const key = `${dateFrom}|${dateTo}`;
  const loading = validDates && answer?.key !== key;
  const data = answer?.key === key ? answer.data : null;
  const error = applyError ?? (answer?.key === key ? answer.error : null) ?? (validDates ? null : "The end date must be on or after the start date.");

  useEffect(() => {
    if (!validDates) return;
    let cancelled = false;
    recostSales(accessToken, { location, date_from: dateFrom, date_to: dateTo })
      .then((r) => {
        if (cancelled) return;
        setAnswer({ key, data: r, error: null });
        setPicked(new Set(r.changes.map((c) => c.id)));
      })
      .catch((e) => {
        if (!cancelled) setAnswer({ key, data: null, error: e instanceof Error ? e.message : "Could not check these dates." });
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, location, dateFrom, dateTo, key, validDates]);

  const sales = Number(data?.net_sales ?? 0);
  const costBefore = Number(data?.cost_before ?? 0);
  const effect = useMemo(
    () => (data ? data.changes.filter((c) => picked.has(c.id)).reduce((a, c) => a + Number(c.effect), 0) : 0),
    [data, picked]
  );
  const afterPct = sales ? ((costBefore + effect) / sales) * 100 : null;

  function toggle(id: string) {
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function apply() {
    if (!data || picked.size === 0) return;
    setApplying(true);
    setApplyError(null);
    try {
      const r = await recostSales(accessToken, {
        location,
        date_from: dateFrom,
        date_to: dateTo,
        item_ids: Array.from(picked),
        apply: true,
      });
      setDone({ items: r.applied_items, movements: r.applied_movements });
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : "Could not recalculate.");
    } finally {
      setApplying(false);
    }
  }

  const busy = loading || applying;

  return (
    <div className="modal-backdrop" onClick={() => !busy && (done ? onApplied() : onClose())}>
      <div className="modal wide recost" role="dialog" aria-label="Recalculate cost" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Recalculate cost</h2>
        <p className="muted recost-intro">
          Sales keep the ingredient prices they had on the day they were imported. If a price or unit was wrong then and is
          right now, this re-prices those sales at today’s prices for <strong>{locationName}</strong>. Stock amounts do not
          change.
        </p>

        {done ? (
          <>
            <div className="scan-row-total ok">
              <span className="scan-row-total-line">
                Done. {done.items} ingredient{done.items === 1 ? "" : "s"} re-priced on {done.movements.toLocaleString("en-GB")} sale
                line{done.movements === 1 ? "" : "s"}.
              </span>
            </div>
            <div className="modal-actions" style={{ marginTop: 12 }}>
              <button type="button" className="btn-primary" onClick={onApplied}>
                Show the updated report
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="fgrid fgrid-2">
              <div className="field">
                <label>From</label>
                <input type="date" value={dateFrom} max={dateTo} onChange={(e) => { setApplyError(null); setDateFrom(e.target.value); }} disabled={applying} />
              </div>
              <div className="field">
                <label>To</label>
                <input type="date" value={dateTo} min={dateFrom} onChange={(e) => { setApplyError(null); setDateTo(e.target.value); }} disabled={applying} />
              </div>
            </div>

            {loading && <p className="muted">Checking these dates…</p>}
            {error && <p className="error">{error}</p>}

            {data && !loading && (
              <>
                {data.changes.length === 0 ? (
                  <div className="scan-row-total ok">
                    <span className="scan-row-total-line">
                      Nothing to change. Every ingredient sold in these dates already has today’s price
                      {sales ? ` (food cost ${pct(data.food_cost_pct_before)})` : ""}.
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="recost-summary">
                      <div>
                        <span className="kl">Food cost now</span>
                        <strong>{pct(data.food_cost_pct_before)}</strong>
                      </div>
                      <span className="recost-arrow" aria-hidden="true">→</span>
                      <div>
                        <span className="kl">After recalculating</span>
                        <strong>{pct(afterPct)}</strong>
                      </div>
                      <div className="recost-sales">
                        <span className="kl">Sales in these dates</span>
                        <strong>{formatMoney(sales, currency, 0)}</strong>
                      </div>
                    </div>

                    <div className="recost-tools">
                      <span className="muted">Tick the ingredients to re-price. Leave a price alone if it really did change over the dates.</span>
                      <span>
                        <button type="button" className="link-btn" onClick={() => setPicked(new Set(data.changes.map((c) => c.id)))}>
                          All
                        </button>
                        {" · "}
                        <button type="button" className="link-btn" onClick={() => setPicked(new Set())}>
                          None
                        </button>
                      </span>
                    </div>

                    <div className="recost-table-wrap">
                      <table className="recost-table">
                        <thead>
                          <tr>
                            <th></th>
                            <th>Ingredient</th>
                            <th className="num">Sold</th>
                            <th className="num">Price used → today</th>
                            <th className="num">Change</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.changes.map((c) => (
                            <tr key={c.id} className={picked.has(c.id) ? "" : "off"}>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={picked.has(c.id)}
                                  onChange={() => toggle(c.id)}
                                  aria-label={`Re-price ${c.name}`}
                                  disabled={applying}
                                />
                              </td>
                              <td>{c.name}</td>
                              <td className="num">
                                {Number(Number(c.qty).toFixed(1)).toLocaleString("en-GB")} {c.unit}
                              </td>
                              <td className="num">
                                {unitCost(Number(c.old_unit_cost), currency)} → {unitCost(Number(c.new_unit_cost), currency)} /{c.unit}
                              </td>
                              <td className={`num ${Number(c.effect) < 0 ? "good" : "bad"}`}>
                                {Number(c.effect) < 0 ? "−" : "+"}
                                {formatMoney(Math.abs(Number(c.effect)), currency, 2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {data.no_price.length > 0 && (
                  <p className="muted recost-note">
                    Left as they are because they have no supplier price on file:{" "}
                    {data.no_price.map((n) => n.name).join(", ")}.
                  </p>
                )}
              </>
            )}

            <div className="modal-actions" style={{ marginTop: 12 }}>
              <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
                {data && data.changes.length === 0 ? "Close" : "Cancel"}
              </button>
              {data && data.changes.length > 0 && (
                <button type="button" className="btn-primary" onClick={apply} disabled={busy || picked.size === 0}>
                  {applying ? "Recalculating…" : `Recalculate ${picked.size} ingredient${picked.size === 1 ? "" : "s"}`}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
