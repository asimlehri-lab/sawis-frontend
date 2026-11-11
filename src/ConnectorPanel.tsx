import { useCallback, useEffect, useState } from "react";
import { disconnectAiApp, fetchConnector, setSharedItems, switchConnector, TOOL_LABELS } from "./connectorApi";
import type { ConnectorState } from "./connectorApi";
import { fmtSquareDateTime } from "./squareApi";
import HelpLink from "./HelpLink";

// The wording the Admin agrees to. Version 2026-11 on the backend (CONSENT_VERSION): change both together.
// Draft: to be read by a legal adviser before customers use it.
const CONSENT =
  "I am allowed to share this business's information with the AI apps my team connects. When a person connects an AI app " +
  "and allows access, the kinds of information I have switched on above, for the locations that person can see, are sent to " +
  "that AI app and its provider, and handled under our own agreement with them. SAWIS only sends it when a person signs in " +
  "and allows it. I can change what is shared, switch this off, or disconnect anyone, at any time.";

export default function ConnectorPanel({ accessToken }: { accessToken: string }) {
  const [state, setState] = useState<ConnectorState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [agree, setAgree] = useState(false);
  // What the Admin ticks before switching on. Once it is on, the toggles save straight away instead.
  const [choice, setChoice] = useState<Record<string, boolean>>({});
  const [confirmOff, setConfirmOff] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
  const shared = (key: string) => (cur.enabled ? !!cur.items.find((i) => i.key === key)?.enabled : !!choice[key]);
  const allOn = cur.items.every((i) => shared(i.key));
  const anyOn = cur.items.some((i) => shared(i.key));

  function toggleItem(key: string) {
    if (!cur.enabled) {
      setChoice((prev) => ({ ...prev, [key]: !prev[key] }));
      return;
    }
    const next = cur.items.filter((i) => (i.key === key ? !i.enabled : i.enabled)).map((i) => i.key);
    run(`i:${key}`, () => setSharedItems(accessToken, next));
  }

  function toggleAll() {
    if (!cur.enabled) {
      setChoice(Object.fromEntries(cur.items.map((i) => [i.key, !allOn])));
      return;
    }
    run("i:all", () => setSharedItems(accessToken, allOn ? [] : cur.items.map((i) => i.key)));
  }

  const sharing = (
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
          {cur.items.map((i) => (
            <li key={i.key}>
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
                <strong>{i.label}</strong>
                <span>{i.summary}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="lnote" style={{ margin: "10px 0 0" }}>
          Location names are always included, so your AI can answer by location.
          {cur.enabled && " Changes apply to the next question. People may need to start a new chat, or reconnect, in their AI app to see new tools."}
        </p>
      </div>
      <div>
        <h3>It never sees or changes</h3>
        <ul>
          <li>Prices, costs, sales or invoice totals</li>
          <li>Supplier contact details, staff details, invoice photos</li>
          <li>Anything for a location the person cannot open</li>
          <li>It is read-only: nothing can be changed from the AI app</li>
        </ul>
      </div>
    </div>
  );

  return (
    <div className="card sq-card">
      <div className="sq-head">
        <div className="sq-who">
          <span className="sq-logo" aria-hidden="true">✦</span>
          <div>
            <h2 style={{ margin: 0 }}>Connect your own AI</h2>
            <p className="hint" style={{ margin: "2px 0 0" }}>
              Let your own AI app, such as Claude, read your deliveries and stock to answer questions and write your daily summary.
              <HelpLink topic="settings" ask="connect-own-ai" />
            </p>
          </div>
        </div>
        <div className="sq-btns">
          <span className={`sq-pill ${state.enabled ? "good" : "test"}`}>{state.enabled ? "On" : "Off"}</span>
        </div>
      </div>

      {error && <div className="sq-notice bad" role="alert">{error}</div>}

      {sharing}

      {!state.enabled ? (
        <div className="sq-sec">
          <h3>Switch it on</h3>
          <label className="cn-consent">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>{CONSENT}</span>
          </label>
          {!anyOn && <p className="hint" style={{ margin: "10px 0 0" }}>Choose at least one kind of information above.</p>}
          <div className="sq-btns" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn-primary"
              disabled={!agree || !anyOn || busy === "on"}
              onClick={() =>
                run("on", () =>
                  switchConnector(
                    accessToken,
                    true,
                    true,
                    state.items.filter((i) => choice[i.key]).map((i) => i.key),
                  ),
                )
              }
            >
              {busy === "on" ? "Switching on…" : "Switch on"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="sq-sec">
            <h3>Add it to Claude</h3>
            <ol className="cn-steps">
              <li>In Claude, open Settings, then Connectors, then Add custom connector. On a Team or Enterprise plan an owner adds it first.</li>
              <li>
                Paste this address:
                <div className="cn-url">
                  <code>{state.mcp_url}</code>
                  <button type="button" className="btn-ghost small" onClick={copyUrl}>
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </li>
              <li>Click Connect, sign in with your SAWIS email and password, and choose Allow access.</li>
            </ol>
            <p className="lnote">
              Only Admins, Managers and Finance can connect, each with their own login, and each sees only their own locations.
              Switched on by {state.enabled_by || "an Admin"} on {fmtSquareDateTime(state.enabled_at)}.
            </p>
          </div>

          <div className="sq-sec">
            <h3>Connected AI apps</h3>
            {state.connections.length === 0 ? (
              <p className="hint">Nobody has connected an AI app yet.</p>
            ) : (
              <div className="sq-table-wrap">
                <table className="sq-table">
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>AI app</th>
                      <th>Connected</th>
                      <th>Last used</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {state.connections.map((c) => (
                      <tr key={c.id}>
                        <td data-label="Person">{c.person}</td>
                        <td data-label="AI app">{c.app}</td>
                        <td data-label="Connected">{fmtSquareDateTime(c.connected)}</td>
                        <td data-label="Last used">{fmtSquareDateTime(c.last_used)}</td>
                        <td>
                          {confirmId === c.id ? (
                            <span className="sq-btns">
                              <button
                                type="button"
                                className="btn-ghost small danger"
                                disabled={busy === c.id}
                                onClick={() => run(c.id, () => disconnectAiApp(accessToken, c.id))}
                              >
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
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="sq-sec">
            <h3>Recent activity</h3>
            <p className="hint">What connected AI apps have read. Only what was asked for is listed, never the data itself. Kept for 90 days.</p>
            {state.activity.length === 0 ? (
              <p className="hint">Nothing yet.</p>
            ) : (
              <ul className="cn-activity">
                {state.activity.map((a, i) => (
                  <li key={i} className={a.ok ? "" : "bad"}>
                    <span className="cn-when">{fmtSquareDateTime(a.when)}</span>
                    <span>
                      {a.person} via {a.app}: {TOOL_LABELS[a.tool] ?? a.tool}
                      {a.ok ? ` (${a.rows} ${a.rows === 1 ? "row" : "rows"})` : " (could not be answered)"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="sq-sec">
            <h3>Switch it off</h3>
            <p className="hint">Everyone is signed out of their AI app straight away. You can switch it on again later.</p>
            {confirmOff ? (
              <div className="sq-btns">
                <span className="sq-confirm">Switch off and sign everyone out?</span>
                <button
                  type="button"
                  className="btn-ghost small danger"
                  disabled={busy === "off"}
                  onClick={() => run("off", () => switchConnector(accessToken, false))}
                >
                  Switch off
                </button>
                <button type="button" className="btn-ghost small" onClick={() => setConfirmOff(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" className="btn-ghost small" onClick={() => setConfirmOff(true)}>
                Switch off
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
