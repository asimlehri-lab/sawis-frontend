import { useEffect, useState } from "react";
import {
  fetchItem,
  updateItem,
  createItemHolding,
  updateItemHolding,
  deleteItemHolding,
  fetchOnHand,
  BASE_UNITS,
  fetchItemSuppliers,
  createItemSupplier,
  deleteItem,
  login,
} from "./api";
import type { CatalogItem, Category, Location, ItemSupplierRow, SupplierItemRow, Supplier } from "./api";

interface Props {
  itemId: string;
  accessToken: string;
  userEmail: string;
  categories: Category[];
  locations: Location[];
  suppliers: Supplier[];
  supplierItems: SupplierItemRow[];
  onBack: () => void;
  onChanged: () => void;
}

const DEPARTMENTS = [
  { value: "kitchen", label: "Kitchen" },
  { value: "bar", label: "Bar" },
  { value: "foh", label: "Front of house" },
];

// Lightweight fuzzy match: token overlap between our item name and a
// supplier's raw CSV line. Never used to auto-link — only to rank
// suggestions the user reviews and confirms with the Link button.
function matchScore(itemName: string, raw: string): number {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[0-9]+(\.[0-9]+)?\s*(kg|g|ml|l|cl|oz|x|case|sack|class)?/g, " ")
      .replace(/[^a-z ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);
  const a = new Set(norm(itemName));
  const b = new Set(norm(raw));
  if (!a.size) return 0;
  let hit = 0;
  a.forEach((w) => {
    if (b.has(w) || [...b].some((x) => x.startsWith(w) || w.startsWith(x))) hit++;
  });
  return hit / a.size;
}

interface Suggestion {
  supplierItem: SupplierItemRow;
  supplierName: string;
  score: number;
}

function suggestSuppliers(
  itemName: string,
  supplierItems: SupplierItemRow[],
  suppliers: Supplier[],
  alreadyLinkedSupplierIds: Set<string>
): Suggestion[] {
  const out: Suggestion[] = [];
  supplierItems.forEach((si) => {
    if (alreadyLinkedSupplierIds.has(si.supplier)) return;
    const score = matchScore(itemName, si.raw_name);
    if (score >= 0.5) {
      const supplier = suppliers.find((s) => s.id === si.supplier);
      out.push({ supplierItem: si, supplierName: supplier?.name ?? "Unknown supplier", score });
    }
  });
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}

type Family = "weight" | "volume" | "count";
const UNIT_FAMILY: Record<string, Family> = {
  g: "weight",
  kg: "weight",
  ml: "volume",
  L: "volume",
  ea: "count",
  portion: "count",
  btl: "count",
  case: "count",
  dozen: "count",
};
const UNIT_BASE: Record<string, number> = { g: 1, kg: 1000, ml: 1, L: 1000 };

// How many `to` units per 1 `from` unit, or null if there's no fixed
// conversion (different measure types, or either side is a "count" unit).
function autoFactor(from: string, to: string): number | null {
  const famFrom = UNIT_FAMILY[from];
  const famTo = UNIT_FAMILY[to];
  if (famFrom !== famTo || famFrom === "count") return null;
  return UNIT_BASE[from] / UNIT_BASE[to];
}

export default function ItemDetail({
  itemId,
  accessToken,
  userEmail,
  categories,
  locations,
  suppliers,
  supplierItems,
  onBack,
  onChanged,
}: Props) {
  const [item, setItem] = useState<CatalogItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onHandMap, setOnHandMap] = useState<Record<string, number>>({});

  const [vatPct, setVatPct] = useState("");
  const [showAddHolding, setShowAddHolding] = useState(false);
  const [newLocation, setNewLocation] = useState("");
  const [newDept, setNewDept] = useState(DEPARTMENTS[0].value);
  const [newSection, setNewSection] = useState("");
  const [newPar, setNewPar] = useState("0");
  const [savingHolding, setSavingHolding] = useState(false);
  const [holdingError, setHoldingError] = useState<string | null>(null);

  const [showUnitModal, setShowUnitModal] = useState(false);
  const [unitNew, setUnitNew] = useState("kg");
  const [unitMode, setUnitMode] = useState<"relabel" | "convert">("relabel");
  const [unitFactor, setUnitFactor] = useState("1");
  const [savingUnit, setSavingUnit] = useState(false);
  const [unitError, setUnitError] = useState<string | null>(null);

  const [itemSuppliers, setItemSuppliers] = useState<ItemSupplierRow[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [supplierError, setSupplierError] = useState<string | null>(null);

  const [archiving, setArchiving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function reload() {
    setError(null);
    fetchItem(accessToken, itemId)
      .then((it) => {
        setItem(it);
        setVatPct(it.vat_rate ? (Number(it.vat_rate) * 100).toString() : "");
        Promise.all(
          it.holdings.map((h) =>
            fetchOnHand(accessToken, it.id, h.location, h.department).then((qty) => [h.id, qty] as const)
          )
        ).then((pairs) => setOnHandMap(Object.fromEntries(pairs)));

        fetchItemSuppliers(accessToken)
          .then((all) => {
            const forThisItem = all.filter((row) => row.item === it.id);
            setItemSuppliers(forThisItem);
            const linkedSupplierIds = new Set(forThisItem.map((row) => row.supplier));
            setSuggestions(suggestSuppliers(it.name, supplierItems, suppliers, linkedSupplierIds));
          })
          .catch(() => {});
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load item."));
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  useEffect(() => {
    if (locations.length && !newLocation) setNewLocation(locations[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations]);

  const selectedCategory = categories.find((c) => c.id === item?.category);
  const categoryDefaultPct = selectedCategory ? Number(selectedCategory.default_vat_rate) * 100 : null;
  const vatOverridden =
    categoryDefaultPct !== null && vatPct !== "" && Math.round(Number(vatPct) * 100) !== Math.round(categoryDefaultPct * 100);

  async function saveField(patch: Parameters<typeof updateItem>[2]) {
    if (!item) return;
    try {
      const updated = await updateItem(accessToken, item.id, patch);
      setItem(updated);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save changes.");
    }
  }

  function handleCategoryChange(categoryId: string) {
    if (!item) return;
    const cat = categories.find((c) => c.id === categoryId);
    const defaultVat = cat ? cat.default_vat_rate : null;
    setVatPct(defaultVat ? (Number(defaultVat) * 100).toString() : "");
    saveField({ category: categoryId || null, vat_rate: defaultVat });
  }

  function handleVatBlur() {
    const fraction = vatPct.trim() === "" ? null : (Number(vatPct) / 100).toFixed(4);
    saveField({ vat_rate: fraction });
  }

  async function handleAddHolding(e: React.FormEvent) {
    e.preventDefault();
    if (!item || !newLocation) return;
    setHoldingError(null);
    setSavingHolding(true);
    try {
      await createItemHolding(accessToken, {
        item: item.id,
        location: newLocation,
        department: newDept,
        section: newSection || null,
        par_level: newPar,
      });
      setShowAddHolding(false);
      setNewSection("");
      setNewPar("0");
      reload();
    } catch (err) {
      setHoldingError(err instanceof Error ? err.message : "Could not add holding.");
    } finally {
      setSavingHolding(false);
    }
  }

  async function handleParChange(holdingId: string, value: string) {
    try {
      await updateItemHolding(accessToken, holdingId, { par_level: value });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save par level.");
    }
  }

  async function handleRemoveHolding(holdingId: string) {
    try {
      await deleteItemHolding(accessToken, holdingId);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove holding.");
    }
  }

  async function handleLinkSupplier(sug: Suggestion) {
    if (!item) return;
    setLinkingId(sug.supplierItem.id);
    setSupplierError(null);
    try {
      await createItemSupplier(accessToken, {
        item: item.id,
        supplier: sug.supplierItem.supplier,
        unit_price: sug.supplierItem.price,
        matched_from: sug.supplierItem.id,
      });
      reload();
    } catch (err) {
      setSupplierError(err instanceof Error ? err.message : "Could not link supplier.");
    } finally {
      setLinkingId(null);
    }
  }

  async function handleToggleArchive() {
    if (!item) return;
    setArchiving(true);
    try {
      await saveField({ archived: !item.archived });
    } finally {
      setArchiving(false);
    }
  }

  async function handleConfirmDelete() {
    if (!item) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      // Re-check the password against the real login endpoint rather than
      // trusting anything typed client-side — this never touches the item
      // unless the password genuinely matches the signed-in account.
      await login(userEmail, deletePassword);
      await deleteItem(accessToken, item.id);
      onChanged();
      onBack();
    } catch (err) {
      setDeleteError(
        err instanceof Error && err.message.includes("Login failed")
          ? "That password doesn't match your account."
          : err instanceof Error
          ? err.message
          : "Could not delete this item."
      );
    } finally {
      setDeleting(false);
    }
  }

  function openUnitModal() {
    if (!item) return;
    setUnitNew(item.base_unit);
    setUnitMode("relabel");
    setUnitFactor("1");
    setUnitError(null);
    setShowUnitModal(true);
  }

  async function handleChangeUnit() {
    if (!item) return;
    const same = unitNew === item.base_unit;
    if (same) return;
    const auto = autoFactor(item.base_unit, unitNew);
    const factor = auto !== null ? auto : unitMode === "convert" ? Number(unitFactor) || 1 : 1;

    setSavingUnit(true);
    setUnitError(null);
    try {
      await updateItem(accessToken, item.id, { base_unit: unitNew });
      if (factor !== 1) {
        await Promise.all(
          item.holdings.map((h) =>
            updateItemHolding(accessToken, h.id, {
              par_level: (Number(h.par_level) * factor).toFixed(3),
            })
          )
        );
      }
      setShowUnitModal(false);
      reload();
      onChanged();
    } catch (err) {
      setUnitError(err instanceof Error ? err.message : "Could not change unit.");
    } finally {
      setSavingUnit(false);
    }
  }

  if (!item) {
    return (
      <div>
        <button className="back-link" onClick={onBack}>
          ← All items
        </button>
        {error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}
      </div>
    );
  }

  const multiDept = item.holdings.length > 1;

  return (
    <div>
      <button className="back-link" onClick={onBack}>
        ← All items
      </button>

      <div className="detail-head">
        <input
          className="name-edit"
          value={item.name}
          onChange={(e) => setItem({ ...item, name: e.target.value })}
          onBlur={(e) => saveField({ name: e.target.value })}
        />
      </div>
      <p className="muted detail-sub">
        One catalog record, shared across every department and branch.
      </p>

      {error && <p className="error">{error}</p>}

      <div className="card">
        <h2>Catalog details</h2>
        <p className="hint">Shared everywhere — change once and it updates for all departments.</p>
        <div className="fgrid fgrid-2">
          <div className="field">
            <label>SKU</label>
            <input
              value={item.sku ?? ""}
              onChange={(e) => setItem({ ...item, sku: e.target.value })}
              onBlur={(e) => saveField({ sku: e.target.value })}
              placeholder="optional"
            />
          </div>
          <div className="field">
            <label>Base unit</label>
            <div className="unit-row">
              <span className="ro">{item.base_unit}</span>
              <button type="button" className="mini" onClick={openUnitModal}>
                Change
              </button>
            </div>
          </div>
          <div className="field">
            <label>Category</label>
            <select value={item.category ?? ""} onChange={(e) => handleCategoryChange(e.target.value)}>
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>
              VAT rate % {vatOverridden && <span className="ovr">overridden</span>}
            </label>
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={vatPct}
              onChange={(e) => setVatPct(e.target.value)}
              onBlur={handleVatBlur}
            />
            {selectedCategory && (
              <div className="vhint">default for {selectedCategory.name}: {categoryDefaultPct}%</div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Stock by department</h2>
        <p className="hint">
          The same product can be held in more than one place, each with its own par level.
          {multiDept && ` Shown in lists as "${item.name} — Department".`}
        </p>
        <table className="htbl">
          <thead>
            <tr>
              <th>Department</th>
              <th>Section</th>
              <th className="num">Par level</th>
              <th className="num">On hand</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {item.holdings.length === 0 && (
              <tr>
                <td colSpan={6} className="muted empty-row">
                  Not stocked anywhere yet — add a department below.
                </td>
              </tr>
            )}
            {item.holdings.map((h) => {
              const onHand = onHandMap[h.id] ?? 0;
              const low = onHand < Number(h.par_level);
              return (
                <tr key={h.id}>
                  <td className="dispname">
                    {DEPARTMENTS.find((d) => d.value === h.department)?.label ?? h.department}
                  </td>
                  <td className="muted">{h.section_name ?? "Unassigned"}</td>
                  <td className="num">
                    <input
                      className="par-in"
                      type="number"
                      min="0"
                      step="any"
                      defaultValue={h.par_level}
                      onBlur={(e) => handleParChange(h.id, e.target.value)}
                    />{" "}
                    {item.base_unit}
                  </td>
                  <td className="num">
                    {onHand} {item.base_unit}
                  </td>
                  <td>
                    <span className={`badge ${low ? "b-low" : "b-ok"}`}>{low ? "Below par" : "In stock"}</span>
                  </td>
                  <td>
                    {item.holdings.length > 1 && (
                      <button className="rm" onClick={() => handleRemoveHolding(h.id)}>
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {!showAddHolding ? (
          <button className="addbtn" onClick={() => setShowAddHolding(true)}>
            + Add to another department
          </button>
        ) : (
          <form className="addholding" onSubmit={handleAddHolding}>
            <div className="fgrid">
              <div className="field">
                <label>Location</label>
                <select value={newLocation} onChange={(e) => setNewLocation(e.target.value)}>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Department</label>
                <select value={newDept} onChange={(e) => setNewDept(e.target.value)}>
                  {DEPARTMENTS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Par level</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={newPar}
                  onChange={(e) => setNewPar(e.target.value)}
                />
              </div>
            </div>
            {holdingError && <p className="error">{holdingError}</p>}
            <div className="modal-actions" style={{ marginTop: 12 }}>
              <button type="button" className="btn-ghost" onClick={() => setShowAddHolding(false)}>
                Cancel
              </button>
              <button className="btn-primary" type="submit" disabled={savingHolding || !locations.length}>
                {savingHolding ? "Adding…" : "Add holding"}
              </button>
            </div>
            {!locations.length && (
              <p className="error" style={{ marginTop: 8 }}>
                No locations yet — add one in the admin panel first.
              </p>
            )}
          </form>
        )}
      </div>

      <div className="card">
        <h2>Suppliers &amp; last prices</h2>
        <p className="hint">From your recorded purchase links — shared across all departments.</p>
        {itemSuppliers.length === 0 && <p className="muted">No suppliers linked yet.</p>}
        {itemSuppliers.map((row) => {
          const cheapest = itemSuppliers.reduce((min, r) =>
            Number(r.unit_price) < Number(min.unit_price) ? r : min
          );
          return (
            <div className="sup-row" key={row.id}>
              <span>
                <span className="sn">{row.supplier_name}</span>
                {row.id === cheapest.id && itemSuppliers.length > 1 && (
                  <span className="best">cheapest</span>
                )}
                {row.last_ordered_at && <div className="sd">last ordered {row.last_ordered_at}</div>}
              </span>
              <span className="sp">
                £{Number(row.unit_price).toFixed(2)}/{item.base_unit}
              </span>
            </div>
          );
        })}

        {supplierError && <p className="error">{supplierError}</p>}

        {suggestions.length > 0 && (
          <>
            <div className="sg-h">
              Other suppliers that may stock this
              <span className="sg-sub">matched by name from imported catalogues — confirm before linking</span>
            </div>
            {suggestions.map((sug) => (
              <div className="sug-row" key={sug.supplierItem.id}>
                <span className={`sg-conf ${sug.score >= 0.8 ? "hi" : "md"}`}>
                  {Math.round(sug.score * 100)}%
                </span>
                <span className="sg-info">
                  <span className="sn">{sug.supplierName}</span>
                  <div className="sd">their line: "{sug.supplierItem.raw_name}"</div>
                </span>
                <span className="sp">
                  £{Number(sug.supplierItem.price).toFixed(2)}/{sug.supplierItem.unit}
                </span>
                <button
                  className="linkbtn"
                  disabled={linkingId === sug.supplierItem.id}
                  onClick={() => handleLinkSupplier(sug)}
                >
                  {linkingId === sug.supplierItem.id ? "Linking…" : "Link"}
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="card dz-card">
        <h2 className="dz-h2">Danger zone</h2>

        <div className="dz-row">
          <div>
            <b>{item.archived ? "This item is archived" : "Archive this item"}</b>
            <p className="hint" style={{ margin: "3px 0 0" }}>
              {item.archived
                ? "Hidden from new recipes and stock counts, but every past record stays intact."
                : "Hides it from new recipes and counts without losing any history — reversible any time."}
            </p>
          </div>
          <button className="btn-ghost" onClick={handleToggleArchive} disabled={archiving}>
            {archiving ? "Saving…" : item.archived ? "Unarchive" : "Archive item"}
          </button>
        </div>

        <div className="dz-row dz-row-danger">
          <div>
            <b>Delete permanently</b>
            <p className="hint" style={{ margin: "3px 0 0" }}>
              Only possible if this item has no recorded stock movements yet. Otherwise, archive it
              instead — deleting would break the audit trail for anything already counted or purchased.
            </p>
          </div>
          {!showDeleteConfirm ? (
            <button className="btn-danger" onClick={() => setShowDeleteConfirm(true)}>
              Delete item
            </button>
          ) : null}
        </div>

        {showDeleteConfirm && (
          <div className="dz-confirm">
            <label>Enter your password to confirm</label>
            <div className="dz-confirm-row">
              <input
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                placeholder="Your account password"
              />
              <button
                className="btn-danger"
                onClick={handleConfirmDelete}
                disabled={deleting || !deletePassword}
              >
                {deleting ? "Deleting…" : "Confirm & delete"}
              </button>
              <button
                className="btn-ghost"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeletePassword("");
                  setDeleteError(null);
                }}
              >
                Cancel
              </button>
            </div>
            {deleteError && <p className="error">{deleteError}</p>}
          </div>
        )}
      </div>

      {showUnitModal && (
        <div className="modal-backdrop" onClick={() => setShowUnitModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Change unit for {item.name}</h2>
            <p className="hint" style={{ marginTop: -8, marginBottom: 16 }}>
              The unit is how this item is bought, counted and used in recipes.
            </p>
            <div className="field" style={{ marginBottom: 14 }}>
              <label>Measured in</label>
              <select value={unitNew} onChange={(e) => setUnitNew(e.target.value)}>
                {BASE_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>

            {(() => {
              const same = unitNew === item.base_unit;
              const auto = autoFactor(item.base_unit, unitNew);
              if (same) {
                return <div className="uinfo">Pick a different unit to continue.</div>;
              }
              if (auto !== null) {
                return (
                  <div className="uinfo ok">
                    <b>Same measure type</b> — converts automatically. 1 {item.base_unit} = {auto}{" "}
                    {unitNew}. Par levels are restated for you.
                  </div>
                );
              }
              return (
                <>
                  <div className="uinfo warn">
                    <b>
                      {item.base_unit} and {unitNew} measure different things
                    </b>
                    , so there's no automatic conversion.
                  </div>
                  <div className="uopts">
                    <label className={`uopt ${unitMode === "relabel" ? "on" : ""}`}>
                      <input
                        type="radio"
                        name="unitmode"
                        checked={unitMode === "relabel"}
                        onChange={() => setUnitMode("relabel")}
                      />
                      <span>
                        <b>Just relabel</b>
                        <small>Quantities stay as they are — use this if the item was simply set up with the wrong unit.</small>
                      </span>
                    </label>
                    <label className={`uopt ${unitMode === "convert" ? "on" : ""}`}>
                      <input
                        type="radio"
                        name="unitmode"
                        checked={unitMode === "convert"}
                        onChange={() => setUnitMode("convert")}
                      />
                      <span>
                        <b>Convert with a factor</b>
                        <small>
                          Restate every quantity. 1 {item.base_unit} ={" "}
                          <input
                            className="fac"
                            type="number"
                            step="any"
                            min="0"
                            value={unitFactor}
                            onChange={(e) => setUnitFactor(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                          />{" "}
                          {unitNew}
                        </small>
                      </span>
                    </label>
                  </div>
                </>
              );
            })()}

            {item.holdings.length > 0 && unitNew !== item.base_unit && (
              <div className="uprev">
                <div className="uprev-h">Preview — par levels</div>
                {item.holdings.map((h) => {
                  const auto = autoFactor(item.base_unit, unitNew);
                  const factor = auto !== null ? auto : unitMode === "convert" ? Number(unitFactor) || 1 : 1;
                  const newPar = (Number(h.par_level) * factor).toFixed(2);
                  return (
                    <div className="uprev-r" key={h.id}>
                      <span>{DEPARTMENTS.find((d) => d.value === h.department)?.label ?? h.department}</span>
                      <span>
                        {h.par_level} {item.base_unit}
                      </span>
                      <span>→</span>
                      <b>
                        {newPar} {unitNew}
                      </b>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="uinfo" style={{ marginTop: 12 }}>
              Historical stock counts stay recorded in {item.base_unit} for audit — only new activity
              uses the new unit.
            </div>

            {unitError && <p className="error">{unitError}</p>}
            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={() => setShowUnitModal(false)}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleChangeUnit}
                disabled={savingUnit || unitNew === item.base_unit}
              >
                {savingUnit ? "Saving…" : `Change to ${unitNew}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}