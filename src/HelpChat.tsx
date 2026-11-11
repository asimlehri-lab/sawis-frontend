import { useMemo, useState } from "react";
import { HELP_TOPICS } from "./helpContent";
import type { HelpTopic } from "./helpContent";
import { searchHelp } from "./helpSearch";
import type { HelpHit } from "./helpSearch";
import { askHelpAssistant } from "./api";

interface Props {
  onClose: () => void;
  // Open straight on this topic (used by the "More in Help" links).
  initialTopicId?: string;
  // Open with this one answer already showing in full (a "More in Help" link).
  initialQuestionId?: string;
  // Layer help chat: set when the business has the "ai_help_chat" feature.
  // Adds an "Ask the assistant" button that answers from the help text.
  assistantToken?: string;
}

interface TranscriptEntry {
  topicTitle: string;
  q: string;
  a: string;
  fact?: string;
  // Set on an assistant answer: where in Help the same thing is written down.
  assistant?: boolean;
  sources?: { topic: HelpTopic; q: string }[];
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
export default function HelpChat({ onClose, initialTopicId, initialQuestionId, assistantToken }: Props) {
  const [query, setQuery] = useState("");
  // The answer a link pointed at; shown open above everything else.
  const [focus, setFocus] = useState<HelpHit | null>(() => {
    if (!initialQuestionId) return null;
    for (const topic of HELP_TOPICS) {
      const item = topic.questions.find((qa) => qa.id === initialQuestionId);
      if (item) return { key: topic.id + "::" + item.q, topic, item, score: 0 };
    }
    return null;
  });
  const [activeTopicId, setActiveTopicId] = useState<string | null>(focus ? null : initialTopicId ?? null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState("");

  // Layer: ask the AI help assistant. It only ever sees the question and the
  // help text, never the business's own data.
  async function askAssistant() {
    const question = query.trim();
    if (!assistantToken || !question || asking) return;
    setAsking(true);
    setAskError("");
    try {
      const reply = await askHelpAssistant(assistantToken, question);
      const sources = reply.sources.flatMap((s) => {
        const topic = HELP_TOPICS.find((t) => t.questions.some((qa) => qa.q === s.q));
        return topic ? [{ topic, q: s.q }] : [];
      });
      setTranscript((prev) => [
        ...prev,
        { topicTitle: "Assistant", q: question, a: reply.answer, assistant: reply.answered, sources },
      ]);
      setQuery("");
      setActiveTopicId(null);
      setOpenKey(null);
      setFocus(null);
    } catch (err) {
      setAskError(err instanceof Error ? err.message : "The help assistant could not answer.");
    } finally {
      setAsking(false);
    }
  }

  // Best answers for a typed sentence, across every topic.
  const hits = useMemo(() => searchHelp(query), [query]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const shownKey = openKey ?? hits[0]?.key ?? null;

  const activeTopic = HELP_TOPICS.find((t) => t.id === activeTopicId) ?? null;

  function askQuestion(topic: HelpTopic, q: string, a: string, fact?: string) {
    setTranscript((prev) => [...prev, { topicTitle: topic.title, q, a, fact }]);
  }

  function openTopic(topic: HelpTopic) {
    setFocus(null);
    setQuery("");
    setActiveTopicId(topic.id);
  }

  // Everything in a topic as one read, in order.
  function readAll(topic: HelpTopic) {
    setFocus(null);
    setTranscript(topic.questions.map((qa) => ({ topicTitle: topic.title, q: qa.q, a: qa.a, fact: qa.fact })));
    setQuery("");
    setActiveTopicId(topic.id);
  }

  function answerBody(h: HelpHit) {
    return (
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
    );
  }

  return (
    <div className="modal-backdrop help-backdrop" onClick={onClose}>
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
            setAskError("");
            setQuery(e.target.value);
            setActiveTopicId(null);
            setOpenKey(null);
            setFocus(null);
          }}
          autoFocus
        />

        {assistantToken && query.trim() && (
          <div className="help-assistant-ask">
            <button type="button" className="btn-primary small" disabled={asking} onClick={askAssistant}>
              {asking ? "Thinking…" : "Ask the assistant"}
            </button>
            <span className="muted">
              Answers from the SAWIS help. Please don't type personal or customer details; questions are saved without your name to improve Help.
            </span>
            {askError && <span className="help-assistant-error">{askError}</span>}
          </div>
        )}

        {!query.trim() && focus && (
          <div className="help-results">
            <div className="help-result open">
              <div className="help-result-q">
                <span>{focus.item.q}</span>
                <span className="help-result-topic">{focus.topic.title}</span>
              </div>
              {answerBody(focus)}
            </div>
          </div>
        )}

        {query.trim() ? (
          hits.length > 0 ? (
            <div className="help-results">
              {hits.map((h) => (
                <div key={h.key} className={`help-result ${h.key === shownKey ? "open" : ""}`}>
                  <button type="button" className="help-result-q" onClick={() => setOpenKey(h.key === shownKey ? "" : h.key)}>
                    <span>{h.item.q}</span>
                    <span className="help-result-topic">{h.topic.title}</span>
                  </button>
                  {h.key === shownKey && answerBody(h)}
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
            !query.trim() && !focus && <p className="muted help-empty">Pick a topic above, then tap a question to see the answer here.</p>
          ) : (
            transcript.map((entry, i) => (
              <div key={i} className="help-exchange">
                <div className="help-bubble help-bubble-q">{entry.q}</div>
                <div className="help-bubble help-bubble-a">{entry.a}</div>
                {entry.fact && <div className="help-bubble help-bubble-fact">{entry.fact}</div>}
                {entry.assistant && (
                  <div className="help-assistant-sources muted">
                    AI answer from the SAWIS help. Check anything important.
                    {entry.sources && entry.sources.length > 0 && " More in Help:"}
                    {entry.sources?.map((s) => (
                      <button
                        key={s.q}
                        type="button"
                        className="btn-ghost small"
                        onClick={() => {
                          const item = s.topic.questions.find((qa) => qa.q === s.q);
                          if (!item) return;
                          setFocus({ key: s.topic.id + "::" + item.q, topic: s.topic, item, score: 0 });
                          setActiveTopicId(null);
                        }}
                      >
                        {s.q}
                      </button>
                    ))}
                  </div>
                )}
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
