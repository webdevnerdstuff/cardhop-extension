import { ext } from './ext.ts';
import { bankForCardUrl, getBankLandings, getSavedCards, isBankPage, isSaved } from './saved-cards.ts';
import { getSettings } from './shared.ts';

// The full-width plus is drawn in the middle of its box; a plain "+" sits off-centre in the badge.
export const SAVE_BADGE_TEXT = '\uFF0B';
export const SAVE_BADGE_TITLE = 'CardHop: save this card page';
// The brand blue.
const BADGE_COLOR = '#0b3b60';
const BADGE_TEXT_COLOR = '#ffffff';

// Shows a "+" on the toolbar icon while a tab is on a card page CardHop could save. The browser only
// reveals addresses on sites CardHop has permission for, so other tabs report no address and get no badge.
// The pages a bank's own button opens are skipped: that button already gets there.
export async function updateSaveBadge(tabId: number, url: string | undefined): Promise<void> {
	const bankId = url === undefined ? undefined : bankForCardUrl(url);
	let offer = false;
	if (bankId !== undefined && url !== undefined) {
		const [{ banks }, cards, landings] = await Promise.all([getSettings(), getSavedCards(), getBankLandings()]);
		offer = banks.includes(bankId) && !isSaved(url, cards) && !isBankPage(url, landings);
	}

	// The tab can close while settings load, and the browser then rejects with "No tab with id".
	// Nothing is left to badge, so the error is dropped.
	try {
		await ext.action.setBadgeText({ tabId, text: offer ? SAVE_BADGE_TEXT : '' });
		if (offer) {
			await ext.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR });
			await ext.action.setBadgeTextColor({ tabId, color: BADGE_TEXT_COLOR });
		}
		// An empty tab title falls back to the extension's default title.
		await ext.action.setTitle({ tabId, title: offer ? SAVE_BADGE_TITLE : '' });
	} catch {
		// The tab is gone.
	}
}

// After saving or deleting a card, or changing banks, recheck every tab CardHop can see.
export async function refreshSaveBadges(): Promise<void> {
	const tabs = await ext.tabs.query({});
	await Promise.all(tabs
		.filter((tab) => tab.id !== undefined)
		.map((tab) => updateSaveBadge(tab.id as number, tab.url)));
}
