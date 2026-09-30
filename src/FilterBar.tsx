import { useEffect, useLayoutEffect, useRef, useState } from "react";

// A faceted filter for a long list -- one icon button opens a list of
// filterable parameters (facets), picking one drills into that facet's own
// checkbox/search panel, and every facet with an active selection also
// shows as a small removable chip next to the icon so it's visible at a
// glance and quick to re-edit (clicking a chip jumps straight to that
// facet's value picker, skipping the parameter list). Replaces the old
// one-button-per-dimension pattern (CategoryFilter.tsx, now retired, since
// this was its only caller) now that Items/Recipes have grown past a
// single filterable dimension.
//
// This component owns selection STATE and the picker UI only -- it has no
// idea what a "category" or "allergen" is. The caller (App.tsx) supplies
// each facet's own option list and, separately, applies each facet's
// selected values as its own filter predicate against the real data (see
// the itemFacets/recipeFacets + .filter() chains in App.tsx). Same
// division of responsibility CategoryFilter already had.
//
// `values[key]` is the same tri-state CategoryFilter used, per facet:
//   - null/undefined -- no filter applied for this facet, everything shown.
//   - string[] (any)  -- explicit selection, including an EMPTY array,
//                        which means "nothing checked" and so nothing
//                        shown for this facet (lets "Clear all" inside a
//                        facet actually clear it, rather than only being
//                        reachable by unchecking every box by hand).
export interface FilterFacetOption {
  value: string;
  label: string;
}

export interface FilterFacet {
  key: string;
  label: string;
  options: FilterFacetOption[];
  // Hidden below this many options in the value picker -- dead weight for
  // a short fixed list (e.g. Food/Drink), essential for a long one (e.g.
  // every item name, for Recipes' "Item used" facet).
  searchThreshold?: number;
}

export type FilterValues = Record<string, string[] | null | undefined>;

interface Props {
  facets: FilterFacet[];
  values: FilterValues;
  onChange: (key: string, next: string[] | null) => void;
}

function selectedFor(values: FilterValues, key: string): string[] | null {
  const v = values[key];
  return v === undefined ? null : v;
}

export default function FilterBar({ facets, values, onChange }: Props) {
  const usableFacets = facets.filter((f) => f.options.length > 0);

  const [open, setOpen] = useState(false);
  // null while showing the facet list; a facet key while drilled into that
  // facet's own value picker.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [panelShiftX, setPanelShiftX] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  // Same edge-of-viewport correction as CategoryFilter.tsx -- see that
  // component's own comment for why this exists (a phone-width header
  // where the trigger sits close to the right edge).
  useLayoutEffect(() => {
    if (!open) return;
    function reposition() {
      const panel = panelRef.current;
      if (!panel) return;
      const margin = 8;
      const rect = panel.getBoundingClientRect();
      setPanelShiftX((prevShift) => {
        const naturalLeft = rect.left - prevShift;
        const naturalRight = rect.right - prevShift;
        const overflowRight = naturalRight + margin - window.innerWidth;
        const overflowLeft = margin - naturalLeft;
        if (overflowRight > 0) return -overflowRight;
        if (overflowLeft > 0) return overflowLeft;
        return 0;
      });
    }
    reposition();
    window.addEventListener("resize", reposition);
    return () => window.removeEventListener("resize", reposition);
  }, [open, activeKey, query]);

  if (usableFacets.length === 0) return null;

  const activeFacet = usableFacets.find((f) => f.key === activeKey) ?? null;
  const activeFacets = usableFacets
    .map((f) => ({ facet: f, selected: selectedFor(values, f.key) }))
    .filter((x): x is { facet: FilterFacet; selected: string[] } => x.selected !== null);

  function openPicker(key: string | null) {
    setQuery("");
    setActiveKey(key);
    setOpen(true);
  }

  function toggleValue(facet: FilterFacet, value: string) {
    const selected = selectedFor(values, facet.key);
    if (selected === null) {
      onChange(facet.key, facet.options.filter((o) => o.value !== value).map((o) => o.value));
      return;
    }
    const next = selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value];
    onChange(facet.key, next.length === facet.options.length ? null : next);
  }

  return (
    <div className="filter-bar" ref={rootRef}>
      <div className="filter-bar-trigger-wrap">
        <button
          type="button"
          className={`btn-ghost small filter-bar-btn ${activeFacets.length > 0 ? "active" : ""}`}
          onClick={() => (open ? setOpen(false) : openPicker(null))}
        >
          ⏷ Filter
          {activeFacets.length > 0 && <span className="filter-bar-count">{activeFacets.length}</span>}
        </button>

        {open && (
          <div
            className="filter-bar-panel"
            ref={panelRef}
            style={panelShiftX ? { transform: `translateX(${panelShiftX}px)` } : undefined}
          >
            {!activeFacet ? (
              <>
                <div className="filter-bar-panel-head">
                  <span>Filter by</span>
                  {activeFacets.length > 0 && (
                    <button
                      type="button"
                      className="filter-bar-link"
                      onClick={() => usableFacets.forEach((f) => onChange(f.key, null))}
                    >
                      Clear all
                    </button>
                  )}
                </div>
                <div className="filter-bar-facet-list">
                  {usableFacets.map((f) => {
                    const selected = selectedFor(values, f.key);
                    return (
                      <button
                        key={f.key}
                        type="button"
                        className="filter-bar-facet-row"
                        onClick={() => openPicker(f.key)}
                      >
                        <span>{f.label}</span>
                        <span className="filter-bar-facet-row-right">
                          {selected !== null && <span className="filter-bar-count">{selected.length}</span>}
                          <span className="filter-bar-caret">›</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <FacetValuePicker
                facet={activeFacet}
                selected={selectedFor(values, activeFacet.key)}
                query={query}
                setQuery={setQuery}
                onBack={() => openPicker(null)}
                onToggle={(value) => toggleValue(activeFacet, value)}
                onSelectAll={() => onChange(activeFacet.key, null)}
                onClearAll={() => onChange(activeFacet.key, [])}
              />
            )}
          </div>
        )}
      </div>

      {activeFacets.map(({ facet, selected }) => {
        const text =
          selected.length === 1
            ? `${facet.label}: ${facet.options.find((o) => o.value === selected[0])?.label ?? selected[0]}`
            : `${facet.label}: ${selected.length}`;
        return (
          <span key={facet.key} className="filter-bar-chip">
            <button type="button" className="filter-bar-chip-label" onClick={() => openPicker(facet.key)}>
              {text}
            </button>
            <button
              type="button"
              className="filter-bar-chip-x"
              aria-label={`Clear ${facet.label} filter`}
              onClick={() => onChange(facet.key, null)}
            >
              ×
            </button>
          </span>
        );
      })}
    </div>
  );
}

function FacetValuePicker({
  facet,
  selected,
  query,
  setQuery,
  onBack,
  onToggle,
  onSelectAll,
  onClearAll,
}: {
  facet: FilterFacet;
  selected: string[] | null;
  query: string;
  setQuery: (q: string) => void;
  onBack: () => void;
  onToggle: (value: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}) {
  const isAll = selected === null;
  const searchThreshold = facet.searchThreshold ?? 8;
  const visibleOptions = query.trim()
    ? facet.options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : facet.options;

  return (
    <>
      <div className="filter-bar-panel-head">
        <button type="button" className="filter-bar-back" onClick={onBack}>
          ‹ {facet.label}
        </button>
        <div className="filter-bar-bulk">
          <button type="button" className="filter-bar-link" onClick={onSelectAll} disabled={isAll}>
            Select all
          </button>
          <button
            type="button"
            className="filter-bar-link"
            onClick={onClearAll}
            disabled={!isAll && selected!.length === 0}
          >
            Clear all
          </button>
        </div>
      </div>
      {facet.options.length > searchThreshold && (
        <div className="filter-bar-search-row">
          <input
            className="filter-bar-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${facet.label.toLowerCase()}…`}
            autoFocus
          />
        </div>
      )}
      <div className="filter-bar-list">
        {visibleOptions.length === 0 && <div className="filter-bar-empty">No matches</div>}
        {visibleOptions.map((opt) => (
          <label key={opt.value} className="filter-bar-item">
            <input type="checkbox" checked={isAll || selected!.includes(opt.value)} onChange={() => onToggle(opt.value)} />
            {opt.label}
          </label>
        ))}
      </div>
    </>
  );
}
