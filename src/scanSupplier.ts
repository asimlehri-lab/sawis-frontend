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

// Some suppliers (Pan Asia) print the number of cartons in one column and the
// number of pieces in another, and price each PIECE: "Menge 40 pkg | Ktn 1 |
// price 1.25 | total 50.00". The scan reads the pieces as the quantity and the
// carton count as `quantity_read`. A person buying this thinks in cartons, so
// the row is offered as cartons: 1 ctn at 50.00, one ctn holding 40 pieces.
// Pure arithmetic: it never changes what was read, only how the row is first
// shown, and `alt` keeps the piece view so the person can switch back.
export interface CartonView {
  qty: string;
  unitPrice: string;
  supplierUnit: string;
  packQty: string;
  cartons: number;
  perCarton: number;
  pieceLabel: string;
  alt: { qty: string; unitPrice: string; supplierUnit: string; packQty: string };
}

const COUNT_WORDS = new Set(["ea", "pkg", "pk", "pack", "pc", "pcs", "piece", "pieces", "each", "unit", "units", "stk", "st", "btl", "bottle", "can", "bag", "box"]);

function plainNumber(n: number): string {
  let s = String(parseFloat(n.toFixed(4)));
  if (!s.includes(".")) s += ".00";
  else if (s.split(".")[1].length === 1) s += "0";
  return s;
}

export function cartonView(
  item: CatalogItem | undefined,
  line: { qty: number; read: number; price: number; printedUnit: string | null | undefined; piece: { unit: string; packQty: string } | null }
): CartonView | null {
  if (!item) return null;
  const { qty, read, price, piece } = line;
  if (!(qty > 0) || !(read > 0) || !(price > 0) || !Number.isInteger(read)) return null;
  const ratio = qty / read;
  const perCarton = Math.round(ratio);
  if (perCarton < 2 || Math.abs(ratio - perCarton) > 0.001) return null;
  const printed = (line.printedUnit ?? "").trim().replace(/\.$/, "").toLowerCase();
  // Without a printed piece unit the line only had one corrected figure, which
  // is more likely a misread digit than a carton count.
  if (!printed) return null;
  // How many of the item's own unit one printed piece is. When the item has a
  // matching unit (pkg = 10 ea) that is its size; when the printed unit is the
  // item's own unit, or plain "pieces" for a counted item, it is 1. Anything
  // else (a kg line on a counted item, say) is not guessed at.
  let pieceSize = 1;
  if (piece) pieceSize = Number(piece.packQty);
  else if (printed !== item.base_unit.toLowerCase() && !COUNT_WORDS.has(printed)) return null;
  if (!Number.isFinite(pieceSize) || pieceSize <= 0) return null;
  // Weighed or poured items: a printed piece of unknown weight is not 1 g.
  if (!piece && ["g", "kg", "ml", "l"].includes(item.base_unit.toLowerCase())) return null;
  const packQty = perCarton * pieceSize;
  const saved = (item.stock_units ?? []).find((u) => ["ctn", "carton"].includes(u.name.toLowerCase()));
  if (saved && Math.abs(Number(saved.qty) - packQty) > 0.0001) return null;
  return {
    qty: String(read),
    unitPrice: plainNumber(price * perCarton),
    supplierUnit: saved ? saved.name : "ctn",
    packQty: String(parseFloat(packQty.toFixed(4))),
    cartons: read,
    perCarton,
    pieceLabel: printed,
    alt: {
      qty: String(qty),
      unitPrice: plainNumber(price),
      supplierUnit: piece?.unit ?? "",
      packQty: piece?.packQty ?? "1",
    },
  };
}
