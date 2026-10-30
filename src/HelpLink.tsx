import { openHelp } from "./helpBus";

// Small "More in Help" link placed after a short on-screen hint.
export default function HelpLink({ topic, label = "More in Help" }: { topic?: string; label?: string }) {
  return (
    <button type="button" className="help-link" onClick={() => openHelp(topic)}>
      {label}
    </button>
  );
}
