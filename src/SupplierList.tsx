import { useState } from "react";
import { DAY_NAMES } from "./App";
import { formatMoney, defaultCurrency, currencySymbol, createSupplier } from "./api";
import type { Supplier, Location } from "./api";

interface Props {
  suppliers: Supplier[];
  locations: Location[];
  accessToken: string;
  onBack: () => void;
  onOpenSupplier: (id: string) => void;
  onSupplierCreated: (created: Supplier) => void;
}

type Filter = "active" | "archived" | "all";

export default function SupplierList({
  suppliers,
  locations,
  accessToken,
  onBack,
  onOpenSupplier,
  onSupplierCreated,
}: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("active");

  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newDay, setNewDay] = useState("");
  const [newMin, setNewMin] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  function resetNewSupplierForm() {
    setNewName("");
    setNewEmail("");
    setNewPhone("");
    setNewDay("");
    setNewMin("");
    setNewNotes("");
    setCreateError(null);
  }

  async function handleCreateSupplier(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setSaving(true);
    setCreateError(null);
    try {
      const created = await createSupplier(accessToken, {
        name: newName.trim(),
        contact_email: newEmail.trim() || null,
        contact_phone: newPhone.trim(),
        delivery_day: newDay === "" ? null : Number(newDay),
        min_order_value: newMin.trim() === "" ? null : Number(newMin).toFixed(2),
        notes: newNotes.trim(),
      });
      onSupplierCreated(created);
      setShowNewSupplier(false);
      resetNewSupplierForm();
      // Jump straight into the new supplier's own record -- there's more to
      // fill in (delivery day, notes, etc. if skipped here) than fits
      // comfortably in this quick-add modal.
      onOpenSupplier(created.id);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create supplier.");
    } finally {
      setSaving(false);
    }
  }

  const q = search.trim().toLowerCase();
  const rows = suppliers
    .filter((s) => {
      if (filter === "active") return !s.archived;
      if (filter === "archived") return s.archived;
      return true;
    })
    .filter((s) => {
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        (s.contact_email ?? "").toLowerCase().includes(q) ||
        (s.contact_phone ?? "").toLowerCase().includes(q)
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      <button className="back-link" onClick={onBack}>
        ← Procurement
      </button>

      <div className="detail-head" style={{ justifyContent: "space-between" }}>
        <h1 className="page-title" style={{ margin: 0 }}>
          Suppliers
        </h1>
        <button
          type="button"
          className="btn-primary small"
          onClick={() => {
            resetNewSupplierForm();
            setShowNewSupplier(true);
          }}
        >
          + New supplier
        </button>
      </div>

      <div className="content-head" style={{ marginTop: 4 }}>
        <div className="rtabs">
          {(["active", "archived", "all"] as const).map((f) => (
            <button
              key={f}
              className={`rtab ${filter === f ? "on" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <input
          className="head-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or phone…"
        />
      </div>

      {suppliers.length === 0 ? (
        <p className="muted">No suppliers yet.</p>
      ) : rows.length === 0 ? (
        <p className="muted">No suppliers match.</p>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th>Contact email</th>
              <th>Phone</th>
              <th>Delivery day</th>
              <th className="num">Min order</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="clickable" onClick={() => onOpenSupplier(s.id)}>
                <td className="dish">
                  {s.name}
                  {s.archived && (
                    <span className="badge b-archived" style={{ marginLeft: 8 }}>
                      Archived
                    </span>
                  )}
                </td>
                <td className="muted">{s.contact_email || "—"}</td>
                <td className="muted">{s.contact_phone || "—"}</td>
                <td className="muted">{s.delivery_day !== null ? DAY_NAMES[s.delivery_day] : "—"}</td>
                <td className="num">
                  {s.min_order_value ? formatMoney(Number(s.min_order_value), defaultCurrency(locations), 0) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showNewSupplier && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setShowNewSupplier(false);
            resetNewSupplierForm();
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>New supplier</h2>
            <form onSubmit={handleCreateSupplier}>
              <label>
                Name
                <input value={newName} onChange={(e) => setNewName(e.target.value)} required autoFocus />
              </label>
              <label>
                Contact email <span className="optional">optional</span>
                <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
              </label>
              <label>
                Contact phone <span className="optional">optional</span>
                <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
              </label>
              <label>
                Delivery day <span className="optional">optional</span>
                <select value={newDay} onChange={(e) => setNewDay(e.target.value)}>
                  <option value="">No fixed delivery day</option>
                  {DAY_NAMES.map((name, i) => (
                    <option key={i} value={i}>
                      Delivers {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Minimum order value <span className="optional">optional</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={newMin}
                  onChange={(e) => setNewMin(e.target.value)}
                  placeholder={currencySymbol(defaultCurrency(locations))}
                />
              </label>
              <label>
                Notes <span className="optional">optional</span>
                <textarea
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="e.g. account number, delivery instructions"
                  rows={3}
                />
              </label>
              {createError && <p className="error">{createError}</p>}
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setShowNewSupplier(false);
                    resetNewSupplierForm();
                  }}
                >
                  Cancel
                </button>
                <button className="btn-primary" type="submit" disabled={saving || !newName.trim()}>
                  {saving ? "Creating…" : "Create supplier"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
