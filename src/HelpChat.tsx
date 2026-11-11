import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { HELP_TOPICS } from "./helpContent";
import type { HelpQuestion, HelpTopic } from "./helpContent";
import { searchHelp } from "./helpSearch";
import { askHelpAssistant } from "./api";

interface Props {
  onClose: () => void;
  // Open straight on this topic's questions (used by the "More in Help" links).
  initialTopicId?: string;
  // Open with this one answer already in the chat (a "More in Help" link).
  initialQuestionId?: string;
  // Layer help chat: set when the business has the "ai_help_chat" feature.
  // Replies then come from the AI assistant (help text only); without it the
  // reply is the best matching Help answer, found on this device.
  assistantToken?: string;
}

interface Source {
  topic: HelpTopic;
  item: HelpQuestion;
}

interface Msg {
  id: number;
  role: "me" | "bot";
  text: string;
  // A "did you know" tip, shown as a second small bubble under the answer.
  fact?: string;
  // Other places in Help that cover the same thing ("More in Help").
  sources?: Source[];
}

type View = { kind: "chat" } | { kind: "topics" } | { kind: "topic"; id: string };

const NO_ANSWER = "I could not find that in the SAWIS help. Please contact support, or try different words.";

// Starting points on the empty screen. Each is an exact Help question, so the
// answer is instant and costs nothing.
const STARTERS: { label: string; q: string }[] = [
  { label: "Add a supplier", q: "How do I add a new supplier?" },
  { label: "Create a purchase order", q: "How do I create a purchase order?" },
  { label: "Log waste", q: "How do I log waste?" },
  { label: "Count stock", q: "How do I do a stock count?" },
  { label: "Reports for my accountant", q: "How do I get a purchases report for my accountant?" },
];

let msgCounter = 0;
function mk(role: Msg["role"], text: string, extra?: Partial<Msg>): Msg {
  return { id: ++msgCounter, role, text, ...extra };
}

function findQuestion(q: string): Source | null {
  for (const topic of HELP_TOPICS) {
    const item = topic.questions.find((qa) => qa.q === q);
    if (item) return { topic, item };
  }
  return null;
}

// The in-app help chat, laid out like a messaging app: the conversation in the
// middle, the typing box fixed at the bottom. Topics sit behind a button.
//
// Two kinds of reply behind the same screen. Businesses with the Layer help
// chat (assistantToken) get a short AI answer written from the help text; the
// rest get the best matching Help answer straight from helpContent.ts, with no
// server call and no cost. See apps/helpchat on the backend for the AI side.
export default function HelpChat({ onClose, initialTopicId, initialQuestionId, assistantToken }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<Msg[]>(() => {
    if (!initialQuestionId) return [];
    for (const topic of HELP_TOPICS) {
      const item = topic.questions.find((qa) => qa.id === initialQuestionId);
      if (item) {
        return [mk("me", item.q), mk("bot", item.a, { fact: item.fact })];
      }
    }
    return [];
  });
  const [view, setView] = useState<View>(() =>
    messages.length === 0 && initialTopicId && HELP_TOPICS.some((t) => t.id === initialTopicId)
      ? { kind: "topic", id: initialTopicId }
      : { kind: "chat" },
  );
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, busy, view.kind]);

  function push(...added: Msg[]) {
    setMessages((prev) => [...prev, ...added]);
  }

  // Put a known Help question and its answer into the chat (starters, "More in
  // Help" links and the Topics list all do this).
  function ask(source: Source) {
    push(mk("me", source.item.q), mk("bot", source.item.a, { fact: source.item.fact }));
    setView({ kind: "chat" });
  }

  function localReply(text: string): Msg | null {
    const hits = searchHelp(text, 3);
    if (hits.length === 0) return null;
    const [best, ...rest] = hits;
    return mk("bot", best.item.a, {
      fact: best.item.fact,
      sources: rest.slice(0, 2).map((h) => ({ topic: h.topic, item: h.item })),
    });
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    push(mk("me", text));
    if (!assistantToken) {
      push(localReply(text) ?? mk("bot", NO_ANSWER));
      return;
    }
    setBusy(true);
    try {
      const reply = await askHelpAssistant(assistantToken, text);
      const sources = reply.answered
        ? reply.sources.flatMap((s) => {
            const found = findQuestion(s.q);
            return found ? [found] : [];
          })
        : [];
      push(mk("bot", reply.answer, { sources: sources.slice(0, 2) }));
    } catch (err) {
      // The assistant is unavailable: say so, and still offer the closest Help answer.
      const local = localReply(text);
      push(mk("bot", err instanceof Error ? err.message : "The help assistant could not answer."));
      if (local) push(local);
    } finally {
      setBusy(false);
    }
  }

  const topic = view.kind === "topic" ? HELP_TOPICS.find((t) => t.id === view.id) ?? null : null;
  const inTopics = view.kind !== "chat";

  return (
    <div className="modal-backdrop help-backdrop" onClick={onClose}>
      <div className="modal wide hc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="hc-head">
          {inTopics && (
            <button
              type="button"
              className="hc-back"
              aria-label="Back"
              onClick={() => setView(topic ? { kind: "topics" } : { kind: "chat" })}
            >
              ‹
            </button>
          )}
          <h2>{topic ? topic.title : inTopics ? "Topics" : "Help"}</h2>
          {!inTopics && messages.length > 0 && (
            <button type="button" className="btn-ghost small" onClick={() => setMessages([])}>
              Clear
            </button>
          )}
          {!inTopics && (
            <button type="button" className="btn-ghost small" onClick={() => setView({ kind: "topics" })}>
              Topics
            </button>
          )}
          <button type="button" className="btn-ghost small" onClick={onClose}>
            Close
          </button>
        </div>

        {view.kind === "topics" && (
          <div className="hc-list">
            {HELP_TOPICS.map((t) => (
              <button key={t.id} type="button" className="hc-row" onClick={() => setView({ kind: "topic", id: t.id })}>
                <span>{t.title}</span>
                <span className="hc-count">{t.questions.length} ›</span>
              </button>
            ))}
          </div>
        )}

        {topic && (
          <div className="hc-list">
            {topic.questions.map((qa) => (
              <button key={qa.q} type="button" className="hc-row hc-row-q" onClick={() => ask({ topic, item: qa })}>
                {qa.q}
              </button>
            ))}
          </div>
        )}

        {view.kind === "chat" && (
          <>
            <div className="hc-body" role="log" aria-live="polite">
              <div className="hc-msg hc-bot">Hi! Ask me how to do something in SAWIS, in your own words.</div>
              {messages.length === 0 && (
                <div className="hc-chips">
                  {STARTERS.map((s) => {
                    const found = findQuestion(s.q);
                    return found ? (
                      <button key={s.label} type="button" className="hc-chip" onClick={() => ask(found)}>
                        {s.label}
                      </button>
                    ) : null;
                  })}
                </div>
              )}
              {messages.map((m) => (
                <div key={m.id} className={`hc-group ${m.role === "me" ? "hc-group-me" : ""}`}>
                  <div className={`hc-msg ${m.role === "me" ? "hc-me" : "hc-bot"}`}>{m.text}</div>
                  {m.fact && <div className="hc-msg hc-tip">{m.fact}</div>}
                  {m.sources && m.sources.length > 0 && (
                    <div className="hc-more">
                      More in Help:
                      {m.sources.map((s) => (
                        <button key={s.item.q} type="button" className="help-link" onClick={() => ask(s)}>
                          {s.item.q}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {busy && (
                <div className="hc-msg hc-bot hc-typing" aria-label="The assistant is writing">
                  <i />
                  <i />
                  <i />
                </div>
              )}
              <div ref={endRef} />
            </div>

            <form className="hc-input" onSubmit={send}>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type your question…"
                aria-label="Type your question"
                autoFocus
              />
              <button type="submit" className="hc-send" disabled={!input.trim() || busy} aria-label="Send">
                ➤
              </button>
            </form>
            <div className="hc-foot">
              Answers come from the SAWIS help.
              {assistantToken && " Please don't type personal or customer details."}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
