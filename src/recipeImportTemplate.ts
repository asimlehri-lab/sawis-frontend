import ExcelJS from "exceljs";
import type { Allergen, CatalogItem, Recipe, ItemSupplierRow } from "./api";

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
//    pulled in live. Changing category/vat/par_level (at the selected
//    location)/cost/waste_pct/allergens on one updates that item on upload
//    (only fields that differ from what is stored are sent -- see
//    parseThreeTabWorkbook in Settings.tsx and bulk_upsert_items on the
//    backend). Name, base_unit and supplier are never changed from here
//    (matching is by name, so a renamed row would be read as a different
//    item); they are shown for reference. "new" rows (green) are blank, for
//    genuinely new items -- filled in the same pass as the recipes that
//    use them. This replaces the old standalone "Import items" template:
//    that panel is gone, this is the only import now.
//  - Recipes: one row per EXISTING recipe (or per size variant of one --
//    see splitRecipeName below), fully filled in from this org's real
//    data, plus blank rows at the end for brand-new recipes. Grouped and
//    shaded by category then base name. "display_name" is a formula
//    (recipe + size) -- that's the name that actually gets created/matched
//    in SAWIS on re-upload, and what the Recipe Ingredients tab's
//    recipe-picker shows.
//  - Recipe Ingredients: one row per ingredient line, also pre-filled from
//    each existing recipe's real RecipeLines (item-type only -- a
//    sub-recipe reference can't be expressed in this flat shape, same
//    limitation the bulk_import endpoint itself already has), plus blank
//    rows at the end. "category (auto)" and "unit" are both formulas
//    (looked up from the other two tabs), never typed.
// ---------------------------------------------------------------------------

const NAVY = "FF1F2A44";
const CREAM = "FFFAF8F3";
const LIGHT = "FFF4F1E9";
const BAND_A = "FFFFFFFF";
const BAND_B = "FFF1EFE6";
const NEW_ITEM_FILL = "FFE9F0E6";
const BORDER_C = "FFD8D2C2";
const WHITE = "FFFFFFFF";

// Headroom for brand-new entries, on top of whatever real data an org
// already has. If someone needs more rows than this, the fix is the same
// as any Excel template: select the last template row and drag its fill
// handle down (formulas and dropdowns extend with it) -- called out in the
// Read me tab.
const NEW_ITEM_BLANK_ROWS = 30;
const RECIPE_BLANK_ROWS = 30;
const INGREDIENT_BLANK_ROWS = 100;

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

function numberOrBlank(raw: string | null | undefined): number | "" {
  if (!raw) return "";
  const n = Number(raw);
  return Number.isFinite(n) ? n : "";
}

// Splits a recipe's stored name into a base name + trailing "(size)"
// label, e.g. "Pink Lychee Iced Tea (0.5L)" -> base "Pink Lychee Iced Tea",
// size "0.5L". A name with no trailing parenthetical just returns the
// whole name as base and an empty size -- the common case. This is the
// exact inverse of the Recipes tab's display_name formula
// (`=base&IF(size<>"", " ("&size&")", "")`), so re-splitting and
// reassembling a name that already follows this convention round-trips
// byte-for-byte and still matches the same Recipe server-side on
// re-upload. A recipe whose existing name has irregular spacing around an
// existing parenthetical (rare) may round-trip to a slightly different
// string -- worth knowing, not worth engineering around here.
function splitRecipeName(name: string): { base: string; size: string } {
  const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(name.trim());
  if (m) return { base: m[1].trim(), size: m[2].trim() };
  return { base: name.trim(), size: "" };
}

// Sorts "size" labels sensibly whether or not they look numeric (e.g.
// "0.3L" < "0.5L" < "0.7L", but also "Small" < "Large" alphabetically) --
// a leading number wins when both sides have one, otherwise falls back to
// plain text comparison.
function compareSizes(a: string, b: string): number {
  const na = parseFloat(a);
  const nb = parseFloat(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return a.localeCompare(b);
}

interface RecipeEntry {
  category: string;
  base: string;
  size: string;
  recipe: Recipe;
}

function buildRecipeEntries(recipes: Recipe[]): RecipeEntry[] {
  const entries: RecipeEntry[] = recipes.map((r) => {
    const { base, size } = splitRecipeName(r.name);
    return { category: (r.menu_category || "").trim(), base, size, recipe: r };
  });
  entries.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    if (a.base !== b.base) return a.base.localeCompare(b.base);
    return compareSizes(a.size, b.size);
  });
  return entries;
}

function familyKey(e: RecipeEntry): string {
  return `${e.category}\u0000${e.base}`;
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
    "   \"existing\" rows (grey) are your current item catalogue, pulled in automatically,",
    "   with their current category/vat/par_level/supplier/cost/waste_pct/allergens shown",
    "   alongside so you can see and copy them. An item's name, base_unit and supplier",
    "   cannot be changed from this file (editing them on an existing row does nothing, a",
    "   changed name is read as a different item); change those on the item's own page.",
    "   Add anything genuinely new as a \"new\" row (green) below them -- only item_name +",
    "   base_unit are required, everything else is optional.",
    "",
    "   These columns DO update an existing item when you change them and re-upload --",
    "   rows you leave as they are change nothing:",
    "   - category: pick another category from the dropdown to move the item. It must be a",
    "     category that already exists (a new name is not created here). An item with no VAT",
    "     rate of its own then uses the new category's VAT rate. Blank leaves it as it is.",
    "   - vat: the item's VAT rate as a whole-number percentage (e.g. 20). It shows the rate",
    "     the item uses now (its own, or its category's). Changing it gives the item its own",
    "     rate; open purchase-order lines without a rate of their own follow it, received",
    "     deliveries keep the rate they had. Blank leaves it as it is.",
    "   - par_level: the par for the location picked on the import card (so upload with",
    "     the same location you downloaded for). Blank leaves it as it is.",
    "   - cost: the price per base unit (per g, ml or piece) from the supplier on that",
    "     row. Only the price changes; the supplier's own unit and pack size stay as they",
    "     are. A new supplier name plus a cost adds that supplier to the item. Recipe",
    "     costs follow the new price.",
    "   - waste_pct: your predicted waste % for the item (e.g. 5 for 5%). Blank leaves it",
    "     as it is.",
    "   - allergen_1..allergen_6: each a real dropdown (pick from the 14 recognized",
    "     allergens -- typing something else isn't accepted). Fill as many slots as an item",
    "     needs, left to right, blank rest. Change an existing row's slots and that item's",
    "     tags are replaced with exactly what's picked and the item counts as reviewed.",
    "     Leave every slot blank to leave an item's tags alone. Tagged with more than 6",
    "     allergens? Finish tagging it on the item's own page in SAWIS instead.",
    "",
    "2. Recipes tab",
    "   Every recipe you already have is listed here, fully filled in and grouped/shaded by",
    "   category then name -- edit a row to update that recipe, or add a new row below the",
    "   existing ones to create a new one. \"category\" is a dropdown built from categories",
    "   you already use.",
    "",
    "3. Size variants, grouped and duplicable",
    "   \"recipe\" is the base dish/drink name and \"size\" is its own column -- a recipe whose",
    "   stored name already ends in \"(something)\" (e.g. \"Iced Tea (0.5L)\") has been split",
    "   into recipe=\"Iced Tea\", size=\"0.5L\" automatically. \"display_name\" is computed from",
    "   the two and is what actually gets created/matched in SAWIS -- that's also what the",
    "   Recipe Ingredients tab's recipe-picker shows, so each size of the same item shows as",
    "   a clearly distinct choice. All sizes of the same item sit in adjacent rows, shaded as",
    "   one block.",
    "",
    "4. Recipe Ingredients tab",
    "   Every existing recipe's ingredients are listed here too (only its item-type lines --",
    "   a sub-recipe reference can't be edited from this file, same as the import endpoint",
    "   itself). \"category (auto)\" and \"unit\" both fill themselves in from your picks in the",
    "   other two columns -- never typed.",
    "",
    "Matching an existing recipe (by POS ID, or by name if there's no POS ID) updates it --",
    "replacing its ingredient list with what's on the Recipe Ingredients tab here -- instead",
    "of creating a duplicate. A name that doesn't match anything creates a new recipe.",
    "",
    "Need more rows than are here? Select the last template row on that tab and drag its",
    "fill handle down -- the dropdowns and formulas extend with it.",
    "",
    "Looking for one recipe or item among a long list? Every tab's header row has filter",
    "arrows built in (Data > Filter in Excel/Sheets/LibreOffice if they're ever hidden) --",
    "click one to search, sort, or narrow down to just what you're amending.",
  ];
  let r = 5;
  for (const line of lines) {
    rm.getCell(r, 2).value = line;
    rm.getCell(r, 2).font = { name: "Calibri", size: 11 };
    r++;
  }
  setColumnWidths(rm, [3, 108]);
}

// Same "usual supplier" resolution Reorder.tsx uses for its own price
// comparison: prefer the item's explicit Item.default_supplier when it's
// actually linked here, otherwise whichever supplier it was most recently
// ordered from. Reference-only here (see the note on this sheet), but
// picking the same supplier consistently is still more useful than an
// arbitrary one.
export function resolveUsualSupplierLink(item: CatalogItem): ItemSupplierRow | null {
  const links = item.supplier_links || [];
  if (links.length === 0) return null;
  if (item.default_supplier) {
    const explicit = links.find((l) => l.supplier === item.default_supplier);
    if (explicit) return explicit;
  }
  const withDate = links.filter((l) => l.last_ordered_at);
  if (withDate.length === 0) return links[0];
  return withDate.reduce((a, b) => ((a.last_ordered_at as string) > (b.last_ordered_at as string) ? a : b));
}

// effective_vat_rate is a fraction string ("0.2000"); the sheet's own `vat`
// column (and bulk_upsert_items' `vat_rate` parsing) uses a whole-number
// percentage (20) -- see Settings.tsx's newItemRows parsing for the same
// x100 convention in the other direction.
function vatPercent(item: CatalogItem): number | "" {
  if (!item.effective_vat_rate) return "";
  const n = Number(item.effective_vat_rate) * 100;
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : "";
}

// How many allergen slot columns the Items tab gets -- each one is a
// real dropdown (see ALLERGEN_LIST_COL below), so an item can be tagged
// with anywhere from 0 to this many allergens via the sheet. 6 covers
// every realistic dish/item comfortably; something genuinely tagged
// with more than that is rare enough to just finish tagging on its own
// page in SAWIS (see the column note).
const ALLERGEN_SLOTS = 6;
const ALLERGEN_FIRST_COL = 10; // column J, right after waste_pct
const ALLERGEN_LIST_COL = 17; // column Q -- hidden helper list, see below

function buildItemsSheet(wb: ExcelJS.Workbook, items: CatalogItem[], location: string, allergens: Allergen[]) {
  const sheet = wb.addWorksheet("Items");
  const allergenHeaders = Array.from({ length: ALLERGEN_SLOTS }, (_, i) => `allergen_${i + 1}`);
  const headers = [
    "status", "item_name", "base_unit", "category", "vat", "par_level", "supplier", "cost", "waste_pct",
    ...allergenHeaders,
  ];
  setHeaders(sheet, headers);
  freezeHeaderRow(sheet);

  // Item.allergens comes back from the API as a list of Allergen ids --
  // resolve to names once here rather than per-row.
  const allergenById = new Map(allergens.map((a) => [a.id, a]));
  const sortedAllergens = allergens.slice().sort((a, b) => a.order - b.order);

  // Hidden helper list powering the allergen_N dropdowns below -- Excel's
  // list-type data validation needs a real cell range to pick from (same
  // technique the Recipes/Recipe Ingredients tabs already use for their
  // own recipe/item pickers), rather than a comma-list formula string,
  // so re-running this with a 15th allergen someday just works. Off to
  // the side and hidden so it doesn't clutter what the user sees.
  sheet.getCell(1, ALLERGEN_LIST_COL).value = "Allergen reference (do not edit -- powers the dropdowns to the left)";
  sortedAllergens.forEach((a, i) => {
    sheet.getCell(2 + i, ALLERGEN_LIST_COL).value = a.name;
  });
  sheet.getColumn(ALLERGEN_LIST_COL).hidden = true;
  const allergenListLastRow = 1 + sortedAllergens.length;

  const existing = items
    .filter((i) => !i.archived)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  let row = 2;
  for (const item of existing) {
    const holding = item.holdings.find((h) => h.location === location);
    const link = resolveUsualSupplierLink(item);
    sheet.getCell(row, 1).value = "existing";
    sheet.getCell(row, 2).value = item.name;
    sheet.getCell(row, 3).value = item.base_unit;
    sheet.getCell(row, 4).value = item.category_name || "";
    sheet.getCell(row, 5).value = vatPercent(item);
    sheet.getCell(row, 6).value = holding ? numberOrBlank(holding.par_level) : "";
    sheet.getCell(row, 7).value = link ? link.supplier_name : "";
    sheet.getCell(row, 8).value = link ? numberOrBlank(link.unit_price) : "";
    sheet.getCell(row, 9).value = numberOrBlank(item.target_waste_pct);
    const itemAllergenNames = (item.allergens || [])
      .map((id) => allergenById.get(id))
      .filter((a): a is Allergen => !!a)
      .sort((a, b) => a.order - b.order)
      .map((a) => a.name);
    for (let s = 0; s < ALLERGEN_SLOTS; s++) {
      sheet.getCell(row, ALLERGEN_FIRST_COL + s).value = itemAllergenNames[s] || "";
    }
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
    for (let s = 0; s < ALLERGEN_SLOTS; s++) {
      sheet.getCell(r, ALLERGEN_FIRST_COL + s).dataValidation = strictListValidation(
        `Items!$Q$2:$Q$${allergenListLastRow}`,
        "Unknown allergen",
        "Pick one of the 14 allergens from the dropdown -- typing something else risks it not matching what's set up in SAWIS."
      );
    }
  }

  sheet.getCell("A1").note =
    '"existing" rows are your current catalogue, pulled in automatically -- category, vat, par_level, cost, waste_pct and the allergen slots update the item if you change them; name, base_unit and supplier do not. Add anything genuinely new as a "new" row below.';
  sheet.getCell("B1").note =
    "Only item_name + base_unit are required -- everything else (category/vat/par_level/supplier/cost/waste_pct/allergen_1..6) is optional, same as the old standalone Items import.";
  sheet.getCell("D1").note =
    "On \"existing\" rows, category/vat/par_level/supplier/cost/waste_pct show that item's current values (par_level for the location you've picked below) so you can see and copy them -- category, vat, par_level, cost, waste_pct and the allergen slots DO update it when you change them. Name, base_unit and supplier do not: matching is by name, so a changed name is read as a different item.";
  sheet.getCell("H1").note =
    "Price per base unit (per g, ml or piece) from the supplier on this row. On an existing row, changing it updates that supplier's price for the item (the supplier's own unit and pack size stay as they are) and recipe costs follow. Needs a supplier on the row.";
  sheet.getCell("I1").note =
    "Your own predicted spoilage % for this item (e.g. 5 for 5%) -- shown on the item's own page next to the actual % calculated from your waste log. On an existing row, changing it updates the item; blank leaves it as it is.";
  sheet.getCell("J1").note =
    `Pick from the dropdown -- each of these ${ALLERGEN_SLOTS} columns (allergen_1..allergen_${ALLERGEN_SLOTS}) is a real dropdown of the 14 recognized allergens, not free text, so what you pick always matches what's set up in SAWIS. Fill as many slots as this item needs, left to right, and leave the rest blank. Like cost and waste_pct, these DO take effect on an "existing" row when you change them: re-uploading replaces that item's current tags with exactly what's picked across these columns, so this is the way to bulk-tag your whole catalogue without opening each item one at a time. Leave every slot blank to leave an item's tags alone. Tagged with more than ${ALLERGEN_SLOTS}? Finish tagging it on the item's own page in SAWIS instead -- only the first ${ALLERGEN_SLOTS} show here.`;

  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: lastItemRow, column: headers.length } };

  setColumnWidths(sheet, [10, 26, 11, 14, 7, 10, 16, 9, 10, 24, 24, 24, 24, 24, 24]);
  return { lastItemRow };
}

function buildRecipesSheet(wb: ExcelJS.Workbook, entries: RecipeEntry[]) {
  const sheet = wb.addWorksheet("Recipes");
  const headers = ["category", "recipe", "size", "display_name", "pos_id", "kind", "yield_qty", "yield_unit", "menu_price", "menu_group"];
  setHeaders(sheet, headers);
  freezeHeaderRow(sheet);

  let row = 2;
  let shade = false;
  let lastFamily: string | null = null;
  const categoryFirstRow = new Map<string, number>();
  for (const e of entries) {
    const fk = familyKey(e);
    if (fk !== lastFamily) {
      shade = !shade;
      lastFamily = fk;
    }
    if (!categoryFirstRow.has(e.category)) categoryFirstRow.set(e.category, row);
    const r = e.recipe;
    sheet.getCell(row, 1).value = e.category;
    sheet.getCell(row, 2).value = e.base;
    sheet.getCell(row, 3).value = e.size;
    sheet.getCell(row, 4).value = {
      formula: `B${row}&IF(C${row}<>"", " ("&C${row}&")", "")`,
      // Stored result, so the name is still there if the file is uploaded
      // without being opened and saved in Excel first.
      result: e.size ? `${e.base} (${e.size})` : e.base,
    };
    sheet.getCell(row, 5).value = r.pos_id || "";
    sheet.getCell(row, 6).value = r.kind;
    sheet.getCell(row, 7).value = numberOrBlank(r.yield_qty);
    sheet.getCell(row, 8).value = r.yield_unit;
    sheet.getCell(row, 9).value = r.kind === "dish" ? numberOrBlank(r.menu_price) : "";
    sheet.getCell(row, 10).value = r.menu_group;
    borderRow(sheet, row, headers.length);
    bandRow(sheet, row, headers.length, shade ? BAND_B : BAND_A);
    row++;
  }
  for (let i = 0; i < RECIPE_BLANK_ROWS; i++) {
    sheet.getCell(row, 4).value = { formula: `B${row}&IF(C${row}<>"", " ("&C${row}&")", "")`, result: "" };
    borderRow(sheet, row, headers.length);
    bandRow(sheet, row, headers.length, CREAM);
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

  for (const [, firstRow] of categoryFirstRow) {
    sheet.getCell(firstRow, 1).font = { name: "Calibri", bold: true, size: 11, color: { argb: NAVY } };
  }

  sheet.getCell("C1").note =
    "Leave blank for a dish/drink with no size variants. Type a label (e.g. Small/Large) for one that does -- the sizes of the same item then sit as adjacent, shaded rows.";
  sheet.getCell("D1").note =
    "Computed automatically from recipe + size -- this is the name that actually gets created/matched in SAWIS. Don't type into this column.";

  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: lastRecipeRow, column: headers.length } };

  setColumnWidths(sheet, [13, 24, 8, 28, 8, 8, 9, 10, 10, 10]);
  return { lastRecipeRow };
}

function buildRecipeIngredientsSheet(
  wb: ExcelJS.Workbook,
  entries: RecipeEntry[],
  lastRecipeRow: number,
  lastItemRow: number,
  items: CatalogItem[]
) {
  const sheet = wb.addWorksheet("Recipe Ingredients");
  // Base unit by item name, for the stored result of the unit lookup formula.
  const unitByName = new Map<string, string>();
  for (const it of items) {
    const k = it.name.trim().toLowerCase();
    if (k && !unitByName.has(k)) unitByName.set(k, it.base_unit);
  }
  const headers = ["category (auto)", "recipe", "ingredient", "qty", "unit"];
  setHeaders(sheet, headers);
  freezeHeaderRow(sheet);

  let row = 2;
  let shade = false;
  let lastFamily: string | null = null;
  for (const e of entries) {
    const fk = familyKey(e);
    if (fk !== lastFamily) {
      shade = !shade;
      lastFamily = fk;
    }
    const itemLines = e.recipe.lines.filter((l) => l.line_type === "item");
    for (const line of itemLines) {
      sheet.getCell(row, 1).value = {
        formula: `IF(B${row}="","",IFERROR(INDEX(Recipes!$A:$A,MATCH(B${row},Recipes!$D:$D,0)),""))`,
        result: e.category,
      };
      sheet.getCell(row, 2).value = e.recipe.name;
      sheet.getCell(row, 3).value = line.item_name || "";
      sheet.getCell(row, 4).value = numberOrBlank(line.qty);
      sheet.getCell(row, 5).value = {
        formula: `IFERROR(VLOOKUP(C${row},Items!$B:$C,2,FALSE),"")`,
        result: unitByName.get((line.item_name || "").trim().toLowerCase()) ?? "",
      };
      borderRow(sheet, row, headers.length);
      bandRow(sheet, row, headers.length, shade ? BAND_B : BAND_A);
      row++;
    }
  }
  for (let i = 0; i < INGREDIENT_BLANK_ROWS; i++) {
    sheet.getCell(row, 1).value = {
      formula: `IF(B${row}="","",IFERROR(INDEX(Recipes!$A:$A,MATCH(B${row},Recipes!$D:$D,0)),""))`,
      result: "",
    };
    sheet.getCell(row, 5).value = { formula: `IFERROR(VLOOKUP(C${row},Items!$B:$C,2,FALSE),"")`, result: "" };
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

  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: lastIngredientRow, column: headers.length } };

  setColumnWidths(sheet, [13, 28, 26, 8, 10]);
}

export async function buildRecipeImportWorkbook(
  items: CatalogItem[],
  recipes: Recipe[],
  location: string,
  allergens: Allergen[]
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const entries = buildRecipeEntries(recipes);
  buildReadMeSheet(wb);
  const { lastItemRow } = buildItemsSheet(wb, items, location, allergens);
  const { lastRecipeRow } = buildRecipesSheet(wb, entries);
  buildRecipeIngredientsSheet(wb, entries, lastRecipeRow, lastItemRow, items);
  // Excel recalculates every formula on open, so the stored results above
  // only matter to readers that do not calculate (including SAWIS's own import).
  wb.calcProperties.fullCalcOnLoad = true;
  return wb;
}

// Triggers a real client-side file download, same pattern as
// Settings.tsx's downloadCsv/downloadXlsxTemplate -- this is the "live"
// replacement for that file's old static, pre-built RECIPE_TEMPLATE_XLSX_B64
// blob, personalized to this org's actual current items/recipes instead of
// shipping blank.
export async function downloadRecipeImportTemplate(
  items: CatalogItem[],
  recipes: Recipe[],
  location: string,
  allergens: Allergen[]
): Promise<void> {
  const wb = await buildRecipeImportWorkbook(items, recipes, location, allergens);
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
