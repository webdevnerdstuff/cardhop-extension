# CardHop privacy policy

Last updated: October 17, 2026

CardHop is a browser extension that opens your bank's virtual card page. It collects no data. It has no server, and nothing it stores is ever sent to the developer or anyone else.

## What CardHop stores, and where

All of this is kept in your browser's extension storage. CardHop never sends it anywhere.

- **Your settings:** which banks you chose, the names you gave their buttons, whether to skip the popup, where card pages open, and the checkout prompt options. Saved with your browser's extension settings, which your browser may sync to your other devices if you use browser sync.
- **Saved card pages:** the links to card pages you chose to save, and the names you gave them. Kept only on this device, never synced. Delete them one at a time in Settings, or all at once with **Forget my cards**.
- **Where each bank's button lands:** the card page a bank opens when you use its main CardHop button (Capital One adds your default card to the address), so CardHop doesn't offer to save a page that button already opens. Kept only on this device, never synced, replaced each time you use the button, and removed by **Forget my cards**.
- **Sites where you turned off the checkout prompt:** kept only on this device, never synced.
- **The tab CardHop opened:** while you sign in to Capital One, CardHop remembers which tab it opened for up to 10 minutes, so it can send that tab back to your virtual cards. This is cleared when the browser closes.

## What CardHop never does

- It never reads, stores, or fills card numbers.
- It never reads page content or what you type.
- It never sends anything to the developer or to anyone else. There are no analytics, ads, or tracking.
- It never sells or shares data, because it has none.

## Optional permissions

CardHop has no access to any website unless you turn on one of these settings. Turning a setting off gives the permission back.

- **Return after sign-in** (Capital One): lets CardHop see page addresses on `myaccounts.capitalone.com`, so it can send the tab it opened back to your virtual cards after you sign in. It reads no page content.
- **Offer CardHop at checkout**: lets CardHop run on the pages you visit so it can notice when a credit card field gets focus and show a small prompt. To decide whether a field is a card field, it checks only field attributes such as `type`, `autocomplete`, `name`, `id`, `placeholder`, and `aria-label`, never what you type. Browsers describe this access as "read and change all your data on all websites". While it's on, the browser also tells CardHop the address of each tab; CardHop ignores these except on Capital One and Citi pages, and never stores or sends them.

## Questions

Open an issue at https://github.com/webdevnerdstuff/cardhop-extension/issues.

Capital One® and Eno® are registered trademarks of Capital One Financial Corp. Citi® is a registered trademark of Citigroup Inc. CardHop is independent and is not affiliated with, sponsored by, or endorsed by Capital One or Citi.
