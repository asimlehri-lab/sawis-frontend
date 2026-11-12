// The Method tab of a recipe (Layer and Sky add-on, feature key recipe_method).
// Managers and admins build a step-by-step guide; everyone follows it in Cook view.
// The amounts in a step are parts of the recipe's own ingredient lines, so the cost, the allergens and the
// Ingredients tab stay the single source of truth.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent } from "react";
import { createRecipeLine, deleteRecipeLine, formatMoney, updateRecipeLine } from "./api";
import type { CatalogItem, Recipe, RecipeLine } from "./api";
import { shrinkImage } from "./imageShrink";
import { deleteMethodPhoto, fetchMethod, saveMethod, uploadMethodPhoto } from "./methodApi";
import type { MethodData, MethodPhoto, MethodStep } from "./methodApi";
import MethodCook from "./MethodCook";
import "./RecipeMethod.css";

const COLORS = ["#2E54E8", "#1D6B4F", "#C2611D", "#6A2FE0", "#A33636", "#185FA5", "#8A6410"];
const VERBS = ["Blend", "Heat", "Fry", "Mix", "Pour", "Chill", "Rest", "Season"];
const SAVE_DELAY_MS = 700;

type Active = string | "result" | null;
type SaveState = "saved" | "pending" | "saving" | "error";

interface Props {
  recipe: Recipe;
  accessToken: string;
  // Staff can follow a method but not change it.
  readOnly: boolean;
  items: CatalogItem[];
  allRecipes: Recipe[];
  currency: string;
  // Names of the allergens this recipe contains / may contain, for the last Cook-view screen.
  contains: string[];
  mayContain: string[];
  // After an amount on an ingredient line changed here (the recipe's cost moved): reload the recipe.
  onRecipeChanged: () => void;
  // Every time the steps change, so the Ingredients tab can say where each ingredient is used.
  onStepsChange: (steps: MethodStep[]) => void;
  // Asks the Ingredients tab to open (from the "Used in" links the other way round).
  hidden?: boolean;
}

const cv = (c: string): CSSProperties => ({ "--c": c } as CSSProperties);
const num = (v: string): number => {
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const fmt = (n: number): string => String(parseFloat((Math.round(n * 1000) / 1000).toFixed(3)));
const lineName = (l: RecipeLine): string => l.item_name ?? l.sub_recipe_name ?? "Ingredient";
let keyCounter = 0;
const newKey = (): string => `new-${Date.now().toString(36)}-${++keyCounter}`;
const blankStep = (): MethodStep => ({ key: newKey(), text: "", timer_minutes: 0, note: "", lines: [], photos: [], arrow_photo: null });

export default function RecipeMethod({
  recipe, accessToken, readOnly, items, allRecipes, currency, contains, mayContain, onRecipeChanged, onStepsChange, hidden,
}: Props) {
  const [steps, setSteps] = useState<MethodStep[]>([]);
  const [finished, setFinished] = useState<MethodPhoto | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [toastAct, setToastAct] = useState<{ label: string; run: () => void } | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [mode, setMode] = useState<"build" | "cook">(readOnly ? "cook" : "build");
  const [active, setActive] = useState<Active>(null);
  const [focusReq, setFocusReq] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [shelfPicker, setShelfPicker] = useState(false);
  const [stepPicker, setStepPicker] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [timerOpen, setTimerOpen] = useState<Record<string, boolean>>({});
  const [noteOpen, setNoteOpen] = useState<Record<string, boolean>>({});
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [overStep, setOverStep] = useState<string | null>(null);
  // Lines created here a moment ago, until the recipe itself has been reloaded with them.
  const [extraLines, setExtraLines] = useState<RecipeLine[]>([]);

  const stepsRef = useRef<MethodStep[]>([]);
  const recipeRef = useRef<Recipe>(recipe);
  const extraRef = useRef<RecipeLine[]>([]);
  const dirtyRef = useRef(false);
  const inflightRef = useRef<Promise<boolean> | null>(null);
  const timerRef = useRef<number | null>(null);
  const toastRef = useRef<number | null>(null);
  const dragLineRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    recipeRef.current = recipe;
    extraRef.current = extraLines;
  });

  const lines: RecipeLine[] = useMemo(() => {
    const have = new Set(recipe.lines.map((l) => l.id));
    return [...recipe.lines, ...extraLines.filter((l) => !have.has(l.id))];
  }, [recipe.lines, extraLines]);
  const lineById = useMemo(() => new Map(lines.map((l) => [l.id, l])), [lines]);
  const colorOf = (id: string): string => COLORS[Math.max(0, lines.findIndex((l) => l.id === id)) % COLORS.length];

  function say(msg: string, action?: { label: string; run: () => void }) {
    setToast(msg);
    setToastAct(action ?? null);
    if (toastRef.current) window.clearTimeout(toastRef.current);
    toastRef.current = window.setTimeout(() => { setToast(null); setToastAct(null); }, action ? 7000 : 3200);
  }

  // ---------- loading and saving ----------
  function firstToEdit(list: MethodStep[]): string {
    const blank = list.find((s) => !s.text.trim() && s.lines.length === 0);
    return (blank ?? list[list.length - 1]).key;
  }

  function used(list: MethodStep[], lineId: string): number {
    let t = 0;
    list.forEach((s) => s.lines.forEach((l) => l.recipe_line === lineId && (t += num(l.qty))));
    return Math.round(t * 1000) / 1000;
  }

  // The recipe's ingredient amount is the total; a step that uses more raises it first (the server also checks).
  async function raiseTotals(list: MethodStep[]): Promise<boolean> {
    let raised = false;
    const all = [...recipeRef.current.lines, ...extraRef.current.filter((x) => !recipeRef.current.lines.some((l) => l.id === x.id))];
    for (const line of all) {
      const u = used(list, line.id);
      if (u > Number(line.qty) + 0.0005) {
        const updated = await updateRecipeLine(accessToken, line.id, { qty: fmt(u) });
        setExtraLines((prev) => prev.map((p) => (p.id === line.id ? { ...p, qty: updated.qty } : p)));
        say(`${lineName(line)} total raised to ${fmt(u)} ${line.unit} on the Ingredients tab`);
        raised = true;
      }
    }
    return raised;
  }

  const flush = useCallback(async (): Promise<boolean> => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    if (inflightRef.current) await inflightRef.current;
    if (!dirtyRef.current) return true;
    const run = (async () => {
      dirtyRef.current = false;
      if (mountedRef.current) setSaveState("saving");
      try {
        const snapshot = stepsRef.current;
        const raised = await raiseTotals(snapshot);
        const ids = await saveMethod(accessToken, recipeRef.current.id, snapshot);
        if (mountedRef.current) {
          const next = stepsRef.current.map((s) => (!s.id && ids[s.key] ? { ...s, id: ids[s.key] } : s));
          stepsRef.current = next;
          setSteps(next);
          setSaveState(dirtyRef.current ? "pending" : "saved");
          setError(null);
        }
        if (raised) onRecipeChanged();
        return true;
      } catch (e) {
        dirtyRef.current = true;
        if (mountedRef.current) {
          setSaveState("error");
          setError(e instanceof Error ? e.message : "Could not save the method.");
        }
        return false;
      }
    })();
    inflightRef.current = run;
    try {
      return await run;
    } finally {
      if (inflightRef.current === run) inflightRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    fetchMethod(accessToken, recipe.id)
      .then((d: MethodData) => {
        if (cancelled) return;
        stepsRef.current = d.steps;
        setSteps(d.steps);
        setFinished(d.finished_photo);
        setActive((a) => a ?? (d.steps.length ? firstToEdit(d.steps) : null));
        setLoaded(true);
      })
      .catch((e) => !cancelled && (setError(e instanceof Error ? e.message : "Could not load the method."), setLoaded(true)));
    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (dirtyRef.current) void flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe.id]);

  useEffect(() => {
    onStepsChange(steps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps]);

  function commit(next: MethodStep[]) {
    stepsRef.current = next;
    setSteps(next);
    dirtyRef.current = true;
    setSaveState("pending");
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
  }
  const patchStep = (key: string, patch: Partial<MethodStep>) => commit(stepsRef.current.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  // ---------- numbers ----------
  const left = (lineId: string): number => Number(lineById.get(lineId)?.qty ?? 0) - used(steps, lineId);
  const stepCost = (s: MethodStep): number =>
    s.lines.reduce((t, l) => t + num(l.qty) * Number(lineById.get(l.recipe_line)?.unit_cost ?? 0), 0);
  const unplaced = lines.filter((l) => Number(l.qty) > 0 && left(l.id) > 0.0005);
  const stillToPlace = unplaced.length;
  const partial = unplaced.filter((l) => used(steps, l.id) > 0.0005); // some of it is in a step, the rest is not
  const untouched = unplaced.filter((l) => used(steps, l.id) <= 0.0005);
  const stepNumber = (key: string): number => steps.findIndex((s) => s.key === key) + 1;

  // ---------- step actions ----------
  function goStep(key: Active, focus = true) {
    setActive(key);
    setStepPicker(null);
    if (focus) setFocusReq((n) => n + 1);
  }
  useEffect(() => {
    if (!active || active === "result") return;
    const el = document.querySelector<HTMLTextAreaElement>(`[data-mt-ins="${active}"]`);
    if (el && focusReq > 0) {
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    }
    document.querySelector(`[data-mt-step="${active}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active, focusReq]);

  function addStep(afterKey: string | "end") {
    const ns = blankStep();
    const list = [...stepsRef.current];
    const ix = afterKey === "end" ? list.length - 1 : list.findIndex((s) => s.key === afterKey);
    list.splice(ix + 1, 0, ns);
    commit(list);
    goStep(ns.key);
  }
  function removeStep(key: string) {
    const ix = steps.findIndex((s) => s.key === key);
    const next = steps.filter((s) => s.key !== key);
    commit(next);
    setActive(next.length ? next[Math.min(ix, next.length - 1)].key : null);
    say("Step deleted. Its ingredients went back to the shelf.");
  }
  function moveStep(key: string, d: number) {
    const list = [...steps];
    const ix = list.findIndex((s) => s.key === key), j = ix + d;
    if (j < 0 || j >= list.length) return;
    [list[ix], list[j]] = [list[j], list[ix]];
    commit(list);
  }
  function nextStep(key: string) {
    const ix = steps.findIndex((s) => s.key === key);
    if (ix < steps.length - 1) goStep(steps[ix + 1].key);
    else addStep("end");
  }
  function addVerb(key: string, verb: string) {
    const s = steps.find((x) => x.key === key);
    if (!s) return;
    const add = `${verb} `;
    patchStep(key, { text: s.text ? (/[.!?]\s*$/.test(s.text) ? `${s.text} ${add}` : `${s.text} ${add.toLowerCase()}`) : add });
    setFocusReq((n) => n + 1);
  }

  function placeLine(stepKey: string, lineId: string, qty?: string) {
    const s = stepsRef.current.find((x) => x.key === stepKey);
    if (!s) return;
    if (s.lines.some((l) => l.recipe_line === lineId)) {
      say("Already in this step. Change the amount instead.");
      return;
    }
    const rest = left(lineId);
    const q = qty ?? (rest > 0 ? fmt(rest) : "0");
    patchStep(stepKey, { lines: [...s.lines, { recipe_line: lineId, qty: q }] });
    setTimeout(() => {
      const inp = document.querySelector<HTMLInputElement>(`[data-mt-qty="${stepKey}:${lineId}"]`);
      inp?.focus();
      inp?.select();
    }, 40);
  }
  function setQty(stepKey: string, lineId: string, qty: string) {
    const s = stepsRef.current.find((x) => x.key === stepKey);
    if (s) patchStep(stepKey, { lines: s.lines.map((l) => (l.recipe_line === lineId ? { ...l, qty } : l)) });
  }
  function unplaceLine(stepKey: string, lineId: string) {
    const s = stepsRef.current.find((x) => x.key === stepKey);
    if (s) patchStep(stepKey, { lines: s.lines.filter((l) => l.recipe_line !== lineId) });
    say("Back on the shelf, still to place");
  }

  // ---------- adding and removing recipe ingredients from here ----------
  async function addNew(kind: "item" | "recipe", id: string, intoStep: string | null) {
    setError(null);
    try {
      const body =
        kind === "item"
          ? (() => {
              const it = items.find((x) => x.id === id)!;
              return { recipe: recipe.id, line_type: "item" as const, item: id, qty: "0", unit: it.base_unit };
            })()
          : (() => {
              const r = allRecipes.find((x) => x.id === id)!;
              return { recipe: recipe.id, line_type: "recipe" as const, sub_recipe: id, qty: "0", unit: r.yield_unit };
            })();
      const created = await createRecipeLine(accessToken, body);
      setExtraLines((prev) => [...prev, created]);
      setShelfPicker(false);
      setStepPicker(null);
      setQuery("");
      if (intoStep) {
        const s = stepsRef.current.find((x) => x.key === intoStep);
        if (s) patchStep(intoStep, { lines: [...s.lines, { recipe_line: created.id, qty: "0" }] });
        say(`${lineName(created)} added to this step and to the Ingredients tab`);
        setTimeout(() => document.querySelector<HTMLInputElement>(`[data-mt-qty="${intoStep}:${created.id}"]`)?.focus(), 60);
      } else {
        say(`${lineName(created)} added to the shelf. Drag it onto a step.`);
      }
      onRecipeChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the ingredient.");
    }
  }
  // "Use 16 g in total": lower the recipe's amount to what the steps use. Only ever happens when the user presses it.
  async function trimTotal(line: RecipeLine) {
    const u = used(stepsRef.current, line.id);
    if (u <= 0) return;
    const before = line.qty;
    try {
      if (!(await flush())) return;
      const updated = await updateRecipeLine(accessToken, line.id, { qty: fmt(u) });
      setExtraLines((prev) => prev.map((p) => (p.id === line.id ? { ...p, qty: updated.qty } : p)));
      onRecipeChanged();
      say(`${lineName(line)} total is now ${fmt(u)} ${line.unit}. The Ingredients tab and the cost are updated.`, {
        label: "Undo",
        run: () => {
          void (async () => {
            try {
              const back = await updateRecipeLine(accessToken, line.id, { qty: before });
              setExtraLines((prev) => prev.map((p) => (p.id === line.id ? { ...p, qty: back.qty } : p)));
              onRecipeChanged();
              say(`${lineName(line)} is back to ${fmt(Number(before))} ${line.unit} in total`);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not undo that.");
            }
          })();
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the amount.");
    }
  }
  async function removeFromRecipe(lineId: string) {
    setConfirmRemove(null);
    try {
      await flush();
      await deleteRecipeLine(accessToken, lineId);
      const next = stepsRef.current.map((s) => ({ ...s, lines: s.lines.filter((l) => l.recipe_line !== lineId) }));
      stepsRef.current = next;
      setSteps(next);
      setExtraLines((prev) => prev.filter((l) => l.id !== lineId));
      onRecipeChanged();
      say("Removed from the recipe and from every step");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the ingredient.");
    }
  }

  // ---------- photos ----------
  async function addPhoto(role: "step" | "arrow" | "finished", file: File | undefined, stepKey?: string) {
    if (!file) return;
    setBusy("Uploading photo…");
    setError(null);
    try {
      if (!(await flush())) return;
      const step = stepKey ? stepsRef.current.find((s) => s.key === stepKey) : undefined;
      if (stepKey && !step?.id) throw new Error("Save the step first, then add the photo.");
      const photo = await uploadMethodPhoto(accessToken, recipe.id, role, await shrinkImage(file), step?.id);
      if (role === "finished") setFinished(photo);
      else {
        const next = stepsRef.current.map((s) =>
          s.key !== stepKey ? s : role === "arrow" ? { ...s, arrow_photo: photo } : { ...s, photos: [...s.photos, photo] }
        );
        stepsRef.current = next;
        setSteps(next);
      }
      say("Photo added");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that photo.");
    } finally {
      setBusy(null);
    }
  }
  async function removePhoto(photo: MethodPhoto, where: { step?: string; role: "step" | "arrow" | "finished" }) {
    try {
      await deleteMethodPhoto(accessToken, photo.id);
      if (where.role === "finished") setFinished(null);
      else {
        const next = stepsRef.current.map((s) =>
          s.key !== where.step ? s : where.role === "arrow" ? { ...s, arrow_photo: null } : { ...s, photos: s.photos.filter((p) => p.id !== photo.id) }
        );
        stepsRef.current = next;
        setSteps(next);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove that photo.");
    }
  }

  // ---------- drag and drop ----------
  function onDragStart(e: DragEvent, lineId: string) {
    dragLineRef.current = lineId;
    e.dataTransfer.setData("text/plain", `line:${lineId}`);
    e.dataTransfer.effectAllowed = "copy";
  }
  function onDropOnStep(e: DragEvent, key: string) {
    e.preventDefault();
    setOverStep(null);
    const d = e.dataTransfer.getData("text/plain") || "";
    const id = d.startsWith("line:") ? d.slice(5) : dragLineRef.current;
    dragLineRef.current = null;
    if (!id || !lineById.has(id)) return;
    setActive(key);
    placeLine(key, id);
    say(`${lineName(lineById.get(id)!)} added to step ${stepNumber(key)}. Check the amount.`);
  }

  // Close an open ingredient list when clicking elsewhere or pressing Escape.
  useEffect(() => {
    if (!shelfPicker && !stepPicker) return;
    const close = () => {
      setShelfPicker(false);
      setStepPicker(null);
      setQuery("");
    };
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-mt-picker]")) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [shelfPicker, stepPicker]);

  // ---------- the "add an ingredient" list ----------
  function Picker({ stepKey }: { stepKey: string | null }) {
    const q = query.trim().toLowerCase();
    const haveItem = new Set(lines.map((l) => l.item).filter(Boolean));
    const haveSub = new Set(lines.map((l) => l.sub_recipe).filter(Boolean));
    const inThisStep = new Set(stepKey ? (steps.find((s) => s.key === stepKey)?.lines ?? []).map((l) => l.recipe_line) : []);
    const mine = stepKey ? lines.filter((l) => !inThisStep.has(l.id)) : [];
    const newItems = items.filter((i) => !i.archived && !haveItem.has(i.id));
    const newSubs = allRecipes.filter((r) => r.kind === "sub" && !r.archived && r.id !== recipe.id && !haveSub.has(r.id));
    const match = (t: string) => !q || t.toLowerCase().includes(q);
    const cap = 40;
    return (
      <div className={`mt-picker${stepKey ? " inline" : ""}`} data-mt-picker>
        <input type="text" placeholder="Search your items…" value={query} autoFocus onChange={(e) => setQuery(e.target.value)} aria-label="Search your items" />
        <div className="mt-picker-list">
          {mine.filter((l) => match(lineName(l))).map((l) => (
            // eslint-disable-next-line react-hooks/refs
            <button type="button" key={l.id} className="mt-opt" onClick={() => { setStepPicker(null); setQuery(""); placeLine(stepKey!, l.id); }}>
              <span><i className="mt-dot" style={{ background: colorOf(l.id) }} />{lineName(l)}</span>
              <small>in recipe · {fmt(Math.max(0, left(l.id)))} {l.unit} left</small>
            </button>
          ))}
          {newItems.filter((i) => match(i.name)).slice(0, cap).map((i) => (
            // eslint-disable-next-line react-hooks/refs
            <button type="button" key={i.id} className="mt-opt" onClick={() => addNew("item", i.id, stepKey)}>
              <span>{i.name}</span><small>{stepKey ? "new · added to Ingredients" : i.base_unit}</small>
            </button>
          ))}
          {newSubs.filter((r) => match(r.name)).slice(0, cap).map((r) => (
            <button type="button" key={r.id} className="mt-opt" onClick={() => addNew("recipe", r.id, stepKey)}>
              <span>{r.name}</span><small>sub-recipe</small>
            </button>
          ))}
          {!mine.some((l) => match(lineName(l))) && !newItems.some((i) => match(i.name)) && !newSubs.some((r) => match(r.name)) && (
            <div className="mt-opt none">Nothing matches. Add new items on the Items page first.</div>
          )}
        </div>
      </div>
    );
  }

  const photoInput = (role: "step" | "arrow" | "finished", stepKey: string | undefined, multiple: boolean) => (
    <input
      type="file"
      accept="image/jpeg,image/png,image/webp,image/*"
      multiple={multiple}
      hidden
      onChange={async (e) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = "";
        for (const f of files) await addPhoto(role, f, stepKey);
      }}
    />
  );

  // ---------- render ----------
  if (!loaded) return <div className="mt-root" hidden={hidden}><p className="mt-sub">Loading the method…</p></div>;

  const saveLabel = { saved: "Saved", pending: "Saving…", saving: "Saving…", error: "Not saved" }[saveState];

  function StepOpen({ s, idx }: { s: MethodStep; idx: number }) {
    const last = idx === steps.length - 1;
    const empty = !s.text.trim() && s.lines.length === 0;
    const cost = stepCost(s);
    return (
      <div
        className={`mt-card mt-step open${overStep === s.key ? " dropok" : ""}`}
        data-mt-step={s.key}
        onDragOver={(e) => { if (dragLineRef.current) { e.preventDefault(); setOverStep(s.key); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverStep(null); }}
        onDrop={(e) => onDropOnStep(e, s.key)}
      >
        <div className="mt-stephead">
          <div className="mt-snum">{idx + 1}</div>
          <h3>Step {idx + 1}</h3>
          <span className="mt-grow" />
          {cost > 0 && <span className="mt-scost">{formatMoney(cost, currency)}</span>}
          <button type="button" className="mt-ibtn" disabled={idx === 0} onClick={() => moveStep(s.key, -1)} aria-label="Move step up" title="Move up">↑</button>
          <button type="button" className="mt-ibtn" disabled={last} onClick={() => moveStep(s.key, 1)} aria-label="Move step down" title="Move down">↓</button>
          <button type="button" className="mt-ibtn del" onClick={() => removeStep(s.key)} aria-label="Delete step" title="Delete step">✕</button>
        </div>
        <textarea
          className="mt-ins"
          data-mt-ins={s.key}
          value={s.text}
          maxLength={2000}
          placeholder="What does the cook do in this step? e.g. Blend until smooth, then pour over ice."
          onChange={(e) => patchStep(s.key, { text: e.target.value })}
        />
        {!s.text && (
          <div className="mt-verbs"><span>Start with</span>{VERBS.map((v) => <button type="button" key={v} className="mt-verb" onClick={() => addVerb(s.key, v)}>{v}</button>)}</div>
        )}
        <div className="mt-tlabel">Ingredients in this step</div>
        <div className="mt-tray" data-over={overStep === s.key || undefined}>
          {s.lines.length === 0 && <span className="mt-empty">Drop an item from the shelf above</span>}
          {s.lines.map((l) => {
            const line = lineById.get(l.recipe_line);
            if (!line) return null;
            return (
              <span className="mt-pchip" key={l.recipe_line} style={cv(colorOf(line.id))}>
                <b>{lineName(line)}</b>
                <input className="mt-qin" inputMode="decimal" value={l.qty} data-mt-qty={`${s.key}:${l.recipe_line}`} aria-label={`Amount of ${lineName(line)}`}
                  onChange={(e) => setQty(s.key, l.recipe_line, e.target.value)} onBlur={(e) => setQty(s.key, l.recipe_line, fmt(num(e.target.value)))} />
                <span className="mt-unit">{line.unit}</span>
                <button type="button" className="mt-x" onClick={() => unplaceLine(s.key, l.recipe_line)} aria-label={`Take ${lineName(line)} out of this step`}>✕</button>
              </span>
            );
          })}
          <button type="button" className="mt-cbtn dashed" data-mt-picker onClick={() => { setStepPicker(stepPicker === s.key ? null : s.key); setShelfPicker(false); setQuery(""); }}>+ Add ingredient</button>
        </div>
        {stepPicker === s.key && Picker({ stepKey: s.key })}
        <div className="mt-extras">
          {(s.timer_minutes > 0 || timerOpen[s.key]) ? (
            <label className="mt-lab">⏱ Timer
              <input className="mt-tin" inputMode="numeric" value={s.timer_minutes || ""} placeholder="0" aria-label="Timer in minutes" autoFocus={timerOpen[s.key] && !s.timer_minutes}
                onChange={(e) => patchStep(s.key, { timer_minutes: Math.min(600, Math.floor(num(e.target.value))) })} /> min
            </label>
          ) : (
            <button type="button" className="mt-ghost" onClick={() => setTimerOpen((t) => ({ ...t, [s.key]: true }))}>⏱ Timer</button>
          )}
          {s.photos.map((p) => (
            <div className="mt-ph" key={p.id}>
              {p.url ? <img src={p.url} alt="Step" /> : <span className="mt-noimg">Photo</span>}
              <button type="button" className="mt-phx" onClick={() => removePhoto(p, { step: s.key, role: "step" })} aria-label="Remove photo">✕</button>
            </div>
          ))}
          {s.photos.length < 6 && <label className="mt-ghost">📷 Photo{photoInput("step", s.key, true)}</label>}
          <span className="mt-grow" />
          {last ? (
            <>
              <button type="button" className="mt-btn" disabled={empty} title={empty ? "Write this step or add an ingredient first" : "Add another step after this one"} onClick={() => nextStep(s.key)}>+ Add another step</button>
              <button type="button" className="mt-btn p" title="This is the last step. Next: a photo of the finished dish" onClick={() => goStep("result", false)}>Finish: add the dish photo →</button>
            </>
          ) : (
            <button type="button" className="mt-btn p" onClick={() => nextStep(s.key)}>Next step →</button>
          )}
        </div>
      </div>
    );
  }

  function StepClosed({ s, idx }: { s: MethodStep; idx: number }) {
    const cost = stepCost(s);
    const txt = s.text.replace(/\s+/g, " ").trim();
    const blank = !txt && s.lines.length === 0;
    return (
      <div
        className={`mt-card mt-step closed${blank ? " blank" : ""}${overStep === s.key ? " dropok" : ""}`}
        data-mt-step={s.key}
        onDragOver={(e) => { if (dragLineRef.current) { e.preventDefault(); setOverStep(s.key); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverStep(null); }}
        onDrop={(e) => onDropOnStep(e, s.key)}
      >
        <button type="button" className="mt-chead" onClick={() => goStep(s.key)} aria-label={`Open step ${idx + 1}`}>
          <span className="mt-snum sm">{idx + 1}</span>
          <span className="mt-cmid">
            <span className="mt-ctitle">{txt || <em>Add instructions…</em>}</span>
            {s.lines.length > 0 && (
              <span className="mt-minis">
                {s.lines.map((l) => {
                  const line = lineById.get(l.recipe_line);
                  return line ? <span key={l.recipe_line} className="mt-mchip"><i style={{ background: colorOf(line.id) }} />{lineName(line)} <small>{l.qty} {line.unit}</small></span> : null;
                })}
              </span>
            )}
          </span>
          <span className="mt-cright">
            {s.timer_minutes > 0 && <span className="mt-mi">⏱ {s.timer_minutes} min</span>}
            {s.photos.length > 0 && <span className="mt-mi">📷 {s.photos.length}</span>}
            {cost > 0 && <span className="mt-scost">{formatMoney(cost, currency)}</span>}
            <span aria-hidden>›</span>
          </span>
        </button>
      </div>
    );
  }

  function Connector({ s, idx }: { s: MethodStep; idx: number }) {
    const last = idx === steps.length - 1;
    const open = noteOpen[s.key] || s.note || s.arrow_photo;
    const tipLabel = last ? "Add a tip before finishing" : `Add a tip before Step ${idx + 2}`;
    return (
      <div className="mt-conn">
        <span className="mt-arr" aria-hidden>↓</span>
        {open ? (
          <div className="mt-cnote">
            {s.arrow_photo?.url && <div className="mt-ph small"><img src={s.arrow_photo.url} alt="" /><button type="button" className="mt-phx" onClick={() => removePhoto(s.arrow_photo!, { step: s.key, role: "arrow" })} aria-label="Remove tip picture">✕</button></div>}
            <input value={s.note} maxLength={300} placeholder={last ? "A tip before finishing, e.g. wipe the rim of the cup" : `A tip before step ${idx + 2}, e.g. pour slowly`} aria-label={tipLabel} onChange={(e) => patchStep(s.key, { note: e.target.value })} />
            <label className="mt-ibtn" title="Add a picture to this tip" aria-label="Add a picture to this tip">📷{photoInput("arrow", s.key, false)}</label>
            <button type="button" className="mt-ibtn" aria-label="Remove note" title="Remove note"
              onClick={() => { setNoteOpen((n) => ({ ...n, [s.key]: false })); patchStep(s.key, { note: "" }); if (s.arrow_photo) removePhoto(s.arrow_photo, { step: s.key, role: "arrow" }); }}>✕</button>
          </div>
        ) : (
          <button type="button" className="mt-cbtn" onClick={() => setNoteOpen((n) => ({ ...n, [s.key]: true }))} title="The cook sees this tip when moving on from this step">💬 {tipLabel}</button>
        )}
        {!last && <button type="button" className="mt-cbtn" onClick={() => addStep(s.key)} title="Insert a step here">+</button>}
      </div>
    );
  }

  return (
    <div className="mt-root" hidden={hidden}>
      <div className="mt-bar">
        {!readOnly ? (
          <div className="mt-seg" role="tablist" aria-label="View">
            <button type="button" role="tab" aria-selected={mode === "build"} className={mode === "build" ? "on" : ""} onClick={() => setMode("build")}>Build the method</button>
            <button type="button" role="tab" aria-selected={mode === "cook"} className={mode === "cook" ? "on" : ""} onClick={async () => { await flush(); setMode("cook"); }}>Cook view</button>
          </div>
        ) : <span />}
        <div className="mt-who">
          {mode === "build" ? "Everyone on the team can follow this in Cook view. " : "This is what the team sees on a phone or tablet. "}
          {!readOnly && <span className={`mt-saved ${saveState}`} role="status">{saveLabel}</span>}
        </div>
      </div>
      {error && <p className="mt-error" role="alert">{error}{saveState === "error" && <> <button type="button" className="mt-link" onClick={() => void flush()}>Try again</button></>}</p>}
      {busy && <p className="mt-sub" role="status">{busy}</p>}

      {mode === "cook" ? (
        <MethodCook
          recipeName={recipe.name}
          steps={steps}
          lineById={lineById}
          colorOf={colorOf}
          finished={finished}
          contains={contains}
          mayContain={mayContain}
        />
      ) : (
        <div className="mt-build">
          <div className="mt-shelf">
            <div className="mt-shead">
              <span className="mt-step0">0</span><b>What goes in</b><span className="mt-scap">Drag an item onto a step</span>
              {lines.length > 0 && (stillToPlace ? <span className="mt-stat todo">{stillToPlace} still to place</span> : <span className="mt-stat ok">All placed ✓</span>)}
            </div>
            <div className="mt-shrow">
              <div className="mt-chips">
                {lines.length === 0 && <span className="mt-sempty">Nothing here yet. Add the first item. It also lands on the Ingredients tab, with its cost.</span>}
                {lines.map((l) => {
                  const rest = left(l.id), total = Number(l.qty);
                  const done = total > 0 && rest <= 0.0005;
                  return (
                    <div key={l.id} className={`mt-sitem${done ? " done" : ""}${partial.some((x) => x.id === l.id) ? " rest" : ""}`} draggable onDragStart={(e) => onDragStart(e, l.id)} onDragEnd={() => { dragLineRef.current = null; setOverStep(null); }}
                      style={cv(colorOf(l.id))} title={`Drag onto a step. ${fmt(total)} ${l.unit} in total`}
                      onClick={(e) => { if (partial.some((x) => x.id === l.id) && !(e.target as HTMLElement).closest("button")) document.querySelector("[data-mt-left]")?.scrollIntoView({ block: "center", behavior: "smooth" }); }}>
                      <i className="mt-dot" /><b>{lineName(l)}</b>
                      <small>{!total ? "no amount yet" : done ? "✓ placed" : `${fmt(rest)} ${l.unit} left`}</small>
                      {confirmRemove === l.id ? (
                        <span className="mt-confirm">Remove? <button type="button" onClick={() => removeFromRecipe(l.id)}>Yes</button><button type="button" onClick={() => setConfirmRemove(null)}>No</button></span>
                      ) : (
                        <button type="button" className="mt-x" onClick={() => setConfirmRemove(l.id)} aria-label={`Remove ${lineName(l)} from the recipe`} title="Remove from the recipe">✕</button>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="mt-addwrap" data-mt-picker>
                <button type="button" className={`mt-addpill${lines.length ? "" : " big"}`} onClick={() => { setShelfPicker(!shelfPicker); setStepPicker(null); setQuery(""); }}>+ Add item</button>
                {shelfPicker && Picker({ stepKey: null })}
              </div>
            </div>
          </div>

          {steps.length === 0 ? (
            <div className="mt-card mt-emptycard"><h3>No steps yet</h3><p>Start with step 1: what goes in first, and what to do with it.</p><button type="button" className="mt-bigadd" onClick={() => addStep("end")}>+ Add step 1</button></div>
          ) : steps.map((s, idx) => (
            <div key={s.key}>
              {s.key === active ? StepOpen({ s, idx }) : StepClosed({ s, idx })}
              {Connector({ s, idx })}
            </div>
          ))}

          {active === "result" ? (
            <div className="mt-card mt-step open">
              <div className="mt-stephead"><div className="mt-snum good">✓</div><h3>Finished dish: how it should look</h3></div>
              <p className="mt-sub">The cook sees this on every step as the “target look”, and on the final screen.</p>
              <div className="mt-photos">
                {finished && <div className="mt-ph big">{finished.url ? <img src={finished.url} alt="Finished dish" /> : <span className="mt-noimg">Photo</span>}<button type="button" className="mt-phx" onClick={() => removePhoto(finished, { role: "finished" })} aria-label="Remove photo">✕</button></div>}
                <label className={`mt-phadd${finished ? "" : " big"}`}>📷 {finished ? "Change photo" : "Add a photo of the finished dish"}{photoInput("finished", undefined, false)}</label>
              </div>
            </div>
          ) : (
            <div className="mt-card mt-step closed">
              <button type="button" className="mt-chead" onClick={() => goStep("result", false)} aria-label="Open the finished dish photo">
                <span className="mt-snum sm good">✓</span>
                <span className="mt-cmid"><span className="mt-ctitle"><b>Finished dish</b> <em>how it should look</em></span></span>
                <span className="mt-cright">{finished?.url ? <span className="mt-rth"><img src={finished.url} alt="" /></span> : <span className="mt-mi">Add a photo</span>}<span aria-hidden>›</span></span>
              </button>
            </div>
          )}
          {partial.length > 0 && (
            <div className="mt-left" data-mt-left role="group" aria-label="Ingredients with some left over">
              {partial.map((l) => {
                const u = used(steps, l.id);
                const rest = Number(l.qty) - u;
                const drop = rest * Number(l.unit_cost ?? 0);
                return (
                  <div className="mt-leftrow" key={l.id}>
                    <span className="mt-lico" aria-hidden>!</span>
                    <div className="mt-lbody">
                      <h4>{fmt(rest)} {l.unit} of {lineName(l)} is not in any step</h4>
                      <p>The recipe says {fmt(Number(l.qty))} {l.unit} in total (Ingredients tab). Your steps use {fmt(u)} {l.unit}.</p>
                      <button type="button" className="mt-btn p" onClick={() => void trimTotal(l)}>
                        Use {fmt(u)} {l.unit} in total{drop > 0.005 && <small>cost drops by {formatMoney(drop, currency)}</small>}
                      </button>
                    </div>
                  </div>
                );
              })}
              <p className="mt-lhint">{partial.length === 1 ? `Or use the ${fmt(Number(partial[0].qty) - used(steps, partial[0].id))} ${partial[0].unit} in your steps.` : "Or use the rest in your steps."}</p>
            </div>
          )}
          <div className="mt-foot">
            <span className={stillToPlace ? "mt-warn" : "mt-ok"}>
              {lines.length === 0 ? "" : untouched.length > 0
                ? `Not in any step yet: ${untouched.slice(0, 3).map((l) => lineName(l)).join(", ")}${untouched.length > 3 ? ` and ${untouched.length - 3} more` : ""}`
                : partial.length > 0 ? "" : "Every ingredient is placed ✓ Totals match the Ingredients tab."}
            </span>
            <button type="button" className="mt-btn p" onClick={async () => { await flush(); setMode("cook"); }}>Preview in Cook view</button>
          </div>
        </div>
      )}
      {toast && (
        <div className={`mt-toast${toastAct ? " act" : ""}`} role="status">
          {toast}
          {toastAct && <button type="button" onClick={() => { const run = toastAct.run; setToast(null); setToastAct(null); run(); }}>{toastAct.label}</button>}
        </div>
      )}
    </div>
  );
}
