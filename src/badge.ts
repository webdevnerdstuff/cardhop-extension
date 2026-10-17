import { ext } from './ext.ts';
import { bankForCardUrl, getSavedCards, isSaved } from './saved-cards.ts';
import { getSettings } from './shared.ts';

export const SAVE_BADGE_TEXT = '+';
export const SAVE_BADGE_TITLE = 'CardHop: save this card page';
const BADGE_COLOR = '#0b3b60';

// Shows a "+" on the toolbar icon while a tab is on a card page CardHop could save. The browser only
// reveals addresses on sites CardHop has permission for, so other tabs report no address and get no badge.
export async function updateSaveBadge(tabId: number, url: string | undefined): Promise<void> {
	const bankId = url === undefined ? undefined : bankForCardUrl(url);
	let offer = false;
	if (bankId !== undefined && url !== undefined) {
		const [{ banks }, cards] = await Promise.all([getSettings(), getSavedCards()]);
		offer = banks.includes(bankId) && !isSaved(url, cards);
	}

	await ext.action.setBadgeText({ tabId, text: offer ? SAVE_BADGE_TEXT : '' });
	if (offer) {
		await ext.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR });
	}
	// An empty tab title falls back to the extension's default title.
	await ext.action.setTitle({ tabId, title: offer ? SAVE_BADGE_TITLE : '' });
}

// After saving or deleting a card, or changing banks, recheck every tab CardHop can see.
export async function refreshSaveBadges(): Promise<void> {
	const tabs = await ext.tabs.query({});
	await Promise.all(tabs
		.filter((tab) => tab.id !== undefined)
		.map((tab) => updateSaveBadge(tab.id as number, tab.url)));
}
