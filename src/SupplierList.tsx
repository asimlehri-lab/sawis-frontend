import { useState } from "react";
import { DAY_NAMES } from "./App";
import { formatMoney, defaultCurrency, currencySymbol, createSupplier, bulkImportSupplierItems } from "./api";
import { downloadSupplierListTemplate } from "./supplierListTemplate";
import { readSupplierListFile } from "./supplierListFile";
import type { SupplierListRow } from "./supplierListFile";
import type { SupplierTab } from "./SupplierDeliveries";
import type { Supplier, Location, PriceListInfo } from "./api";

interface Props {
  suppliers: Supplier[];
  locations: Location[];
  accessToken: string;
  // `tab` opens the supplier on that tab; `notice` is shown on its page.
  onOpenSupplier: (id: string, opts?: { tab?: SupplierTab; notice?: string }) => void;
  // A price list was stored while creating a supplier: refresh what depends on it.
  onListUploaded: () => void;
  onSupplierCreated: (created: Supplier) => void;
  // The "+ New supplier" button sits in the page header (Procurement), which
  // asks this list to open its form.
  showNew: boolean;
  onShowNewChange: (show: boolean) => void;
  // Open purchase orders per supplier, and how much of each supplier's
  // uploaded price list is linked to your items.
  openOrders: Record<string, number>;
  listInfo: Record<string, PriceListInfo>;
}

type Filter = "active" | "archived" | "all";

export default function SupplierList({
  suppliers,
  locations,
  accessToken,
  onOpenSupplier,
  onListUploaded,
  onSupplierCreated,
  showNew,
  onShowNewChange,
  openOrders,
  listInfo,
}: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("active");

  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newDay, setNewDay] = useState("");
  const [newMin, setNewMin] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // An optional price list chosen in the pop-up, read before anything is created.
  const [listFileName, setListFileName] = useState("");
  const [listRows, setListRows] = useState<SupplierListRow[]>([]);
  const [listError, setListError] = useState<string | null>(null);

  function handleListFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setListRows([]);
    setListError(null);
    if (!file) {
      setListFileName("");
      return;
    }
    setListFileName(file.name);
    readSupplierListFile(file)
      .then((rows) => {
        setListRows(rows);
        if (rows.length === 0) {
          setListError('No valid rows found — each row should read name, unit, price, e.g. "Beef mince 5%, kg, 7.40".');
        }
      })
      .catch(() => setListError("Could not read that file — check it's a valid CSV or Excel spreadsheet."));
  }

  function resetNewSupplierForm() {
    setListFileName("");
    setListRows([]);
    setListError(null);
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
      // With a price list chosen, store it now and land on its Price list tab.
      // If that fails the supplier still exists: open it with a message and
      // the Upload price list button to try again.
      let opts: { tab?: SupplierTab; notice?: string } | undefined;
      if (listRows.length > 0) {
        try {
          await bulkImportSupplierItems(accessToken, {
            supplier: created.id,
            rows: listRows.map((r) => ({
              name: r.name,
              unit: r.unit,
              price: r.price,
              base_qty_per_unit: r.base_qty_per_unit,
            })),
          });
          onListUploaded();
          opts = { tab: "prices" };
        } catch (err) {
          const why = err instanceof Error ? err.message : "something went wrong";
          opts = {
            notice: `${created.name} was created, but the price list could not be uploaded (${why}). Press Upload price list to try again.`,
          };
        }
      }
      onShowNewChange(false);
      resetNewSupplierForm();
      // Jump straight into the new supplier's own record -- there's more to
      // fill in (delivery day, notes, etc. if skipped here) than fits
      // comfortably in this quick-add modal.
      onOpenSupplier(created.id, opts);
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
        <div className="table-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact email</th>
                <th>Phone</th>
                <th>Delivery day</th>
                <th className="num">Min order</th>
                <th className="num">Open orders</th>
                <th>Price list</th>
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
                  <td className="num">{openOrders[s.id] ?? 0}</td>
                  <td>
                    {(() => {
                      const info = listInfo[s.id];
                      if (!info || (info.total === 0 && info.delivered === 0))
                        return <span className="spl-pill mut">Nothing received yet</span>;
                      if (info.total === 0) {
                        const old =
                          info.delivered_newest !== null &&
                          Date.now() - new Date(info.delivered_newest).getTime() > 60 * 86400000;
                        return (
                          <span className={`spl-pill ${old ? "warn" : "ok"}`}>
                            {old && info.delivered_newest
                              ? `${info.delivered} ${info.delivered === 1 ? "price" : "prices"} · newest ${new Date(
                                  info.delivered_newest
                                ).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
                              : `${info.delivered} ${info.delivered === 1 ? "price" : "prices"} from deliveries`}
                          </span>
                        );
                      }
                      return (
                        <span className={`spl-pill ${info.linked < info.total ? "warn" : "ok"}`}>
                          {info.linked} of {info.total} linked
                          {info.delivered > 0 ? ` · +${info.delivered} from deliveries` : ""}
                        </span>
                      );
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <div
          className="modal-backdrop"
          onClick={() => {
            onShowNewChange(false);
            resetNewSupplierForm();
          }}
        >
          <div className="modal ns-modal" onClick={(e) => e.stopPropagation()}>
            <h2>New supplier</h2>
            <form onSubmit={handleCreateSupplier}>
              <label>
                Name
                <input value={newName} onChange={(e) => setNewName(e.target.value)} required autoFocus />
              </label>
              <div className="ns-row">
              <label>
                <span>Contact email <span className="optional">optional</span></span>
                <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
              </label>
              <label>
                <span>Contact phone <span className="optional">optional</span></span>
                <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
              </label>
              </div>
              <div className="ns-row">
              <label>
                <span>Delivery day <span className="optional">optional</span></span>
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
                <span>Minimum order value <span className="optional">optional</span></span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={newMin}
                  onChange={(e) => setNewMin(e.target.value)}
                  placeholder={currencySymbol(defaultCurrency(locations))}
                />
              </label>
              </div>
              <label>
                <span>Notes <span className="optional">optional</span></span>
                <textarea
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="e.g. account number, delivery instructions"
                  rows={2}
                />
              </label>
              <div className="ns-sec">
                <div className="ns-sec-head">
                  <h4>
                    Price list <span className="optional">optional</span>
                  </h4>
                  <button type="button" className="mini" onClick={() => downloadSupplierListTemplate()}>
                    ⇩ Template
                  </button>
                </div>
                <p className="vhint">Did they send you a list? Add it now: name, unit, price. It goes onto their Price list tab.</p>
                <input
                  type="file"
                  accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  onChange={handleListFile}
                />
                {listFileName && !listError && listRows.length > 0 && (
                  <div className="im-note">
                    ✓ <b>{listRows.length} products</b> read from {listFileName}. They are stored when you create the supplier.
                  </div>
                )}
                {listError && <p className="error">{listError}</p>}
              </div>
              {createError && <p className="error">{createError}</p>}
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    onShowNewChange(false);
                    resetNewSupplierForm();
                  }}
                >
                  Cancel
                </button>
                <button className="btn-primary" type="submit" disabled={saving || !newName.trim()}>
                  {saving
                    ? listRows.length > 0
                      ? "Creating and uploading…"
                      : "Creating…"
                    : listRows.length > 0
                      ? "Create supplier and upload list"
                      : "Create supplier"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
