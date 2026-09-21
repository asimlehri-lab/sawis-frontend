import { useState } from "react";
import { scanEndOfDaySales } from "./api";
import type { ScannedEodSalesLine } from "./api";

interface Props {
  accessToken: string;
  onClose: () => void;
}

// DIAGNOSTIC ONLY -- not the real "scan the printed end-of-day receipt"
// feature yet. This exists to answer one question before that feature
// gets built: does AWS Textract read this till's specific printed daily
// summary (nested category/item rows, group subtotals interleaved with
// item lines, no table borders) well enough to be worth building a real
// scan-review-import flow on top of? See the phase-plan entry in
// sawis-handoff-summary.md ("End of day sales: photo/Excel import").
//
// Deliberately minimal by design, not an oversight: no matching a line to
// a Recipe, no editing a row, nothing is ever saved. It just shows
// Textract's raw read of each line, with its confidence score, so a
// human can judge accuracy directly against the real printed receipt.
// Once that's judged good enough, the real version reuses this same
// scanEndOfDaySales() call but adds the review/match/import UI that Scan
// receipt (ProcurementDetail's flow) already established the pattern
// for -- this component gets replaced, not extended.
export default function ScanEodSalesTest({ accessToken, onClose }: Props) {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<ScannedEodSalesLine[] | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so picking the same filename again still fires onChange
    if (!file) return;
    setScanning(true);
    setError(null);
    setLines(null);
    scanEndOfDaySales(accessToken, file)
      .then((result) => setLines(result.line_items))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not scan that receipt."))
      .finally(() => setScanning(false));
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Test: scan a printed daily receipt</h2>
        <p className="muted" style={{ fontSize: 12.5, marginTop: -6 }}>
          Diagnostic only — nothing gets saved or matched to a recipe here. This just shows what AWS Textract
          reads off the photo, so we can judge accuracy before building the real import flow.
        </p>

        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFile}
          disabled={scanning}
          aria-label="Photo of the printed daily receipt"
        />

        {scanning && <p className="muted">Scanning…</p>}
        {error && <p className="error">{error}</p>}

        {lines && (
          <>
            <p className="im-note" style={{ marginTop: 14 }}>
              {lines.length === 0
                ? "Textract didn't find any line items on this image."
                : `Textract found ${lines.length} line${lines.length === 1 ? "" : "s"}.`}
            </p>
            {lines.length > 0 && (
              <table className="tbl" style={{ marginTop: 10 }}>
                <thead>
                  <tr>
                    <th>Description (as read)</th>
                    <th className="num">Qty</th>
                    <th className="num">Amount</th>
                    <th className="num">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i}>
                      <td>{l.description ?? <span className="muted">—</span>}</td>
                      <td className="num">{l.quantity ?? "—"}</td>
                      <td className="num">{l.price ?? "—"}</td>
                      <td className="num">{l.confidence !== null ? `${l.confidence.toFixed(0)}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
