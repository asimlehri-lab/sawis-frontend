import { useEffect, useRef } from "react";
import type { Location } from "./api";
import { ALL_LOCATIONS } from "./locationScope";

// Which location a page is about. Replaces the location drop-downs on End of
// day and Reports: a row of tabs, one per location, with an "All" tab for
// managers who can see more than one. With a single location there is nothing
// to choose, so it shows a plain label. The chosen tab slides into view when
// the row is wider than the screen.

const Pin = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </svg>
);

const Grid = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </svg>
);

interface Props {
  locations: Location[];
  value: string;
  onChange: (id: string) => void;
  allowAll?: boolean;
}

export default function LocationTabs({ locations, value, onChange, allowAll }: Props) {
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    try {
      activeRef.current?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    } catch {
      /* older browsers: the tab is still selected */
    }
  }, [value]);

  if (locations.length === 0) return null;
  if (locations.length === 1) {
    return (
      <div className="lwhere">
        <Pin />
        {locations[0].name}
      </div>
    );
  }

  const ids = [...(allowAll ? [ALL_LOCATIONS] : []), ...locations.map((l) => l.id)];

  function onKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = ids.indexOf(value);
    const next = ids[(i + (e.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length];
    onChange(next);
  }

  return (
    <div className="lbar" role="tablist" aria-label="Location" onKeyDown={onKey}>
      {allowAll && (
        <button
          type="button"
          role="tab"
          aria-selected={value === ALL_LOCATIONS}
          tabIndex={value === ALL_LOCATIONS ? 0 : -1}
          ref={value === ALL_LOCATIONS ? activeRef : undefined}
          className={`ltab all${value === ALL_LOCATIONS ? " on" : ""}`}
          onClick={() => onChange(ALL_LOCATIONS)}
        >
          <Grid />
          All
        </button>
      )}
      {locations.map((l) => (
        <button
          key={l.id}
          type="button"
          role="tab"
          aria-selected={value === l.id}
          tabIndex={value === l.id ? 0 : -1}
          ref={value === l.id ? activeRef : undefined}
          className={`ltab${value === l.id ? " on" : ""}`}
          onClick={() => onChange(l.id)}
        >
          <Pin />
          {l.name}
        </button>
      ))}
    </div>
  );
}
