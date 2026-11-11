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

export interface SharedItem {
  key: string;
  label: string;
  summary: string;
  sensitive: boolean;
  consent: string; // the agreement text for a money kind
  enabled: boolean;
  enabled_by: string;
  enabled_at: string | null;
}

// Gemini cannot register itself, so the Admin creates its sign-in details (a client id and secret) here.
export interface GeminiInfo {
  created: boolean;
  client_id: string;
  created_at: string | null;
  authorization_url: string;
  token_url: string;
  scope: string;
}

export interface ConnectorState {
  enabled: boolean;
  enabled_at: string | null;
  enabled_by: string;
  allowed_roles: string[];
  mcp_url: string;
  gemini: GeminiInfo;
  items: SharedItem[];
  connections: AiConnection[];
  activity: AiActivity[];
}

async function call<T = ConnectorState>(accessToken: string, method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
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
// Switch on, sharing the chosen kinds of information (items = their keys); needs the Admin's agreement.
// A money kind in items must also be in acceptItems (the Admin agreed to that kind's own text).
export const switchConnector = (token: string, enabled: boolean, accept = false, items: string[] = [], acceptItems: string[] = []) =>
  call(token, "POST", "/settings/", enabled ? { enabled: true, accept, items, accept_items: acceptItems } : { enabled: false });
// Change what is shared while switched on. Takes effect on the next question; nobody is signed out.
export const setSharedItems = (token: string, items: string[], acceptItems: string[] = []) =>
  call(token, "POST", "/settings/", { set_items: items, accept_items: acceptItems });
export interface GeminiMade {
  client_id: string;
  client_secret: string; // shown once; SAWIS keeps only a hash
  state: ConnectorState;
}
// Create Gemini's sign-in details, or make a new secret (the old one stops working and Gemini is signed out).
export const createGeminiDetails = (token: string) => call<GeminiMade>(token, "POST", "/gemini/", {});
export const removeGeminiDetails = (token: string) => call(token, "DELETE", "/gemini/");
export const disconnectAiApp = (token: string, id: string) => call(token, "POST", `/connections/${id}/revoke/`, {});

export const TOOL_LABELS: Record<string, string> = {
  list_locations: "Looked up locations",
  get_deliveries: "Read deliveries",
  get_stock_levels: "Read stock levels",
  get_waste: "Read the waste log",
  get_stock_counts: "Read stock counts",
  get_purchases: "Read purchases and prices paid",
  get_item_costs: "Read item costs",
  get_stock_value: "Read stock value",
  get_sales_summary: "Read sales and margin",
  get_dishes: "Read recipes and dish costing",
};
