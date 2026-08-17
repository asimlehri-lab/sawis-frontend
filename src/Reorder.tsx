import { useEffect, useState } from "react";
import { createPOLine, createPurchaseOrder, fetchOnHand, fetchPurchaseOrders } from "./api";
import type { CatalogItem, ItemSupplierRow, Location, PurchaseOrder } from "./api";

interface Props {
  accessToken: string;
  items: CatalogItem[];
  locations: Location[];
  itemSupplierLinks: ItemSupplierRow[];
}

interface ReorderLine {
  holdingId: string;
  itemId: string;
  itemName: string;
  baseUnit: string;
  department: "kitchen" | "bar" | "foh";
  parLevel: number;
  onHand: number;
}

const gbp = (n: number) => `£${n.toFixed(2)}`;

// The Reorder step of the End of day workflow: items below par at a
// location, with supplier prices compared side by side (cheapest flagged
// against whichever supplier you most recently ordered that item from —
// there's no separate "default supplier" concept in the data model, so
// "most recently ordered from" is the closest real proxy, and matches the
// mockup's own framing: "prices from your last recorded orders"), and a
// one-click way to raise the resulting purchase order(s) — one PO per
// supplier, since a PurchaseOrder belongs to a single supplier.
export default function Reorder({ accessToken, items, locations, itemSupplierLinks }: Props) {
  const [location, setLocation] = useState(locations[0]?.id ?? "");
  const [onHand, setOnHand] = useState<Record<string, number>>({});
  const [loadingOnHand, setLoadingOnHand] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [supplierChoice, setSupplierChoice] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [result, setResult] = useState<{ pos: number; lines: number } | null>(null);
  // Real purchase orders, fetched from the backend — this (not any local
  // "just clicked raise" flag) is what decides whether an item is "already
  // on order", so the lock survives switching tabs or reloading the page,
  // not just staying mounted. Refetched right after a successful raise so
  // the newly-created PO(s) lock their items immediately.
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[] | null>(null);

  function reloadPurchaseOrders() {
    fetchPurchaseOrders(accessToken)
      .then(setPurchaseOrders)
      .catch(() => {});
  }
  useEffect(reloadPurchaseOrders, [accessToken]);

  const activeItems = items.filter((i) => !i.archived);
  const holdingsAtLocation: ReorderLine[] = activeItems.flatMap((it) =>
    it.holdings
      .filter((h) => h.location === location)
      .map((h) => ({
        holdingId: h.id,
        itemId: it.id,
        itemName: it.name,
        baseUnit: it.base_unit,
        department: h.department as "kitchen" | "bar" | "foh",
        parLevel: Number(h.par_level),
        onHand: onHand[h.id] ?? 0,
      }))
  );

  useEffect(() => {
    if (!location) return;
    const holdings = activeItems.flatMap((it) => it.holdings.filter((h) => h.location === location));
    if (holdings.length === 0) return;
    let cancelled = false;
    setLoadingOnHand(true);
    Promise.all(
      holdings.map((h) =>
        fetchOnHand(accessToken, h.item, location, h.department).then((v) => [h.id, v] as const)
      )
    ).then((pairs) => {
      if (cancelled) return;
      setOnHand(Object.fromEntries(pairs));
      setLoadingOnHand(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, items]);

  const belowPar = holdingsAtLocation.filter((h) => h.onHand < h.parLevel && !excluded[h.holdingId]);

  function linksFor(itemId: string) {
    return itemSupplierLinks.filter((l) => l.item === itemId);
  }
  function defaultLink(itemId: string): ItemSupplierRow | null {
    const links = linksFor(itemId);
    if (links.length === 0) return null;
    const withDate = links.filter((l) => l.last_ordered_at);
    if (withDate.length === 0) return links[0];
    return withDate.reduce((a, b) => ((a.last_ordered_at as string) > (b.last_ordered_at as string) ? a : b));
  }
  function cheapestLink(itemId: string): ItemSupplierRow | null {
    const links = linksFor(itemId);
    if (links.length === 0) return null;
    return links.reduce((a, b) => (Number(b.unit_price) < Number(a.unit_price) ? b : a));
  }
  function chosenLink(h: ReorderLine): ItemSupplierRow | null {
    const links = linksFor(h.itemId);
    const chosenId = supplierChoice[h.holdingId];
    return links.find((l) => l.id === chosenId) ?? defaultLink(h.itemId);
  }
  // The real committed qty/supplier for an item already on order — looked
  // up from the actual PO lines rather than the (possibly-reset) local qty
  // and supplier selection state, so what's shown for a locked row is
  // always what's actually on the purchase order, not a fresh default guess.
  function onOrderLinesFor(itemId: string) {
    return (purchaseOrders ?? [])
      .filter((po) => po.location === location && po.status !== "received")
      .flatMap((po) => po.lines.filter((l) => l.item === itemId).map((l) => ({ ...l, supplierName: po.supplier_name })));
  }

  // An item counts as "already on order" if it appears on any purchase
  // order for this location that hasn't been received yet (draft, awaiting,
  // sent, or amended) — once received, stock reflects it and a fresh
  // shortfall should be reorderable again.
  const onOrderItemIds = new Set(
    (purchaseOrders ?? [])
      .filter((po) => po.location === location && po.status !== "received")
      .flatMap((po) => po.lines.map((l) => l.item))
  );

  const orderable = belowPar.filter((h) => linksFor(h.itemId).length > 0);
  const noSupplier = belowPar.filter((h) => linksFor(h.itemId).length === 0);
  const pendingOrderable = orderable.filter((h) => !onOrderItemIds.has(h.itemId));

  function suggestedQty(h: ReorderLine) {
    return Math.max(h.parLevel - h.onHand, 0);
  }
  function qtyFor(h: ReorderLine) {
    return qty[h.holdingId] ?? suggestedQty(h).toFixed(2);
  }

  let totalSavings = 0;
  for (const h of pendingOrderable) {
    const def = defaultLink(h.itemId);
    const chosen = chosenLink(h);
    if (!def || !chosen) continue;
    const q = Number(qtyFor(h)) || 0;
    totalSavings += q * (Number(def.unit_price) - Number(chosen.unit_price));
  }

  // Group into one PO per chosen supplier — PurchaseOrder belongs to a
  // single supplier, so items going to different suppliers need separate
  // POs even though they're raised together from this one screen. Only
  // pending (not-yet-ordered) lines are eligible, so re-raising after a
  // successful submission can't include the same item twice.
  const bySupplier = new Map<
    string,
    { supplierName: string; lines: { h: ReorderLine; link: ItemSupplierRow; q: number }[] }
  >();
  for (const h of pendingOrderable) {
    const q = Number(qtyFor(h)) || 0;
    if (q <= 0) continue;
    const link = chosenLink(h);
    if (!link) continue;
    if (!bySupplier.has(link.supplier)) bySupplier.set(link.supplier, { supplierName: link.supplier_name, lines: [] });
    bySupplier.get(link.supplier)!.lines.push({ h, link, q });
  }

  async function handleRaisePOs() {
    if (!location || bySupplier.size === 0) return;
    setCreating(true);
    setCreateError(null);
    let posCreated = 0;
    let lineCount = 0;
    let anyCreated = false;
    try {
      for (const [supplierId, group] of bySupplier) {
        const po = await createPurchaseOrder(accessToken, { location, supplier: supplierId });
        posCreated++;
        anyCreated = true;
        for (const { h, link, q } of group.lines) {
          await createPOLine(accessToken, {
            po: po.id,
            item: h.itemId,
            department: h.department,
            qty: q.toFixed(3),
            unit_price: link.unit_price,
          });
          lineCount++;
        }
      }
      setResult({ pos: posCreated, lines: lineCount });
    } catch (e) {
      const base = e instanceof Error ? e.message : "Could not raise these purchase orders.";
      setCreateError(
        anyCreated
          ? `${base} ${posCreated} purchase order${posCreated === 1 ? "" : "s"} with ${lineCount} line${
              lineCount === 1 ? "" : "s"
            } were created before this happened — check Procurement, and don't re-raise those items.`
          : base
      );
    } finally {
      // A raised PO/line is real server state even on a mid-batch failure,
      // so always refetch — this is what re-derives which items just
      // became "on order" and locks them, whether the raise fully
      // succeeded or partially did.
      if (anyCreated) reloadPurchaseOrders();
      setCreating(false);
    }
  }

  function toggleExclude(id: string) {
    setExcluded((ex) => ({ ...ex, [id]: !ex[id] }));
  }

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 18px",
          borderBottom: "1px solid var(--border)",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 15 }}>Reorder — items below par</h2>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
            Prices from your last recorded supplier orders
          </div>
        </div>
        {locations.length > 1 && (
          <select
            value={location}
            onChange={(e) => {
              setLocation(e.target.value);
              setResult(null);
            }}
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {!locations.length && <p className="error" style={{ margin: 18 }}>No locations yet.</p>}
      {(loadingOnHand || purchaseOrders === null) && (
        <p className="muted" style={{ margin: 18 }}>Checking stock levels…</p>
      )}
      {createError && <p className="error" style={{ margin: 18 }}>{createError}</p>}

      {!loadingOnHand && purchaseOrders !== null && locations.length > 0 && belowPar.length === 0 && (
        <p className="muted" style={{ margin: 18 }}>Nothing is below par at this location right now.</p>
      )}

      {purchaseOrders !== null && orderable.map((h) => {
        const links = linksFor(h.itemId);
        const def = defaultLink(h.itemId);
        const cheapest = cheapestLink(h.itemId);
        const chosen = chosenLink(h);
        if (!def || !cheapest || !chosen) return null;
        const q = Number(qtyFor(h)) || 0;
        const lineTotal = q * Number(chosen.unit_price);
        const alreadyOrdered = onOrderItemIds.has(h.itemId);

        if (alreadyOrdered) {
          const onOrderLines = onOrderLinesFor(h.itemId);
          const onOrderQty = onOrderLines.reduce((s, l) => s + Number(l.qty), 0);
          const onOrderSuppliers = Array.from(new Set(onOrderLines.map((l) => l.supplierName)));
          return (
            <div
              key={h.holdingId}
              className="ritem"
              style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", opacity: 0.5 }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <b>{h.itemName}</b>{" "}
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    {onOrderQty} {h.baseUnit} on order from {onOrderSuppliers.join(", ")}
                  </span>
                </div>
                <span className="badge b-ok">✓ On order — see Procurement</span>
              </div>
            </div>
          );
        }

        let nudge;
        if (cheapest.id === def.id) {
          nudge = <span className="badge b-low">Already best price</span>;
        } else if (chosen.id === cheapest.id) {
          nudge = (
            <span className="badge b-ok">
              Saving {gbp(q * (Number(def.unit_price) - Number(cheapest.unit_price)))} vs usual
            </span>
          );
        } else {
          nudge = (
            <button
              type="button"
              className="btn-ghost small"
              onClick={() => setSupplierChoice((c) => ({ ...c, [h.holdingId]: cheapest.id }))}
            >
              Save {gbp(q * (Number(def.unit_price) - Number(cheapest.unit_price)))} — use {cheapest.supplier_name}
            </button>
          );
        }
        return (
          <div key={h.holdingId} className="ritem" style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <div>
                <b>{h.itemName}</b>{" "}
                <span className="muted" style={{ fontSize: 11.5 }}>
                  {h.onHand.toFixed(2)} {h.baseUnit} on hand · par {h.parLevel}
                </span>
              </div>
              <button type="button" className="btn-ghost small" onClick={() => toggleExclude(h.holdingId)}>
                Skip
              </button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <input
                type="number"
                min="0"
                step="0.01"
                value={qtyFor(h)}
                onChange={(e) => setQty((q2) => ({ ...q2, [h.holdingId]: e.target.value }))}
                style={{ width: 90 }}
              />
              <span className="muted" style={{ fontSize: 12 }}>
                {h.baseUnit}
              </span>
              <select
                value={chosen.id}
                onChange={(e) => setSupplierChoice((c) => ({ ...c, [h.holdingId]: e.target.value }))}
                style={{ flex: 1, minWidth: 200 }}
              >
                {links.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.supplier_name} — {gbp(Number(l.unit_price))}/{h.baseUnit}
                    {l.id === def.id ? " (usual)" : ""}
                    {l.id === cheapest.id && cheapest.id !== def.id ? " (cheapest)" : ""}
                  </option>
                ))}
              </select>
              <span style={{ fontFamily: "var(--mono)", fontWeight: 600, minWidth: 70, textAlign: "right" }}>
                {gbp(lineTotal)}
              </span>
              {nudge}
            </div>
          </div>
        );
      })}

      {noSupplier.length > 0 && (
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <div className="im-note">
            {noSupplier.length} item{noSupplier.length === 1 ? " is" : "s are"} below par but{" "}
            {noSupplier.length === 1 ? "has" : "have"} no supplier price on file, so{" "}
            {noSupplier.length === 1 ? "it" : "they"} can't be added to a purchase order yet:{" "}
            {noSupplier.map((h) => h.itemName).join(", ")}. Add a supplier price for{" "}
            {noSupplier.length === 1 ? "it" : "them"} in Items first.
          </div>
        </div>
      )}

      {orderable.length > 0 && pendingOrderable.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 18px",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: totalSavings > 0.001 ? "var(--green)" : "var(--muted)",
            }}
          >
            {totalSavings > 0.001
              ? `Switching suppliers saves ${gbp(totalSavings)} vs your usual suppliers`
              : "Using your usual suppliers — cheaper options are flagged where they exist"}
          </span>
          <button className="btn-primary" onClick={handleRaisePOs} disabled={creating || bySupplier.size === 0}>
            {creating ? "Raising…" : `Raise ${bySupplier.size} purchase order${bySupplier.size === 1 ? "" : "s"}`}
          </button>
        </div>
      )}

      {orderable.length > 0 && pendingOrderable.length === 0 && (
        <p className="muted" style={{ margin: 18 }}>
          Everything below par has been ordered — check Procurement to send and receive.
        </p>
      )}

      {result && (
        <div className="im-note" style={{ margin: 18 }}>
          ✓ Raised <b>
            {result.pos} purchase order{result.pos === 1 ? "" : "s"}
          </b>{" "}
          with {result.lines} line{result.lines === 1 ? "" : "s"} total, as drafts — review, send, and receive them
          from Procurement.
        </div>
      )}
    </div>
  );
}
