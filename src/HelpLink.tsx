import { openHelp } from "./helpBus";

// Small "More in Help" link placed after a short on-screen hint.
// `ask` is the id of the exact answer to open (see `id` in helpContent.ts); `topic` is the fallback.
export default function HelpLink({ topic, ask, label = "More in Help" }: { topic?: string; ask?: string; label?: string }) {
  return (
    <button type="button" className="help-link" onClick={() => openHelp(topic, ask)}>
      {label}
    </button>
  );
}
