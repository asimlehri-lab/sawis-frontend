import type { AiMatch } from "./api";

// One "SAWIS suggests" chip. Shown beside "Did you mean". Tapping it only fills the picker, exactly
// like the other chips; a person still confirms.
export default function AiChip({
  match,
  label,
  onPick,
}: {
  match: AiMatch | undefined;
  label: string | undefined;
  onPick: () => void;
}) {
  if (!match || !match.id || !label) return null;
  const unsure = match.confidence === "low";
  return (
    <span className="ai-sugg">
      <span className="ai-tag">{unsure ? "SAWIS is not sure" : "SAWIS suggests"}</span>
      <button
        type="button"
        className={`sq-chip ai-chip${unsure ? " ai-unsure" : ""}`}
        onClick={onPick}
        title={match.reason || undefined}
      >
        {label}
      </button>
    </span>
  );
}
