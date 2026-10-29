import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { downloadPurchasesFile, fetchPurchasesReport, formatMoney, verifyPassword } from "./api";
import type { PurchasesGroup, PurchasesQuery, PurchasesReportData, Supplier } from "./api";

// Purchases report: everything received in a period, with totals ex VAT, VAT
// and incl. VAT, ready to print or hand to an accountant. The figures all come
// from one server calculation (apps/procurement/purchases.py); this screen,
// the print sheet, the CSV and the invoice photo ZIP can never disagree.

interface Props {
  accessToken: string;
  businessName: string;
  userName: string;
  locations: { id: string; name: string; currency?: string }[];
  suppliers: Supplier[];
  onBack: () => void;
  onOpenPO: (id: string) => void;
}

type Preset = "this-month" | "last-month" | "this-quarter" | "this-year" | "custom";
const PRESETS: { key: Exclude<Preset, "custom">; label: string }[] = [
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "this-quarter", label: "This quarter" },
  { key: "this-year", label: "This year" },
];

function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}
function ym(y: number, m: number) {
  return `${y}-${pad(m)}`; // m is 1-12
}
function monthLabel(v: string) {
  const [y, m] = v.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}
function monthEnd(v: string) {
  const [y, m] = v.split("-").map(Number);
  return `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`;
}
function dayLabel(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function presetRange(p: Exclude<Preset, "custom">): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  if (p === "this-month") return { from: ym(y, m), to: ym(y, m) };
  if (p === "last-month") {
    const d = new Date(y, m - 2, 1);
    return { from: ym(d.getFullYear(), d.getMonth() + 1), to: ym(d.getFullYear(), d.getMonth() + 1) };
  }
  if (p === "this-quarter") return { from: ym(y, Math.floor((m - 1) / 3) * 3 + 1), to: ym(y, m) };
  return { from: ym(y, 1), to: ym(y, m) };
}
function monthOptions(): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let y = now.getFullYear() - 4; y <= now.getFullYear(); y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === now.getFullYear() && m > now.getMonth() + 1) break;
      out.push(ym(y, m));
    }
  }
  return out;
}
const MONTHS = monthOptions();

// What was on screen last time, kept in memory so coming back from an order
// opens the report as it was left.
let lastView: { preset: Preset; from: string; to: string; location: string; supplier: string } | null = null;

function num(v: string) {
  return Number(v);
}
function rateLabel(r: string) {
  return `${r}%`;
}

type Modal = null | "csv" | "photos" | "print";

export default function PurchasesReport({ accessToken, businessName, userName, locations, suppliers, onBack, onOpenPO }: Props) {
  const start = lastView ?? { preset: "this-quarter" as Preset, ...presetRange("this-quarter"), location: "all", supplier: "all" };
  const [preset, setPreset] = useState<Preset>(start.preset);
  const [from, setFrom] = useState(start.from);
  const [to, setTo] = useState(start.to);
  const [location, setLocation] = useState(start.location);
  const [supplier, setSupplier] = useState(start.supplier);
  const [focus, setFocus] = useState<null | "invoice" | "vat">(null);
  const [modal, setModal] = useState<Modal>(null);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    lastView = { preset, from, to, location, supplier };
  }, [preset, from, to, location, supplier]);

  const validRange = to >= from;
  const query: PurchasesQuery = useMemo(
    () => ({ date_from: `${from}-01`, date_to: monthEnd(to), location, supplier }),
    [from, to, location, supplier]
  );
  const key = `${query.date_from}|${query.date_to}|${location}|${supplier}`;
  // The last answer, tagged with what it was asked for: "loading" is simply
  // "the answer on screen is for something else".
  const [answer, setAnswer] = useState<{ key: string; data: PurchasesReportData | null; error: string | null } | null>(null);
  const loading = validRange && answer?.key !== key;
  const data = answer?.key === key ? answer.data : null;
  const error = (answer?.key === key ? answer.error : null) ?? (validRange ? null : "The end month must be the same as or after the start month.");

  useEffect(() => {
    if (!validRange) return;
    let cancelled = false;
    fetchPurchasesReport(accessToken, query)
      .then((d) => !cancelled && setAnswer({ key, data: d, error: null }))
      .catch((e) => !cancelled && setAnswer({ key, data: null, error: e instanceof Error ? e.message : "Could not load the report." }));
    return () => {
      cancelled = true;
    };
  }, [accessToken, query, key, validRange]);

  // Printing: the sheet is mounted first, then the browser's print window
  // opens once it has rendered and the sheet goes away when it closes. Same
  // way the Reports PDF works.
  useEffect(() => {
    if (!printing) return;
    const previousTitle = document.title;
    document.title = `Purchases ${query.date_from} to ${query.date_to}`;
    const done = () => {
      document.title = previousTitle;
      setPrinting(false);
    };
    window.addEventListener("afterprint", done, { once: true });
    const t = window.setTimeout(() => window.print(), 250);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("afterprint", done);
      document.title = previousTitle;
    };
  }, [printing, query.date_from, query.date_to]);

  function pickPreset(p: Exclude<Preset, "custom">) {
    const r = presetRange(p);
    setPreset(p);
    setFrom(r.from);
    setTo(r.to);
    setFocus(null);
  }

  const locationName = location === "all" ? "All locations" : locations.find((l) => l.id === location)?.name ?? "";
  const supplierName = supplier === "all" ? "" : suppliers.find((s) => s.id === supplier)?.name ?? "";
  const periodText = `${dayLabel(query.date_from)} to ${dayLabel(query.date_to)}`;
  const checks = data?.checks;
  const anyCheck = !!checks && (checks.orders_without_invoice > 0 || checks.lines_without_vat > 0);
  const activeSuppliers = suppliers.filter((s) => !s.archived);

  return (
    <div className="pur">
      <button type="button" className="back-link" onClick={onBack}>
        ← Procurement
      </button>
      <div className="pur-head">
        <h1 className="page-title" style={{ margin: 0 }}>Purchases report</h1>
        <div className="pur-tools">
          <button className="btn-ghost small" disabled={!data || data.orders_count === 0} onClick={() => setModal("csv")}>
            Download CSV
          </button>
          {data && data.invoice_files.count > 0 && (
            <button className="btn-ghost small" onClick={() => setModal("photos")}>
              Invoice photos ({data.invoice_files.count})
            </button>
          )}
          <button className="btn-primary small" disabled={!data || data.orders_count === 0} onClick={() => setModal("print")}>
            Print or save as PDF
          </button>
        </div>
      </div>

      <div className="card pur-ctl">
        <div className="rtabs">
          {PRESETS.map((p) => (
            <button key={p.key} className={`rtab ${preset === p.key ? "on" : ""}`} onClick={() => pickPreset(p.key)}>
              {p.label}
            </button>
          ))}
          <button className={`rtab ${preset === "custom" ? "on" : ""}`} onClick={() => setPreset("custom")}>
            Custom
          </button>
        </div>
        <div className="fgrid fgrid-4">
          <div className="field">
            <label htmlFor="pur-from">From</label>
            <select id="pur-from" value={from} onChange={(e) => { setFrom(e.target.value); setPreset("custom"); }}>
              {MONTHS.map((m) => (
                <option key={m} value={m}>{monthLabel(m)}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pur-to">To</label>
            <select id="pur-to" value={to} onChange={(e) => { setTo(e.target.value); setPreset("custom"); }}>
              {MONTHS.map((m) => (
                <option key={m} value={m}>{monthLabel(m)}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pur-loc">Location</label>
            <select id="pur-loc" value={location} onChange={(e) => setLocation(e.target.value)}>
              <option value="all">All locations</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pur-sup">Supplier</label>
            <select id="pur-sup" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
              <option value="all">All suppliers</option>
              {activeSuppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="hint" style={{ margin: "10px 0 0" }}>
          {validRange ? `${periodText}. ` : ""}Counts orders marked Received, by the day they were received, at the quantities
          and prices on the invoice. Pick a different start and end month to cover a year or more.
        </p>
      </div>

      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Loading…</p>}

      {data && data.orders_count === 0 && !loading && (
        <p className="muted">No orders were received in this period{supplierName ? ` from ${supplierName}` : ""}.</p>
      )}

      {data && checks && anyCheck && data.orders_count > 0 && (
        <div className="pur-warn" role="status">
          <span aria-hidden="true">⚠</span>
          <span>
            <b>Check before you send it:</b>{" "}
            {checks.orders_without_invoice > 0 && (
              <>
                {checks.orders_without_invoice} {checks.orders_without_invoice === 1 ? "order has" : "orders have"} no supplier
                invoice number
                {checks.lines_without_vat > 0 ? " and " : ". "}
              </>
            )}
            {checks.lines_without_vat > 0 && (
              <>
                {checks.lines_without_vat} {checks.lines_without_vat === 1 ? "line has" : "lines have"} no VAT rate (counted as
                0%).{" "}
              </>
            )}
            {checks.orders_without_invoice > 0 && (
              <button type="button" className="open-link" onClick={() => setFocus(focus === "invoice" ? null : "invoice")}>
                {focus === "invoice" ? "Show all orders" : "Show orders without an invoice number"}
              </button>
            )}{" "}
            {checks.orders_with_missing_vat > 0 && (
              <button type="button" className="open-link" onClick={() => setFocus(focus === "vat" ? null : "vat")}>
                {focus === "vat" ? "Show all orders" : "Show orders with a missing VAT rate"}
              </button>
            )}
          </span>
        </div>
      )}

      {data?.groups.map((g) => (
        <GroupBlock
          key={g.currency}
          group={g}
          showCurrency={data.groups.length > 1}
          focus={focus}
          onOpenPO={onOpenPO}
        />
      ))}

      {modal && data && (
        <ExportModal
          kind={modal}
          accessToken={accessToken}
          query={query}
          data={data}
          onDone={() => setModal(null)}
          onConfirmedPrint={() => {
            setModal(null);
            setPrinting(true);
          }}
          onClose={() => setModal(null)}
        />
      )}
      {printing && data && (
        <PrintSheet
          data={data}
          business={businessName}
          location={locationName}
          supplierName={supplierName}
          by={userName}
          period={periodText}
        />
      )}
    </div>
  );
}

function GroupBlock({
  group,
  showCurrency,
  focus,
  onOpenPO,
}: {
  group: PurchasesGroup;
  showCurrency: boolean;
  focus: null | "invoice" | "vat";
  onOpenPO: (id: string) => void;
}) {
  const cur = group.currency;
  const shown = group.orders.filter((o) => (focus === "invoice" ? !o.invoice_number : focus === "vat" ? o.missing_vat_lines > 0 : true));
  return (
    <section className="pur-group">
      {showCurrency && (
        <h2 className="pur-cur">
          {cur} <span className="muted">· {group.locations.join(", ")}{group.vat_numbers.length > 0 && ` · VAT no. ${group.vat_numbers.join(", ")}`}</span>
        </h2>
      )}
      <div className="pur-kpis">
        <div className="kpi-card pur-sum">
          <div className="kpi-label">Orders received</div>
          <div className="kpi-value">{group.orders_count}</div>
        </div>
        <div className="kpi-card pur-sum">
          <div className="kpi-label">Total (ex VAT)</div>
          <div className="kpi-value">{formatMoney(num(group.net), cur)}</div>
        </div>
        <div className="kpi-card pur-sum">
          <div className="kpi-label">VAT</div>
          <div className="kpi-value">{formatMoney(num(group.vat), cur)}</div>
        </div>
        <div className="kpi-card pur-sum hl">
          <div className="kpi-label">Total (incl. VAT)</div>
          <div className="kpi-value">{formatMoney(num(group.gross), cur)}</div>
        </div>
      </div>

      <div className="pur-two">
        <div className="card" style={{ margin: 0 }}>
          <h2 style={{ marginTop: 0 }}>By VAT rate</h2>
          <div className="table-scroll">
            <table className="tbl pur-tbl">
              <thead>
                <tr>
                  <th>Rate</th>
                  <th className="num">Net</th>
                  <th className="num">VAT</th>
                  <th className="num">Gross</th>
                </tr>
              </thead>
              <tbody>
                {group.by_rate.map((r) => (
                  <tr key={r.rate}>
                    <td>{rateLabel(r.rate)}</td>
                    <td className="num">{formatMoney(num(r.net), cur)}</td>
                    <td className="num">{formatMoney(num(r.vat), cur)}</td>
                    <td className="num">{formatMoney(num(r.gross), cur)}</td>
                  </tr>
                ))}
                <tr className="tot">
                  <td>Total</td>
                  <td className="num">{formatMoney(num(group.net), cur)}</td>
                  <td className="num">{formatMoney(num(group.vat), cur)}</td>
                  <td className="num">{formatMoney(num(group.gross), cur)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div className="card" style={{ margin: 0 }}>
          <h2 style={{ marginTop: 0 }}>By supplier</h2>
          <div className="table-scroll">
            <table className="tbl pur-tbl">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th className="num">Orders</th>
                  <th className="num">Net</th>
                  <th className="num">VAT</th>
                  <th className="num">Gross</th>
                </tr>
              </thead>
              <tbody>
                {group.by_supplier.map((s) => (
                  <tr key={s.supplier}>
                    <td className="dish">{s.supplier}</td>
                    <td className="num">{s.orders}</td>
                    <td className="num">{formatMoney(num(s.net), cur)}</td>
                    <td className="num">{formatMoney(num(s.vat), cur)}</td>
                    <td className="num">{formatMoney(num(s.gross), cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2 style={{ marginTop: 0 }}>
          Orders received{focus ? <span className="muted"> · {focus === "invoice" ? "no invoice number" : "missing VAT rate"}</span> : null}
        </h2>
        <div className="table-scroll">
          <table className="tbl pur-tbl">
            <thead>
              <tr>
                <th>Received</th>
                <th>PO</th>
                <th>Supplier invoice</th>
                <th>Supplier</th>
                {!showCurrency && group.locations.length > 1 && <th>Location</th>}
                <th className="num">Ex VAT</th>
                <th className="num">VAT</th>
                <th className="num">Incl. VAT</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((o) => (
                <tr key={o.id} className="clickable" onClick={() => onOpenPO(o.id)}>
                  <td>{dayLabel(o.received_date)}</td>
                  <td className="muted">{o.po_number || "—"}</td>
                  <td>{o.invoice_number || <span className="badge warn">Missing</span>}</td>
                  <td className="dish">{o.supplier}</td>
                  {!showCurrency && group.locations.length > 1 && <td className="muted">{o.location}</td>}
                  <td className="num">{formatMoney(num(o.net), cur)}</td>
                  <td className="num">
                    {formatMoney(num(o.vat), cur)}
                    {o.missing_vat_lines > 0 && <span className="badge warn" style={{ marginLeft: 6 }} title="Some lines have no VAT rate">VAT?</span>}
                  </td>
                  <td className="num"><b>{formatMoney(num(o.gross), cur)}</b></td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted" style={{ textAlign: "center" }}>
                    Nothing to show.
                  </td>
                </tr>
              )}
              {!focus && (
                <tr className="tot">
                  <td colSpan={4 + (!showCurrency && group.locations.length > 1 ? 1 : 0)}>Total, {group.orders_count} {group.orders_count === 1 ? "order" : "orders"}</td>
                  <td className="num">{formatMoney(num(group.net), cur)}</td>
                  <td className="num">{formatMoney(num(group.vat), cur)}</td>
                  <td className="num">{formatMoney(num(group.gross), cur)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

// Password check, then the action. Every download asks again, like the Reports
// export: this holds what is spent with every supplier.
function ExportModal({
  kind,
  accessToken,
  query,
  data,
  onDone,
  onConfirmedPrint,
  onClose,
}: {
  kind: "csv" | "photos" | "print";
  accessToken: string;
  query: PurchasesQuery;
  data: PurchasesReportData;
  onDone: () => void;
  onConfirmedPrint: () => void;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [detail, setDetail] = useState<"order" | "line">("order");
  const [busy, setBusy] = useState<number | "csv" | "check" | null>(null);
  const [doneParts, setDoneParts] = useState<number[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const title = kind === "csv" ? "Download CSV" : kind === "photos" ? "Download invoice photos" : "Print or save as PDF";
  const blurb =
    kind === "csv"
      ? "A file for Excel with the orders in this period."
      : kind === "photos"
        ? "The invoice photos attached to these orders."
        : "The report for this period, ready to print or save as a PDF.";

  async function confirm() {
    if (!password) {
      setErr("Enter your password.");
      return;
    }
    setBusy("check");
    setErr(null);
    try {
      await verifyPassword(accessToken, password);
      if (kind === "print") {
        onConfirmedPrint();
        return;
      }
      if (kind === "csv") {
        setBusy("csv");
        await downloadPurchasesFile(accessToken, "csv", query, { detail });
        onDone();
        return;
      }
      setUnlocked(true);
      setBusy(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(null);
    }
  }

  async function getPart(n: number) {
    setBusy(n);
    setErr(null);
    try {
      await downloadPurchasesFile(accessToken, "invoices", query, { part: String(n) });
      setDoneParts((d) => (d.includes(n) ? d : [...d, n]));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not download that part.");
    } finally {
      setBusy(null);
    }
  }

  const mb = (data.invoice_files.bytes / (1024 * 1024)).toFixed(data.invoice_files.bytes > 10 * 1024 * 1024 ? 0 : 1);
  return (
    <div className="modal-backdrop" onClick={() => busy === null && onClose()}>
      <div className="modal" style={{ textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>{title}</h2>
        {!unlocked ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void confirm();
            }}
          >
            <p className="hint" style={{ marginTop: -6 }}>
              {blurb} It shows what you spend with every supplier, so re-enter your password to continue.
            </p>
            {kind === "csv" && (
              <div className="pur-radios" role="radiogroup" aria-label="Rows">
                <label>
                  <input type="radio" name="pur-detail" checked={detail === "order"} onChange={() => setDetail("order")} /> One row per order
                  <small>Totals only: the usual choice for the books.</small>
                </label>
                <label>
                  <input type="radio" name="pur-detail" checked={detail === "line"} onChange={() => setDetail("line")} /> One row per line
                  <small>Adds the item, quantity, unit price and VAT rate.</small>
                </label>
              </div>
            )}
            {kind === "photos" && (
              <p className="hint">
                {data.invoice_files.count} {data.invoice_files.count === 1 ? "photo" : "photos"} ({mb} MB)
                {data.invoice_files.parts > 1 ? `, in ${data.invoice_files.parts} ZIP files so each one downloads quickly` : ""}. Each ZIP has
                an index.csv saying which order every photo belongs to.
                {data.checks.orders_without_photo > 0 &&
                  ` ${data.checks.orders_without_photo} ${data.checks.orders_without_photo === 1 ? "order has" : "orders have"} no photo attached.`}
              </p>
            )}
            <label>
              Password
              <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </label>
            {err && <p className="error">{err}</p>}
            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={onClose} disabled={busy !== null}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={busy !== null}>
                {busy === "check" ? "Checking…" : busy === "csv" ? "Preparing…" : kind === "csv" ? "Download" : "Continue"}
              </button>
            </div>
          </form>
        ) : (
          <>
            <p className="hint" style={{ marginTop: -6 }}>
              Download each part. Your browser may ask to allow several downloads.
            </p>
            <div className="pur-parts">
              {Array.from({ length: data.invoice_files.parts }, (_, i) => i + 1).map((n) => (
                <button key={n} type="button" className="btn-ghost small" disabled={busy !== null} onClick={() => void getPart(n)}>
                  {busy === n ? "Preparing…" : doneParts.includes(n) ? `✓ Part ${n} of ${data.invoice_files.parts}` : `Part ${n} of ${data.invoice_files.parts}`}
                </button>
              ))}
            </div>
            {err && <p className="error">{err}</p>}
            <div className="modal-actions">
              <button type="button" className="btn-primary" onClick={onDone} disabled={busy !== null}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PrintSheet({
  data,
  business,
  location,
  supplierName,
  by,
  period,
}: {
  data: PurchasesReportData;
  business: string;
  location: string;
  supplierName: string;
  by: string;
  period: string;
}) {
  const printed = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const m = (v: string, cur: string) => formatMoney(num(v), cur).replace(/^[^\d-]+/, "");
  return createPortal(
    <div className="print-only pp">
      <div className="pp-top">
        <div>
          <h1>{business || "Purchases"}</h1>
        </div>
        <div className="pp-title">
          Purchases report
          <small>Orders received, by received date</small>
        </div>
      </div>
      <div className="pp-meta">
        <div><b>Period</b>{period}</div>
        <div><b>Location</b>{location}</div>
        <div><b>Supplier</b>{supplierName || "All suppliers"}</div>
        <div><b>Orders</b>{data.orders_count}</div>
        <div><b>Prepared</b>{printed}</div>
        <div><b>Prepared by</b>{by}</div>
        {data.groups.length === 1 && data.groups[0].vat_numbers.length > 0 && (
          <div><b>VAT registration number</b>{data.groups[0].vat_numbers.join(", ")}</div>
        )}
      </div>
      {data.groups.map((g) => {
        const cur = g.currency;
        return (
          <section key={cur} className="pp-group">
            {data.groups.length > 1 && (
              <h2>{cur} · {g.locations.join(", ")}{g.vat_numbers.length > 0 && ` · VAT registration number ${g.vat_numbers.join(", ")}`}</h2>
            )}
            <div className="pp-sum">
              <div><b>Total ex VAT</b><span>{formatMoney(num(g.net), cur)}</span></div>
              <div><b>VAT</b><span>{formatMoney(num(g.vat), cur)}</span></div>
              <div><b>Total incl. VAT</b><span>{formatMoney(num(g.gross), cur)}</span></div>
            </div>
            <table>
              <thead>
                <tr><th>VAT rate</th><th className="r">Net</th><th className="r">VAT</th><th className="r">Gross</th></tr>
              </thead>
              <tbody>
                {g.by_rate.map((r) => (
                  <tr key={r.rate}><td>{r.rate}% VAT</td><td className="r">{m(r.net, cur)}</td><td className="r">{m(r.vat, cur)}</td><td className="r">{m(r.gross, cur)}</td></tr>
                ))}
              </tbody>
            </table>
            <table>
              <thead>
                <tr>
                  <th>Received</th><th>PO</th><th>Invoice</th><th>Supplier</th>
                  <th className="r">Ex VAT</th><th className="r">VAT</th><th className="r">Incl. VAT</th>
                </tr>
              </thead>
              <tbody>
                {g.orders.map((o) => (
                  <tr key={o.id}>
                    <td>{o.received_date.split("-").reverse().join("/")}</td>
                    <td>{o.po_number}</td>
                    <td>{o.invoice_number || "—"}</td>
                    <td>{o.supplier}</td>
                    <td className="r">{m(o.net, cur)}</td>
                    <td className="r">{m(o.vat, cur)}</td>
                    <td className="r">{m(o.gross, cur)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="pp-total">
                  <td colSpan={4}>Total, {g.orders_count} {g.orders_count === 1 ? "order" : "orders"}</td>
                  <td className="r">{m(g.net, cur)}</td>
                  <td className="r">{m(g.vat, cur)}</td>
                  <td className="r">{m(g.gross, cur)}</td>
                </tr>
              </tfoot>
            </table>
          </section>
        );
      })}
      <div className="pp-foot">Generated by SAWIS</div>
    </div>,
    document.body
  );
}
