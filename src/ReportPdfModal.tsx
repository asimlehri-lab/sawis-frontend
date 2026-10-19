import { useState } from "react";
import { verifyPassword } from "./api";

export interface PdfSections {
  overview: boolean;
  menu: boolean;
  waste: boolean;
  category: boolean;
  dishes: boolean;
}

const CHOICES: { key: keyof PdfSections; label: string }[] = [
  { key: "overview", label: "Overview and key figures" },
  { key: "menu", label: "Menu map chart" },
  { key: "waste", label: "Waste by reason" },
  { key: "category", label: "Ingredient cost by category" },
  { key: "dishes", label: "Dish-by-dish table" },
];

// Pick what goes in the report, then prove it's you before it prints. Same
// every-time password check as the CSV export (see PasswordConfirmModal):
// the report holds sales, cost and margin figures, and only admins get the
// button at all.
export default function ReportPdfModal({
  accessToken,
  context,
  onConfirmed,
  onClose,
}: {
  accessToken: string;
  context: string;
  onConfirmed: (sections: PdfSections) => void;
  onClose: () => void;
}) {
  const [sections, setSections] = useState<PdfSections>({ overview: true, menu: true, waste: true, category: true, dishes: false });
  const [password, setPassword] = useState("");
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const none = !Object.values(sections).some(Boolean);

  async function handleConfirm() {
    if (none) {
      setErr("Tick at least one section.");
      return;
    }
    if (!password) {
      setErr("Enter your password.");
      return;
    }
    setChecking(true);
    setErr(null);
    try {
      await verifyPassword(accessToken, password);
      onConfirmed(sections);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Incorrect password.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !checking && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Download report as PDF</h2>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
          Reports hold sales and cost figures, so SAWIS asks for your password first. {context}
        </p>
        <div className="rp-pdf-checks" role="group" aria-label="Sections to include">
          {CHOICES.map((c) => (
            <label key={c.key} className="rp-pdf-check">
              <input
                type="checkbox"
                checked={sections[c.key]}
                onChange={(e) => setSections({ ...sections, [c.key]: e.target.checked })}
              />
              <span>{c.label}</span>
            </label>
          ))}
        </div>
        <div className="field">
          <label>Your password</label>
          <input
            type="password"
            value={password}
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !checking && handleConfirm()}
          />
        </div>
        {err && <p className="error">{err}</p>}
        <p className="hint" style={{ marginTop: 0 }}>
          Your browser’s print window opens next. Choose “Save as PDF” as the printer.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={checking}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={handleConfirm} disabled={checking}>
            {checking ? "Checking…" : "Download PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}
