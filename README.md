# CardHop: Virtual Card Shortcut

CardHop is a small browser extension (Manifest V3) that takes you straight to your bank's virtual card page:

| Bank | Page |
|---|---|
| Capital One | https://myaccounts.capitalone.com/vc/virtual-cards/manager |
| Citi | https://online.citi.com/US/ag/repcard/van2 |

It is an unofficial stand-in for the retired Eno® browser extension. It does not read or fill card numbers. It only opens the page, where you sign in and copy a virtual card as usual.

Capital One® and Eno® are registered trademarks of Capital One Financial Corp. Citi® is a registered trademark of Citigroup Inc. CardHop is independent and is not affiliated with, sponsored by, or endorsed by Capital One or Citi.

## Supported browsers

| Browser | Build | Where to get it |
|---|---|---|
| Chrome, Brave, Vivaldi | `chromium` | Chrome Web Store |
| Microsoft Edge | `chromium` | Microsoft Edge Add-ons |
| Opera | `chromium` | Opera add-ons |
| Firefox 140+ | `firefox` | Firefox Add-ons (AMO) |

Safari is not supported.

## Ways to open your virtual cards

- **Toolbar popup**: click the extension icon, then the button for your bank. With both banks selected, the popup shows one button for each.
- **Right-click menu**: "Open Capital One virtual cards" and/or "Open Citi virtual cards" on any page, in any text field (handy at checkout), or on the toolbar icon.
- **At checkout** (optional, off by default): a small prompt appears in the top-right corner, under the toolbar, when you click into a card field. See [Offering CardHop at checkout](#offering-cardhop-at-checkout).

## Settings

Open them from the popup's **Settings** section, or right-click the toolbar icon and choose **Options** (in Firefox: **Manage Extension**).

- **My banks**: Capital One, Citi, or both. No bank is selected at first; the popup asks you to choose one.
- **Card buttons**: grouped by bank. Rename any button, including each bank's default page button (Reset restores its original name), and manage saved card pages. See below.
- **Skip this popup**: a single click on the toolbar icon opens the cards page immediately. Only available with one bank selected.
- **Open cards in**: where the cards page opens.
  - **A new tab** (default)
  - **The current tab**: replaces the page you're on.
- **At checkout**: **Offer CardHop at checkout** and its options. See below.

### Offering CardHop at checkout

When you click or tab into a credit card field on a checkout page, CardHop can show a small prompt in the top-right corner of the page, just under the toolbar where the CardHop icon sits, with a button for each of your banks and your saved card pages. Click one to open that page. It always opens in a new tab, whatever **Open cards in** says, so you stay on the checkout page.

This is off by default. To turn it on, go to **Settings → At checkout** and turn on **Offer CardHop at checkout**. CardHop explains what it needs, then your browser asks for access to all sites. Until you allow it, CardHop works as before. Turning the setting off gives the access back.

- **Open the prompt automatically** (on by default): when off, a small CardHop icon appears inside the card field instead, and the prompt opens when you click it.
- **✕** closes the prompt for this page. From the next time a card field gets focus, only the small icon shows, and clicking it opens the prompt again.
- **Not on this site** turns the prompt off for that site. Turn it back on under **Settings → Turned off on these sites**.
- **Keyboard**: press Alt+Shift+C while a card field has focus to move focus into the prompt. Escape closes it.
- If no bank is selected yet, the prompt says "Choose your bank in CardHop's settings".

It works in payment-provider frames (Stripe and similar) and in fields added after the page loads. It doesn't run on any Capital One or Citi site.

To decide whether a field is a card field, CardHop checks only field attributes such as `type`, `autocomplete`, `name`, `id`, `placeholder` and `aria-label`, never the value. It never reads what you type or any other page content, and nothing leaves your browser. The sites you turn off are saved in this browser only (never synced), and **Open the prompt automatically** is saved with your other settings.

Known gaps: card fields drawn on a canvas or inside a closed shadow root can't be seen, frames that don't allow extension scripts can't be used, and a field with no `autocomplete` hint and an unusual name may be missed.

### Returning after sign-in

If you're signed out, Capital One's sign-in sends you to its account home page instead of your virtual cards. With this setting on, CardHop watches the tab it opened for up to 10 minutes. After a trip to the sign-in page, CardHop waits for Capital One to finish signing you in (it never interrupts the pages in between, such as `/welcome`). Once the tab lands on the account summary, CardHop sends it to the virtual cards page once, then stops watching. If you were already signed in, nothing happens.

When you choose Capital One, the popup explains this and offers a **Turn on** button, which asks your browser for permission to see page addresses on `myaccounts.capitalone.com`. Browsers word that prompt as "read and change your data" for any site access; CardHop only looks at the page address. Until you turn it on, CardHop works as a plain shortcut. CardHop never reads page content, and it never reads the sign-in site (`verified.capitalone.com`), and the checkout script (see above) is excluded there. To turn it off, untick Capital One or remove the permission in your browser's extension settings; either gives the permission back. While **Offer CardHop at checkout** is on, its all-sites access also covers `myaccounts.capitalone.com`, so returning after sign-in stays on until you turn that setting off too.

Citi doesn't have this setting yet. To add it for a bank, give that bank a `signInReturn` entry in `src/shared.ts` (including the page it lands on after sign-in) and list its site under `optional_host_permissions` in `src/manifest.json`.

## Install from source

Use Node.js 24 and [pnpm](https://pnpm.io). The Node version is in `.nvmrc`, so [nvm](https://github.com/nvm-sh/nvm) users can run `nvm use` in the project folder. The pnpm version is pinned in `package.json`, and Corepack or pnpm 9.7+ switches to it automatically.

```bash
git clone https://github.com/WebDevNerdStuff/cardhop-extension.git
cd cardhop-extension
nvm use
pnpm install
pnpm build
```

This creates `build/chromium` and `build/firefox`.

**Chrome, Brave, Edge, Opera, Vivaldi**

1. Open the extensions page (`chrome://extensions`, `brave://extensions`, `edge://extensions`, `opera://extensions` or `vivaldi://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select `build/chromium`.

**Firefox**

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on** and select `build/firefox/manifest.json`.

Firefox removes temporary add-ons when it restarts.

After changing the code, run `pnpm build` again and reload the extension.

### Saved card pages

Capital One's virtual cards page opens on your first card after you sign in. To jump straight to another card, save its page:

- Open that card's virtual cards page, then open CardHop and click **Save**. The CardHop icon shows a **+** on card pages you haven't saved. (Both need returning after sign-in turned on, so CardHop can see the page address.) Or
- Paste the page's link under **Settings → Card buttons**.

Until you save one, the popup shows a short tip explaining this; **Got it** hides it.

Only virtual card pages on Capital One's or Citi's own sites can be saved. Saved links are kept only in this browser on this device (extension local storage, never synced) and are never sent anywhere. Rename or delete them one at a time in Settings, or use **Forget my cards** to remove them all. If you were signed out, CardHop returns you to the saved card after you sign in.

## Permissions

- `contextMenus`: adds the right-click menu entries.
- `scripting`: registers the checkout script when you turn on **Offer CardHop at checkout**. It shows no warning on its own and gives no access to any site.
- `storage`: saves your settings, including **Open the prompt automatically** (synced with your browser account), and your saved card pages and the sites you turned the checkout prompt off on (this device only, never synced).
- `https://myaccounts.capitalone.com/*` (optional): requested only when you click **Turn on** for returning after sign-in. Lets CardHop see page addresses on that site. Browsers describe this as "read and change your data"; CardHop never reads or changes page content.
- All sites, `<all_urls>` (optional): requested only when you turn on **Offer CardHop at checkout**, after CardHop explains why. Lets CardHop run in each page and payment frame so it can notice when a card field gets focus. Browsers describe this as "read and change all your data on all websites". CardHop checks only field attributes such as those listed above; it never reads what you type or any other page content, and nothing is sent anywhere. It also lets the browser tell CardHop's background the address of every tab; CardHop ignores these except on Capital One and Citi pages, where they drive the save badge and returning after sign-in (which stays on for Capital One while this access is granted). Turning the setting off, or removing the permission in your browser's extension settings, gives it back.

CardHop has no access to any website unless you turn on one of those two optional settings, and it never reads page content.

See the [privacy policy](PRIVACY.md) for what CardHop stores and where.

## Development

The extension is written in TypeScript. `tsc` compiles each file to one JavaScript file, except the checkout content script: content scripts can't be ES modules, so esbuild bundles `src/checkout/content.ts` and what it imports into `checkout/content.js`, one unminified classic script (IIFE).

```
src/
  manifest.json     base manifest; the build adds browser-specific keys
  ext.ts            picks `browser` (Firefox) or `chrome` (Chromium) for extension APIs
  shared.ts         banks, settings, opening a bank's page
  background.ts     context menu, direct-open mode, tab events
  open.ts           opens a bank's page
  sign-in-return.ts optional return to virtual cards after a bank's sign-in
  checkout/         optional checkout prompt: card-field detection, the in-page prompt and the content script
  checkout-*.ts     checkout access, messages and per-site list (background and popup side)
  popup/            popup and options UI
  icons/            icon.svg source + rendered PNGs
scripts/
  build.ts          compiles src into build/chromium and build/firefox
  pack.ts           builds store zips in dist/
tests/              unit tests (Node's built-in test runner)
```

| Command | What it does |
|---|---|
| `pnpm build` | Build both browsers. `pnpm build firefox` builds one. |
| `pnpm typecheck` | Type-check `src`, `scripts` and `tests`. |
| `pnpm test` | Run the tests. |
| `pnpm pack:stores` | Build the store zips (see below). |

### Tests

Tests run the TypeScript directly using Node's built-in type stripping, with a fake extension API and [jsdom](https://github.com/jsdom/jsdom) for the popup. They also run the real build and check both manifests. Type checking, tests and the build run on every push and pull request through GitHub Actions.

### Packaging for the stores

```bash
pnpm pack:stores
```

| File in `dist/` | Upload to |
|---|---|
| `cardhop-chromium-<version>.zip` | Chrome Web Store, Microsoft Edge Add-ons, Opera add-ons |
| `cardhop-firefox-<version>.zip` | Firefox Add-ons |
| `cardhop-source-<version>.zip` | Firefox Add-ons, as the source code for review |

The version comes from `src/manifest.json`, which must match `package.json`. Store listing copy lives in [STORE_LISTING.md](STORE_LISTING.md).

### Icons

To regenerate the PNG icons after editing `src/icons/icon.svg` (requires [ImageMagick](https://imagemagick.org/)):

```bash
cd src/icons && for s in 16 32 48 128; do magick -background none -density 384 icon.svg -resize ${s}x${s} icon${s}.png; done
```

### Adding a bank

Banks live in `BANKS` in `src/shared.ts`. Before adding one, check that its virtual card URL works when opened in a fresh tab, both signed in and signed out. Some bank pages only work when reached through the site's own menus (Citi's `van3/dashboard` is one).

## Roadmap

Planned work and what has shipped is in [ROADMAP.md](ROADMAP.md).

## Contributing

Issues and pull requests are welcome. Please run `pnpm typecheck` and `pnpm test` before opening a pull request, and keep host access optional and off by default, and keep the extension free of anything that reads or stores card details or page content.

## License

[MIT](LICENSE) © WebDevNerdStuff
