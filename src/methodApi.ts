// Layer and Sky add-on "Recipe method" (feature key recipe_method): a step-by-step guide for making a recipe.
// The backend lives in apps/recipemethod. Amounts in a step are parts of the recipe's own ingredient lines.
import { API_URL } from "./api";

export const METHOD_FEATURE = "recipe_method";

export interface MethodPhoto {
  id: string;
  url: string | null;
}

export interface MethodStepLine {
  recipe_line: string; // the id of a RecipeLine on the same recipe
  qty: string;
}

export interface MethodStep {
  id?: string; // missing until the step has been saved once
  key: string; // stable on this page; for a saved step it is the id
  text: string;
  timer_minutes: number;
  note: string; // on the arrow that leaves this step
  lines: MethodStepLine[];
  photos: MethodPhoto[];
  arrow_photo: MethodPhoto | null;
}

export interface MethodData {
  steps: MethodStep[];
  finished_photo: MethodPhoto | null;
}

interface ServerStep extends Omit<MethodStep, "key" | "lines"> {
  id: string;
  key?: string;
  lines: { id: string; recipe_line: string; qty: string }[];
}

function headers(accessToken: string, json = false): HeadersInit {
  return json ? { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` } : { Authorization: `Bearer ${accessToken}` };
}

function firstError(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b.detail === "string") return b.detail;
    for (const v of Object.values(b)) {
      if (Array.isArray(v) && typeof v[0] === "string") return v[0];
      if (typeof v === "string") return v;
    }
  }
  return fallback;
}

function fromServer(data: { steps: ServerStep[]; finished_photo: MethodPhoto | null }): MethodData {
  return {
    steps: data.steps.map((s) => ({
      id: s.id,
      key: s.id,
      text: s.text,
      timer_minutes: s.timer_minutes,
      note: s.note,
      lines: s.lines.map((l) => ({ recipe_line: l.recipe_line, qty: String(parseFloat(Number(l.qty).toFixed(3))) })),
      photos: s.photos,
      arrow_photo: s.arrow_photo,
    })),
    finished_photo: data.finished_photo,
  };
}

export async function fetchMethod(accessToken: string, recipeId: string): Promise<MethodData> {
  const res = await fetch(`${API_URL}/api/method/recipes/${recipeId}/`, { headers: headers(accessToken) });
  if (!res.ok) throw new Error(firstError(await res.json().catch(() => null), "Could not load the method."));
  return fromServer(await res.json());
}

// Saves the whole list of steps. Returns the ids the server gave to new steps, by the key the page used.
export async function saveMethod(accessToken: string, recipeId: string, steps: MethodStep[]): Promise<Record<string, string>> {
  const res = await fetch(`${API_URL}/api/method/recipes/${recipeId}/`, {
    method: "PUT",
    headers: headers(accessToken, true),
    body: JSON.stringify({
      steps: steps.map((s) => ({
        id: s.id,
        key: s.key,
        text: s.text,
        note: s.note,
        timer_minutes: s.timer_minutes,
        lines: s.lines.map((l) => ({ recipe_line: l.recipe_line, qty: l.qty || "0" })),
      })),
    }),
  });
  if (!res.ok) throw new Error(firstError(await res.json().catch(() => null), "Could not save the method."));
  const data: { steps: ServerStep[] } = await res.json();
  const ids: Record<string, string> = {};
  for (const s of data.steps) ids[s.key ?? s.id] = s.id;
  return ids;
}

export async function uploadMethodPhoto(
  accessToken: string,
  recipeId: string,
  role: "step" | "arrow" | "finished",
  file: File,
  stepId?: string
): Promise<MethodPhoto> {
  const form = new FormData();
  form.append("role", role);
  form.append("file", file);
  if (stepId) form.append("step", stepId);
  const res = await fetch(`${API_URL}/api/method/recipes/${recipeId}/photos/`, { method: "POST", headers: headers(accessToken), body: form });
  if (!res.ok) throw new Error(firstError(await res.json().catch(() => null), "Could not save that photo."));
  return res.json();
}

export async function deleteMethodPhoto(accessToken: string, photoId: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/method/photos/${photoId}/`, { method: "DELETE", headers: headers(accessToken) });
  if (!res.ok) throw new Error("Could not remove that photo.");
}
