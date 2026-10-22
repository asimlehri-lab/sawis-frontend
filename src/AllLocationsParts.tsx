import { costBand, formatMoney } from "./api";
import type { EodLocationRow, Location, ReportsAll, ReportsLocationRow } from "./api";
import { pct } from "./reportFormat";

// Pieces of the "All locations" view of End of day and Reports: a row per
// location under the totals, the prompt shown where a screen only works for
// one location, and the dishes' units sold when currencies differ.

function targetTag(foodPct: number | null, locations: Location[], id: string) {
  if (foodPct === null) return <span className="muted">No sales</span>;
  const loc = locations.find((l) => l.id === id);
  const target = Number(loc?.target_food_cost_pct) || 30;
  const band = costBand(foodPct, target);
  return <span className={`rp-pill ${band === "good" ? "good" : "caution"}`}>{band === "good" ? "On target" : "Over target"}</span>;
}

export function ReportsByLocation({
  kind,
  rows,
  currency,
  locations,
}: {
  kind: "overview" | "waste" | "category";
  rows: ReportsLocationRow[];
  currency: string;
  locations: Location[];
}) {
  if (rows.length < 2) return null;
  const money = (v: number | null) => (v === null ? "—" : formatMoney(v, currency, 0));
  return (
    <section className="card rp-card lby">
      <h3>By location</h3>
      <div className="table-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>Location</th>
              {kind === "overview" && (
                <>
                  <th className="num">Net sales</th>
                  <th className="num">Food cost</th>
                  <th />
                  <th className="num">Break-even a month</th>
                </>
              )}
              {kind === "waste" && (
                <>
                  <th className="num">Waste cost</th>
                  <th className="num">% of sales</th>
                </>
              )}
              {kind === "category" && (
                <>
                  <th className="num">Ingredient cost</th>
                  <th>Biggest category</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                {kind === "overview" && (
                  <>
                    <td className="num">{money(r.net_sales)}</td>
                    <td className="num">{pct(r.food_cost_pct)}</td>
                    <td>{targetTag(r.food_cost_pct, locations, r.id)}</td>
                    <td className="num">{money(r.sales_needed_month)}</td>
                  </>
                )}
                {kind === "waste" && (
                  <>
                    <td className="num">{money(r.waste_cost)}</td>
                    <td className="num">{pct(r.waste_pct)}</td>
                  </>
                )}
                {kind === "category" && (
                  <>
                    <td className="num">{money(r.cogs)}</td>
                    <td>{r.top_category ?? "—"}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function EodByLocation({ rows, currency, locations }: { rows: EodLocationRow[]; currency: string; locations: Location[] }) {
  if (rows.length < 2) return null;
  return (
    <section className="card rp-card lby">
      <h3>By location</h3>
      <div className="table-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>Location</th>
              <th className="num">Net sales</th>
              <th className="num">Food cost</th>
              <th />
              <th className="num">Covers</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td className="num">{formatMoney(r.net_sales, currency, 0)}</td>
                <td className="num">{pct(r.food_cost_pct)}</td>
                <td>{targetTag(r.food_cost_pct, locations, r.id)}</td>
                <td className="num">{r.covers === null ? "—" : r.covers.toLocaleString("en-GB")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Shown in place of a screen that only makes sense for one location (stock,
// counts, orders, importing sales) while All is selected.
export function PickLocationPrompt({
  title,
  text,
  locations,
  onPick,
}: {
  title: string;
  text: string;
  locations: Location[];
  onPick: (id: string) => void;
}) {
  return (
    <div className="lpick">
      <b>{title}</b>
      {text}
      <div className="lpick-btns">
        {locations.map((l) => (
          <button key={l.id} type="button" onClick={() => onPick(l.id)}>
            {l.name}
          </button>
        ))}
      </div>
    </div>
  );
}

// Menu map when locations use different currencies: revenue and profit per
// dish cannot be added up, but units sold can.
export function UnitsSoldCard({ units }: { units: ReportsAll["menu_units"] }) {
  const top = units.slice(0, 8);
  const max = Math.max(...top.map((u) => u.qty), 1);
  return (
    <section className="card rp-card">
      <div className="rp-card-h">
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 8px" }}>Units sold, all locations</h2>
        <span className="rp-card-total">units, not money</span>
      </div>
      {top.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          No dishes sold in this period yet.
        </p>
      ) : (
        <div className="rp-hbars">
          {top.map((u) => (
            <div key={u.recipe_id}>
              <div className="rp-hbar-h">
                <span>{u.name}</span>
                <span>
                  <b>{u.qty.toLocaleString("en-GB")}</b>
                </span>
              </div>
              <div className="rp-hbar-track">
                <div className="rp-hbar-fill brand" style={{ width: `${Math.max((u.qty / max) * 100, 1.5)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="rp-hint" style={{ margin: "8px 0 0" }}>
        Units sold can be added across locations. Money cannot, until a location is picked.
      </p>
    </section>
  );
}
