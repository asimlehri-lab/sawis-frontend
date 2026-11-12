import type { CSSProperties } from "react";

// One coloured icon per EU/UK major allergen (see the Allergen model on the
// backend): flat shapes with a darker outline, drawn on a 24x24 grid so they
// stay readable from 14px chips up to a big print card. Keyed by the backend's
// stable Allergen.code -- never rename a code once shipped. The markup below is
// fixed text written here, never user data. On a black-and-white print the
// stylesheet turns them grey; the allergen's name is always printed next to
// the icon, so colour is never the only signal.
const ICONS: Record<string, string> = {
  gluten: "<path d=\"M12 21V10\" stroke=\"#9A6B2A\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/><ellipse cx=\"12\" cy=\"3.6\" rx=\"1.7\" ry=\"2.5\" fill=\"#E8B13A\" stroke=\"#B5801C\" stroke-width=\"1\"/><ellipse cx=\"8.8\" cy=\"7\" rx=\"1.7\" ry=\"2.7\" transform=\"rotate(-38 8.8 7)\" fill=\"#E8B13A\" stroke=\"#B5801C\" stroke-width=\"1\"/><ellipse cx=\"15.2\" cy=\"7\" rx=\"1.7\" ry=\"2.7\" transform=\"rotate(38 15.2 7)\" fill=\"#E8B13A\" stroke=\"#B5801C\" stroke-width=\"1\"/><ellipse cx=\"8.8\" cy=\"11.4\" rx=\"1.7\" ry=\"2.7\" transform=\"rotate(-38 8.8 11.4)\" fill=\"#F0C455\" stroke=\"#B5801C\" stroke-width=\"1\"/><ellipse cx=\"15.2\" cy=\"11.4\" rx=\"1.7\" ry=\"2.7\" transform=\"rotate(38 15.2 11.4)\" fill=\"#F0C455\" stroke=\"#B5801C\" stroke-width=\"1\"/><ellipse cx=\"9.6\" cy=\"15.6\" rx=\"1.5\" ry=\"2.4\" transform=\"rotate(-38 9.6 15.6)\" fill=\"#E8B13A\" stroke=\"#B5801C\" stroke-width=\"1\"/><ellipse cx=\"14.4\" cy=\"15.6\" rx=\"1.5\" ry=\"2.4\" transform=\"rotate(38 14.4 15.6)\" fill=\"#E8B13A\" stroke=\"#B5801C\" stroke-width=\"1\"/>",
  crustaceans: "<path d=\"M5.5 8.5c2.6-3.4 9.2-3.6 11.6 1.2 1.6 3.3.2 7-3.4 8.4\" stroke=\"#C9452B\" stroke-width=\"4.4\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M5.5 8.5c2.6-3.4 9.2-3.6 11.6 1.2 1.6 3.3.2 7-3.4 8.4\" stroke=\"#F0704D\" stroke-width=\"3\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M12.8 18.6l-1.2 3 3.6-.8 3-2.2-2.6-1.2z\" fill=\"#F0704D\" stroke=\"#C9452B\" stroke-width=\"1\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M5.6 7.6L3 5M7 6.6L5.6 3.4\" stroke=\"#C9452B\" stroke-width=\"1.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/><path d=\"M9 13.2l-2.2 1.6M11.6 15l-1.8 2\" stroke=\"#C9452B\" stroke-width=\"1.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/><circle cx=\"8\" cy=\"8.2\" r=\"1\" fill=\"#fff\"/><circle cx=\"8.2\" cy=\"8.3\" r=\".45\" fill=\"#2B1B17\"/>",
  eggs: "<path d=\"M4.6 11c0-4 3.2-7 7.6-7 4.8 0 7.6 2.8 7.6 6.4 0 2.4-1.2 3.4-1.2 5.2 0 2.8-2.8 5.6-6.4 5.6-3.6 0-5.6-2.2-5.6-4.6 0-1.6-2-2.2-2-5.6z\" fill=\"#FFFFFF\" stroke=\"#C4AE82\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><circle cx=\"12.4\" cy=\"11.8\" r=\"3.6\" fill=\"#F7B92B\" stroke=\"#D68A0C\" stroke-width=\"1.2\"/><circle cx=\"11.2\" cy=\"10.6\" r=\"1\" fill=\"#FFE08A\"/>",
  fish: "<path d=\"M2.6 12c3-4.4 8-6 12.2-3.8 1.6.8 3.2 2.2 4 3.8-.8 1.6-2.4 3-4 3.8C10.6 18 5.6 16.4 2.6 12z\" fill=\"#5BA8E8\" stroke=\"#2F6FB0\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M19 12l3-3.4v6.8z\" fill=\"#5BA8E8\" stroke=\"#2F6FB0\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M10.4 8.6c1 2.2 1 4.6 0 6.8\" stroke=\"#2F6FB0\" stroke-width=\"1.2\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><circle cx=\"6.4\" cy=\"11\" r=\"1.1\" fill=\"#fff\"/><circle cx=\"6.5\" cy=\"11\" r=\".5\" fill=\"#12304F\"/>",
  peanuts: "<path d=\"M12 2.2c-2.8 0-4.6 2-4.6 4.6 0 1.8.9 2.7 1.9 3.4-1 .7-1.9 1.7-1.9 3.5 0 3 1.9 5.5 4.6 5.5s4.6-2.5 4.6-5.5c0-1.8-.9-2.8-1.9-3.5 1-.7 1.9-1.6 1.9-3.4 0-2.6-1.8-4.6-4.6-4.6z\" fill=\"#E2B070\" stroke=\"#9A6A32\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\" transform=\"rotate(35 12 12)\"/><g fill=\"#B9803F\" transform=\"rotate(35 12 12)\"><circle cx=\"10.6\" cy=\"6\" r=\".7\"/><circle cx=\"13.4\" cy=\"7.6\" r=\".7\"/><circle cx=\"10.4\" cy=\"14.4\" r=\".7\"/><circle cx=\"13.2\" cy=\"16.4\" r=\".7\"/><circle cx=\"12\" cy=\"11.9\" r=\".7\"/></g>",
  soybeans: "<path d=\"M4.2 17.6C2.8 12 6.6 5.6 13 4c3-.7 6 .3 7.2 2.4C21 9 18 14.6 12.8 18c-3 1.8-7.4 2.2-8.6-.4z\" fill=\"#8CC152\" stroke=\"#4E8A26\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><circle cx=\"8.6\" cy=\"14\" r=\"2.2\" fill=\"#C9E69B\" stroke=\"#6AA23A\" stroke-width=\"1\"/><circle cx=\"12.8\" cy=\"10.8\" r=\"2.2\" fill=\"#C9E69B\" stroke=\"#6AA23A\" stroke-width=\"1\"/><circle cx=\"16.8\" cy=\"7.6\" r=\"1.9\" fill=\"#C9E69B\" stroke=\"#6AA23A\" stroke-width=\"1\"/>",
  milk: "<path d=\"M8 2.8h8l2 3.6H6z\" fill=\"#5B8DEF\" stroke=\"#2F57B8\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M6 6.4h12v13.2a1.6 1.6 0 0 1-1.6 1.6H7.6A1.6 1.6 0 0 1 6 19.6z\" fill=\"#FFFFFF\" stroke=\"#2F57B8\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M12 10.2c1.6 1.8 2.6 3 2.6 4.2a2.6 2.6 0 0 1-5.2 0c0-1.2 1-2.4 2.6-4.2z\" fill=\"#5B8DEF\"/>",
  tree_nuts: "<path d=\"M12 2.4c4.4 3.2 6.8 7.6 6.8 11.6 0 4.2-3 7.6-6.8 7.6S5.2 18.2 5.2 14c0-4 2.4-8.4 6.8-11.6z\" fill=\"#D9A066\" stroke=\"#8F5C2B\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M8.8 13.4c.3 2.8 1.6 4.4 3.2 5\" stroke=\"#F0CFA0\" stroke-width=\"1.5\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M12 5.4c-1.2 2-1.8 3.6-1.8 5\" stroke=\"#8F5C2B\" stroke-width=\"1.1\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  celery: "<path d=\"M6.6 21L5.8 10c-.1-1.4 2.2-1.4 2.3 0l1 11z\" fill=\"#A9D36A\" stroke=\"#5C9A2A\" stroke-width=\"1.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M17.4 21l.8-11c.1-1.4-2.2-1.4-2.3 0l-1 11z\" fill=\"#A9D36A\" stroke=\"#5C9A2A\" stroke-width=\"1.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M10.2 21L9.8 7c0-1.8 4.4-1.8 4.4 0l-.4 14z\" fill=\"#8CC152\" stroke=\"#4E8A26\" stroke-width=\"1.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M4.6 9c-.8-2 .6-3.6 2-3.4 0 1.6-.8 2.8-2 3.4zM19.4 9c.8-2-.6-3.6-2-3.4 0 1.6.8 2.8 2 3.4zM9.6 5.6c-.6-2 .2-3.4 1.6-3.4.6 1.4.2 2.6-1.6 3.4zM14.4 5.6c.6-2-.2-3.4-1.6-3.4-.6 1.4-.2 2.6 1.6 3.4z\" fill=\"#5C9A2A\"/>",
  mustard: "<rect x=\"7.6\" y=\"2.6\" width=\"8.8\" height=\"4\" rx=\"1.2\" fill=\"#8F5C2B\" stroke=\"#6B4118\" stroke-width=\"1.2\"/><path d=\"M6.4 8.4a1.8 1.8 0 0 1 1.8-1.8h7.6a1.8 1.8 0 0 1 1.8 1.8v10.4a2.4 2.4 0 0 1-2.4 2.4H8.8a2.4 2.4 0 0 1-2.4-2.4z\" fill=\"#F5C93A\" stroke=\"#B58A0C\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><rect x=\"8.4\" y=\"11\" width=\"7.2\" height=\"5.6\" rx=\"1\" fill=\"#FFF3C2\" stroke=\"#B58A0C\" stroke-width=\"1\"/><g fill=\"#B58A0C\"><circle cx=\"10.4\" cy=\"13\" r=\".7\"/><circle cx=\"13.2\" cy=\"12.6\" r=\".7\"/><circle cx=\"12\" cy=\"15\" r=\".7\"/><circle cx=\"14.2\" cy=\"15\" r=\".6\"/></g>",
  sesame: "<g fill=\"#F6E6B8\" stroke=\"#A98A44\" stroke-width=\"1.2\"><path d=\"M6 5c2.2-1.2 4.4.8 3.4 3.2C8.2 10.6 4.6 9 6 5z\" transform=\"rotate(-15 7 7)\"/><path d=\"M14.6 3.8c2.4-.8 4.2 1.6 2.8 3.6-1.4 2-4.8.8-2.8-3.6z\" transform=\"rotate(25 16 6)\"/><path d=\"M4 14c2.2-1.2 4.4.8 3.4 3.2C6.2 19.6 2.6 18 4 14z\" transform=\"rotate(20 5 16)\"/><path d=\"M11.4 11.6c2.4-1 4.4 1.2 3.2 3.4-1.2 2.4-5 1-3.2-3.4z\" transform=\"rotate(-30 12.5 13.4)\"/><path d=\"M17.6 14.6c2.2-1 4 1 2.8 3-1.2 2-4.4.8-2.8-3z\" transform=\"rotate(35 19 16.4)\"/><path d=\"M9.4 18.6c2.2-1 4 1 2.8 3-1.2 2-4.4.8-2.8-3z\" transform=\"rotate(-10 11 20.4)\"/></g>",
  sulphites: "<path d=\"M6.6 2.8h10.8c.4 5.4-.6 9.2-3.4 10.6-.8.4-1.6.6-2 .6s-1.2-.2-2-.6C7.2 12 6.2 8.2 6.6 2.8z\" fill=\"#FFFFFF\" stroke=\"#7D6A8C\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M6.9 6.4h10.2c.2 3.6-.8 6-3.2 7-.8.4-1.4.5-1.9.5s-1.1-.1-1.9-.5c-2.4-1-3.4-3.4-3.2-7z\" fill=\"#B53A63\"/><path d=\"M12 14v6.2M8.2 21.2h7.6\" stroke=\"#7D6A8C\" stroke-width=\"1.6\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  lupin: "<path d=\"M12 21V9\" stroke=\"#4E8A26\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/><path d=\"M12 17c-2.6-.4-4-1.8-4.6-3.6 2.6-.2 4.2.8 4.6 3.6zM12 18.6c2.6-.4 4-1.8 4.6-3.6-2.6-.2-4.2.8-4.6 3.6z\" fill=\"#8CC152\" stroke=\"#4E8A26\" stroke-width=\"1\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><g fill=\"#9B6BD6\" stroke=\"#6C3FAE\" stroke-width=\"1\"><ellipse cx=\"12\" cy=\"3.8\" rx=\"1.6\" ry=\"1.9\"/><ellipse cx=\"9.8\" cy=\"6.6\" rx=\"1.8\" ry=\"1.6\"/><ellipse cx=\"14.2\" cy=\"6.6\" rx=\"1.8\" ry=\"1.6\"/><ellipse cx=\"9.6\" cy=\"10.2\" rx=\"1.9\" ry=\"1.6\" fill=\"#C79BEF\"/><ellipse cx=\"14.4\" cy=\"10.2\" rx=\"1.9\" ry=\"1.6\" fill=\"#C79BEF\"/><ellipse cx=\"12\" cy=\"9\" rx=\"1.7\" ry=\"1.8\" fill=\"#B084E6\"/></g>",
  molluscs: "<path d=\"M12 3.4c5.4 0 9.2 3.6 9.2 8.4 0 .8-.6 1.4-1.4 1.4H4.2c-.8 0-1.4-.6-1.4-1.4 0-4.8 3.8-8.4 9.2-8.4z\" fill=\"#F4B9A2\" stroke=\"#BF6A4C\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M12 4v9M8.2 5.2l1.6 8M15.8 5.2l-1.6 8M5 8l3 5M19 8l-3 5\" stroke=\"#CF7F63\" stroke-width=\"1.2\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M7.4 15.4h9.2l-1 3.2a2 2 0 0 1-1.9 1.4h-3.4a2 2 0 0 1-1.9-1.4z\" fill=\"#F4B9A2\" stroke=\"#BF6A4C\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
};

// Generic fallback for a code the frontend doesn't recognize yet (e.g. this
// app is mid-deploy against a newer backend that added a 15th allergen) -- a
// plain warning triangle rather than a blank/broken icon.
const FALLBACK =
  '<path d="M12 3 2 20h20L12 3Z M12 9v5 M12 17h.01" stroke="#C2611D" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="#F7E9DC"/>';

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
      style={style}
      className={className ? `al-ico ${className}` : "al-ico"}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[code] ?? FALLBACK }}
    />
  );
}
