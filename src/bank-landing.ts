import { ext } from './ext.ts';
import { bankForCardUrl, setBankLanding } from './saved-cards.ts';
import { BANKS, isBankId } from './shared.ts';
import type { BankId } from './shared.ts';
import { TRACK_FOR_MS } from './sign-in-return.ts';

// Long enough to sign in first, including two-step verification.
export const WATCH_FOR_MS = TRACK_FOR_MS;

const KEY_PREFIX = 'bankLanding:';

interface WatchedTab {
	bankId: BankId;
	expiresAt: number;
}

function keyFor(tabId: number): string {
	return `${KEY_PREFIX}${tabId}`;
}

function isWatchedTab(value: unknown): value is WatchedTab {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const watched = value as Record<string, unknown>;
	return isBankId(watched.bankId) && typeof watched.expiresAt === 'number';
}

async function getWatched(tabId: number): Promise<WatchedTab | undefined> {
	const key = keyFor(tabId);
	const stored = await ext.storage.session.get(key);
	const watched = stored[key];
	return isWatchedTab(watched) ? watched : undefined;
}

// Session storage keeps this across background restarts while the user signs in.
export async function watchBankLanding(tabId: number, bankId: BankId, now = Date.now()): Promise<void> {
	const watched: WatchedTab = { bankId, expiresAt: now + WATCH_FOR_MS };
	await ext.storage.session.set({ [keyFor(tabId)]: watched });
}

export async function forgetBankLanding(tabId: number): Promise<void> {
	await ext.storage.session.remove(keyFor(tabId));
}

// Records the card page a tab opened by a bank's button lands on, after any sign-in.
export async function handleBankLandingUpdate(tabId: number, url: string | undefined, now = Date.now()): Promise<void> {
	const watched = await getWatched(tabId);
	if (!watched) {
		return;
	}

	if (now > watched.expiresAt) {
		await forgetBankLanding(tabId);
		return;
	}

	// Sign-in pages are hidden from CardHop or aren't card pages: keep watching.
	if (url === undefined || bankForCardUrl(url) !== watched.bankId) {
		return;
	}
	// The bank hasn't added the card to the address yet.
	if (new URL(url).href === new URL(BANKS[watched.bankId].url).href) {
		return;
	}

	// Only the first card page counts: anything after it is the user switching cards.
	await forgetBankLanding(tabId);
	await setBankLanding(watched.bankId, url);
}
