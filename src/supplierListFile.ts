import * as XLSX from "xlsx";

// One row of a supplier's price list, as the bulk_import endpoint expects it.
export interface SupplierListRow {
  name: string;
  unit: string;
  price: string;
  base_qty_per_unit?: string;
  // Details the AI reader found on the supplier's list (kept with the line, never used in a sum).
  article_no?: string;
  pack?: string;
  vat_percent?: number | null;
  category?: string;
}

// Turns a sheet's raw rows (from either CSV or Excel) into rows for the
// bulk_import endpoint -- the two file formats converge here so nothing
// downstream needs to know which one the supplier actually sent.
//
// A row counts when it has a name and a numeric price in the third cell, so a
// header row is skipped by itself. The optional 4th column is how many of the
// eventually-linked item's base_unit one of this row's `unit` contains (e.g.
// "1000" on a row priced per kg when the item is costed in grams); left off,
// the backend treats it as 1, i.e. no conversion.
export function rowsFromCells(cellRows: unknown[][]): SupplierListRow[] {
  const rows: SupplierListRow[] = [];
  cellRows.forEach((cells) => {
    const parts = cells.map((c) => (c === null || c === undefined ? "" : String(c).trim()));
    if (parts.length >= 3 && parts[0] && !isNaN(Number(parts[2]))) {
      const packQty = parts[3] && !isNaN(Number(parts[3])) ? parts[3] : undefined;
      rows.push({ name: parts[0], unit: parts[1], price: parts[2], base_qty_per_unit: packQty });
    }
  });
  return rows;
}

const cleanCell = (c: unknown) => (c === null || c === undefined ? "" : String(c).trim());

// Does this file follow the SAWIS template (Product, Unit, Price, optional
// Pack size)? Only then are its rows safe to take as they are. Anything else
// (extra columns, a different column order, prices written as text, a title
// above the header) goes to the AI reader and is checked by a person, because
// reading it by position would quietly put the wrong text in the wrong field.
export function matchesTemplate(cellRows: unknown[][], rows: SupplierListRow[]): boolean {
  const filled = cellRows.map((r) => r.map(cleanCell)).filter((r) => r.some(Boolean));
  if (rows.length === 0 || filled.length === 0) return false;

  // The template has four columns at most.
  const width = (r: string[]) => r.reduce((w, c, i) => (c ? i + 1 : w), 0);
  if (filled.some((r) => width(r) > 4)) return false;

  // A first row that is not itself a product must be the template's header.
  const first = filled[0];
  const firstIsProduct = !!first[0] && first.length >= 3 && first[2] !== "" && !isNaN(Number(first[2]));
  if (!firstIsProduct) {
    const ok =
      /product|name|item|description|article|goods/i.test(first[0] ?? "") &&
      /unit|uom|pack|size|measure/i.test(first[1] ?? "") &&
      /price|cost|rate|eur|gbp|€|£/i.test(first[2] ?? "");
    if (!ok) return false;
  }

  // Most rows must have been picked up; a long tail that was skipped means prices
  // written as text ("€4.50") or another layout.
  const dataRows = filled.length - (firstIsProduct ? 0 : 1);
  if (rows.length < dataRows * 0.8) return false;

  // The cells must look like what the template puts there.
  const odd = rows.filter((r) => r.unit === "" || r.unit.length > 20 || !isNaN(Number(r.unit)) || !isNaN(Number(r.name))).length;
  return odd <= rows.length * 0.2;
}

export interface InspectedListFile {
  rows: SupplierListRow[];
  matchesTemplate: boolean;
  // The whole file as CSV text (every sheet), for the AI reader.
  text: string;
}

// Reads a CSV or Excel file into price list rows (first sheet, by position, as
// the template lays them out), says whether it really follows the template, and
// keeps the text of every sheet for the AI reader. Rejects when the file cannot
// be read at all.
export function inspectSupplierListFile(file: File): Promise<InspectedListFile> {
  return new Promise((resolve, reject) => {
    const isSpreadsheet = /\.xlsx?$/i.test(file.name);
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      try {
        let cellRows: unknown[][];
        let text: string;
        if (isSpreadsheet) {
          // Read the first sheet as a grid of cells rather than text, since
          // prices and units in Excel are often real numbers, not strings.
          const data = new Uint8Array(reader.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: "array" });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          cellRows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false }) as unknown[][];
          text = workbook.SheetNames.map(
            (name) => `## Sheet: ${name}\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name], { blankrows: false })}`
          ).join("\n\n");
        } else {
          text = String(reader.result || "");
          cellRows = text
            .split(/\r?\n/)
            .filter((line) => line.trim())
            .map((line) => line.split(","));
        }
        const rows = rowsFromCells(cellRows);
        resolve({ rows, matchesTemplate: matchesTemplate(cellRows, rows), text });
      } catch {
        reject(new Error("Could not read that file."));
      }
    };
    if (isSpreadsheet) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  });
}

// What the page tells the server about an upload so it can keep a record of it.
export interface ListSource {
  method: "template" | "ai_sheet" | "ai_pdf";
  file: File;
  currency?: string;
  valid_from?: string;
}

export function uploadRecord(src: ListSource) {
  return {
    method: src.method,
    file_name: src.file.name,
    content_type: src.file.type,
    size_bytes: src.file.size,
    currency: src.currency,
    valid_from: src.valid_from,
  };
}
