import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { createChromeMock } from './helpers/chrome-mock.ts';

const chromeMock = createChromeMock();
chromeMock.install();

const {
	forgetBankLanding,
	handleBankLandingUpdate,
	watchBankLanding,
	WATCH_FOR_MS,
} = await import('../src/bank-landing.ts');
const { BANK_LANDINGS_KEY, getBankLandings } = await import('../src/saved-cards.ts');
const { BANKS } = await import('../src/shared.ts');

const TAB = 7;
const NOW = 1_000_000;
// Capital One adds the default card to the general page's address.
const LANDING = `${BANKS.capitalOne.url}?arid=default`;
const OTHER_CARD = `${BANKS.capitalOne.url}?arid=other`;

beforeEach(() => chromeMock.reset());

describe('where the bank button lands', () => {
	it('records the card page the bank adds to its general page', async () => {
		await watchBankLanding(TAB, 'capitalOne', NOW);
		await handleBankLandingUpdate(TAB, BANKS.capitalOne.url, NOW);
		assert.deepEqual(await getBankLandings(), {}, 'nothing to record until the card is in the address');

		await handleBankLandingUpdate(TAB, LANDING, NOW + 1);
		assert.deepEqual(await getBankLandings(), { capitalOne: LANDING });
	});

	it('keeps watching through sign-in', async () => {
		await watchBankLanding(TAB, 'capitalOne', NOW);
		await handleBankLandingUpdate(TAB, undefined, NOW + 1);
		await handleBankLandingUpdate(TAB, 'https://myaccounts.capitalone.com/accountSummary', NOW + 2);
		assert.deepEqual(await getBankLandings(), {});

		await handleBankLandingUpdate(TAB, LANDING, NOW + 3);
		assert.deepEqual(await getBankLandings(), { capitalOne: LANDING });
	});

	it('replaces the page recorded last time', async () => {
		chromeMock.setLocal({ [BANK_LANDINGS_KEY]: { capitalOne: OTHER_CARD } });
		await watchBankLanding(TAB, 'capitalOne', NOW);
		await handleBankLandingUpdate(TAB, LANDING, NOW);
		assert.deepEqual(await getBankLandings(), { capitalOne: LANDING });
	});

	it('ignores tabs the bank button did not open', async () => {
		await handleBankLandingUpdate(TAB, LANDING, NOW);
		assert.deepEqual(await getBankLandings(), {});
	});

	it('ignores another bank’s pages', async () => {
		await watchBankLanding(TAB, 'citi', NOW);
		await handleBankLandingUpdate(TAB, LANDING, NOW);
		assert.deepEqual(await getBankLandings(), {});
	});

	it('stops watching once it lands, so switching cards changes nothing', async () => {
		await watchBankLanding(TAB, 'capitalOne', NOW);
		await handleBankLandingUpdate(TAB, LANDING, NOW);
		await handleBankLandingUpdate(TAB, OTHER_CARD, NOW + 1);
		assert.deepEqual(await getBankLandings(), { capitalOne: LANDING });
		assert.deepEqual(chromeMock.getSession(), {});
	});

	it('stops watching a tab that never lands', async () => {
		await watchBankLanding(TAB, 'capitalOne', NOW);
		await handleBankLandingUpdate(TAB, LANDING, NOW + WATCH_FOR_MS + 1);
		assert.deepEqual(await getBankLandings(), {});
		assert.deepEqual(chromeMock.getSession(), {});
	});

	it('forgets a tab on request', async () => {
		await watchBankLanding(TAB, 'capitalOne', NOW);
		await forgetBankLanding(TAB);
		assert.deepEqual(chromeMock.getSession(), {});
	});
});
