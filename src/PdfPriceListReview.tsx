import { useState } from "react";
import { formatMoney } from "./api";
import type { PdfPriceList } from "./api";
import type { SupplierListRow } from "./supplierListFile";

// Shows what the AI reader found in a supplier's PDF so the person can fix
// names, units and prices and drop lines before they join the price list.
// Nothing is stored here: "Use these" hands the rows back to the normal
// upload, which stores them as it does for an Excel file.

interface EditRow {
  article_no: string;
  name: string;
  unit: string;
  price: string;
  vat_percent: number | null;
  skip: boolean;
}

interface Props {
  fileName: string;
  data: PdfPriceList;
  currency: string;
  onUse: (rows: SupplierListRow[]) => void;
  onCancel: () => void;
}

export default function PdfPriceListReview({ fileName, data, currency, onUse, onCancel }: Props) {
  const [rows, setRows] = useState<EditRow[]>(() =>
    data.rows.map((r) => ({
      article_no: r.article_no,
      name: r.name,
      unit: r.import_unit,
      price: r.price,
      vat_percent: r.vat_percent,
      skip: false,
    }))
  );
  const [find, setFind] = useState("");

  function update(i: number, patch: Partial<EditRow>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  const usable = rows.filter((r) => !r.skip && r.name.trim() && r.unit.trim() && r.price.trim() !== "" && !isNaN(Number(r.price)));
  const q = find.trim().toLowerCase();
  const visible = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !q || r.name.toLowerCase().includes(q) || r.article_no.toLowerCase().includes(q));
  const otherCurrency = data.currency && data.currency !== currency;

  return (
    <div className="modal-backdrop">
      <div className="modal wide" role="dialog" aria-label="Check the price list" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Check the price list</h2>
        <div className="im-note">
          ✓ <b>{data.rows.length} products</b> read from {fileName}
          {data.valid_from ? `, valid from ${data.valid_from}` : ""}. The AI can misread a line, so check the names, units and
          prices against the PDF. Prices are the case or unit price as printed, before VAT.
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
              {visible.map(({ r, i }) => (
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
                  </td>
                  <td>
                    <button type="button" className="btn-ghost small" onClick={() => update(i, { skip: !r.skip })}>
                      {r.skip ? "Include" : "Skip"}
                    </button>
                  </td>
                </tr>
              ))}
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
            onClick={() => onUse(usable.map((r) => ({ name: r.name.trim(), unit: r.unit.trim(), price: Number(r.price).toFixed(2) })))}
          >
            Use {usable.length} products
          </button>
        </div>
      </div>
    </div>
  );
}
