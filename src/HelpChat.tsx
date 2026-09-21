import { useMemo, useState } from "react";
import { HELP_TOPICS } from "./helpContent";
import type { HelpTopic } from "./helpContent";

interface Props {
  onClose: () => void;
}

interface TranscriptEntry {
  topicTitle: string;
  q: string;
  a: string;
}

// Lightweight local fuzzy match for topic search -- token overlap between
// the typed text and a topic's title + keywords. Deliberately NOT App.tsx's
// own matchScore() -- that one is tuned specifically for OCR receipt-text
// matching (it strips numbers/units and drops short words), which isn't
// the right shape for matching a typed topic against a handful of short
// keyword phrases. A separate, simpler helper here follows this codebase's
// own established "small local helper duplication" convention (see
// matchScore/cleanNumeric elsewhere) rather than forcing an OCR-shaped
// function to double as topic search.
function topicMatches(topic: HelpTopic, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (topic.title.toLowerCase().includes(q)) return true;
  return topic.keywords.some((k) => k.includes(q) || q.includes(k));
}

// The in-app help chatbot -- Phase A of the help-chatbot phase plan (see
// sawis-handoff-summary.md). Deliberately NOT a real AI chat: the user
// types or taps a topic, sees a short list of prefilled questions for it,
// taps one, and the canned answer renders as a chat bubble below -- a
// familiar "chat" interaction over static, hand-authored content (see
// helpContent.ts), not an LLM call. No backend, no per-message cost.
//
// UI placement/pattern deliberately mirrors NotificationCalendar.tsx (a
// centered .modal opened from a content-header icon button) rather than
// NotificationBell's small anchored dropdown -- this needs more room for a
// topic list plus a running conversation than a 280px panel comfortably
// holds.
//
// The transport between this UI and the content is intentionally the one
// function below, askQuestion() -- per the phase plan's own note, this is
// the one concrete thing Phase A does specifically so Phase B (a real,
// next-year AI-agent backend) can later swap what happens on a tap without
// rewriting this component.
export default function HelpChat({ onClose }: Props) {
  const [query, setQuery] = useState("");
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);

  const visibleTopics = useMemo(() => HELP_TOPICS.filter((t) => topicMatches(t, query)), [query]);

  const activeTopic = HELP_TOPICS.find((t) => t.id === activeTopicId) ?? null;

  function askQuestion(topic: HelpTopic, q: string, a: string) {
    setTranscript((prev) => [...prev, { topicTitle: topic.title, q, a }]);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide help-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cal-head">
          <h2>Help</h2>
          <button type="button" className="btn-ghost small" onClick={onClose}>
            Close
          </button>
        </div>

        <input
          type="text"
          className="help-search"
          placeholder='Type a topic — e.g. "purchase order" or "currency"…'
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveTopicId(null);
          }}
          autoFocus
        />

        <div className="help-topics">
          {visibleTopics.length === 0 ? (
            <p className="muted help-empty">No topics match "{query}" — try a different word.</p>
          ) : (
            visibleTopics.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`help-topic-chip ${t.id === activeTopicId ? "on" : ""}`}
                onClick={() => setActiveTopicId(t.id)}
              >
                {t.title}
              </button>
            ))
          )}
        </div>

        {activeTopic && (
          <div className="help-questions">
            {activeTopic.questions.map((qa) => (
              <button
                key={qa.q}
                type="button"
                className="help-question-chip"
                onClick={() => askQuestion(activeTopic, qa.q, qa.a)}
              >
                {qa.q}
              </button>
            ))}
          </div>
        )}

        <div className="help-transcript">
          {transcript.length === 0 ? (
            <p className="muted help-empty">Pick a topic above, then tap a question to see the answer here.</p>
          ) : (
            transcript.map((entry, i) => (
              <div key={i} className="help-exchange">
                <div className="help-bubble help-bubble-q">{entry.q}</div>
                <div className="help-bubble help-bubble-a">{entry.a}</div>
              </div>
            ))
          )}
        </div>

        {transcript.length > 0 && (
          <button type="button" className="btn-ghost small" onClick={() => setTranscript([])}>
            Clear conversation
          </button>
        )}
      </div>
    </div>
  );
}
