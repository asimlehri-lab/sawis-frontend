// Static content for the in-app help chatbot (Phase A of the help-chatbot
// phase plan -- see sawis-handoff-summary.md's dedicated section). This is
// deliberately NOT an AI call: the user types or picks a topic, sees a
// short list of prefilled questions, taps one, and gets a prewritten
// canned answer. No backend, no per-message cost, nothing that can say
// something wrong.
//
// Kept as a plain data file (not a backend model) on purpose for this first
// pass, matching this project's own "keep it simple and cheap first"
// pattern -- content updates ship through the same git/deploy pipeline as
// everything else. Worth revisiting as a backend-driven, admin-editable
// model once someone other than a developer needs to edit this without a
// deploy (see the phase plan's own Phase A.1 note).
//
// `keywords` gives topic search something to match beyond the topic's own
// title (e.g. "PO" and "purchase order" both finding Procurement).

export interface HelpQuestion {
  q: string;
  a: string;
}

export interface HelpTopic {
  id: string;
  title: string;
  keywords: string[];
  questions: HelpQuestion[];
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: "items-recipes",
    title: "Items & Recipes",
    keywords: [
      "item", "items", "recipe", "recipes", "ingredient", "par level",
      "category", "default supplier", "yield", "base unit",
    ],
    questions: [
      {
        q: "How do I add a new item?",
        a: "Go to Items and click + New item. Give it a name, a base unit (like kg or each), and a category. You can set a par level per location from the item's own page.",
      },
      {
        q: "What's a par level?",
        a: "The minimum stock you want on hand for an item at a location. When on-hand drops below it, the item shows up in Reorder and in the notification bell's \"Below par\" list.",
      },
      {
        q: "How do I set a default supplier for an item?",
        a: "Open the item and pick a supplier from the Default supplier field. Reorder uses this to suggest who to order from.",
      },
      {
        q: "Can I bulk-import items or recipes?",
        a: "Yes — Settings → Import Items or Import Recipes accepts a CSV or Excel file. Download the template first; it has the full column guide and a worked example built in.",
      },
      {
        q: "How is a recipe's cost worked out?",
        a: "From each ingredient's most recently recorded supplier price, times the recipe's own quantities. Linking a new price only affects costs going forward, never sales already recorded.",
      },
      {
        q: "What's the difference between an Item and a Recipe?",
        a: "An Item is something you buy and hold stock of (a raw ingredient). A Recipe is something you sell, built from a list of Item ingredients plus quantities — its cost is derived from those ingredients.",
      },
    ],
  },
  {
    id: "suppliers",
    title: "Suppliers",
    keywords: [
      "supplier", "suppliers", "archive", "contact", "delivery day",
      "min order", "minimum order",
    ],
    questions: [
      {
        q: "How do I see all my suppliers?",
        a: "Click 🏬 Suppliers in the sidebar for a searchable list of every supplier.",
      },
      {
        q: "How do I add a new supplier?",
        a: "From the Suppliers list, click + New supplier. Only the name is required — email, phone, delivery day, minimum order value and notes are all optional and can be filled in later.",
      },
      {
        q: "Can I delete a supplier?",
        a: "No — suppliers can only be archived, not deleted, so your order history always stays intact. Archiving hides a supplier from new-order pickers without touching anything already recorded against it.",
      },
      {
        q: "How do I archive a supplier I no longer use?",
        a: "Open the supplier's page and use Archive, under Contact & terms.",
      },
      {
        q: "What does a supplier's delivery day do?",
        a: "If you set one, it shows as a marker on the delivery calendar every week on that weekday, as a reminder — it doesn't create or link to any specific order.",
      },
      {
        q: "Where do I update a supplier's phone number or notes?",
        a: "Open the supplier from the Suppliers list and edit the Contact & terms card directly — changes save as you go.",
      },
    ],
  },
  {
    id: "procurement",
    title: "Purchase orders",
    keywords: [
      "po", "purchase order", "purchase orders", "procurement", "order",
      "draft", "receive", "invoice",
    ],
    questions: [
      {
        q: "How do I create a purchase order?",
        a: "Go to Procurement, pick a supplier, and add lines for the items you're ordering. It starts as a draft until you send it.",
      },
      {
        q: "How do I mark a PO as received?",
        a: "Open the PO and use Receive. This records the stock coming in and, if a price differs from what's on file, updates that supplier's price for the item.",
      },
      {
        q: "Can I delete a purchase order?",
        a: "Only if it's still a draft, and only an Admin can do it — once a PO is sent or received, it's a real record and stays for the audit trail.",
      },
      {
        q: "How do I scan a receipt to create a PO?",
        a: "Use Scan receipt, take or choose a photo of the invoice, and review the matched items and quantities before confirming — nothing is saved until you confirm.",
      },
      {
        q: "Why is the unit price showing as 0.00 when I add a line?",
        a: "That means there's no price on file yet for that item with this supplier — link one from the item's page, or type the price in manually on this line.",
      },
      {
        q: "Can I order in a different unit than the item's base unit?",
        a: "Yes — use the pack/unit conversion option on the line (for example, ordering by the litre when the item's base unit is ml) and it converts automatically.",
      },
    ],
  },
  {
    id: "inventory",
    title: "Inventory",
    keywords: [
      "inventory", "stock", "count", "live stock", "count sheet",
      "on hand", "stocktake",
    ],
    questions: [
      {
        q: "How do I see current stock levels?",
        a: "Inventory → Live stock shows on-hand quantities by department, calculated from every stock movement recorded so far.",
      },
      {
        q: "How do I do a stock count?",
        a: "Inventory → Count sheets — print a sheet, count physically, then enter or scan the results back in.",
      },
      {
        q: "Can I scan a filled-in count sheet instead of typing it in?",
        a: "Yes — print the sheet, fill it in by hand, then use Scan filled sheet to photograph it. Review the read-back numbers before submitting.",
      },
      {
        q: "How do I print a stock report?",
        a: "From Live stock, click 🖨 Print stock report for a per-department sheet with totals, below-par items, and the last count date.",
      },
      {
        q: "Why does a below-par item still show up after I've received stock?",
        a: "Check the stock was received against the right location and department — the below-par comparison is worked out per item/location/department, not just per item overall.",
      },
    ],
  },
  {
    id: "eod-reports",
    title: "End of day & Reports",
    keywords: [
      "end of day", "eod", "sales", "reports", "cogs", "food cost",
      "overhead", "margin",
    ],
    questions: [
      {
        q: "How do I import today's sales?",
        a: "End of day has a drag-and-drop CSV import. It also shows the date of your last import, so you can spot a gap.",
      },
      {
        q: "What does the End of day Overview show?",
        a: "Real sales, food cost, and margin for the period you pick, plus a comparison against a previous period, a rolling average, or another period you choose.",
      },
      {
        q: "How is food cost worked out?",
        a: "From the actual stock movements each sale caused, valued at the price on file when that stock was used — not a theoretical recipe cost.",
      },
      {
        q: "Why does a report show an item's cost as £0?",
        a: "That ingredient has never had a supplier price linked, so its cost can't be calculated yet — link a price on the item's page to fix it going forward.",
      },
      {
        q: "Where do I see menu-item performance?",
        a: "Reports has a full menu-performance table, with a trend chart and a CSV export.",
      },
      {
        q: "Does linking a new supplier price change past reports?",
        a: "No — past sales keep the cost that was current when they happened, so historical reports never silently change.",
      },
    ],
  },
  {
    id: "notifications",
    title: "Notifications & calendar",
    keywords: [
      "notification", "notifications", "bell", "calendar", "delivery",
      "reminder", "inventory check", "push",
    ],
    questions: [
      {
        q: "What does the notification bell show?",
        a: "Items currently below par, plus any upcoming delivery reminders or inventory-check-due alerts for your locations.",
      },
      {
        q: "How do I open the delivery calendar?",
        a: "Click the date shown next to the notification bell.",
      },
      {
        q: "What do the different dots on the calendar mean?",
        a: "A filled blue dot is an expected delivery, a filled green dot is one already received, and a hollow ring is a supplier's regular weekly delivery day rather than a specific dated order.",
      },
      {
        q: "How do I set reminder timing for deliveries?",
        a: "In Settings, an Admin can set how many days ahead of an expected delivery the reminder should appear, per location.",
      },
      {
        q: "Can I get a notification on my phone or desktop, not just in the app?",
        a: "Yes, if you've turned on browser push notifications in Settings.",
      },
    ],
  },
  {
    id: "team-roles",
    title: "Team & roles",
    keywords: [
      "team", "role", "roles", "admin", "manager", "staff", "permission",
      "login", "last active",
    ],
    questions: [
      {
        q: "What can an Admin do that a Manager or Staff member can't?",
        a: "Admins can manage Settings, delete a draft purchase order, and change org-wide configuration like currency and overhead — Managers and Staff work within the day-to-day screens.",
      },
      {
        q: "How do I add a team member?",
        a: "Go to Team and add their email, role, and location — they can sign in once their account is set up.",
      },
      {
        q: "Where do I see who's actively using the app?",
        a: "Team shows a Last active column for each member.",
      },
      {
        q: "I forgot my password — what do I do?",
        a: "There's no self-service reset in the app yet — ask an Admin to help, or contact support directly.",
      },
    ],
  },
  {
    id: "settings",
    title: "Settings",
    keywords: [
      "settings", "currency", "overhead", "import", "template", "category",
    ],
    questions: [
      {
        q: "How do I change the currency for a location?",
        a: "Settings → the per-location panel lets an Admin set currency and monthly overhead.",
      },
      {
        q: "Where do I download the import template?",
        a: "Settings → Import Items or Import Recipes — the template download is at the top, above the file upload, with the full column guide built in.",
      },
      {
        q: "What's the difference between the template import and \"Import menu list\"?",
        a: "The template import is the primary way to bring in your items or recipes in bulk. \"Import menu list\" (under Advanced) instead prefills the template from your POS export, if you have one.",
      },
      {
        q: "How do I add a new item category?",
        a: "Categories can be created directly from any item's Category field while editing it.",
      },
    ],
  },
];
