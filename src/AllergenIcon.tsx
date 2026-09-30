import type { CSSProperties, JSX } from "react";

// One hand-drawn line icon per EU/UK major allergen (see Allergen model
// on the backend) -- a small, deliberately consistent family: 24x24
// viewBox, stroke-only (currentColor), 1.6 stroke width, rounded caps/
// joins, filled dots only for texture (seeds, an eye). Keyed by the
// backend's stable Allergen.code -- see that model's own docstring
// warning never to rename a code once shipped.
const ICON_PATHS: Record<string, JSX.Element> = {
  gluten: (
    <>
      <line x1="12" y1="3" x2="12" y2="21" />
      <path d="M12 5c1.5 0 2.5 1 2.5 2.5S13.5 10 12 10" />
      <path d="M12 5c-1.5 0-2.5 1-2.5 2.5S10.5 10 12 10" />
      <path d="M12 9c1.5 0 2.5 1 2.5 2.5S13.5 14 12 14" />
      <path d="M12 9c-1.5 0-2.5 1-2.5 2.5S10.5 14 12 14" />
      <path d="M12 13c1.5 0 2.5 1 2.5 2.5S13.5 18 12 18" />
      <path d="M12 13c-1.5 0-2.5 1-2.5 2.5S10.5 18 12 18" />
    </>
  ),
  crustaceans: (
    <>
      <path d="M8 16c-2-3-1-9 4-11 4-1.5 8 1 8 5 0 3-2 5-5 5" />
      <path d="M15 15c1 1.5 1 3.5 0 5" />
      <path d="M7 15l-2 1M7 17.5l-2 .5M8.5 19.5L7 21" />
      <circle cx="17" cy="8" r="0.7" fill="currentColor" stroke="none" />
    </>
  ),
  eggs: <path d="M12 3C8 8 6 13 6 16.5a6 6 0 0 0 12 0C18 13 16 8 12 3Z" />,
  fish: (
    <>
      <path d="M3 12c3-4 8-6 12-4 2 1 4 3 5 4-1 1-3 3-5 4-4 2-9 0-12-4Z" />
      <circle cx="8" cy="11" r="0.7" fill="currentColor" stroke="none" />
      <path d="M20 12l2-3M20 12l2 3" />
    </>
  ),
  peanuts: (
    <path d="M12 2c-2.5 0-4 2-4 4.5 0 1.8.9 2.8 1.8 3.5-.9.7-1.8 1.7-1.8 3.5 0 2.5 1.5 4.5 4 4.5s4-2 4-4.5c0-1.8-.9-2.8-1.8-3.5.9-.7 1.8-1.7 1.8-3.5 0-2.5-1.5-4.5-4-4.5Z" />
  ),
  soybeans: (
    <>
      <path d="M8 4c-3 2-4 6-3 10s5 7 9 7c1.5 0 2.5-1 2.5-2.5 0-4-2-9-5.5-13C10 4.3 9 4 8 4Z" />
      <circle cx="9.5" cy="9" r="1" fill="currentColor" stroke="none" />
      <circle cx="11.5" cy="13.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="14" cy="17.5" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  milk: (
    <>
      <path d="M10 3h4v3l2 3v10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V9l2-3Z" />
      <line x1="8.5" y1="13" x2="15.5" y2="13" />
    </>
  ),
  tree_nuts: (
    <>
      <path d="M12 3c3 0 5 3 5 7 0 6-3 11-5 11S7 16 7 10c0-4 2-7 5-7Z" />
      <path d="M8.5 7c1 .8 2.2 1.2 3.5 1.2S14.5 7.8 15.5 7" />
    </>
  ),
  celery: (
    <>
      <rect x="6.5" y="9" width="2.4" height="12" rx="1.2" />
      <rect x="10.8" y="6" width="2.4" height="15" rx="1.2" />
      <rect x="15.1" y="9" width="2.4" height="12" rx="1.2" />
      <path d="M9 6c1-1.5 2-2 3-2s2 .5 3 2" />
    </>
  ),
  mustard: (
    <>
      <path d="M8 10V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v4" />
      <path d="M7 10h10l-1 10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2L7 10Z" />
      <circle cx="10.5" cy="14" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="13.5" cy="15" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="12" cy="17.5" r="0.7" fill="currentColor" stroke="none" />
    </>
  ),
  sesame: (
    <>
      <ellipse cx="7" cy="8" rx="2.2" ry="1.3" transform="rotate(-25 7 8)" />
      <ellipse cx="16" cy="7" rx="2.2" ry="1.3" transform="rotate(20 16 7)" />
      <ellipse cx="9" cy="16" rx="2.2" ry="1.3" transform="rotate(-15 9 16)" />
      <ellipse cx="17" cy="15.5" rx="2.2" ry="1.3" transform="rotate(30 17 15.5)" />
    </>
  ),
  sulphites: (
    <>
      <path d="M8 3h8l-.5 6a3.5 3.5 0 0 1-7 0L8 3Z" />
      <line x1="12" y1="12.5" x2="12" y2="18" />
      <line x1="9" y1="21" x2="15" y2="21" />
    </>
  ),
  lupin: (
    <>
      <line x1="12" y1="21" x2="12" y2="11" />
      <ellipse cx="12" cy="8" rx="1.6" ry="2" />
      <ellipse cx="9" cy="12" rx="1.8" ry="1.1" transform="rotate(-25 9 12)" />
      <ellipse cx="15" cy="12" rx="1.8" ry="1.1" transform="rotate(25 15 12)" />
      <ellipse cx="9.5" cy="15.5" rx="1.8" ry="1.1" transform="rotate(-25 9.5 15.5)" />
      <ellipse cx="14.5" cy="15.5" rx="1.8" ry="1.1" transform="rotate(25 14.5 15.5)" />
    </>
  ),
  molluscs: (
    <>
      <path d="M12 3c4 3 8 7 8 12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1c0-5 4-9 8-12Z" />
      <path d="M12 3v16M9 5.5V16M15 5.5V16M7 8V16M17 8V16" />
    </>
  ),
};

// Generic fallback for a code the frontend doesn't recognize yet (e.g.
// this app is mid-deploy against a newer backend that added a 15th
// allergen) -- a plain warning triangle rather than a blank/broken icon.
const FALLBACK = <path d="M12 3 2 20h20L12 3Z M12 9v5 M12 17h.01" />;

interface Props {
  code: string;
  size?: number;
  style?: CSSProperties;
  className?: string;
}

export default function AllergenIcon({ code, size = 18, style, className }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      className={className}
      aria-hidden="true"
    >
      {ICON_PATHS[code] ?? FALLBACK}
    </svg>
  );
}
