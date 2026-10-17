import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { callArgs, createChromeMock } from './helpers/chrome-mock.ts';

const chromeMock = createChromeMock();
chromeMock.install();
const { api } = chromeMock;

const { refreshSaveBadges, SAVE_BADGE_TEXT, SAVE_BADGE_TITLE, updateSaveBadge } = await import('../src/badge.ts');
const { addSavedCard } = await import('../src/saved-cards.ts');

const CARD_PAGE = 'https://myaccounts.capitalone.com/vc/virtual-cards/home?arid=second';
const TAB = 4;

function lastBadge(): string | undefined {
	return callArgs(api.action.setBadgeText).at(-1)?.[0].text;
}

beforeEach(() => {
	chromeMock.reset();
	chromeMock.setStored({ banks: ['capitalOne'] });
});

describe('save badge', () => {
	it('shows a + on an unsaved card page, with a helpful tooltip', async () => {
		await updateSaveBadge(TAB, CARD_PAGE);
		assert.deepEqual(callArgs(api.action.setBadgeText), [[{ tabId: TAB, text: SAVE_BADGE_TEXT }]]);
		assert.deepEqual(callArgs(api.action.setTitle), [[{ tabId: TAB, title: SAVE_BADGE_TITLE }]]);
	});

	it('clears it once the page is saved', async () => {
		await addSavedCard(CARD_PAGE, 'Second');
		await updateSaveBadge(TAB, CARD_PAGE);
		assert.equal(lastBadge(), '');
	});

	it('clears it on pages that are not card pages, or hidden from CardHop', async () => {
		await updateSaveBadge(TAB, 'https://myaccounts.capitalone.com/accountSummary');
		assert.equal(lastBadge(), '');
		await updateSaveBadge(TAB, undefined);
		assert.equal(lastBadge(), '');
	});

	it('does not offer card pages for banks that are not selected', async () => {
		chromeMock.setStored({ banks: ['citi'] });
		await updateSaveBadge(TAB, CARD_PAGE);
		assert.equal(lastBadge(), '');
	});

	it('refreshes every tab CardHop can see', async () => {
		chromeMock.setActiveTabUrl(CARD_PAGE);
		await refreshSaveBadges();
		assert.equal(lastBadge(), SAVE_BADGE_TEXT);
	});
});
