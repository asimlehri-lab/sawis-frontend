import { useEffect, useMemo, useRef, useState } from "react";
import { createRole, deleteRole, fetchPermissionCatalog, fetchRoles, resetRole, updateRole } from "./api";
import type { PermissionArea, PermissionCatalog, PermissionRow, RoleRow } from "./api";
import "./Roles.css";

// Settings > Roles: the Admin creates roles, switches things on or off for each, and deletes the ones no longer needed.
// The people-picking happens on the Team screen. The server enforces everything; this screen only edits the lists.

interface Props {
  accessToken: string;
}

type Filter = "all" | "on" | "off" | "chg";

type Modal =
  | { type: "new"; name: string; from: string }
  | { type: "delete"; id: string; moveTo: string }
  | { type: "reset"; id: string }
  | null;

// What each menu item needs, to draw "what this role sees in the menu".
const MENU: { label: string; key: string | null }[] = [
  { label: "End of day", key: null },
  { label: "Inventory", key: "stock.view" },
  { label: "Procurement", key: "po.view" },
  { label: "Items", key: "items.view" },
  { label: "Recipes", key: "rec.view" },
  { label: "Waste log", key: "waste.log" },
  { label: "Reports", key: "rep.view" },
  { label: "Team", key: "team.view" },
];

const SETTINGS_KEYS = ["set.locations", "set.catalogue", "set.pos", "set.ai", "set.roles", "set.account"];

export default function RolesPanel({ accessToken }: Props) {
  const [roles, setRoles] = useState<RoleRow[] | null>(null);
  const [catalog, setCatalog] = useState<PermissionCatalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  // The switches as they are being edited (not saved until Save is pressed), plus the name and description.
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set(["eod", "items"]));
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchRoles(accessToken), fetchPermissionCatalog(accessToken)])
      .then(([r, c]) => {
        if (cancelled) return;
        setRoles(r);
        setCatalog(c);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Could not load the roles. Reload the page to try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const rows = useMemo(() => (catalog ? catalog.areas.flatMap((a) => a.keys) : []), [catalog]);
  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const always = useMemo(() => new Set(catalog?.always ?? []), [catalog]);

  function flash(message: string) {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4500);
  }

  // Turning a switch on also turns on what it needs; turning one off also turns off what needs it.
  function toggle(set: Set<string>, key: string, on: boolean): { next: Set<string>; message: string | null } {
    const next = new Set(set);
    if (on) {
      const added: string[] = [];
      let cur: string | null = key;
      while (cur) {
        if (!next.has(cur)) {
          next.add(cur);
          if (cur !== key) added.push(byKey.get(cur)?.title ?? cur);
        }
        cur = byKey.get(cur)?.requires ?? null;
      }
      return { next, message: added.length ? `Also switched on what it needs: ${added.join(", ")}.` : null };
    }
    const removed: string[] = [];
    const drop = (k: string) => {
      if (!next.has(k) || always.has(k)) return;
      next.delete(k);
      if (k !== key) removed.push(byKey.get(k)?.title ?? k);
      rows.filter((r) => r.requires === k).forEach((r) => drop(r.key));
    };
    drop(key);
    return { next, message: removed.length ? `Also switched off what depends on it: ${removed.join(", ")}.` : null };
  }

  const role = roles?.find((r) => r.id === editId) ?? null;
  const saved = useMemo(() => new Set(role?.permissions ?? []), [role]);
  const perms = draft ?? saved;
  const readOnly = !!role && role.is_builtin && role.key === "admin";
  const dirtyKeys = rows.filter((r) => draft && draft.has(r.key) !== saved.has(r.key)).map((r) => r.key);
  const metaDirty = !!role && !role.is_builtin && (draftName.trim() !== role.name || draftDesc !== role.description);
  const dirty = dirtyKeys.length > 0 || metaDirty;

  function openEditor(r: RoleRow) {
    setEditId(r.id);
    setDraft(null);
    setDraftName(r.name);
    setDraftDesc(r.description);
    setFilter("all");
    setQuery("");
    setNote(null);
    setError(null);
  }

  function closeEditor() {
    setEditId(null);
    setDraft(null);
    setNote(null);
    setError(null);
  }

  function flip(key: string) {
    const on = !perms.has(key);
    const { next, message } = toggle(perms, key, on);
    setDraft(next);
    setNote(message);
  }

  function flipGroup(area: PermissionArea) {
    const editable = area.keys.filter((k) => !k.locked && !k.always);
    const allOn = editable.every((k) => perms.has(k.key));
    let next = new Set(perms);
    for (const k of editable) next = toggle(next, k.key, !allOn).next;
    setDraft(next);
    setNote(null);
  }

  async function save() {
    if (!role) return;
    setBusy(true);
    setError(null);
    try {
      const patch: { name?: string; description?: string; permissions?: string[] } = {};
      if (dirtyKeys.length > 0) patch.permissions = [...perms];
      if (!role.is_builtin && draftName.trim() !== role.name) patch.name = draftName.trim();
      if (!role.is_builtin && draftDesc !== role.description) patch.description = draftDesc;
      const updated = await updateRole(accessToken, role.id, patch);
      setRoles((prev) => prev?.map((r) => (r.id === updated.id ? updated : r)) ?? prev);
      setDraft(null);
      setDraftName(updated.name);
      setDraftDesc(updated.description);
      setNote(null);
      flash(
        updated.people.length > 0
          ? `Saved. The ${updated.people.length} ${updated.people.length === 1 ? "person" : "people"} with this role will see the change the next time they open SAWIS.`
          : "Saved."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the role.");
    } finally {
      setBusy(false);
    }
  }

  async function create(name: string, from: string | null) {
    setBusy(true);
    setError(null);
    try {
      const made = await createRole(accessToken, { name: name.trim(), start_from: from });
      setRoles((prev) => (prev ? [...prev, made] : prev));
      setModal(null);
      openEditor(made);
      flash("Role created. Now switch on what they need.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the role.");
    } finally {
      setBusy(false);
    }
  }

  async function duplicate(r: RoleRow) {
    setBusy(true);
    try {
      const copy = await createRole(accessToken, { name: `Copy of ${r.name}`, start_from: r.id });
      setRoles((prev) => (prev ? [...prev, copy] : prev));
      openEditor(copy);
      flash("Copied. Rename it and change what you need.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not copy the role.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete(id: string, moveTo: string) {
    setBusy(true);
    setError(null);
    try {
      const gone = roles?.find((r) => r.id === id);
      await deleteRole(accessToken, id, gone && gone.people.length > 0 ? moveTo : undefined);
      // The people moved now have another role: reload so the lists show them there.
      const fresh = await fetchRoles(accessToken);
      setRoles(fresh);
      setModal(null);
      closeEditor();
      flash(gone ? `“${gone.name}” deleted.` : "Role deleted.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the role.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmReset(id: string) {
    setBusy(true);
    setError(null);
    try {
      const updated = await resetRole(accessToken, id);
      setRoles((prev) => prev?.map((r) => (r.id === updated.id ? updated : r)) ?? prev);
      setDraft(null);
      setModal(null);
      flash(`${updated.name} is back to its default.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reset the role.");
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <p className="error">{loadError}</p>;
  if (!roles || !catalog) return <p className="muted">Loading roles…</p>;

  const total = rows.length;
  const hasMoney = (keys: string[]) => keys.some((k) => k !== "waste.value" && byKey.get(k)?.flags.includes("money"));
  const hasWasteValueOnly = (keys: string[]) => !hasMoney(keys) && keys.some((k) => byKey.get(k)?.flags.includes("money"));
  const hasDelete = (keys: string[]) => keys.some((k) => byKey.get(k)?.flags.includes("danger"));

  /* ---------- list ---------- */
  if (!role) {
    return (
      <>
        <div className="rl-pagehead">
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>Roles and permissions</h2>
            <p>Decide what each role can see and do. Then choose a role for each person on the Team screen.</p>
          </div>
          <button type="button" className="btn-primary rl-btn" onClick={() => { setError(null); setModal({ type: "new", name: "", from: "staff" }); }}>
            + New role
          </button>
        </div>
        <div className="rl-banner">
          <span aria-hidden>ℹ️</span>
          <span>
            The built-in roles start as SAWIS has always worked, except that Staff do not see item costs or recipe costs and
            margins until you switch them on. Admin cannot be edited. Roles you create can be deleted at any time; people who
            have one are moved to another role first. Only Admins can see this screen.
          </span>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="rl-cards">
          {roles.map((r) => {
            const keys = r.key === "admin" ? rows.map((x) => x.key) : r.permissions;
            const money = hasMoney(keys);
            const wasteOnly = hasWasteValueOnly(keys);
            return (
              <div className="rl-card" key={r.id}>
                <div>
                  <h3>
                    {r.name} {r.is_builtin ? <span className="tag">Built in</span> : <span className="tag warn">Custom</span>}
                  </h3>
                  <div className="sub">{r.description || "No description yet."}</div>
                  <div className="rl-people">
                    {r.people.length > 0 ? (
                      r.people.slice(0, 8).map((p) => (
                        <span className="rl-chip" key={p.membership}>{p.name}</span>
                      ))
                    ) : (
                      <span className="rl-chip none">Nobody yet</span>
                    )}
                    {r.people.length > 8 && <span className="rl-chip none">+{r.people.length - 8} more</span>}
                  </div>
                </div>
                <div className="rl-meter">
                  <div><b style={{ color: "var(--ink)" }}>{r.key === "admin" ? "Everything" : `${r.permission_count} of ${total} permissions on`}</b></div>
                  <div className="bar"><i style={{ width: `${(r.permission_count / Math.max(total, 1)) * 100}%` }} /></div>
                  <div className="tags">
                    {money ? (
                      <span className="rl-flag money">Sees money figures</span>
                    ) : (
                      <span className="rl-flag alw">{wasteOnly ? "Costs hidden, sees waste value" : "No money figures"}</span>
                    )}
                    {hasDelete(keys) && <span className="rl-flag danger">Can delete</span>}
                  </div>
                </div>
                <div className="rl-actions">
                  {r.key === "admin" && <span className="rl-lock">🔒 Fixed</span>}
                  <button type="button" className="btn-ghost rl-btn" onClick={() => openEditor(r)}>
                    {r.key === "admin" ? "View" : "Edit"}
                  </button>
                  <button type="button" className="btn-ghost rl-btn" disabled={busy} onClick={() => duplicate(r)}>
                    Duplicate
                  </button>
                  {!r.is_builtin && (
                    <button type="button" className="btn-danger rl-btn" style={{ padding: "7px 12px", fontSize: 13, marginTop: 0 }} onClick={() => { setError(null); setModal({ type: "delete", id: r.id, moveTo: "staff" }); }}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {renderModal()}
        {toast && <div className="rl-toast" role="status">{toast}</div>}
      </>
    );
  }

  /* ---------- editor ---------- */
  const q = query.trim().toLowerCase();
  const visibleAreas = catalog.areas
    .map((area) => ({
      area,
      rows: area.keys.filter((r) => {
        if (q && !`${r.title} ${r.hint}`.toLowerCase().includes(q)) return false;
        const on = perms.has(r.key);
        if (filter === "on" && !on) return false;
        if (filter === "off" && on) return false;
        if (filter === "chg" && saved.has(r.key) === on) return false;
        return true;
      }),
    }))
    .filter((x) => x.rows.length > 0);

  const menuOn = (key: string | null) => key === null || perms.has(key);
  const seesSettings = SETTINGS_KEYS.some((k) => perms.has(k));

  return (
    <>
      <button type="button" className="rl-crumb" onClick={closeEditor}>← All roles</button>
      <div className="rl-edit-head">
        {role.is_builtin ? (
          <h2 className="rl-title">{role.name}</h2>
        ) : (
          <input className="rl-name" value={draftName} onChange={(e) => setDraftName(e.target.value)} aria-label="Role name" maxLength={60} />
        )}
        {role.is_builtin ? <span className="tag">Built in</span> : <span className="tag warn">Custom</span>}
        <span className="grow" />
        {role.is_builtin && !readOnly && (
          <button type="button" className="btn-ghost rl-btn" onClick={() => { setError(null); setModal({ type: "reset", id: role.id }); }}>Reset to default</button>
        )}
        <button type="button" className="btn-ghost rl-btn" disabled={busy} onClick={() => duplicate(role)}>Duplicate</button>
        {!role.is_builtin && (
          <button type="button" className="btn-danger rl-btn" style={{ padding: "9px 15px", fontSize: 13, marginTop: 0 }} onClick={() => { setError(null); setModal({ type: "delete", id: role.id, moveTo: "staff" }); }}>
            Delete role
          </button>
        )}
      </div>

      {readOnly && (
        <div className="rl-banner warn">
          <span aria-hidden>🔒</span>
          <span><b>Admin cannot be changed.</b> It always has every permission, so nobody can lock themselves out of SAWIS.</span>
        </div>
      )}
      {role.key === "staff" && !perms.has("items.costs") && !perms.has("rec.costs") && !readOnly && (
        <div className="rl-banner">
          <span aria-hidden>ℹ️</span>
          <span>
            <b>Costs are hidden for Staff by default.</b> Recipe costs and margins and item costs are off; the menu price stays
            visible. Switch them on if you want Staff to have them. Waste value is on, because staff log waste and see what it
            was worth.
          </span>
        </div>
      )}
      {note && <div className="rl-banner warn"><span aria-hidden>↳</span><span>{note}</span></div>}
      {error && <p className="error">{error}</p>}

      <div className="rl-editor">
        <div>
          <div className="rl-tools">
            <input type="search" placeholder="Find a permission, e.g. “delete” or “costs”" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a permission" />
            <div className="rl-seg" role="group" aria-label="Show">
              {([["all", "All"], ["on", "On"], ["off", "Off"], ["chg", "Changed"]] as [Filter, string][]).map(([k, l]) => (
                <button type="button" key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l}</button>
              ))}
            </div>
          </div>
          <div className="rl-legend">
            <span className="rl-flag money">Money</span> shows costs, prices or sales figures
            <span className="rl-flag danger">Delete</span> removes records
            <span className="rl-flag lock">Admin only</span> cannot be given to other roles
          </div>

          {visibleAreas.length === 0 && <div className="rl-empty">Nothing matches. Clear the search or the filter.</div>}
          {visibleAreas.map(({ area, rows: shown }) => {
            const onCount = area.keys.filter((r) => perms.has(r.key)).length;
            const editable = area.keys.filter((r) => !r.locked && !r.always);
            const allOn = editable.length > 0 && editable.every((r) => perms.has(r.key));
            const isOpen = open.has(area.id) || !!q || filter !== "all";
            return (
              <section className={`rl-group ${isOpen ? "open" : ""}`} key={area.id}>
                <button
                  type="button"
                  className="rl-ghead"
                  aria-expanded={isOpen}
                  onClick={() => setOpen((prev) => { const n = new Set(prev); if (n.has(area.id)) n.delete(area.id); else n.add(area.id); return n; })}
                >
                  <span className="chev" aria-hidden>▶</span>
                  <span className="gt"><b>{area.name}</b><span>{area.sub}</span></span>
                  <span className={`count ${onCount === area.keys.length ? "all" : onCount === 0 ? "none" : ""}`}>
                    {onCount === 0 ? "All off" : onCount === area.keys.length ? "All on" : `${onCount} of ${area.keys.length} on`}
                  </span>
                </button>
                <div className="rl-rows">
                  {!readOnly && editable.length > 0 && (
                    <div className="rl-row" style={{ background: "var(--bg)" }}>
                      <button type="button" className="switch" role="switch" aria-checked={allOn} aria-label={`Turn the whole group ${allOn ? "off" : "on"}`} onClick={() => flipGroup(area)} />
                      <div><div className="t">Turn the whole group {allOn ? "off" : "on"}</div></div>
                      <span />
                    </div>
                  )}
                  {shown.map((r) => renderRow(r))}
                </div>
              </section>
            );
          })}
        </div>

        <aside className="rl-side">
          <div className="rl-box">
            <h4>About this role</h4>
            {role.is_builtin ? (
              <div style={{ fontSize: 13, lineHeight: 1.5 }}>{role.description}</div>
            ) : (
              <textarea value={draftDesc} onChange={(e) => setDraftDesc(e.target.value)} aria-label="Description" placeholder="Describe who this role is for." maxLength={300} />
            )}
          </div>
          <div className="rl-box">
            <h4>Who has this role</h4>
            <div className="who">
              {role.people.length === 0 && <span className="muted" style={{ fontSize: 13 }}>Nobody yet.</span>}
              {role.people.map((p) => (
                <div className="row" key={p.membership}>
                  <div className="ava">{p.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</div>
                  <div><div>{p.name}</div><small>{p.location ?? "All locations"}</small></div>
                </div>
              ))}
              <div className="hint" style={{ margin: 0 }}>Give this role to someone on the Team screen.</div>
            </div>
          </div>
          <div className="rl-box prev">
            <h4>What this role sees in the menu</h4>
            <div className="rl-prev">
              {MENU.map((m) => {
                const on = menuOn(m.key);
                const sub =
                  m.label === "End of day"
                    ? `Actions: own tasks${perms.has("actions.overview") ? " and overview" : ""}${perms.has("sales.view") ? ", Sales" : ""}${perms.has("reorder.use") ? ", Reorder" : ""}`
                    : m.label === "Inventory" && on && !perms.has("stock.live")
                    ? "Count sheets only"
                    : m.label === "Procurement" && on
                    ? perms.has("po.edit") ? "Can order and receive" : "View and receive only"
                    : (m.label === "Items" && on && !perms.has("items.costs")) || (m.label === "Recipes" && on && !perms.has("rec.costs"))
                    ? "Costs hidden"
                    : "";
                return (
                  <div key={m.label}>
                    <div className={`it ${on ? "on" : "off"}`}><span className="tick">{on ? "✓" : "–"}</span>{m.label}</div>
                    {sub && on && <div className="sub">{sub}</div>}
                  </div>
                );
              })}
              <div className={`it ${seesSettings ? "on" : "off"}`}><span className="tick">{seesSettings ? "✓" : "–"}</span>Settings</div>
            </div>
            <p className="hint">Updates as you flip switches. Reading lists such as items and recipes stays open to anyone signed in so lookups keep working; the switches decide what a person can do and which screens and figures they see.</p>
          </div>
        </aside>
      </div>

      {!readOnly && (
        <div className="rl-savebar">
          <div className="msg">
            {dirty ? <b>{dirtyKeys.length > 0 ? `${dirtyKeys.length} unsaved ${dirtyKeys.length === 1 ? "change" : "changes"}` : "Unsaved changes"}</b> : "No changes yet"}
            <small>Changes apply to everyone with this role the next time they open SAWIS.</small>
          </div>
          <button type="button" className="btn-ghost rl-btn" disabled={!dirty || busy} onClick={() => { setDraft(null); setDraftName(role.name); setDraftDesc(role.description); setNote(null); }}>Discard</button>
          <button type="button" className="btn-primary rl-btn" disabled={!dirty || busy || (!role.is_builtin && !draftName.trim())} onClick={save}>{busy ? "Saving…" : "Save changes"}</button>
        </div>
      )}
      {renderModal()}
      {toast && <div className="rl-toast" role="status">{toast}</div>}
    </>
  );

  function renderRow(r: PermissionRow) {
    const on = perms.has(r.key);
    const disabled = readOnly || r.locked || r.always;
    const changed = draft !== null && saved.has(r.key) !== on;
    return (
      <div className={`rl-row ${r.requires ? "sub" : ""} ${on ? "" : "off"} ${r.locked || r.always ? "locked" : ""}`} key={r.key}>
        <button type="button" className="switch" role="switch" aria-checked={on} aria-label={r.title} disabled={disabled} onClick={() => flip(r.key)} />
        <div><div className="t">{r.title}</div><div className="h">{r.hint}</div></div>
        <div className="rl-flags">
          {changed && <span className="rl-flag chg">Changed</span>}
          {r.flags.includes("money") && <span className="rl-flag money" title="Shows costs, prices or sales figures">Money</span>}
          {r.flags.includes("danger") && <span className="rl-flag danger" title="Removes records">Delete</span>}
          {r.flags.includes("lock") && <span className="rl-flag lock" title="Can only ever be held by an Admin">Admin only</span>}
          {r.always && <span className="rl-flag alw">Always on</span>}
        </div>
      </div>
    );
  }

  /* ---------- modals ---------- */
  function renderModal() {
    if (!modal || !roles) return null;
    let body: React.ReactNode = null;
    if (modal.type === "new") {
      const m = modal;
      const choices = roles.filter((r) => r.key !== "admin");
      body = (
        <>
          <h2>New role</h2>
          <div className="fld">
            <label htmlFor="nr-name">Role name</label>
            <input id="nr-name" type="text" autoFocus maxLength={60} placeholder="e.g. Sous chef, Shift lead, Accountant" value={m.name} onChange={(e) => setModal({ ...m, name: e.target.value })} />
          </div>
          <div className="fld">
            <label>Start from</label>
            <label className="opt">
              <input type="radio" name="nr-from" checked={m.from === ""} onChange={() => setModal({ ...m, from: "" })} />
              <b>Start blank</b>
              <span className="d">Only the basics are on. You switch on what they need.</span>
            </label>
            {choices.map((r) => (
              <label className="opt" key={r.id}>
                <input type="radio" name="nr-from" checked={m.from === r.id || (m.from === "staff" && r.key === "staff")} onChange={() => setModal({ ...m, from: r.id })} />
                <b>Copy of {r.name}</b>
                <span className="d">{r.description}</span>
              </label>
            ))}
          </div>
          {error && <p className="error">{error}</p>}
          <div className="acts">
            <button type="button" className="btn-ghost rl-btn" onClick={() => setModal(null)}>Cancel</button>
            <button
              type="button"
              className="btn-primary rl-btn"
              disabled={busy || !m.name.trim()}
              onClick={() => {
                const staff = roles.find((r) => r.key === "staff");
                const from = m.from === "staff" ? staff?.id ?? null : m.from || null;
                create(m.name, from);
              }}
            >
              Create and edit
            </button>
          </div>
        </>
      );
    } else if (modal.type === "delete") {
      const m = modal;
      const gone = roles.find((r) => r.id === m.id);
      if (!gone) return null;
      const others = roles.filter((r) => r.id !== gone.id && r.key !== "admin");
      const moveTo = others.some((r) => r.key === m.moveTo) ? others.find((r) => r.key === m.moveTo)!.id : m.moveTo;
      body = (
        <>
          <h2>Delete “{gone.name}”?</h2>
          {gone.people.length > 0 ? (
            <>
              <p className="lead">
                <b>{gone.people.map((p) => p.name).join(", ")}</b> {gone.people.length === 1 ? "has" : "have"} this role. Choose a role to move {gone.people.length === 1 ? "them" : "them"} to, so nobody is left without access.
              </p>
              <p className="lead muted" style={{ fontSize: 12.5 }}>
                Deleting a role never deletes people or their history. They keep their location, department and job title; only the role changes.
              </p>
              <div className="fld">
                <label htmlFor="dl-to">Move them to</label>
                <select id="dl-to" value={moveTo} onChange={(e) => setModal({ ...m, moveTo: e.target.value })}>
                  {others.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
            </>
          ) : (
            <p className="lead">Nobody has this role, so nothing else changes. It simply disappears from the role lists.</p>
          )}
          {error && <p className="error">{error}</p>}
          <div className="acts">
            <button type="button" className="btn-ghost rl-btn" onClick={() => setModal(null)}>Cancel</button>
            <button type="button" className="btn-danger rl-btn" style={{ padding: "9px 15px", fontSize: 13 }} disabled={busy} onClick={() => confirmDelete(gone.id, moveTo)}>
              {gone.people.length > 0 ? "Delete role and move people" : "Delete role"}
            </button>
          </div>
        </>
      );
    } else if (modal.type === "reset") {
      const target = roles.find((r) => r.id === modal.id);
      if (!target) return null;
      body = (
        <>
          <h2>Reset {target.name} to default?</h2>
          <p className="lead">All switches go back to how {target.name} worked when you first started. People with this role get the change.</p>
          {error && <p className="error">{error}</p>}
          <div className="acts">
            <button type="button" className="btn-ghost rl-btn" onClick={() => setModal(null)}>Cancel</button>
            <button type="button" className="btn-primary rl-btn" disabled={busy} onClick={() => confirmReset(target.id)}>Reset to default</button>
          </div>
        </>
      );
    }
    return (
      <div className="modal-backdrop rl-bd" onClick={() => !busy && setModal(null)}>
        <div className="modal wide rl-mod" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
          {body}
        </div>
      </div>
    );
  }
}
