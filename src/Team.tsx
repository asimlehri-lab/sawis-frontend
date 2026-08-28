import { useState } from "react";
import { createMember, deleteMembership, updateMembership } from "./api";
import type { Location, Me, Membership } from "./api";

interface Props {
  accessToken: string;
  me: Me;
  memberships: Membership[];
  membershipsError: string | null;
  locations: Location[];
  onChanged: () => void;
}

const ROLES: { value: "admin" | "manager" | "finance" | "staff"; label: string; desc: string }[] = [
  { value: "admin", label: "Admin", desc: "Full control + billing" },
  { value: "manager", label: "Manager", desc: "Branch ops — costs" },
  { value: "finance", label: "Finance", desc: "Money + reports" },
  { value: "staff", label: "Staff", desc: "Entry, no costs" },
];

const DEPARTMENTS = [
  { value: "", label: "All departments" },
  { value: "kitchen", label: "Kitchen" },
  { value: "bar", label: "Bar" },
  { value: "foh", label: "Front of house" },
];

function roleLabel(v: string): string {
  return ROLES.find((r) => r.value === v)?.label ?? v;
}

// Days-ago phrasing rather than a raw timestamp, since "was this person
// active this week" is the question this column exists to answer at a
// glance. `recent` (used to color the cell) mirrors that same week window.
function lastActive(iso: string | null): { text: string; recent: boolean } {
  if (!iso) return { text: "Never signed in", recent: false };
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return { text: "Today", recent: true };
  if (days === 1) return { text: "Yesterday", recent: true };
  if (days < 7) return { text: `${days} days ago`, recent: true };
  if (days < 31) return { text: `${Math.floor(days / 7)}w ago`, recent: false };
  return {
    text: new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
    recent: false,
  };
}

export default function Team({ accessToken, me, memberships, membershipsError, locations, onChanged }: Props) {
  const isAdmin = me.memberships.some((m) => m.role === "admin");

  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);

  const rows = memberships
    .slice()
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));

  return (
    <>
      <p className="muted" style={{ fontSize: 13, marginTop: 0, marginBottom: 16 }}>
        Everyone with a SAWIS login, and what they can do. <b>Job title</b> is just a label — access is always
        controlled by <b>role</b>, and a role change takes effect immediately. <b>Last active</b> tracks real
        sign-ins going forward — "Never signed in" for someone who hasn't logged in since this was added is
        expected, not a sign anything's wrong.
      </p>

      {membershipsError && <p className="error">{membershipsError}</p>}
      {rows.length === 0 && !membershipsError && <p className="muted">No team members yet.</p>}

      {rows.length > 0 && (
        <table className="tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th>Job title</th>
              <th>Role</th>
              <th>Location</th>
              <th>Department</th>
              <th>Last active</th>
              {isAdmin && <th></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{m.name || "—"}</div>
                  <div className="muted" style={{ fontSize: 11.5 }}>
                    {m.email}
                  </div>
                </td>
                <td className="muted">{m.job_title || "—"}</td>
                <td>
                  <span className={`badge role-${m.role}`}>{roleLabel(m.role)}</span>
                </td>
                <td className="muted">{m.location_name ?? "All locations"}</td>
                <td className="muted">{m.department ? m.department.charAt(0).toUpperCase() + m.department.slice(1) : "All"}</td>
                <td>
                  {(() => {
                    const { text, recent } = lastActive(m.last_login);
                    return recent ? <span className="badge b-ok">{text}</span> : <span className="muted">{text}</span>;
                  })()}
                </td>
                {isAdmin && (
                  <td className="num">
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <button className="btn-ghost small" onClick={() => setEditingId(m.id)}>
                        Edit
                      </button>
                      {removeConfirmId === m.id ? (
                        <button
                          className="btn-danger"
                          style={{ fontSize: 12, padding: "7px 12px" }}
                          onClick={async () => {
                            await deleteMembership(accessToken, m.id);
                            setRemoveConfirmId(null);
                            onChanged();
                          }}
                        >
                          Confirm
                        </button>
                      ) : (
                        <button className="btn-ghost small" onClick={() => setRemoveConfirmId(m.id)}>
                          Remove
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {isAdmin && !showAdd && (
        <button className="btn-primary small" style={{ marginTop: 16 }} onClick={() => setShowAdd(true)}>
          + Add team member
        </button>
      )}

      {showAdd && (
        <AddMemberModal
          accessToken={accessToken}
          locations={locations}
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            onChanged();
          }}
        />
      )}

      {editingId && (
        <EditMemberModal
          accessToken={accessToken}
          membership={memberships.find((m) => m.id === editingId)!}
          onClose={() => setEditingId(null)}
          onSaved={() => {
            setEditingId(null);
            onChanged();
          }}
        />
      )}
    </>
  );
}

function AddMemberModal({
  accessToken,
  locations,
  onClose,
  onSaved,
}: {
  accessToken: string;
  locations: Location[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [role, setRole] = useState<"admin" | "manager" | "finance" | "staff">("staff");
  const [location, setLocation] = useState("");
  const [department, setDepartment] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSave() {
    if (!email.trim()) {
      setErr("Email is required.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await createMember(accessToken, {
        email: email.trim(),
        name: name.trim(),
        password: password || undefined,
        role,
        location: location || null,
        department: (department || null) as "kitchen" | "bar" | "foh" | null,
        job_title: jobTitle.trim(),
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add this team member.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !saving && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add team member</h2>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
          If this person already has a SAWIS login at your organization, leave the password blank — this just grants
          them a new role/location instead of creating a second account.
        </p>
        <div className="fgrid fgrid-2">
          <div className="field">
            <label>Full name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Marek Nowak" />
          </div>
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="marek@example.com" />
          </div>
        </div>
        <div className="field">
          <label>Temporary password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Leave blank if they already have a login"
          />
        </div>
        <div className="fgrid fgrid-2">
          <div className="field">
            <label>Job title</label>
            <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Kitchen Porter" />
          </div>
          <div className="field">
            <label>Permission role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label} — {r.desc}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="fgrid fgrid-2">
          <div className="field">
            <label>Location</label>
            <select value={location} onChange={(e) => setLocation(e.target.value)}>
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Department</label>
            <select value={department} onChange={(e) => setDepartment(e.target.value)}>
              {DEPARTMENTS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {err && <p className="error">{err}</p>}
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Adding…" : "Add team member"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditMemberModal({
  accessToken,
  membership,
  onClose,
  onSaved,
}: {
  accessToken: string;
  membership: Membership;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [jobTitle, setJobTitle] = useState(membership.job_title);
  const [role, setRole] = useState(membership.role);
  const [department, setDepartment] = useState(membership.department ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setErr(null);
    try {
      await updateMembership(accessToken, membership.id, {
        job_title: jobTitle.trim(),
        role,
        department: (department || null) as "kitchen" | "bar" | "foh" | null,
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !saving && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{membership.name || membership.email}</h2>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
          {membership.location_name ?? "All locations"} · editing this membership only — if they have more than one,
          the others are unaffected.
        </p>
        <div className="field">
          <label>Job title</label>
          <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Head Chef" />
        </div>
        <div className="fgrid fgrid-2">
          <div className="field">
            <label>Permission role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label} — {r.desc}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Department</label>
            <select value={department} onChange={(e) => setDepartment(e.target.value)}>
              {DEPARTMENTS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {err && <p className="error">{err}</p>}
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
