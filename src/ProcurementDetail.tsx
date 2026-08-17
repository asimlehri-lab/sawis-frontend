import { useEffect, useState } from "react";
import {
  fetchPurchaseOrder,
  updatePurchaseOrder,
  createPOLine,
  updatePOLine,
  deletePOLine,
  receivePurchaseOrder,
  createPurchaseOrder,
  fetchOnHand,
} from "./api";
import type { PurchaseOrder, CatalogItem, Supplier, ItemSupplierRow } from "./api";

interface Props {
  poId: string;
  accessToken: string;
  items: CatalogItem[];
  suppliers: Supplier[];
  itemSupplierLinks: ItemSupplierRow[];
  onBack: () => void;
  onChanged: () => void;
  onOpenPO: (id: string) => void;
  backLabel?: string;
}

const STATUS_FLOW: PurchaseOrder["status"][] = ["draft", "sent", "received"];
const STATUS_LABEL: Record<PurchaseOrder["status"], string> = {
  draft: "Draft",
  awaiting: "Awaiting",
  sent: "Sent",
  received: "Received",
  amended: "Amended",
};
const DEPARTMENTS = [
  { value: "kitchen", label: "Kitchen" },
  { value: "bar", label: "Bar" },
  { value: "foh", label: "Front of house" },
] as const;

export default function ProcurementDetail({
  poId,
  accessToken,
  items,
  suppliers,
  itemSupplierLinks,
  onBack,
  onChanged,
  onOpenPO,
  backLabel,
}: Props) {
  const label = backLabel ?? "← All purchase orders";
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);

  const [addItemId, setAddItemId] = useState("");
  const [addDept, setAddDept] = useState<"kitchen" | "bar" | "foh">("kitchen");
  const [addQty, setAddQty] = useState("1");
  const [addPrice, setAddPrice] = useState("0.00");
  const [savingLine, setSavingLine] = useState(false);
  const [lineError, setLineError] = useState<string | null>(null);

  const [showReceive, setShowReceive] = useState(false);
  const [receiveLines, setReceiveLines] = useState<Record<string, { qty: string; price: string }>>({});
  const [receiving, setReceiving] = useState(false);
  const [receiveError, setReceiveError] = useState<string | null>(null);

  const [showSend, setShowSend] = useState(false);
  const [sending, setSending] = useState(false);

  const [showIssue, setShowIssue] = useState(false);
  const [returningToDraft, setReturningToDraft] = useState(false);
  const [showResource, setShowResource] = useState(false);
  const [resourceLines, setResourceLines] = useState<Record<string, string>>({});
  const [resourcing, setResourcing] = useState(false);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [resourceResult, setResourceResult] = useState<{ id: string; supplierName: string }[] | null>(null);

  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  function reload() {
    setError(null);
    fetchPurchaseOrder(accessToken, poId)
      .then(setPo)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load purchase order."));
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poId]);

  useEffect(() => {
    if (items.length && !addItemId) setAddItemId(items[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  async function saveField(patch: Parameters<typeof updatePurchaseOrder>[2]) {
    try {
      const updated = await updatePurchaseOrder(accessToken, poId, patch);
      setPo(updated);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save changes.");
    }
  }

  async function handleAdvance() {
    if (!po) return;
    const idx = STATUS_FLOW.indexOf(po.status);
    const next = STATUS_FLOW[idx + 1];
    if (!next) return;
    if (next === "sent") {
      setShowSend(true);
      return;
    }
    if (next === "received") {
      const initial: Record<string, { qty: string; price: string }> = {};
      po.lines.forEach((l) => {
        initial[l.id] = { qty: l.qty, price: l.unit_price };
      });
      setReceiveLines(initial);
      setReceiveError(null);
      setShowReceive(true);
      return;
    }
    setAdvancing(true);
    try {
      await saveField({ status: next });
    } finally {
      setAdvancing(false);
    }
  }

  async function handleSendChoice(method: "email" | "print") {
    if (!po) return;
    const supplier = suppliers.find((s) => s.id === po.supplier);
    if (method === "email" && supplier?.contact_email) {
      const subject = encodeURIComponent(`Purchase order — ${po.location_name}`);
      const bodyLines = po.lines
        .map((l) => `${Number(l.qty).toFixed(2)} × ${l.item_name} @ £${Number(l.unit_price).toFixed(2)}`)
        .join("%0D%0A");
      window.open(
        `mailto:${supplier.contact_email}?subject=${subject}&body=${bodyLines}%0D%0A%0D%0ATotal: £${Number(po.total).toFixed(2)}`,
        "_blank"
      );
    }
    if (method === "print") {
      window.print();
    }
    setSending(true);
    try {
      await saveField({ status: "sent" });
      setShowSend(false);
    } finally {
      setSending(false);
    }
  }

  async function handleReturnToDraft() {
    setReturningToDraft(true);
    try {
      await saveField({ status: "draft" });
      setShowIssue(false);
    } finally {
      setReturningToDraft(false);
    }
  }

  function openResource() {
    if (!po) return;
    const initial: Record<string, string> = {};
    po.lines.forEach((l) => {
      initial[l.id] = po.supplier;
    });
    setResourceLines(initial);
    setResourceError(null);
    setResourceResult(null);
    setShowResource(true);
    setShowIssue(false);
  }

  async function handleConfirmResource() {
    if (!po) return;
    setResourcing(true);
    setResourceError(null);
    try {
      const bySupplier = new Map<string, typeof po.lines>();
      po.lines.forEach((l) => {
        const supplierId = resourceLines[l.id] ?? po.supplier;
        bySupplier.set(supplierId, [...(bySupplier.get(supplierId) ?? []), l]);
      });

      const created: { id: string; supplierName: string }[] = [];
      for (const [supplierId, lines] of bySupplier) {
        const newPO = await createPurchaseOrder(accessToken, {
          supplier: supplierId,
          location: po.location,
        });
        for (const l of lines) {
          await createPOLine(accessToken, {
            po: newPO.id,
            item: l.item,
            department: l.department,
            qty: l.qty,
            unit_price: l.unit_price,
          });
        }
        created.push({ id: newPO.id, supplierName: suppliers.find((s) => s.id === supplierId)?.name ?? "—" });
      }

      await saveField({ status: "amended" });
      setResourceResult(created);
      onChanged();
    } catch (err) {
      setResourceError(err instanceof Error ? err.message : "Could not re-source these items.");
    } finally {
      setResourcing(false);
    }
  }

  async function handleConfirmReceive() {
    if (!po) return;
    setReceiving(true);
    setReceiveError(null);
    try {
      const overrides = po.lines.map((l) => ({
        id: l.id,
        received_qty: receiveLines[l.id]?.qty ?? l.qty,
        received_unit_price: receiveLines[l.id]?.price ?? l.unit_price,
      }));
      const updated = await receivePurchaseOrder(accessToken, po.id, overrides);
      setPo(updated);
      setShowReceive(false);
      onChanged();
    } catch (err) {
      setReceiveError(err instanceof Error ? err.message : "Could not receive this delivery.");
    } finally {
      setReceiving(false);
    }
  }

  async function handleSuggestItems() {
    if (!po) return;
    const supplier = suppliers.find((s) => s.id === po.supplier);
    if (!supplier?.min_order_value) return;
    const target = Number(supplier.min_order_value);

    setSuggesting(true);
    setSuggestError(null);
    setSuggestNote(null);
    try {
      // Map item -> its existing line on this PO (if any), so we can top up
      // a real shortfall instead of only ever adding brand-new items.
      const existingLineByItem = new Map(po.lines.map((l) => [l.item, l] as const));

      const candidates = itemSupplierLinks.filter(
        (link) => link.supplier === po.supplier
      );

      // Rank by how far below par each item currently sits — the genuinely
      // "most needed" items from this supplier, not a guess or a fixed list.
      // For an item already on this PO, only the REMAINING shortfall (par
      // gap minus what's already been ordered here) counts as real need —
      // we're topping up a genuine gap, not padding an adequate line.
      const scored = await Promise.all(
        candidates.map(async (link) => {
          const item = items.find((it) => it.id === link.item);
          let shortfall = 0;
          let department: "kitchen" | "bar" | "foh" = "kitchen";
          if (item) {
            for (const h of item.holdings) {
              const onHand = await fetchOnHand(accessToken, item.id, h.location, h.department);
              const gap = Number(h.par_level) - onHand;
              if (gap > shortfall) {
                shortfall = gap;
                department = h.department as "kitchen" | "bar" | "foh";
              } else if (shortfall === 0 && gap > 0) {
                shortfall = gap;
                department = h.department as "kitchen" | "bar" | "foh";
              }
            }
          }
          const existingLine = existingLineByItem.get(link.item);
          const alreadyOrdered = existingLine ? Number(existingLine.qty) : 0;
          const remainingShortfall = shortfall - alreadyOrdered;
          return { link, item, existingLine, remainingShortfall, department };
        })
      );

      // Real candidates are: brand-new items (any of them can help, even
      // with no tracked shortfall — same as before), or items already on
      // the PO that still have genuine remaining need after what's already
      // ordered. An existing line whose qty already covers its par shortfall
      // has nothing left to contribute.
      const needed = scored.filter((s) => !s.existingLine || s.remainingShortfall > 0);
      needed.sort((a, b) => b.remainingShortfall - a.remainingShortfall);

      let running = Number(po.total);
      let added = 0;
      for (const { link, item, existingLine, remainingShortfall, department } of needed) {
        if (running >= target) break;
        if (!item) continue;

        const price = Number(link.unit_price);
        if (price <= 0) continue;
        const remainingGap = target - running;
   const shortfallQty = remainingShortfall > 0 ? remainingShortfall : 1;

        // If this item's genuine remaining shortfall would already clear the
        // minimum, only order enough to just cross it — landing as close to
        // the target as possible rather than however much stock happens to be
        // missing. Earlier items in the list still get their full
        // "most needed" amount either way, rounded up to a whole unit since
        // items are ordered in whole quantities, not fractional decimals.
        const extraQty = Math.ceil(
          shortfallQty * price >= remainingGap
            ? remainingGap / price
            : shortfallQty
        );

        if (existingLine) {
          const newQty = Number(existingLine.qty) + extraQty;
          await updatePOLine(accessToken, existingLine.id, { qty: newQty.toFixed(3) });
        } else {
          await createPOLine(accessToken, {
            po: po.id,
            item: item.id,
            department,
            qty: extraQty.toFixed(3),
            unit_price: link.unit_price,
          });
        }
        running += extraQty * price;
        added++;
      }

      if (added === 0) {
        setSuggestNote(
          needed.length === 0
            ? `No other items on record from ${po.supplier_name} to suggest — add some manually below.`
            : null
        );
      } else {
        setSuggestNote(
          `${added} item${added === 1 ? "" : "s"} added — the most needed from ${po.supplier_name}, based on how far below par they're currently sitting.`
        );
      }
      reload();
      onChanged();
    } catch (err) {
      setSuggestError(err instanceof Error ? err.message : "Could not suggest items.");
    } finally {
      setSuggesting(false);
    }
  }

  async function handleAddLine(e: React.FormEvent) {
    e.preventDefault();
    if (!po || !addItemId) return;
    setLineError(null);
    setSavingLine(true);
    try {
      await createPOLine(accessToken, {
        po: po.id,
        item: addItemId,
        department: addDept,
        qty: addQty,
        unit_price: addPrice,
      });
      reload();
      onChanged();
    } catch (err) {
      setLineError(err instanceof Error ? err.message : "Could not add line.");
    } finally {
      setSavingLine(false);
    }
  }

  async function handleRemoveLine(lineId: string) {
    try {
      await deletePOLine(accessToken, lineId);
      reload();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove line.");
    }
  }

  const [savingLineId, setSavingLineId] = useState<string | null>(null);

  async function handleUpdateLineQty(lineId: string, currentQty: string, rawValue: string) {
    const next = Number(rawValue);
    if (!Number.isFinite(next) || next <= 0) {
      setError("Quantity must be a positive number.");
      return;
    }
    if (next === Number(currentQty)) return;
    setSavingLineId(lineId);
    try {
      await updatePOLine(accessToken, lineId, { qty: next.toFixed(3) });
      reload();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update quantity.");
    } finally {
      setSavingLineId(null);
    }
  }

  if (!po) {
    return (
      <div>
        <button className="back-link" onClick={onBack}>
          {label}
        </button>
        {error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}
      </div>
    );
  }

  const editable = po.status === "draft";
  const nextStatus = STATUS_FLOW[STATUS_FLOW.indexOf(po.status) + 1];
  const supplier = suppliers.find((s) => s.id === po.supplier);
  const belowMin =
    po.status === "draft" && supplier?.min_order_value && Number(po.total) < Number(supplier.min_order_value);

  return (
    <div>
      <button className="back-link" onClick={onBack}>
        {label}
      </button>

      <div className="detail-head">
        <h1 className="page-title" style={{ margin: 0 }}>
          {po.supplier_name}
        </h1>
        <span className={`postatus ps-${po.status}`}>{STATUS_LABEL[po.status]}</span>
      </div>
      <p className="muted detail-sub">
        {po.location_name} · created for delivery to this location
      </p>

      {error && <p className="error">{error}</p>}

      {belowMin && supplier?.min_order_value && (
        <div className="minwarn">
          <div>
            <b>
              Below {po.supplier_name}'s £{Number(supplier.min_order_value).toFixed(0)} minimum order.
            </b>{" "}
            This PO is £{Number(po.total).toFixed(2)} — short by £
            {(Number(supplier.min_order_value) - Number(po.total)).toFixed(2)}. {po.supplier_name} won't
            accept it as is.
          </div>
          <button className="minwarn-btn" onClick={handleSuggestItems} disabled={suggesting}>
            {suggesting ? "Finding items…" : "Suggest items"}
          </button>
        </div>
      )}
      {suggestNote && <div className="im-note">✓ {suggestNote}</div>}
      {suggestError && <p className="error">{suggestError}</p>}

      <div className="print-only">
        <h1>Purchase Order</h1>
        <p>
          <b>Supplier:</b> {po.supplier_name}
        </p>
        <p>
          <b>Deliver to:</b> {po.location_name}
        </p>
        <p>
          <b>Expected:</b> {po.expected_date ?? "—"}
        </p>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Unit price</th>
              <th>Line total</th>
            </tr>
          </thead>
          <tbody>
            {po.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.item_name}</td>
                <td>{Number(l.qty).toFixed(2)}</td>
                <td>£{Number(l.unit_price).toFixed(2)}</td>
                <td>£{Number(l.line_total).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          <b>Total: £{Number(po.total).toFixed(2)}</b>
        </p>
      </div>

      <div className="card">
        <div className="postep">
          {STATUS_FLOW.map((s, i) => (
            <div key={s} className={`postep-node ${STATUS_FLOW.indexOf(po.status) >= i ? "done" : ""}`}>
              <span className="postep-dot" />
              {STATUS_LABEL[s]}
            </div>
          ))}
        </div>
        {nextStatus && (
          <button className="btn-primary small" onClick={handleAdvance} disabled={advancing}>
            {advancing ? "Saving…" : `Mark as ${STATUS_LABEL[nextStatus]}`}
          </button>
        )}
        {po.status === "sent" && (
          <button
            className="btn-ghost"
            style={{ marginTop: nextStatus ? 8 : 0 }}
            onClick={() => setShowIssue(true)}
          >
            Report supplier issue
          </button>
        )}
        {po.status === "received" && po.received_date && (
          <p className="hint" style={{ marginTop: 10 }}>Received {po.received_date}.</p>
        )}
        {po.status === "amended" && (
          <p className="hint" style={{ marginTop: 10 }}>
            This order was re-sourced — its items now live on new draft purchase orders.
          </p>
        )}
        <div className="fgrid fgrid-2" style={{ marginTop: 16 }}>
          <div className="field">
            <label>Expected date</label>
            <input
              type="date"
              value={po.expected_date ?? ""}
              onChange={(e) => setPo({ ...po, expected_date: e.target.value })}
              onBlur={(e) => saveField({ expected_date: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label>Total</label>
            <div className="ro">£{Number(po.total).toFixed(2)}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Order lines</h2>
        <table className="htbl">
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">Qty</th>
              <th className="num">Unit price</th>
              <th className="num">Line total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {po.lines.length === 0 && (
              <tr>
                <td colSpan={5} className="muted empty-row">
                  No lines yet — add items below.
                </td>
              </tr>
            )}
            {po.lines.map((l) => (
              <tr key={l.id}>
                <td className="dispname">{l.item_name}</td>
                <td className="num">
                  {editable ? (
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      key={`${l.id}-${l.qty}`}
                      defaultValue={Number(l.qty).toFixed(2)}
                      disabled={savingLineId === l.id}
                      style={{ width: 80, textAlign: "right" }}
                      onBlur={(e) => handleUpdateLineQty(l.id, l.qty, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                    />
                  ) : (
                    Number(l.qty).toFixed(2)
                  )}
                </td>
                <td className="num">£{Number(l.unit_price).toFixed(2)}</td>
                <td className="num">£{Number(l.line_total).toFixed(2)}</td>
                <td>
                  {editable && (
                    <button className="rm" onClick={() => handleRemoveLine(l.id)}>
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {editable ? (
          <form className="addholding" onSubmit={handleAddLine}>
            <div className="fgrid fgrid-2">
              <div className="field">
                <label>Item</label>
                <select value={addItemId} onChange={(e) => setAddItemId(e.target.value)}>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name} ({it.base_unit})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Department</label>
                <select value={addDept} onChange={(e) => setAddDept(e.target.value as typeof addDept)}>
                  {DEPARTMENTS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Qty</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={addQty}
                  onChange={(e) => setAddQty(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Unit price</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={addPrice}
                  onChange={(e) => setAddPrice(e.target.value)}
                />
              </div>
            </div>
            {lineError && <p className="error">{lineError}</p>}
            <div className="modal-actions" style={{ marginTop: 12 }}>
              <button className="btn-primary" type="submit" disabled={savingLine || !items.length}>
                {savingLine ? "Adding…" : "+ Add line"}
              </button>
            </div>
          </form>
        ) : (
          <p className="hint" style={{ marginTop: 12 }}>
            Lines lock once a PO is sent, so the record matches what was actually ordered.
          </p>
        )}
      </div>

      {showReceive && (
        <div className="card">
          <h2>Receiving delivery</h2>
          <p className="hint">
            Confirm what actually arrived. Any changes here post as real stock movements and update
            this supplier's price for next time — the ordered amounts above stay on record either way.
          </p>
          <table className="htbl">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Ordered</th>
                <th className="num">Received qty</th>
                <th className="num">Received price</th>
              </tr>
            </thead>
            <tbody>
              {po.lines.map((l) => (
                <tr key={l.id}>
                  <td className="dispname">{l.item_name}</td>
                  <td className="num muted">
                    {Number(l.qty).toFixed(2)} @ £{Number(l.unit_price).toFixed(2)}
                  </td>
                  <td className="num">
                    <input
                      className="par-in"
                      type="number"
                      min="0"
                      step="any"
                      value={receiveLines[l.id]?.qty ?? l.qty}
                      onChange={(e) =>
                        setReceiveLines((prev) => ({
                          ...prev,
                          [l.id]: { qty: e.target.value, price: prev[l.id]?.price ?? l.unit_price },
                        }))
                      }
                    />
                  </td>
                  <td className="num">
                    <input
                      className="par-in"
                      type="number"
                      min="0"
                      step="0.01"
                      value={receiveLines[l.id]?.price ?? l.unit_price}
                      onChange={(e) =>
                        setReceiveLines((prev) => ({
                          ...prev,
                          [l.id]: { qty: prev[l.id]?.qty ?? l.qty, price: e.target.value },
                        }))
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {receiveError && <p className="error">{receiveError}</p>}
          <div className="modal-actions" style={{ marginTop: 14 }}>
            <button className="btn-ghost" onClick={() => setShowReceive(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={handleConfirmReceive} disabled={receiving}>
              {receiving ? "Posting to stock…" : "Confirm receipt"}
            </button>
          </div>
        </div>
      )}

      {showSend && (
        <div className="modal-backdrop" onClick={() => setShowSend(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Send this order</h2>
            <p className="hint" style={{ marginTop: -8, marginBottom: 16 }}>
              How does {po.supplier_name} usually take orders?
            </p>
            {belowMin && (
              <div className="minwarn" style={{ marginBottom: 14 }}>
                <div>Still below the minimum order — top it up before sending.</div>
              </div>
            )}
            <div className="seg">
              <button
                type="button"
                className="seg-btn"
                disabled={!suppliers.find((s) => s.id === po.supplier)?.contact_email || sending || !!belowMin}
                onClick={() => handleSendChoice("email")}
              >
                <b>Email PO</b>
                <small>
                  {suppliers.find((s) => s.id === po.supplier)?.contact_email
                    ? "opens your email, ready to send"
                    : "no email on file for this supplier"}
                </small>
              </button>
              <button
                type="button"
                className="seg-btn sub"
                disabled={sending || !!belowMin}
                onClick={() => handleSendChoice("print")}
              >
                <b>Print PO</b>
                <small>print or save as PDF to call it in</small>
              </button>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={() => setShowSend(false)} disabled={sending}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showIssue && (
        <div className="modal-backdrop" onClick={() => setShowIssue(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Supplier issue</h2>
            <p className="hint" style={{ marginTop: -8, marginBottom: 16 }}>
              What's happening with this order?
            </p>
            <div className="seg" style={{ marginBottom: 0 }}>
              <button
                type="button"
                className="seg-btn"
                disabled={returningToDraft}
                onClick={handleReturnToDraft}
              >
                <b>{returningToDraft ? "Saving…" : "Return to draft"}</b>
                <small>edit and resend to the same supplier</small>
              </button>
              <button type="button" className="seg-btn sub" onClick={openResource}>
                <b>Re-source items</b>
                <small>can't fulfil — assign items to different suppliers</small>
              </button>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={() => setShowIssue(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showResource && (
        <div className="modal-backdrop" onClick={() => !resourceResult && setShowResource(false)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <h2>Re-source items</h2>
            {!resourceResult ? (
              <>
                <p className="hint" style={{ marginTop: -8, marginBottom: 16 }}>
                  Assign each item to a supplier. Items assigned to more than one supplier become
                  separate new draft orders, created together.
                </p>
                <table className="im-tbl">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Qty</th>
                      <th>New supplier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {po.lines.map((l) => (
                      <tr key={l.id}>
                        <td>{l.item_name}</td>
                        <td>{Number(l.qty).toFixed(2)}</td>
                        <td>
                          <select
                            value={resourceLines[l.id] ?? po.supplier}
                            onChange={(e) =>
                              setResourceLines((prev) => ({ ...prev, [l.id]: e.target.value }))
                            }
                          >
                            {suppliers.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {resourceError && <p className="error">{resourceError}</p>}
                <div className="modal-actions">
                  <button type="button" className="btn-ghost" onClick={() => setShowResource(false)} disabled={resourcing}>
                    Cancel
                  </button>
                  <button className="btn-primary" onClick={handleConfirmResource} disabled={resourcing}>
                    {resourcing ? "Creating…" : "Create new draft orders"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="im-note">
                  ✓ <b>This order is now marked Amended.</b> {resourceResult.length} new draft order
                  {resourceResult.length === 1 ? "" : "s"} created:
                </div>
                {resourceResult.map((r) => (
                  <div key={r.id} className="sup-row">
                    <span className="sn">{r.supplierName}</span>
                    <button
                      className="mini"
                      onClick={() => {
                        setShowResource(false);
                        onOpenPO(r.id);
                      }}
                    >
                      Open →
                    </button>
                  </div>
                ))}
                <div className="modal-actions">
                  <button className="btn-primary" onClick={() => setShowResource(false)}>
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}