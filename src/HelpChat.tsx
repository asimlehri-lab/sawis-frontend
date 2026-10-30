import { useMemo, useState } from "react";
import { HELP_TOPICS } from "./helpContent";
import type { HelpTopic } from "./helpContent";
import { searchHelp } from "./helpSearch";

interface Props {
  onClose: () => void;
  // Open straight on this topic (used by the "More in Help" links).
  initialTopicId?: string;
}

interface TranscriptEntry {
  topicTitle: string;
  q: string;
  a: string;
  fact?: string;
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
export default function HelpChat({ onClose, initialTopicId }: Props) {
  const [query, setQuery] = useState("");
  const [activeTopicId, setActiveTopicId] = useState<string | null>(initialTopicId ?? null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);

  // Best answers for a typed sentence, across every topic.
  const hits = useMemo(() => searchHelp(query), [query]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const shownKey = openKey ?? hits[0]?.key ?? null;

  const activeTopic = HELP_TOPICS.find((t) => t.id === activeTopicId) ?? null;

  function askQuestion(topic: HelpTopic, q: string, a: string, fact?: string) {
    setTranscript((prev) => [...prev, { topicTitle: topic.title, q, a, fact }]);
  }

  function openTopic(topic: HelpTopic) {
    setQuery("");
    setActiveTopicId(topic.id);
  }

  // Everything in a topic as one read, in order.
  function readAll(topic: HelpTopic) {
    setTranscript(topic.questions.map((qa) => ({ topicTitle: topic.title, q: qa.q, a: qa.a, fact: qa.fact })));
    setQuery("");
    setActiveTopicId(topic.id);
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
          placeholder='Ask in your own words — e.g. "how do I enter waste %"'
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveTopicId(null);
            setOpenKey(null);
          }}
          autoFocus
        />

        {query.trim() ? (
          hits.length > 0 ? (
            <div className="help-results">
              {hits.map((h) => (
                <div key={h.key} className={`help-result ${h.key === shownKey ? "open" : ""}`}>
                  <button type="button" className="help-result-q" onClick={() => setOpenKey(h.key === shownKey ? "" : h.key)}>
                    <span>{h.item.q}</span>
                    <span className="help-result-topic">{h.topic.title}</span>
                  </button>
                  {h.key === shownKey && (
                    <div className="help-result-body">
                      <p>{h.item.a}</p>
                      {h.item.fact && <p className="help-result-fact">{h.item.fact}</p>}
                      <div className="help-result-actions">
                        <button type="button" className="btn-ghost small" onClick={() => openTopic(h.topic)}>
                          All {h.topic.title} questions
                        </button>
                        <button type="button" className="btn-ghost small" onClick={() => readAll(h.topic)}>
                          Read everything about {h.topic.title}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <>
              <p className="muted help-empty">No answer found for "{query}" — try fewer or different words, or pick a topic.</p>
              <div className="help-topics">
                {HELP_TOPICS.map((t) => (
                  <button key={t.id} type="button" className="help-topic-chip" onClick={() => openTopic(t)}>
                    {t.title}
                  </button>
                ))}
              </div>
            </>
          )
        ) : (
          <div className="help-topics">
            {HELP_TOPICS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`help-topic-chip ${t.id === activeTopicId ? "on" : ""}`}
                onClick={() => setActiveTopicId(t.id)}
              >
                {t.title}
              </button>
            ))}
          </div>
        )}

        {!query.trim() && activeTopic && (
          <div className="help-readall">
            <button type="button" className="btn-ghost small" onClick={() => readAll(activeTopic)}>
              Read everything about {activeTopic.title}
            </button>
          </div>
        )}

        {!query.trim() && activeTopic && (
          <div className="help-questions">
            {activeTopic.questions.map((qa) => (
              <button
                key={qa.q}
                type="button"
                className="help-question-chip"
                onClick={() => askQuestion(activeTopic, qa.q, qa.a, qa.fact)}
              >
                {qa.q}
              </button>
            ))}
          </div>
        )}

        <div className="help-transcript">
          {transcript.length === 0 ? (
            !query.trim() && <p className="muted help-empty">Pick a topic above, then tap a question to see the answer here.</p>
          ) : (
            transcript.map((entry, i) => (
              <div key={i} className="help-exchange">
                <div className="help-bubble help-bubble-q">{entry.q}</div>
                <div className="help-bubble help-bubble-a">{entry.a}</div>
                {entry.fact && <div className="help-bubble help-bubble-fact">{entry.fact}</div>}
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
