import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { callArgs, createChromeMock } from './helpers/chrome-mock.ts';

const chromeMock = createChromeMock();
chromeMock.install();
const { api } = chromeMock;

const { refreshSaveBadges, SAVE_BADGE_TEXT, SAVE_BADGE_TITLE, updateSaveBadge } = await import('../src/badge.ts');
const { addSavedCard, BANK_LANDINGS_KEY } = await import('../src/saved-cards.ts');
const { BANKS } = await import('../src/shared.ts');

const CARD_PAGE = 'https://myaccounts.capitalone.com/vc/virtual-cards/home?arid=second';
const TAB = 4;

// Whether the last badge set offers to save the page.
function offered(): boolean {
	return callArgs(api.action.setBadgeText).at(-1)?.[0].text === SAVE_BADGE_TEXT;
}

beforeEach(() => {
	chromeMock.reset();
	chromeMock.setStored({ banks: ['capitalOne'] });
});

describe('save badge', () => {
	it('shows a + on an unsaved card page, with a helpful tooltip', async () => {
		await updateSaveBadge(TAB, CARD_PAGE);
		assert.deepEqual(callArgs(api.action.setBadgeText), [[{ tabId: TAB, text: SAVE_BADGE_TEXT }]]);
		assert.deepEqual(callArgs(api.action.setBadgeTextColor), [[{ tabId: TAB, color: '#ffffff' }]]);
		assert.deepEqual(callArgs(api.action.setTitle), [[{ tabId: TAB, title: SAVE_BADGE_TITLE }]]);
	});

	it('clears it once the page is saved', async () => {
		await addSavedCard(CARD_PAGE, 'Second');
		await updateSaveBadge(TAB, CARD_PAGE);
		assert.deepEqual(callArgs(api.action.setBadgeText), [[{ tabId: TAB, text: '' }]]);
		assert.deepEqual(callArgs(api.action.setTitle), [[{ tabId: TAB, title: '' }]]);
	});

	it('clears it on pages that are not card pages, or hidden from CardHop', async () => {
		await updateSaveBadge(TAB, 'https://myaccounts.capitalone.com/accountSummary');
		assert.equal(offered(), false);
		await updateSaveBadge(TAB, undefined);
		assert.equal(offered(), false);
	});

	it('does not offer card pages for banks that are not selected', async () => {
		chromeMock.setStored({ banks: ['citi'] });
		await updateSaveBadge(TAB, CARD_PAGE);
		assert.equal(offered(), false);
	});

	it('skips the pages the bank button opens', async () => {
		await updateSaveBadge(TAB, BANKS.capitalOne.url);
		assert.equal(offered(), false);

		chromeMock.setLocal({ [BANK_LANDINGS_KEY]: { capitalOne: CARD_PAGE } });
		await updateSaveBadge(TAB, CARD_PAGE);
		assert.equal(offered(), false);
	});

	it('ignores tabs that close before the badge is set', async () => {
		const closed = async () => {
			throw new Error(`No tab with id: ${TAB}.`);
		};
		api.action.setBadgeText.mock.mockImplementationOnce(closed);
		await updateSaveBadge(TAB, CARD_PAGE);

		chromeMock.setActiveTabUrl(CARD_PAGE);
		api.action.setTitle.mock.mockImplementationOnce(closed);
		await refreshSaveBadges();
	});

	it('refreshes every tab CardHop can see', async () => {
		chromeMock.setActiveTabUrl(CARD_PAGE);
		await refreshSaveBadges();
		assert.equal(offered(), true);
	});
});
