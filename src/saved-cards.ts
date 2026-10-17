import { ext } from './ext.ts';
import { BANK_IDS, BANKS, cleanLabel, isBankId, MAX_LABEL_LENGTH } from './shared.ts';
import type { BankId } from './shared.ts';

// Links to specific card pages that the user saved. Kept in local storage only: never synced,
// never sent anywhere. The links identify the user's account, so they stay on this device.
export const SAVED_CARDS_KEY = 'savedCards';

export { MAX_LABEL_LENGTH };
export const MAX_URL_LENGTH = 2048;

export interface SavedCard {
	id: string;
	bankId: BankId;
	label: string;
	url: string;
}

export class CardPageError extends Error {}

// Returns the bank a link belongs to, or undefined unless it is an https card page on that bank's own site.
export function bankForCardUrl(value: string): BankId | undefined {
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH) {
		return undefined;
	}

	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return undefined;
	}

	if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
		return undefined;
	}

	return BANK_IDS.find((bankId) => {
		const prefix = new URL(BANKS[bankId].cardPagePrefix);
		return url.origin === prefix.origin && url.pathname.startsWith(prefix.pathname);
	});
}

function isSavedCard(value: unknown): value is SavedCard {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const card = value as Record<string, unknown>;
	return typeof card.id === 'string'
		&& isBankId(card.bankId)
		&& typeof card.label === 'string'
		&& typeof card.url === 'string'
		&& bankForCardUrl(card.url) === card.bankId;
}

export async function getSavedCards(): Promise<SavedCard[]> {
	const stored = await ext.storage.local.get(SAVED_CARDS_KEY);
	const cards: unknown = stored[SAVED_CARDS_KEY];
	return Array.isArray(cards) ? cards.filter(isSavedCard) : [];
}

async function saveCards(cards: SavedCard[]): Promise<void> {
	await ext.storage.local.set({ [SAVED_CARDS_KEY]: cards });
}

export async function findSavedCard(id: string): Promise<SavedCard | undefined> {
	return (await getSavedCards()).find((card) => card.id === id);
}

export function defaultLabel(bankId: BankId, cards: readonly SavedCard[]): string {
	const count = cards.filter((card) => card.bankId === bankId).length;
	return `${BANKS[bankId].name} card ${count + 1}`;
}

export function isSaved(url: string, cards: readonly SavedCard[]): boolean {
	const bankId = bankForCardUrl(url);
	return bankId !== undefined && cards.some((card) => card.url === new URL(url.trim()).href);
}

export async function addSavedCard(url: string, label: string): Promise<SavedCard> {
	const bankId = bankForCardUrl(url);
	if (!bankId) {
		throw new CardPageError('That isn’t a virtual card page on Capital One’s or Citi’s site.');
	}

	const href = new URL(url.trim()).href;
	const cards = await getSavedCards();
	if (cards.some((card) => card.url === href)) {
		throw new CardPageError('That card page is already saved.');
	}

	const card: SavedCard = {
		id: crypto.randomUUID(),
		bankId,
		label: cleanLabel(label) || defaultLabel(bankId, cards),
		url: href,
	};
	await saveCards([...cards, card]);
	return card;
}

// A blank name keeps the current one, so a slip can't leave a card without a label.
export async function renameSavedCard(id: string, label: string): Promise<void> {
	const name = cleanLabel(label);
	if (name === '') {
		return;
	}
	const cards = await getSavedCards();
	await saveCards(cards.map((card) => (card.id === id ? { ...card, label: name } : card)));
}

export async function removeSavedCard(id: string): Promise<void> {
	const cards = await getSavedCards();
	await saveCards(cards.filter((card) => card.id !== id));
}

export async function forgetAllCards(): Promise<void> {
	await ext.storage.local.remove([SAVED_CARDS_KEY, BANK_LANDINGS_KEY]);
}

// Where each bank's button last landed. Capital One adds the default card to its general page's address,
// which then looks like any card page, but the bank button already opens it, so CardHop doesn't offer to
// save it. Kept on this device only, like saved card pages.
export const BANK_LANDINGS_KEY = 'bankLandings';

export type BankLandings = Partial<Record<BankId, string>>;

export async function getBankLandings(): Promise<BankLandings> {
	const stored = await ext.storage.local.get(BANK_LANDINGS_KEY);
	const landings: unknown = stored[BANK_LANDINGS_KEY];
	if (typeof landings !== 'object' || landings === null) {
		return {};
	}
	return Object.fromEntries(Object.entries(landings).filter(([bankId, url]) => (
		isBankId(bankId) && typeof url === 'string' && bankForCardUrl(url) === bankId
	)));
}

export async function setBankLanding(bankId: BankId, url: string): Promise<void> {
	const href = new URL(url.trim()).href;
	const landings = await getBankLandings();
	if (landings[bankId] !== href) {
		await ext.storage.local.set({ [BANK_LANDINGS_KEY]: { ...landings, [bankId]: href } });
	}
}

// True for the pages a bank's own button opens: its general virtual cards page, or where that last landed.
export function isBankPage(url: string, landings: BankLandings): boolean {
	const bankId = bankForCardUrl(url);
	if (bankId === undefined) {
		return false;
	}
	const href = new URL(url.trim()).href;
	return href === new URL(BANKS[bankId].url).href || href === landings[bankId];
}
