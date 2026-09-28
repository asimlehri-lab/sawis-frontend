import { useState } from "react";
import { verifyPassword } from "./api";

// Re-auth speed bump shown before a sensitive download -- the recipe+item
// import template (Settings) and the Reports CSV export, both admin-only
// screens/actions. The data involved is already loaded client-side by the
// time this shows, so this isn't a data-access control; it's a deliberate
// "prove it's really you, and are you sure" step before an admin walks off
// with a full costed catalogue or a margin report. Every download
// re-prompts -- no cached confirmation window, by explicit choice, so this
// can't be left "unlocked" on a shared screen. Generic on purpose: any
// screen with a sensitive download wraps its trigger in this instead of
// calling the download function directly.
export default function PasswordConfirmModal({
  accessToken,
  title,
  description,
  onConfirmed,
  onClose,
}: {
  accessToken: string;
  title: string;
  description: string;
  onConfirmed: () => void;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleConfirm() {
    if (!password) {
      setErr("Enter your password.");
      return;
    }
    setChecking(true);
    setErr(null);
    try {
      await verifyPassword(accessToken, password);
      onConfirmed();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Incorrect password.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !checking && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
          {description}
        </p>
        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
            autoFocus
            placeholder="Your account password"
          />
        </div>
        {err && <p className="error">{err}</p>}
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={checking}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={handleConfirm} disabled={checking}>
            {checking ? "Checking…" : "Confirm & download"}
          </button>
        </div>
      </div>
    </div>
  );
}
