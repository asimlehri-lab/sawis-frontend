import { useEffect, useMemo, useRef, useState } from "react";
import AllergenIcon from "./AllergenIcon";
import { bulkReviewItems, runAllergenWordList } from "./api";
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
  onOpen: () => void;
}) {
  const mayOnly = draft.may.filter((id) => !draft.contains.includes(id));
  const needsReview = item.allergen_needs_review;
  const pending = item.allergen_suggestions.filter(
    (s) => s.status === "pending" && !(s.level === "contains" ? draft.contains : draft.may).includes(s.allergen)
  );
  const reason = item.allergen_suggestions
    .map((s) => {
      const a = allergens.find((x) => x.id === s.allergen);
      return a ? `${a.name}: ${s.reason}` : null;
    })
    .filter((r): r is string => !!r);
  const nothingTagged = draft.contains.length === 0 && mayOnly.length === 0;

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
          </div>
          {!compact && (
            <div className="ar-tags">
              {allergens
                .filter((a) => draft.contains.includes(a.id))
                .map((a) => (
                  <span key={a.id} className="ar-tag" title={a.name}>
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
              {nothingTagged && pending.length === 0 && <span className="ar-none">No allergens ticked</span>}
            </div>
          )}
          {!compact && reason.length > 0 && needsReview && <div className="ar-reason">{reason.join(" · ")}</div>}
        </div>
        <div className="ar-actions">
          {needsReview && !compact && (
            <button type="button" className="btn-primary small" disabled={busy} onClick={onConfirm}>
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
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [recent, setRecent] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [limitA, setLimitA] = useState(PAGE);
  const [limitB, setLimitB] = useState(PAGE);
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
        r.items_changed === 0
          ? `Checked ${r.items} item names against the word list. None matched, so every item below needs a person's check.`
          : `Checked ${r.items} item names against the word list: ${r.items_changed} matched (${r.tags_added} tag${r.tags_added === 1 ? "" : "s"} added, ${r.suggestions} suggestion${r.suggestions === 1 ? "" : "s"} to look at). Nothing is confirmed until you confirm it.`
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
        setTicked((prev) => new Set([...prev].filter((id) => !ids.has(id))));
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
  const hasSuggestion = (it: CatalogItem) =>
    it.allergens.length > 0 || it.may_contain_allergens.length > 0 || it.allergen_suggestions.length > 0;
  const suggested = needing.filter(hasSuggestion).filter(matches).sort(byUsage);
  const nothing = needing.filter((it) => !hasSuggestion(it)).filter(matches).sort(byUsage);
  const shownA = suggested.slice(0, limitA);
  const shownB = nothing.slice(0, limitB);

  function selectA(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  // Shift-click ticks everything between the last tick and this one, so a
  // long run of obviously-fine items (salt, sugar, water ...) isn't a
  // hundred separate clicks.
  function tickB(id: string, checked: boolean, shift: boolean) {
    setTicked((prev) => {
      const next = new Set(prev);
      const ids = shownB.map((i) => i.id);
      const from = shift && lastTicked ? ids.indexOf(lastTicked) : -1;
      if (from >= 0) {
        const [lo, hi] = [Math.min(from, ids.indexOf(id)), Math.max(from, ids.indexOf(id))];
        ids.slice(lo, hi + 1).forEach((x) => (checked ? next.add(x) : next.delete(x)));
      } else if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
    setLastTicked(id);
  }

  // Ticks everything currently shown, so after searching "syrup" the whole
  // run is one click. Only what is on screen is ticked, never what a
  // person can't see.
  function tickAllShown() {
    setTicked((prev) => new Set([...prev, ...shownB.map((i) => i.id)]));
  }

  // Adds the chosen allergen(s) to every ticked item and confirms them.
  // Anything already tagged on the item is kept.
  function applyBulkAllergen() {
    if (bulkPick.length === 0) return;
    const reviews = [...ticked].map((id) => {
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

  const hiddenTicked = [...ticked].filter((id) => !shownB.some((i) => i.id === id)).length;

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
      <div className="content-head" style={{ marginBottom: 6 }}>
        <h1 className="page-title">Review allergens</h1>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        {needing.length === 0
          ? "Every item's allergens have been confirmed."
          : `${doneCount} of ${total} items confirmed — ${needing.length} still to check.`}{" "}
        A confirmed item with no tags means “reviewed, no allergens”. An item you haven't confirmed is never treated as
        allergen-free.
      </p>
      <div className="ar-progress" aria-hidden="true">
        <span style={{ width: `${total ? Math.round((doneCount / total) * 100) : 0}%` }} />
      </div>
      {(needing.length > 0 || checkNote) && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 10 }}>
          <button className="btn-ghost small" onClick={() => void runCheck()} disabled={checking}>
            {checking ? "Checking item names…" : "Suggest from item names"}
          </button>
          <span className="hint" style={{ margin: 0, flex: "1 1 260px" }}>
            {checking
              ? "Reading every item name against the word list…"
              : (checkNote ?? "Reads every item name and suggests allergens it recognises, such as milk in “Milk Syrup”.")}
          </span>
        </div>
      )}

      <div className="rtabs" style={{ marginTop: 14 }}>
        <button className={`rtab ${tab === "queue" ? "on" : ""}`} onClick={() => setTab("queue")}>
          Queue ({needing.length})
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

          {suggested.length > 0 && (
            <section className="ar-section">
              <div className="ar-section-head">
                <h2>Found from the item name ({suggested.length})</h2>
                <label className="ar-all">
                  <input
                    type="checkbox"
                    checked={shownA.length > 0 && shownA.every((i) => selected.has(i.id))}
                    onChange={(e) => setSelected(e.target.checked ? new Set(shownA.map((i) => i.id)) : new Set())}
                  />
                  Select all shown
                </label>
              </div>
              <p className="hint">
                Tags came from the word list. Tap “Looks right” if they're correct, tap a “+ …?” suggestion to add it,
                or open Edit. Tick several and confirm them together.
              </p>
              <div className="ar-list">
                {shownA.map((it) =>
                  renderRow(it, {
                    showSelect: true,
                    compact: false,
                    selected: selected.has(it.id),
                    onSelect: (c) => selectA(it.id, c),
                  })
                )}
              </div>
              {suggested.length > shownA.length && (
                <button type="button" className="btn-ghost small" onClick={() => setLimitA(limitA + PAGE)}>
                  Show {Math.min(PAGE, suggested.length - shownA.length)} more
                </button>
              )}
              {selected.size > 0 && (
                <div className="ar-bar">
                  <span>{selected.size} ticked</span>
                  <button
                    type="button"
                    className="btn-primary small"
                    disabled={busy}
                    onClick={() => {
                      const picked = suggested.filter((i) => selected.has(i.id));
                      confirm(
                        picked.map((it) => {
                          const d = draftOf(it);
                          return {
                            id: it.id,
                            allergens: d.contains,
                            may_contain_allergens: d.may.filter((id) => !d.contains.includes(id)),
                          };
                        })
                      );
                    }}
                  >
                    {busy ? "Saving…" : `Confirm ${selected.size} as shown`}
                  </button>
                </div>
              )}
            </section>
          )}

          {nothing.length > 0 && (
            <section className="ar-section">
              <div className="ar-section-head">
                <h2>Nothing found from the name ({nothing.length})</h2>
                {q && shownB.length > 0 && (
                  <button type="button" className="btn-ghost small" onClick={tickAllShown} disabled={busy}>
                    Tick all {shownB.length} shown
                  </button>
                )}
              </div>
              <p className="hint">
                These names didn't match the word list. That does <b>not</b> mean they're allergen-free — you know the
                product, SAWIS doesn't. Tick the ones you want to handle together (shift-click ticks a run; search for a
                word like “syrup” to tick everything matching it). Then confirm them as “no allergens”, or add an
                allergen to all of them. Or open Edit to tag one on its own.
              </p>
              <div className="ar-list">
                {shownB.map((it) =>
                  renderRow(it, {
                    showSelect: true,
                    compact: true,
                    selected: ticked.has(it.id),
                    onSelect: (c, shift) => tickB(it.id, c, shift),
                  })
                )}
              </div>
              {nothing.length > shownB.length && (
                <button type="button" className="btn-ghost small" onClick={() => setLimitB(limitB + PAGE)}>
                  Show {Math.min(PAGE, nothing.length - shownB.length)} more
                </button>
              )}
              {ticked.size > 0 && (
                <div className="ar-bulk-wrap">
                  {bulkOpen && (
                    <div className="ar-bulk" role="group" aria-label="Add an allergen to the ticked items">
                      <div className="ar-bulk-title">
                        Add to {ticked.size} ticked {ticked.size === 1 ? "item" : "items"}
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
                          {busy ? "Saving…" : `Add and confirm ${ticked.size}`}
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="ar-bar">
                    <span>
                      {ticked.size} ticked
                      {hiddenTicked > 0 && ` (${hiddenTicked} hidden by your search)`}
                    </span>
                    <div className="ar-bar-actions">
                      <button
                        type="button"
                        className="ar-bar-link"
                        disabled={busy}
                        onClick={() => {
                          setTicked(new Set());
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
                      <button
                        type="button"
                        className="btn-primary small"
                        disabled={busy}
                        onClick={() =>
                          confirm(
                            [...ticked].map((id) => ({ id, allergens: [], may_contain_allergens: [] }))
                          )
                        }
                      >
                        {busy ? "Saving…" : `Confirm ${ticked.size}: no allergens`}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {recentItems.length > 0 && (
            <section className="ar-section">
              <div className="ar-section-head">
                <h2>Just confirmed</h2>
              </div>
              <p className="hint">Made a mistake? Open Edit to change it.</p>
              <div className="ar-list">
                {recentItems.map((it) =>
                  renderRow(it, { showSelect: false, compact: true, selected: false, onSelect: () => undefined })
                )}
              </div>
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
