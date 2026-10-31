import { useState } from "react";
import { answerDefaultSuggestion, formatMoney } from "./api";
import type { DefaultSuggestion } from "./api";

export function suggestionCost(v: string | null, unit: string, currency: string): string {
  return v == null ? "no price" : `${formatMoney(Number(v), currency, 4)}/${unit}`;
}

// Higher cost than today is shown in amber so the manager sees the trade-off before saying yes.
export function costGoesUp(s: DefaultSuggestion): boolean {
  return s.price_now != null && s.price_new != null && Number(s.price_new) > Number(s.price_now) + 1e-9;
}

// One question, three answers. Used on the item page and in End of day > Supplier suggestions.
export function useSuggestionAnswer(accessToken: string, onAnswered: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function answer(s: DefaultSuggestion, action: "accept" | "later" | "keep") {
    setBusy(`${s.item}:${action}`);
    setError(null);
    try {
      await answerDefaultSuggestion(accessToken, s.item, action);
      onAnswered();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your answer.");
    } finally {
      setBusy(null);
    }
  }
  return { busy, error, answer };
}

export function DefaultSuggestionBanner({
  suggestion: s,
  currency,
  accessToken,
  onAnswered,
}: {
  suggestion: DefaultSuggestion;
  currency: string;
  accessToken: string;
  onAnswered: () => void;
}) {
  const { busy, error, answer } = useSuggestionAnswer(accessToken, onAnswered);
  const up = costGoesUp(s);
  return (
    <div className="dsq-banner" role="status">
      <div className="dsq-title">
        You bought {s.item_name} from {s.supplier_name} {s.count} times in a row. Make {s.supplier_name} the default?
      </div>
      <div className="dsq-sub">
        Today the default is {s.current_default_name}. Cost per {s.base_unit} would go from{" "}
        <b>{suggestionCost(s.price_now, s.base_unit, currency)}</b> to{" "}
        <b className={up ? "dsq-up" : undefined}>{suggestionCost(s.price_new, s.base_unit, currency)}</b>
        {s.recipes > 0 && `, and ${s.recipes} recipe${s.recipes === 1 ? "" : "s"} would be re-costed`}. Nothing changes unless you say yes.
      </div>
      <div className="dsq-actions">
        <button type="button" className="btn-primary small" disabled={busy !== null} onClick={() => answer(s, "accept")}>
          {busy === `${s.item}:accept` ? "Saving…" : `Make ${s.supplier_name} the default`}
        </button>
        <button type="button" className="btn-ghost small" disabled={busy !== null} onClick={() => answer(s, "later")}>
          Not now
        </button>
        <button type="button" className="btn-ghost small" disabled={busy !== null} onClick={() => answer(s, "keep")}>
          Keep {s.current_default_name}
        </button>
      </div>
      {error && <p className="error" style={{ marginBottom: 0 }}>{error}</p>}
    </div>
  );
}
