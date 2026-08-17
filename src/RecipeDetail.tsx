import { useEffect, useState } from "react";
import {
  fetchRecipe,
  updateRecipe,
  createRecipeLine,
  deleteRecipeLine,
  YIELD_UNITS,
} from "./api";
import type { Recipe, CatalogItem } from "./api";

const TARGET_FC = 30;

interface Props {
  recipeId: string;
  accessToken: string;
  items: CatalogItem[];
  allRecipes: Recipe[];
  onBack: () => void;
  onChanged: () => void;
  onOpenRecipe: (id: string) => void;
}

export default function RecipeDetail({
  recipeId,
  accessToken,
  items,
  allRecipes,
  onBack,
  onChanged,
  onOpenRecipe,
}: Props) {
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [addItemId, setAddItemId] = useState("");
  const [addItemQty, setAddItemQty] = useState("0.1");
  const [addSubId, setAddSubId] = useState("");
  const [addSubQty, setAddSubQty] = useState("1");
  const [savingLine, setSavingLine] = useState(false);

  function reload() {
    setError(null);
    fetchRecipe(accessToken, recipeId)
      .then(setRecipe)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load recipe."));
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeId]);

  useEffect(() => {
    if (items.length && !addItemId) setAddItemId(items[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const subRecipeChoices = allRecipes.filter((r) => r.kind === "sub" && r.id !== recipeId);

  useEffect(() => {
    if (subRecipeChoices.length && !addSubId) setAddSubId(subRecipeChoices[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subRecipeChoices.length]);

  async function saveField(patch: Parameters<typeof updateRecipe>[2]) {
    if (!recipe) return;
    try {
      const updated = await updateRecipe(accessToken, recipe.id, patch);
      setRecipe(updated);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save changes.");
    }
  }

  async function handleAddItem() {
    if (!recipe || !addItemId) return;
    const item = items.find((i) => i.id === addItemId);
    if (!item) return;
    setSavingLine(true);
    setError(null);
    try {
      await createRecipeLine(accessToken, {
        recipe: recipe.id,
        line_type: "item",
        item: addItemId,
        qty: addItemQty,
        unit: item.base_unit,
      });
      reload();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add item.");
    } finally {
      setSavingLine(false);
    }
  }

  async function handleAddSub() {
    if (!recipe || !addSubId) return;
    const sub = subRecipeChoices.find((r) => r.id === addSubId);
    if (!sub) return;
    setSavingLine(true);
    setError(null);
    try {
      await createRecipeLine(accessToken, {
        recipe: recipe.id,
        line_type: "recipe",
        sub_recipe: addSubId,
        qty: addSubQty,
        unit: sub.yield_unit,
      });
      reload();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add sub-recipe.");
    } finally {
      setSavingLine(false);
    }
  }

  async function handleRemoveLine(lineId: string) {
    setError(null);
    try {
      await deleteRecipeLine(accessToken, lineId);
      reload();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove ingredient.");
    }
  }

  if (!recipe) {
    return (
      <div>
        <button className="back-link" onClick={onBack}>
          ← All recipes
        </button>
        {error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}
      </div>
    );
  }

  const isSub = recipe.kind === "sub";
  const fcOver = recipe.plate_food_cost_pct !== null && recipe.plate_food_cost_pct > TARGET_FC;
  const yieldNum = Number(recipe.yield_qty) || 1;
  const menuPriceNum = recipe.menu_price ? Number(recipe.menu_price) : 0;

  return (
    <div>
      <button className="back-link" onClick={onBack}>
        ← All recipes
      </button>

      <div className="detail-head">
        <input
          className="name-edit"
          value={recipe.name}
          onChange={(e) => setRecipe({ ...recipe, name: e.target.value })}
          onBlur={(e) => saveField({ name: e.target.value })}
          placeholder={`Name this ${isSub ? "sub-recipe" : "dish"}…`}
        />
        <span className={`kind-tag ${recipe.kind}`}>{isSub ? "SUB-RECIPE" : "DISH"}</span>
      </div>
      <p className="muted detail-sub">
        {isSub
          ? "In-house prep used inside other recipes — costed per portion."
          : "Ingredient costs pull live from inventory and any sub-recipes used."}
      </p>

      {error && <p className="error">{error}</p>}

      <div className="det-grid">
        <div className="card">
          <h2>Batch recipe — makes {recipe.yield_qty} {recipe.yield_unit}{yieldNum > 1 ? "s" : ""}</h2>
          <p className="hint">Enter quantities for one full batch. Cost per {recipe.yield_unit} = batch ÷ yield.</p>

          <table className="ing-tbl">
            <thead>
              <tr>
                <th>Ingredient</th>
                <th className="num">Qty</th>
                <th className="num">Unit cost</th>
                <th className="num">Line cost</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recipe.lines.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted empty-row">
                    No ingredients yet — add items or a sub-recipe below.
                  </td>
                </tr>
              )}
              {recipe.lines.map((line) => (
                <tr key={line.id}>
                  <td>
                    {line.line_type === "recipe" ? (
                      <>
                        <span
                          className="sub-link"
                          onClick={() => line.sub_recipe && onOpenRecipe(line.sub_recipe)}
                        >
                          {line.sub_recipe_name}
                        </span>
                        <span className="sub-tag">sub-recipe</span>
                      </>
                    ) : (
                      line.item_name
                    )}
                  </td>
                  <td className="num">
                    {line.qty} {line.unit}
                  </td>
                  <td className="num">£{Number(line.unit_cost).toFixed(2)}</td>
                  <td className="num">£{Number(line.line_cost).toFixed(2)}</td>
                  <td>
                    <button className="rm" onClick={() => handleRemoveLine(line.id)}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="add-block">
            <div className="add-col">
              <div className="add-lbl">Add an inventory item</div>
              <div className="addrow">
                <select value={addItemId} onChange={(e) => setAddItemId(e.target.value)}>
                  {items.map((it) => (
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
                    value={addItemQty}
                    onChange={(e) => setAddItemQty(e.target.value)}
                  />
                  <button className="add-btn" disabled={savingLine || !items.length} onClick={handleAddItem}>
                    + Add
                  </button>
                </div>
              </div>
            </div>

            <div className="add-col sub-col">
              <div className="add-lbl violet">
                Add a sub-recipe <span className="sub-tag">in-house prep</span>
              </div>
              {subRecipeChoices.length > 0 ? (
                <div className="addrow">
                  <select value={addSubId} onChange={(e) => setAddSubId(e.target.value)}>
                    {subRecipeChoices.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} — £{r.per_portion_cost.toFixed(2)}/{r.yield_unit}
                      </option>
                    ))}
                  </select>
                  <div className="addrow-bottom">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={addSubQty}
                      onChange={(e) => setAddSubQty(e.target.value)}
                    />
                    <button className="add-btn violet-btn" disabled={savingLine} onClick={handleAddSub}>
                      + Add
                    </button>
                  </div>
                </div>
              ) : (
                <p className="sub-empty">
                  No sub-recipes yet. Create one from <b>+ New recipe → A sub-recipe</b> and it'll appear
                  here to drop into any dish.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="yield-row">
            <label>Batch yields</label>
            <input
              className="yield-in"
              type="number"
              min="1"
              step="1"
              value={recipe.yield_qty}
              onChange={(e) => setRecipe({ ...recipe, yield_qty: e.target.value })}
              onBlur={(e) => saveField({ yield_qty: e.target.value })}
            />
            <select
              className="yunit"
              value={recipe.yield_unit}
              onChange={(e) => {
                setRecipe({ ...recipe, yield_unit: e.target.value });
                saveField({ yield_unit: e.target.value });
              }}
            >
              {YIELD_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>

          {isSub ? (
            <>
              <div className="metric big-m">
                <span className="ml">Batch cost</span>
                <span className="mv">£{recipe.batch_cost.toFixed(2)}</span>
              </div>
              <div className="metric big-m">
                <span className="ml">Cost per {recipe.yield_unit}</span>
                <span className="mv violet-text">£{recipe.per_portion_cost.toFixed(2)}</span>
              </div>
              <div className="perplate">
                Change an ingredient here and every dish using this sub-recipe re-costs automatically —
                no double entry.
              </div>
            </>
          ) : (
            <>
              <div className="price-row">
                <label>Menu price / plate</label>
                <input
                  className="price-in"
                  type="number"
                  min="0"
                  step="0.01"
                  value={recipe.menu_price ?? ""}
                  onChange={(e) => setRecipe({ ...recipe, menu_price: e.target.value })}
                  onBlur={(e) => saveField({ menu_price: e.target.value })}
                />
              </div>
              <div className="price-row">
                <label>Food or drink?</label>
                <select
                  className="price-in"
                  style={{ textAlign: "left" }}
                  value={recipe.menu_group}
                  onChange={(e) => {
                    const menu_group = e.target.value as "food" | "drink";
                    setRecipe({ ...recipe, menu_group });
                    saveField({ menu_group });
                  }}
                >
                  <option value="food">Food</option>
                  <option value="drink">Drink</option>
                </select>
              </div>
              <p className="hint" style={{ marginTop: -8 }}>
                Only used to split End of day's Champions ranking into Dishes/Drinks — doesn't affect costing.
              </p>
              <div className="fc-hero">
                <div className={`big ${fcOver ? "over" : "good"}`}>
                  {recipe.plate_food_cost_pct !== null ? `${recipe.plate_food_cost_pct.toFixed(1)}%` : "—"}
                </div>
                <div className="tgt">food cost / plate · target {TARGET_FC}%</div>
                <div className="meter">
                  <div
                    className="fill"
                    style={{
                      width: `${Math.min(recipe.plate_food_cost_pct ?? 0, 100)}%`,
                      background: fcOver ? "#C2611D" : "#1D6B4F",
                    }}
                  />
                  <div className="tgtm" />
                </div>
              </div>
              <div className="metric">
                <span className="ml">
                  Batch cost ({recipe.yield_qty} {recipe.yield_unit}
                  {yieldNum > 1 ? "s" : ""})
                </span>
                <span className="mv">£{recipe.batch_cost.toFixed(2)}</span>
              </div>
              <div className="metric big-m">
                <span className="ml">Cost per plate</span>
                <span className="mv">£{recipe.per_portion_cost.toFixed(2)}</span>
              </div>
              <div className="metric">
                <span className="ml">Gross profit / plate</span>
                <span className="mv">£{(menuPriceNum - recipe.per_portion_cost).toFixed(2)}</span>
              </div>
              <div className="perplate">
                One batch makes <b>{recipe.yield_qty} plate{yieldNum > 1 ? "s" : ""}</b> at{" "}
                <b>£{menuPriceNum.toFixed(2)}</b> each — batch sales value{" "}
                <b>£{(menuPriceNum * yieldNum).toFixed(2)}</b>, batch profit{" "}
                <b>£{(menuPriceNum * yieldNum - recipe.batch_cost).toFixed(2)}</b>.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}