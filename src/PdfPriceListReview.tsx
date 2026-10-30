import { useMemo, useState } from "react";
import { formatMoney } from "./api";
import type { PdfPriceList } from "./api";
import type { SupplierListRow } from "./supplierListFile";
import { compareLine, indexExisting, isBigMove, summarise } from "./priceListChanges";
import type { ExistingLine } from "./priceListChanges";

// Shows what the AI reader found in a supplier's file so the person can fix
// names, units and prices and drop lines before they join the price list.
// Nothing is stored here: "Use these" hands the rows back to the normal
// upload, which stores them as it does for an Excel file.

interface EditRow {
  article_no: string;
  name: string;
  unit: string;
  price: string;
  vat_percent: number | null;
  pack: string;
  category: string;
  skip: boolean;
}

interface Props {
  fileName: string;
  data: PdfPriceList;
  currency: string;
  // What this supplier's Price list already holds, so changes can be flagged.
  existing?: ExistingLine[];
  onUse: (rows: SupplierListRow[]) => void;
  onCancel: () => void;
}

export default function PdfPriceListReview({ fileName, data, currency, existing, onUse, onCancel }: Props) {
  const [rows, setRows] = useState<EditRow[]>(() =>
    data.rows.map((r) => ({
      article_no: r.article_no,
      name: r.name,
      unit: r.import_unit,
      price: r.price,
      vat_percent: r.vat_percent,
      pack: r.pack,
      category: r.category,
      skip: false,
    }))
  );
  const [find, setFind] = useState("");
  const [changesOnly, setChangesOnly] = useState(false);
  const known = useMemo(() => indexExisting(existing ?? []), [existing]);
  const summary = useMemo(
    () => summarise(rows.filter((r) => !r.skip), known),
    [rows, known]
  );
  const hasChanges = summary.unitLinked + summary.unitOther + summary.priceChanged > 0;

  function update(i: number, patch: Partial<EditRow>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  const usable = rows.filter((r) => !r.skip && r.name.trim() && r.unit.trim() && r.price.trim() !== "" && !isNaN(Number(r.price)));
  const q = find.trim().toLowerCase();
  const visible = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !q || r.name.toLowerCase().includes(q) || r.article_no.toLowerCase().includes(q))
    .filter(({ r }) => {
      if (!changesOnly) return true;
      const c = compareLine(r, known);
      return c.kind === "unit" || c.kind === "price";
    });
  const otherCurrency = data.currency && data.currency !== currency;

  return (
    <div className="modal-backdrop">
      <div className="modal wide" role="dialog" aria-label="Check the price list" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Check the price list</h2>
        <div className="im-note">
          ✓ <b>{data.rows.length} products</b> read from {fileName}
          {data.valid_from ? `, valid from ${data.valid_from}` : ""}. The AI can misread a line, so check the names, units and
          prices against the original file. Prices are the case or unit price as printed, before VAT.
        </div>
        {data.truncated && (
          <p className="error">The list was long and may be cut off. Check the last lines, or upload the rest as a second file.</p>
        )}
        {otherCurrency && (
          <p className="error">
            This list is in {data.currency}, but your locations use {currency}. Prices are stored exactly as printed and are not
            converted.
          </p>
        )}
        {existing && hasChanges && (
          <div className="im-changes" role="status">
            <b>Compared with this supplier&rsquo;s current Price list:</b>
            <ul>
              {summary.unitLinked > 0 && (
                <li className="warn">
                  <b>{summary.unitLinked}</b> line{summary.unitLinked > 1 ? "s" : ""} with a <b>different unit</b> on an
                  item you have already linked. Importing leaves that item&rsquo;s price as it is, and you link the line
                  again afterwards on the Price list tab.
                </li>
              )}
              {summary.unitOther > 0 && (
                <li>
                  <b>{summary.unitOther}</b> line{summary.unitOther > 1 ? "s" : ""} with a different unit, not linked to an
                  item yet.
                </li>
              )}
              {summary.priceChanged > 0 && (
                <li className={summary.bigMoves > 0 ? "warn" : undefined}>
                  <b>{summary.priceChanged}</b> price{summary.priceChanged > 1 ? "s" : ""} changed
                  {summary.bigMoves > 0 && (
                    <>
                      , <b>{summary.bigMoves}</b> by half or more. Check those against the original file
                    </>
                  )}
                  .
                </li>
              )}
              {summary.fresh > 0 && <li>{summary.fresh} new line{summary.fresh > 1 ? "s" : ""}.</li>}
            </ul>
            <label className="im-changes-only">
              <input type="checkbox" checked={changesOnly} onChange={(e) => setChangesOnly(e.target.checked)} /> Show only
              the lines that change
            </label>
          </div>
        )}
        <div className="eod-rv-bar">
          <input
            type="search"
            className="eod-rv-search"
            placeholder="Find a product…"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            aria-label="Find a product"
          />
        </div>
        <div className="table-scroll">
          <table className="im-tbl">
            <thead>
              <tr>
                <th>Product</th>
                <th>Unit (what the price is for)</th>
                <th className="num">Price</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ r, i }) => {
                const change = r.skip || !existing ? null : compareLine(r, known);
                return (
                <tr key={i} style={r.skip ? { opacity: 0.45 } : undefined}>
                  <td>
                    <input value={r.name} onChange={(e) => update(i, { name: e.target.value })} disabled={r.skip} style={{ width: "100%", minWidth: 150 }} />
                    {(r.article_no || r.vat_percent !== null) && (
                      <div className="muted" style={{ fontSize: 11.5 }}>
                        {[r.article_no, r.vat_percent !== null ? `VAT ${r.vat_percent}%` : ""].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </td>
                  <td>
                    <input value={r.unit} maxLength={20} onChange={(e) => update(i, { unit: e.target.value })} disabled={r.skip} style={{ width: 140 }} />
                    {change?.kind === "unit" && (
                      <div className={change.linkedItem ? "im-chg warn" : "im-chg"}>
                        Unit changed from &ldquo;{change.oldUnit}&rdquo;.
                        {change.linkedItem && (
                          <>
                            {" "}
                            Linked to <b>{change.linkedItem}</b>: its price will not update. Link it again afterwards.
                          </>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={r.price}
                      onChange={(e) => update(i, { price: e.target.value })}
                      disabled={r.skip}
                      style={{ width: 80, textAlign: "right" }}
                    />
                    {change?.kind === "price" && (
                      <div className={isBigMove(change) ? "im-chg warn" : "im-chg"}>
                        Was {formatMoney(change.oldPrice, currency)} ({change.ratio >= 1 ? "+" : "−"}
                        {Math.round(Math.abs(change.ratio - 1) * 100)}%)
                        {change.linkedItem ? `, updates ${change.linkedItem}` : ""}
                      </div>
                    )}
                  </td>
                  <td>
                    <button type="button" className="btn-ghost small" onClick={() => update(i, { skip: !r.skip })}>
                      {r.skip ? "Include" : "Skip"}
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          {visible.length === 0 && <p className="muted">No products match.</p>}
        </div>
        <p className="vhint">
          {usable.length > 0 && `First line: ${usable[0].name} at ${formatMoney(Number(usable[0].price), currency)} per ${usable[0].unit}. `}
          VAT is shown for reference; it is set on each item, not on the price list.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={usable.length === 0}
            onClick={() =>
              onUse(
                usable.map((r) => ({
                  name: r.name.trim(),
                  unit: r.unit.trim(),
                  price: Number(r.price).toFixed(2),
                  article_no: r.article_no,
                  pack: r.pack,
                  vat_percent: r.vat_percent,
                  category: r.category,
                }))
              )
            }
          >
            Use {usable.length} products
          </button>
        </div>
      </div>
    </div>
  );
}
