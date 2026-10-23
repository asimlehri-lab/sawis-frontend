// Square (POS) connection: sales only. The backend does the real work (OAuth,
// nightly pull of finished days, matching Square items to SAWIS dishes);
// these helpers just call its /api/integrations/square/ endpoints.
import { API_URL } from "./api";

export interface SquareLink {
  id: string;
  square_location_id: string;
  name: string;
  // SAWIS location id this Square location feeds, or null until chosen.
  location: string | null;
  location_name: string | null;
  start_date: string | null;
  last_day_pulled: string | null;
}

export interface SquareConnection {
  merchant_name: string;
  environment: "sandbox" | "production";
  status: "active" | "needs_reconnect";
  last_synced_at: string | null;
  last_error: string;
  // Hour of the day (0-23) the nightly pull starts, in sync_timezone.
  sync_hour: number;
  sync_timezone: string;
  links: SquareLink[];
  unmatched_count: number;
}

export interface SquareStatus {
  configured: boolean;
  environment: "sandbox" | "production";
  connection: SquareConnection | null;
}

export interface SquareSyncResult {
  days: number;
  orders: number;
  matched: number;
  unmatched: number;
  error: string | null;
}

export interface SquareUnmatched {
  item_key: string;
  item_name: string;
  qty: string;
  amount: string;
  days: number;
  first_date: string;
  last_date: string;
}

export interface SquareMapResult {
  added: number;
  skipped_existing: number;
  unmatched_count: number;
}

const BASE = "/api/integrations/square";

async function call<T>(
  accessToken: string,
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
  fallback = "Something went wrong talking to Square. Try again."
): Promise<T> {
  const res = await fetch(`${API_URL}${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = fallback;
    try {
      const data = await res.json();
      const m = data?.detail ?? data?.error ?? (typeof data === "object" ? Object.values(data)[0] : null);
      if (typeof m === "string" && m) msg = m;
      else if (Array.isArray(m) && typeof m[0] === "string") msg = m[0];
    } catch {
      /* not JSON — keep the fallback */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export function fetchSquareStatus(accessToken: string): Promise<SquareStatus> {
  return call(accessToken, "GET", "/status/");
}

// Returns the Square page to send the person to; the backend sends them back
// to the app (?square=connected or ?square=error&reason=…) when they finish.
export async function startSquareConnect(accessToken: string): Promise<string> {
  const data = await call<{ url: string }>(accessToken, "POST", "/connect/", {}, "Could not start the Square connection.");
  return data.url;
}

export function disconnectSquare(accessToken: string): Promise<void> {
  return call(accessToken, "POST", "/disconnect/", {}, "Could not disconnect Square.");
}

export function linkSquareLocation(
  accessToken: string,
  linkId: string,
  patch: { location?: string | null; start_date?: string | null }
): Promise<SquareConnection> {
  return call(accessToken, "PATCH", `/links/${linkId}/`, patch, "Could not save that change.");
}

export function setSquareSyncHour(accessToken: string, hour: number): Promise<SquareConnection> {
  return call(accessToken, "PATCH", "/settings/", { sync_hour: hour }, "Could not save the sync time.");
}

export function syncSquare(accessToken: string): Promise<SquareSyncResult> {
  return call(accessToken, "POST", "/sync/", {}, "Could not reach Square. Try again in a minute.");
}

export function fetchSquareUnmatched(accessToken: string): Promise<SquareUnmatched[]> {
  return call(accessToken, "GET", "/unmatched/");
}

export function mapSquareItem(
  accessToken: string,
  itemKey: string,
  choice: { recipe: string } | { ignore: true }
): Promise<SquareMapResult> {
  return call(accessToken, "POST", "/map-item/", { item_key: itemKey, ...choice }, "Could not save that match.");
}

// "?square=" the backend appends when Square sends the person back.
export type SquareReturn = "connected" | "denied" | "expired" | "failed" | null;

export function squareReturnMessage(r: SquareReturn): { kind: "ok" | "bad"; text: string } | null {
  switch (r) {
    case "connected":
      return { kind: "ok", text: "Square is connected. Choose which SAWIS location each Square location feeds below." };
    case "denied":
      return { kind: "bad", text: "Square was not connected: access was not allowed on the Square page. You can try again." };
    case "expired":
      return { kind: "bad", text: "That Square sign-in took too long and expired. Press Connect Square to start again." };
    case "failed":
      return { kind: "bad", text: "Square could not be connected. Press Connect Square to try again." };
    default:
      return null;
  }
}

// Reads (and removes) the "?square=" Square leaves on the address when it
// sends the person back. Call once, when the app first loads.
export function readSquareReturn(): SquareReturn {
  try {
    const url = new URL(window.location.href);
    const flag = url.searchParams.get("square");
    if (!flag) return null;
    const reason = url.searchParams.get("reason");
    url.searchParams.delete("square");
    url.searchParams.delete("reason");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    if (flag === "connected") return "connected";
    if (reason === "denied" || reason === "expired") return reason;
    return "failed";
  } catch {
    return null;
  }
}

export function fmtSquareDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function fmtSquareDateTime(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "never";
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}
