import { useState } from "react";
import { createPortal } from "react-dom";
import AllergenIcon from "./AllergenIcon";
import type { Allergen, Recipe } from "./api";

// The "Print sheet" for recipes, in two shapes that share one body:
//   * the sheet -- recipes in a list, grouped by menu category. The person
//     chooses what goes on it: allergens, ingredients with quantities, or
//     both; dishes, sub-recipes or both (opened from the Recipes list, for
//     every role: it never carries cost data);
//   * the card -- one recipe, large, for a single dish (RecipeDetail).
//
// Safety rules baked into the layout, not left to the reader:
//   * Contains and "May contain" are labelled in WORDS, never told apart by
//     colour alone (paper has no hover and may print in black and white).
//   * A recipe with an ingredient nobody has confirmed the allergens of is
//     marked with a dagger and counted in the footer; it never reads as
//     "no allergens".
//   * The footer says the sheet reflects what is entered in SAWIS and
//     should be checked against supplier labels.
//
// The print CSS (App.css, @media print) shows only `.print-only`, so this
// body is hidden on screen and appears alone on paper.

type RecipeKinds = "dish" | "sub" | "both";

interface AllergenSheetOptions {
  // Whether allergens are on the sheet at all. When off, the three
  // allergen filters below are ignored.
  showAllergens: boolean;
  includeMay: boolean;
  includeNone: boolean;
  // Allergen ids; null = list every recipe, otherwise only recipes with
  // at least one of these (every recipe still prints ALL of its tags).
  onlyAllergens: string[] | null;
  kinds: RecipeKinds;
}

const SUB_GROUP = "Sub-recipes (prep)";

// "120.0000" -> "120", "0.2500" -> "0.25".
function fmtQty(qty: string): string {
  const n = Number(qty);
  return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : qty;
}

function todayLabel(): string {
  return new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function Tags({ ids, allergens, size }: { ids: string[]; allergens: Allergen[]; size: number }) {
  return (
    <>
      {allergens
        .filter((a) => ids.includes(a.id))
        .map((a) => (
          <span key={a.id} className="ap-tag">
            <AllergenIcon code={a.code} size={size} />
            {a.name}
          </span>
        ))}
    </>
  );
}

function selectRecipesForSheet(candidates: Recipe[], opts: AllergenSheetOptions): Recipe[] {
  let list = candidates.filter((r) => opts.kinds === "both" || r.kind === opts.kinds);
  if (!opts.showAllergens) return list;
  if (opts.onlyAllergens) {
    const chosen = opts.onlyAllergens;
    list = list.filter((r) =>
      chosen.some((id) => r.allergens.includes(id) || (opts.includeMay && r.may_contain.includes(id)))
    );
  } else if (!opts.includeNone) {
    list = list.filter(
      (r) => r.allergens.length > 0 || (opts.includeMay && r.may_contain.length > 0) || r.unreviewed_item_count > 0
    );
  }
  return list;
}

export function AllergenSheetBody({
  recipes,
  allergens,
  venue,
  includeMay,
  scopeNote,
  variant = "sheet",
  showAllergens = true,
  showIngredients = false,
}: {
  recipes: Recipe[];
  allergens: Allergen[];
  venue: string;
  includeMay: boolean;
  scopeNote?: string;
  variant?: "sheet" | "card";
  showAllergens?: boolean;
  showIngredients?: boolean;
}) {
  const unchecked = recipes.filter((r) => r.unreviewed_item_count > 0).length;
  const groups = new Map<string, Recipe[]>();
  [...recipes]
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((r) => {
      const key = r.kind === "sub" ? SUB_GROUP : r.menu_category.trim() || "Other";
      groups.set(key, [...(groups.get(key) ?? []), r]);
    });
  const rank = (k: string) => (k === SUB_GROUP ? 2 : k === "Other" ? 1 : 0);
  const orderedGroups = [...groups.entries()].sort(
    ([a], [b]) => rank(a) - rank(b) || a.localeCompare(b)
  );
  const title =
    variant === "card" && recipes[0]
      ? recipes[0].name
      : showAllergens && showIngredients
        ? "Recipes and allergens"
        : showIngredients
          ? "Recipes"
          : "Allergen information";

  function cell(r: Recipe, size: number) {
    const hasContains = r.allergens.length > 0;
    const hasMay = includeMay && r.may_contain.length > 0;
    return (
      <>
        {hasContains && (
          <div className="ap-line">
            <span className="ap-label">Contains:</span>
            <Tags ids={r.allergens} allergens={allergens} size={size} />
          </div>
        )}
        {hasMay && (
          <div className="ap-line">
            <span className="ap-label">May contain:</span>
            <Tags ids={r.may_contain} allergens={allergens} size={size} />
          </div>
        )}
        {!hasContains && !hasMay && r.unreviewed_item_count === 0 && (
          <div className="ap-line ap-none">No allergens recorded</div>
        )}
        {r.unreviewed_item_count > 0 && (
          <div className="ap-line ap-warn">
            † {r.unreviewed_item_count} {r.unreviewed_item_count === 1 ? "ingredient" : "ingredients"} not yet
            checked — ask before serving
          </div>
        )}
      </>
    );
  }

  return (
    <div className={`print-only allergen-print ${variant === "card" ? "allergen-card" : ""}`}>
      <h1>
        {title}
        {variant === "sheet" && ` — ${venue}`}
      </h1>
      <p className="ap-meta">
        {variant === "card" ? `${venue} · ` : ""}Printed {todayLabel()}
        {scopeNote ? ` · ${scopeNote}` : ""}
      </p>

      {variant === "card" && recipes[0] ? (
        <div className="ap-card-body">{cell(recipes[0], 28)}</div>
      ) : (
        orderedGroups.map(([category, rows]) =>
          showIngredients ? (
            <div key={category} className="ap-section">
              <h2>{category}</h2>
              {rows.map((r) => (
                <div key={r.id} className="ap-recipe">
                  <div className="ap-recipe-head">
                    <b>
                      {r.name}
                      {showAllergens && r.unreviewed_item_count > 0 && " †"}
                    </b>
                    <span className="ap-yield">
                      Makes {fmtQty(r.yield_qty)} {r.yield_unit}
                    </span>
                  </div>
                  {r.lines.length === 0 ? (
                    <div className="ap-line ap-none">No ingredients entered</div>
                  ) : (
                    <table className="ap-ing">
                      <tbody>
                        {r.lines.map((l) => (
                          <tr key={l.id}>
                            <td className="ap-qty">
                              {fmtQty(l.qty)} {l.unit}
                            </td>
                            <td>
                              {l.line_type === "recipe" ? l.sub_recipe_name : l.item_name}
                              {l.line_type === "recipe" && <span className="ap-sub"> (sub-recipe)</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {showAllergens && <div className="ap-recipe-allergens">{cell(r, 14)}</div>}
                </div>
              ))}
            </div>
          ) : (
            <div key={category} className="print-report-section">
              <h2>{category}</h2>
              <table className="ap-tbl">
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="ap-name">
                        {r.name}
                        {r.unreviewed_item_count > 0 && " †"}
                      </td>
                      <td>{cell(r, 14)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )
      )}

      <p className="ap-foot">
        {showAllergens
          ? `This shows the allergen information entered in SAWIS on ${todayLabel()}. It is a guide only — check supplier labels, and ask a member of staff if you are unsure.`
          : `Recipes as entered in SAWIS on ${todayLabel()}.`}
        {showAllergens &&
          variant === "sheet" &&
          unchecked > 0 &&
          ` † ${unchecked} ${unchecked === 1 ? "recipe has" : "recipes have"} ingredients whose allergens have not been confirmed yet, so ${unchecked === 1 ? "its" : "their"} list may be incomplete.`}
        {variant === "card" && recipes[0]?.unreviewed_item_count
          ? " † Some ingredients have not been checked yet, so this list may be incomplete."
          : ""}
      </p>
    </div>
  );
}

// The options dialog opened from the Recipes list. `shown` is the list as
// currently filtered/searched on screen; `all` is every recipe.
export default function AllergenPrintSheet({
  shown,
  all,
  allergens,
  venue,
  onClose,
}: {
  shown: Recipe[];
  all: Recipe[];
  allergens: Allergen[];
  venue: string;
  onClose: () => void;
}) {
  const filtered = shown.length !== all.length;
  const [scope, setScope] = useState<"shown" | "all">(filtered ? "shown" : "all");
  const [kinds, setKinds] = useState<RecipeKinds>("dish");
  const [showAllergens, setShowAllergens] = useState(true);
  const [showIngredients, setShowIngredients] = useState(false);
  const [includeMay, setIncludeMay] = useState(true);
  const [includeNone, setIncludeNone] = useState(true);
  const [onlyChosen, setOnlyChosen] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);

  const opts: AllergenSheetOptions = {
    showAllergens,
    includeMay,
    includeNone,
    kinds,
    onlyAllergens: showAllergens && onlyChosen ? chosen : null,
  };
  const list = selectRecipesForSheet(scope === "shown" ? shown : all, opts);
  const unchecked = showAllergens ? list.filter((r) => r.unreviewed_item_count > 0).length : 0;
  const scopeBits = [
    scope === "shown" && filtered ? "current filter" : "all recipes",
    kinds === "sub" ? "sub-recipes only" : kinds === "both" ? "dishes and sub-recipes" : null,
    showAllergens && onlyChosen && chosen.length > 0
      ? `recipes with ${allergens.filter((a) => chosen.includes(a.id)).map((a) => a.name).join(", ")}`
      : null,
  ].filter(Boolean);
  const nothingToPrint = !showAllergens && !showIngredients;

  function toggleChosen(id: string) {
    setChosen((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <>
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal allergen-print-modal" onClick={(e) => e.stopPropagation()}>
          <h2>Print sheet</h2>
          <p className="hint">
            Choose what goes on the sheet. Costs and prices are never printed, so it is safe to hand to any team
            member.
          </p>

          <div className="field">
            <label>What to print</label>
            <label className="check-row">
              <input type="checkbox" checked={showAllergens} onChange={(e) => setShowAllergens(e.target.checked)} />
              Allergens
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={showIngredients}
                onChange={(e) => setShowIngredients(e.target.checked)}
              />
              Ingredients and quantities
            </label>
          </div>

          <div className="field">
            <label>Which recipes</label>
            {filtered && (
              <label className="check-row">
                <input type="radio" name="ap-scope" checked={scope === "shown"} onChange={() => setScope("shown")} />
                What is showing now ({shown.length})
              </label>
            )}
            <label className="check-row">
              <input type="radio" name="ap-scope" checked={scope === "all"} onChange={() => setScope("all")} />
              Everything ({all.length})
            </label>
          </div>

          <div className="field">
            <label>Which kind</label>
            <label className="check-row">
              <input type="radio" name="ap-kinds" checked={kinds === "dish"} onChange={() => setKinds("dish")} />
              Dishes (what is sold)
            </label>
            <label className="check-row">
              <input type="radio" name="ap-kinds" checked={kinds === "sub"} onChange={() => setKinds("sub")} />
              Sub-recipes (prep) only
            </label>
            <label className="check-row">
              <input type="radio" name="ap-kinds" checked={kinds === "both"} onChange={() => setKinds("both")} />
              Dishes and sub-recipes
            </label>
          </div>

          {showAllergens && (
            <>
              <div className="field">
                <label>Allergens</label>
                <label className="check-row">
                  <input
                    type="radio"
                    name="ap-allergens"
                    checked={!onlyChosen}
                    onChange={() => setOnlyChosen(false)}
                  />
                  List every recipe, with all of its allergens
                </label>
                <label className="check-row">
                  <input
                    type="radio"
                    name="ap-allergens"
                    checked={onlyChosen}
                    onChange={() => setOnlyChosen(true)}
                  />
                  Only recipes that have certain allergens
                </label>
                {onlyChosen && (
                  <div className="chip-row" style={{ marginTop: 8, marginBottom: 0 }}>
                    {allergens.map((a) => {
                      const active = chosen.includes(a.id);
                      return (
                        <button
                          key={a.id}
                          type="button"
                          className={`chip allergen-chip${active ? " active" : ""}`}
                          aria-pressed={active}
                          onClick={() => toggleChosen(a.id)}
                        >
                          <AllergenIcon code={a.code} size={16} />
                          {a.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="field">
                <label className="check-row">
                  <input type="checkbox" checked={includeMay} onChange={(e) => setIncludeMay(e.target.checked)} />
                  Include “May contain”
                </label>
                {!onlyChosen && (
                  <label className="check-row">
                    <input type="checkbox" checked={includeNone} onChange={(e) => setIncludeNone(e.target.checked)} />
                    Include recipes with no allergens
                  </label>
                )}
              </div>
            </>
          )}

          <p className={unchecked > 0 ? "allergen-warning" : "hint"}>
            {nothingToPrint
              ? "Tick Allergens or Ingredients to print."
              : `${list.length} ${list.length === 1 ? "recipe" : "recipes"} will print.`}
            {unchecked > 0 &&
              ` ${unchecked} of them have ingredients nobody has confirmed the allergens of yet, so they are marked † and the sheet says its list may be incomplete. Confirm those items first for a sheet you can rely on.`}
          </p>

          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={nothingToPrint || list.length === 0 || (showAllergens && onlyChosen && chosen.length === 0)}
              onClick={() => window.print()}
            >
              Print
            </button>
          </div>
        </div>
      </div>
      {createPortal(
        <AllergenSheetBody
          recipes={list}
          allergens={allergens}
          venue={venue}
          includeMay={includeMay}
          scopeNote={scopeBits.join(" · ")}
          showAllergens={showAllergens}
          showIngredients={showIngredients}
        />,
        document.body
      )}
    </>
  );
}
