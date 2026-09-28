import ExcelJS from "exceljs";
import type { CatalogItem, Recipe } from "./api";

// ---------------------------------------------------------------------------
// Live, personalized Recipe + Item import template.
//
// Generated client-side (not a new backend endpoint) since the frontend
// already has `items`/`recipes` loaded in React state -- this just formats
// what's already here. Ports the openpyxl-built, user-validated 3-tab
// design (Items / Recipes / Recipe Ingredients) from the earlier design
// round to exceljs, since the `xlsx` package already in this repo can only
// READ Excel data validation, not write it (SheetJS free tier).
//
// The three tabs:
//  - Items: "existing" rows (grey) are this org's current item catalogue,
//    pulled in live -- reference only, feeds the Recipe Ingredients tab's
//    ingredient dropdown so nothing has to be retyped. "new" rows (green)
//    are blank, for genuinely new items -- filled in the same pass as the
//    recipes that use them. This replaces the old standalone "Import
//    items" template: that panel is gone, this is the only import now.
//  - Recipes: one row per recipe (or per size variant of one), grouped and
//    shaded by category. "display_name" is a formula (recipe + size) --
//    that's the name that actually gets created/matched in SAWIS, and
//    what the Recipe Ingredients tab's recipe-picker shows.
//  - Recipe Ingredients: one row per ingredient line. "category (auto)"
//    and "unit" are both formulas (looked up from the other two tabs),
//    never typed.
// ---------------------------------------------------------------------------

const NAVY = "FF1F2A44";
const CREAM = "FFFAF8F3";
const LIGHT = "FFF4F1E9";
const BAND_A = "FFFFFFFF";
const BAND_B = "FFF1EFE6";
const NEW_ITEM_FILL = "FFE9F0E6";
const BORDER_C = "FFD8D2C2";
const WHITE = "FFFFFFFF";

// Generous defaults for a first pass -- if someone needs more rows than
// this, the fix is the same as any Excel template: select the last
// template row and drag its fill handle down (formulas and dropdowns
// extend with it). Called out in the Read me tab.
const NEW_ITEM_BLANK_ROWS = 30;
const RECIPE_BLANK_ROWS = 50;
const INGREDIENT_BLANK_ROWS = 250;

function thinBorder() {
  const side = { style: "thin" as const, color: { argb: BORDER_C } };
  return { top: side, left: side, bottom: side, right: side };
}

function borderRow(sheet: ExcelJS.Worksheet, rowNum: number, ncols: number) {
  const border = thinBorder();
  for (let c = 1; c <= ncols; c++) {
    sheet.getCell(rowNum, c).border = border;
  }
}

function bandRow(sheet: ExcelJS.Worksheet, rowNum: number, ncols: number, argb: string) {
  for (let c = 1; c <= ncols; c++) {
    sheet.getCell(rowNum, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
  }
}

function styleHeaderRow(sheet: ExcelJS.Worksheet, ncols: number) {
  const border = thinBorder();
  for (let c = 1; c <= ncols; c++) {
    const cell = sheet.getCell(1, c);
    cell.font = { name: "Calibri", bold: true, color: { argb: WHITE }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { vertical: "middle" };
    cell.border = border;
  }
}

function setHeaders(sheet: ExcelJS.Worksheet, headers: string[]) {
  headers.forEach((h, i) => {
    sheet.getCell(1, i + 1).value = h;
  });
  styleHeaderRow(sheet, headers.length);
}

function setColumnWidths(sheet: ExcelJS.Worksheet, widths: number[]) {
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
}

function freezeHeaderRow(sheet: ExcelJS.Worksheet) {
  sheet.views = [{ state: "frozen", ySplit: 1, showGridLines: false }];
}

function looseListValidation(formula: string) {
  return { type: "list" as const, allowBlank: true, showErrorMessage: false, formulae: [formula] };
}

function strictListValidation(formula: string, errorTitle: string, error: string) {
  return {
    type: "list" as const,
    allowBlank: true,
    showErrorMessage: true,
    errorStyle: "stop" as const,
    errorTitle,
    error,
    formulae: [formula],
  };
}

function buildReadMeSheet(wb: ExcelJS.Workbook) {
  const rm = wb.addWorksheet("Read me");
  rm.views = [{ showGridLines: false }];
  rm.getCell("B2").value = "SAWIS recipe & item import";
  rm.getCell("B2").font = { name: "Calibri", bold: true, size: 16, color: { argb: NAVY } };
  rm.getCell("B3").value =
    "Add new items and recipes -- or update ones you already have -- in one file, without retyping ingredients you've already got.";
  rm.getCell("B3").font = { name: "Calibri", size: 11, italic: true, color: { argb: "FF5A5546" } };

  const lines = [
    "",
    "This replaces the old separate \"Import items\" screen -- item rows now live on the",
    "Items tab in this same file, alongside your recipes.",
    "",
    "1. Items tab",
    "   \"existing\" rows (grey) are your current item catalogue, pulled in automatically --",
    "   reference only, so the Recipe Ingredients tab's dropdown has something to pick from",
    "   without retyping. Add anything genuinely new as a \"new\" row (green) below them --",
    "   only item_name + base_unit are required, everything else is optional.",
    "",
    "2. Category grouping",
    "   The Recipes and Recipe Ingredients tabs are sorted and shaded by category, and",
    "   \"category\" is a dropdown. The first few rows on the Recipes tab list your existing",
    "   categories so they show up in that dropdown -- they're otherwise blank and get",
    "   skipped on import, so it's fine to leave them there or delete them once you don't",
    "   need the reminder any more.",
    "",
    "3. Size variants, grouped and duplicable",
    "   \"recipe\" is the base dish/drink name and \"size\" is its own column (e.g. Small/",
    "   Large, or blank for anything with no sizes). \"display_name\" is computed",
    "   automatically from the two and is what actually gets created/matched in SAWIS --",
    "   that's also what the Recipe Ingredients tab's recipe-picker shows, so each size of",
    "   the same item shows as a clearly distinct choice. Build one size's ingredient list,",
    "   then copy that block of rows down for the next size and adjust the quantities --",
    "   quantities don't usually scale by a clean multiplier between sizes, so this is a",
    "   head start to edit, not an auto-fill.",
    "",
    "Matching an existing recipe (by POS ID, or by name if there's no POS ID) updates it --",
    "replacing its ingredient list with what's on the Recipe Ingredients tab here -- instead",
    "of creating a duplicate. A name that doesn't match anything creates a new recipe.",
    "",
    "Need more rows than are here? Select the last template row on that tab and drag its",
    "fill handle down -- the dropdowns and formulas extend with it.",
  ];
  let r = 5;
  for (const line of lines) {
    rm.getCell(r, 2).value = line;
    rm.getCell(r, 2).font = { name: "Calibri", size: 11 };
    r++;
  }
  setColumnWidths(rm, [3, 108]);
}

function buildItemsSheet(wb: ExcelJS.Workbook, items: CatalogItem[]) {
  const sheet = wb.addWorksheet("Items");
  const headers = ["status", "item_name", "base_unit", "category", "vat", "par_level", "supplier", "cost"];
  setHeaders(sheet, headers);
  freezeHeaderRow(sheet);

  const existing = items
    .filter((i) => !i.archived)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  let row = 2;
  for (const item of existing) {
    sheet.getCell(row, 1).value = "existing";
    sheet.getCell(row, 2).value = item.name;
    sheet.getCell(row, 3).value = item.base_unit;
    borderRow(sheet, row, headers.length);
    bandRow(sheet, row, headers.length, LIGHT);
    row++;
  }
  for (let i = 0; i < NEW_ITEM_BLANK_ROWS; i++) {
    sheet.getCell(row, 1).value = "new";
    borderRow(sheet, row, headers.length);
    bandRow(sheet, row, headers.length, NEW_ITEM_FILL);
    row++;
  }
  const lastItemRow = row - 1;

  for (let r = 2; r <= lastItemRow; r++) {
    sheet.getCell(r, 1).dataValidation = looseListValidation('"existing,new"');
    sheet.getCell(r, 5).dataValidation = looseListValidation('"0,5,10,20"');
  }

  sheet.getCell("A1").note =
    '"existing" rows are your current catalogue, pulled in automatically -- reference only, don\'t edit. Add anything genuinely new as a "new" row below.';
  sheet.getCell("B1").note =
    "Only item_name + base_unit are required -- everything else (category/vat/par_level/supplier/cost) is optional, same as the old standalone Items import.";

  setColumnWidths(sheet, [10, 26, 11, 14, 7, 10, 16, 9]);
  return { lastItemRow };
}

function buildRecipesSheet(wb: ExcelJS.Workbook, recipes: Recipe[]) {
  const sheet = wb.addWorksheet("Recipes");
  const headers = ["category", "recipe", "size", "display_name", "pos_id", "kind", "yield_qty", "yield_unit", "menu_price", "menu_group"];
  setHeaders(sheet, headers);
  freezeHeaderRow(sheet);

  const existingCategories = Array.from(
    new Set(recipes.map((r) => (r.menu_category || "").trim()).filter((c) => c.length > 0))
  ).sort((a, b) => a.localeCompare(b));

  let row = 2;
  for (const cat of existingCategories) {
    sheet.getCell(row, 1).value = cat;
    sheet.getCell(row, 1).font = { name: "Calibri", bold: true, size: 11, color: { argb: NAVY } };
    sheet.getCell(row, 4).value = { formula: `B${row}&IF(C${row}<>"", " ("&C${row}&")", "")` };
    borderRow(sheet, row, headers.length);
    bandRow(sheet, row, headers.length, CREAM);
    row++;
  }
  for (let i = 0; i < RECIPE_BLANK_ROWS; i++) {
    sheet.getCell(row, 4).value = { formula: `B${row}&IF(C${row}<>"", " ("&C${row}&")", "")` };
    borderRow(sheet, row, headers.length);
    bandRow(sheet, row, headers.length, i % 2 === 0 ? BAND_A : BAND_B);
    row++;
  }
  const lastRecipeRow = row - 1;

  for (let r = 2; r <= lastRecipeRow; r++) {
    sheet.getCell(r, 1).dataValidation = looseListValidation(`Recipes!$A$2:$A$${lastRecipeRow}`);
    sheet.getCell(r, 3).dataValidation = looseListValidation(`Recipes!$C$2:$C$${lastRecipeRow}`);
    sheet.getCell(r, 6).dataValidation = strictListValidation(
      '"dish,sub"',
      "Invalid kind",
      'Must be exactly "dish" or "sub" -- these map straight to fixed values in SAWIS.'
    );
    sheet.getCell(r, 10).dataValidation = strictListValidation(
      '"food,drink"',
      "Invalid menu_group",
      'Must be exactly "food" or "drink" -- these map straight to fixed values in SAWIS.'
    );
  }

  sheet.getCell("C1").note =
    "Leave blank for a dish/drink with no size variants. Type a label (e.g. Small/Large) for one that does -- the sizes of the same item then sit as adjacent, shaded rows.";
  sheet.getCell("D1").note =
    "Computed automatically from recipe + size -- this is the name that actually gets created/matched in SAWIS. Don't type into this column.";

  setColumnWidths(sheet, [13, 24, 8, 28, 8, 8, 9, 10, 10, 10]);
  return { lastRecipeRow };
}

function buildRecipeIngredientsSheet(wb: ExcelJS.Workbook, lastRecipeRow: number, lastItemRow: number) {
  const sheet = wb.addWorksheet("Recipe Ingredients");
  const headers = ["category (auto)", "recipe", "ingredient", "qty", "unit"];
  setHeaders(sheet, headers);
  freezeHeaderRow(sheet);

  let row = 2;
  for (let i = 0; i < INGREDIENT_BLANK_ROWS; i++) {
    sheet.getCell(row, 1).value = {
      formula: `IF(B${row}="","",IFERROR(INDEX(Recipes!$A:$A,MATCH(B${row},Recipes!$D:$D,0)),""))`,
    };
    sheet.getCell(row, 5).value = { formula: `IFERROR(VLOOKUP(C${row},Items!$B:$C,2,FALSE),"")` };
    borderRow(sheet, row, headers.length);
    bandRow(sheet, row, headers.length, i % 2 === 0 ? BAND_A : BAND_B);
    row++;
  }
  const lastIngredientRow = row - 1;

  for (let r = 2; r <= lastIngredientRow; r++) {
    sheet.getCell(r, 2).dataValidation = strictListValidation(
      `Recipes!$D$2:$D$${lastRecipeRow}`,
      "Unknown recipe",
      "Not on the Recipes tab. Add it there first (or check for a typo), then come back and pick it here."
    );
    sheet.getCell(r, 3).dataValidation = strictListValidation(
      `Items!$B$2:$B$${lastItemRow}`,
      "Unknown item",
      'Not on the Items tab. Add it there first as a "new" row (or check for a typo), then come back and pick it here.'
    );
  }

  sheet.getCell("B1").note =
    "Picks from the Recipes tab's display_name -- different sizes of the same item show as separate, clearly labelled choices.";
  sheet.getCell("C1").note = "Picks from the Items tab -- both existing items and anything you just added as \"new\" there.";
  sheet.getCell("E1").note =
    "Fills itself in the moment you pick an ingredient (looked up from that item's base_unit on the Items tab). Never typed.";

  setColumnWidths(sheet, [13, 28, 26, 8, 10]);
}

export async function buildRecipeImportWorkbook(items: CatalogItem[], recipes: Recipe[]): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  buildReadMeSheet(wb);
  const { lastItemRow } = buildItemsSheet(wb, items);
  const { lastRecipeRow } = buildRecipesSheet(wb, recipes);
  buildRecipeIngredientsSheet(wb, lastRecipeRow, lastItemRow);
  return wb;
}

// Triggers a real client-side file download, same pattern as
// Settings.tsx's downloadCsv/downloadXlsxTemplate -- this is the "live"
// replacement for that file's old static, pre-built RECIPE_TEMPLATE_XLSX_B64
// blob, personalized to this org's actual current items/recipes instead of
// shipping blank.
export async function downloadRecipeImportTemplate(items: CatalogItem[], recipes: Recipe[]): Promise<void> {
  const wb = await buildRecipeImportWorkbook(items, recipes);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "recipe-and-item-import-template.xlsx";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
