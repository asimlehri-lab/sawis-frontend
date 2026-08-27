// The app's one shared loading visual — a dish cover ("cloche") lifting to
// reveal the plate underneath, on a loop. Replaces plain "Loading…" text
// wherever a moment is prominent enough to deserve it (currently: the
// session-restore splash in App.tsx). `size="compact"` is a smaller inline
// variant meant to sit next to text inside a card/table, rather than as a
// standalone page-level moment — see App.tsx's other `<p className="muted">
// Loading…</p>` spots for candidates if more of them get switched over
// later. Pure CSS/SVG, no assets; respects prefers-reduced-motion (see the
// rig/cloche-* rules in App.css).

interface LoaderProps {
  size?: "full" | "compact";
  label?: string | null;
}

export default function Loader({ size = "full", label = "Loading…" }: LoaderProps) {
  return (
    <div className={`loader-row${size === "compact" ? " compact" : ""}`}>
      <div className={`rig${size === "compact" ? " compact" : ""}`}>
        <svg viewBox="0 0 100 100">
          <ellipse className="shadow-ellipse cloche-shadow" cx="50" cy="76" rx="26" ry="6"></ellipse>
          <line className="surface-line" x1="18" y1="78" x2="82" y2="78"></line>
          <g className="sparkle">
            <line x1="50" y1="58" x2="50" y2="66"></line>
            <line x1="44" y1="62" x2="56" y2="62"></line>
          </g>
          <g className="cloche-group">
            <path className="cloche-body" d="M 26 74 Q 26 34 50 34 Q 74 34 74 74"></path>
            <line className="cloche-body" x1="20" y1="74" x2="80" y2="74"></line>
            <circle className="cloche-knob" cx="50" cy="28" r="4.5"></circle>
            <line className="cloche-body" x1="50" y1="34" x2="50" y2="30"></line>
          </g>
        </svg>
      </div>
      {label && <span className="loading-label">{label}</span>}
    </div>
  );
}
