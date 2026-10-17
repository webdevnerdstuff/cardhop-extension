import { refreshSaveBadges, updateSaveBadge } from './badge.ts';
import { forgetBankLanding, handleBankLandingUpdate } from './bank-landing.ts';
import { syncCheckoutScript } from './checkout-access.ts';
import { buildCheckoutButtons, isCheckoutButtonsRequest, isCheckoutFrameMessage, isOpenOptionsRequest } from './checkout-messages.ts';
import { ext } from './ext.ts';
import { isOpenBankMessage, openSavedCard, openVirtualCards } from './open.ts';
import { BANK_LANDINGS_KEY, getSavedCards, SAVED_CARDS_KEY } from './saved-cards.ts';
import { applyActionMode, BANK_IDS, bankLabel, canOpenDirectly, cardMenuId, getSettings, menuId } from './shared.ts';
import { forgetTab, handleTabUpdated } from './sign-in-return.ts';

const MENU_CONTEXTS: chrome.contextMenus.CreateProperties['contexts'] = ['action', 'page', 'editable'];

async function syncActionMode(): Promise<void> {
	await applyActionMode(canOpenDirectly(await getSettings(), await getSavedCards()));
}

// One entry per selected bank, followed by that bank's saved card pages.
async function syncMenus(): Promise<void> {
	const settings = await getSettings();
	const cards = await getSavedCards();
	await ext.contextMenus.removeAll();
	settings.banks.forEach((bankId) => {
		ext.contextMenus.create({
			id: menuId(bankId),
			title: `Open ${bankLabel(bankId, settings)}`,
			contexts: MENU_CONTEXTS,
		});
		cards.filter((card) => card.bankId === bankId).forEach((card) => {
			ext.contextMenus.create({
				id: cardMenuId(card.id),
				title: `Open ${card.label}`,
				contexts: MENU_CONTEXTS,
			});
		});
	});
}

ext.runtime.onInstalled.addListener(() => {
	void syncMenus();
	void syncActionMode();
	void syncCheckoutScript({ refresh: true });
});

ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (isOpenBankMessage(message)) {
		const options = { newTab: message.newTab === true };
		void (message.cardId === undefined ? openVirtualCards(message.bankId, undefined, options) : openSavedCard(message.cardId, undefined, options));
		return undefined;
	}

	// A card field in an iframe can't reach the top frame directly, so its events are relayed there.
	if (isCheckoutFrameMessage(message)) {
		if (sender.frameId !== 0 && sender.tab?.id !== undefined) {
			void ext.tabs.sendMessage(sender.tab.id, message, { frameId: 0 }).catch(() => undefined);
		}
		return undefined;
	}

	if (isCheckoutButtonsRequest(message)) {
		void (async () => {
			try {
				sendResponse(buildCheckoutButtons(await getSettings(), await getSavedCards()));
			} catch {
				// Always answer, so the prompt shows its no-buttons state instead of waiting.
				sendResponse([]);
			}
		})();
		// Keeps the channel open for the async response (works in Chrome and Firefox).
		return true;
	}

	if (isOpenOptionsRequest(message)) {
		void ext.runtime.openOptionsPage();
	}

	return undefined;
});

ext.runtime.onStartup.addListener(() => {
	void syncActionMode();
	void syncCheckoutScript();
});

// Access can change from the settings page or the browser's own extension page.
ext.permissions.onAdded.addListener(() => {
	void syncCheckoutScript();
});

ext.permissions.onRemoved.addListener(() => {
	void syncCheckoutScript();
});

ext.storage.onChanged.addListener((changes, area) => {
	const banksChanged = area === 'sync' && (changes.banks !== undefined || changes.bankLabels !== undefined);
	const cardsChanged = area === 'local' && changes[SAVED_CARDS_KEY] !== undefined;

	if (banksChanged || cardsChanged) {
		void syncMenus();
		void refreshSaveBadges();
	} else if (area === 'local' && changes[BANK_LANDINGS_KEY] !== undefined) {
		void refreshSaveBadges();
	}

	if (banksChanged || cardsChanged || (area === 'sync' && changes.openDirectly !== undefined)) {
		void syncActionMode();
	}
});

// Only fires when the popup is disabled ("open directly" mode with one bank and no saved card pages).
ext.action.onClicked.addListener(async (tab) => {
	const { banks } = await getSettings();
	const [bankId] = banks;
	if (bankId) {
		await openVirtualCards(bankId, tab.id);
	}
});

ext.contextMenus.onClicked.addListener(async (info, tab) => {
	const bankId = BANK_IDS.find((id) => menuId(id) === info.menuItemId);
	if (bankId) {
		await openVirtualCards(bankId, tab?.id);
		return;
	}

	const card = (await getSavedCards()).find((saved) => cardMenuId(saved.id) === info.menuItemId);
	if (card) {
		await openSavedCard(card.id, tab?.id);
	}
});

// Return to the virtual cards page after a bank's sign-in drops the user on its home page.
ext.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
	void handleTabUpdated(tabId, changeInfo, tab);
	if (changeInfo.url !== undefined || changeInfo.status === 'complete') {
		// Record a bank button's landing page first, so the badge already knows to skip it.
		void handleBankLandingUpdate(tabId, tab.url)
			.catch(() => undefined)
			.then(() => updateSaveBadge(tabId, tab.url));
	}
});

ext.tabs.onRemoved.addListener((tabId) => {
	void forgetTab(tabId);
	void forgetBankLanding(tabId);
});
