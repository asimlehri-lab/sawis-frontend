import { useState } from "react";
import { DAY_NAMES } from "./App";
import { formatMoney, defaultCurrency } from "./api";
import type { Supplier, Location } from "./api";

interface Props {
  suppliers: Supplier[];
  locations: Location[];
  onBack: () => void;
  onOpenSupplier: (id: string) => void;
}

type Filter = "active" | "archived" | "all";

export default function SupplierList({ suppliers, locations, onBack, onOpenSupplier }: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("active");

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

      <div className="detail-head">
        <h1 className="page-title" style={{ margin: 0 }}>
          Suppliers
        </h1>
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
    </div>
  );
}
