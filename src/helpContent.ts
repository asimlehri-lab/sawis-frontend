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
//
// Writing rule for every answer below: name the exact page, then the exact
// button/label text and where on that page it sits, in that order --
// "Go to Procurement, then click 🏬 Suppliers at the top of the page", not
// just "Click Suppliers". A user reading this while lost on a different
// screen should be able to follow it with zero guessing. Every navigation
// claim here has been checked against the actual component it describes,
// not written from memory -- when the UI changes, re-check the answer
// against the code before touching the wording, so this file doesn't drift
// back into the vague/wrong state it was fixed from (see git history on
// this file for the "How do I see all my suppliers?" example -- it used to
// say the sidebar, and Suppliers has never been a sidebar item).

export interface HelpQuestion {
  q: string;
  a: string;
  // Optional "did you know" tip shown as a second bubble under the answer --
  // deliberately used sparingly, only where there's a genuine cross-feature
  // connection worth surfacing (e.g. a shortcut elsewhere in the app), not
  // added to every question just to fill the slot.
  fact?: string;
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
        a: "Go to Items in the sidebar and click + New item, top right. Give it a name, a base unit (like kg or each), and a category, then save.",
        fact: "💡 If you've already imported a supplier's catalogue (Items → ⇪ Import supplier list), open your new item's page afterward — SAWIS automatically checks it against every catalogue you've uploaded and suggests matching suppliers and prices under \"Other suppliers that may stock this.\"",
      },
      {
        q: "What's a par level?",
        a: "The minimum stock you want on hand for an item at a location. When on-hand drops below it, the item shows up in Reorder (End of day → Reorder tab) and in the notification bell's \"Below par\" list. Set or change it from the item's own page — open the item from the Items list, find it in the per-location table, and edit the Par level field directly (it saves as you type).",
      },
      {
        q: "How do I set a default supplier for an item?",
        a: "An item needs at least two suppliers already linked to it before you can pick a default — open the item, scroll to its linked-suppliers list, and click Set as default next to the one you want (it only appears once there's more than one). The chosen one gets a ★ default tag. Reorder uses this to suggest who to order from — it doesn't change costing, which always uses whichever linked price is cheapest regardless of which supplier is marked default.",
      },
      {
        q: "Can I bulk-import items or recipes?",
        a: "Yes — go to Settings in the sidebar. Near the top of that page are two separate cards, Import items and Import recipes, each with its own CSV/Excel template download above the upload box, with the full column guide and a worked example built in. Import items first, then recipes, since recipe ingredients match against whatever items already exist. This is different from the ⇪ Import supplier list button on the Items page — see \"What's the difference between Import items/recipes and Import supplier list?\" under Settings if that's what you're looking for instead.",
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
      "min order", "minimum order", "catalogue", "catalog", "price list",
      "import supplier list", "recommended", "suggested", "match", "matching",
    ],
    questions: [
      {
        q: "How do I see all my suppliers?",
        a: "Suppliers isn't its own item in the sidebar — it lives inside Procurement. Click Procurement in the sidebar first, then click the 🏬 Suppliers button at the top of that page (it sits next to 📷 Scan receipt and + New purchase order). That opens a searchable list of every supplier you have.",
      },
      {
        q: "How do I import a supplier's product catalogue?",
        a: "This one's on the Items page, not Suppliers — go to Items and click ⇪ Import supplier list at the top, then pick which supplier the file is from and upload their CSV or Excel product list. SAWIS stores the whole thing in the background; nothing on your items changes yet. It then matches each line in that catalogue against your existing item names. To see what it found, open any item's page and scroll to \"Other suppliers that may stock this\" — each match shows a confidence %, the supplier's own line text, and their price. Nothing is linked automatically: you review each suggestion and click Link yourself, which is also what records that supplier's price against the item.",
        fact: "💡 This isn't a one-time match at upload — a catalogue you import today keeps working for items you add next month too, since the matching runs whenever you open an item's page, not just once at import time.",
      },
      {
        q: "How do I add a new supplier?",
        a: "From the Suppliers list (Procurement → 🏬 Suppliers), click + New supplier. Only the name is required — email, phone, delivery day, minimum order value and notes are all optional and can be filled in later.",
        fact: "💡 Two shortcuts worth knowing: if you're logging a delivery invoice, Scan receipt has its own + New supplier right on the scan screen, so you never have to leave that flow. And if you'd rather not add suppliers one at a time at all, upload their whole product list instead via Items → ⇪ Import supplier list — SAWIS matches it against your items in the background.",
      },
      {
        q: "Can I delete a supplier?",
        a: "No — suppliers can only be archived, not deleted, so your order history always stays intact. Archiving hides a supplier from new-order pickers without touching anything already recorded against it.",
      },
      {
        q: "How do I archive a supplier I no longer use?",
        a: "Open the supplier's page (Procurement → 🏬 Suppliers, then click their name) and scroll down to the Archive card near the bottom — click Archive supplier there. It's its own card, separate from Contact & terms further up the page.",
      },
      {
        q: "What does a supplier's delivery day do?",
        a: "If you set one, it shows as a marker on the delivery calendar every week on that weekday, as a reminder — it doesn't create or link to any specific order.",
      },
      {
        q: "Where do I update a supplier's phone number or notes?",
        a: "Open the supplier from the Suppliers list (Procurement → 🏬 Suppliers) and edit the Contact & terms card directly — phone, email, delivery day, minimum order value and notes are all there, and changes save as you go (no separate Save button).",
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
        a: "Go to Procurement in the sidebar and click + New purchase order, top right. Pick a supplier and add lines for the items you're ordering — it starts as a draft, and stays one until you click Mark as Sent.",
      },
      {
        q: "How do I mark a PO as received?",
        a: "Open the PO from Procurement and click Mark as Received (it needs to already be Sent first — the button label follows the PO's status, so it reads Mark as Sent until then). Receiving records the stock coming in and, if a price differs from what's on file, updates that supplier's price for the item.",
      },
      {
        q: "Can I delete a purchase order?",
        a: "Only if it's still a draft, and only an Admin can do it — once a PO is sent or received, it's a real record and stays for the audit trail.",
      },
      {
        q: "How do I scan a receipt to create a PO?",
        a: "From Procurement, click 📷 Scan receipt (next to 🏬 Suppliers, top of the page), take or choose a photo of the invoice, and review the matched items and quantities before confirming — nothing is saved until you confirm.",
        fact: "💡 If the invoice matches a purchase order you've already got open with that supplier, SAWIS spots it and offers to receive against that existing PO instead of creating a duplicate one.",
      },
      {
        q: "Why is the unit price showing as 0.00 when I add a line?",
        a: "That means there's no price on file yet for that item with this supplier — link one from the item's page, or type the price in manually on this line.",
      },
      {
        q: "Can I order in a different unit than the item's base unit?",
        a: "Yes — on the line you're adding, click \"Different pack or unit?\" (for example, ordering by the litre when the item's base unit is ml) and enter the conversion; it applies automatically from then on.",
      },
    ],
  },
  {
    id: "inventory",
    title: "Inventory",
    keywords: [
      "inventory", "stock", "count", "live stock", "count sheet",
      "on hand", "stocktake", "sections", "department",
    ],
    questions: [
      {
        q: "How do I see current stock levels?",
        a: "Go to Inventory in the sidebar — it opens on the Live stock tab, showing on-hand quantities by department, calculated from every stock movement recorded so far. (The other two tabs on that page are Count sheets and Manage sections.)",
      },
      {
        q: "How do I do a stock count?",
        a: "Go to Inventory, then click the Count sheets tab — print a sheet, count physically, then enter or scan the results back in.",
      },
      {
        q: "Can I scan a filled-in count sheet instead of typing it in?",
        a: "Yes — from Inventory → Count sheets, print the sheet, fill it in by hand, then use \"Scan filled sheet\" to photograph it. Review the read-back numbers before submitting.",
      },
      {
        q: "How do I print a stock report?",
        a: "From Inventory → Live stock, click 🖨 Print stock report for a per-department sheet with totals, below-par items, and the last count date.",
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
      "overhead", "margin", "scan receipt", "daily receipt",
    ],
    questions: [
      {
        q: "How do I import today's sales?",
        a: "Go to End of day in the sidebar. Two ways in: drag and drop a CSV export from your POS onto the dropzone, or click 📷 Scan end-of-day sales just below it to photograph the till's printed end-of-day summary instead and review the read-back items before confirming. The page also shows the date of your last import, so you can spot a gap.",
        fact: "💡 Scanning a photo also reads the sale date straight off the till printout and fills it in for you — it's still an editable field on the review screen, so it's worth a glance before you import in case the printout's date format threw it off.",
      },
      {
        q: "What does the End of day Overview show?",
        a: "End of day opens on the Overview tab: real sales, food cost, and margin for the period you pick, plus a comparison against a previous period, a rolling average, or another period you choose.",
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
        a: "Go to Reports in the sidebar — it has a full menu-performance table, with a trend chart and a CSV export.",
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
        a: "Items currently below par, plus any upcoming delivery reminders or inventory-check-due alerts for your locations. It sits top-right on every page, next to the ? help button.",
      },
      {
        q: "How do I open the delivery calendar?",
        a: "Click the date shown next to the notification bell, top-right of any page.",
      },
      {
        q: "What do the different dots on the calendar mean?",
        a: "A filled blue dot is an expected delivery, a filled green dot is one already received, and a hollow ring is a supplier's regular weekly delivery day rather than a specific dated order.",
      },
      {
        q: "How do I set reminder timing for deliveries?",
        a: "Go to Settings and scroll to the \"Delivery reminders & inventory checks\" card — an Admin can set how many days ahead of an expected delivery the reminder should appear, per location.",
      },
      {
        q: "Can I get a notification on my phone or desktop, not just in the app?",
        a: "Yes — turn on browser push notifications from that same \"Delivery reminders & inventory checks\" card in Settings.",
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
        a: "Go to Team in the sidebar and click + Add team member, top right. Enter their email, role, and location — they can sign in once their account is set up.",
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
      "import supplier list",
    ],
    questions: [
      {
        q: "How do I change the currency for a location?",
        a: "Go to Settings and scroll to the Locations card — an Admin can set each location's currency and monthly overhead there.",
      },
      {
        q: "Where do I download the import template?",
        a: "Go to Settings — the Import items and Import recipes cards near the top each have their own template download link, above the file upload, with the full column guide built in.",
      },
      {
        q: "What's the difference between the template import and \"Import menu list\"?",
        a: "The template import (the Import items / Import recipes cards) is the primary way to bring in your items or recipes in bulk. \"Import menu list\", inside the Import recipes card under Advanced, instead prefills the template from your POS export, if you have one.",
      },
      {
        q: "What's the difference between Import items/recipes and Import supplier list?",
        a: "They're easy to mix up but do opposite things. Settings → Import items / Import recipes (this page) creates new Item or Recipe records for your own menu and stock list from a spreadsheet. Items page → ⇪ Import supplier list instead uploads one supplier's product catalogue so SAWIS can suggest which of your existing items they stock — it never creates new items on its own, only suggested links you confirm.",
      },
      {
        q: "How do I add a new item category?",
        a: "Categories can be created directly from any item's Category field while editing it.",
      },
    ],
  },
];
