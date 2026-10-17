# Store listings

The copy below works for every store. Store-specific notes are at the end.

## Name

CardHop: Virtual Card Shortcut

## Short description (132 characters max)

One-click shortcut to your Capital One® or Citi® virtual card page. Unofficial. Not affiliated with or endorsed by either bank.

## Full description

Miss the retired Eno® browser extension? CardHop opens your bank's virtual card page in one click, so you can grab a virtual card number at checkout without digging through menus.

Works with:
• Capital One® virtual cards
• Citi® Virtual Account Numbers

Two ways to get there:
• Click the CardHop icon in your toolbar
• Right-click any page or checkout field and choose "Open … virtual cards"

Optional settings:
• Choose your banks: Capital One, Citi, or both (one button each)
• Skip the popup so a single click on the icon opens your cards (with one bank selected)
• Choose where cards open: a new tab (default) or the current tab

Signed out? Capital One sends you to its home page after you sign in. CardHop can take you on to your virtual cards automatically: choose Capital One and click "Turn on".

At checkout (optional, off by default): turn on "Offer CardHop at checkout" in Settings and CardHop shows a small prompt in the top-right corner when you click into a card field, with buttons to open your virtual cards in a new tab. You can close it, turn it off for a site, or show just a small icon instead.

Have more than one card? Save each card's virtual cards page and give it a name, and CardHop adds a button for it.

Privacy: CardHop does not read, store or fill card numbers, and it never reads page content. Saved card page links are kept only in your browser on this device and never sent anywhere; delete them any time with "Forget my cards". It has no access to any website unless you turn on one of two optional settings. Returning after sign-in asks for permission to see page addresses on myaccounts.capitalone.com only. "Offer CardHop at checkout" asks for access to all sites, after explaining why, so CardHop can notice when a card field gets focus; it checks only field attributes such as type, autocomplete, name, id, placeholder and label, and never reads what you type or anything else on the page. Your browser words these permissions as "read and change your data". Nothing is sent anywhere. You can turn either setting off at any time, which gives the permission back.

Capital One® and Eno® are registered trademarks of Capital One Financial Corp. Citi® is a registered trademark of Citigroup Inc. CardHop is an independent project and is not affiliated with, sponsored by, or endorsed by Capital One or Citi.

## Privacy policy URL

https://github.com/webdevnerdstuff/cardhop-extension/blob/main/PRIVACY.md

## Category

Tools

## Single purpose (for the review form)

Opens the user's bank virtual card page (Capital One or Citi) from the toolbar, the right-click menu, or, if the user turns it on, a small prompt shown at checkout when a card field gets focus.

## Permission justifications

- contextMenus: adds an "Open … virtual cards" entry to the right-click menu.
- storage: saves the user's settings (banks, skip popup, where the cards page opens, and whether the checkout prompt opens automatically), saved card page links the user chose to save and the list of sites the user turned the checkout prompt off on (both local storage on the device only, never synced), and remembers for up to 10 minutes which tab CardHop opened while the user signs in.
- scripting: registers the checkout content script, and only after the user turns on "Offer CardHop at checkout". It is not used otherwise.
- Optional host permission <all_urls>: off by default. Requested only when the user turns on "Offer CardHop at checkout" in Settings, after an explanation of what it is for. It is requested for one purpose: a content script, running in each page and payment frame (Stripe and similar), that notices when a credit card field gets focus so CardHop can show a small prompt in the corner of the page with buttons to open the user's virtual cards. To decide whether a field is a card field it checks only field attributes such as type, autocomplete, name, id, placeholder and aria-label. It never reads typed values or page text, never stores or sends what the user types or any page content, and does not run on any Capital One or Citi site. While granted, it also reveals every tab's address to the background script; CardHop ignores these except on Capital One and Citi pages, where its existing features use them (the save badge on card pages, and returning after sign-in, which stays on for Capital One while this permission is granted). No address is stored or sent. The user can turn the setting off at any time, which unregisters the script and removes the permission.
- Optional host permission https://myaccounts.capitalone.com/*: requested only when the user selects Capital One and clicks "Turn on" in the popup, after an explanation of what it is for. It lets CardHop see when the tab it opened lands on Capital One's account home page after sign-in, so it can send that tab to the virtual cards page once. It reads no page content.

## Where to upload

Run `pnpm pack:stores` and use the files in `dist/`.

| Store | File | Notes |
|---|---|---|
| Chrome Web Store | `cardhop-chromium-<version>.zip` | Brave and Vivaldi users install from here. |
| Microsoft Edge Add-ons | `cardhop-chromium-<version>.zip` | Same zip as Chrome. |
| Opera add-ons | `cardhop-chromium-<version>.zip` | Same zip as Chrome. |
| Firefox Add-ons (AMO) | `cardhop-firefox-<version>.zip` | See below. |

### Firefox Add-ons notes

- **Source code:** AMO asks for source code when an add-on is compiled, which CardHop is (TypeScript). Upload `cardhop-source-<version>.zip` when asked.
- **Build instructions for the reviewer:** Use Node.js 24 (see `.nvmrc`) and pnpm 12. Run `pnpm install --frozen-lockfile`, then `pnpm build`. The add-on is generated in `build/firefox`. No minification is used. `tsc` compiles each TypeScript file to one JavaScript file, except the checkout content script: content scripts can't be ES modules, so esbuild (a pinned devDependency) bundles `src/checkout/content.ts` and the modules it imports into `checkout/content.js`, one unminified classic script (IIFE).
- **Optional all-sites access:** `<all_urls>` is an optional host permission, requested only when the user turns on "Offer CardHop at checkout". The content script is `checkout/content.js`; it is registered at runtime with `scripting.registerContentScripts` and checks field attributes only.
- **Data collection:** CardHop collects no data. The manifest declares `data_collection_permissions: { required: ["none"] }`.
- **Add-on ID:** `cardhop@webdevnerdstuff`. Keep it the same for every update. It's in Firefox's email-like ID format but isn't an email address; your contact email goes in your AMO developer account and the listing's support details.
