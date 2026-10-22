import { useEffect, useMemo, useState } from "react";
import { autoFactor, deleteItemSupplier, fetchSupplierPriceList, formatMoney, linkPriceListLine } from "./api";
import type {
  CatalogItem,
  PriceListDelivery,
  PriceListLine,
  Supplier,
  SupplierPriceList as PriceListData,
} from "./api";

interface Props {
  supplier: Supplier;
  accessToken: string;
  items: CatalogItem[];
  currency: string;
  readOnly: boolean;
  // Changes whenever a new list was uploaded, so this tab fetches again.
  listVersion: unknown;
  onUploadList: (supplierId: string) => void;
  // Item supplier links changed: the app reloads its own copies.
  onLinksChanged: () => void;
  onOpenItem?: (itemId: string) => void;
}

type Filter = "all" | "linked" | "not" | "del" | "old";

const SHOW_STEP = 100;
const STALE_DAYS = 60;

function fmtShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function fmtLong(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function isStale(line: PriceListLine): boolean {
  return Date.now() - new Date(line.imported_at).getTime() > STALE_DAYS * 86400000;
}

function isStaleDelivery(d: PriceListDelivery): boolean {
  return Date.now() - new Date(d.date).getTime() > STALE_DAYS * 86400000;
}

// A price with as many decimals as it needs (0.379), never fewer than 2.
function money(n: number, currency: string): string {
  const fixed = Number(n.toFixed(4));
  const dp = Math.max(2, (String(fixed).split(".")[1] ?? "").length);
  return formatMoney(fixed, currency, Math.min(4, dp));
}

// Items worth suggesting for a list line: words of the item's name that show
// up in the supplier's wording. Only ever a suggestion, the manager picks.
function similarity(itemName: string, raw: string): number {
  const words = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);
  const a = words(itemName);
  const b = words(raw);
  if (!a.length) return 0;
  let hit = 0;
  for (const w of a) if (b.some((x) => x === w || x.startsWith(w) || w.startsWith(x))) hit++;
  return hit / a.length;
}

function LinkPicker({
  line,
  items,
  currency,
  busy,
  error,
  onCancel,
  onLink,
}: {
  line: PriceListLine;
  items: CatalogItem[];
  currency: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onLink: (itemId: string, qty: string) => void;
}) {
  const live = useMemo(() => items.filter((i) => !i.archived), [items]);
  const [query, setQuery] = useState("");
  const [itemId, setItemId] = useState<string | null>(line.link?.item ?? null);
  const [qty, setQty] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const scored = live
      .map((i) => ({ i, s: similarity(i.name, line.raw_name) }))
      .filter((x) => (q ? x.i.name.toLowerCase().includes(q) : x.s >= 0.5))
      .sort((a, b) => b.s - a.s || a.i.name.localeCompare(b.i.name));
    return scored.slice(0, 8);
  }, [live, query, line.raw_name]);

  const chosen = live.find((i) => i.id === itemId) ?? null;
  const same = chosen ? chosen.base_unit === line.unit : false;
  const auto = chosen ? (same ? 1 : autoFactor(line.unit, chosen.base_unit)) : null;
  const saved = chosen
    ? chosen.stock_units.find((u) => u.name.toLowerCase() === line.unit.toLowerCase())
    : undefined;

  // Pick an item, pre-filling the pack size from what is already known: the
  // item's own saved pack of that name, else what this line last used.
  function choose(item: CatalogItem) {
    setItemId(item.id);
    const pack = item.stock_units.find((u) => u.name.toLowerCase() === line.unit.toLowerCase());
    if (pack) setQty(String(Number(pack.qty)));
    else if (Number(line.base_qty_per_unit) > 1) setQty(String(Number(line.base_qty_per_unit)));
    else setQty("");
  }

  const factor = auto ?? (Number(qty) > 0 ? Number(qty) : null);
  const price = Number(line.price);
  const perBase = factor ? price / factor : null;

  return (
    <div className="modal-backdrop" onClick={() => !busy && onCancel()}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>{line.link ? "Change the linked item" : "Link to one of your items"}</h2>
        <p className="muted" style={{ fontSize: 13, margin: "-8px 0 12px" }}>
          From this supplier's list: <b>{line.raw_name}</b> · {money(price, currency)} per {line.unit} · updated{" "}
          {fmtShort(line.imported_at)}
        </p>
        <input
          className="head-search"
          style={{ width: "100%", marginBottom: 10 }}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your items"
          autoFocus
        />
        <div className="spl-opts" role="listbox" aria-label="Your items">
          {results.length === 0 && (
            <p className="muted" style={{ margin: "4px 0 10px", fontSize: 13 }}>
              {query ? "No item with that name." : "No close matches. Type to search your items."}
            </p>
          )}
          {results.map(({ i, s }, idx) => (
            <button
              key={i.id}
              type="button"
              role="option"
              aria-selected={itemId === i.id}
              className={`spl-opt ${itemId === i.id ? "sel" : ""}`}
              onClick={() => choose(i)}
            >
              <span>
                <b>{i.name}</b>
                <small>
                  {i.category_name ? `${i.category_name} · ` : ""}base unit {i.base_unit}
                </small>
              </span>
              {!query && idx === 0 && s >= 0.8 && <span className="spl-best">Best match</span>}
            </button>
          ))}
        </div>

        {chosen && (
          <div className="spl-calc">
            {auto !== null ? (
              <>
                1 {line.unit} = <b>{Number(auto)} {chosen.base_unit}</b>.{" "}
              </>
            ) : (
              <>
                <label className="spl-qty">
                  1 {line.unit} holds
                  <input
                    inputMode="decimal"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    placeholder={chosen.base_unit === "ea" ? "e.g. 100" : "e.g. 500"}
                  />
                  <b>{chosen.base_unit}</b>
                </label>
                {saved && <span className="muted"> (saved on this item)</span>}
                <br />
              </>
            )}
            {perBase !== null ? (
              <>
                {money(price, currency)} per {line.unit} is <b>{money(perBase, currency)} per {chosen.base_unit}</b>.
                Linking sets <b>{chosen.name}</b> to cost that from this supplier. Recipes using it will recost.
              </>
            ) : (
              <span className="muted">Enter the number to see the cost per {chosen.base_unit}.</span>
            )}
            {line.link && chosen.id !== line.link.item && (
              <div className="muted" style={{ marginTop: 6 }}>
                This replaces the link to <b>{line.link.item_name}</b>.
              </div>
            )}
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => chosen && onLink(chosen.id, auto === null ? qty : "")}
            disabled={busy || !chosen || perBase === null}
          >
            {busy ? "Linking…" : "Link"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SupplierPriceList({
  supplier,
  accessToken,
  items,
  currency,
  readOnly,
  listVersion,
  onUploadList,
  onLinksChanged,
  onOpenItem,
}: Props) {
  const [data, setData] = useState<PriceListData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(SHOW_STEP);
  const [picking, setPicking] = useState<PriceListLine | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState<string | null>(null);

  function load() {
    fetchSupplierPriceList(accessToken, supplier.id)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load this supplier's price list."));
  }

  useEffect(() => {
    load();
  }, [supplier.id, listVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const lines = useMemo(() => data?.lines ?? [], [data]);
  // Items received from this supplier that no list line covers: shown after the list.
  const deliveries = useMemo(() => data?.deliveries ?? [], [data]);
  const counts = useMemo(
    () => ({
      all: lines.length + deliveries.length,
      linked: lines.filter((l) => l.link).length + deliveries.length,
      not: lines.filter((l) => !l.link).length,
      del: deliveries.length,
      old: lines.filter(isStale).length + deliveries.filter(isStaleDelivery).length,
    }),
    [lines, deliveries]
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lines.filter((l) => {
      if (filter === "del") return false;
      if (filter === "linked" && !l.link) return false;
      if (filter === "not" && l.link) return false;
      if (filter === "old" && !isStale(l)) return false;
      if (q && !l.raw_name.toLowerCase().includes(q) && !(l.link && l.link.item_name.toLowerCase().includes(q)))
        return false;
      return true;
    });
  }, [lines, filter, query]);

  const shownDeliveries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return deliveries.filter((d) => {
      if (filter === "not") return false;
      if (filter === "old" && !isStaleDelivery(d)) return false;
      return !q || d.item_name.toLowerCase().includes(q);
    });
  }, [deliveries, filter, query]);

  async function handleLink(itemId: string, qty: string) {
    if (!picking) return;
    setBusy(true);
    setPickError(null);
    try {
      const updated = await linkPriceListLine(accessToken, supplier.id, {
        line: picking.id,
        item: itemId,
        ...(qty ? { qty_per_unit: qty } : {}),
        ...(picking.link ? { replace_link: picking.link.id } : {}),
      });
      setData((d) => (d ? { ...d, lines: d.lines.map((l) => (l.id === updated.id ? updated : l)) } : d));
      setPicking(null);
      onLinksChanged();
      load();
    } catch (e) {
      setPickError(e instanceof Error ? e.message : "Could not link this line.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlink(linkId: string) {
    setBusy(true);
    setError(null);
    try {
      await deleteItemSupplier(accessToken, linkId);
      setConfirmUnlink(null);
      onLinksChanged();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove this link.");
    } finally {
      setBusy(false);
    }
  }

  function actions(line: PriceListLine) {
    if (readOnly) return null;
    if (confirmUnlink === line.id && line.link) {
      return (
        <span className="spl-confirm">
          <span className="muted">Remove link?</span>
          <button className="spl-btn pri" onClick={() => handleUnlink(line.link!.id)} disabled={busy}>
            Remove
          </button>
          <button className="spl-btn ghost" onClick={() => setConfirmUnlink(null)} disabled={busy}>
            Keep
          </button>
        </span>
      );
    }
    if (!line.link)
      return (
        <button
          className="spl-btn pri"
          onClick={() => {
            setPickError(null);
            setPicking(line);
          }}
        >
          Link to item
        </button>
      );
    return (
      <>
        <button
          className="spl-btn"
          onClick={() => {
            setPickError(null);
            setPicking(line);
          }}
        >
          Change
        </button>{" "}
        <button className="spl-btn ghost" onClick={() => setConfirmUnlink(line.id)}>
          Unlink
        </button>
      </>
    );
  }

  function deliveryActions(d: PriceListDelivery) {
    if (readOnly) return null;
    if (confirmUnlink === d.id) {
      return (
        <span className="spl-confirm">
          <span className="muted">Remove link?</span>
          <button className="spl-btn pri" onClick={() => handleUnlink(d.id)} disabled={busy}>
            Remove
          </button>
          <button className="spl-btn ghost" onClick={() => setConfirmUnlink(null)} disabled={busy}>
            Keep
          </button>
        </span>
      );
    }
    return (
      <button className="spl-btn ghost" onClick={() => setConfirmUnlink(d.id)}>
        Unlink
      </button>
    );
  }

  function deliveryItem(d: PriceListDelivery) {
    return (
      <>
        {onOpenItem ? (
          <button className="spl-lnk" onClick={() => onOpenItem(d.item)}>
            {d.item_name}
          </button>
        ) : (
          <b>{d.item_name}</b>
        )}
        <span className="spl-sub">
          costs {money(Number(d.per_base), currency)} per {d.base_unit}
        </span>
      </>
    );
  }

  function invoiced(line: PriceListLine) {
    const li = line.last_invoiced;
    if (!li) return <span className="muted">Not received yet</span>;
    const unitNote = li.unit !== line.unit ? ` per ${li.unit}` : "";
    return (
      <>
        <span className={li.direction === "same" ? "spl-same" : li.direction === "up" ? "spl-up" : "spl-down"}>
          {money(Number(li.price), currency)}
          {li.direction === "up" ? " ▲" : li.direction === "down" ? " ▼" : ""}
        </span>
        <span className="spl-sub">
          {fmtShort(li.date)}
          {unitNote}
        </span>
      </>
    );
  }

  function itemCell(line: PriceListLine) {
    if (!line.link) return <span className="spl-nolink">Not linked</span>;
    return (
      <>
        {onOpenItem ? (
          <button className="spl-lnk" onClick={() => onOpenItem(line.link!.item)}>
            {line.link.item_name}
          </button>
        ) : (
          <b>{line.link.item_name}</b>
        )}
        <span className="spl-sub">
          {line.link.inferred ? "matched by name · " : ""}costs {money(Number(line.link.unit_price), currency)} per{" "}
          {line.link.base_unit}
        </span>
      </>
    );
  }

  if (error && !data) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading the price list…</p>;

  if (data.total === 0 && deliveries.length === 0) {
    return (
      <div className="card" style={{ textAlign: "center" }}>
        <h2 style={{ marginTop: 0 }}>No price list yet</h2>
        <p className="muted">
          Upload the list this supplier sends you (CSV or Excel) and every line will show here, with its price, the date
          it was updated, and which of your items it is linked to.
        </p>
        {!readOnly && (
          <button className="btn-primary small" onClick={() => onUploadList(supplier.id)}>
            ⇪ Upload a price list
          </button>
        )}
      </div>
    );
  }

  const pct = data.total ? Math.round((data.linked / data.total) * 100) : 0;
  const visible = shown.slice(0, limit);

  return (
    <div className="spl">
      {error && <p className="error">{error}</p>}
      <div className="spl-sum">
        {data.total > 0 ? (
          <span className="spl-facts">
            Last upload <b>{data.last_upload ? fmtLong(data.last_upload) : "—"}</b> · <b>{data.linked}</b> of{" "}
            <b>{data.total}</b> lines linked
            <span className="spl-bar" aria-hidden="true">
              <i style={{ width: `${pct}%` }} />
            </span>
            {deliveries.length > 0 && (
              <>
                {" "}
                · <b>{deliveries.length}</b> more from deliveries
              </>
            )}
          </span>
        ) : (
          <span className="spl-facts">
            <b>{deliveries.length}</b> {deliveries.length === 1 ? "item" : "items"} with a remembered price · built from
            your deliveries
            {data.delivered_newest && (
              <>
                {" "}
                · newest <b>{fmtLong(data.delivered_newest)}</b>
              </>
            )}
          </span>
        )}
        {!readOnly && (
          <button className="btn-primary small" onClick={() => onUploadList(supplier.id)}>
            {data.total > 0 ? "⇪ Upload new list" : "⇪ Upload price list"}
          </button>
        )}
      </div>

      <div className="spl-tools">
        {(
          (data.total === 0
            ? [
                ["all", "All", counts.all],
                ["old", `Not bought for ${STALE_DAYS}+ days`, counts.old],
              ]
            : [
                ["all", "All", counts.all],
                ["linked", "Linked", counts.linked],
                ["not", "Not linked", counts.not],
                ...(deliveries.length > 0 ? [["del", "From deliveries", counts.del]] : []),
                ["old", `Older than ${STALE_DAYS} days`, counts.old],
              ]) as [Filter, string, number][]
        ).map(([key, label, n]) => (
          <button key={key} className={`spl-chip ${filter === key ? "on" : ""}`} onClick={() => {
              setFilter(key);
              setLimit(SHOW_STEP);
            }}>
            {label}
            <span className="n">{n}</span>
          </button>
        ))}
        <input
          className="spl-search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(SHOW_STEP);
          }}
          placeholder={data.total === 0 ? "Search your items" : "Search the list or your items"}
          aria-label="Search the price list"
        />
      </div>

      {shown.length === 0 && shownDeliveries.length === 0 ? (
        <p className="muted">No lines match.</p>
      ) : (
        <>
          <div className="table-scroll spl-table">
            <table className="tbl spl-tbl">
              <thead>
                <tr>
                  <th>Supplier's product</th>
                  <th className="num">Price</th>
                  <th>Updated</th>
                  <th>Your item</th>
                  <th className="num">Last invoiced</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <span className="spl-raw">{l.raw_name}</span>
                      <span className="spl-sub">{l.unit}</span>
                    </td>
                    <td className="num">
                      <b>{money(Number(l.price), currency)}</b>
                      <span className="spl-sub">per {l.unit}</span>
                    </td>
                    <td className={isStale(l) ? "spl-old" : ""}>
                      {fmtShort(l.imported_at)}
                      {isStale(l) && <span className="spl-sub spl-oldtxt">over {STALE_DAYS} days</span>}
                    </td>
                    <td>{itemCell(l)}</td>
                    <td className="num">{invoiced(l)}</td>
                    <td className="num">{actions(l)}</td>
                  </tr>
                ))}
                {shownDeliveries.map((d) => (
                  <tr key={`d-${d.id}`}>
                    <td>
                      <span className="spl-raw">{d.item_name}</span>
                      <span className="spl-del">From deliveries</span>
                      <span className="spl-sub">{d.unit}</span>
                    </td>
                    <td className="num">
                      <b>{money(Number(d.price), currency)}</b>
                      <span className="spl-sub">
                        last paid
                        {d.unit !== d.base_unit ? ` · ${money(Number(d.per_base), currency)} per ${d.base_unit}` : ` · per ${d.unit}`}
                      </span>
                    </td>
                    <td className={isStaleDelivery(d) ? "spl-old" : ""}>
                      {fmtShort(d.date)}
                      <span className={`spl-sub ${isStaleDelivery(d) ? "spl-oldtxt" : ""}`}>
                        {isStaleDelivery(d) ? `over ${STALE_DAYS} days` : "received"}
                      </span>
                    </td>
                    <td>{deliveryItem(d)}</td>
                    <td className="num">
                      <span className="muted">same as price</span>
                    </td>
                    <td className="num">{deliveryActions(d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="spl-cards">
            {visible.map((l) => (
              <div className="spl-card" key={l.id}>
                <div className="top">
                  <span className="spl-raw">
                    {l.raw_name}
                    <span className="spl-sub">{l.unit}</span>
                  </span>
                  <span className="price">
                    {money(Number(l.price), currency)}
                    <span className={`spl-sub ${isStale(l) ? "spl-oldtxt" : ""}`} style={{ textAlign: "right" }}>
                      {fmtShort(l.imported_at)}
                    </span>
                  </span>
                </div>
                <div className="row2">
                  <span>{l.link ? <>Linked to <b>{l.link.item_name}</b></> : <span className="spl-nolink">Not linked</span>}</span>
                  {actions(l)}
                </div>
                {l.last_invoiced && <div className="row3">Last invoiced {invoiced(l)}</div>}
              </div>
            ))}
            {shownDeliveries.map((d) => (
              <div className="spl-card" key={`d-${d.id}`}>
                <div className="top">
                  <span className="spl-raw">
                    {d.item_name}
                    <span className="spl-sub">{d.unit}</span>
                  </span>
                  <span className="price">
                    {money(Number(d.price), currency)}
                    <span className={`spl-sub ${isStaleDelivery(d) ? "spl-oldtxt" : ""}`} style={{ textAlign: "right" }}>
                      paid {fmtShort(d.date)}
                    </span>
                  </span>
                </div>
                <div className="row2">
                  <span>
                    <span className="spl-del" style={{ marginLeft: 0 }}>
                      From deliveries
                    </span>
                  </span>
                  {deliveryActions(d)}
                </div>
              </div>
            ))}
          </div>

          {shown.length > limit && (
            <div style={{ textAlign: "center", marginTop: 12 }}>
              <button className="btn-ghost small" onClick={() => setLimit((n) => n + SHOW_STEP)}>
                Show more ({shown.length - limit} left)
              </button>
            </div>
          )}
        </>
      )}

      {picking && (
        <LinkPicker
          key={picking.id}
          line={picking}
          items={items}
          currency={currency}
          busy={busy}
          error={pickError}
          onCancel={() => setPicking(null)}
          onLink={handleLink}
        />
      )}
    </div>
  );
}
