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
//
// Updated 6 Oct 2026 to cover the work since 21 Sep: allergens (tagging,
// review screen, print sheet), faceted filters, the Actions tab, count
// schedules, waste targets, scan delivery and PO attachments, staff
// permissions and the password changes. The `fact` bubble ("💡") is where
// the easy-to-miss shortcuts live.

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
      "category", "default supplier", "yield", "base unit", "used in",
      "cost target", "cost colour", "green", "orange", "red", "waste target",
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
        a: "Yes — an Admin goes to Settings in the sidebar and finds the Import recipes & items card. Click ⇩ Download Excel template (it asks for your password first, because it holds your costs and suppliers) to get one workbook with three tabs: Items, Recipes and Recipe Ingredients, already filled with what you have so far. Add rows in the blank section under each tab, save it, and upload it back in the same card — new items are created first, then the recipes that use them. This is different from the ⇪ Import supplier list button on the Items page — see \"What's the difference between Import recipes & items and Import supplier list?\" under Settings if that's what you're looking for instead.",
        fact: "💡 Every tab has filter arrows on its header row, so you can search a long catalogue in Excel before editing. The Items tab can also carry allergens (six dropdown columns) and a waste_pct target for brand-new items.",
      },
      {
        q: "How is a recipe's cost worked out?",
        a: "From each ingredient's most recently recorded supplier price, times the recipe's own quantities. Linking a new price only affects costs going forward, never sales already recorded.",
      },
      {
        q: "What's the difference between an Item and a Recipe?",
        a: "An Item is something you buy and hold stock of (a raw ingredient). A Recipe is something you sell, built from a list of Item ingredients plus quantities — its cost is derived from those ingredients.",
      },
      {
        q: "Which recipes use a particular item?",
        a: "Go to Items, open the item, and look at the Used in recipes card — every recipe that uses it is a chip. After 12 chips, click +N more to see the rest.",
        fact: "💡 Click any chip to jump straight to that recipe. You can also go the other way: on Recipes, Filter → Item used lists every recipe that contains an item.",
      },
      {
        q: "Can I have two items with the same name?",
        a: "No. SAWIS keeps one live item per name, ignoring capital letters and extra spaces, so “Milk Syrup” and “milk  syrup” count as the same item. If you try to add or rename an item to a name that is already taken, you get a message saying so; on + New item there is an Open the existing item button. When you create an item from a scanned delivery and the name already exists, SAWIS uses the existing item for that line instead.",
        fact: "💡 Archived items do not count, so you can archive an old item and create a fresh one with the same name. To find unused leftovers, go to Items → Filter → Used in recipes → Not used in any recipe.",
      },
      {
        q: "What do the green, orange and red cost colours mean?",
        a: "A dish's food or drink cost % is compared with your target: green means at or under target, orange means up to 10 points over, and red (“Well over target”) means more than 10 points over. You'll see the colours on recipe pages, in Reports and in the Actions tab's Cost breaching target list.",
      },
      {
        q: "Where do I set my food and drink cost targets?",
        a: "An Admin goes to Settings and scrolls to the Locations card — each location has a Food target and a Drink target (%) next to its currency and overhead. Change them, save, and the colours and Cost breaching target list follow. They start at 30%.",
      },
    ],
  },
  {
    id: "allergens",
    title: "Allergens",
    keywords: [
      "allergen", "allergens", "allergy", "allergies", "gluten", "milk", "nuts", "sulphites",
      "may contain", "contains", "confirm", "review allergens", "print sheet",
      "allergen card", "unchecked", "dagger", "cross-contact", "word list",
    ],
    questions: [
      {
        q: "How do I set an item's allergens?",
        a: "Go to Items, open the item and find the Allergens card. Under Contains, tap each allergen the item has; under May contain, tap anything it might pick up (a shared fryer, a “may contain nuts” label). Then press Confirm allergens — nothing is saved until you do. If the item has none, press Confirm: no allergens so it counts as checked. Admins, Managers and Finance can change allergens; Staff can read them.",
        fact: "💡 New items can also be tagged in bulk: the Items tab of the Excel import template has six allergen dropdown columns (allergen_1 to allergen_6).",
      },
      {
        q: "What do “Not reviewed yet”, “Suggested automatically” and “Confirmed” mean?",
        a: "Not reviewed yet: nobody has looked at the item, so SAWIS treats its allergens as unknown — never as allergen-free. Suggested automatically: SAWIS added or proposed tags from the item's name and it is waiting for a person to check. Confirmed: a person checked it and pressed Confirm; a confirmed item with no tags means “reviewed, no allergens”.",
      },
      {
        q: "What's the difference between Contains and May contain?",
        a: "Contains means an ingredient has the allergen in it. May contain is a cross-contact risk — the allergen isn't an ingredient but could be present, like a shared fryer. If an allergen is both, it shows as Contains. For a whole dish, a manager can add the kitchen's own cross-contact on the recipe page under “Kitchen cross-contact for this recipe (May contain)”. On paper the two are written out in words, never told apart by colour alone.",
      },
      {
        q: "How do I review lots of items quickly?",
        a: "Go to Items and click ⚠ Review allergens (the number is how many still need checking), or open the Actions tab and press Review items on the Allergen review tile. The Queue tab lists the items used in the most recipes first. Where SAWIS found tags from the name, you get a Looks right button — one tap if they're correct, or Edit to change them. Names it couldn't read are a tick list: tick the ones that genuinely have no allergens and confirm them from the bar at the bottom. The By dish tab lets you pick a dish and confirm all of its ingredients together.",
        fact: "💡 Easy to miss: shift-click a second tick box to tick everything in between, and the dark bar at the bottom of the screen only appears once you've ticked something.",
      },
      {
        q: "Can I handle similar items together?",
        a: "Yes. In the Queue's “Nothing found from the name” list, type a word in the search box (for example “syrup”), then click Tick all N shown. In the dark bar at the bottom press Add allergen…, choose Contains or May contain, pick the allergens and press Add and confirm N — every ticked item is tagged and confirmed in one go. Clear unticks everything. There is deliberately no select-all without a search: a name SAWIS couldn't read isn't proof the item is allergen-free.",
        fact: "💡 If you change your search after ticking, the bar tells you how many ticked items are now hidden, so you never confirm rows you can't see.",
      },
      {
        q: "How does SAWIS suggest allergens from item names?",
        a: "It reads the item name against a word list in English and German — “Whole milk” gets Milk, “Soy sauce” gets Soybeans plus a suggestion to check for gluten — and it ignores look-alikes such as coconut milk. It only ever adds; it never changes an item a person has confirmed, and it can't see the product label, so always check against the supplier's label. Each suggestion on the item page says why, with Add or Dismiss (Keep or Remove if it was already added); a dismissed suggestion stays dismissed until the item is renamed. It runs when you create or rename an item and on new import rows.",
        fact: "💡 To run it over every item at once, open the Actions tab and press Suggest from item names on the Allergen review tile — the button only shows while some items haven't been looked at yet.",
      },
      {
        q: "How do I see only items with allergens, or only ones not checked yet?",
        a: "On Items or Recipes click Filter, choose Allergen status and tick Contains allergens, May contain only, No allergens (confirmed) or Not checked yet. “No allergens (confirmed)” and “Not checked yet” are kept apart on purpose. To look for one allergen use the Allergens parameter, and on Items, Allergen review → Needs checking shows what still needs a decision.",
      },
      {
        q: "Why does a recipe say some ingredients haven't been checked?",
        a: "A recipe's allergens are worked out from its ingredients, sub-recipes included. If any ingredient hasn't been confirmed, the recipe page warns that the list may be incomplete — it is not an all-clear — and printed sheets mark that recipe with a †. Confirm those ingredients (the By dish tab on Review allergens is the quickest way) and the warning goes away.",
      },
      {
        q: "What can I put on the Print sheet?",
        a: "Go to Recipes and click 🖨 Print sheet. Choose What to print (Allergens, Ingredients and quantities, or both), Which recipes (everything, or what's showing now) and Which kind (dishes, sub-recipes only, or both). With Allergens ticked you can also print only recipes that have chosen allergens, and decide whether to include May contain and recipes with none. The line under the options says how many recipes will print. Costs and prices never print, so anyone, including Staff, can use it.",
        fact: "💡 Filter the Recipes list first (for example Allergens → Milk), then open Print sheet and keep “What is showing now” to print just that group.",
      },
      {
        q: "How do I print one dish's allergens?",
        a: "Open the recipe and click 🖨 Print allergen card — a large, easy-to-read card for that dish alone, with its Contains and May contain lists.",
      },
    ],
  },
  {
    id: "filters",
    title: "Filters & search",
    keywords: ["filter", "filters", "search", "narrow", "chips", "parameter", "find"],
    questions: [
      {
        q: "How do I filter a list?",
        a: "On Items, Recipes, Inventory → Live stock and Procurement, click Filter next to the list's search box. Pick a parameter (for example Category or Supplier), then tick the values you want — use the search box inside it if the list is long. Each active filter appears as a small chip beside the Filter button.",
        fact: "💡 Click a chip's name to jump straight back to that filter's values; click its × to clear just that one.",
      },
      {
        q: "What can I filter by?",
        a: "Items: Category, Supplier, Allergens, Allergen status, Status (Active or Archived — archived items are hidden until you pick Archived), Allergen review and Used in recipes (pick “Not used in any recipe” to find leftover or duplicate items). Recipes: Category, Item used, Food or drink, Cost vs target (On target, Over target, Well over target), Allergens and Allergen status. Live stock: Status (Below par or OK), Section and Category. Procurement: Supplier, Location and Item. Dish vs Sub-recipe, Department and PO status keep their own tabs above the list.",
      },
      {
        q: "How do several filters combine?",
        a: "Different parameters narrow the list — Category = Dairy and Supplier = Fresh Co shows only dairy from Fresh Co. Several values inside one parameter widen it — Category = Dairy or Bakery shows both.",
      },
    ],
  },
  {
    id: "actions",
    title: "Actions tab",
    keywords: [
      "actions", "tasks", "needs attention", "to do", "latest updates", "feed", "news",
      "tiles", "live", "overview", "cost breaching", "what needs doing",
    ],
    questions: [
      {
        q: "What's on the Actions tab?",
        a: "Go to End of day → Actions. Managers, Finance and Admins see a live Needs attention block, a Latest updates feed and a Cost breaching target list. Staff see only what's theirs: counts assigned to them, upcoming inventory checks and a waste-log reminder. Nothing needs dismissing by hand — an item drops off the moment the number behind it is fixed. It used to be called Tasks.",
      },
      {
        q: "What do the Needs attention tiles do?",
        a: "There are four, refreshed about every minute. Deliveries lists upcoming and overdue purchase orders — click a line to open the PO. Below par counts items to reorder — click it to go to the Reorder tab. Allergen review counts items waiting for a person to confirm their allergens. Inventory checks shows each scheduled section as checked, in progress, due soon or overdue, with who it's assigned to — click a line to go to Inventory.",
        fact: "💡 The Allergen review tile has Review items to open the review screen, and Suggest from item names to run the word list over everything.",
      },
      {
        q: "What's the Latest updates feed?",
        a: "A seven-day news feed under the tiles of what changed: waste logged, and items and recipes created or edited. Use the All, Waste, Items and Recipes chips to narrow it, click a row to open that item, recipe or the Waste log, and Show N more to see older entries. Several edits to one item on the same day collapse into one row. Bulk imports aren't listed.",
      },
      {
        q: "What does Cost breaching target show?",
        a: "Dishes whose food or drink cost % is over target, worst first, each with a gauge in the green, orange or red cost colours. Click one to open its recipe. Targets are set per location in Settings → Locations.",
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
        a: "Open the PO from Procurement and click Mark as Received (it needs to already be Sent first — the button label follows the PO's status, so it reads Mark as Sent until then). Receiving opens a Receiving delivery panel where you can type the supplier's invoice number, check the delivery against a photo (see Scan delivery below), and amend what actually arrived. Confirming records the stock coming in and, if a price differs from what's on file, updates that supplier's price for the item.",
      },
      {
        q: "Can I delete a purchase order?",
        a: "Only if it's still a draft, and only an Admin can do it — once a PO is sent or received, it's a real record and stays for the audit trail.",
      },
      {
        q: "How do I scan a receipt to create a PO?",
        a: "From Procurement, click 📷 Scan receipt (next to 🏬 Suppliers, top of the page — managers and above), take or choose a photo of the invoice, and review the matched items and quantities before confirming — nothing is saved until you confirm.",
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
      {
        q: "How do I check a delivery against the order using a photo?",
        a: "Open the sent PO and click Mark as Received to open the Receiving delivery panel. Under Scan delivery (optional) tap 📷 Take photo or 🖼 Choose photo. SAWIS compares the photo with this order's lines only and flags each one: ✓ matches, ⚠ differs (the received fields are tinted so the difference stands out) or not in photo. Anything on the photo that isn't on the order is listed in a banner. It only pre-fills and flags — you amend by hand and confirm as usual.",
      },
      {
        q: "Where are receipt photos and invoices kept?",
        a: "Every PO page has an Attachments card above Order lines. Photos from Scan receipt and Scan delivery are saved there automatically once the PO is marked received. Use + Attach a file to add anything else, such as a supplier's PDF invoice. Open shows the file in a new tab; Remove is for Admins only.",
        fact: "💡 Keeping the receipt, delivery photo and invoice on the PO means the whole paper trail is in one place when your accountant asks for it.",
      },
      {
        q: "What does “Qty received (in Pkg)” and the bold total mean?",
        a: "When a supplier sells in a different pack from your item's base unit (say 1 Pkg = 40 ea), the Qty and price labels switch to “in Pkg” and a bold total underneath shows the converted amount (for example 2 Pkg → 80 ea), so you can see the real quantity while you type. If the pack size isn't known yet, that total turns amber until you enter it under “Different pack or unit?”.",
      },
      {
        q: "Who can place orders, and who can receive them?",
        a: "Creating and editing purchase orders, Suppliers and Scan receipt are for Admins, Managers and Finance. Staff can open a PO read-only and, once it has been sent, receive it — including Scan delivery and attaching files.",
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
      {
        q: "How do I schedule regular counts for a section?",
        a: "Go to Inventory → Manage sections (managers and above), click Edit section on a section — or + New section — and under Count schedule choose Weekly or Monthly, then set Next due. The section's card shows its schedule, and it appears under Inventory checks on the Actions tab with its assignee.",
      },
      {
        q: "What do the labels on the Count sheets cards mean?",
        a: "On Inventory → Count sheets each section is a card — click anywhere on it to open its sheet. The badge shows To do, In progress or Complete, and a scheduled section also shows Due 8 Oct, Overdue since 1 Oct (the card turns warning-coloured) or Next check 15 Oct once it's done. A scheduled section turns green when its count is submitted and goes back to due on its own when the next due date arrives.",
        fact: "💡 If a count finds a shortfall and you give the reason as Spoilage, Breakage/spill, Theft suspected or Over-portioning, SAWIS records it in the Waste log for you — no need to enter it twice.",
      },
      {
        q: "Why won't my count sheet submit?",
        a: "A row with a negative or invalid counted quantity stops the submit and names the items affected. Correct those quantities and submit again — rows are never dropped silently.",
      },
    ],
  },
  {
    id: "waste-log",
    title: "Waste log",
    keywords: [
      "waste", "wastage", "spoilage", "breakage", "spill", "log waste",
      "theft", "over-portioning", "miscount",
    ],
    questions: [
      {
        q: "How do I log waste?",
        a: "Go to Waste log in the sidebar. Pick the item, a reason, the location and department, and a quantity, then click Log waste.",
        fact: "💡 Picking an item that already has stock on hand somewhere auto-fills the location and department from wherever it's held, so you usually only need to correct those if the waste happened somewhere else.",
      },
      {
        q: "Does logging waste affect my stock count?",
        a: "Yes — logging waste immediately deducts that quantity from on-hand stock at the location and department you picked, the same as it would if the item had genuinely gone out the door. There's no separate step needed to update stock afterward.",
      },
      {
        q: "How is a waste event's value worked out?",
        a: "From the item's cheapest linked supplier price at the moment you log it — shown next to the item picker as soon as you choose one. If the item has no supplier price on file yet, it logs at £0 until one is linked; a price you link afterward doesn't retroactively update entries already logged.",
      },
      {
        q: "What reasons can I pick when logging waste?",
        a: "Spoilage, Breakage/spill, Over-portioning, Miscount, Theft suspected, Delivery short, Used in special, or Other.",
      },
      {
        q: "How do I see waste broken down by reason?",
        a: "Waste log's own \"By reason\" card (next to Recent waste) breaks down all-time waste value by reason. The Recent waste table beside it can also be filtered to one reason at a time using the chips above it.",
      },
      {
        q: "What do the numbers at the top of Waste log show?",
        a: "Three cards: total waste value and number of events logged over the last 7 days, and the costliest reason over that same period. Waste as a percentage of sales isn't tracked on this page — for an item's waste against a target, open the item and look at its Waste card.",
      },
      {
        q: "How do I set a waste target for an item?",
        a: "Go to Items, open the item and find the Waste card. Type your predicted spoilage in Target waste (%) and press Save. SAWIS then compares it with the item's actual waste — logged waste against sales usage over the last 90 days — and shows a gauge, a six-month trend and a tag: On track, Investigate (actual is at least two points over target), No target set or No data yet.",
        fact: "💡 For brand-new items you can set targets in bulk with the waste_pct column on the Items tab of the Excel import template. Actual waste needs some sales or waste logged before it shows a number.",
      },
      {
        q: "Why is there waste in the log that I didn't enter?",
        a: "When a stock count finds a shortfall and the reason is Spoilage, Breakage/spill, Theft suspected or Over-portioning, SAWIS adds a matching waste entry for you. Miscount, Delivery short, Used in special and Other are not treated as waste. The When column shows the date and time each entry was recorded.",
      },
      {
        q: "Does logging waste count as doing a stock count?",
        a: "No. Logging waste adjusts stock, but only submitting a count sheet marks a section as counted — so it never turns a section card green or moves its next due date.",
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
        q: "What are the End of day tabs?",
        a: "End of day has up to three tabs. Sales (managers and above) shows real sales, food cost and margin for the period you pick, plus a comparison against a previous period, a rolling average, or another period you choose. Actions (everyone) is the live to-do overview — see the Actions tab topic. Reorder (managers and above) lists items below par. Staff only see Actions. Sales used to be called Overview, and Actions used to be called Tasks.",
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
        a: "Go to Reports in the sidebar (managers and above) — it has a full menu-performance table with a trend chart. The Export CSV button is for Admins only, and it asks for your password every time.",
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
        a: "Only Admins can open Settings, delete a draft purchase order, remove PO attachments, reset a teammate's password, and download the import template or export Reports as CSV (those two ask for their password each time). Managers and Finance run the day-to-day screens, including ordering, allergen confirmation and sections; Staff have a lighter view — see “What can staff see and do?”.",
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
        a: "Ask an Admin: on Team, click Reset password on your row and they set a new one for you (they'll need to tell you what it is). There's no emailed reset link yet. If you're the only Admin, contact SAWIS support.",
      },
      {
        q: "How do I change my own password?",
        a: "Admins go to Settings, find the Password card, enter the Current password, the New password twice and click Change password. Only Admins can open Settings, so Managers, Finance and Staff ask an Admin to reset it from Team.",
      },
      {
        q: "What can staff see and do?",
        a: "Staff land on End of day → Actions, which shows their assigned counts, upcoming checks and a waste-log reminder (no cost or ordering data). They can use Inventory count sheets, the Waste log, and read Items, Recipes and purchase orders view-only. They can receive a sent PO, print the allergen Print sheet and read allergens, but can't edit items or recipes, confirm allergens, place orders, scan receipts, or see Sales, Reorder or Reports.",
        fact: "💡 If someone on your team says a button is missing, check their role first — Staff, Manager, Finance and Admin each see a different set.",
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
        a: "Go to Settings and find the Import recipes & items card — click ⇩ Download Excel template. SAWIS asks for your password first (every time), because the workbook contains your costs and suppliers. It opens with a Read me tab explaining each column.",
      },
      {
        q: "What's the difference between the template import and \"Import menu list\"?",
        a: "The template import (the Import recipes & items card) is the primary way to bring in your items and recipes in bulk. \"Import menu list\", inside that card under Advanced, instead prefills the template from your POS export, if you have one.",
      },
      {
        q: "What's the difference between Import recipes & items and Import supplier list?",
        a: "They're easy to mix up but do opposite things. Settings → Import recipes & items (this page) creates new Item or Recipe records for your own menu and stock list from a spreadsheet. Items page → ⇪ Import supplier list instead uploads one supplier's product catalogue so SAWIS can suggest which of your existing items they stock — it never creates new items on its own, only suggested links you confirm.",
      },
      {
        q: "How do I add a new item category?",
        a: "Categories can be created directly from any item's Category field while editing it.",
      },
      {
        q: "How do I set my food and drink cost targets?",
        a: "Settings → Locations card: each location has a Food target and a Drink target (%) beside its currency and overhead. Change them and save. They drive the green, orange and red cost colours and the Actions tab's Cost breaching target list, and start at 30%.",
      },
      {
        q: "How do I change my password?",
        a: "Settings → Password card (Admins). Enter your Current password, the New password twice, then click Change password. Forgotten it? Another Admin can reset it from Team.",
      },
      {
        q: "Why does SAWIS ask for my password when I download something?",
        a: "The import template and Reports' Export CSV contain your costs, prices and suppliers, so an Admin has to retype their password before each download. It asks every time on purpose, and nothing is downloaded if it's wrong.",
      },
    ],
  },
  {
    id: "tips",
    title: "Tips & shortcuts",
    keywords: ["tip", "tips", "shortcut", "shortcuts", "faster", "quick", "hidden", "easy to miss", "shift"],
    questions: [
      {
        q: "What shortcuts are easy to miss when reviewing allergens?",
        a: "Shift-click a second tick box to tick a whole run. After typing in the search box, Tick all N shown ticks every match. The dark bar at the bottom appears only once something is ticked, and holds Clear, Add allergen… and Confirm. Looks right on a suggested item confirms the tags exactly as shown. On the By dish tab, confirming a dish's ingredients is what removes the † from its printed card.",
      },
      {
        q: "What shortcuts are there in lists and filters?",
        a: "Click a filter chip's name to reopen its values, or its × to clear it. The Status chip on Items starts on Active; clear it or add Archived to see archived items again. On an item, the Used in recipes chips jump straight to each recipe. On Recipes, filter first and then Print sheet's “What is showing now” prints just that group. In Items, the ⚠ Review allergens button shows how many items still need checking.",
      },
      {
        q: "What shortcuts are there for counts and daily jobs?",
        a: "On Inventory → Count sheets the whole section card opens its sheet. On the Actions tab every tile line and every Latest updates row opens the thing it mentions, and the tiles refresh themselves about once a minute. A scheduled section turns green on its own when you submit its count and turns due again by itself on the next due date.",
      },
      {
        q: "Where do I find things that were renamed?",
        a: "End of day → Overview is now Sales and Tasks is now Actions. The Recipes button 🖨 Allergen sheet is now 🖨 Print sheet. Items → Import items no longer exists: bulk imports for items and recipes are one workbook, in Settings → Import recipes & items.",
      },
    ],
  },
];
