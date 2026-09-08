import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface SearchSelectOption {
  value: string;
  label: string;
  // Shown dimmed after the label (e.g. a price or unit) — not matched
  // against when typing to search, same as a native <option>'s text
  // wouldn't be split into "searchable" vs "decorative" parts either, but
  // keeping it separate here lets the search focus on the name.
  sublabel?: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: SearchSelectOption[];
  placeholder?: string;
  // Extra rows pinned above the (filtered) option list, always visible
  // regardless of what's typed -- e.g. "+ Add new item…". Selecting one
  // calls onChange with its value exactly like a normal option; the
  // caller decides what that value means (a real id, or a sentinel like
  // "__new__" it special-cases in its own onChange handler).
  pinnedOptions?: SearchSelectOption[];
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  emptyText?: string;
  "aria-label"?: string;
}

// A dropdown that behaves like a native <select> -- click to open, pick an
// option, closed state shows the picked label -- but opens onto a text
// filter first so a long list (200+ items/recipes) can be narrowed by
// typing instead of scrolled. Built plain (no library) to match this
// codebase's existing modals/pickers.
//
// The option panel renders through a portal into document.body, positioned
// with `fixed` coordinates computed from the toggle button, rather than as
// a normal absolutely-positioned child. This matters because this control
// gets used inside places that scroll their own content (the "Import menu
// list" modal's row list, the Scan receipt table's horizontal-scroll
// wrapper) -- a plain absolutely-positioned panel would get silently
// clipped by those ancestors' overflow, which is exactly the kind of bug
// that's easy to miss in a quick look but shows up the first time someone
// opens the picker on a row near the bottom of a long scrolled list.
export default function SearchSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  pinnedOptions = [],
  disabled = false,
  className,
  style,
  emptyText = "No matches",
  "aria-label": ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0, width: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value) ?? pinnedOptions.find((o) => o.value === value);

  function updatePanelPos() {
    const el = toggleRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPanelPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 220) });
  }

  // Opens the panel -- resets the filter/highlight synchronously (as part
  // of the same click/keypress that triggers it, not as an effect reacting
  // to `open` afterwards) and positions it against the toggle's current
  // screen location before it's shown.
  function openPanel() {
    setQuery("");
    setHighlight(0);
    updatePanelPos();
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
      setQuery("");
    }
    // Capture phase so a scroll on any ancestor container -- not just the
    // window -- keeps the panel glued to the toggle instead of drifting
    // off it (see the portal note above for why this matters here).
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("scroll", updatePanelPos, true);
    window.addEventListener("resize", updatePanelPos);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("scroll", updatePanelPos, true);
      window.removeEventListener("resize", updatePanelPos);
    };
  }, [open]);

  // Focusing is a genuine side effect on an external system (the DOM) that
  // only makes sense once the portal has actually mounted the input, so
  // this is the one piece that stays in an effect rather than moving into
  // openPanel() above.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const flatList = useMemo(() => [...pinnedOptions, ...filtered], [pinnedOptions, filtered]);

  function commit(val: string) {
    onChange(val);
    setOpen(false);
    setQuery("");
  }

  function handleToggleKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!open && (e.key === "Enter" || e.key === "ArrowDown" || e.key === " ")) {
      e.preventDefault();
      openPanel();
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  function handleListKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQuery("");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, flatList.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = flatList[highlight];
      if (opt) commit(opt.value);
    }
  }

  return (
    <div
      className={`search-select${disabled ? " disabled" : ""}${className ? ` ${className}` : ""}`}
      style={style}
      ref={rootRef}
    >
      <button
        type="button"
        ref={toggleRef}
        className="search-select-toggle"
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openPanel())}
        onKeyDown={handleToggleKeyDown}
      >
        <span className={selected ? "search-select-value" : "search-select-placeholder"}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="search-select-caret">▾</span>
      </button>

      {open &&
        !disabled &&
        createPortal(
          <div
            ref={panelRef}
            className="search-select-panel"
            style={{ position: "fixed", top: panelPos.top, left: panelPos.left, width: panelPos.width }}
          >
            <input
              ref={inputRef}
              type="text"
              className="search-select-input"
              placeholder="Type to search…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlight(0);
              }}
              onKeyDown={handleListKeyDown}
            />
            <div className="search-select-list">
              {pinnedOptions.map((o, idx) => (
                <div
                  key={o.value}
                  className={`search-select-option pinned${idx === highlight ? " highlighted" : ""}${
                    o.value === value ? " selected" : ""
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(o.value);
                  }}
                  onMouseEnter={() => setHighlight(idx)}
                >
                  {o.label}
                  {o.sublabel && <span className="search-select-sub">{o.sublabel}</span>}
                </div>
              ))}
              {filtered.length === 0 ? (
                <div className="search-select-empty">{emptyText}</div>
              ) : (
                filtered.map((o, i) => {
                  const idx = pinnedOptions.length + i;
                  return (
                    <div
                      key={o.value}
                      className={`search-select-option${idx === highlight ? " highlighted" : ""}${
                        o.value === value ? " selected" : ""
                      }`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        commit(o.value);
                      }}
                      onMouseEnter={() => setHighlight(idx)}
                    >
                      {o.label}
                      {o.sublabel && <span className="search-select-sub">{o.sublabel}</span>}
                    </div>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
