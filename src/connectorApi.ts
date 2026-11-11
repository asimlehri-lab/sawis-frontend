// Layer: "connect your own AI" (feature key ai_connector). The backend is both
// the sign-in server and the MCP server an AI app such as Claude talks to; these
// helpers only manage it from Settings (apps/connector on the backend).
import { API_URL } from "./api";

export interface AiConnection {
  id: string;
  person: string;
  app: string;
  connected: string;
  last_used: string | null;
}

export interface AiActivity {
  when: string;
  person: string;
  app: string;
  tool: string;
  rows: number;
  ok: boolean;
}

export interface ConnectorState {
  enabled: boolean;
  enabled_at: string | null;
  enabled_by: string;
  allowed_roles: string[];
  mcp_url: string;
  connections: AiConnection[];
  activity: AiActivity[];
}

async function call(accessToken: string, method: "GET" | "POST", path: string, body?: unknown): Promise<ConnectorState> {
  const res = await fetch(`${API_URL}/api/connector${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = "Something went wrong. Try again.";
    try {
      const data = await res.json();
      if (typeof data?.detail === "string") msg = data.detail;
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  return res.json();
}

export const fetchConnector = (token: string) => call(token, "GET", "/settings/");
export const switchConnector = (token: string, enabled: boolean, accept = false) =>
  call(token, "POST", "/settings/", enabled ? { enabled: true, accept } : { enabled: false });
export const disconnectAiApp = (token: string, id: string) => call(token, "POST", `/connections/${id}/revoke/`, {});

export const TOOL_LABELS: Record<string, string> = {
  list_locations: "Looked up locations",
  get_deliveries: "Read deliveries",
  get_stock_levels: "Read stock levels",
};
