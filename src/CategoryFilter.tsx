import { useEffect, useRef, useState } from "react";

// A compact multi-select filter, used on the Items and Recipes list headers
// so a long list can be narrowed down by category -- same anchored-popover
// pattern as NotificationBell.tsx (a rootRef + a document "mousedown"
// listener that closes the panel on an outside click, rather than a full
// .modal-backdrop dialog, since this is a quick filter control, not a form).
//
// `selected` is a genuine tri-state, not just an array, so "no filter yet"
// and "the user explicitly cleared every box" can both be represented:
//   - null            -- default, no filter applied, every category shown.
//   - string[] (any)  -- explicit selection, including an EMPTY array,
//                        which means "nothing checked" and so nothing
//                        shown. This is what lets "Clear all" actually
//                        clear the list, e.g. as a fast way to blank the
//                        board before picking just one or two categories
//                        out of a long list, rather than having to
//                        uncheck everything else one at a time.
export interface CategoryFilterOption {
  value: string;
  label: string;
}

interface Props {
  options: CategoryFilterOption[];
  selected: string[] | null;
  onChange: (next: string[] | null) => void;
  // Plain label for the trigger button, e.g. "Category" -- kept generic so
  // this same component works for both the Items list (real Category rows)
  // and the Recipes list (the freeform menu_category string), which have
  // different underlying data.
  label?: string;
  // Below this many options, the in-panel search box is hidden -- it's
  // dead weight when there are only a handful of checkboxes to scan.
  searchThreshold?: number;
}

export default function CategoryFilter({
  options,
  selected,
  onChange,
  label = "Category",
  searchThreshold = 8,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  // Nothing to filter by (e.g. no categories set up yet) -- don't show a
  // control with an empty, useless dropdown.
  if (options.length === 0) return null;

  const isAll = selected === null;
  const visibleOptions = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  function toggle(value: string) {
    if (isAll) {
      // Coming from the implied "everything shown" state -- unchecking one
      // box means "everything except this one", made explicit.
      onChange(options.filter((o) => o.value !== value).map((o) => o.value));
      return;
    }
    const current = selected as string[];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    // If that leaves every option checked again, collapse back to the
    // simple "no filter" state rather than carrying an explicit full list.
    onChange(next.length === options.length ? null : next);
  }

  return (
    <div className="cat-filter" ref={rootRef}>
      <button
        type="button"
        className={`btn-ghost small cat-filter-btn ${!isAll ? "active" : ""}`}
        onClick={() => {
          // Clear any leftover search text on every open/close, rather than
          // leaving a stale query hiding options the next time this opens.
          setQuery("");
          setOpen((o) => !o);
        }}
      >
        {label}
        {!isAll && <span className="cat-filter-count">{selected!.length}</span>}
        <span className="cat-filter-caret">▾</span>
      </button>
      {open && (
        <div className="cat-filter-panel">
          <div className="cat-filter-panel-head">
            <span>{label}</span>
            <div className="cat-filter-bulk">
              <button type="button" className="cat-filter-link" onClick={() => onChange(null)} disabled={isAll}>
                Select all
              </button>
              <button
                type="button"
                className="cat-filter-link"
                onClick={() => onChange([])}
                disabled={!isAll && selected!.length === 0}
              >
                Clear all
              </button>
            </div>
          </div>
          {options.length > searchThreshold && (
            <div className="cat-filter-search-row">
              <input
                className="cat-filter-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search categories…"
                autoFocus
              />
            </div>
          )}
          <div className="cat-filter-list">
            {visibleOptions.length === 0 && <div className="cat-filter-empty">No matching categories</div>}
            {visibleOptions.map((opt) => (
              <label key={opt.value} className="cat-filter-item">
                <input type="checkbox" checked={isAll || selected!.includes(opt.value)} onChange={() => toggle(opt.value)} />
                {opt.label}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
