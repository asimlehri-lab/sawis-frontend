import { useState } from "react";
import { BASE_UNITS, bulkImportRecipes, createItem } from "./api";
import type { BulkRecipeInput, CatalogItem, Recipe } from "./api";

// One recipe as read off the customer's menu-list file (name/POS ID/
// category/price only -- see parseMenuListFile in Settings.tsx). No
// ingredient data ever comes from this file; that's what this whole
// modal exists to collect instead, through the picker below.
export interface ParsedMenuRow {
  recipeName: string;
  posId: string;
  menuCategory: string;
  menuPrice: string;
}

interface DraftLine {
  itemId: string;
  itemName: string;
  qty: string;
  unit: string;
}

interface RowState extends ParsedMenuRow {
  kind: "dish" | "sub";
  // Only meaningful when kind === "dish" (same as RecipeDetail.tsx's own
  // "Food or drink?" field) -- drives which yield unit a brand-new
  // recipe defaults to (see handleImport below) and End of day's
  // Champions Food/Drink split. Defaults to whatever an already-matched
  // recipe already has, so re-importing a menu list doesn't flip a
  // drink back to Food; a genuinely new recipe defaults to Food, same
  // as the model's own default.
  menuGroup: "food" | "drink";
  lines: DraftLine[];
  pendingItemId: string;
  pendingQty: string;
}

interface Props {
  accessToken: string;
  items: CatalogItem[];
  recipes: Recipe[];
  location: string;
  fileName: string;
  rows: ParsedMenuRow[];
  onClose: () => void;
  onItemsChanged: () => void;
  onRecipesChanged: () => void;
}

// The whole point of this screen: a manager reading a menu list off a
// POS export shouldn't have to type ingredient names into a spreadsheet
// column -- they pick real items from a dropdown, per dish, right here,
// the same "review everything before it's saved" pattern already used
// by the Scan receipt and End of day import modals.
export default function MenuListImportModal({
  accessToken,
  items,
  recipes,
  location,
  fileName,
  rows,
  onClose,
  onItemsChanged,
  onRecipesChanged,
}: Props) {
  // Built once, up front, so both the lazy rowsState initializer below
  // (which needs to know each row's already-matched recipe before the
  // first render) and matchFor (used on every render, for the "will
  // create"/"will update" badge) share the same lookup instead of
  // duplicating the match logic in two places.
  const recipesByPosId = new Map(recipes.filter((r) => r.pos_id).map((r) => [r.pos_id, r]));
  const recipesByName = new Map(recipes.map((r) => [r.name.trim().toLowerCase(), r]));
  function findMatch(posId: string, name: string): Recipe | undefined {
    if (posId && recipesByPosId.has(posId)) return recipesByPosId.get(posId);
    return recipesByName.get(name.trim().toLowerCase());
  }

  const [rowsState, setRowsState] = useState<RowState[]>(() =>
    rows.map((r) => {
      const existing = findMatch(r.posId, r.recipeName);
      return {
        ...r,
        kind: "dish",
        // Pick up an already-matched recipe's current Food/Drink so
        // re-importing the same menu list doesn't reset a drink back to
        // Food — only a genuinely new recipe defaults to Food.
        menuGroup: existing?.menu_group ?? "food",
        lines: [],
        pendingItemId: "",
        pendingQty: "",
      };
    })
  );
  // Items created inline (via "+ Add new item…" below) need to show up
  // in every row's picker immediately, and `items` itself is a prop --
  // App.tsx's real list only catches up once onItemsChanged() triggers
  // a refetch after this modal closes. A local overlay list keeps the
  // pickers current without waiting for that round trip.
  const [localItems, setLocalItems] = useState<CatalogItem[]>(items);

  const [newItemForRow, setNewItemForRow] = useState<number | null>(null);
  const [newItemName, setNewItemName] = useState("");
  const [newItemUnit, setNewItemUnit] = useState(BASE_UNITS[0]);
  const [newItemSaving, setNewItemSaving] = useState(false);
  const [newItemError, setNewItemError] = useState<string | null>(null);

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    created: number;
    updated: number;
    itemsCreated: string[];
    holdingsBackfilled: number;
  } | null>(null);

  function matchFor(row: RowState): Recipe | undefined {
    return findMatch(row.posId, row.recipeName);
  }

  function updateRow(i: number, patch: Partial<RowState>) {
    setRowsState((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function handleAddLine(i: number) {
    const row = rowsState[i];
    if (!row.pendingItemId || !row.pendingQty) return;
    const item = localItems.find((it) => it.id === row.pendingItemId);
    if (!item) return;
    updateRow(i, {
      lines: [...row.lines, { itemId: item.id, itemName: item.name, qty: row.pendingQty, unit: item.base_unit }],
      pendingItemId: "",
      pendingQty: "",
    });
  }

  function handleRemoveLine(rowIdx: number, lineIdx: number) {
    const row = rowsState[rowIdx];
    updateRow(rowIdx, { lines: row.lines.filter((_, idx) => idx !== lineIdx) });
  }

  async function handleCreateNewItem(rowIdx: number) {
    if (!newItemName.trim()) return;
    setNewItemSaving(true);
    setNewItemError(null);
    try {
      // sku/vat_rate left blank -- same quick-add shape used by the
      // Scan receipt modal's inline item creation; the user can flesh
      // it out properly later from the Items page.
      const created = await createItem(accessToken, {
        name: newItemName.trim(),
        sku: "",
        base_unit: newItemUnit,
        vat_rate: null,
      });
      setLocalItems((prev) => [...prev, created]);
      updateRow(rowIdx, { pendingItemId: created.id });
      setNewItemForRow(null);
      setNewItemName("");
      onItemsChanged();
    } catch (err) {
      setNewItemError(err instanceof Error ? err.message : "Could not create item.");
    } finally {
      setNewItemSaving(false);
    }
  }

  const totalLines = rowsState.reduce((sum, r) => sum + r.lines.length, 0);

  async function handleImport() {
    if (!location) return;
    setImporting(true);
    setImportError(null);
    try {
      const payload: BulkRecipeInput[] = rowsState.map((r) => {
        // A row that already matches an existing recipe (see matchFor)
        // shouldn't reset its yield_qty/yield_unit to a generic "1
        // plate" default on every re-import — someone may have already
        // corrected either on the recipe's own page. Sending "" makes
        // the backend leave both alone (see RecipeViewSet.bulk_import's
        // "only applied when provided" pattern). Only a genuinely new
        // recipe gets a real default: Food -> plate, Drink -> glass,
        // per the user's own preferred default.
        const isNew = !matchFor(r);
        const yieldUnit = r.kind === "dish" && r.menuGroup === "drink" ? "glass" : "plate";
        return {
          name: r.recipeName,
          kind: r.kind,
          yield_qty: isNew ? "1" : "",
          yield_unit: isNew ? yieldUnit : "",
          menu_price: r.kind === "dish" && r.menuPrice ? r.menuPrice : null,
          pos_id: r.posId || undefined,
          menu_category: r.menuCategory || undefined,
          menu_group: r.kind === "dish" ? r.menuGroup : undefined,
          lines: r.lines.map((l) => ({ item_id: l.itemId, item_name: l.itemName, qty: l.qty, unit: l.unit })),
        };
      });
      const res = await bulkImportRecipes(accessToken, location, payload);
      setResult({
        created: res.created,
        updated: res.updated,
        itemsCreated: res.items_created,
        holdingsBackfilled: res.holdings_backfilled.length,
      });
      if (res.items_created.length > 0 || res.holdings_backfilled.length > 0) onItemsChanged();
      onRecipesChanged();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Could not import these recipes.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide xwide" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Import menu list</h2>

        {!result && (
          <>
            <p className="hint" style={{ marginTop: -8, marginBottom: 12 }}>
              <b>{rowsState.length} recipe{rowsState.length === 1 ? "" : "s"}</b> read from {fileName}. For each
              one, mark it Food or Drink, then pick the items that go into it below — qty and unit come from the
              item itself, so there's nothing to type but a name and a quantity. A new dish defaults to
              plate-sized (or glass-sized, for a drink) — change the exact serving unit any time from the
              recipe's own page in Recipes. Leave a recipe's ingredients empty and it still imports (name, POS
              ID, category, price) — you can always add its ingredients later too.
            </p>
            {importError && <p className="error">{importError}</p>}
            {!location && <p className="error">Pick a location above before importing.</p>}

            <div style={{ maxHeight: "56vh", overflowY: "auto", paddingRight: 4 }}>
              {rowsState.map((row, i) => {
                const match = matchFor(row);
                return (
                  <div className="mli-row" key={i}>
                    <div className="mli-head">
                      <input
                        value={row.recipeName}
                        onChange={(e) => updateRow(i, { recipeName: e.target.value })}
                        style={{ fontWeight: 600, flex: "1 1 220px", minWidth: 160 }}
                      />
                      <select
                        value={row.kind}
                        onChange={(e) => updateRow(i, { kind: e.target.value as "dish" | "sub" })}
                        style={{ width: 90 }}
                      >
                        <option value="dish">Dish</option>
                        <option value="sub">Sub-recipe</option>
                      </select>
                      {row.kind === "dish" && (
                        <select
                          value={row.menuGroup}
                          onChange={(e) => updateRow(i, { menuGroup: e.target.value as "food" | "drink" })}
                          style={{ width: 78 }}
                          title="Food or drink? Drives the Champions Food/Drink split in End of day, and a new recipe's default serving unit (plate vs glass)."
                        >
                          <option value="food">Food</option>
                          <option value="drink">Drink</option>
                        </select>
                      )}
                      {row.kind === "dish" && (
                        <input
                          value={row.menuPrice}
                          onChange={(e) => updateRow(i, { menuPrice: e.target.value })}
                          placeholder="Price"
                          style={{ width: 80, textAlign: "right" }}
                        />
                      )}
                      <input
                        value={row.menuCategory}
                        onChange={(e) => updateRow(i, { menuCategory: e.target.value })}
                        placeholder="Category"
                        style={{ width: 110 }}
                      />
                      <input
                        value={row.posId}
                        onChange={(e) => updateRow(i, { posId: e.target.value })}
                        placeholder="POS ID"
                        style={{ width: 80 }}
                      />
                      {match ? (
                        <span className="badge b-low">
                          Updates existing{match.lines.filter((l) => l.line_type === "item").length > 0 ? ` (replaces ${match.lines.filter((l) => l.line_type === "item").length} ingredient${match.lines.filter((l) => l.line_type === "item").length === 1 ? "" : "s"})` : ""}
                        </span>
                      ) : (
                        <span className="badge b-ok">New recipe</span>
                      )}
                    </div>

                    {row.lines.length > 0 && (
                      <ul className="mli-lines">
                        {row.lines.map((line, li) => (
                          <li key={li}>
                            {line.itemName} — {line.qty} {line.unit}
                            <button className="rm" onClick={() => handleRemoveLine(i, li)}>
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="addrow mli-addrow">
                      <select
                        value={row.pendingItemId}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === "__new__") {
                            setNewItemForRow(i);
                            setNewItemName("");
                            setNewItemUnit(BASE_UNITS[0]);
                            setNewItemError(null);
                          } else {
                            updateRow(i, { pendingItemId: val });
                          }
                        }}
                      >
                        <option value="">Add an ingredient…</option>
                        <option value="__new__">+ Add new item…</option>
                        {localItems.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.name} ({it.base_unit})
                          </option>
                        ))}
                      </select>
                      <div className="addrow-bottom">
                        <input
                          type="number"
                          step="any"
                          min="0"
                          placeholder="Qty"
                          value={row.pendingQty}
                          onChange={(e) => updateRow(i, { pendingQty: e.target.value })}
                        />
                        <button
                          className="add-btn"
                          type="button"
                          disabled={!row.pendingItemId || !row.pendingQty}
                          onClick={() => handleAddLine(i)}
                        >
                          + Add
                        </button>
                      </div>
                    </div>

                    {newItemForRow === i && (
                      <div className="scan-new-item">
                        <input
                          value={newItemName}
                          onChange={(e) => setNewItemName(e.target.value)}
                          placeholder="Item name"
                        />
                        <select value={newItemUnit} onChange={(e) => setNewItemUnit(e.target.value)}>
                          {BASE_UNITS.map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button type="button" className="btn-ghost small" onClick={() => setNewItemForRow(null)}>
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="mini"
                            onClick={() => handleCreateNewItem(i)}
                            disabled={newItemSaving || !newItemName.trim()}
                          >
                            {newItemSaving ? "Adding…" : "Add item"}
                          </button>
                        </div>
                        {newItemError && <p className="error">{newItemError}</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="btn-ghost" type="button" onClick={onClose} disabled={importing}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleImport} disabled={importing || !location}>
                {importing
                  ? "Importing…"
                  : `Import ${rowsState.length} recipe${rowsState.length === 1 ? "" : "s"}${totalLines ? ` (${totalLines} ingredient line${totalLines === 1 ? "" : "s"})` : ""}`}
              </button>
            </div>
          </>
        )}

        {result && (
          <>
            <div className="im-note">
              ✓ {result.created > 0 && <><b>{result.created} recipe{result.created === 1 ? "" : "s"}</b> created</>}
              {result.created > 0 && result.updated > 0 && " and "}
              {result.updated > 0 && <><b>{result.updated} recipe{result.updated === 1 ? "" : "s"}</b> updated</>}
              {result.created === 0 && result.updated === 0 && "Nothing imported"}.
              {result.itemsCreated.length > 0 &&
                ` ${result.itemsCreated.length} new item${result.itemsCreated.length === 1 ? "" : "s"} created: ${result.itemsCreated.join(", ")}.`}
              {result.holdingsBackfilled > 0 &&
                ` ${result.holdingsBackfilled} matched ingredient${
                  result.holdingsBackfilled === 1 ? "" : "s"
                } got a stock holding added at this location.`}
            </div>
            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
