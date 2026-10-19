import { autoFactor } from "./api";
import type { CatalogItem, ScannedReceipt, Supplier } from "./api";

// Helpers for the Scan receipt flow: telling the customer's own block from the
// supplier's, recognising a supplier from more than one detected name, and
// turning the unit printed on an invoice line into one of the item's units.
// None of this changes what the scan reads; it only decides what to offer.

// Lower case, accents removed, letters and digits only -- so "Peggy's Coffee & Tea"
// and "PEGGYS COFFEE TEA" are the same key.
export function nameKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// True when `name` is (or clearly contains, or sits inside) one of the
// business's own names.
export function isOwnName(name: string | null | undefined, ownNames: string[]): boolean {
  const k = nameKey(name ?? "");
  if (!k) return false;
  return ownNames.some((o) => {
    const ok = nameKey(o);
    if (!ok) return false;
    return k === ok || (ok.length >= 6 && k.includes(ok)) || (k.length >= 6 && ok.includes(k));
  });
}

const alnumUpper = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const digitsOnly = (s: string) => s.replace(/\D/g, "");

// Hosts mentioned in a piece of text: "office@panasia.at" and "www.panasia.at"
// both give "panasia.at".
function hostsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.toLowerCase().matchAll(/@([a-z0-9-]+(?:\.[a-z0-9-]+)+)/g)) out.push(m[1]);
  for (const m of text.toLowerCase().matchAll(/\b(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})\b/g)) out.push(m[1]);
  return out;
}

// Looks for a known supplier in everything the scan labelled on the page: VAT
// number, email or website, phone number and (only when asked) the supplier's
// name inside any detected text. Returns the best match and what it was
// recognised from, or null when nothing is convincing.
export function findSupplierFromScan(
  result: ScannedReceipt,
  suppliers: Supplier[],
  ownNames: string[],
  includeName: boolean
): { supplier: Supplier; why: string } | null {
  const values = (result.summary_fields ?? [])
    .map((f) => f.value)
    .filter((v) => v && !isOwnName(v, ownNames));
  if (!values.length) return null;
  const joined = values.join(" \n ");
  const joinedAlnum = alnumUpper(joined);
  const joinedDigits = digitsOnly(joined);
  const joinedKey = nameKey(joined);
  const hosts = values.flatMap(hostsIn);

  let best: { supplier: Supplier; score: number; why: string } | null = null;
  for (const s of suppliers) {
    if (s.archived) continue;
    let score = 0;
    let why = "";
    const vat = alnumUpper(s.vat_number ?? "");
    if (vat.length >= 6 && joinedAlnum.includes(vat)) {
      score = 3;
      why = "VAT number";
    }
    const email = (s.contact_email ?? "").toLowerCase();
    if (!score && email.includes("@")) {
      const domain = email.split("@")[1];
      if (joined.toLowerCase().includes(email) || hosts.includes(domain)) {
        score = 3;
        why = "email address";
      }
    }
    const phone = digitsOnly(s.contact_phone ?? "");
    if (!score && phone.length >= 7 && joinedDigits.includes(phone.replace(/^0+/, ""))) {
      score = 2;
      why = "phone number";
    }
    const sKey = nameKey(s.name);
    if (!score && sKey.length >= 5) {
      const fromHost = hosts.some((h) => {
        const label = h.split(".")[0];
        return label.length >= 5 && (sKey.includes(label) || label.includes(sKey));
      });
      if (fromHost) {
        score = 2;
        why = "website or email";
      } else if (includeName && joinedKey.includes(sKey)) {
        score = 2;
        why = "name";
      }
    }
    if (score && (!best || score > best.score)) best = { supplier: s, score, why };
  }
  return best && best.score >= 2 ? { supplier: best.supplier, why: best.why } : null;
}

// The item's own unit that matches the unit printed beside the quantity ("pkg"),
// as { unit, packQty } for a scan row, or null when the item has no such unit.
export function unitFromPrinted(
  item: CatalogItem | undefined,
  printed: string | null | undefined
): { unit: string; packQty: string } | null {
  if (!item || !printed) return null;
  const p = printed.trim().replace(/\.$/, "").toLowerCase();
  if (!p || p === item.base_unit.toLowerCase()) return null;
  const pack = (item.stock_units ?? []).find((u) => u.name.toLowerCase() === p);
  if (pack) return { unit: pack.name, packQty: String(Number(pack.qty)) };
  const canon: Record<string, string> = { kg: "kg", g: "g", ml: "ml", l: "L", lt: "L", ltr: "L", liter: "L", litre: "L" };
  const c = canon[p];
  if (c && c !== item.base_unit) {
    const f = autoFactor(c, item.base_unit);
    if (f !== null) return { unit: c, packQty: String(f) };
  }
  return null;
}
