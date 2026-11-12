import { useEffect, useMemo, useRef, useState } from "react";
import AllergenIcon from "./AllergenIcon";
import { aiAllergenSentence, bulkReviewItems, runAllergenWordList } from "./api";
import type { Allergen, CatalogItem, Recipe } from "./api";

// The allergen review screen: the fast way to confirm every item's
// allergens, instead of opening items one at a time.
//
//   Queue    -- every item that still needs checking, most-used-in-recipes
//               first. Items the word list found something for are one tap
//               ("Looks right"); items it found nothing for are a tick list,
//               because "nothing found from the name" is NOT "no allergens"
//               and a person has to look at each one (there is deliberately
//               no plain select-all there; after a search you can tick what
//               is shown, and add one allergen to everything ticked).
//   By dish  -- pick a dish and confirm its ingredients together, so the
//               dish ends up with no unchecked ingredients (no dagger on
//               its printed card).
//
// Every confirmation goes through POST /items/bulk_review/ -- the same
// rules as the item page's Confirm button, so the two can never disagree.

interface Draft {
  contains: string[];
  may: string[];
}

const PAGE = 100;

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

// Suggestions that still wait for a person: pending, and not already a tag.
function openSuggestions(it: CatalogItem) {
  return it.allergen_suggestions.filter(
    (s) => s.status === "pending" && !(s.level === "contains" ? it.allergens : it.may_contain_allergens).includes(s.allergen)
  );
}

// Short, lower-case allergen names for button labels ("Add gluten & confirm").
function shortName(a?: Allergen): string {
  if (!a) return "allergen";
  if (a.code === "gluten") return "gluten";
  if (a.code === "sulphites") return "sulphites";
  return a.name.toLowerCase();
}

function ReviewRow({
  item,
  allergens,
  usage,
  draft,
  editing,
  selected,
  showSelect,
  compact,
  busy,
  onSelect,
  onDraft,
  onToggleEdit,
  onConfirm,
  onAcceptConfirm,
  onOpen,
}: {
  item: CatalogItem;
  allergens: Allergen[];
  usage: number;
  draft: Draft;
  editing: boolean;
  selected: boolean;
  showSelect: boolean;
  compact: boolean;
  busy: boolean;
  onSelect: (checked: boolean, shift: boolean) => void;
  onDraft: (d: Draft) => void;
  onToggleEdit: () => void;
  onConfirm: () => void;
  onAcceptConfirm: () => void;
  onOpen: () => void;
}) {
  const mayOnly = draft.may.filter((id) => !draft.contains.includes(id));
  const needsReview = item.allergen_needs_review;
  const pending = item.allergen_suggestions.filter(
    (s) => s.status === "pending" && !(s.level === "contains" ? draft.contains : draft.may).includes(s.allergen)
  );
  const nameOf = (id: string) => allergens.find((x) => x.id === id);
  // Why each tag or suggestion is there: shown on hover for tags, and as one
  // short line under a suggestion that still waits for a person.
  const reasonOf = new Map(item.allergen_suggestions.map((s) => [s.allergen, s.reason]));
  const why = pending
    .map((s) => {
      const a = nameOf(s.allergen);
      if (!a) return null;
      return pending.length > 1 ? `${shortName(a)}: ${s.reason}` : s.reason;
    })
    .filter((r): r is string => !!r);
  const notSure = pending.length > 0 && pending.every((s) => s.confidence === "low");
  const nothingTagged = draft.contains.length === 0 && mayOnly.length === 0;
  const addWhat = pending.length === 1 ? shortName(nameOf(pending[0].allergen)) : `${pending.length} allergens`;

  function flip(level: "contains" | "may", id: string) {
    let contains = draft.contains;
    let may = draft.may;
    if (level === "contains") {
      const had = contains.includes(id);
      contains = toggle(contains, id);
      if (!had) may = may.filter((x) => x !== id); // contains beats may contain
    } else {
      may = toggle(may, id);
    }
    onDraft({ contains, may });
  }

  return (
    <div className={`ar-row${compact ? " ar-compact" : ""}${editing ? " ar-open" : ""}`}>
      <div className="ar-line">
        {showSelect && (
          <input
            type="checkbox"
            className="ar-check"
            checked={selected}
            aria-label={`Select ${item.name}`}
            onChange={() => undefined}
            onClick={(e) => onSelect(!selected, e.shiftKey)}
          />
        )}
        <div className="ar-main">
          <div className="ar-name">
            <button type="button" className="ar-link" onClick={onOpen} title="Open the item page">
              {item.name}
            </button>
            <span className="ar-sub">
              {usage > 0 ? `used in ${usage} ${usage === 1 ? "recipe" : "recipes"}` : "not used in a recipe yet"}
            </span>
            {!needsReview && <span className="ar-pill ar-pill-good">✓ Confirmed</span>}
            {needsReview && pending.length > 0 && (
              <span className="ar-pill ar-pill-sug">{notSure ? "SAWIS is not sure" : "SAWIS suggests"}</span>
            )}
          </div>
          {!compact && (
            <div className="ar-tags">
              {allergens
                .filter((a) => draft.contains.includes(a.id))
                .map((a) => (
                  <span key={a.id} className="ar-tag" title={reasonOf.get(a.id) ?? a.name}>
                    <AllergenIcon code={a.code} size={14} />
                    {a.name}
                  </span>
                ))}
              {allergens
                .filter((a) => mayOnly.includes(a.id))
                .map((a) => (
                  <span key={a.id} className="ar-tag ar-tag-may" title={`May contain ${a.name}`}>
                    <AllergenIcon code={a.code} size={14} />
                    May contain {a.name}
                  </span>
                ))}
              {pending.map((s) => {
                const a = allergens.find((x) => x.id === s.allergen);
                if (!a) return null;
                return (
                  <button
                    key={s.id}
                    type="button"
                    className="ar-tag ar-tag-suggest"
                    title={s.reason}
                    disabled={busy}
                    onClick={() =>
                      s.level === "contains"
                        ? flip("contains", a.id)
                        : onDraft({ contains: draft.contains, may: toggle(draft.may, a.id) })
                    }
                  >
                    + {s.level === "may_contain" ? "May contain " : ""}
                    {a.name}?
                  </button>
                );
              })}
              {nothingTagged && pending.length === 0 && (
                <span className="ar-none">
                  {needsReview ? "Nothing found from the name. Please check the label." : "No allergens"}
                </span>
              )}
            </div>
          )}
          {!compact && why.length > 0 && needsReview && (
            <div className="ar-reason">
              <span className="ar-why">Why:</span> {why.join(" · ")}
            </div>
          )}
        </div>
        <div className="ar-actions">
          {needsReview && !compact && pending.length > 0 && (
            <>
              <button type="button" className="btn-primary small" disabled={busy} onClick={onAcceptConfirm}>
                Add {addWhat} &amp; confirm
              </button>
              <button type="button" className="btn-ghost small" disabled={busy} onClick={onConfirm}>
                {nothingTagged ? "No allergens" : "Confirm as is"}
              </button>
            </>
          )}
          {needsReview && !compact && pending.length === 0 && (
            <button
              type="button"
              className={nothingTagged ? "btn-ghost small" : "btn-primary small"}
              disabled={busy}
              onClick={onConfirm}
            >
              {nothingTagged ? "No allergens" : "Looks right"}
            </button>
          )}
          <button type="button" className="btn-ghost small" onClick={onToggleEdit}>
            {editing ? "Close" : "Edit"}
          </button>
        </div>
      </div>

      {editing && (
        <div className="ar-edit">
          <div className="allergen-sub">Contains</div>
          <div className="chip-row" style={{ marginBottom: 10 }}>
            {allergens.map((a) => {
              const on = draft.contains.includes(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  className={`chip allergen-chip${on ? " active" : ""}`}
                  aria-pressed={on}
                  onClick={() => flip("contains", a.id)}
                >
                  <AllergenIcon code={a.code} size={16} />
                  {a.name}
                </button>
              );
            })}
          </div>
          <div className="allergen-sub">May contain</div>
          <div className="chip-row" style={{ marginBottom: 10 }}>
            {allergens.map((a) => {
              const inContains = draft.contains.includes(a.id);
              const on = !inContains && draft.may.includes(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  className={`chip allergen-chip allergen-chip-may${on ? " active" : ""}`}
                  aria-pressed={on}
                  disabled={inContains}
                  onClick={() => flip("may", a.id)}
                >
                  <AllergenIcon code={a.code} size={16} />
                  {a.name}
                </button>
              );
            })}
          </div>
          <button type="button" className="btn-primary small" disabled={busy} onClick={onConfirm}>
            {nothingTagged ? "Confirm: no allergens" : "Confirm allergens"}
          </button>
        </div>
      )}
    </div>
  );
}

// Every distinct item a recipe uses, through sub-recipes.
function ingredientIds(recipe: Recipe, byId: Map<string, Recipe>, seen = new Set<string>()): Set<string> {
  const out = new Set<string>();
  recipe.lines.forEach((l) => {
    if (l.line_type === "item" && l.item) out.add(l.item);
    else if (l.line_type === "recipe" && l.sub_recipe && !seen.has(l.sub_recipe)) {
      seen.add(l.sub_recipe);
      const sub = byId.get(l.sub_recipe);
      if (sub) ingredientIds(sub, byId, seen).forEach((id) => out.add(id));
    }
  });
  return out;
}

export default function AllergenReview({
  items,
  recipes,
  allergens,
  accessToken,
  onBack,
  onChanged,
  onOpenItem,
}: {
  items: CatalogItem[];
  recipes: Recipe[];
  allergens: Allergen[];
  accessToken: string;
  onBack: () => void;
  onChanged: () => void;
  onOpenItem: (id: string) => void;
}) {
  const [tab, setTab] = useState<"queue" | "dish">("queue");
  // Items as returned by the server after a confirmation, so rows update
  // at once instead of waiting for the whole list to reload.
  const [local, setLocal] = useState<Record<string, CatalogItem>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "ready" | "sug" | "none">("all");
  const [showRecent, setShowRecent] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [limitA, setLimitA] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dishId, setDishId] = useState<string | null>(null);
  const [dishOnlyOpen, setDishOnlyOpen] = useState(true);
  const [lastTicked, setLastTicked] = useState<string | null>(null);
  // "Add allergen to ticked items" panel.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkPick, setBulkPick] = useState<string[]>([]);
  const [bulkLevel, setBulkLevel] = useState<"contains" | "may">("contains");
  // Word list over every item name ("Suggest from item names"). The server
  // only runs it when an item is created, renamed or imported, so a catalogue
  // that existed first needs one run; it happens by itself the first time this
  // screen opens with nothing suggested, and can be repeated from the button.
  const [checking, setChecking] = useState(false);
  const [checkNote, setCheckNote] = useState<string | null>(null);
  const autoTried = useRef(false);

  async function runCheck() {
    setChecking(true);
    setError(null);
    try {
      const r = await runAllergenWordList(accessToken);
      try {
        sessionStorage.setItem("sawis-allergen-autocheck", "1");
      } catch {
        /* storage can be blocked; the check is still safe to repeat */
      }
      setCheckNote(
        (r.items_changed === 0
          ? `Checked ${r.items} item names. Nothing new matched, so every item below needs a person's check.`
          : `Checked ${r.items} item names: ${r.items_changed} matched (${r.tags_added} tag${r.tags_added === 1 ? "" : "s"} added, ${r.suggestions} suggestion${r.suggestions === 1 ? "" : "s"} to look at). Nothing is confirmed until you confirm it.`) +
          aiAllergenSentence(r.ai)
      );
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check the item names.");
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    if (autoTried.current || items.length === 0) return;
    autoTried.current = true;
    const already = (() => {
      try {
        return sessionStorage.getItem("sawis-allergen-autocheck") === "1";
      } catch {
        return false;
      }
    })();
    const waiting = items.filter((it) => !it.archived && it.allergen_needs_review);
    const anySuggested = waiting.some(
      (it) => it.allergens.length > 0 || it.may_contain_allergens.length > 0 || it.allergen_suggestions.length > 0
    );
    if (!already && waiting.length > 0 && !anySuggested) {
      const t = setTimeout(() => void runCheck(), 0);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  const view = (it: CatalogItem): CatalogItem => local[it.id] ?? it;
  const itemsById = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);
  const recipesById = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    recipes.forEach((r) => {
      new Set(r.lines.map((l) => l.item).filter((id): id is string => !!id)).forEach((id) => {
        m.set(id, (m.get(id) ?? 0) + 1);
      });
    });
    return m;
  }, [recipes]);

  const draftOf = (it: CatalogItem): Draft =>
    drafts[it.id] ?? { contains: it.allergens, may: it.may_contain_allergens };

  async function confirm(reviews: { id: string; allergens: string[]; may_contain_allergens: string[] }[]) {
    if (reviews.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (let i = 0; i < reviews.length; i += PAGE) {
        const out = await bulkReviewItems(accessToken, reviews.slice(i, i + PAGE));
        const ids = new Set(out.map((o) => o.id));
        setLocal((prev) => ({ ...prev, ...Object.fromEntries(out.map((o) => [o.id, o])) }));
        setDrafts((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !ids.has(id))));
        setSelected((prev) => new Set([...prev].filter((id) => !ids.has(id))));
        setRecent((prev) => [...ids, ...prev.filter((id) => !ids.has(id))].slice(0, 8));
      }
      setEditing(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not confirm those items.");
    } finally {
      setBusy(false);
    }
  }

  function confirmRow(it: CatalogItem) {
    const d = draftOf(it);
    return confirm([
      { id: it.id, allergens: d.contains, may_contain_allergens: d.may.filter((id) => !d.contains.includes(id)) },
    ]);
  }

  // Adds what SAWIS suggests for this item to what is already shown, then confirms.
  function acceptConfirm(it: CatalogItem) {
    const d = draftOf(it);
    const contains = new Set(d.contains);
    const may = new Set(d.may);
    openSuggestions(it).forEach((s) => (s.level === "contains" ? contains : may).add(s.allergen));
    contains.forEach((id) => may.delete(id));
    return confirm([{ id: it.id, allergens: [...contains], may_contain_allergens: [...may] }]);
  }

  function renderRow(it: CatalogItem, opts: { showSelect: boolean; compact: boolean; selected: boolean; onSelect: (c: boolean, shift: boolean) => void }) {
    return (
      <ReviewRow
        key={it.id}
        item={it}
        allergens={allergens}
        usage={usage.get(it.id) ?? 0}
        draft={draftOf(it)}
        editing={editing === it.id}
        selected={opts.selected}
        showSelect={opts.showSelect}
        compact={opts.compact}
        busy={busy}
        onSelect={opts.onSelect}
        onDraft={(d) => setDrafts((prev) => ({ ...prev, [it.id]: d }))}
        onToggleEdit={() => setEditing(editing === it.id ? null : it.id)}
        onConfirm={() => confirmRow(it)}
        onAcceptConfirm={() => acceptConfirm(it)}
        onOpen={() => onOpenItem(it.id)}
      />
    );
  }

  // ---- Queue ---------------------------------------------------------
  const q = search.trim().toLowerCase();
  const byUsage = (a: CatalogItem, b: CatalogItem) =>
    (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0) || a.name.localeCompare(b.name);
  const needing = items
    .filter((it) => !it.archived)
    .map(view)
    .filter((it) => it.allergen_needs_review);
  const matches = (it: CatalogItem) => !q || it.name.toLowerCase().includes(q);
  const hasTags = (it: CatalogItem) =>
    it.allergens.length > 0 || it.may_contain_allergens.length > 0 || it.allergen_suggestions.length > 0;
  const found = needing.filter(matches);
  // Three kinds of row, shown in one list: SAWIS suggests something that waits
  // for a person, tags were found from the name, or nothing was found at all.
  const sugList = found.filter((it) => openSuggestions(it).length > 0).sort(byUsage);
  const readyList = found.filter((it) => openSuggestions(it).length === 0 && hasTags(it)).sort(byUsage);
  const noneList = found.filter((it) => !hasTags(it)).sort(byUsage);
  const queue =
    filter === "sug" ? sugList : filter === "ready" ? readyList : filter === "none" ? noneList : [...sugList, ...readyList, ...noneList];
  const shown = queue.slice(0, limitA);

  // Shift-click selects everything between the last click and this one, so a
  // long run of obviously-fine items (salt, sugar, water ...) isn't a hundred
  // separate clicks.
  function pick(id: string, checked: boolean, shift: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      const ids = shown.map((i) => i.id);
      const from = shift && lastTicked ? ids.indexOf(lastTicked) : -1;
      if (from >= 0 && ids.indexOf(id) >= 0) {
        const [lo, hi] = [Math.min(from, ids.indexOf(id)), Math.max(from, ids.indexOf(id))];
        ids.slice(lo, hi + 1).forEach((x) => (checked ? next.add(x) : next.delete(x)));
      } else if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
    setLastTicked(id);
  }

  // "Select all shown" picks the rows that have tags or a suggestion. Rows with
  // nothing found are only picked this way after a search (say "syrup"), so a
  // person never ticks a hundred unknown items without looking at them.
  const selectable = shown.filter((i) => hasTags(i) || q !== "");
  const allSelected = selectable.length > 0 && selectable.every((i) => selected.has(i.id));
  function toggleAllShown() {
    setSelected((prev) => {
      const next = new Set(prev);
      selectable.forEach((i) => (allSelected ? next.delete(i.id) : next.add(i.id)));
      return next;
    });
  }

  const pickedItems = [...selected]
    .map((id) => itemsById.get(id))
    .filter((it): it is CatalogItem => !!it)
    .map(view);
  const pickedTagged = pickedItems.filter(hasTags);
  const pickedNone = pickedItems.filter((it) => !hasTags(it));

  // Adds the chosen allergen(s) to every selected item and confirms them.
  // Anything already tagged on the item is kept.
  function applyBulkAllergen() {
    if (bulkPick.length === 0) return;
    const reviews = [...selected].map((id) => {
      const it = itemsById.get(id);
      const cur = it ? view(it) : null;
      const contains = new Set(cur?.allergens ?? []);
      const may = new Set(cur?.may_contain_allergens ?? []);
      bulkPick.forEach((a) => (bulkLevel === "contains" ? contains : may).add(a));
      contains.forEach((a) => may.delete(a));
      return { id, allergens: [...contains], may_contain_allergens: [...may] };
    });
    confirm(reviews).then(() => {
      setBulkOpen(false);
      setBulkPick([]);
    });
  }

  const hiddenSelected = [...selected].filter((id) => !shown.some((i) => i.id === id)).length;

  const recentItems = recent
    .map((id) => itemsById.get(id))
    .filter((it): it is CatalogItem => !!it)
    .map(view);

  // ---- By dish -------------------------------------------------------
  const dishes = recipes
    .filter((r) => r.kind === "dish")
    .map((r) => {
      const ids = [...ingredientIds(r, recipesById)];
      const its = ids.map((id) => itemsById.get(id)).filter((i): i is CatalogItem => !!i).map(view);
      const unchecked = its.filter((i) => i.allergen_review_status !== "confirmed").length;
      return { recipe: r, items: its, unchecked };
    })
    .filter((d) => matches({ name: d.recipe.name } as CatalogItem) && (!dishOnlyOpen || d.unchecked > 0))
    .sort((a, b) => b.unchecked - a.unchecked || a.recipe.name.localeCompare(b.recipe.name));
  const activeDish = dishes.find((d) => d.recipe.id === dishId) ?? null;

  const total = items.filter((it) => !it.archived).length;
  const doneCount = total - needing.length;

  return (
    <div className="ar">
      <button className="back-link" onClick={onBack}>
        ← All items
      </button>
      <div className="content-head ar-head">
        <h1 className="page-title">Review allergens</h1>
        {(needing.length > 0 || checkNote) && (
          <button
            type="button"
            className="ar-linkbtn"
            onClick={() => void runCheck()}
            disabled={checking}
            title="Reads every item name again and suggests anything new"
          >
            {checking ? "Checking names…" : "Check names again"}
          </button>
        )}
      </div>
      <div className="ar-prog">
        <div className="ar-progress" aria-hidden="true">
          <span style={{ width: `${total ? Math.round((doneCount / total) * 100) : 0}%` }} />
        </div>
        <span className="ar-prog-text">
          {needing.length === 0 ? (
            "Every item's allergens are confirmed"
          ) : (
            <>
              <b>{doneCount}</b> of {total} confirmed · <b>{needing.length}</b> to check
            </>
          )}
        </span>
        <span className="ar-info" tabIndex={0} role="note" aria-label="What confirmed means">
          i
          <span className="ar-tip">
            A confirmed item with no tags means “reviewed, no allergens”. An item you haven't confirmed is never
            treated as allergen-free.
          </span>
        </span>
      </div>
      {checkNote && <p className="hint ar-note">{checking ? "Reading every item name…" : checkNote}</p>}

      <div className="rtabs" style={{ marginTop: 14 }}>
        <button className={`rtab ${tab === "queue" ? "on" : ""}`} onClick={() => setTab("queue")}>
          To check ({needing.length})
        </button>
        <button className={`rtab ${tab === "dish" ? "on" : ""}`} onClick={() => setTab("dish")}>
          By dish
        </button>
        <input
          className="head-search"
          style={{ marginLeft: "auto" }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tab === "queue" ? "Search items…" : "Search dishes…"}
        />
      </div>

      {error && <p className="error">{error}</p>}

      {tab === "queue" && (
        <>
          {needing.length === 0 && recentItems.length === 0 && (
            <div className="card">
              <p style={{ margin: 0 }}>Nothing to review. New items will show up here as they're added.</p>
            </div>
          )}

          {needing.length > 0 && (
            <div className="ar-filters">
              <div className="ar-chips" role="group" aria-label="Show">
                {(
                  [
                    ["all", "All", sugList.length + readyList.length + noneList.length],
                    ["ready", "Ready to confirm", readyList.length],
                    ["sug", "SAWIS suggests", sugList.length],
                    ["none", "Nothing found", noneList.length],
                  ] as const
                ).map(([key, label, n]) => (
                  <button
                    key={key}
                    type="button"
                    className={`ar-fchip${filter === key ? " on" : ""}`}
                    aria-pressed={filter === key}
                    onClick={() => {
                      setFilter(key);
                      setLimitA(PAGE);
                    }}
                  >
                    {label}
                    <b>{n}</b>
                  </button>
                ))}
              </div>
              {selectable.length > 0 && (
                <button type="button" className="ar-linkbtn" onClick={toggleAllShown}>
                  {allSelected ? "Clear selection" : "Select all shown"}
                </button>
              )}
            </div>
          )}

          {filter === "none" && noneList.length > 0 && (
            <p className="hint">
              These names didn't match anything. That does <b>not</b> mean they're allergen-free: you know the product,
              SAWIS doesn't. Tick several to confirm or tag them together (shift-click ticks a run; search for a word
              like “syrup” first to tick everything matching it).
            </p>
          )}

          {needing.length > 0 && queue.length === 0 && <p className="muted">Nothing matches.</p>}

          {shown.length > 0 && (
            <div className="ar-list">
              {shown.map((it) =>
                renderRow(it, {
                  showSelect: true,
                  compact: false,
                  selected: selected.has(it.id),
                  onSelect: (c, shift) => pick(it.id, c, shift),
                })
              )}
            </div>
          )}
          {queue.length > shown.length && (
            <button type="button" className="btn-ghost small" onClick={() => setLimitA(limitA + PAGE)}>
              Show {Math.min(PAGE, queue.length - shown.length)} more
            </button>
          )}

          {selected.size > 0 && (
            <div className="ar-bulk-wrap">
              {bulkOpen && (
                <div className="ar-bulk" role="group" aria-label="Add an allergen to the selected items">
                  <div className="ar-bulk-title">
                    Add to {selected.size} selected {selected.size === 1 ? "item" : "items"}
                  </div>
                  <div className="ar-bulk-level">
                    <label className="check-row">
                      <input
                        type="radio"
                        name="ar-bulk-level"
                        checked={bulkLevel === "contains"}
                        onChange={() => setBulkLevel("contains")}
                      />
                      Contains
                    </label>
                    <label className="check-row">
                      <input
                        type="radio"
                        name="ar-bulk-level"
                        checked={bulkLevel === "may"}
                        onChange={() => setBulkLevel("may")}
                      />
                      May contain
                    </label>
                  </div>
                  <div className="ar-tags ar-pick">
                    {allergens.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        className={`ar-tag ${bulkPick.includes(a.id) ? "on" : ""}`}
                        aria-pressed={bulkPick.includes(a.id)}
                        disabled={busy}
                        onClick={() => setBulkPick(toggle(bulkPick, a.id))}
                      >
                        <AllergenIcon code={a.code} size={14} />
                        {a.name}
                      </button>
                    ))}
                  </div>
                  <div className="ar-bulk-actions">
                    <button type="button" className="btn-ghost small" onClick={() => setBulkOpen(false)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn-primary small"
                      disabled={busy || bulkPick.length === 0}
                      onClick={applyBulkAllergen}
                    >
                      {busy ? "Saving…" : `Add and confirm ${selected.size}`}
                    </button>
                  </div>
                </div>
              )}
              <div className="ar-bar">
                <span>
                  {selected.size} selected
                  {hiddenSelected > 0 && ` (${hiddenSelected} hidden by your filter)`}
                </span>
                <div className="ar-bar-actions">
                  <button
                    type="button"
                    className="ar-bar-link"
                    disabled={busy}
                    onClick={() => {
                      setSelected(new Set());
                      setBulkOpen(false);
                    }}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    className="btn-ghost small ar-bar-btn"
                    disabled={busy}
                    onClick={() => setBulkOpen(!bulkOpen)}
                  >
                    Add allergen…
                  </button>
                  {pickedTagged.length > 0 && (
                    <button
                      type="button"
                      className="btn-primary small"
                      disabled={busy}
                      onClick={() =>
                        confirm(
                          pickedTagged.map((it) => {
                            const d = draftOf(it);
                            return {
                              id: it.id,
                              allergens: d.contains,
                              may_contain_allergens: d.may.filter((id) => !d.contains.includes(id)),
                            };
                          })
                        )
                      }
                    >
                      {busy ? "Saving…" : `Confirm ${pickedTagged.length} as shown`}
                    </button>
                  )}
                  {pickedNone.length > 0 && (
                    <button
                      type="button"
                      className="btn-primary small"
                      disabled={busy}
                      onClick={() =>
                        confirm(pickedNone.map((it) => ({ id: it.id, allergens: [], may_contain_allergens: [] })))
                      }
                    >
                      {busy ? "Saving…" : `Confirm ${pickedNone.length}: no allergens`}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {recentItems.length > 0 && (
            <section className="ar-recent">
              <button type="button" className="ar-linkbtn" onClick={() => setShowRecent(!showRecent)}>
                Recently confirmed ({recentItems.length}) {showRecent ? "▾" : "▸"}
              </button>
              {showRecent && (
                <>
                  <p className="hint">Made a mistake? Open Edit to change it.</p>
                  <div className="ar-list">
                    {recentItems.map((it) =>
                      renderRow(it, { showSelect: false, compact: true, selected: false, onSelect: () => undefined })
                    )}
                  </div>
                </>
              )}
            </section>
          )}
        </>
      )}

      {tab === "dish" && (
        <div className="ar-dishes">
          <div className="ar-dish-list">
            <label className="check-row" style={{ padding: "0 0 8px" }}>
              <input type="checkbox" checked={dishOnlyOpen} onChange={(e) => setDishOnlyOpen(e.target.checked)} />
              Only dishes with unchecked ingredients
            </label>
            {dishes.length === 0 && <p className="muted">No dishes to show.</p>}
            {dishes.map((d) => (
              <button
                key={d.recipe.id}
                type="button"
                className={`ar-dish${d.recipe.id === dishId ? " on" : ""}`}
                onClick={() => {
                  setDishId(d.recipe.id);
                  setEditing(null);
                }}
              >
                <span className="ar-dish-name">{d.recipe.name || "Untitled"}</span>
                {d.unchecked > 0 ? (
                  <span className="ar-pill ar-pill-warn">{d.unchecked} to check</span>
                ) : (
                  <span className="ar-pill ar-pill-good">✓ All checked</span>
                )}
              </button>
            ))}
          </div>

          <div className="ar-dish-detail">
            {!activeDish ? (
              <p className="muted">Pick a dish to confirm its ingredients together.</p>
            ) : (
              <>
                <h2 style={{ margin: "0 0 4px" }}>{activeDish.recipe.name}</h2>
                <p className="muted" style={{ marginTop: 0 }}>
                  {activeDish.items.length - activeDish.unchecked} of {activeDish.items.length} ingredients confirmed
                  {activeDish.unchecked === 0 && " — this dish can be printed without a † warning."}
                </p>
                <div className="ar-list">
                  {[...activeDish.items]
                    .sort(
                      (a, b) =>
                        Number(a.allergen_review_status === "confirmed") -
                          Number(b.allergen_review_status === "confirmed") || a.name.localeCompare(b.name)
                    )
                    .map((it) =>
                      renderRow(it, { showSelect: false, compact: false, selected: false, onSelect: () => undefined })
                    )}
                </div>
                {activeDish.items.length === 0 && <p className="muted">This dish has no ingredients yet.</p>}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
