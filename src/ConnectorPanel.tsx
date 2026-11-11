import { Fragment, useCallback, useEffect, useState } from "react";
import { disconnectAiApp, fetchConnector, setSharedItems, switchConnector, TOOL_LABELS } from "./connectorApi";
import type { ConnectorState, SharedItem } from "./connectorApi";
import { fmtSquareDateTime } from "./squareApi";
import HelpLink from "./HelpLink";

// The wording the Admin agrees to. Version 2026-11 on the backend (CONSENT_VERSION): change both together.
// Draft: to be read by a legal adviser before customers use it.
const CONSENT =
  "I am allowed to share this business's information with the AI apps my team connects. When a person connects an AI app " +
  "and allows access, the kinds of information I have switched on above, for the locations that person can see, are sent to " +
  "that AI app and its provider, and handled under our own agreement with them. SAWIS only sends it when a person signs in " +
  "and allows it. I can change what is shared, switch this off, or disconnect anyone, at any time.";

type Tab = "connect" | "reads" | "activity";
const ACTIVITY_SHOWN = 6;

function fmtDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export default function ConnectorPanel({ accessToken }: { accessToken: string }) {
  const [state, setState] = useState<ConnectorState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [agree, setAgree] = useState(false);
  // What the Admin ticks before switching on. Once it is on, the toggles save straight away instead.
  const [choice, setChoice] = useState<Record<string, boolean>>({});
  // Money kinds need the Admin's own agreement: which ones they have ticked, and (once switched on) which are waiting for it.
  const [agreed, setAgreed] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<string[]>([]);
  const [confirmOff, setConfirmOff] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<Tab>("connect");
  const [app, setApp] = useState<"claude" | "chatgpt">("claude");
  const [showAllActivity, setShowAllActivity] = useState(false);

  const load = useCallback(() => {
    fetchConnector(accessToken)
      .then((s) => {
        setState(s);
        setError("");
      })
      .catch((e: Error) => setError(e.message));
  }, [accessToken]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(label: string, action: () => Promise<ConnectorState>) {
    setBusy(label);
    setError("");
    try {
      setState(await action());
      setConfirmOff(false);
      setConfirmId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy("");
    }
  }

  async function copyUrl() {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(state.mcp_url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the address is shown on screen to copy by hand */
    }
  }

  if (!state) {
    return (
      <div className="card sq-card">
        {error ? <div className="sq-notice bad">{error}</div> : <p className="hint" style={{ margin: 0 }}>Loading…</p>}
        {error && (
          <button type="button" className="btn-ghost small" onClick={load}>
            Try again
          </button>
        )}
      </div>
    );
  }

  const cur: ConnectorState = state; // a plain constant, so the helpers below keep the 'not null' check
  const shared = (key: string) =>
    cur.enabled ? !!cur.items.find((i) => i.key === key)?.enabled || pending.includes(key) : !!choice[key];
  const allOn = cur.items.every((i) => shared(i.key));
  const anyOn = cur.items.some((i) => shared(i.key));
  const chosenMoney = cur.items.filter((i) => i.sensitive && (cur.enabled ? pending.includes(i.key) : choice[i.key]));
  const moneyAgreed = chosenMoney.every((i) => agreed[i.key]);
  const askingFor = (key: string) => chosenMoney.some((i) => i.key === key);

  function saveItems(keys: string[], acceptItems: string[]) {
    run("items", async () => {
      const next = await setSharedItems(accessToken, keys, acceptItems);
      setPending([]);
      setAgreed({});
      return next;
    });
  }

  function toggleItem(key: string) {
    const item = cur.items.find((i) => i.key === key);
    if (!item) return;
    if (!cur.enabled) {
      setChoice((prev) => ({ ...prev, [key]: !prev[key] }));
      return;
    }
    if (item.enabled) {
      saveItems(cur.items.filter((i) => i.enabled && i.key !== key).map((i) => i.key), []);
    } else if (item.sensitive) {
      // Money: ask for the Admin's agreement first, nothing is shared until they confirm.
      setPending((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
    } else {
      saveItems([...cur.items.filter((i) => i.enabled).map((i) => i.key), key], []);
    }
  }

  function toggleAll() {
    if (!cur.enabled) {
      setChoice(Object.fromEntries(cur.items.map((i) => [i.key, !allOn])));
      return;
    }
    if (allOn) {
      setPending([]);
      saveItems([], []);
      return;
    }
    // Everything that needs no extra agreement is switched on now; money kinds wait for theirs.
    const waiting = cur.items.filter((i) => i.sensitive && !i.enabled).map((i) => i.key);
    const now = cur.items.filter((i) => !i.sensitive || i.enabled).map((i) => i.key);
    run("items", async () => {
      const next = await setSharedItems(accessToken, now, []);
      setPending(waiting);
      return next;
    });
  }

  const offMoney = cur.items.filter((i) => i.sensitive && !shared(i.key));
  const consentBlock = (i: SharedItem) => (
    <div className="cn-money-consent">
      <label className="cn-consent">
        <input type="checkbox" checked={!!agreed[i.key]} onChange={(e) => setAgreed((prev) => ({ ...prev, [i.key]: e.target.checked }))} />
        <span>{i.consent}</span>
      </label>
    </div>
  );

  const itemRow = (i: SharedItem) => (
    <li key={i.key} className={askingFor(i.key) ? "cn-asking" : ""}>
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={shared(i.key)}
        aria-label={i.label}
        disabled={!!busy}
        onClick={() => toggleItem(i.key)}
      />
      <span className="cn-toggle-text">
        <strong>
          {i.label}
          {cur.enabled && i.sensitive && i.enabled && i.enabled_at && <em className="cn-badge">Agreed {fmtDay(i.enabled_at)}</em>}
        </strong>
        <span>{i.summary}</span>
        {askingFor(i.key) && consentBlock(i)}
      </span>
    </li>
  );

  const pendingButtons = cur.enabled && pending.length > 0 && (
    <div className="sq-btns" style={{ marginTop: 10 }}>
      <button
        type="button"
        className="btn-primary"
        disabled={!moneyAgreed || !!busy}
        onClick={() => saveItems([...cur.items.filter((i) => i.enabled).map((i) => i.key), ...pending], pending)}
      >
        {busy === "items" ? "Switching on…" : "Switch on the money figures I ticked"}
      </button>
      <button type="button" className="btn-ghost small" onClick={() => setPending([])}>
        Cancel
      </button>
    </div>
  );

  // Before it is switched on: choose, agree, switch on (unchanged flow).
  const sharingFirstTime = (
    <div className="cn-lists">
      <div>
        <h3>What your AI app can read</h3>
        <ul className="cn-toggles">
          <li className="cn-all">
            <button
              type="button"
              role="switch"
              className="switch"
              aria-checked={allOn}
              aria-label="Select all"
              disabled={!!busy}
              onClick={toggleAll}
            />
            <span className="cn-toggle-text">
              <strong>Select all</strong>
            </span>
          </li>
          {cur.items.map((i, n) => (
            <Fragment key={i.key}>
              {i.sensitive && !cur.items[n - 1]?.sensitive && (
                <li className="cn-divider">
                  <span>Money figures: each needs your own agreement</span>
                </li>
              )}
              {itemRow(i)}
            </Fragment>
          ))}
        </ul>
        <p className="lnote" style={{ margin: "10px 0 0" }}>Location names are always included, so your AI can answer by location.</p>
      </div>
      <div>
        <h3>It never sees or changes</h3>
        <ul>
          <li>Money figures you have not chosen</li>
          <li>Supplier contact details, staff details, invoice photos</li>
          <li>Anything for a location the person cannot open</li>
          <li>It is read-only: nothing can be changed from the AI app</li>
        </ul>
      </div>
    </div>
  );

  const everyday = cur.items.filter((i) => !i.sensitive);
  const money = cur.items.filter((i) => i.sensitive);
  const onCount = cur.items.filter((i) => i.enabled).length;

  // After it is switched on: one tab for what is shared.
  const readsTab = (
    <div className="cn-reads">
      <div className="cn-grouphead">
        <h3>Everyday figures</h3>
        <button type="button" className="cn-link" disabled={!!busy} onClick={toggleAll}>
          {allOn ? "Turn all off" : "Turn all on"}
        </button>
      </div>
      <ul className="cn-toggles">{everyday.map(itemRow)}</ul>
      <div className="cn-grouphead">
        <h3>Money figures</h3>
        <span className="cn-groupnote">Each needs its own agreement</span>
      </div>
      <ul className="cn-toggles">{money.map(itemRow)}</ul>
      {pendingButtons}
      <p className="cn-never">
        <strong>Never shared:</strong> supplier contact details, staff details, invoice photos, or locations a person cannot open
        {offMoney.length > 0 && <>, or the money figures that are off ({offMoney.map((i) => i.label.toLowerCase()).join(", ")})</>}. Read-only. Changes apply to
        the next question; people may need to start a new chat, or reconnect, in their AI app to see new tools.
      </p>
    </div>
  );

  const tag = (i: SharedItem) => (
    <span key={i.key} className={`cn-tag${i.sensitive ? " money" : ""}${i.enabled ? "" : " off"}`}>
      {i.label}
    </span>
  );

  const connectTab = (
    <div>
      <div className="cn-sum" aria-live="polite">
        <div className="cn-sum-head">
          <strong>Your AI can read</strong>
          <button type="button" className="cn-link" onClick={() => setTab("reads")}>
            Change
          </button>
        </div>
        <div className="cn-tags">
          <span className="cn-tags-label">Everyday</span>
          {everyday.map(tag)}
        </div>
        <div className="cn-tags">
          <span className="cn-tags-label">Money</span>
          {money.map(tag)}
        </div>
        <p className="cn-sum-foot">Read-only. Never shared: supplier contacts, staff details, invoice photos.</p>
      </div>

      <div className="cn-addr">
        <span className="cn-addr-label">Your connection address</span>
        <code>{state.mcp_url}</code>
        <button type="button" className="btn-ghost small" onClick={copyUrl}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <div className="cn-seg" role="group" aria-label="Which AI app">
        <button type="button" aria-pressed={app === "claude"} onClick={() => setApp("claude")}>
          Claude
        </button>
        <button type="button" aria-pressed={app === "chatgpt"} onClick={() => setApp("chatgpt")}>
          ChatGPT
        </button>
      </div>

      {app === "claude" ? (
        <ol className="cn-steps2">
          <li>
            In Claude, open <b>Settings, then Connectors, then Add custom connector</b>.
          </li>
          <li>
            Paste the address above and click <b>Connect</b>.
          </li>
          <li>
            Sign in with your SAWIS email and password, then choose <b>Allow access</b>.
          </li>
        </ol>
      ) : (
        <ol className="cn-steps2">
          <li>
            Open <b>chatgpt.com/plugins</b>, click <b>+</b> or <b>Add</b>, then <b>Add custom MCP server</b> (also called Create MCP app).
          </li>
          <li>
            Name it SAWIS, paste the address above and choose <b>OAuth</b>.
          </li>
          <li>
            Tick the risk box, create it, sign in with SAWIS and choose <b>Allow access</b>.
          </li>
        </ol>
      )}
      <p className="cn-tip">
        {app === "claude"
          ? "On a Team or Enterprise plan, an owner adds it in Claude first. Changed a toggle? Start a new chat or reconnect."
          : "ChatGPT on the web only. OpenAI changes these names often. Changed a toggle? Open the connector in ChatGPT and refresh its tools."}
      </p>

      <div className="sq-sec">
        <h3>Connected now</h3>
        {state.connections.length === 0 ? (
          <p className="hint">Nobody has connected an AI app yet.</p>
        ) : (
          <ul className="cn-conns">
            {state.connections.map((c) => (
              <li key={c.id}>
                <span className="cn-conn-who">
                  <span className={`cn-chip ${c.app.toLowerCase().includes("chatgpt") ? "gpt" : "other"}`}>{c.app}</span>
                  <strong>{c.person}</strong>
                </span>
                <span className="cn-when2">used {fmtSquareDateTime(c.last_used)}</span>
                {confirmId === c.id ? (
                  <span className="sq-btns">
                    <button type="button" className="btn-ghost small danger" disabled={busy === c.id} onClick={() => run(c.id, () => disconnectAiApp(accessToken, c.id))}>
                      Disconnect
                    </button>
                    <button type="button" className="btn-ghost small" onClick={() => setConfirmId(null)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button type="button" className="btn-ghost small" onClick={() => setConfirmId(c.id)}>
                    Disconnect
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="cn-tip">
          Only Admins, Managers and Finance can connect, each with their own login. Switched on by {state.enabled_by || "an Admin"} on{" "}
          {fmtSquareDateTime(state.enabled_at)}.
        </p>
      </div>
    </div>
  );

  const shownActivity = showAllActivity ? state.activity : state.activity.slice(0, ACTIVITY_SHOWN);
  const activityTab = (
    <div>
      <p className="hint" style={{ margin: "0 0 6px" }}>
        What AI apps asked for, never the data itself. Kept for 90 days.
      </p>
      {state.activity.length === 0 ? (
        <p className="hint">Nothing yet.</p>
      ) : (
        <>
          {shownActivity.map((a, i) => {
            const day = dayLabel(a.when);
            const first = i === 0 || dayLabel(shownActivity[i - 1].when) !== day;
            return (
              <Fragment key={i}>
                {first && <h3 className="cn-day">{day}</h3>}
                <div className={`cn-act${a.ok ? "" : " bad"}`}>
                  <span className="cn-act-main">
                    <span className={`cn-chip ${a.app.toLowerCase().includes("chatgpt") ? "gpt" : "other"}`}>{a.app}</span>
                    {a.person}: {TOOL_LABELS[a.tool] ?? a.tool}
                    <span className="cn-act-rows">{a.ok ? ` · ${a.rows} ${a.rows === 1 ? "row" : "rows"}` : " · could not be answered"}</span>
                  </span>
                  <span className="cn-act-time">{clock(a.when)}</span>
                </div>
              </Fragment>
            );
          })}
          {!showAllActivity && state.activity.length > ACTIVITY_SHOWN && (
            <button type="button" className="cn-link" style={{ marginTop: 10 }} onClick={() => setShowAllActivity(true)}>
              Show {state.activity.length - ACTIVITY_SHOWN} more
            </button>
          )}
        </>
      )}
    </div>
  );

  const tabs: { id: Tab; label: string; count: string }[] = [
    { id: "connect", label: "Connect", count: "" },
    { id: "reads", label: "What it reads", count: `${onCount} of ${cur.items.length}` },
    { id: "activity", label: "Activity", count: String(state.activity.length) },
  ];

  return (
    <div className="card sq-card">
      <div className="sq-head">
        <div className="sq-who">
          <span className="sq-logo" aria-hidden="true">✦</span>
          <div>
            <h2 style={{ margin: 0 }}>Connect your own AI</h2>
            <p className="hint" style={{ margin: "2px 0 0" }}>
              Claude or ChatGPT can read the figures you choose. Read-only.
              <HelpLink topic="settings" ask="connect-own-ai" />
            </p>
          </div>
        </div>
        <div className="sq-btns">
          <span className={`sq-pill ${state.enabled ? "good" : "test"}`}>{state.enabled ? "On" : "Off"}</span>
          {state.enabled && !confirmOff && (
            <button type="button" className="btn-ghost small danger" onClick={() => setConfirmOff(true)} title="Signs everyone out of their AI app">
              Switch off
            </button>
          )}
        </div>
      </div>

      {error && <div className="sq-notice bad" role="alert">{error}</div>}

      {state.enabled && confirmOff && (
        <div className="cn-offbar" role="alert">
          <span className="sq-confirm">Switch off and sign everyone out of their AI app? You can switch it on again later.</span>
          <span className="sq-btns">
            <button type="button" className="btn-ghost small danger" disabled={busy === "off"} onClick={() => run("off", () => switchConnector(accessToken, false))}>
              Switch off
            </button>
            <button type="button" className="btn-ghost small" onClick={() => setConfirmOff(false)}>
              Cancel
            </button>
          </span>
        </div>
      )}

      {!state.enabled ? (
        <>
          {sharingFirstTime}
          <div className="sq-sec">
            <h3>Switch it on</h3>
            <label className="cn-consent">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>{CONSENT}</span>
            </label>
            {!anyOn && <p className="hint" style={{ margin: "10px 0 0" }}>Choose at least one kind of information above.</p>}
            {anyOn && !moneyAgreed && <p className="hint" style={{ margin: "10px 0 0" }}>Tick the agreement under each money figure you chose.</p>}
            <div className="sq-btns" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn-primary"
                disabled={!agree || !anyOn || !moneyAgreed || busy === "on"}
                onClick={() =>
                  run("on", () =>
                    switchConnector(
                      accessToken,
                      true,
                      true,
                      state.items.filter((i) => choice[i.key]).map((i) => i.key),
                      chosenMoney.filter((i) => agreed[i.key]).map((i) => i.key),
                    ),
                  )
                }
              >
                {busy === "on" ? "Switching on…" : "Switch on"}
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="cn-tabs" role="tablist">
            {tabs.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="cn-tab" onClick={() => setTab(t.id)}>
                {t.label}
                {t.count && <small>{t.count}</small>}
              </button>
            ))}
          </div>
          <div role="tabpanel">{tab === "connect" ? connectTab : tab === "reads" ? readsTab : activityTab}</div>
        </>
      )}
    </div>
  );
}
