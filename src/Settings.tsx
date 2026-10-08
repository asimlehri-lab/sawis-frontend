import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import {
  bulkImportRecipes,
  changePassword,
  createInventoryCheckSchedule,
  fetchInventoryCheckSchedules,
  fetchVapidPublicKey,
  subscribePush,
  unsubscribePush,
  updateInventoryCheckSchedule,
  updateLocation,
  BASE_UNITS,
  CURRENCY_OPTIONS,
  currencySymbol,
} from "./api";
import type { Allergen, BulkItemInput, CatalogItem, CurrencyCode, InventoryCheckSchedule, Location, Recipe } from "./api";
import MenuListImportModal from "./MenuListImportModal";
import type { ParsedMenuRow } from "./MenuListImportModal";
import SearchSelect from "./SearchSelect";
import { downloadRecipeImportTemplate, resolveUsualSupplierLink } from "./recipeImportTemplate";
import PasswordConfirmModal from "./PasswordConfirmModal";
// DAY_NAMES is exported from App.tsx, which imports Settings back -- same
// established circular-import pattern already used by SupplierDeliveries.tsx
// (see its own DAY_NAMES import) rather than duplicating the array here.
import { DAY_NAMES } from "./App";

interface Props {
  accessToken: string;
  items: CatalogItem[];
  recipes: Recipe[];
  allergens: Allergen[];
  locations: Location[];
  // App.tsx caches `items`/`recipes` and only reloads them on demand — a
  // bulk import here changes them server-side (new items, new or
  // backfilled ItemHoldings, new recipes) without App.tsx knowing, so
  // Inventory (which reads stock purely from the cached `items[].holdings`)
  // would keep showing pre-import data until something calls these.
  onItemsChanged: () => void;
  onRecipesChanged: () => void;
}

// Shared by both import panels — a small hand-rolled CSV parser that
// handles quoted fields with embedded commas, same approach as
// EndOfDay.tsx (no library dependency for this simple a format).
// `delimiter` defaults to "," but the menu-list-prefill path below
// passes ";" — POS exports of that shape are semicolon-delimited
// (German-locale Excel default), matching the sample the user provided.
function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((f) => f.trim() !== "")) rows.push(row);
  }
  return rows;
}

function headerIndex(header: string[], name: string): number {
  return header.map((h) => h.trim().toLowerCase()).indexOf(name);
}

// Same header cell, several acceptable spellings — used where a column
// name is more likely to vary (e.g. "pos_id" vs the bare "id" a POS
// menu-list export already uses).
function headerIndexAny(header: string[], names: string[]): number {
  for (const name of names) {
    const idx = headerIndex(header, name);
    if (idx > -1) return idx;
  }
  return -1;
}

// Triggers a real client-side file download of a CSV built from a header
// + rows — same pattern as Reports.tsx's exportMenuCsv (no extra request
// or library needed for this simple a format).
function downloadCsv(filename: string, header: string[], rows: string[][]) {
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Same comma/dot decimal-separator heuristic as App.tsx's cleanNumeric —
// duplicated locally rather than imported since it's not exported there
// (mirrors this file's existing parseCsv/EndOfDay.tsx precedent of small
// self-contained parsing helpers per file). Used for menu-list exports'
// "Preis"/price column, which is often German-locale comma-decimal.
function cleanNumeric(raw: string | null): string {
  if (!raw) return "";
  let cleaned = raw.replace(/[^0-9.,]/g, "");
  if (!cleaned) return "";
  const commaCount = (cleaned.match(/,/g) || []).length;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    cleaned = lastComma > lastDot ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned.replace(/,/g, "");
  } else if (commaCount === 1 && cleaned.length - lastComma - 1 === 2) {
    cleaned = cleaned.replace(",", ".");
  } else {
    cleaned = cleaned.replace(/,/g, "");
  }
  return cleaned;
}

export default function Settings({ accessToken, items, recipes, allergens, locations, onItemsChanged, onRecipesChanged }: Props) {
  return (
    <>
      <p className="muted" style={{ fontSize: 13, marginTop: 0, marginBottom: 16 }}>
        Bulk-import a customer's existing menu and stock catalogue from a spreadsheet, instead of adding everything
        one at a time — items and recipes both come from the same file.
      </p>
      <RecipeAndItemImportPanel
        accessToken={accessToken}
        items={items}
        recipes={recipes}
        allergens={allergens}
        locations={locations}
        onItemsChanged={onItemsChanged}
        onRecipesChanged={onRecipesChanged}
      />
      <div style={{ height: 20 }} />
      <LocationSettingsPanel accessToken={accessToken} locations={locations} />
      <div style={{ height: 20 }} />
      <NotificationSettingsPanel accessToken={accessToken} locations={locations} />
      <div style={{ height: 20 }} />
      <ChangePasswordPanel accessToken={accessToken} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Self-service password change. Forgotten-password case isn't this panel --
// that needs an org admin (Team's own "Reset password" action) or, for
// SAWIS staff, the Django admin password-change link.
// ---------------------------------------------------------------------------

function ChangePasswordPanel({ accessToken }: { accessToken: string }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    setSaved(false);
    if (!currentPassword) {
      setError("Enter your current password.");
      return;
    }
    if (!newPassword || newPassword !== confirmPassword) {
      setError("New passwords don't match.");
      return;
    }
    setSaving(true);
    try {
      await changePassword(accessToken, currentPassword, newPassword);
      setSaved(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Password</h2>
      <p className="hint">
        Change your own sign-in password. Forgotten it instead? Ask an org admin to reset it for you from Team.
      </p>
      <div className="fgrid fgrid-2">
        <div className="field">
          <label>Current password</label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => {
              setCurrentPassword(e.target.value);
              setSaved(false);
            }}
          />
        </div>
        <div />
        <div className="field">
          <label>New password</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              setSaved(false);
            }}
          />
        </div>
        <div className="field">
          <label>Confirm new password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              setSaved(false);
            }}
          />
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        {error && <span className="error" style={{ padding: "4px 8px" }}>{error}</span>}
        {saved && !error && <span className="badge b-ok">Changed</span>}
        <button type="button" className="btn-ghost small" disabled={saving} onClick={handleSave}>
          {saving ? "Saving…" : "Change password"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-location settings — currency (display only) + monthly overhead (feeds
// End of day's net margin estimate).
//
// Restored Sep 15, 2026: this panel (currency + overhead together, as
// "Locations") existed and was confirmed working, but a later commit
// (93929f2, "Add Notification Phase 3: Settings UI, bell integration") was
// built from a copy of this file that predated the currency work and
// silently reverted this whole component back to overhead-only with a
// hardcoded "£" -- currency had genuinely been missing from the Settings
// page since then, invisibly, because the file still compiled fine either
// way. Found by walking `git log -p -- src/Settings.tsx` for the removed
// `currency`/`CURRENCY_OPTIONS` lines, not by guessing. The other ~13 files
// made currency-aware that same week (EndOfDay, Reports, Inventory, etc.)
// were untouched by that stale-base commit and were never affected -- only
// the one editing UI itself was lost, along with the ability to change a
// location's currency going forward.
// ---------------------------------------------------------------------------

function LocationSettingsPanel({ accessToken, locations }: { accessToken: string; locations: Location[] }) {
  const [overheadValues, setOverheadValues] = useState<Record<string, string>>({});
  const [currencyValues, setCurrencyValues] = useState<Record<string, CurrencyCode>>({});
  const [foodTargetValues, setFoodTargetValues] = useState<Record<string, string>>({});
  const [drinkTargetValues, setDrinkTargetValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  function overheadFor(loc: Location) {
    return overheadValues[loc.id] ?? loc.monthly_overhead ?? "";
  }
  function currencyFor(loc: Location) {
    return currencyValues[loc.id] ?? loc.currency;
  }
  function foodTargetFor(loc: Location) {
    return foodTargetValues[loc.id] ?? loc.target_food_cost_pct ?? "30";
  }
  function drinkTargetFor(loc: Location) {
    return drinkTargetValues[loc.id] ?? loc.target_drink_cost_pct ?? "30";
  }

  async function handleSave(loc: Location) {
    const raw = overheadFor(loc).trim();
    const foodRaw = foodTargetFor(loc).trim();
    const drinkRaw = drinkTargetFor(loc).trim();
    setSaving((s) => ({ ...s, [loc.id]: true }));
    setErrors((e) => ({ ...e, [loc.id]: "" }));
    setSaved((s) => ({ ...s, [loc.id]: false }));
    try {
      await updateLocation(accessToken, loc.id, {
        currency: currencyFor(loc),
        monthly_overhead: raw === "" ? null : raw,
        target_food_cost_pct: foodRaw === "" ? "30" : foodRaw,
        target_drink_cost_pct: drinkRaw === "" ? "30" : drinkRaw,
      });
      setSaved((s) => ({ ...s, [loc.id]: true }));
    } catch (e) {
      setErrors((er) => ({ ...er, [loc.id]: e instanceof Error ? e.message : "Could not save this." }));
    } finally {
      setSaving((s) => ({ ...s, [loc.id]: false }));
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Locations</h2>
      <p className="hint">
        Currency changes which symbol this location's own prices/reports show — display only, no exchange-rate
        conversion. Monthly overhead (rent, labour, other fixed costs) feeds End of day's net margin estimate;
        leave blank to skip that estimate. Food/drink target % is what Reports and each recipe's own page flag
        "over"/"under" against, in place of the old fixed 30%.
      </p>
      {!locations.length && <p className="muted">No locations yet.</p>}
      {locations.map((loc) => (
        <div key={loc.id} className="price-row" style={{ alignItems: "center", flexWrap: "wrap" }}>
          <label>{loc.name}</label>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {errors[loc.id] && <span className="error" style={{ padding: "4px 8px" }}>{errors[loc.id]}</span>}
            {saved[loc.id] && !errors[loc.id] && <span className="badge b-ok">Saved</span>}
            <select
              value={currencyFor(loc)}
              onChange={(e) => {
                setCurrencyValues((v) => ({ ...v, [loc.id]: e.target.value as CurrencyCode }));
                setSaved((s) => ({ ...s, [loc.id]: false }));
              }}
            >
              {CURRENCY_OPTIONS.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              className="price-in"
              type="number"
              min="0"
              step="1"
              placeholder="Overhead, e.g. 8000"
              value={overheadFor(loc)}
              onChange={(e) => {
                setOverheadValues((v) => ({ ...v, [loc.id]: e.target.value }));
                setSaved((s) => ({ ...s, [loc.id]: false }));
              }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span className="muted" style={{ fontSize: 11 }}>
                Food target
              </span>
              <input
                className="price-in"
                style={{ width: 56 }}
                type="number"
                min="0"
                max="100"
                step="1"
                value={foodTargetFor(loc)}
                onChange={(e) => {
                  setFoodTargetValues((v) => ({ ...v, [loc.id]: e.target.value }));
                  setSaved((s) => ({ ...s, [loc.id]: false }));
                }}
              />
              <span className="muted" style={{ fontSize: 11 }}>
                %
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span className="muted" style={{ fontSize: 11 }}>
                Drink target
              </span>
              <input
                className="price-in"
                style={{ width: 56 }}
                type="number"
                min="0"
                max="100"
                step="1"
                value={drinkTargetFor(loc)}
                onChange={(e) => {
                  setDrinkTargetValues((v) => ({ ...v, [loc.id]: e.target.value }));
                  setSaved((s) => ({ ...s, [loc.id]: false }));
                }}
              />
              <span className="muted" style={{ fontSize: 11 }}>
                %
              </span>
            </div>
            <button
              type="button"
              className="btn-ghost small"
              disabled={saving[loc.id]}
              onClick={() => handleSave(loc)}
            >
              {saving[loc.id] ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delivery reminders & inventory checks (Phase 3 notification settings) —
// feeds the notification bell top-right and its calendar. Two independent
// per-location settings share one panel since they're both "notification
// timing" from the user's point of view: how much notice before a
// delivery, and which day the regular stock count falls on.
// ---------------------------------------------------------------------------

function NotificationSettingsPanel({ accessToken, locations }: { accessToken: string; locations: Location[] }) {
  const [leadValues, setLeadValues] = useState<Record<string, string>>({});
  const [leadSaving, setLeadSaving] = useState<Record<string, boolean>>({});
  const [leadSaved, setLeadSaved] = useState<Record<string, boolean>>({});
  const [leadErrors, setLeadErrors] = useState<Record<string, string>>({});

  const [schedules, setSchedules] = useState<InventoryCheckSchedule[]>([]);
  const [schedulesLoaded, setSchedulesLoaded] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleSaving, setScheduleSaving] = useState<Record<string, boolean>>({});
  const [scheduleSaved, setScheduleSaved] = useState<Record<string, boolean>>({});
  // Draft weekday/enabled per location, keyed the same way as leadValues —
  // seeded from the fetched schedule once it loads, or sane defaults
  // (Monday, enabled) for a location that doesn't have one saved yet.
  const [weekdayDraft, setWeekdayDraft] = useState<Record<string, number>>({});
  const [enabledDraft, setEnabledDraft] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetchInventoryCheckSchedules(accessToken)
      .then((rows) => {
        setSchedules(rows);
        setSchedulesLoaded(true);
      })
      .catch((e) => setScheduleError(e instanceof Error ? e.message : "Could not load inventory check schedules."));
  }, [accessToken]);

  function scheduleFor(locId: string): InventoryCheckSchedule | null {
    return schedules.find((s) => s.location === locId) ?? null;
  }
  function weekdayFor(locId: string): number {
    if (locId in weekdayDraft) return weekdayDraft[locId];
    return scheduleFor(locId)?.weekday ?? 0;
  }
  function enabledFor(locId: string): boolean {
    if (locId in enabledDraft) return enabledDraft[locId];
    return scheduleFor(locId)?.enabled ?? true;
  }

  function leadValueFor(loc: Location): string {
    return leadValues[loc.id] ?? String(loc.delivery_reminder_lead_days ?? 1);
  }

  async function handleSaveLead(loc: Location) {
    const raw = leadValueFor(loc).trim();
    const parsed = Number(raw);
    if (!raw || isNaN(parsed) || parsed < 0) {
      setLeadErrors((er) => ({ ...er, [loc.id]: "Enter 0 or more days." }));
      return;
    }
    setLeadSaving((s) => ({ ...s, [loc.id]: true }));
    setLeadErrors((er) => ({ ...er, [loc.id]: "" }));
    setLeadSaved((s) => ({ ...s, [loc.id]: false }));
    try {
      await updateLocation(accessToken, loc.id, { delivery_reminder_lead_days: parsed });
      setLeadSaved((s) => ({ ...s, [loc.id]: true }));
    } catch (e) {
      setLeadErrors((er) => ({ ...er, [loc.id]: e instanceof Error ? e.message : "Could not save this." }));
    } finally {
      setLeadSaving((s) => ({ ...s, [loc.id]: false }));
    }
  }

  async function handleSaveSchedule(loc: Location) {
    const weekday = weekdayFor(loc.id);
    const enabled = enabledFor(loc.id);
    setScheduleSaving((s) => ({ ...s, [loc.id]: true }));
    setScheduleError(null);
    setScheduleSaved((s) => ({ ...s, [loc.id]: false }));
    try {
      const existing = scheduleFor(loc.id);
      const saved = existing
        ? await updateInventoryCheckSchedule(accessToken, existing.id, { weekday, enabled })
        : await createInventoryCheckSchedule(accessToken, { location: loc.id, weekday, enabled });
      setSchedules((rows) => [...rows.filter((r) => r.location !== loc.id), saved]);
      setScheduleSaved((s) => ({ ...s, [loc.id]: true }));
    } catch (e) {
      setScheduleError(e instanceof Error ? e.message : "Could not save this schedule.");
    } finally {
      setScheduleSaving((s) => ({ ...s, [loc.id]: false }));
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Delivery reminders & inventory checks</h2>
      <p className="hint">
        How much notice to give before a delivery is due, and which day each location runs its regular stock
        count — both feed the notification bell (top right) and its calendar.
      </p>
      {!locations.length && <p className="muted">No locations yet.</p>}
      {locations.map((loc) => (
        <div key={loc.id} style={{ marginBottom: 18 }}>
          <b>{loc.name}</b>

          <div className="price-row" style={{ alignItems: "center", marginTop: 6 }}>
            <label>Delivery reminder</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {leadErrors[loc.id] && (
                <span className="error" style={{ padding: "4px 8px" }}>
                  {leadErrors[loc.id]}
                </span>
              )}
              {leadSaved[loc.id] && !leadErrors[loc.id] && <span className="badge b-ok">Saved</span>}
              <input
                className="price-in"
                type="number"
                min="0"
                step="1"
                value={leadValueFor(loc)}
                onChange={(e) => {
                  setLeadValues((v) => ({ ...v, [loc.id]: e.target.value }));
                  setLeadSaved((s) => ({ ...s, [loc.id]: false }));
                }}
              />
              <span className="muted">day{leadValueFor(loc) === "1" ? "" : "s"} before</span>
              <button
                type="button"
                className="btn-ghost small"
                disabled={leadSaving[loc.id]}
                onClick={() => handleSaveLead(loc)}
              >
                {leadSaving[loc.id] ? "Saving…" : "Save"}
              </button>
            </div>
          </div>

          <div className="price-row" style={{ alignItems: "center" }}>
            <label>Inventory check</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {scheduleSaved[loc.id] && <span className="badge b-ok">Saved</span>}
              <select
                value={weekdayFor(loc.id)}
                disabled={!schedulesLoaded}
                onChange={(e) => {
                  setWeekdayDraft((d) => ({ ...d, [loc.id]: Number(e.target.value) }));
                  setScheduleSaved((s) => ({ ...s, [loc.id]: false }));
                }}
              >
                {DAY_NAMES.map((name, i) => (
                  <option key={i} value={i}>
                    Every {name}
                  </option>
                ))}
              </select>
              <label style={{ display: "flex", alignItems: "center", gap: 4, fontWeight: "normal" }}>
                <input
                  type="checkbox"
                  checked={enabledFor(loc.id)}
                  onChange={(e) => {
                    setEnabledDraft((d) => ({ ...d, [loc.id]: e.target.checked }));
                    setScheduleSaved((s) => ({ ...s, [loc.id]: false }));
                  }}
                />
                Enabled
              </label>
              <button
                type="button"
                className="btn-ghost small"
                disabled={scheduleSaving[loc.id] || !schedulesLoaded}
                onClick={() => handleSaveSchedule(loc)}
              >
                {scheduleSaving[loc.id] ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ))}
      {scheduleError && <p className="error">{scheduleError}</p>}

      <PushNotificationToggle accessToken={accessToken} />
    </div>
  );
}

// urlBase64ToUint8Array -- converts the VAPID public key (base64url text,
// as the backend hands it back from GET /push-public-key/) into the raw
// byte array pushManager.subscribe()'s applicationServerKey actually wants.
// Standard, widely-used conversion for the Push API -- nothing SAWIS-specific.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

// Phase 6 of the notification plan -- browser push, opted into per device
// (not per location/org like everything else in this panel), so it's kept
// as its own small block at the bottom of the same card rather than a
// separate one: it's still "notification timing/delivery" from the user's
// point of view, just for a different channel. No backend cost beyond a
// couple of DB rows -- the Web Push standard itself has no vendor or
// per-message fee (see the project handoff for the cost comparison against
// email/Phase 5, which does have a real, if tiny, per-message AWS SES cost).
function PushNotificationToggle({ accessToken }: { accessToken: string }) {
  const supported =
    typeof navigator !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
  // Lazily initialized to !supported so the unsupported case never needs a
  // synchronous setState call inside the effect below (avoids the
  // react-hooks/set-state-in-effect lint error -- same fix pattern used
  // elsewhere in this app, see the project handoff's Eighteenth gotcha).
  const [checked, setChecked] = useState(!supported);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<string>(
    supported && "Notification" in window ? Notification.permission : "unsupported"
  );

  useEffect(() => {
    if (!supported) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscribed(!!sub))
      .catch(() => {})
      .finally(() => setChecked(true));
  }, [supported]);

  async function handleEnable() {
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const publicKey = await fetchVapidPublicKey(accessToken);
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast needed because newer TS DOM lib typings make Uint8Array's
        // buffer generic (ArrayBufferLike, which also covers
        // SharedArrayBuffer) while PushSubscriptionOptionsInit still wants a
        // plain BufferSource -- the underlying Uint8Array is always backed
        // by a real ArrayBuffer here (see urlBase64ToUint8Array), so this is
        // a type-level mismatch only, not a runtime one.
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const json = sub.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error("This browser returned an incomplete push subscription.");
      }
      await subscribePush(accessToken, {
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      });
      setSubscribed(true);
      setPermission("Notification" in window ? Notification.permission : "unsupported");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not enable push notifications on this device.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await unsubscribePush(accessToken, sub.endpoint);
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not disable push notifications on this device.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
      <b>Browser push notifications</b>
      <p className="hint" style={{ marginTop: 4 }}>
        Get a notification on this device the moment a delivery reminder, inventory check, or below-par alert
        comes up — even when SAWIS isn't open in a tab. This is per device: enable it separately on your phone
        and your laptop if you want both.
      </p>
      {!supported && <p className="muted">This browser doesn't support push notifications.</p>}
      {supported && permission === "denied" && (
        <p className="error">
          Notifications are blocked for this site in your browser's own settings — allow them there first, then
          come back here.
        </p>
      )}
      {supported && permission !== "denied" && checked && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {error && (
            <span className="error" style={{ padding: "4px 8px" }}>
              {error}
            </span>
          )}
          {subscribed ? (
            <>
              <span className="badge b-ok">Enabled on this device</span>
              <button type="button" className="btn-ghost small" disabled={busy} onClick={handleDisable}>
                {busy ? "Disabling…" : "Disable"}
              </button>
            </>
          ) : (
            <button type="button" className="btn-ghost small" disabled={busy} onClick={handleEnable}>
              {busy ? "Enabling…" : "Enable on this device"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recipes import
// ---------------------------------------------------------------------------

interface RecipeRow {
  recipeName: string;
  posId: string;
  menuCategory: string;
  kind: "dish" | "sub";
  yield_qty: string;
  yield_unit: string;
  menu_price: string;
  // "food" | "drink" | "" -- blank means "don't touch" server-side (see
  // RecipeViewSet.bulk_import's docstring): leaves an existing recipe's
  // classification alone on update, defaults a brand-new recipe to Food.
  // Only meaningful on a group's first row (same as kind/yield/etc) --
  // later ingredient-only rows for the same recipe carry "" and are
  // ignored, matching how those other header fields already work.
  menuGroup: string;
  ingredientRaw: string;
  qty: string;
  unit: string;
  matchedItemId: string | null;
}

function RecipeAndItemImportPanel({
  accessToken,
  items,
  recipes,
  allergens,
  locations,
  onItemsChanged,
  onRecipesChanged,
}: {
  accessToken: string;
  items: CatalogItem[];
  recipes: Recipe[];
  allergens: Allergen[];
  locations: Location[];
  onItemsChanged: () => void;
  onRecipesChanged: () => void;
}) {
  const [location, setLocation] = useState(locations[0]?.id ?? "");
  // Same render-time "adjust state" fix used elsewhere in this file, for
  // the same reason: locations loads asynchronously, and if this panel
  // mounts first, the useState
  // initializer bakes in "" permanently -- with one location the picker
  // never renders to let the user fix it, so Import stays silently
  // disabled (see handleImport's `!location` guard further down). Uses the
  // render-time "adjust state" pattern rather than an effect -- see that
  // comment for why.
  const [locationsSeen, setLocationsSeen] = useState(locations);
  if (locations !== locationsSeen) {
    setLocationsSeen(locations);
    if (!location && locations[0]?.id) setLocation(locations[0].id);
  }
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<RecipeRow[]>([]);
  // Only ever non-empty when the uploaded file was the unified 3-tab
  // template (see parseThreeTabWorkbook below) -- brand-new rows from its
  // Items tab, sent through as this request's own `items` field so they
  // get their real base_unit/category/vat/etc instead of the
  // guess-from-unit-text fallback a bare unmatched ingredient name would
  // otherwise get. Always cleared at the start of handleFile.
  const [newItemRows, setNewItemRows] = useState<BulkItemInput[]>([]);
  // Existing rows whose cost was changed but that have no supplier to attach
  // it to -- shown as a note, never silently dropped.
  const [costsWithoutSupplier, setCostsWithoutSupplier] = useState(0);
  const [templateDownloading, setTemplateDownloading] = useState(false);
  // Gates the template download behind a password re-confirmation (see
  // PasswordConfirmModal) -- the template contains this org's full costed
  // item/recipe catalogue, suppliers included.
  const [confirmingTemplateDownload, setConfirmingTemplateDownload] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    created: number;
    updated: number;
    itemsCreated: string[];
    holdingsBackfilled: number;
    allergensSet: number;
    costsUpdated: number;
    wasteUpdated: number;
  } | null>(null);

  function matchItem(name: string): string | null {
    const norm = name.trim().toLowerCase();
    // Prefer a live item over an archived duplicate of the same name.
    const sameName = items.filter((i) => i.name.trim().toLowerCase() === norm);
    const found = sameName.find((i) => !i.archived) ?? sameName[0];
    return found ? found.id : null;
  }

  // handleFile below bakes matchedItemId into each row at parse time, using
  // whatever `items` this component happened to have at that exact moment.
  // items is fetched once, app-wide, on login (App.tsx) and can still be
  // loading (or briefly empty right after it) when someone opens this panel
  // and picks a file immediately — the parse then runs against a stale/empty
  // items list and every ingredient looks unmatched, even ones that already
  // exist. Re-run the match whenever `items` changes so a late-arriving
  // catalog fixes already-parsed rows without the user needing to know to
  // re-pick the file. Only fills in rows that are still unmatched (null) —
  // never overwrites a match the user already made by hand in the "or match
  // existing" dropdown below. Render-time "adjust state" pattern rather
  // than an effect, same as the location fixes above.
  const [itemsSeen, setItemsSeen] = useState(items);
  if (items !== itemsSeen) {
    setItemsSeen(items);
    if (rows.length > 0) {
      const hasNewMatch = rows.some((r) => r.ingredientRaw && !r.matchedItemId && matchItem(r.ingredientRaw));
      if (hasNewMatch) {
        setRows((prev) =>
          prev.map((r) =>
            r.ingredientRaw && !r.matchedItemId ? { ...r, matchedItemId: matchItem(r.ingredientRaw) } : r
          )
        );
      }
    }
  }

  // Same CSV-or-Excel convergence pattern used by this file's own
  // parseMenuListFile -- Excel cells come back as real
  // numbers/dates, not strings, so every cell is stringified before the
  // rest of the parser (identical either way) ever sees it.
  function rowsToTable(cellRows: unknown[][]): string[][] {
    return cellRows.map((row) => row.map((c) => (c === null || c === undefined ? "" : String(c).trim())));
  }

  // Parses the unified recipe+item template's three tabs (Items, Recipes,
  // Recipe Ingredients -- see recipeImportTemplate.ts) into the same flat
  // RecipeRow[] shape the rest of this component already knows how to
  // preview/group/import (one row per ingredient, header fields repeated
  // on every row of a recipe's group -- only group[0] is ever read for
  // them, same as the flat CSV parser below), plus a separate list of
  // brand-new items from the Items tab's "new" rows for the request's own
  // `items` field -- see RecipeViewSet.bulk_import's docstring on the
  // backend for why that's better than letting an unmatched ingredient
  // name fall back to guessing a base_unit from its unit text.
  function parseThreeTabWorkbook(
    workbook: XLSX.WorkBook
  ): { rows: RecipeRow[]; itemRows: BulkItemInput[]; costsWithoutSupplier: number } | { error: string } {
    const sheetTable = (name: string): string[][] => {
      const raw = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, blankrows: false });
      return rowsToTable(raw);
    };

    // ---- Items tab: "new" rows always feed the request's items[] field.
    // "existing" rows are normally just this org's catalogue shown back
    // for reference, nothing to send -- EXCEPT when the allergens cell
    // has been filled in, the one field this import can bulk-set on an
    // already-catalogued item (see bulk_upsert_items' docstring on the
    // backend) -- that's how a whole existing catalogue gets tagged
    // without opening each item's own page one at a time.
    const itemsTable = sheetTable("Items");
    if (itemsTable.length < 1) return { error: 'The "Items" tab has no header row.' };
    const itHeader = itemsTable[0];
    const statusIdx = headerIndex(itHeader, "status");
    const itNameIdx = headerIndex(itHeader, "item_name");
    const itUnitIdx = headerIndex(itHeader, "base_unit");
    const itCatIdx = headerIndex(itHeader, "category");
    const itVatIdx = headerIndex(itHeader, "vat");
    const itParIdx = headerIndex(itHeader, "par_level");
    const itSupplierIdx = headerIndex(itHeader, "supplier");
    const itCostIdx = headerIndex(itHeader, "cost");
    const itWasteIdx = headerIndex(itHeader, "waste_pct");
    // The Items tab has 6 allergen_1..allergen_6 dropdown-slot columns
    // (see recipeImportTemplate.ts's ALLERGEN_SLOTS) rather than one free
    // -text "allergens" column -- non-blank slots are joined back into
    // the same comma-separated string BulkItemInput.allergens/
    // bulk_upsert_items already expects, so nothing downstream of this
    // needed to change.
    const itAllergenIdxs = Array.from({ length: 6 }, (_, i) => headerIndex(itHeader, `allergen_${i + 1}`));
    if (itNameIdx === -1 || itUnitIdx === -1) {
      return { error: 'The "Items" tab is missing its item_name or base_unit column.' };
    }
    // Every Items-tab row's base unit, by name. Used below to fill in an
    // ingredient's unit when the template's own lookup formula has no
    // stored value (a file saved by a tool that does not recalculate).
    const baseUnitByName = new Map<string, string>();
    for (const r of itemsTable.slice(1)) {
      const n = (r[itNameIdx] || "").trim().toLowerCase();
      const u = (r[itUnitIdx] || "").trim();
      if (n && u && !baseUnitByName.has(n)) baseUnitByName.set(n, u);
    }
    const itemRows: BulkItemInput[] = [];
    // Live items by lower-cased name (an archived copy only if there is no
    // live one), and allergen names by id, for comparing "existing" rows with
    // what is stored.
    const liveItemByName = new Map<string, CatalogItem>();
    for (const it of items) {
      const key = it.name.trim().toLowerCase();
      const seen = liveItemByName.get(key);
      if (!seen || (seen.archived && !it.archived)) liveItemByName.set(key, it);
    }
    const allergenNameById = new Map(allergens.map((a) => [a.id, a.name.trim().toLowerCase()]));
    let costsWithoutSupplier = 0;
    for (const r of itemsTable.slice(1)) {
      const status = (statusIdx > -1 ? r[statusIdx] || "" : "").trim().toLowerCase();
      const allergensRaw = itAllergenIdxs
        .filter((idx) => idx > -1)
        .map((idx) => (r[idx] || "").trim())
        .filter(Boolean)
        .join(", ");
      const name = (r[itNameIdx] || "").trim();
      if (status !== "new") {
        // A row for an item that already exists: send only what the person
        // actually changed (cost, waste %, allergens), compared with what is
        // stored now, so re-uploading an untouched file changes nothing.
        const current = liveItemByName.get(name.toLowerCase());
        if (!current) continue;
        const changes: BulkItemInput = { name: current.name, base_unit: current.base_unit, update_existing: true };
        let changed = false;

        if (allergensRaw) {
          const wanted = new Set(
            allergensRaw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
          );
          const have = new Set(
            current.allergens.map((id) => allergenNameById.get(id)).filter((n): n is string => !!n)
          );
          const same = wanted.size === have.size && [...wanted].every((n) => have.has(n));
          if (!same) {
            changes.allergens = allergensRaw;
            changed = true;
          }
        }

        const wasteRaw = itWasteIdx > -1 ? (r[itWasteIdx] || "").trim() : "";
        if (wasteRaw && !isNaN(Number(wasteRaw)) && Number(wasteRaw) >= 0 && Number(wasteRaw) <= 100) {
          const haveWaste = current.target_waste_pct == null ? null : Number(current.target_waste_pct);
          if (haveWaste === null || Math.abs(haveWaste - Number(wasteRaw)) > 0.0001) {
            changes.waste_pct = wasteRaw;
            changed = true;
          }
        }

        const costRaw = itCostIdx > -1 ? (r[itCostIdx] || "").trim() : "";
        if (costRaw && !isNaN(Number(costRaw)) && Number(costRaw) >= 0) {
          const usual = resolveUsualSupplierLink(current);
          const sheetSupplier = itSupplierIdx > -1 ? (r[itSupplierIdx] || "").trim() : "";
          const supplierName = sheetSupplier || usual?.supplier_name || "";
          if (!supplierName) {
            costsWithoutSupplier += 1;
          } else {
            const link = (current.supplier_links || []).find(
              (l) => l.supplier_name.trim().toLowerCase() === supplierName.toLowerCase()
            );
            if (!link || Math.abs(Number(link.unit_price) - Number(costRaw)) > 0.00005) {
              changes.supplier = supplierName;
              changes.cost = costRaw;
              changed = true;
            }
          }
        }

        if (changed) itemRows.push(changes);
        continue;
      }
      const unitRaw = (r[itUnitIdx] || "").trim();
      const base_unit = BASE_UNITS.find((u) => u.toLowerCase() === unitRaw.toLowerCase()) || "";
      if (!name || !base_unit) continue;
      const parRaw = itParIdx > -1 ? (r[itParIdx] || "").trim() : "";
      const par_level = parRaw && !isNaN(Number(parRaw)) && Number(parRaw) >= 0 ? parRaw : "";
      const costRaw = itCostIdx > -1 ? (r[itCostIdx] || "").trim() : "";
      const cost = costRaw && !isNaN(Number(costRaw)) && Number(costRaw) >= 0 ? costRaw : "";
      const supplier = itSupplierIdx > -1 ? (r[itSupplierIdx] || "").trim() : "";
      const vatRaw = itVatIdx > -1 ? (r[itVatIdx] || "").trim() : "";
      const wasteRaw = itWasteIdx > -1 ? (r[itWasteIdx] || "").trim() : "";
      const waste_pct = wasteRaw && !isNaN(Number(wasteRaw)) && Number(wasteRaw) >= 0 ? wasteRaw : "";
      itemRows.push({
        name,
        base_unit,
        category: (itCatIdx > -1 ? (r[itCatIdx] || "").trim() : "") || undefined,
        vat_rate: vatRaw ? (Number(vatRaw) / 100).toFixed(4) : null,
        par_level: par_level || undefined,
        supplier: supplier && cost ? supplier : undefined,
        cost: supplier && cost ? cost : undefined,
        waste_pct: waste_pct || undefined,
        allergens: allergensRaw || undefined,
      });
    }

    // ---- Recipes tab: one row per recipe (or per size variant) --
    // display_name (a formula in the template) is the name that actually
    // gets created/matched in SAWIS.
    const recipesTable = sheetTable("Recipes");
    if (recipesTable.length < 1) return { error: 'The "Recipes" tab has no header row.' };
    const rcHeader = recipesTable[0];
    const rcCatIdx = headerIndex(rcHeader, "category");
    const rcDisplayIdx = headerIndex(rcHeader, "display_name");
    const rcNameIdx = headerIndex(rcHeader, "recipe");
    const rcSizeIdx = headerIndex(rcHeader, "size");
    const rcPosIdx = headerIndex(rcHeader, "pos_id");
    const rcKindIdx = headerIndex(rcHeader, "kind");
    const rcYqIdx = headerIndex(rcHeader, "yield_qty");
    const rcYuIdx = headerIndex(rcHeader, "yield_unit");
    const rcPriceIdx = headerIndex(rcHeader, "menu_price");
    const rcGroupIdx = headerIndex(rcHeader, "menu_group");
    if (rcDisplayIdx === -1) return { error: 'The "Recipes" tab is missing its display_name column.' };

    const recipeOrderKeys: string[] = [];
    const recipeMetaByKey = new Map<
      string,
      {
        name: string;
        posId: string;
        menuCategory: string;
        kind: "dish" | "sub";
        yield_qty: string;
        yield_unit: string;
        menu_price: string;
        menuGroup: string;
      }
    >();
    for (const r of recipesTable.slice(1)) {
      // display_name is a formula (recipe + " (size)"). If the file was
      // saved without calculated values the cell reads blank, so build the
      // same name from the recipe and size columns instead.
      const recipeCell = rcNameIdx > -1 ? (r[rcNameIdx] || "").trim() : "";
      const sizeCell = rcSizeIdx > -1 ? (r[rcSizeIdx] || "").trim() : "";
      const displayName = (r[rcDisplayIdx] || "").trim() || (recipeCell ? (sizeCell ? `${recipeCell} (${sizeCell})` : recipeCell) : "");
      const kindRaw = (rcKindIdx > -1 ? r[rcKindIdx] || "" : "").trim().toLowerCase();
      if (!displayName || (kindRaw !== "dish" && kindRaw !== "sub")) continue;
      const groupRaw = (rcGroupIdx > -1 ? r[rcGroupIdx] || "" : "").trim().toLowerCase();
      const key = displayName.toLowerCase();
      if (!recipeMetaByKey.has(key)) recipeOrderKeys.push(key);
      recipeMetaByKey.set(key, {
        name: displayName,
        posId: rcPosIdx > -1 ? (r[rcPosIdx] || "").trim() : "",
        menuCategory: rcCatIdx > -1 ? (r[rcCatIdx] || "").trim() : "",
        kind: kindRaw === "sub" ? "sub" : "dish",
        yield_qty: (rcYqIdx > -1 ? r[rcYqIdx] || "" : "").trim() || "1",
        yield_unit: (rcYuIdx > -1 ? r[rcYuIdx] || "" : "").trim() || "plate",
        menu_price: (rcPriceIdx > -1 ? r[rcPriceIdx] || "" : "").trim(),
        menuGroup: groupRaw === "food" || groupRaw === "drink" ? groupRaw : "",
      });
    }
    if (recipeOrderKeys.length === 0) {
      return { error: 'No valid recipes found on the "Recipes" tab — check the kind column is "dish" or "sub".' };
    }

    // ---- Recipe Ingredients tab: one row per ingredient line, joined
    // back to its recipe's header fields by display_name.
    const riTable = sheetTable("Recipe Ingredients");
    if (riTable.length < 1) return { error: 'The "Recipe Ingredients" tab has no header row.' };
    const riHeader = riTable[0];
    const riRecipeIdx = headerIndex(riHeader, "recipe");
    const riIngIdx = headerIndex(riHeader, "ingredient");
    const riQtyIdx = headerIndex(riHeader, "qty");
    const riUnitIdx = headerIndex(riHeader, "unit");
    if (riRecipeIdx === -1 || riIngIdx === -1 || riQtyIdx === -1) {
      return { error: 'The "Recipe Ingredients" tab is missing its recipe, ingredient or qty column.' };
    }
    const ingredientsByKey = new Map<string, { ingredient: string; qty: string; unit: string }[]>();
    for (const r of riTable.slice(1)) {
      const recipeName = (r[riRecipeIdx] || "").trim();
      const ingredient = (r[riIngIdx] || "").trim();
      const qty = (r[riQtyIdx] || "").trim();
      if (!recipeName || !ingredient || !qty) continue;
      const key = recipeName.toLowerCase();
      if (!recipeMetaByKey.has(key)) continue; // not on the Recipes tab -- skip rather than error
      if (!ingredientsByKey.has(key)) ingredientsByKey.set(key, []);
      const unitCell = riUnitIdx > -1 ? (r[riUnitIdx] || "").trim() : "";
      ingredientsByKey.get(key)!.push({ ingredient, qty, unit: unitCell || baseUnitByName.get(ingredient.toLowerCase()) || "" });
    }

    const parsedRows: RecipeRow[] = [];
    for (const key of recipeOrderKeys) {
      const meta = recipeMetaByKey.get(key)!;
      const ingredientLines = ingredientsByKey.get(key) || [];
      const header = {
        recipeName: meta.name,
        posId: meta.posId,
        menuCategory: meta.menuCategory,
        kind: meta.kind,
        yield_qty: meta.yield_qty,
        yield_unit: meta.yield_unit,
        menu_price: meta.menu_price,
        menuGroup: meta.menuGroup,
      };
      if (ingredientLines.length === 0) {
        parsedRows.push({ ...header, ingredientRaw: "", qty: "", unit: "", matchedItemId: null });
      } else {
        for (const line of ingredientLines) {
          parsedRows.push({
            ...header,
            ingredientRaw: line.ingredient,
            qty: line.qty,
            unit: line.unit,
            matchedItemId: matchItem(line.ingredient),
          });
        }
      }
    }
    return { rows: parsedRows, itemRows, costsWithoutSupplier };
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError(null);
    setImportError(null);
    setResult(null);
    setNewItemRows([]);
    setCostsWithoutSupplier(0);
    const isSpreadsheet = /\.xlsx?$/i.test(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      let table: string[][];
      try {
        if (isSpreadsheet) {
          const workbook = XLSX.read(reader.result as ArrayBuffer, { type: "array" });
          const sheetNames = new Set(workbook.SheetNames);
          // The unified recipe+item template (Items / Recipes / Recipe
          // Ingredients -- see recipeImportTemplate.ts) joins two sheets
          // together, so it's handled by parseThreeTabWorkbook above
          // rather than the flat single-sheet logic below. Anything else
          // -- the older single-sheet CSV/Excel shape -- falls through
          // unchanged, for backward compatibility.
          if (sheetNames.has("Items") && sheetNames.has("Recipes") && sheetNames.has("Recipe Ingredients")) {
            const outcome = parseThreeTabWorkbook(workbook);
            if ("error" in outcome) {
              setParseError(outcome.error);
              setRows([]);
            } else {
              setRows(outcome.rows);
              setNewItemRows(outcome.itemRows);
              setCostsWithoutSupplier(outcome.costsWithoutSupplier);
            }
            return;
          }
          // The real-data template ships ingredient rows grouped/collapsed
          // under each recipe's first row via Excel's outline feature --
          // sheet_to_json still returns every row regardless of collapsed
          // state, so nothing extra is needed to read through that here.
          const sheetName = workbook.SheetNames.includes("Recipes") ? "Recipes" : workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];
          const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
          table = rowsToTable(raw);
        } else {
          table = parseCsv(String(reader.result || ""));
        }
      } catch {
        setParseError("Could not read that file — check it's a valid CSV or Excel spreadsheet.");
        setRows([]);
        return;
      }
      if (table.length < 2) {
        setParseError("No rows found after the header.");
        setRows([]);
        return;
      }
      const header = table[0];
      const recIdx = headerIndex(header, "recipe");
      const posIdIdx = headerIndexAny(header, ["pos_id", "id"]);
      const catIdx = headerIndexAny(header, ["menu_category", "category", "gruppe"]);
      const kindIdx = headerIndex(header, "kind");
      const yqIdx = headerIndex(header, "yield_qty");
      const yuIdx = headerIndex(header, "yield_unit");
      const priceIdx = headerIndex(header, "menu_price");
      const groupIdx = headerIndexAny(header, ["menu_group", "food_drink", "food/drink", "type"]);
      const ingIdx = headerIndex(header, "ingredient");
      const qtyIdx = headerIndex(header, "qty");
      const unitIdx = headerIndex(header, "unit");
      if (recIdx === -1 || ingIdx === -1 || qtyIdx === -1) {
        setParseError(
          `Expected at least "recipe,ingredient,qty" columns — found: ${header.join(", ")}`
        );
        setRows([]);
        return;
      }
      const parsed: RecipeRow[] = [];
      for (const r of table.slice(1)) {
        const recipeName = (r[recIdx] || "").trim();
        const ingredientRaw = (r[ingIdx] || "").trim();
        const qty = (r[qtyIdx] || "").trim();
        if (!recipeName) continue;
        // A recipe row is allowed to carry no ingredient at all (e.g. a
        // row prefilled from a menu-list export — see
        // handlePrefillFromMenuList below — that the customer hasn't
        // gotten to yet, or a recipe whose metadata is just being
        // updated): what's rejected is a HALF-filled ingredient (a name
        // with no qty, or a qty with no name), which is more likely a
        // typo than an intentional blank row.
        if ((ingredientRaw && !qty) || (!ingredientRaw && qty)) continue;
        // Optional columns fall back to "" the same way recIdx/ingIdx/qtyIdx
        // do above — necessary, not just tidy: SheetJS's sheet_to_json({header:1})
        // returns each row sized to that row's own populated cells, so a row
        // with a blank trailing or interior cell (e.g. an ingredient-only
        // continuation line with no kind/menu_category/menu_group of its own)
        // comes back shorter than the header, or with a "hole" at that index
        // that Array.prototype.map (in rowsToTable) silently skips over rather
        // than converting to "". Either way r[idx] is `undefined` even though
        // idx > -1 (the column exists in the header) — CSV rows never hit this
        // because parseCsv always emits an explicit "" field per column, which
        // is why the same file imports fine as CSV but threw here as Excel.
        const kindRaw = (kindIdx > -1 ? r[kindIdx] || "" : "").trim().toLowerCase();
        const groupRaw = (groupIdx > -1 ? r[groupIdx] || "" : "").trim().toLowerCase();
        parsed.push({
          recipeName,
          posId: (posIdIdx > -1 ? r[posIdIdx] || "" : "").trim(),
          menuCategory: (catIdx > -1 ? r[catIdx] || "" : "").trim(),
          kind: kindRaw === "sub" ? "sub" : "dish",
          yield_qty: (yqIdx > -1 ? r[yqIdx] || "" : "").trim() || "1",
          yield_unit: (yuIdx > -1 ? r[yuIdx] || "" : "").trim() || "plate",
          menu_price: (priceIdx > -1 ? r[priceIdx] || "" : "").trim(),
          menuGroup: groupRaw === "food" || groupRaw === "drink" ? groupRaw : "",
          ingredientRaw,
          qty,
          unit: (unitIdx > -1 ? r[unitIdx] || "" : "").trim(),
          matchedItemId: ingredientRaw ? matchItem(ingredientRaw) : null,
        });
      }
      setRows(parsed);
      if (parsed.length === 0) setParseError("No valid rows found — check the recipe/ingredient/qty columns.");
    };
    if (isSpreadsheet) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
  }

  // "Import menu list" — reads the customer's existing POS menu export
  // (any name/format — a generic recipe/name column, an optional
  // id/pos_id column, an optional category/gruppe column, an optional
  // price/preis column, in either CSV, semicolon-CSV, or Excel) and
  // returns just the recipe metadata rows — never ingredients, since
  // this kind of file never has ingredient data at all. Shared by the
  // primary "Import menu list" flow below (which opens
  // MenuListImportModal for in-app ingredient picking) and the
  // "Prefill from your menu list" advanced option (which turns the same
  // rows into a downloadable spreadsheet template instead).
  //
  // Handles the one real quirk this format tends to have: a POS export
  // sometimes prints a category name as its own bare row (only the
  // category column populated) rather than repeating it on every dish
  // row -- that bare row's value is carried forward onto every following
  // dish row until the next one.
  async function parseMenuListFile(file: File): Promise<ParsedMenuRow[]> {
    const isExcel = /\.xlsx?$/i.test(file.name);
    let table: string[][];
    if (isExcel) {
      const buf = await file.arrayBuffer();
      const workbook = XLSX.read(buf, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
      table = raw.map((row) => row.map((c) => (c === undefined || c === null ? "" : String(c))));
    } else {
      const text = await file.text();
      // Sniff the delimiter rather than assuming — a semicolon-delimited
      // POS export is common (German-locale Excel default), but a
      // customer may have re-saved it in a comma locale.
      const delimiter = text.split("\n")[0].includes(";") ? ";" : ",";
      table = parseCsv(text, delimiter);
    }
    if (table.length < 2) throw new Error("No rows found after the header.");
    const header = table[0];
    const grpIdx = headerIndexAny(header, ["gruppe", "menu_category", "category"]);
    const idIdx = headerIndexAny(header, ["id", "pos_id"]);
    const nameIdx = headerIndexAny(header, ["artikel", "recipe", "name", "dish"]);
    const priceIdx = headerIndexAny(header, ["preis", "menu_price", "price"]);
    if (nameIdx === -1) {
      throw new Error(`Couldn't find a recipe name column — found: ${header.join(", ")}`);
    }
    const parsed: ParsedMenuRow[] = [];
    let currentGroup = "";
    for (const r of table.slice(1)) {
      const group = grpIdx > -1 ? (r[grpIdx] || "").trim() : "";
      const dish = (r[nameIdx] || "").trim();
      if (group && !dish) {
        // A bare category row — no dish on it, just a new heading to
        // apply to the item rows that follow.
        currentGroup = group;
        continue;
      }
      if (!dish) continue;
      parsed.push({
        recipeName: dish,
        posId: idIdx > -1 ? (r[idIdx] || "").trim() : "",
        menuCategory: group || currentGroup,
        menuPrice: priceIdx > -1 ? cleanNumeric(r[priceIdx]) : "",
      });
    }
    if (parsed.length === 0) throw new Error("No recipe rows found in that file.");
    return parsed;
  }

  // Primary path: parse the menu list, then open MenuListImportModal so
  // the user picks ingredients per dish in-app instead of typing them
  // into a spreadsheet.
  const [menuListRows, setMenuListRows] = useState<ParsedMenuRow[] | null>(null);
  const [menuListFileName, setMenuListFileName] = useState("");
  const [menuListError, setMenuListError] = useState<string | null>(null);

  async function handleMenuListFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMenuListError(null);
    try {
      const parsed = await parseMenuListFile(file);
      setMenuListFileName(file.name);
      setMenuListRows(parsed);
    } catch (err) {
      setMenuListError(err instanceof Error ? err.message : "Could not read that file.");
    }
    e.target.value = "";
  }

  // Advanced path: same parse, but hands the result back as a
  // downloadable copy of the ingredient-column CSV template below
  // (recipe/pos_id/menu_category/menu_price pre-filled, ingredient/qty/
  // unit left blank) for anyone who'd rather bulk-edit a spreadsheet.
  const [prefillError, setPrefillError] = useState<string | null>(null);

  async function handlePrefillFromMenuList(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPrefillError(null);
    try {
      const parsed = await parseMenuListFile(file);
      downloadCsv(
        "recipe-ingredients-template.csv",
        ["recipe", "pos_id", "menu_category", "kind", "yield_qty", "yield_unit", "menu_price", "ingredient", "qty", "unit"],
        parsed.map((r) => [r.recipeName, r.posId, r.menuCategory, "dish", "1", "plate", r.menuPrice, "", "", ""])
      );
    } catch (err) {
      setPrefillError(err instanceof Error ? err.message : "Could not read that file.");
    }
    e.target.value = "";
  }

  function updateRow(i: number, patch: Partial<RecipeRow>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  // First occurrence of each recipe name supplies the header fields
  // (kind/yield/menu price/pos_id/menu_category); later rows for the
  // same recipe are ingredient lines only, matching the "one row per
  // ingredient" CSV shape. Grouped by name (not pos_id) since that's
  // what repeats down the CSV rows for a given recipe — pos_id is
  // carried along on the group's first row and used below purely to
  // decide create-vs-update against what's already in SAWIS.
  const recipeOrder: string[] = [];
  const grouped = new Map<string, RecipeRow[]>();
  for (const r of rows) {
    const key = r.recipeName.trim().toLowerCase();
    if (!grouped.has(key)) {
      recipeOrder.push(key);
      grouped.set(key, []);
    }
    grouped.get(key)!.push(r);
  }
  const existingItemNamesLower = new Set(items.map((i) => i.name.trim().toLowerCase()));
  // newItemRows also carries "existing" rows sent through purely for a
  // filled-in allergens cell (see parseThreeTabWorkbook) -- those aren't
  // creating anything, so they're excluded from this count by checking
  // against the org's actual current item names.
  const newItemNames = new Set([
    ...rows.filter((r) => !r.matchedItemId && r.ingredientRaw).map((r) => r.ingredientRaw.trim().toLowerCase()),
    ...newItemRows
      .filter((r) => !existingItemNamesLower.has(r.name.trim().toLowerCase()))
      .map((r) => r.name.trim().toLowerCase()),
  ]);
  const allergensPreviewCount = newItemRows.filter((r) => r.allergens).length;
  const costPreviewCount = newItemRows.filter((r) => r.update_existing && r.cost).length;
  const wastePreviewCount = newItemRows.filter((r) => r.update_existing && r.waste_pct).length;
  const recipesByPosId = new Map(recipes.filter((r) => r.pos_id).map((r) => [r.pos_id, r]));
  const recipesByName = new Map(recipes.map((r) => [r.name.trim().toLowerCase(), r]));

  // What a group's first row will match against server-side (see
  // RecipeViewSet.bulk_import's upsert: pos_id first, else name) — used
  // to show "will update" vs "will create" before the user confirms,
  // and how many of that recipe's existing ingredient lines will be
  // replaced by this import.
  function matchFor(first: RecipeRow): Recipe | undefined {
    if (first.posId && recipesByPosId.has(first.posId)) return recipesByPosId.get(first.posId);
    return recipesByName.get(first.recipeName.trim().toLowerCase());
  }

  async function handleImport() {
    if (rows.length === 0 || !location) return;
    setImporting(true);
    setImportError(null);
    try {
      const payload = recipeOrder.map((key) => {
        const group = grouped.get(key)!;
        const first = group[0];
        return {
          name: first.recipeName,
          kind: first.kind,
          yield_qty: first.yield_qty,
          yield_unit: first.yield_unit,
          menu_price: first.kind === "dish" && first.menu_price ? first.menu_price : null,
          pos_id: first.posId || undefined,
          menu_category: first.menuCategory || undefined,
          menu_group: (first.menuGroup || undefined) as "food" | "drink" | undefined,
          lines: group
            .filter((r) => r.ingredientRaw && r.qty)
            .map((r) => ({
              item_id: r.matchedItemId || undefined,
              item_name: r.ingredientRaw,
              qty: r.qty,
              unit: r.unit,
            })),
        };
      });
      const res = await bulkImportRecipes(
        accessToken,
        location,
        payload,
        newItemRows.length > 0 ? newItemRows : undefined
      );
      setResult({
        created: res.created,
        updated: res.updated,
        itemsCreated: res.items_created,
        holdingsBackfilled: res.holdings_backfilled.length,
        allergensSet: res.allergens_set.length,
        costsUpdated: (res.costs_updated ?? []).length,
        wasteUpdated: (res.waste_updated ?? []).length,
      });
      setRows([]);
      setNewItemRows([]);
      setFileName("");
      onRecipesChanged();
      if (
        res.items_created.length > 0 ||
        res.holdings_backfilled.length > 0 ||
        res.allergens_set.length > 0 ||
        (res.costs_updated ?? []).length > 0 ||
        (res.waste_updated ?? []).length > 0
      )
        onItemsChanged();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Could not import these recipes.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Import recipes & items</h2>

      {locations.length > 1 && (
        <div className="field" style={{ maxWidth: 280, marginBottom: 12 }}>
          <label>Location</label>
          <select value={location} onChange={(e) => setLocation(e.target.value)}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="field" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            className="btn-ghost small"
            disabled={templateDownloading}
            onClick={() => setConfirmingTemplateDownload(true)}
          >
            {templateDownloading ? "Preparing…" : "⇩ Download Excel template"}
          </button>
        </div>
        <div className="vhint" style={{ marginTop: 6 }}>
          Personalized to your account — its Items tab already lists your current catalogue and its Recipes tab's
          category dropdown lists your existing categories, so nothing has to be retyped. Three tabs: Items,
          Recipes, Recipe Ingredients — see the Read me tab for how they fit together. Got a POS menu export
          instead of typing it by hand? Use "Prefill from your menu list" under Advanced below.
        </div>
        {confirmingTemplateDownload && (
          <PasswordConfirmModal
            accessToken={accessToken}
            title="Confirm your password"
            description="This downloads your full recipe and item catalogue, including costs and suppliers. Re-enter your password to continue."
            onConfirmed={async () => {
              setConfirmingTemplateDownload(false);
              setTemplateDownloading(true);
              try {
                await downloadRecipeImportTemplate(items, recipes, location, allergens);
              } finally {
                setTemplateDownloading(false);
              }
            }}
            onClose={() => setConfirmingTemplateDownload(false)}
          />
        )}
      </div>

      <div className="field" style={{ marginBottom: 14 }}>
        <label>Excel file</label>
        <input type="file" accept=".csv,text/csv,.xlsx,.xls" onChange={handleFile} />
        <div className="vhint">
          Upload the filled-in template from above. Matching <code>pos_id</code> (or name) <b>updates</b> an
          existing recipe, replacing its ingredients; anything new is <b>created</b>.
        </div>
      </div>

      <details className="field" style={{ marginBottom: 12 }}>
        <summary className="mini-link">Advanced: import from your POS or till system instead</summary>
        <div style={{ marginTop: 10 }}>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Import menu list</label>
            <input type="file" accept=".csv,text/csv,.xlsx,.xls" onChange={handleMenuListFile} />
            {menuListError && <p className="error" style={{ marginTop: 6 }}>{menuListError}</p>}
            <div className="vhint">
              Upload your menu export from your POS or till system (CSV or Excel — a recipe/dish name column is
              all that's required). You'll then pick each dish's ingredients from your existing items on screen —
              nothing to type into a spreadsheet.
            </div>
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label className="btn-ghost small" style={{ cursor: "pointer" }}>
              ⇩ Prefill the template above from your menu list
              <input
                type="file"
                accept=".csv,text/csv,.xlsx,.xls"
                onChange={handlePrefillFromMenuList}
                style={{ display: "none" }}
              />
            </label>
            {prefillError && <p className="error" style={{ marginTop: 6 }}>{prefillError}</p>}
            <div className="vhint" style={{ marginTop: 6 }}>
              Reads the same POS export and hands back the CSV template with <code>recipe</code>/<code>pos_id</code>/
              <code>menu_category</code>/<code>menu_price</code> already filled in — add ingredient rows by hand,
              then upload the template above.
            </div>
          </div>
        </div>
      </details>

      {menuListRows && (
        <MenuListImportModal
          accessToken={accessToken}
          items={items}
          recipes={recipes}
          location={location}
          fileName={menuListFileName}
          rows={menuListRows}
          onClose={() => setMenuListRows(null)}
          onItemsChanged={onItemsChanged}
          onRecipesChanged={() => {
            onRecipesChanged();
            setMenuListRows(null);
          }}
        />
      )}

      {!locations.length && <p className="error">No locations yet — add one before importing recipes.</p>}
      {parseError && <p className="error">{parseError}</p>}
      {importError && <p className="error">{importError}</p>}

      {!result && rows.length > 0 && (
        <>
          <div className="im-note">
            ✓ <b>{recipeOrder.length} recipe{recipeOrder.length === 1 ? "" : "s"}</b>, {rows.length} ingredient
            line{rows.length === 1 ? "" : "s"} read from {fileName}.
            {newItemNames.size > 0 && ` ${newItemNames.size} new item${newItemNames.size === 1 ? "" : "s"} will be created.`}
            {allergensPreviewCount > 0 &&
              ` ${allergensPreviewCount} item${allergensPreviewCount === 1 ? "" : "s"} will have allergen tags set.`}
            {costPreviewCount > 0 &&
              ` ${costPreviewCount} item${costPreviewCount === 1 ? "" : "s"} will get a new supplier price.`}
            {wastePreviewCount > 0 &&
              ` ${wastePreviewCount} item${wastePreviewCount === 1 ? "" : "s"} will get a new waste target.`}
            {costsWithoutSupplier > 0 &&
              ` ${costsWithoutSupplier} changed cost${costsWithoutSupplier === 1 ? " was" : "s were"} skipped because the item has no supplier on its row.`}
          </div>
          <div className="table-scroll">
            <table className="tbl" style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>Recipe</th>
                  <th>Ingredient (from CSV)</th>
                  <th>Matched item</th>
                  <th className="num">Qty</th>
                  <th>Unit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const isFirstOfGroup = i === 0 || rows[i - 1].recipeName.trim().toLowerCase() !== r.recipeName.trim().toLowerCase();
                  const match = isFirstOfGroup ? matchFor(r) : undefined;
                  const existingLineCount = match ? match.lines.filter((l) => l.line_type === "item").length : 0;
                  return (
                    <tr key={i}>
                      <td>
                        {isFirstOfGroup ? (
                          <>
                            <b>{r.recipeName}</b>
                            <div className="muted" style={{ fontSize: 11 }}>
                              {r.kind} · yields {r.yield_qty} {r.yield_unit}
                              {r.kind === "dish" && r.menu_price
                                ? ` · ${currencySymbol(locations.find((l) => l.id === location)?.currency)}${r.menu_price}`
                                : ""}
                              {r.posId ? ` · POS ${r.posId}` : ""}
                              {r.menuCategory ? ` · ${r.menuCategory}` : ""}
                            </div>
                            {match ? (
                              <div className="badge b-low" style={{ marginTop: 3 }}>
                                Will update — matched by {r.posId && match.pos_id === r.posId ? "POS ID" : "name"}
                                {existingLineCount > 0 ? `, replaces ${existingLineCount} existing ingredient line${existingLineCount === 1 ? "" : "s"}` : ""}
                              </div>
                            ) : (
                              <div className="badge b-ok" style={{ marginTop: 3 }}>
                                Will create new recipe
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="muted">↳</span>
                        )}
                      </td>
                      <td>{r.ingredientRaw || <span className="muted">— (no ingredients on this row)</span>}</td>
                      <td>
                        {!r.ingredientRaw ? (
                          <span className="muted">—</span>
                        ) : r.matchedItemId ? (
                          <span className="badge b-ok">{items.find((it) => it.id === r.matchedItemId)?.name}</span>
                        ) : (
                          <>
                            <span className="badge b-low" style={{ marginRight: 6 }}>
                              Will create new item
                            </span>
                            <SearchSelect
                              value=""
                              onChange={(val) => updateRow(i, { matchedItemId: val || null })}
                              placeholder="— or match existing —"
                              aria-label="Match existing item"
                              style={{ width: 200 }}
                              options={items.map((it) => ({ value: it.id, label: it.name }))}
                            />
                          </>
                        )}
                      </td>
                      <td className="num">{r.qty || "—"}</td>
                      <td className="muted">{r.unit || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="modal-actions" style={{ marginTop: 16 }}>
            <button className="btn-primary" onClick={handleImport} disabled={importing || !location}>
              {importing
                ? "Importing…"
                : `Import ${recipeOrder.length} recipe${recipeOrder.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </>
      )}

      {result && (
        <div className="im-note" style={{ marginTop: 12 }}>
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
          {result.allergensSet > 0 &&
            ` ${result.allergensSet} item${result.allergensSet === 1 ? "" : "s"} had allergen tags set.`}
          {result.costsUpdated > 0 &&
            ` ${result.costsUpdated} item${result.costsUpdated === 1 ? "" : "s"} got a new supplier price.`}
          {result.wasteUpdated > 0 &&
            ` ${result.wasteUpdated} item${result.wasteUpdated === 1 ? "" : "s"} got a new waste target.`}
        </div>
      )}
    </div>
  );
}
