import { useEffect, useState } from "react";
import {
  fetchPurchaseOrder,
  updatePurchaseOrder,
  createPOLine,
  updatePOLine,
  deletePOLine,
  deletePurchaseOrder,
  reopenPurchaseOrder,
  receivePurchaseOrder,
  createPurchaseOrder,
  fetchOnHand,
  formatMoney,
  autoFactor,
  convertToBaseUnit,
  scanReceipt,
  uploadPOAttachment,
  fetchPOAttachmentDownloadUrl,
  deletePOAttachment,
} from "./api";
import type { PurchaseOrder, CatalogItem, Supplier, ItemSupplierRow, Location } from "./api";
import SearchSelect from "./SearchSelect";
import Loader from "./Loader";

interface Props {
  poId: string;
  accessToken: string;
  isAdmin: boolean;
  // Staff: can read the order and receive it (and attach the delivery
  // photo), but not place, edit, send, re-source or delete it. The backend
  // enforces the same split.
  readOnly?: boolean;
  items: CatalogItem[];
  suppliers: Supplier[];
  itemSupplierLinks: ItemSupplierRow[];
  locations: Location[];
  onBack: () => void;
  onChanged: () => void;
  onOpenPO: (id: string) => void;
  backLabel?: string;
}

const STATUS_FLOW: PurchaseOrder["status"][] = ["draft", "sent", "received"];
const STATUS_LABEL: Record<PurchaseOrder["status"], string> = {
  draft: "Draft",
  awaiting: "Awaiting",
  sent: "Sent",
  received: "Received",
  amended: "Amended",
};
const ATTACHMENT_SOURCE_LABEL: Record<"scan_receipt" | "scan_delivery" | "manual", string> = {
  scan_receipt: "Scan receipt",
  scan_delivery: "Scan delivery",
  manual: "Attached by hand",
};
const DEPARTMENTS = [
  { value: "kitchen", label: "Kitchen" },
  { value: "bar", label: "Bar" },
  { value: "foh", label: "Front of house" },
] as const;

// Trims a quantity to at most 2 decimals without padding on trailing zeros
// ("1" not "1.00", "0.75" not "0.750") -- used for the as-invoiced
// supplier_qty display below, which is a whole "1 L"/"2 case" most of the
// time and shouldn't look like a raw stored decimal. Capped at 2, not 3+,
// same as every other quantity/price shown to the user -- no payment or
// purchase is ever displayed with more precision than that, even though
// POLine/ItemSupplier keep more internally for accurate costing.
function formatQty(n: number): string {
  return parseFloat(n.toFixed(2)).toString();
}

// "1.2 MB" / "480 KB" / "900 B" -- attachments are photos/PDFs, not
// something a user needs byte-precision on, just a sanity-check size.
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Duplicated from App.tsx's Scan receipt review (matchScore/cleanNumeric)
// rather than imported -- same "small local helper per file" convention
// already used throughout this codebase (see e.g. Inventory.tsx's own
// copies for the count-sheet scan). This file already has its own
// findKnownSupplierUnit further down (used by the manual "Add line" pack
// conversion) -- "Scan delivery" below reuses that one rather than adding
// a second copy. Powers "Scan delivery": matching each scanned receipt
// line against THIS PO's own order lines, not the whole item catalogue,
// so a photo taken while receiving a specific sent order cross-checks
// against what was actually ordered rather than guessing a brand-new PO
// from scratch.
function matchScore(ours: string, raw: string): number {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[0-9]+(\.[0-9]+)?\s*(kg|g|ml|l|cl|oz|x|case|sack|class)?/g, " ")
      .replace(/[^a-z ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);
  const a = new Set(norm(ours));
  const b = new Set(norm(raw));
  if (!a.size) return 0;
  let hit = 0;
  a.forEach((w) => {
    if (b.has(w) || [...b].some((x) => x.startsWith(w) || w.startsWith(x))) hit++;
  });
  return hit / a.size;
}

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


export default function ProcurementDetail({
  poId,
  accessToken,
  isAdmin,
  readOnly = false,
  items,
  suppliers,
  itemSupplierLinks,
  locations,
  onBack,
  onChanged,
  onOpenPO,
  backLabel,
}: Props) {
  const label = backLabel ?? "← All purchase orders";
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const currency = locations.find((l) => l.id === po?.location)?.currency;
  const [error, setError] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);

  const [addItemId, setAddItemId] = useState("");
  const [addDept, setAddDept] = useState<"kitchen" | "bar" | "foh">("kitchen");
  const [addQty, setAddQty] = useState("1");
  const [addPrice, setAddPrice] = useState("0.00");
  // Supplier pack/unit conversion for the manual "Add line" form -- mirrors
  // ScanRow's supplierUnit/packQty in App.tsx's Scan receipt modal (see
  // scanRowBaseUnits/findKnownSupplierUnit there for the source pattern).
  // "" means "qty/price above are already in the item's own base_unit, no
  // conversion needed" -- the same meaning as an empty ScanRow.supplierUnit.
  // When set and different from the item's base_unit, addQty/addPrice are
  // instead read as the supplier's own qty/price (e.g. "3 bottles @
  // €1.20/L") and converted at submit time -- never stored as-is, since
  // POLine.qty/unit_price must always be true base_unit figures.
  const [addSupplierUnit, setAddSupplierUnit] = useState("");
  const [addPackQty, setAddPackQty] = useState("1");
  // Defaults from the selected item's own effective_vat_rate (see
  // handleAddItemSelect) but freely editable -- same reasoning as
  // ScanRow.vatPct in App.tsx's Scan receipt: a supplier's invoice can
  // legitimately carry a different rate than this org's own default for
  // the same item. "" means "use the item's own rate" (vat_rate: null).
  const [addVatPct, setAddVatPct] = useState("");
  const [addPackExpanded, setAddPackExpanded] = useState(false);
  const [savingLine, setSavingLine] = useState(false);
  const [lineError, setLineError] = useState<string | null>(null);

  const [showReceive, setShowReceive] = useState(false);
  const [receiveLines, setReceiveLines] = useState<Record<string, { qty: string; price: string }>>({});
  const [receiving, setReceiving] = useState(false);
  const [receiveError, setReceiveError] = useState<string | null>(null);
  const [invoiceNumberInput, setInvoiceNumberInput] = useState("");
  // "Scan delivery" -- cross-checks a photo of what actually arrived
  // against THIS PO's own lines (not a whole-catalogue match like the
  // top-level Scan receipt flow), so the user can see at a glance whether
  // the delivery matches the order that was sent, then amend by hand as
  // usual. Per-line status drives the badges in the Receiving table below;
  // "extra" lists anything the photo detected that isn't on this order at
  // all (never silently dropped).
  const [scanningDelivery, setScanningDelivery] = useState(false);
  const [scanDeliveryError, setScanDeliveryError] = useState<string | null>(null);
  const [deliveryScan, setDeliveryScan] = useState<{
    lineStatus: Record<string, "match" | "diff" | "missing">;
    extra: string[];
  } | null>(null);

  // Attachments -- the PO's own photo/document trail (receipt/invoice
  // images, or anything attached by hand). The list itself lives on `po.
  // attachments` (nested by the backend), so no separate fetch/state for
  // the list -- these three just track in-flight per-action UI state.
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [openingAttachmentId, setOpeningAttachmentId] = useState<string | null>(null);
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<string | null>(null);

  const [showSend, setShowSend] = useState(false);
  const [sending, setSending] = useState(false);

  const [showIssue, setShowIssue] = useState(false);
  const [returningToDraft, setReturningToDraft] = useState(false);
  const [showResource, setShowResource] = useState(false);
  const [resourceLines, setResourceLines] = useState<Record<string, string>>({});
  const [resourcing, setResourcing] = useState(false);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [resourceResult, setResourceResult] = useState<{ id: string; supplierName: string }[] | null>(null);

  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [showReopenConfirm, setShowReopenConfirm] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reopenError, setReopenError] = useState<string | null>(null);

  function reload() {
    setError(null);
    fetchPurchaseOrder(accessToken, poId)
      .then(setPo)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load purchase order."));
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poId]);

  useEffect(() => {
    // Waits on `po` too (not just `items`) so the very first default-selected
    // item also gets its price looked up correctly -- otherwise this would
    // fire before `po.supplier` is known and silently skip the pre-fill.
    if (items.length && po && !addItemId) handleAddItemSelect(items[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, po]);

  async function saveField(patch: Parameters<typeof updatePurchaseOrder>[2]) {
    try {
      const updated = await updatePurchaseOrder(accessToken, poId, patch);
      setPo(updated);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save changes.");
    }
  }

  async function handleDeleteDraft() {
    setDeleteError(null);
    setDeleting(true);
    try {
      await deletePurchaseOrder(accessToken, poId);
      onChanged();
      onBack();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Could not delete this purchase order.");
      setDeleting(false);
    }
  }

  async function handleReopen() {
    setReopenError(null);
    setReopening(true);
    try {
      const updated = await reopenPurchaseOrder(accessToken, poId);
      setPo(updated);
      setShowReopenConfirm(false);
      onChanged();
    } catch (err) {
      setReopenError(err instanceof Error ? err.message : "Could not reopen this purchase order.");
    } finally {
      setReopening(false);
    }
  }

  async function handleAdvance() {
    if (!po) return;
    const idx = STATUS_FLOW.indexOf(po.status);
    const next = STATUS_FLOW[idx + 1];
    if (!next) return;
    if (next === "sent") {
      setShowSend(true);
      return;
    }
    if (next === "received") {
      const initial: Record<string, { qty: string; price: string }> = {};
      po.lines.forEach((l) => {
        initial[l.id] = { qty: l.qty, price: l.unit_price };
      });
      setReceiveLines(initial);
      setReceiveError(null);
      setInvoiceNumberInput(po.invoice_number ?? "");
      setDeliveryScan(null);
      setScanDeliveryError(null);
      setShowReceive(true);
      return;
    }
    setAdvancing(true);
    try {
      await saveField({ status: next });
    } finally {
      setAdvancing(false);
    }
  }

  async function handleSendChoice(method: "email" | "print") {
    if (!po) return;
    const supplier = suppliers.find((s) => s.id === po.supplier);
    if (method === "email" && supplier?.contact_email) {
      // Lead with our own PO number in both the subject and the body -- so
      // it's visible in the recipient's inbox list before they even open
      // the email, and so it's the first thing on the page if they forward
      // or print it. Also what a supplier can print back onto their own
      // invoice for the scan-to-PO matching in Procurement's receipt scan.
      const subject = encodeURIComponent(
        po.po_number ? `Purchase order ${po.po_number} — ${po.location_name}` : `Purchase order — ${po.location_name}`
      );
      const poNumberLine = po.po_number ? `PO number: ${po.po_number}%0D%0A%0D%0A` : "";
      const bodyLines = po.lines
        .map((l) => `${Number(l.qty).toFixed(2)} × ${l.item_name} @ ${formatMoney(Number(l.unit_price), currency)}`)
        .join("%0D%0A");
      window.open(
        `mailto:${supplier.contact_email}?subject=${subject}&body=${poNumberLine}${bodyLines}%0D%0A%0D%0ATotal: ${formatMoney(Number(po.total), currency)}`,
        "_blank"
      );
    }
    if (method === "print") {
      window.print();
    }
    setSending(true);
    try {
      await saveField({ status: "sent" });
      setShowSend(false);
    } finally {
      setSending(false);
    }
  }

  async function handleReturnToDraft() {
    setReturningToDraft(true);
    try {
      await saveField({ status: "draft" });
      setShowIssue(false);
    } finally {
      setReturningToDraft(false);
    }
  }

  function openResource() {
    if (!po) return;
    const initial: Record<string, string> = {};
    po.lines.forEach((l) => {
      initial[l.id] = po.supplier;
    });
    setResourceLines(initial);
    setResourceError(null);
    setResourceResult(null);
    setShowResource(true);
    setShowIssue(false);
  }

  async function handleConfirmResource() {
    if (!po) return;
    setResourcing(true);
    setResourceError(null);
    try {
      const bySupplier = new Map<string, typeof po.lines>();
      po.lines.forEach((l) => {
        const supplierId = resourceLines[l.id] ?? po.supplier;
        bySupplier.set(supplierId, [...(bySupplier.get(supplierId) ?? []), l]);
      });

      const created: { id: string; supplierName: string }[] = [];
      for (const [supplierId, lines] of bySupplier) {
        const newPO = await createPurchaseOrder(accessToken, {
          supplier: supplierId,
          location: po.location,
        });
        for (const l of lines) {
          await createPOLine(accessToken, {
            po: newPO.id,
            item: l.item,
            department: l.department,
            qty: l.qty,
            unit_price: l.unit_price,
          });
        }
        created.push({ id: newPO.id, supplierName: suppliers.find((s) => s.id === supplierId)?.name ?? "—" });
      }

      await saveField({ status: "amended" });
      setResourceResult(created);
      onChanged();
    } catch (err) {
      setResourceError(err instanceof Error ? err.message : "Could not re-source these items.");
    } finally {
      setResourcing(false);
    }
  }

  async function handleScanDeliveryFileSelected(file: File) {
    if (!po) return;
    setScanningDelivery(true);
    setScanDeliveryError(null);
    try {
      const result = await scanReceipt(accessToken, file);
      const claimed = new Set<number>();
      const lineStatus: Record<string, "match" | "diff" | "missing"> = {};
      const nextReceiveLines = { ...receiveLines };

      po.lines.forEach((l) => {
        let bestIdx = -1;
        let bestScore = 0;
        result.line_items.forEach((li, idx) => {
          if (claimed.has(idx)) return;
          const score = matchScore(l.item_name, li.description);
          if (score > bestScore) {
            bestScore = score;
            bestIdx = idx;
          }
        });
        // Same 0.34-ish floor as elsewhere isn't quite right here -- this
        // is a closed set (this PO's own lines), not the whole catalogue,
        // so a slightly looser threshold still means something; anything
        // weaker than this is more likely noise than a real match.
        if (bestIdx === -1 || bestScore < 0.34) {
          lineStatus[l.id] = "missing";
          return;
        }
        claimed.add(bestIdx);
        const li = result.line_items[bestIdx];
        const rawQty = Number(cleanNumeric(li.quantity)) || 0;
        const rawPrice = Number(cleanNumeric(li.unit_price)) || 0;

        // "If unit is already present then software should match and auto
        // fill for the user" -- same remembered-pack-conversion lookup the
        // top-level Scan receipt flow uses, so a scanned "2 Pkg" cross-
        // checks against the real base-unit qty on this order, not a raw
        // "2" that silently misreads as 2 of the item itself.
        let qty = rawQty;
        let price = rawPrice;
        const known = findKnownSupplierUnit(l.item, po.supplier);
        if (known?.supplierUnit) {
          const item = items.find((it) => it.id === l.item);
          const auto = item ? autoFactor(known.supplierUnit, item.base_unit) : null;
          const factor = auto ?? Number(known.packQty || "1");
          if (Number.isFinite(factor) && factor > 0) {
            qty = rawQty * factor;
            price = convertToBaseUnit(rawPrice, factor) ?? rawPrice;
          }
        }

        nextReceiveLines[l.id] = { qty: formatQty(qty), price: price.toFixed(2) };
        const qtyDiffers = Math.abs(qty - Number(l.qty)) > 0.01;
        const priceDiffers = Math.abs(price - Number(l.unit_price)) > 0.01;
        lineStatus[l.id] = qtyDiffers || priceDiffers ? "diff" : "match";
      });

      const extra = result.line_items
        .filter((_, idx) => !claimed.has(idx))
        .map((li) => li.description);

      setReceiveLines(nextReceiveLines);
      setDeliveryScan({ lineStatus, extra });

      uploadPOAttachment(accessToken, po.id, file, "scan_delivery")
        .then((attachment) => setPo((prev) => (prev ? { ...prev, attachments: [attachment, ...prev.attachments] } : prev)))
        .catch(() => {
          // Attachment storage is a bonus, not a blocker -- the scan
          // review above already worked and is what the user is waiting
          // on. A quiet skip here (e.g. attachments not configured on the
          // server yet) shouldn't interrupt that.
        });
    } catch (err) {
      setScanDeliveryError(err instanceof Error ? err.message : "Could not scan that photo.");
    } finally {
      setScanningDelivery(false);
    }
  }

  async function handleManualAttachmentFile(file: File) {
    if (!po) return;
    setUploadingAttachment(true);
    setAttachmentError(null);
    try {
      const attachment = await uploadPOAttachment(accessToken, po.id, file, "manual");
      setPo((prev) => (prev ? { ...prev, attachments: [attachment, ...prev.attachments] } : prev));
    } catch (err) {
      setAttachmentError(err instanceof Error ? err.message : "Could not attach that file.");
    } finally {
      setUploadingAttachment(false);
    }
  }

  async function handleOpenAttachment(attachmentId: string) {
    setOpeningAttachmentId(attachmentId);
    setAttachmentError(null);
    try {
      const url = await fetchPOAttachmentDownloadUrl(accessToken, attachmentId);
      // Opened in a new tab rather than navigated to directly -- this is a
      // short-lived presigned S3 URL (see the backend's download action),
      // so there's nothing to bookmark or share; a tab is just a viewer.
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setAttachmentError(err instanceof Error ? err.message : "Could not open that file.");
    } finally {
      setOpeningAttachmentId(null);
    }
  }

  async function handleDeleteAttachment(attachmentId: string) {
    if (!po) return;
    setDeletingAttachmentId(attachmentId);
    setAttachmentError(null);
    try {
      await deletePOAttachment(accessToken, attachmentId);
      setPo((prev) =>
        prev ? { ...prev, attachments: prev.attachments.filter((a) => a.id !== attachmentId) } : prev
      );
    } catch (err) {
      setAttachmentError(err instanceof Error ? err.message : "Could not remove that attachment.");
    } finally {
      setDeletingAttachmentId(null);
    }
  }

  async function handleConfirmReceive() {
    if (!po) return;
    setReceiving(true);
    setReceiveError(null);
    try {
      const overrides = po.lines.map((l) => ({
        id: l.id,
        received_qty: receiveLines[l.id]?.qty ?? l.qty,
        received_unit_price: receiveLines[l.id]?.price ?? l.unit_price,
      }));
      const updated = await receivePurchaseOrder(accessToken, po.id, overrides, invoiceNumberInput.trim() || null);
      setPo(updated);
      setShowReceive(false);
      onChanged();
    } catch (err) {
      setReceiveError(err instanceof Error ? err.message : "Could not receive this delivery.");
    } finally {
      setReceiving(false);
    }
  }

  async function handleSuggestItems() {
    if (!po) return;
    const supplier = suppliers.find((s) => s.id === po.supplier);
    if (!supplier?.min_order_value) return;
    const target = Number(supplier.min_order_value);

    setSuggesting(true);
    setSuggestError(null);
    setSuggestNote(null);
    try {
      // Map item -> its existing line on this PO (if any), so we can top up
      // a real shortfall instead of only ever adding brand-new items.
      const existingLineByItem = new Map(po.lines.map((l) => [l.item, l] as const));

      const candidates = itemSupplierLinks.filter(
        (link) => link.supplier === po.supplier
      );

      // Rank by how far below par each item currently sits — the genuinely
      // "most needed" items from this supplier, not a guess or a fixed list.
      // For an item already on this PO, only the REMAINING shortfall (par
      // gap minus what's already been ordered here) counts as real need —
      // we're topping up a genuine gap, not padding an adequate line.
      const scored = await Promise.all(
        candidates.map(async (link) => {
          const item = items.find((it) => it.id === link.item);
          let shortfall = 0;
          let department: "kitchen" | "bar" | "foh" = "kitchen";
          if (item) {
            for (const h of item.holdings) {
              const onHand = await fetchOnHand(accessToken, item.id, h.location, h.department);
              const gap = Number(h.par_level) - onHand;
              if (gap > shortfall) {
                shortfall = gap;
                department = h.department as "kitchen" | "bar" | "foh";
              } else if (shortfall === 0 && gap > 0) {
                shortfall = gap;
                department = h.department as "kitchen" | "bar" | "foh";
              }
            }
          }
          const existingLine = existingLineByItem.get(link.item);
          const alreadyOrdered = existingLine ? Number(existingLine.qty) : 0;
          const remainingShortfall = shortfall - alreadyOrdered;
          return { link, item, existingLine, remainingShortfall, department };
        })
      );

      // Real candidates are: brand-new items (any of them can help, even
      // with no tracked shortfall — same as before), or items already on
      // the PO that still have genuine remaining need after what's already
      // ordered. An existing line whose qty already covers its par shortfall
      // has nothing left to contribute.
      const needed = scored.filter((s) => !s.existingLine || s.remainingShortfall > 0);
      needed.sort((a, b) => b.remainingShortfall - a.remainingShortfall);

      let running = Number(po.total);
      let added = 0;
      for (const { link, item, existingLine, remainingShortfall, department } of needed) {
        if (running >= target) break;
        if (!item) continue;

        const price = Number(link.unit_price);
        if (price <= 0) continue;
        const remainingGap = target - running;
   const shortfallQty = remainingShortfall > 0 ? remainingShortfall : 1;

        // If this item's genuine remaining shortfall would already clear the
        // minimum, only order enough to just cross it — landing as close to
        // the target as possible rather than however much stock happens to be
        // missing. Earlier items in the list still get their full
        // "most needed" amount either way, rounded up to a whole unit since
        // items are ordered in whole quantities, not fractional decimals.
        const extraQty = Math.ceil(
          shortfallQty * price >= remainingGap
            ? remainingGap / price
            : shortfallQty
        );

        if (existingLine) {
          const newQty = Number(existingLine.qty) + extraQty;
          await updatePOLine(accessToken, existingLine.id, { qty: newQty.toFixed(3) });
        } else {
          await createPOLine(accessToken, {
            po: po.id,
            item: item.id,
            department,
            qty: extraQty.toFixed(3),
            unit_price: link.unit_price,
          });
        }
        running += extraQty * price;
        added++;
      }

      if (added === 0) {
        setSuggestNote(
          needed.length === 0
            ? `No other items on record from ${po.supplier_name} to suggest — add some manually below.`
            : null
        );
      } else {
        setSuggestNote(
          `${added} item${added === 1 ? "" : "s"} added — the most needed from ${po.supplier_name}, based on how far below par they're currently sitting.`
        );
      }
      reload();
      onChanged();
    } catch (err) {
      setSuggestError(err instanceof Error ? err.message : "Could not suggest items.");
    } finally {
      setSuggesting(false);
    }
  }

  // "If unit is already present then software should match and auto fill for
  // the user" -- when this exact (item, supplier) pair was already linked
  // with a recorded supplier_unit (via ItemDetail's Link flow, a PO receive,
  // or a catalogue import), back out the pack factor from the two prices
  // already on file rather than asking the user to re-teach it. A direct
  // copy of findKnownSupplierUnit in App.tsx -- this file already has its
  // own copies of small cross-screen helpers, per this codebase's established
  // convention (see e.g. Inventory.tsx's local matchScore/cleanNumeric).
  function findKnownSupplierUnit(itemId: string, supplierId: string): { supplierUnit: string; packQty: string } | null {
    const link = itemSupplierLinks.find((l) => l.item === itemId && l.supplier === supplierId);
    if (!link || !link.supplier_unit || link.supplier_unit_price == null) return null;
    const unitPriceNum = Number(link.unit_price);
    const supplierUnitPriceNum = Number(link.supplier_unit_price);
    if (!Number.isFinite(unitPriceNum) || unitPriceNum <= 0) return null;
    if (!Number.isFinite(supplierUnitPriceNum)) return null;
    const factor = supplierUnitPriceNum / unitPriceNum;
    if (!Number.isFinite(factor) || factor <= 0) return null;
    // Same float-division rounding as App.tsx's own copy -- capped to 2dp,
    // a pack size a human reads and edits, not a raw stored cost figure.
    return { supplierUnit: link.supplier_unit, packQty: String(parseFloat(factor.toFixed(2))) };
  }

  function handleAddItemSelect(itemId: string) {
    setAddItemId(itemId);
    const selectedItem = items.find((it) => it.id === itemId);
    const link = po && itemSupplierLinks.find((l) => l.item === itemId && l.supplier === po.supplier);
    // A VAT rate remembered specifically for this (item, supplier) pair
    // (see apps/catalog/models.py ItemSupplier.vat_rate, taught by
    // PurchaseOrderViewSet.receive) takes priority over the item's own
    // org-wide default -- same reasoning as the pack/unit memory just
    // below: this supplier's invoiced VAT for this item can legitimately
    // differ from what the org normally expects.
    const knownVatPct = link?.vat_rate ? String(Math.round(Number(link.vat_rate) * 10000) / 100) : "";
    setAddVatPct(
      knownVatPct ||
        (selectedItem?.effective_vat_rate
          ? String(Math.round(Number(selectedItem.effective_vat_rate) * 10000) / 100)
          : "")
    );
    const known = po ? findKnownSupplierUnit(itemId, po.supplier) : null;
    if (known) {
      // A pack/unit conversion is already on file for this exact
      // (item, supplier) pair -- show it expanded with the supplier's own
      // raw price (addPrice means "price per supplierUnit" while expanded),
      // not the converted base-unit figure, so the user sees the same terms
      // their invoice actually uses.
      setAddSupplierUnit(known.supplierUnit);
      setAddPackQty(known.packQty);
      setAddPackExpanded(true);
      setAddPrice(link?.supplier_unit_price ?? "0.00");
    } else {
      // No known pack/unit -- fall back to the plain base-unit price from
      // the link if one exists (ItemSupplier.unit_price is always a true
      // price per the item's own base_unit, safe to use as-is). "0.00" when
      // switching to an item with no link at all, so the field never
      // silently carries over a previous item's price.
      setAddSupplierUnit("");
      setAddPackQty("1");
      setAddPackExpanded(false);
      setAddPrice(link ? link.unit_price : "0.00");
    }
  }

  // Resolves the Add-line form's current qty/price into the selected item's
  // own base_unit, applying whatever pack/unit conversion is active. Mirrors
  // scanRowBaseUnits in App.tsx. Returns null when a conversion is set up
  // but not (yet) usable, so the caller can block submission rather than
  // storing a corrupted cost.
  function resolveAddLineBaseUnits(item: CatalogItem | undefined): { qty: number; unitPrice: number } | null {
    const rawQty = Number(addQty || "0");
    const rawPrice = Number(addPrice || "0");
    if (!Number.isFinite(rawQty) || !Number.isFinite(rawPrice)) return null;
    if (!item || !addSupplierUnit || addSupplierUnit === item.base_unit) {
      return { qty: rawQty, unitPrice: rawPrice };
    }
    const auto = autoFactor(addSupplierUnit, item.base_unit);
    const factor = auto ?? Number(addPackQty || "1");
    if (!Number.isFinite(factor) || factor <= 0) return null;
    return { qty: rawQty * factor, unitPrice: convertToBaseUnit(rawPrice, factor) ?? 0 };
  }

  async function handleAddLine(e: React.FormEvent) {
    e.preventDefault();
    if (!po || !addItemId) return;
    const item = items.find((it) => it.id === addItemId);
    const resolved = resolveAddLineBaseUnits(item);
    if (!resolved) {
      setLineError("Enter a valid pack/unit conversion before adding this line.");
      return;
    }
    const converting = !!addSupplierUnit && !!item && addSupplierUnit !== item.base_unit;
    setLineError(null);
    setSavingLine(true);
    try {
      await createPOLine(accessToken, {
        po: po.id,
        item: addItemId,
        department: addDept,
        qty: resolved.qty.toFixed(3),
        unit_price: resolved.unitPrice.toFixed(4),
        vat_rate: addVatPct.trim() === "" ? undefined : (Number(addVatPct) / 100).toFixed(4),
        // Freeze the as-invoiced unit/qty onto the line itself when a
        // conversion is in play, same as a receive-via-Scan-receipt line
        // already does -- lets a manually-created line show its own
        // invoice's terms later too, not just converted ones.
        ...(converting ? { supplier_unit: addSupplierUnit, supplier_qty: addQty } : {}),
      });
      setAddSupplierUnit("");
      setAddPackQty("1");
      setAddPackExpanded(false);
      reload();
      onChanged();
    } catch (err) {
      setLineError(err instanceof Error ? err.message : "Could not add line.");
    } finally {
      setSavingLine(false);
    }
  }

  async function handleRemoveLine(lineId: string) {
    try {
      await deletePOLine(accessToken, lineId);
      reload();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove line.");
    }
  }

  const [savingLineId, setSavingLineId] = useState<string | null>(null);

  async function handleUpdateLineQty(lineId: string, currentQty: string, rawValue: string) {
    const next = Number(rawValue);
    if (!Number.isFinite(next) || next <= 0) {
      setError("Quantity must be a positive number.");
      return;
    }
    if (next === Number(currentQty)) return;
    setSavingLineId(lineId);
    try {
      await updatePOLine(accessToken, lineId, { qty: next.toFixed(3) });
      reload();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update quantity.");
    } finally {
      setSavingLineId(null);
    }
  }

  // Blank means "use the matched item's own effective_vat_rate" (see
  // POLine.vat_rate) -- sent as vat_rate: null rather than skipped
  // entirely, since clearing the field back to blank after it had an
  // override must actually clear the override, not leave the old one on
  // file untouched.
  async function handleUpdateLineVat(lineId: string, rawPct: string) {
    const trimmed = rawPct.trim();
    const fraction = trimmed === "" ? null : (Number(trimmed) / 100).toFixed(4);
    if (trimmed !== "" && !Number.isFinite(Number(trimmed))) {
      setError("VAT % must be a number.");
      return;
    }
    setSavingLineId(lineId);
    try {
      await updatePOLine(accessToken, lineId, { vat_rate: fraction });
      reload();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update VAT rate.");
    } finally {
      setSavingLineId(null);
    }
  }

  if (!po) {
    return (
      <div>
        <button className="back-link" onClick={onBack}>
          {label}
        </button>
        {error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}
      </div>
    );
  }

  const editable = po.status === "draft";
  const nextStatus = STATUS_FLOW[STATUS_FLOW.indexOf(po.status) + 1];
  const supplier = suppliers.find((s) => s.id === po.supplier);
  const belowMin =
    po.status === "draft" && supplier?.min_order_value && Number(po.total) < Number(supplier.min_order_value);

  return (
    <div>
      <button className="back-link" onClick={onBack}>
        {label}
      </button>

      <div className="detail-head">
        <h1 className="page-title" style={{ margin: 0 }}>
          {po.supplier_name}
        </h1>
        <span className={`postatus ps-${po.status}`}>{STATUS_LABEL[po.status]}</span>
      </div>
      <p className="muted detail-sub">
        {po.po_number && <b>{po.po_number}</b>}
        {po.po_number && " · "}
        {po.location_name} · created for delivery to this location
        {po.invoice_number && ` · Supplier's invoice: ${po.invoice_number}`}
      </p>

      {error && <p className="error">{error}</p>}
      {readOnly && (
        <p className="ro-banner">
          {po.status === "sent"
            ? "Placing and editing orders is for managers — you can receive this delivery below."
            : "View only — placing and editing orders is for managers."}
        </p>
      )}

      {belowMin && !readOnly && supplier?.min_order_value && (
        <div className="minwarn">
          <div>
            <b>
              Below {po.supplier_name}'s {formatMoney(Number(supplier.min_order_value), currency, 0)} minimum order.
            </b>{" "}
            This PO is {formatMoney(Number(po.total), currency)} — short by{" "}
            {formatMoney(Number(supplier.min_order_value) - Number(po.total), currency)}. {po.supplier_name} won't
            accept it as is.
          </div>
          <button className="minwarn-btn" onClick={handleSuggestItems} disabled={suggesting}>
            {suggesting ? "Finding items…" : "Suggest items"}
          </button>
        </div>
      )}
      {suggestNote && <div className="im-note">✓ {suggestNote}</div>}
      {suggestError && <p className="error">{suggestError}</p>}

      <div className="print-only">
        <h1>Purchase Order {po.po_number}</h1>
        <p>
          <b>Supplier:</b> {po.supplier_name}
        </p>
        <p>
          <b>Deliver to:</b> {po.location_name}
        </p>
        <p>
          <b>Expected:</b> {po.expected_date ?? "—"}
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Unit price</th>
                <th>Line total (ex VAT)</th>
              </tr>
            </thead>
            <tbody>
              {po.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.item_name}</td>
                  <td>{Number(l.qty).toFixed(2)}</td>
                  <td>{formatMoney(Number(l.unit_price), currency)}</td>
                  <td>{formatMoney(Number(l.line_total), currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          <b>Total (ex VAT): {formatMoney(Number(po.total), currency)}</b>
          <br />
          <b>Total (incl. VAT): {formatMoney(Number(po.total_with_vat), currency)}</b>
        </p>
      </div>

      <div className="card">
        <div className="postep">
          {STATUS_FLOW.map((s, i) => (
            <div key={s} className={`postep-node ${STATUS_FLOW.indexOf(po.status) >= i ? "done" : ""}`}>
              <span className="postep-dot" />
              {STATUS_LABEL[s]}
            </div>
          ))}
        </div>
        {nextStatus && (!readOnly || nextStatus === "received") && (
          <button className="btn-primary small" onClick={handleAdvance} disabled={advancing}>
            {advancing ? "Saving…" : `Mark as ${STATUS_LABEL[nextStatus]}`}
          </button>
        )}
        {po.status === "sent" && !readOnly && (
          <button
            className="btn-ghost"
            style={{ marginTop: nextStatus ? 8 : 0 }}
            onClick={() => setShowIssue(true)}
          >
            Report supplier issue
          </button>
        )}
        {po.status === "draft" && isAdmin && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px dashed var(--border)" }}>
            {!showDeleteConfirm ? (
              <button className="btn-danger" onClick={() => setShowDeleteConfirm(true)}>
                Delete draft
              </button>
            ) : (
              <div className="dz-confirm">
                <p className="hint" style={{ margin: "0 0 8px" }}>
                  This deletes the draft permanently — there's nothing to send or receive yet, so
                  nothing else is affected.
                </p>
                <div className="dz-confirm-row">
                  <button className="btn-danger" onClick={handleDeleteDraft} disabled={deleting}>
                    {deleting ? "Deleting…" : "Confirm & delete"}
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      setShowDeleteConfirm(false);
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
        )}
        {po.status === "received" && isAdmin && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px dashed var(--border)" }}>
            {!showReopenConfirm ? (
              <button className="btn-ghost" onClick={() => setShowReopenConfirm(true)}>
                Reopen to draft
              </button>
            ) : (
              <div className="dz-confirm">
                <p className="hint" style={{ margin: "0 0 8px" }}>
                  Reverses the stock this order's receipt posted (with an offsetting entry, not a
                  delete — the record stays in the ledger) and puts it back in Draft so the lines can
                  be corrected and received again.
                </p>
                <div className="dz-confirm-row">
                  <button className="btn-danger" onClick={handleReopen} disabled={reopening}>
                    {reopening ? "Reopening…" : "Confirm & reopen"}
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      setShowReopenConfirm(false);
                      setReopenError(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
                {reopenError && <p className="error">{reopenError}</p>}
              </div>
            )}
          </div>
        )}
        {po.status === "received" && po.received_date && (
          <p className="hint" style={{ marginTop: 10 }}>
            Received {po.received_date}.{" "}
            {po.invoice_number ? (
              <>Supplier's invoice: {po.invoice_number}.</>
            ) : (
              <button
                type="button"
                className="mini"
                onClick={() => {
                  const value = window.prompt("Supplier's invoice number");
                  if (value && value.trim()) saveField({ invoice_number: value.trim() });
                }}
              >
                + Add invoice number
              </button>
            )}
          </p>
        )}
        {po.status === "amended" && (
          <p className="hint" style={{ marginTop: 10 }}>
            This order was re-sourced — its items now live on new draft purchase orders.
          </p>
        )}
        <fieldset className="ro-fieldset" disabled={readOnly}>
        <div className="fgrid" style={{ marginTop: 16 }}>
          <div className="field">
            <label>PO number</label>
            {editable ? (
              <input
                value={po.po_number ?? ""}
                onChange={(e) => setPo({ ...po, po_number: e.target.value })}
                onBlur={(e) => saveField({ po_number: e.target.value })}
                placeholder="e.g. PO-0007"
              />
            ) : (
              <div className="ro">{po.po_number || "—"}</div>
            )}
          </div>
          <div className="field">
            <label>Expected date</label>
            <input
              type="date"
              value={po.expected_date ?? ""}
              onChange={(e) => setPo({ ...po, expected_date: e.target.value })}
              onBlur={(e) => saveField({ expected_date: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label>Total (ex VAT)</label>
            <div className="ro">{formatMoney(Number(po.total), currency)}</div>
          </div>
          <div className="field">
            <label>Total (incl. VAT)</label>
            <div className="ro">{formatMoney(Number(po.total_with_vat), currency)}</div>
          </div>
        </div>
        </fieldset>
      </div>

      <div className="card">
        <h2>Attachments</h2>
        <p className="hint" style={{ marginTop: -4, marginBottom: 12 }}>
          Receipt/invoice photos from scanning this order, plus anything attached by hand -- kept
          here for the full record (e.g. handing a PO and its invoice to an accountant).
        </p>
        {po.attachments.length === 0 ? (
          <p className="muted">No attachments yet.</p>
        ) : (
          <div className="task-list" style={{ marginBottom: 12 }}>
            {po.attachments.map((a) => (
              <div key={a.id} className="task-item">
                <div>
                  <b>{a.original_filename || "Attachment"}</b>
                  <span className="muted">
                    {" "}
                    · {ATTACHMENT_SOURCE_LABEL[a.source]} · {formatBytes(a.size_bytes)} · {a.uploaded_by_name}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="btn-ghost small"
                    onClick={() => handleOpenAttachment(a.id)}
                    disabled={openingAttachmentId === a.id}
                  >
                    {openingAttachmentId === a.id ? "Opening…" : "Open"}
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      className="btn-ghost small"
                      onClick={() => handleDeleteAttachment(a.id)}
                      disabled={deletingAttachmentId === a.id}
                    >
                      {deletingAttachmentId === a.id ? "Removing…" : "Remove"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <label className="btn-ghost small" style={{ cursor: uploadingAttachment ? "default" : "pointer", opacity: uploadingAttachment ? 0.6 : 1 }}>
          {uploadingAttachment ? "Attaching…" : "+ Attach a file"}
          <input
            type="file"
            disabled={uploadingAttachment}
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) handleManualAttachmentFile(file);
            }}
          />
        </label>
        {attachmentError && <p className="error">{attachmentError}</p>}
      </div>

      <fieldset className="ro-fieldset" disabled={readOnly}>
      <div className="card">
        <h2>Order lines</h2>
        <div className="table-scroll">
          <table className="htbl">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Qty</th>
                <th className="num">Unit price</th>
                <th className="num">VAT %</th>
                <th className="num">Line total (ex VAT)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {po.lines.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted empty-row">
                    No lines yet — add items below.
                  </td>
                </tr>
              )}
              {po.lines.map((l) => {
                const lineItem = items.find((it) => it.id === l.item);
                const baseUnit = lineItem?.base_unit ?? "";
                return (
                <tr key={l.id}>
                  <td className="dispname">{l.item_name}</td>
                  <td className="num">
                    {editable ? (
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        key={`${l.id}-${l.qty}`}
                        defaultValue={Number(l.qty).toFixed(2)}
                        disabled={savingLineId === l.id}
                        style={{ width: 80, textAlign: "right" }}
                        onBlur={(e) => handleUpdateLineQty(l.id, l.qty, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                      />
                    ) : l.supplier_unit && l.supplier_qty != null ? (
                      // As-invoiced qty/unit, e.g. "1 L" -- matches what's
                      // printed on the supplier's own paper invoice, with the
                      // converted, actually-costed figure shown underneath
                      // for anyone who needs it (never the other way round;
                      // see supplier_unit/supplier_qty's model comment).
                      <>
                        {formatQty(Number(l.supplier_qty))} {l.supplier_unit}
                        <div className="sd">
                          = {formatQty(Number(l.qty))} {baseUnit}
                        </div>
                      </>
                    ) : (
                      `${Number(l.qty).toFixed(2)}${baseUnit ? ` ${baseUnit}` : ""}`
                    )}
                  </td>
                  <td className="num">{formatMoney(Number(l.unit_price), currency)}</td>
                  <td className="num">
                    {editable ? (
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        key={`${l.id}-${l.vat_rate ?? "inherit"}`}
                        defaultValue={l.effective_vat_rate ? (Number(l.effective_vat_rate) * 100).toFixed(2) : ""}
                        placeholder={lineItem?.effective_vat_rate ? undefined : "—"}
                        disabled={savingLineId === l.id}
                        style={{ width: 64, textAlign: "right" }}
                        onBlur={(e) => handleUpdateLineVat(l.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                      />
                    ) : l.effective_vat_rate ? (
                      `${(Number(l.effective_vat_rate) * 100).toFixed(2)}%`
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="num">{formatMoney(Number(l.line_total), currency)}</td>
                  <td>
                    {editable && (
                      <button className="rm" onClick={() => handleRemoveLine(l.id)}>
                        ×
                      </button>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {editable ? (
          <form className="addholding" onSubmit={handleAddLine}>
            <div className="fgrid fgrid-2">
              <div className="field">
                <label>Item</label>
                <SearchSelect
                  value={addItemId}
                  onChange={handleAddItemSelect}
                  aria-label="Item"
                  options={items.map((it) => ({ value: it.id, label: `${it.name} (${it.base_unit})` }))}
                />
              </div>
              <div className="field">
                <label>Department</label>
                <select value={addDept} onChange={(e) => setAddDept(e.target.value as typeof addDept)}>
                  {DEPARTMENTS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>
                  {addSupplierUnit && addSupplierUnit !== items.find((it) => it.id === addItemId)?.base_unit
                    ? `Qty received (in ${addSupplierUnit})`
                    : "Qty"}
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={addQty}
                  onChange={(e) => setAddQty(e.target.value)}
                />
              </div>
              <div className="field">
                <label>
                  {addSupplierUnit && addSupplierUnit !== items.find((it) => it.id === addItemId)?.base_unit
                    ? `Price per ${addSupplierUnit}`
                    : "Unit price"}
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={addPrice}
                  onChange={(e) => setAddPrice(e.target.value)}
                />
              </div>
              <div className="field">
                <label>VAT %</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  placeholder="—"
                  value={addVatPct}
                  onChange={(e) => setAddVatPct(e.target.value)}
                />
              </div>
            </div>
            {addItemId &&
              (() => {
                const addItem = items.find((it) => it.id === addItemId);
                if (!addItem) return null;
                return (
                  <div style={{ marginTop: 4 }}>
                    {!addPackExpanded ? (
                      <button type="button" className="btn-ghost small" onClick={() => setAddPackExpanded(true)}>
                        Different pack or unit?
                      </button>
                    ) : (
                      <div style={{ marginTop: 4, fontSize: 13 }}>
                        Supplier's unit:{" "}
                        <input
                          value={addSupplierUnit}
                          placeholder={addItem.base_unit}
                          onChange={(e) => setAddSupplierUnit(e.target.value)}
                          style={{ width: 56 }}
                        />
                        {addSupplierUnit &&
                          addSupplierUnit !== addItem.base_unit &&
                          autoFactor(addSupplierUnit, addItem.base_unit) === null && (
                            <>
                              {" "}
                              = <input
                                type="number"
                                min="0"
                                step="any"
                                value={addPackQty}
                                onChange={(e) => setAddPackQty(e.target.value)}
                                style={{ width: 72 }}
                              />{" "}
                              {addItem.base_unit}
                            </>
                          )}
                        <button
                          type="button"
                          className="btn-ghost small"
                          onClick={() => {
                            setAddPackExpanded(false);
                            setAddSupplierUnit("");
                            setAddPackQty("1");
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}
            {addItemId &&
              (() => {
                const addItem = items.find((it) => it.id === addItemId);
                if (!addItem || !addSupplierUnit || addSupplierUnit === addItem.base_unit) return null;
                const resolved = resolveAddLineBaseUnits(addItem);
                return (
                  <div className={`scan-row-total ${resolved ? "ok" : "warn"}`}>
                    {resolved
                      ? `= ${resolved.qty.toFixed(2)} ${addItem.base_unit} total @ ${formatMoney(
                          resolved.unitPrice,
                          currency
                        )}/${addItem.base_unit}`
                      : "Enter a conversion above to see the real total"}
                  </div>
                );
              })()}
            {lineError && <p className="error">{lineError}</p>}
            <div className="modal-actions" style={{ marginTop: 12 }}>
              <button className="btn-primary" type="submit" disabled={savingLine || !items.length}>
                {savingLine ? "Adding…" : "+ Add line"}
              </button>
            </div>
          </form>
        ) : (
          <p className="hint" style={{ marginTop: 12 }}>
            Lines lock once a PO is sent, so the record matches what was actually ordered.
          </p>
        )}
      </div>
      </fieldset>

      {showReceive && (
        <div className="card">
          <h2>Receiving delivery</h2>
          <p className="hint">
            Confirm what actually arrived. Any changes here post as real stock movements and update
            this supplier's price for next time — the ordered amounts above stay on record either way.
          </p>
          <div className="field" style={{ marginBottom: 12, maxWidth: 260 }}>
            <label>Supplier's invoice number (optional)</label>
            <input
              value={invoiceNumberInput}
              onChange={(e) => setInvoiceNumberInput(e.target.value)}
              placeholder="e.g. INV-10432"
            />
          </div>

          <div className="field" style={{ marginBottom: 12 }}>
            <label>Scan delivery (optional)</label>
            <p className="hint" style={{ marginTop: 0, marginBottom: 8 }}>
              Take or choose a photo of what arrived and we'll check it against this order below —
              amend by hand afterwards as usual.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <label className="btn-ghost small" style={{ cursor: scanningDelivery ? "default" : "pointer", opacity: scanningDelivery ? 0.6 : 1 }}>
                📷 Take photo
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  disabled={scanningDelivery}
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) handleScanDeliveryFileSelected(file);
                  }}
                />
              </label>
              <label className="btn-ghost small" style={{ cursor: scanningDelivery ? "default" : "pointer", opacity: scanningDelivery ? 0.6 : 1 }}>
                🖼 Choose photo
                <input
                  type="file"
                  accept="image/*"
                  disabled={scanningDelivery}
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) handleScanDeliveryFileSelected(file);
                  }}
                />
              </label>
              {scanningDelivery && <Loader size="compact" label="Reading the photo…" />}
            </div>
            {scanDeliveryError && <p className="error">{scanDeliveryError}</p>}
            {deliveryScan && (() => {
              const matchCount = Object.values(deliveryScan.lineStatus).filter((s) => s === "match").length;
              const diffCount = Object.values(deliveryScan.lineStatus).filter((s) => s === "diff").length;
              const missingCount = Object.values(deliveryScan.lineStatus).filter((s) => s === "missing").length;
              return (
                <div className="im-note" style={{ marginTop: 10 }}>
                  {matchCount > 0 && `${matchCount} line${matchCount === 1 ? "" : "s"} matched the order. `}
                  {diffCount > 0 && `${diffCount} line${diffCount === 1 ? "" : "s"} differ from what was ordered — check below. `}
                  {missingCount > 0 && `${missingCount} line${missingCount === 1 ? "" : "s"} weren't found in the photo — left as ordered. `}
                  {deliveryScan.extra.length > 0 && (
                    <>
                      Also on the photo, not on this order: {deliveryScan.extra.join(", ")}.
                    </>
                  )}
                </div>
              );
            })()}
          </div>

          <div className="table-scroll">
            <table className="htbl">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Ordered</th>
                  <th className="num">Received qty</th>
                  <th className="num">Received price</th>
                </tr>
              </thead>
              <tbody>
                {po.lines.map((l) => {
                  const status = deliveryScan?.lineStatus[l.id];
                  return (
                    <tr key={l.id}>
                      <td className="dispname">
                        {l.item_name}
                        {status === "match" && <span className="badge b-ok" style={{ marginLeft: 6 }}>✓ matches</span>}
                        {status === "diff" && <span className="badge warn" style={{ marginLeft: 6 }}>⚠ differs</span>}
                        {status === "missing" && <span className="badge" style={{ marginLeft: 6 }}>not in photo</span>}
                      </td>
                      <td className="num muted">
                        {Number(l.qty).toFixed(2)} @ {formatMoney(Number(l.unit_price), currency)}
                      </td>
                      <td className="num">
                        <input
                          className="par-in"
                          type="number"
                          min="0"
                          step="any"
                          style={status === "diff" ? { background: "var(--caution-soft)" } : undefined}
                          value={receiveLines[l.id]?.qty ?? l.qty}
                          onChange={(e) =>
                            setReceiveLines((prev) => ({
                              ...prev,
                              [l.id]: { qty: e.target.value, price: prev[l.id]?.price ?? l.unit_price },
                            }))
                          }
                        />
                      </td>
                      <td className="num">
                        <input
                          className="par-in"
                          type="number"
                          min="0"
                          step="0.01"
                          style={status === "diff" ? { background: "var(--caution-soft)" } : undefined}
                          value={receiveLines[l.id]?.price ?? l.unit_price}
                          onChange={(e) =>
                            setReceiveLines((prev) => ({
                              ...prev,
                              [l.id]: { qty: prev[l.id]?.qty ?? l.qty, price: e.target.value },
                            }))
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {receiveError && <p className="error">{receiveError}</p>}
          <div className="modal-actions" style={{ marginTop: 14 }}>
            <button className="btn-ghost" onClick={() => setShowReceive(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={handleConfirmReceive} disabled={receiving}>
              {receiving ? "Posting to stock…" : "Confirm receipt"}
            </button>
          </div>
        </div>
      )}

      {showSend && (
        <div className="modal-backdrop" onClick={() => setShowSend(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Send this order</h2>
            <p className="hint" style={{ marginTop: -8, marginBottom: 16 }}>
              How does {po.supplier_name} usually take orders?
            </p>
            {belowMin && (
              <div className="minwarn" style={{ marginBottom: 14 }}>
                <div>Still below the minimum order — top it up before sending.</div>
              </div>
            )}
            <div className="seg">
              <button
                type="button"
                className="seg-btn"
                disabled={!suppliers.find((s) => s.id === po.supplier)?.contact_email || sending || !!belowMin}
                onClick={() => handleSendChoice("email")}
              >
                <b>Email PO</b>
                <small>
                  {suppliers.find((s) => s.id === po.supplier)?.contact_email
                    ? "opens your email, ready to send"
                    : "no email on file for this supplier"}
                </small>
              </button>
              <button
                type="button"
                className="seg-btn sub"
                disabled={sending || !!belowMin}
                onClick={() => handleSendChoice("print")}
              >
                <b>Print PO</b>
                <small>print or save as PDF to call it in</small>
              </button>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={() => setShowSend(false)} disabled={sending}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showIssue && (
        <div className="modal-backdrop" onClick={() => setShowIssue(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Supplier issue</h2>
            <p className="hint" style={{ marginTop: -8, marginBottom: 16 }}>
              What's happening with this order?
            </p>
            <div className="seg" style={{ marginBottom: 0 }}>
              <button
                type="button"
                className="seg-btn"
                disabled={returningToDraft}
                onClick={handleReturnToDraft}
              >
                <b>{returningToDraft ? "Saving…" : "Return to draft"}</b>
                <small>edit and resend to the same supplier</small>
              </button>
              <button type="button" className="seg-btn sub" onClick={openResource}>
                <b>Re-source items</b>
                <small>can't fulfil — assign items to different suppliers</small>
              </button>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={() => setShowIssue(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showResource && (
        <div className="modal-backdrop" onClick={() => !resourceResult && setShowResource(false)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <h2>Re-source items</h2>
            {!resourceResult ? (
              <>
                <p className="hint" style={{ marginTop: -8, marginBottom: 16 }}>
                  Assign each item to a supplier. Items assigned to more than one supplier become
                  separate new draft orders, created together.
                </p>
                <div className="table-scroll">
                  <table className="im-tbl">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Qty</th>
                        <th>New supplier</th>
                      </tr>
                    </thead>
                    <tbody>
                      {po.lines.map((l) => (
                        <tr key={l.id}>
                          <td>{l.item_name}</td>
                          <td>{Number(l.qty).toFixed(2)}</td>
                          <td>
                            <select
                              value={resourceLines[l.id] ?? po.supplier}
                              onChange={(e) =>
                                setResourceLines((prev) => ({ ...prev, [l.id]: e.target.value }))
                              }
                            >
                              {suppliers
                                .filter((s) => !s.archived || s.id === (resourceLines[l.id] ?? po.supplier))
                                .map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.name}
                                    {s.archived ? " (archived)" : ""}
                                  </option>
                                ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {resourceError && <p className="error">{resourceError}</p>}
                <div className="modal-actions">
                  <button type="button" className="btn-ghost" onClick={() => setShowResource(false)} disabled={resourcing}>
                    Cancel
                  </button>
                  <button className="btn-primary" onClick={handleConfirmResource} disabled={resourcing}>
                    {resourcing ? "Creating…" : "Create new draft orders"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="im-note">
                  ✓ <b>This order is now marked Amended.</b> {resourceResult.length} new draft order
                  {resourceResult.length === 1 ? "" : "s"} created:
                </div>
                {resourceResult.map((r) => (
                  <div key={r.id} className="sup-row">
                    <span className="sn">{r.supplierName}</span>
                    <button
                      className="mini"
                      onClick={() => {
                        setShowResource(false);
                        onOpenPO(r.id);
                      }}
                    >
                      Open →
                    </button>
                  </div>
                ))}
                <div className="modal-actions">
                  <button className="btn-primary" onClick={() => setShowResource(false)}>
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}