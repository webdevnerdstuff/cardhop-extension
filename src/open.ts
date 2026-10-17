import { ext } from './ext.ts';
import { findSavedCard } from './saved-cards.ts';
import { BANKS, getSettings, isBankId, OPEN_IN } from './shared.ts';
import type { BankId } from './shared.ts';
import { trackTab } from './sign-in-return.ts';

// The popup asks the background to open a page: opening a tab moves focus, which closes the popup
// and stops its scripts before it could start watching the tab for a sign-in detour.
export interface OpenBankMessage {
	type: 'openBank';
	bankId: BankId;
	// A saved card page to open instead of the bank's general virtual cards page.
	cardId?: string;
	// Open in a new tab whatever the "Open cards in" setting says (the checkout prompt always does).
	newTab?: true;
}

export interface OpenOptions {
	newTab?: boolean;
}

export function isOpenBankMessage(value: unknown): value is OpenBankMessage {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const message = value as Record<string, unknown>;
	return message.type === 'openBank'
		&& isBankId(message.bankId)
		&& (message.cardId === undefined || typeof message.cardId === 'string')
		&& (message.newTab === undefined || message.newTab === true);
}

export async function requestOpen(bankId: BankId, cardId?: string, options: OpenOptions = {}): Promise<void> {
	const message: OpenBankMessage = {
		type: 'openBank',
		bankId,
		...(cardId === undefined ? {} : { cardId }),
		...(options.newTab === true ? { newTab: true } : {}),
	};
	await ext.runtime.sendMessage(message);
}

// tabId is the tab to replace when opening in the current tab; without it the browser uses the active tab.
async function openPage(bankId: BankId, url: string, tabId?: number, options: OpenOptions = {}): Promise<void> {
	const settings = await getSettings();
	const openIn = options.newTab === true ? OPEN_IN.newTab : settings.openIn;

	let tab: chrome.tabs.Tab | undefined;
	if (openIn === OPEN_IN.currentTab) {
		tab = await (tabId === undefined ? ext.tabs.update({ url }) : ext.tabs.update(tabId, { url }));
	} else {
		tab = await ext.tabs.create({ url });
	}

	if (tab?.id !== undefined) {
		await trackTab(tab.id, bankId, { url });
	}
}

export async function openVirtualCards(bankId: BankId, tabId?: number, options: OpenOptions = {}): Promise<void> {
	await openPage(bankId, BANKS[bankId].url, tabId, options);
}

export async function openSavedCard(cardId: string, tabId?: number, options: OpenOptions = {}): Promise<void> {
	const card = await findSavedCard(cardId);
	if (card) {
		await openPage(card.bankId, card.url, tabId, options);
	}
}
