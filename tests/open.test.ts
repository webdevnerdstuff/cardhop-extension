import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ACTIVE_TAB_ID, callArgs, createChromeMock, NEW_TAB_ID } from './helpers/chrome-mock.ts';

const chromeMock = createChromeMock();
chromeMock.install();
const { api } = chromeMock;

const { isOpenBankMessage, openSavedCard, openVirtualCards, requestOpen } = await import('../src/open.ts');
const { addSavedCard } = await import('../src/saved-cards.ts');

const SECOND_CARD = 'https://myaccounts.capitalone.com/vc/virtual-cards/home?arid=abc';
const { BANKS } = await import('../src/shared.ts');

const CAPITAL_ONE_SITE = 'https://myaccounts.capitalone.com/*';

beforeEach(() => chromeMock.reset());

// Tabs being watched for a sign-in detour (session storage also holds bank-button landing watches).
function signInWatches(): string[] {
	return Object.keys(chromeMock.getSession()).filter((key) => key.startsWith('signInReturn:'));
}

describe('openVirtualCards', () => {
	it('opens the bank in a new tab by default', async () => {
		await openVirtualCards('citi', 7);
		assert.deepEqual(callArgs(api.tabs.create), [[{ url: BANKS.citi.url }]]);
		assert.equal(api.tabs.update.mock.callCount(), 0);
	});

	it('replaces the given tab when set to open in the current tab', async () => {
		chromeMock.setStored({ openIn: 'currentTab' });
		await openVirtualCards('capitalOne', 42);
		assert.deepEqual(callArgs(api.tabs.update), [[42, { url: BANKS.capitalOne.url }]]);
		assert.equal(api.tabs.create.mock.callCount(), 0);
	});

	it('replaces the active tab when no tab id is given', async () => {
		chromeMock.setStored({ openIn: 'currentTab' });
		await openVirtualCards('capitalOne');
		assert.deepEqual(callArgs(api.tabs.update), [[{ url: BANKS.capitalOne.url }]]);
	});
});

describe('newTab option', () => {
	it('opens in a new tab even when set to open in the current tab', async () => {
		chromeMock.setStored({ openIn: 'currentTab' });
		await openVirtualCards('capitalOne', 55, { newTab: true });
		assert.deepEqual(callArgs(api.tabs.create), [[{ url: BANKS.capitalOne.url }]]);
		assert.equal(api.tabs.update.mock.callCount(), 0);
	});

	it('opens a saved card in a new tab even when set to open in the current tab', async () => {
		chromeMock.setStored({ openIn: 'currentTab' });
		const card = await addSavedCard(SECOND_CARD, 'Second');
		await openSavedCard(card.id, 55, { newTab: true });
		assert.deepEqual(callArgs(api.tabs.create), [[{ url: SECOND_CARD }]]);
		assert.equal(api.tabs.update.mock.callCount(), 0);
	});

	it('requestOpen sends newTab only when asked', async () => {
		await requestOpen('citi', undefined, { newTab: true });
		await requestOpen('citi', 'card-1', { newTab: false });
		assert.deepEqual(callArgs(api.runtime.sendMessage), [
			[{ type: 'openBank', bankId: 'citi', newTab: true }],
			[{ type: 'openBank', bankId: 'citi', cardId: 'card-1' }],
		]);
	});

	it('isOpenBankMessage accepts newTab true or absent only', () => {
		assert.equal(isOpenBankMessage({ type: 'openBank', bankId: 'citi', newTab: true }), true);
		assert.equal(isOpenBankMessage({ type: 'openBank', bankId: 'citi', newTab: undefined }), true);
		assert.equal(isOpenBankMessage({ type: 'openBank', bankId: 'citi', newTab: false }), false);
		assert.equal(isOpenBankMessage({ type: 'openBank', bankId: 'citi', newTab: 'yes' }), false);
	});
});

describe('watching for a sign-in detour', () => {
	it('watches the new tab when return-after-sign-in is enabled', async () => {
		chromeMock.grant(CAPITAL_ONE_SITE);
		await openVirtualCards('capitalOne');
		assert.deepEqual(signInWatches(), [`signInReturn:${NEW_TAB_ID}`]);
	});

	it('watches the replaced tab when opening in the current tab', async () => {
		chromeMock.grant(CAPITAL_ONE_SITE);
		chromeMock.setStored({ openIn: 'currentTab' });
		await openVirtualCards('capitalOne');
		assert.deepEqual(signInWatches(), [`signInReturn:${ACTIVE_TAB_ID}`]);
	});

	it('watches nothing when the permission has not been granted', async () => {
		await openVirtualCards('capitalOne');
		assert.deepEqual(signInWatches(), []);
	});

	it('watches nothing for banks that don’t need it', async () => {
		chromeMock.grant(CAPITAL_ONE_SITE);
		await openVirtualCards('citi');
		assert.deepEqual(signInWatches(), []);
	});
});

describe('watching where the bank button lands', () => {
	it('watches the tab the bank button opens', async () => {
		await openVirtualCards('citi');
		assert.deepEqual(Object.keys(chromeMock.getSession()), [`bankLanding:${NEW_TAB_ID}`]);
	});

	it('does not watch a saved card page', async () => {
		const card = await addSavedCard(SECOND_CARD, 'Second');
		await openSavedCard(card.id);
		assert.deepEqual(chromeMock.getSession(), {});
	});
});

describe('requestOpen', () => {
	it('sends an openBank message to the background', async () => {
		await requestOpen('capitalOne');
		assert.deepEqual(callArgs(api.runtime.sendMessage), [[{ type: 'openBank', bankId: 'capitalOne' }]]);
		assert.equal(api.tabs.create.mock.callCount(), 0);
	});
});

describe('isOpenBankMessage', () => {
	it('accepts only well-formed requests for known banks', () => {
		assert.equal(isOpenBankMessage({ type: 'openBank', bankId: 'citi' }), true);
		assert.equal(isOpenBankMessage({ type: 'openBank', bankId: 'chase' }), false);
		assert.equal(isOpenBankMessage({ type: 'other', bankId: 'citi' }), false);
		assert.equal(isOpenBankMessage(null), false);
		assert.equal(isOpenBankMessage('openBank'), false);
	});
});

describe('openSavedCard', () => {
	it('opens the saved card page', async () => {
		const card = await addSavedCard(SECOND_CARD, 'Second');
		await openSavedCard(card.id);
		assert.deepEqual(callArgs(api.tabs.create), [[{ url: SECOND_CARD }]]);
	});

	it('watches the tab with the card page as its target', async () => {
		chromeMock.grant(CAPITAL_ONE_SITE);
		const card = await addSavedCard(SECOND_CARD, 'Second');
		await openSavedCard(card.id);
		const tracked = chromeMock.getSession()[`signInReturn:${NEW_TAB_ID}`] as { url?: string };
		assert.equal(tracked.url, SECOND_CARD);
	});

	it('does nothing for a card that no longer exists', async () => {
		await openSavedCard('gone');
		assert.equal(api.tabs.create.mock.callCount(), 0);
	});

	it('requestOpen includes the card id', async () => {
		await requestOpen('capitalOne', 'card-1');
		assert.deepEqual(callArgs(api.runtime.sendMessage), [[{ type: 'openBank', bankId: 'capitalOne', cardId: 'card-1' }]]);
	});

	it('isOpenBankMessage accepts a string card id only', () => {
		assert.equal(isOpenBankMessage({ type: 'openBank', bankId: 'capitalOne', cardId: 'x' }), true);
		assert.equal(isOpenBankMessage({ type: 'openBank', bankId: 'capitalOne', cardId: 5 }), false);
	});
});
