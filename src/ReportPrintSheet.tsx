import { createPortal } from "react-dom";
import type { ReportsSummary } from "./api";
import { FoodCostBars } from "./ReportCharts";
import MenuEngineering from "./MenuEngineering";
import { CategoryCard, MenuTable, ReportTiles, SplitBar, WasteCard, ZeroCostNote } from "./ReportParts";
import { sectionHeadStyle } from "./reportFormat";
import type { PdfSections } from "./ReportPdfModal";

// What the browser prints (or saves as PDF) after the password check. It is
// rendered straight into <body> and the shared @media print rules in
// App.css hide everything else, the same way the allergen sheet works. The
// charts are the same components as on screen, switched to read-only, and
// .rp-print pins the light colours so a dark-mode screen still prints on
// white.
export default function ReportPrintSheet({
  report,
  currency,
  venue,
  title,
  sections,
  target,
  foodTarget,
  drinkTarget,
}: {
  report: ReportsSummary;
  currency?: string;
  venue: string;
  title: string;
  sections: PdfSections;
  target: number;
  foodTarget: number;
  drinkTarget: number;
}) {
  const printedAt = new Date().toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return createPortal(
    <div className="print-only rp-print">
      <div className="rp-print-head">
        <div className="rp-print-brand">
          <span className="rp-print-logo" /> SAWIS
        </div>
        <div className="rp-print-meta">
          {venue} · {report.range.start} to {report.range.end}
        </div>
      </div>
      <h1>{title}</h1>

      {sections.overview && (
        <>
          <ReportTiles report={report} currency={currency} target={target} />
          <ZeroCostNote report={report} />
          <section className="card rp-card rp-print-block">
            <h2 style={sectionHeadStyle}>Food cost %</h2>
            <FoodCostBars trend={report.trend} target={target} currency={currency} readOnly />
          </section>
          <div className="rp-print-block">
            <SplitBar report={report} currency={currency} />
          </div>
        </>
      )}
      {sections.menu && (
        <section className="card rp-card rp-print-block">
          <h2 style={sectionHeadStyle}>Which dishes earn their place</h2>
          <MenuEngineering rows={report.menu} currency={currency} readOnly />
        </section>
      )}
      {sections.waste && (
        <div className="rp-print-block">
          <WasteCard report={report} currency={currency} />
        </div>
      )}
      {sections.category && (
        <div className="rp-print-block">
          <CategoryCard report={report} currency={currency} />
        </div>
      )}
      {sections.dishes && <MenuTable rows={report.menu} currency={currency} foodTarget={foodTarget} drinkTarget={drinkTarget} />}

      <div className="rp-print-foot">
        <span>Printed {printedAt}</span>
        <span>Confidential: contains sales and cost figures</span>
      </div>
    </div>,
    document.body
  );
}
