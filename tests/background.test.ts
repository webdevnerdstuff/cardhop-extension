import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { callArgs, createChromeMock, flush } from './helpers/chrome-mock.ts';
import type { MockEvent } from './helpers/chrome-mock.ts';

const chromeMock = createChromeMock();
chromeMock.install();
const { api } = chromeMock;

// Importing registers the background script's listeners on the mock.
await import('../src/background.ts');
const { BANKS } = await import('../src/shared.ts');
const { SAVE_BADGE_TEXT } = await import('../src/badge.ts');
const { addSavedCard, BANK_LANDINGS_KEY, getBankLandings, SAVED_CARDS_KEY } = await import('../src/saved-cards.ts');

const SECOND_CARD = 'https://myaccounts.capitalone.com/vc/virtual-cards/home?arid=abc';

beforeEach(() => chromeMock.reset());

async function fire<Args extends unknown[]>(event: MockEvent<Args>, ...args: Args): Promise<void> {
	await event.dispatch(...args);
	await flush();
}

describe('on install', () => {
	it('adds no context menu entries before a bank is chosen', async () => {
		await fire(api.runtime.onInstalled, { reason: 'install' });

		assert.equal(api.contextMenus.removeAll.mock.callCount(), 1);
		assert.equal(api.contextMenus.create.mock.callCount(), 0);
	});

	it('adds a context menu entry for the selected bank', async () => {
		chromeMock.setStored({ banks: ['capitalOne'] });
		await fire(api.runtime.onInstalled, { reason: 'update' });

		assert.deepEqual(callArgs(api.contextMenus.create), [[{
			id: 'open-capitalOne',
			title: 'Open Capital One Virtual Cards',
			contexts: ['action', 'page', 'editable'],
		}]]);
	});

	it('adds one context menu entry per selected bank', async () => {
		chromeMock.setStored({ banks: ['capitalOne', 'citi'] });
		await fire(api.runtime.onInstalled, { reason: 'update' });

		const titles = callArgs(api.contextMenus.create).map(([item]) => item.title);
		assert.deepEqual(titles, ['Open Capital One Virtual Cards', 'Open Citi Virtual Cards']);
	});

	it('clears old menu entries before adding new ones', async () => {
		chromeMock.setStored({ banks: ['capitalOne'] });
		const order: string[] = [];
		api.contextMenus.removeAll.mock.mockImplementationOnce(async () => {
			order.push('removeAll');
		});
		api.contextMenus.create.mock.mockImplementationOnce(() => {
			order.push('create');
			return '';
		});

		await fire(api.runtime.onInstalled, { reason: 'update' });
		assert.deepEqual(order, ['removeAll', 'create']);
	});

	it('keeps the popup by default', async () => {
		await fire(api.runtime.onInstalled, { reason: 'install' });
		assert.deepEqual(callArgs(api.action.setPopup), [[{ popup: 'popup/popup.html' }]]);
	});

	it('skips the popup when enabled with one bank', async () => {
		chromeMock.setStored({ openDirectly: true, banks: ['capitalOne'] });
		await fire(api.runtime.onInstalled, { reason: 'update' });
		assert.deepEqual(callArgs(api.action.setPopup), [[{ popup: '' }]]);
	});

	it('keeps the popup when enabled with two banks', async () => {
		chromeMock.setStored({ openDirectly: true, banks: ['capitalOne', 'citi'] });
		await fire(api.runtime.onInstalled, { reason: 'update' });
		assert.deepEqual(callArgs(api.action.setPopup), [[{ popup: 'popup/popup.html' }]]);
	});

	it('keeps the popup when enabled with no bank chosen', async () => {
		chromeMock.setStored({ openDirectly: true, banks: [] });
		await fire(api.runtime.onInstalled, { reason: 'update' });
		assert.deepEqual(callArgs(api.action.setPopup), [[{ popup: 'popup/popup.html' }]]);
	});
});

describe('on browser startup', () => {
	it('re-applies the popup setting', async () => {
		chromeMock.setStored({ openDirectly: true, banks: ['citi'] });
		await fire(api.runtime.onStartup);
		assert.deepEqual(callArgs(api.action.setPopup), [[{ popup: '' }]]);
	});
});

describe('checkout access', () => {
	it('registers the script on install when access is granted', async () => {
		chromeMock.grant('<all_urls>');
		await fire(api.runtime.onInstalled, { reason: 'update' });
		assert.deepEqual(chromeMock.registeredScripts().map((script) => script.id), ['cardhop-checkout']);
	});

	it('replaces an existing registration on install and update, so changed settings reach existing users', async () => {
		for (const reason of ['update', 'install']) {
			chromeMock.reset();
			chromeMock.grant('<all_urls>');
			chromeMock.setRegisteredScripts([{ id: 'cardhop-checkout', js: ['old/content.js'], matches: ['<all_urls>'] }]);
			await fire(api.runtime.onInstalled, { reason });
			assert.deepEqual(chromeMock.registeredScripts(), [{
				id: 'cardhop-checkout',
				js: ['checkout/content.js'],
				matches: ['<all_urls>'],
				excludeMatches: ['https://*.capitalone.com/*', 'https://*.citi.com/*'],
				allFrames: true,
				runAt: 'document_idle',
				persistAcrossSessions: true,
			}], reason);
		}
	});

	it('leaves an existing registration alone on startup', async () => {
		chromeMock.grant('<all_urls>');
		chromeMock.setRegisteredScripts([{ id: 'cardhop-checkout', js: ['checkout/content.js'] }]);
		await fire(api.runtime.onStartup);
		assert.equal(api.scripting.unregisterContentScripts.mock.callCount(), 0);
		assert.equal(api.scripting.registerContentScripts.mock.callCount(), 0);
	});

	it('syncs the script on startup', async () => {
		chromeMock.grant('<all_urls>');
		await fire(api.runtime.onStartup);
		assert.deepEqual(chromeMock.registeredScripts().map((script) => script.id), ['cardhop-checkout']);

		chromeMock.reset();
		chromeMock.setRegisteredScripts([{ id: 'cardhop-checkout' }]);
		await fire(api.runtime.onStartup);
		assert.deepEqual(chromeMock.registeredScripts(), []);
	});

	it('registers the script when access is added', async () => {
		chromeMock.grant('<all_urls>');
		await fire(api.permissions.onAdded, { origins: ['<all_urls>'] });
		assert.equal(chromeMock.registeredScripts().length, 1);
	});

	it('unregisters the script when access is removed', async () => {
		chromeMock.setRegisteredScripts([{ id: 'cardhop-checkout' }]);
		await fire(api.permissions.onRemoved, { origins: ['<all_urls>'] });
		assert.deepEqual(chromeMock.registeredScripts(), []);
	});
});

describe('checkout prompt messages', () => {
	const frameMessage = { type: 'checkoutFrame', event: 'focus' };

	it('relays a frame message to the top frame of its tab', async () => {
		await fire(api.runtime.onMessage, frameMessage, { tab: { id: 9 }, frameId: 3 });
		assert.deepEqual(callArgs(api.tabs.sendMessage), [[9, frameMessage, { frameId: 0 }]]);
	});

	it('does not relay a message from the top frame', async () => {
		await fire(api.runtime.onMessage, frameMessage, { tab: { id: 9 }, frameId: 0 });
		assert.equal(api.tabs.sendMessage.mock.callCount(), 0);
	});

	it('does not relay a message without a tab', async () => {
		await fire(api.runtime.onMessage, frameMessage, { frameId: 3 });
		assert.equal(api.tabs.sendMessage.mock.callCount(), 0);
	});

	it('answers a buttons request and keeps the channel open', async () => {
		chromeMock.setStored({ banks: ['capitalOne', 'citi'] });
		const responses: unknown[] = [];
		const [returned] = await api.runtime.onMessage.dispatch({ type: 'checkoutButtons' }, { tab: { id: 9 }, frameId: 0 }, (response) => {
			responses.push(response);
		});
		assert.equal(returned, true);
		await flush();
		assert.deepEqual(responses, [[
			{ label: 'Capital One Virtual Cards', bankId: 'capitalOne', bankName: 'Capital One' },
			{ label: 'Citi Virtual Cards', bankId: 'citi', bankName: 'Citi' },
		]]);
	});

	it('answers a buttons request with no buttons when storage fails', async () => {
		api.storage.sync.get.mock.mockImplementationOnce(async () => {
			throw new Error('storage unavailable');
		});
		const responses: unknown[] = [];
		await api.runtime.onMessage.dispatch({ type: 'checkoutButtons' }, { tab: { id: 9 }, frameId: 0 }, (response) => {
			responses.push(response);
		});
		await flush();
		assert.deepEqual(responses, [[]]);
	});

	it('returns nothing for other messages', async () => {
		const [popup] = await api.runtime.onMessage.dispatch({ type: 'openBank', bankId: 'citi' });
		const [frame] = await api.runtime.onMessage.dispatch(frameMessage, { tab: { id: 9 }, frameId: 3 });
		const [options] = await api.runtime.onMessage.dispatch({ type: 'openOptions' });
		assert.equal(popup, undefined);
		assert.equal(frame, undefined);
		assert.equal(options, undefined);
		await flush();
	});

	it('opens a new tab for newTab requests even when set to the current tab', async () => {
		chromeMock.setStored({ openIn: 'currentTab' });
		await fire(api.runtime.onMessage, { type: 'openBank', bankId: 'citi', newTab: true }, { tab: { id: 9 }, frameId: 0 });
		assert.deepEqual(callArgs(api.tabs.create), [[{ url: BANKS.citi.url }]]);
		assert.equal(api.tabs.update.mock.callCount(), 0);
	});

	it('opens the settings page on request', async () => {
		await fire(api.runtime.onMessage, { type: 'openOptions' });
		assert.equal(api.runtime.openOptionsPage.mock.callCount(), 1);
	});
});

describe('when settings change', () => {
	it('rebuilds menus and the popup mode when banks change', async () => {
		chromeMock.setStored({ banks: ['capitalOne', 'citi'], openDirectly: true });
		await fire(api.storage.onChanged, { banks: { newValue: ['capitalOne', 'citi'] } }, 'sync');

		assert.equal(api.contextMenus.create.mock.callCount(), 2);
		assert.deepEqual(callArgs(api.action.setPopup), [[{ popup: 'popup/popup.html' }]]);
	});

	it('updates only the popup mode when "skip this popup" changes', async () => {
		chromeMock.setStored({ openDirectly: true, banks: ['capitalOne'] });
		await fire(api.storage.onChanged, { openDirectly: { newValue: true } }, 'sync');

		assert.equal(api.contextMenus.removeAll.mock.callCount(), 0);
		assert.deepEqual(callArgs(api.action.setPopup), [[{ popup: '' }]]);
	});

	it('ignores changes that need no update', async () => {
		await fire(api.storage.onChanged, { openIn: { newValue: 'currentTab' } }, 'sync');

		assert.equal(api.contextMenus.removeAll.mock.callCount(), 0);
		assert.equal(api.action.setPopup.mock.callCount(), 0);
	});

	it('ignores storage areas other than sync', async () => {
		await fire(api.storage.onChanged, { banks: { newValue: ['citi'] } }, 'local');

		assert.equal(api.contextMenus.removeAll.mock.callCount(), 0);
		assert.equal(api.action.setPopup.mock.callCount(), 0);
	});
});

describe('toolbar icon click (popup skipped)', () => {
	it('opens the selected bank', async () => {
		chromeMock.setStored({ banks: ['citi'] });
		await fire(api.action.onClicked, { id: 3 });
		assert.deepEqual(callArgs(api.tabs.create), [[{ url: BANKS.citi.url }]]);
	});

	it('replaces the clicked tab when set to open in the current tab', async () => {
		chromeMock.setStored({ banks: ['capitalOne'], openIn: 'currentTab' });
		await fire(api.action.onClicked, { id: 3 });
		assert.deepEqual(callArgs(api.tabs.update), [[3, { url: BANKS.capitalOne.url }]]);
	});

	it('does nothing when no bank is chosen', async () => {
		await fire(api.action.onClicked, { id: 3 });
		assert.equal(api.tabs.create.mock.callCount(), 0);
		assert.equal(api.tabs.update.mock.callCount(), 0);
	});
});

describe('context menu click', () => {
	it('opens the bank whose entry was clicked', async () => {
		chromeMock.setStored({ banks: ['capitalOne', 'citi'] });
		await fire(api.contextMenus.onClicked, { menuItemId: 'open-citi' }, { id: 9 });
		assert.deepEqual(callArgs(api.tabs.create), [[{ url: BANKS.citi.url }]]);
	});

	it('ignores menu ids it does not own', async () => {
		await fire(api.contextMenus.onClicked, { menuItemId: 'something-else' }, { id: 9 });
		assert.equal(api.tabs.create.mock.callCount(), 0);
		assert.equal(api.tabs.update.mock.callCount(), 0);
	});

	it('works without a tab, such as on the toolbar icon menu', async () => {
		chromeMock.setStored({ openIn: 'currentTab' });
		await fire(api.contextMenus.onClicked, { menuItemId: 'open-capitalOne' });
		assert.deepEqual(callArgs(api.tabs.update), [[{ url: BANKS.capitalOne.url }]]);
	});
});

describe('open requests from the popup', () => {
	it('opens the requested bank', async () => {
		await fire(api.runtime.onMessage, { type: 'openBank', bankId: 'citi' });
		assert.deepEqual(callArgs(api.tabs.create), [[{ url: BANKS.citi.url }]]);
	});

	// Regression: the popup used to open the tab itself and was closed before it could start watching.
	it('starts watching the new tab for a sign-in detour', async () => {
		chromeMock.grant('https://myaccounts.capitalone.com/*');
		await fire(api.runtime.onMessage, { type: 'openBank', bankId: 'capitalOne' });
		assert.deepEqual(Object.keys(chromeMock.getSession()), ['signInReturn:101', 'bankLanding:101']);
	});

	it('ignores other messages', async () => {
		await fire(api.runtime.onMessage, { type: 'openBank', bankId: 'chase' });
		await fire(api.runtime.onMessage, 'openBank');
		await fire(api.runtime.onMessage, null);
		assert.equal(api.tabs.create.mock.callCount(), 0);
	});
});

describe('return after sign-in', () => {
	it('sends a watched tab to virtual cards once sign-in lands on account summary', async () => {
		const accountSummary = 'https://myaccounts.capitalone.com/accountSummary';
		chromeMock.grant('https://myaccounts.capitalone.com/*');
		chromeMock.setStored({ banks: ['capitalOne'] });
		await fire(api.contextMenus.onClicked, { menuItemId: 'open-capitalOne' });
		const tabId = 101;

		await fire(api.tabs.onUpdated, tabId, { status: 'complete' }, {});
		await fire(api.tabs.onUpdated, tabId, { status: 'complete' }, { url: accountSummary });

		assert.deepEqual(callArgs(api.tabs.update), [[tabId, { url: BANKS.capitalOne.url }]]);
	});

	it('forgets a watched tab when it is closed', async () => {
		chromeMock.grant('https://myaccounts.capitalone.com/*');
		await fire(api.contextMenus.onClicked, { menuItemId: 'open-capitalOne' });
		assert.notDeepEqual(chromeMock.getSession(), {});

		await fire(api.tabs.onRemoved, 101);
		assert.deepEqual(chromeMock.getSession(), {});
	});
});

describe('saved card pages', () => {
	it('adds a menu entry for each saved card after its bank', async () => {
		chromeMock.setStored({ banks: ['capitalOne', 'citi'] });
		await addSavedCard(SECOND_CARD, 'Venture X');
		await fire(api.runtime.onInstalled, { reason: 'update' });

		const titles = callArgs(api.contextMenus.create).map(([item]) => item.title);
		assert.deepEqual(titles, ['Open Capital One Virtual Cards', 'Open Venture X', 'Open Citi Virtual Cards']);
	});

	it('hides saved cards of banks that are not selected', async () => {
		chromeMock.setStored({ banks: ['citi'] });
		await addSavedCard(SECOND_CARD, 'Venture X');
		await fire(api.runtime.onInstalled, { reason: 'update' });

		const titles = callArgs(api.contextMenus.create).map(([item]) => item.title);
		assert.deepEqual(titles, ['Open Citi Virtual Cards']);
	});

	it('opens a saved card from its menu entry', async () => {
		const card = await addSavedCard(SECOND_CARD, 'Venture X');
		await fire(api.contextMenus.onClicked, { menuItemId: `open-card-${card.id}` }, { id: 9 });
		assert.deepEqual(callArgs(api.tabs.create), [[{ url: SECOND_CARD }]]);
	});

	it('opens a saved card requested by the popup', async () => {
		const card = await addSavedCard(SECOND_CARD, 'Venture X');
		await fire(api.runtime.onMessage, { type: 'openBank', bankId: 'capitalOne', cardId: card.id });
		assert.deepEqual(callArgs(api.tabs.create), [[{ url: SECOND_CARD }]]);
	});

	it('rebuilds menus and the popup mode when saved cards change', async () => {
		chromeMock.setStored({ banks: ['capitalOne'], openDirectly: true });
		await addSavedCard(SECOND_CARD, 'Venture X');
		await fire(api.storage.onChanged, { [SAVED_CARDS_KEY]: { newValue: [] } }, 'local');

		assert.equal(api.contextMenus.create.mock.callCount(), 2);
		assert.deepEqual(callArgs(api.action.setPopup), [[{ popup: 'popup/popup.html' }]], 'keeps the popup so cards can be chosen');
	});
});

describe('custom names and the save badge', () => {
	it('uses a renamed default button in the menu', async () => {
		chromeMock.setStored({ banks: ['capitalOne'], bankLabels: { capitalOne: 'Quicksilver' } });
		await fire(api.runtime.onInstalled, { reason: 'update' });
		assert.deepEqual(callArgs(api.contextMenus.create).map(([item]) => item.title), ['Open Quicksilver']);
	});

	it('rebuilds menus when a default button is renamed', async () => {
		chromeMock.setStored({ banks: ['capitalOne'] });
		await fire(api.storage.onChanged, { bankLabels: { newValue: { capitalOne: 'Quicksilver' } } }, 'sync');
		assert.equal(api.contextMenus.removeAll.mock.callCount(), 1);
	});

	it('updates the badge when a tab finishes loading', async () => {
		chromeMock.setStored({ banks: ['capitalOne'] });
		await fire(api.tabs.onUpdated, 4, { status: 'complete' }, { url: SECOND_CARD });
		assert.deepEqual(callArgs(api.action.setBadgeText), [[{ tabId: 4, text: SAVE_BADGE_TEXT }]]);
	});

	it('records where the bank button lands and shows no badge there', async () => {
		const landing = `${BANKS.capitalOne.url}?arid=default`;
		chromeMock.setStored({ banks: ['capitalOne'] });
		await fire(api.contextMenus.onClicked, { menuItemId: 'open-capitalOne' });
		const tabId = 101;

		await fire(api.tabs.onUpdated, tabId, { url: landing }, { url: landing });

		assert.deepEqual(await getBankLandings(), { capitalOne: landing });
		assert.deepEqual(callArgs(api.action.setBadgeText), [[{ tabId, text: '' }]]);
	});

	it('rechecks the badges when the bank button lands somewhere new', async () => {
		await fire(api.storage.onChanged, { [BANK_LANDINGS_KEY]: { newValue: {} } }, 'local');
		assert.equal(api.tabs.query.mock.callCount(), 1);
		assert.equal(api.contextMenus.removeAll.mock.callCount(), 0, 'menus are unaffected');
	});

	it('stops watching for the landing page when a saved card replaces the tab', async () => {
		chromeMock.setStored({ banks: ['capitalOne'], openIn: 'currentTab' });
		await fire(api.contextMenus.onClicked, { menuItemId: 'open-capitalOne' }, { id: 5 });
		const card = await addSavedCard(SECOND_CARD, 'Second');
		await fire(api.contextMenus.onClicked, { menuItemId: `open-card-${card.id}` }, { id: 5 });

		await fire(api.tabs.onUpdated, 5, { url: SECOND_CARD }, { url: SECOND_CARD });
		assert.deepEqual(await getBankLandings(), {});
	});
});

