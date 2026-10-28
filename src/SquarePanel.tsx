import { useCallback, useEffect, useState } from "react";
import type { Location, Recipe } from "./api";
import { defaultCurrency, formatMoney } from "./api";
import SearchSelect from "./SearchSelect";
import { suggestDishes } from "./squareSuggest";
import {
  disconnectSquare,
  fetchSquareStatus,
  fmtSquareDate,
  fmtSquareDateTime,
  fetchSquareUnmatched,
  linkSquareLocation,
  mapSquareItem,
  seedSquareSandbox,
  setSquareSyncHour,
  squareReturnMessage,
  startSquareConnect,
  syncSquare,
  type SquareConnection,
  type SquareReturn,
  type SquareStatus,
  type SquareUnmatched,
} from "./squareApi";

interface Props {
  accessToken: string;
  recipes: Recipe[];
  locations: Location[];
  // Set when Square has just sent the person back to the app.
  squareReturn: SquareReturn;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const LOAD_ERROR = "Could not load the Square connection. Check your internet and try again.";

async function loadSquare(accessToken: string) {
  const status = await fetchSquareStatus(accessToken);
  const unmatched =
    status.connection && status.connection.unmatched_count > 0 ? await fetchSquareUnmatched(accessToken) : [];
  return { status, unmatched };
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function hourLabel(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export default function SquarePanel({ accessToken, recipes, locations, squareReturn }: Props) {
  const [status, setStatus] = useState<SquareStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unmatched, setUnmatched] = useState<SquareUnmatched[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "bad"; text: string } | null>(() =>
    squareReturnMessage(squareReturn)
  );
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  // Dish chosen for each unmatched Square item, by item_key.
  const [picks, setPicks] = useState<Record<string, string>>({});

  const currency = defaultCurrency(locations);
  const dishes = recipes.filter((r) => r.kind === "dish" && !r.archived);
  const suggestionsFor = (name: string) => suggestDishes(name, dishes.map((d) => ({ id: d.id, name: d.name })));

  const apply = useCallback((r: { status: SquareStatus; unmatched: SquareUnmatched[] }) => {
    setStatus(r.status);
    setUnmatched(r.unmatched);
    setLoadError(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await loadSquare(accessToken));
    } catch {
      setLoadError(LOAD_ERROR);
    }
  }, [accessToken, apply]);

  useEffect(() => {
    let cancelled = false;
    loadSquare(accessToken)
      .then((r) => {
        if (!cancelled) apply(r);
      })
      .catch(() => {
        if (!cancelled) setLoadError(LOAD_ERROR);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, apply]);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      setNotice({ kind: "bad", text: e instanceof Error ? e.message : "Something went wrong." });
    } finally {
      setBusy(null);
    }
  }

  const connect = () =>
    run("connect", async () => {
      window.location.assign(await startSquareConnect(accessToken));
    });

  const sync = () =>
    run("sync", async () => {
      const r = await syncSquare(accessToken);
      const parts = [
        r.days === 0 ? "Already up to date." : `Pulled ${plural(r.days, "day", "days")} of sales (${plural(r.matched, "item line", "item lines")}).`,
      ];
      if (r.unmatched > 0) parts.push(`${plural(r.unmatched, "line", "lines")} need matching to a dish below.`);
      setNotice({ kind: "ok", text: parts.join(" ") });
      await refresh();
    });

  const seedTest = () =>
    run("seed", async () => {
      const r = await seedSquareSandbox(accessToken);
      setNotice({ kind: "ok", text: `Created ${r.orders} sample sales in the Square test account using: ${r.dishes.join(", ")}. Now press Pull today's sales.` });
    });

  const syncToday = () =>
    run("today", async () => {
      const r = await syncSquare(accessToken, true);
      setNotice({
        kind: "ok",
        text: `Pulled today's test sales: ${plural(r.orders, "order", "orders")}, ${plural(r.matched, "dish line", "dish lines")} added${
          r.unmatched > 0 ? `, ${plural(r.unmatched, "line", "lines")} need matching below` : ""
        }.`,
      });
      await refresh();
    });

  const disconnect = () =>
    run("disconnect", async () => {
      await disconnectSquare(accessToken);
      setConfirmDisconnect(false);
      setNotice({ kind: "ok", text: "Square is disconnected. Sales already pulled stay in SAWIS." });
      await refresh();
    });

  const saveLink = (linkId: string, patch: { location?: string | null; start_date?: string | null }) =>
    run(`link-${linkId}`, async () => {
      const conn: SquareConnection = await linkSquareLocation(accessToken, linkId, patch);
      setStatus((s) => (s ? { ...s, connection: conn } : s));
      setNotice(null);
    });

  const saveHour = (hour: number) =>
    run("hour", async () => {
      const c = await setSquareSyncHour(accessToken, hour);
      setStatus((s) => (s ? { ...s, connection: c } : s));
      setNotice({ kind: "ok", text: `Sales will be pulled from ${hourLabel(hour)} each day.` });
    });

  const match = (u: SquareUnmatched) =>
    run(`map-${u.item_key}`, async () => {
      const recipe = picks[u.item_key];
      if (!recipe) return;
      const r = await mapSquareItem(accessToken, u.item_key, { recipe });
      setNotice({
        kind: "ok",
        text: `Matched “${u.item_name}”. ${plural(r.added, "day", "days")} of sales added${
          r.skipped_existing ? `; ${plural(r.skipped_existing, "day was", "days were")} left alone because that dish already had sales` : ""
        }.`,
      });
      await refresh();
    });

  const ignore = (u: SquareUnmatched) =>
    run(`map-${u.item_key}`, async () => {
      await mapSquareItem(accessToken, u.item_key, { ignore: true });
      setNotice({ kind: "ok", text: `“${u.item_name}” will be skipped from now on.` });
      await refresh();
    });

  const noticeEl = notice && <div className={`sq-notice ${notice.kind}`} role="status">{notice.text}</div>;

  if (loadError) {
    return (
      <div className="card sq-card">
        <div className="sq-notice bad">{loadError}</div>
        <button type="button" className="btn-ghost small" onClick={refresh}>Try again</button>
      </div>
    );
  }
  if (!status) {
    return (
      <div className="card sq-card">
        <p className="hint" style={{ margin: 0 }}>Loading…</p>
      </div>
    );
  }

  const conn = status.connection;

  // ---- Not connected ----
  if (!conn) {
    return (
      <div className="card sq-card">
        <div className="sq-head">
          <div className="sq-who">
            <span className="sq-logo" aria-hidden="true">□</span>
            <div>
              <h2 style={{ margin: 0 }}>Square</h2>
              <p className="hint" style={{ margin: "2px 0 0" }}>Bring your daily sales in from Square instead of uploading a CSV.</p>
            </div>
          </div>
        </div>
        {noticeEl}
        {status.configured ? (
          <>
            <p className="sq-text">
              SAWIS reads your finished days of sales from Square each night and uses them for stock usage, food cost
              and reports. It only reads sales: it never changes anything in Square. Today&rsquo;s sales are pulled once
              the day is over.
            </p>
            <div className="sq-btns">
              <button type="button" className="btn-primary" onClick={connect} disabled={busy === "connect"}>
                {busy === "connect" ? "Opening Square…" : "Connect Square"}
              </button>
            </div>
            <p className="lnote" style={{ marginTop: 14 }}>
              You will sign in to Square and allow SAWIS to read your orders. Only a Square account owner can do this.
              {status.environment === "sandbox" && " This server is in test mode, so it connects to a Square test account, not real sales."}
            </p>
          </>
        ) : (
          <p className="lnote">
            Square is not set up on this server yet. Once the SAWIS team adds the Square keys to the server, the
            Connect Square button will appear here.
          </p>
        )}
      </div>
    );
  }

  // ---- Connected ----
  const needsReconnect = conn.status === "needs_reconnect";
  return (
    <div className="card sq-card">
      <div className="sq-head">
        <div className="sq-who">
          <span className="sq-logo" aria-hidden="true">□</span>
          <div>
            <h2 style={{ margin: 0 }}>Square · {conn.merchant_name}</h2>
            <p className="hint" style={{ margin: "2px 0 0" }}>
              Last synced {fmtSquareDateTime(conn.last_synced_at)} · sales up to yesterday
            </p>
          </div>
        </div>
        <div className="sq-btns">
          <span className={`sq-pill ${needsReconnect ? "warn" : "good"}`}>{needsReconnect ? "Needs reconnecting" : "Connected"}</span>
          {conn.environment === "sandbox" && <span className="sq-pill test">Test mode</span>}
        </div>
      </div>

      {noticeEl}
      {needsReconnect && (
        <div className="sq-notice bad">
          Square stopped answering SAWIS, so sales are paused. Press Reconnect to sign in to Square again; nothing
          already pulled is lost.
        </div>
      )}
      {!needsReconnect && conn.last_error && (
        <div className="sq-notice bad">
          The last sync could not reach Square. SAWIS will try again at the next sync. {conn.last_error}
        </div>
      )}

      <div className="sq-btns" style={{ marginTop: 12 }}>
        {needsReconnect ? (
          <button type="button" className="btn-primary" onClick={connect} disabled={busy === "connect"}>
            {busy === "connect" ? "Opening Square…" : "Reconnect Square"}
          </button>
        ) : (
          <button type="button" className="btn-primary" onClick={sync} disabled={busy === "sync"}>
            {busy === "sync" ? "Syncing…" : "Sync now"}
          </button>
        )}
        {confirmDisconnect ? (
          <>
            <span className="sq-confirm">Disconnect Square? Sales already pulled stay.</span>
            <button type="button" className="btn-ghost small danger" onClick={disconnect} disabled={busy === "disconnect"}>
              Yes, disconnect
            </button>
            <button type="button" className="btn-ghost small" onClick={() => setConfirmDisconnect(false)}>Cancel</button>
          </>
        ) : (
          <button type="button" className="btn-ghost small" onClick={() => setConfirmDisconnect(true)}>Disconnect</button>
        )}
      </div>

      {conn.environment === "sandbox" && (
        <div className="sq-sec">
          <h3>Test tools</h3>
          <p className="hint">
            Only shown in test mode. Create a few sample sales in the Square test account, named after your own dishes,
            then pull today&rsquo;s sales to see them arrive in SAWIS. Link a location below first, and give a few dishes a
            menu price.
          </p>
          <div className="sq-btns">
            <button type="button" className="btn-ghost small" onClick={seedTest} disabled={busy === "seed"}>
              {busy === "seed" ? "Creating…" : "Create sample sales"}
            </button>
            <button type="button" className="btn-ghost small" onClick={syncToday} disabled={busy === "today"}>
              {busy === "today" ? "Pulling…" : "Pull today's sales"}
            </button>
          </div>
        </div>
      )}

      <div className="sq-sec">
        <h3>Daily sync</h3>
        <p className="hint">
          SAWIS pulls your finished days of sales once a day, from this time ({conn.sync_timezone.replace(/_/g, " ")} time).
          Pulling later does not include today&rsquo;s sales: today is only pulled once it is over. Sync now works at any time.
        </p>
        <label className="sq-hour">
          Pull sales from{" "}
          <select
            value={conn.sync_hour}
            disabled={busy === "hour"}
            onChange={(e) => saveHour(Number(e.target.value))}
            aria-label="Hour of the day to pull sales"
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>{hourLabel(h)}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="sq-sec">
        <h3>Locations</h3>
        <p className="hint">Choose which SAWIS location each Square location feeds. Sales are only pulled for locations that are matched.</p>
        {conn.links.length === 0 ? (
          <p className="lnote">Square did not return any locations for this account.</p>
        ) : (
          <div className="sq-table-wrap">
            <table className="sq-table">
              <thead>
                <tr>
                  <th>Square location</th>
                  <th>SAWIS location</th>
                  <th>Start from</th>
                  <th>Pulled up to</th>
                </tr>
              </thead>
              <tbody>
                {conn.links.map((l) => (
                  <tr key={l.id}>
                    <td data-label="Square location">{l.name}</td>
                    <td data-label="SAWIS location">
                      <select
                        value={l.location ?? ""}
                        disabled={busy === `link-${l.id}`}
                        onChange={(e) => saveLink(l.id, { location: e.target.value || null })}
                        aria-label={`SAWIS location for ${l.name}`}
                      >
                        <option value="">Not linked</option>
                        {locations.map((loc) => (
                          <option key={loc.id} value={loc.id}>{loc.name}</option>
                        ))}
                      </select>
                    </td>
                    <td data-label="Start from">
                      <input
                        type="date"
                        value={l.start_date ?? ""}
                        min={daysAgoIso(92)}
                        max={todayIso()}
                        disabled={!l.location || busy === `link-${l.id}`}
                        onChange={(e) => e.target.value && saveLink(l.id, { start_date: e.target.value })}
                        aria-label={`Start date for ${l.name}`}
                      />
                    </td>
                    <td data-label="Pulled up to">{l.location ? fmtSquareDate(l.last_day_pulled) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="lnote">The first sync goes back 7 days. Pick an earlier start date to bring in up to 92 days.</p>
      </div>

      <div className="sq-sec">
        <h3>
          Items to match
          {unmatched.length > 0 && <span className="sq-count">{unmatched.length}</span>}
        </h3>
        {unmatched.length === 0 ? (
          <p className="hint">Every Square item sold so far matches a dish in SAWIS.</p>
        ) : (
          <>
            <p className="hint">
              These Square items do not match a dish yet, so their sales are held back. Pick the dish once and SAWIS
              remembers it, adding the held sales straight away.
            </p>
            <ul className="sq-unmatched">
              {unmatched.map((u) => (
                <li key={u.item_key}>
                  <div className="sq-u-info">
                    <b>{u.item_name}</b>
                    <span>
                      {Number(u.qty)} sold · {formatMoney(Number(u.amount), currency)} · {plural(u.days, "day", "days")}
                    </span>
                  </div>
                  <div className="sq-u-pick">
                    <SearchSelect
                      value={picks[u.item_key] ?? ""}
                      onChange={(v) => setPicks((p) => ({ ...p, [u.item_key]: v }))}
                      options={dishes.map((d) => ({ value: d.id, label: d.name }))}
                      placeholder="Choose a dish…"
                      aria-label={`Dish for ${u.item_name}`}
                    />
                  </div>
                  <div className="sq-btns">
                    <button
                      type="button"
                      className="mini"
                      disabled={!picks[u.item_key] || busy === `map-${u.item_key}`}
                      onClick={() => match(u)}
                    >
                      Match
                    </button>
                    <button type="button" className="mini" disabled={busy === `map-${u.item_key}`} onClick={() => ignore(u)}>
                      Not a dish
                    </button>
                  </div>
                  {suggestionsFor(u.item_name).length > 0 && (
                    <div className="sq-sugg">
                      <span>Did you mean</span>
                      {suggestionsFor(u.item_name).map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          className={`sq-chip${picks[u.item_key] === d.id ? " on" : ""}`}
                          aria-pressed={picks[u.item_key] === d.id}
                          onClick={() => setPicks((p) => ({ ...p, [u.item_key]: d.id }))}
                        >
                          {d.name}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
