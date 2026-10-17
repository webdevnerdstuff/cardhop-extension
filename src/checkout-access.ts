import { ext } from './ext.ts';
import { BANKS } from './shared.ts';

// The checkout prompt needs to see card fields on any site, so it asks for every site, once, on request.
export const CHECKOUT_ORIGINS = ['<all_urls>'];
export const CHECKOUT_SCRIPT_ID = 'cardhop-checkout';

// Every page on a bank's domain is left out, not only its card pages: sign-in happens on a sibling host
// (verified.capitalone.com), so the script stays off every bank page.
export function checkoutExcludeMatches(): string[] {
	const domains = Object.values(BANKS).map((bank) => new URL(bank.url).hostname.split('.').slice(-2).join('.'));
	return [...new Set(domains)].map((domain) => `https://*.${domain}/*`);
}

export async function hasCheckoutAccess(): Promise<boolean> {
	return ext.permissions.contains({ origins: CHECKOUT_ORIGINS });
}

// Must be the first await in a click handler: browsers only show the permission prompt for a user gesture.
export async function requestCheckoutAccess(): Promise<boolean> {
	return ext.permissions.request({ origins: CHECKOUT_ORIGINS });
}

// Runs one at a time so overlapping events (a grant change plus startup) can't register the script twice.
let syncing: Promise<void> = Promise.resolve();

async function syncNow(refresh: boolean): Promise<void> {
	const [registered] = await ext.scripting.getRegisteredContentScripts({ ids: [CHECKOUT_SCRIPT_ID] });

	if (await hasCheckoutAccess()) {
		// A registration persists across updates, so an update re-registers it to pick up a changed
		// script list or excludeMatches.
		if (registered && refresh) {
			await ext.scripting.unregisterContentScripts({ ids: [CHECKOUT_SCRIPT_ID] });
		}
		if (!registered || refresh) {
			await ext.scripting.registerContentScripts([{
				id: CHECKOUT_SCRIPT_ID,
				js: ['checkout/content.js'],
				matches: CHECKOUT_ORIGINS,
				excludeMatches: checkoutExcludeMatches(),
				allFrames: true,
				runAt: 'document_idle',
				persistAcrossSessions: true,
			}]);
		}
	} else if (registered) {
		await ext.scripting.unregisterContentScripts({ ids: [CHECKOUT_SCRIPT_ID] });
	}
}

// The script is registered exactly while access is granted. Safe to call at any time.
// `refresh` (on install and update) replaces an existing registration with the current one.
export function syncCheckoutScript({ refresh = false }: { refresh?: boolean } = {}): Promise<void> {
	syncing = syncing.catch(() => undefined).then(() => syncNow(refresh));
	return syncing;
}

// Only drops <all_urls>: a separately granted bank origin stays.
export async function removeCheckoutAccess(): Promise<void> {
	await ext.permissions.remove({ origins: CHECKOUT_ORIGINS });
	await syncCheckoutScript();
}
