// Firefox exposes its promise-based extension APIs as `browser`; Chromium browsers use `chrome`
// (newer Chrome versions also alias `browser`). Everything CardHop calls has the same shape in both,
// so the rest of the code uses `ext`.
const globals = globalThis as { browser?: typeof chrome };

export const ext: typeof chrome = globals.browser ?? chrome;
