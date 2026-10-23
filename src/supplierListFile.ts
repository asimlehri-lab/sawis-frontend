import * as XLSX from "xlsx";

// One row of a supplier's price list, as the bulk_import endpoint expects it.
export interface SupplierListRow {
  name: string;
  unit: string;
  price: string;
  base_qty_per_unit?: string;
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

// Reads a CSV or Excel file (first sheet) into price list rows. Rejects when
// the file cannot be read at all; resolves with [] when it holds no valid row.
export function readSupplierListFile(file: File): Promise<SupplierListRow[]> {
  return new Promise((resolve, reject) => {
    const isSpreadsheet = /\.xlsx?$/i.test(file.name);
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      try {
        if (isSpreadsheet) {
          // Read the first sheet as a grid of cells rather than text, since
          // prices and units in Excel are often real numbers, not strings.
          const data = new Uint8Array(reader.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: "array" });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const cellRows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false }) as unknown[][];
          resolve(rowsFromCells(cellRows));
        } else {
          const text = String(reader.result || "");
          const cellRows = text
            .split(/\r?\n/)
            .filter((line) => line.trim())
            .map((line) => line.split(","));
          resolve(rowsFromCells(cellRows));
        }
      } catch {
        reject(new Error("Could not read that file."));
      }
    };
    if (isSpreadsheet) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  });
}
