import { ext } from './ext.ts';
import { BANKS, isBankId, signInReturnFor } from './shared.ts';
import type { BankId, SignInReturn } from './shared.ts';

// Long enough to sign in, including two-step verification.
export const TRACK_FOR_MS = 10 * 60 * 1000;

// How long after coming back from sign-in CardHop keeps watching for the landing page.
export const SETTLE_MS = 60 * 1000;

const KEY_PREFIX = 'signInReturn:';

interface TrackedTab {
	bankId: BankId;
	// The page CardHop opened: the bank's general virtual cards page or a saved card page.
	url?: string;
	// Set once the tab goes somewhere CardHop can't see, which is where sign-in happens.
	leftSite: boolean;
	expiresAt: number;
	// When the tab first came back to the bank's site after sign-in.
	returnedAt?: number;
}

// Tabs being redirected right now, so simultaneous tab events can't send a second redirect.
const pendingRedirects = new Set<number>();

function keyFor(tabId: number): string {
	return `${KEY_PREFIX}${tabId}`;
}

function permissionFor(rule: SignInReturn): chrome.permissions.Permissions {
	return { origins: [rule.origin] };
}

function isOnSite(url: string, rule: SignInReturn): boolean {
	return new URL(url).origin === new URL(rule.destinationPrefix).origin;
}

function isLandingPage(url: string, rule: SignInReturn): boolean {
	return isOnSite(url, rule) && rule.landingPaths.includes(new URL(url).pathname);
}

function isTrackedTab(value: unknown): value is TrackedTab {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const tracked = value as Record<string, unknown>;
	return isBankId(tracked.bankId)
		&& typeof tracked.leftSite === 'boolean'
		&& typeof tracked.expiresAt === 'number'
		&& (tracked.returnedAt === undefined || typeof tracked.returnedAt === 'number')
		&& (tracked.url === undefined || typeof tracked.url === 'string');
}

// True when the tab is on the page CardHop was asked to open. Any virtual cards page counts for the
// bank's general page; a saved card page must match its path and every parameter in the saved link
// (which is how the bank says which card), even if the bank adds parameters of its own.
function hasReachedTarget(tabUrl: string, target: string, bankId: BankId, rule: SignInReturn): boolean {
	if (target === BANKS[bankId].url) {
		return tabUrl.startsWith(rule.destinationPrefix);
	}
	const current = new URL(tabUrl);
	const wanted = new URL(target);
	return current.origin === wanted.origin
		&& current.pathname === wanted.pathname
		&& [...wanted.searchParams].every(([key, value]) => current.searchParams.getAll(key).includes(value));
}

export async function isEnabled(bankId: BankId): Promise<boolean> {
	const rule = signInReturnFor(bankId);
	return rule ? ext.permissions.contains(permissionFor(rule)) : false;
}

// Must be called straight from a click handler: browsers only show permission prompts for user actions.
export async function enable(bankId: BankId): Promise<boolean> {
	const rule = signInReturnFor(bankId);
	return rule ? ext.permissions.request(permissionFor(rule)) : false;
}

export async function disable(bankId: BankId): Promise<void> {
	const rule = signInReturnFor(bankId);
	if (rule) {
		await ext.permissions.remove(permissionFor(rule));
	}
}

// Session storage keeps this across background restarts while the user signs in.
export async function trackTab(
	tabId: number,
	bankId: BankId,
	{ url = BANKS[bankId].url, now = Date.now() }: { url?: string; now?: number } = {},
): Promise<void> {
	if (!(await isEnabled(bankId))) {
		return;
	}
	const tracked: TrackedTab = { bankId, url, leftSite: false, expiresAt: now + TRACK_FOR_MS };
	await ext.storage.session.set({ [keyFor(tabId)]: tracked });
}

export async function forgetTab(tabId: number): Promise<void> {
	await ext.storage.session.remove(keyFor(tabId));
}

async function saveTracked(tabId: number, tracked: TrackedTab): Promise<void> {
	await ext.storage.session.set({ [keyFor(tabId)]: tracked });
}

async function getTracked(tabId: number): Promise<TrackedTab | undefined> {
	const key = keyFor(tabId);
	const stored = await ext.storage.session.get(key);
	const tracked = stored[key];
	return isTrackedTab(tracked) ? tracked : undefined;
}

// Called for every tab update. Without the "tabs" permission the browser only reveals a tab's
// address on sites CardHop has host permission for, so the bank's sign-in page shows up as no address.
export async function handleTabUpdated(
	tabId: number,
	changeInfo: { status?: string },
	tab: { url?: string },
	now = Date.now(),
): Promise<void> {
	const tracked = await getTracked(tabId);
	// With checkout access (<all_urls>) every tab's address arrives here; only the tab CardHop opened matters.
	if (!tracked) {
		return;
	}

	const rule = signInReturnFor(tracked.bankId);
	if (!rule || now > tracked.expiresAt) {
		await forgetTab(tabId);
		return;
	}

	// A brand-new tab briefly reports a blank address before the bank's page starts loading.
	if (tab.url === '' || tab.url === 'about:blank') {
		return;
	}

	if (tab.url === undefined || !isOnSite(tab.url, rule)) {
		if (!tracked.leftSite) {
			await saveTracked(tabId, { ...tracked, leftSite: true });
		}
		return;
	}

	// Without a sign-in detour the user was already signed in, so never redirect.
	if (!tracked.leftSite) {
		return;
	}

	const returnedAt = tracked.returnedAt ?? now;
	if (now - returnedAt > SETTLE_MS) {
		await forgetTab(tabId);
		return;
	}
	// Sign-in brought the tab to the page CardHop opened: job done. Stop watching so later visits
	// to other pages (such as clicking to account summary) are left alone.
	const target = tracked.url ?? BANKS[tracked.bankId].url;
	if (hasReachedTarget(tab.url, target, tracked.bankId, rule)) {
		await forgetTab(tabId);
		return;
	}

	// For a saved card, the bank may show a different card's virtual cards page after sign-in.
	// That page has finished signing in too, so treat it like the landing page.
	const onOtherCard = tab.url.startsWith(rule.destinationPrefix);

	if (tracked.returnedAt === undefined) {
		await saveTracked(tabId, { ...tracked, returnedAt });
	}

	// Pages before the landing page (such as /welcome) are still signing the user in: never interrupt them.
	// Reaching the landing page means sign-in has finished, so leave as soon as it starts showing.
	if (!(isLandingPage(tab.url, rule) || onOtherCard) || changeInfo.status === 'loading' || pendingRedirects.has(tabId)) {
		return;
	}

	pendingRedirects.add(tabId);
	try {
		await forgetTab(tabId);
		await ext.tabs.update(tabId, { url: target });
	} catch {
		// The tab was closed or replaced before the redirect; there is nothing left to send back.
	} finally {
		pendingRedirects.delete(tabId);
	}
}
