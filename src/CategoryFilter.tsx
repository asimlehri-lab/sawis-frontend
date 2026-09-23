import { useEffect, useRef, useState } from "react";

// A compact multi-select filter, used on the Items and Recipes list headers
// so a long list can be narrowed down by category -- same anchored-popover
// pattern as NotificationBell.tsx (a rootRef + a document "mousedown"
// listener that closes the panel on an outside click, rather than a full
// .modal-backdrop dialog, since this is a quick filter control, not a form).
//
// `selected` is deliberately just an array of option values, and an EMPTY
// array means "no filter applied / show everything" -- not "nothing
// selected" -- per the explicit UX call this was built to ("Should be
// default as all"). Every checkbox therefore renders as checked whenever
// `selected` is empty (the "implied all" state); unchecking one from there
// switches to an explicit list of every other option, rather than trying
// to represent "nothing selected" as its own state -- narrowing down is
// the whole point of this control, hiding every row is not a case it needs
// to support.
export interface CategoryFilterOption {
  value: string;
  label: string;
}

interface Props {
  options: CategoryFilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  // Plain label for the trigger button, e.g. "Category" -- kept generic so
  // this same component works for both the Items list (real Category rows)
  // and the Recipes list (the freeform menu_category string), which have
  // different underlying data.
  label?: string;
}

export default function CategoryFilter({ options, selected, onChange, label = "Category" }: Props) {
  const [open, setOpen] = useState(false);
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

  const allChecked = selected.length === 0;

  function toggle(value: string) {
    if (allChecked) {
      // Coming from the implied "everything shown" state -- unchecking one
      // box means "everything except this one", made explicit.
      onChange(options.filter((o) => o.value !== value).map((o) => o.value));
    } else {
      const next = selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value];
      // If that leaves every option checked again, collapse back to the
      // empty/"all" state rather than carrying an explicit full list around.
      onChange(next.length === options.length ? [] : next);
    }
  }

  return (
    <div className="cat-filter" ref={rootRef}>
      <button
        type="button"
        className={`btn-ghost small cat-filter-btn ${selected.length > 0 ? "active" : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
        {selected.length > 0 && <span className="cat-filter-count">{selected.length}</span>}
        <span className="cat-filter-caret">▾</span>
      </button>
      {open && (
        <div className="cat-filter-panel">
          <div className="cat-filter-panel-head">
            <span>{label}</span>
            <button type="button" className="cat-filter-link" onClick={() => onChange([])} disabled={allChecked}>
              Select all
            </button>
          </div>
          <div className="cat-filter-list">
            {options.map((opt) => (
              <label key={opt.value} className="cat-filter-item">
                <input type="checkbox" checked={allChecked || selected.includes(opt.value)} onChange={() => toggle(opt.value)} />
                {opt.label}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
