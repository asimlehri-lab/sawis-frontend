import { useEffect, useMemo, useState } from "react";
import { deleteCategory, deleteUnusedCategories, fetchCategories } from "./api";
import type { Category } from "./api";

// Pop-up for tidying the item categories: which ones are used, and deleting
// the ones nobody uses. Categories are created from an item's own page, so
// unused ones pile up and clutter the Items filter and every Category
// dropdown. Opens from Settings today; self-contained so the Items page can
// open it later too. A category with items can't be deleted (the server
// refuses as well) -- move its items to another category first.
export default function CategoryManagerModal({
  accessToken,
  onClose,
  onChanged,
}: {
  accessToken: string;
  onClose: () => void;
  // Called after anything is deleted, so the caller can refresh its own
  // copy of the category list (and any summary it shows).
  onChanged?: () => void;
}) {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<"unused" | "all" | null>(null);
  const [search, setSearch] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setCategories(await fetchCategories(accessToken));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load the categories.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetchCategories(accessToken)
      .then((rows) => {
        if (!cancelled) setCategories(rows);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not load the categories.");
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const unused = useMemo(() => (categories ?? []).filter((c) => (c.item_count ?? 0) === 0), [categories]);
  // Open on the tab that is most likely wanted: the unused ones, unless
  // there are none to clean up.
  const activeTab: "unused" | "all" = tab ?? (unused.length > 0 ? "unused" : "all");
  const base = activeTab === "unused" ? unused : categories ?? [];
  const q = search.trim().toLowerCase();
  const shown = q ? base.filter((c) => c.name.toLowerCase().includes(q)) : base;
  const total = (categories ?? []).length;

  function pickTab(next: "unused" | "all") {
    setTab(next);
    setConfirmId(null);
    setConfirmAll(false);
    setError(null);
    setNotice(null);
  }

  async function handleDelete(c: Category) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await deleteCategory(accessToken, c.id);
      setNotice(`Deleted ${c.name}.`);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete this category.");
      await load();
    } finally {
      setConfirmId(null);
      setBusy(false);
    }
  }

  async function handleDeleteAllUnused() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await deleteUnusedCategories(accessToken);
      setNotice(res.deleted ? `Deleted ${res.deleted} unused categor${res.deleted === 1 ? "y" : "ies"}.` : "Nothing to delete.");
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the unused categories.");
    } finally {
      setConfirmAll(false);
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Item categories">
        <h2>Item categories</h2>
        <p className="muted" style={{ fontSize: 12.5, marginTop: -8, marginBottom: 12 }}>
          Delete the categories nobody uses to keep the Items filter and Category lists short. A category that items
          still use can't be deleted — move its items to another category first.
        </p>
        {loadError && <p className="error">{loadError}</p>}
        {error && <p className="error">{error}</p>}
        {notice && !error && (
          <p style={{ margin: "0 0 10px" }}>
            <span className="badge b-ok">{notice}</span>
          </p>
        )}
        {categories === null && !loadError && <p className="muted">Loading…</p>}
        {categories !== null && (
          <>
            <div className="chip-row" style={{ marginBottom: 10 }}>
              <button type="button" className={`chip${activeTab === "unused" ? " active" : ""}`} onClick={() => pickTab("unused")}>
                Unused ({unused.length})
              </button>
              <button type="button" className={`chip${activeTab === "all" ? " active" : ""}`} onClick={() => pickTab("all")}>
                All ({total})
              </button>
            </div>
            {total > 8 && (
              <input
                placeholder="Search categories…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: "100%", marginBottom: 8 }}
              />
            )}
            <div style={{ maxHeight: "46vh", overflowY: "auto", borderTop: "1px solid var(--border)" }}>
              {!shown.length && (
                <p className="muted" style={{ margin: "14px 0" }}>
                  {q
                    ? "No category matches that."
                    : activeTab === "unused"
                      ? "No unused categories — every category has items."
                      : "No categories yet."}
                </p>
              )}
              {shown.map((c) => {
                const count = c.item_count ?? 0;
                return (
                  <div
                    key={c.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      flexWrap: "wrap",
                      padding: "7px 0",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</span>
                      <span className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
                        VAT {Math.round(Number(c.default_vat_rate) * 10000) / 100}%
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span className={`badge ${count ? "b-muted" : "b-low"}`}>
                        {count ? `${count} item${count === 1 ? "" : "s"}` : "Unused"}
                      </span>
                      {count > 0 && (
                        <button
                          type="button"
                          className="btn-ghost"
                          disabled
                          style={{ opacity: 0.45, cursor: "not-allowed", marginTop: 0 }}
                          title={`Used by ${count} item${count === 1 ? "" : "s"}`}
                        >
                          Delete
                        </button>
                      )}
                      {count === 0 && confirmId !== c.id && (
                        <button
                          type="button"
                          className="btn-ghost"
                          style={{ marginTop: 0 }}
                          disabled={busy}
                          onClick={() => {
                            setConfirmId(c.id);
                            setConfirmAll(false);
                          }}
                        >
                          Delete
                        </button>
                      )}
                      {count === 0 && confirmId === c.id && (
                        <>
                          <button type="button" className="btn-danger" disabled={busy} onClick={() => handleDelete(c)} style={{ marginTop: 0 }}>
                            {busy ? "Deleting…" : "Confirm delete"}
                          </button>
                          <button type="button" className="btn-ghost" disabled={busy} onClick={() => setConfirmId(null)} style={{ marginTop: 0 }}>
                            Cancel
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
        <div className="modal-actions" style={{ marginTop: 16, justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 8 }}>
            {categories !== null && unused.length > 1 && !confirmAll && (
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => setConfirmAll(true)}>
                Delete all {unused.length} unused
              </button>
            )}
            {confirmAll && (
              <>
                <button type="button" className="btn-danger" disabled={busy} onClick={handleDeleteAllUnused}>
                  {busy ? "Deleting…" : `Confirm: delete ${unused.length} unused`}
                </button>
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => setConfirmAll(false)}>
                  Cancel
                </button>
              </>
            )}
          </div>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
