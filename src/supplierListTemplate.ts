// A blank layout for a supplier's price list: the file the Upload price list
// pop-up reads. The first sheet is the only one it reads, and it holds just
// the headers, so an untouched template imports nothing (the importer skips a
// row whose price cell is not a number, which is also why a header row is
// harmless). The examples live on the second sheet for the same reason.

const NAVY = "FF1F3A5F";
const WHITE = "FFFFFFFF";
const BORDER = "FFD9D4C7";

export async function buildSupplierListWorkbook() {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const border = { style: "thin" as const, color: { argb: BORDER } };
  const boxed = { top: border, left: border, bottom: border, right: border };

  const sheet = wb.addWorksheet("Price list", { views: [{ state: "frozen", ySplit: 1, showGridLines: true }] });
  const headers = ["Product", "Unit", "Price", "Pack size (optional)"];
  headers.forEach((h, i) => {
    const cell = sheet.getCell(1, i + 1);
    cell.value = h;
    cell.font = { name: "Calibri", bold: true, color: { argb: WHITE }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { vertical: "middle" };
    cell.border = boxed;
  });
  [44, 14, 12, 22].forEach((w, i) => (sheet.getColumn(i + 1).width = w));
  sheet.getColumn(3).numFmt = "0.00";
  sheet.getColumn(4).numFmt = "0.####";

  const help = wb.addWorksheet("How to fill", { views: [{ showGridLines: false }] });
  help.getColumn(1).width = 34;
  help.getColumn(2).width = 14;
  help.getColumn(3).width = 12;
  help.getColumn(4).width = 24;
  help.getColumn(5).width = 60;
  const title = help.getCell(1, 1);
  title.value = "How to fill in the Price list sheet";
  title.font = { name: "Calibri", bold: true, size: 14 };

  const lines = [
    "One product per row, starting on row 2 of the Price list sheet. Leave the header row as it is.",
    "Product: the supplier's own wording, for example \"Nori sheets, 100 pack\".",
    "Unit: how the supplier sells it, for example kg, L, bottle, ctn, case.",
    "Price: the price for one of that unit, as a plain number (no currency sign).",
    "Pack size (optional): how many of your own item's unit one of their unit holds. Leave it blank when the units already match.",
    "Only the first sheet is read. This sheet is for you.",
  ];
  lines.forEach((t, i) => {
    help.getCell(3 + i, 1).value = t;
  });

  const exHead = ["Product", "Unit", "Price", "Pack size", "What it means"];
  exHead.forEach((h, i) => {
    const cell = help.getCell(11, i + 1);
    cell.value = h;
    cell.font = { name: "Calibri", bold: true, color: { argb: WHITE }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.border = boxed;
  });
  const examples: (string | number)[][] = [
    ["Beef mince 5%", "kg", 7.4, "", "Priced per kg, and you use kg too: no pack size needed"],
    ["Golden syrup", "kg", 12, 1000, "Priced per kg, but you use it in grams: one kg holds 1000 g"],
    ["Nori sheets, 100 pack", "ctn", 37.9, 100, "One carton holds 100 sheets of your item"],
    ["Orange juice 1.5 L", "bottle", 2.2, "", "Priced per bottle; the pack size can be filled in when you link the line"],
  ];
  examples.forEach((row, r) => {
    row.forEach((v, c) => {
      const cell = help.getCell(12 + r, c + 1);
      cell.value = v === "" ? null : v;
      cell.border = boxed;
      if (c === 2) cell.numFmt = "0.00";
    });
  });
  return wb;
}

// Client-side download, the same way the recipe template is delivered. The
// file holds no data of the business, so there is no password step.
export async function downloadSupplierListTemplate(): Promise<void> {
  const wb = await buildSupplierListWorkbook();
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "supplier-price-list-template.xlsx";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
