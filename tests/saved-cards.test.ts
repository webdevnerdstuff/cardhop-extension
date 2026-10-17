import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { createChromeMock } from './helpers/chrome-mock.ts';

const chromeMock = createChromeMock();
chromeMock.install();

const {
	addSavedCard,
	BANK_LANDINGS_KEY,
	bankForCardUrl,
	CardPageError,
	defaultLabel,
	findSavedCard,
	forgetAllCards,
	getBankLandings,
	getSavedCards,
	isBankPage,
	isSaved,
	MAX_LABEL_LENGTH,
	removeSavedCard,
	renameSavedCard,
	SAVED_CARDS_KEY,
} = await import('../src/saved-cards.ts');

const SECOND_CARD = 'https://myaccounts.capitalone.com/vc/virtual-cards/home?analyticsTag=from_digital_card&arid=abc%3D';
const THIRD_CARD = 'https://myaccounts.capitalone.com/vc/virtual-cards/home?arid=xyz';
const CITI_PAGE = 'https://online.citi.com/US/ag/repcard/van2?card=1';
const { BANKS } = await import('../src/shared.ts');

beforeEach(() => chromeMock.reset());

describe('bankForCardUrl', () => {
	it('accepts virtual card pages on each bank’s own site', () => {
		assert.equal(bankForCardUrl(SECOND_CARD), 'capitalOne');
		assert.equal(bankForCardUrl(`  ${SECOND_CARD}  `), 'capitalOne');
		assert.equal(bankForCardUrl(CITI_PAGE), 'citi');
	});

	it('rejects other Capital One pages', () => {
		assert.equal(bankForCardUrl('https://myaccounts.capitalone.com/accountSummary'), undefined);
		assert.equal(bankForCardUrl('https://verified.capitalone.com/auth/signin'), undefined);
	});

	it('rejects look-alike and unsafe links', () => {
		[
			'http://myaccounts.capitalone.com/vc/virtual-cards/home',
			'https://myaccounts.capitalone.com.example.com/vc/virtual-cards/home',
			'https://example.com/https://myaccounts.capitalone.com/vc/virtual-cards',
			'https://user:pass@myaccounts.capitalone.com/vc/virtual-cards/home',
			'javascript:alert(1)',
			'not a link',
			'',
			`https://myaccounts.capitalone.com/vc/virtual-cards/home?x=${'a'.repeat(3000)}`,
		].forEach((url) => assert.equal(bankForCardUrl(url), undefined, url));
	});
});

describe('saving card pages', () => {
	it('stores cards in local storage only, never synced', async () => {
		await addSavedCard(SECOND_CARD, 'Venture X');
		assert.equal((chromeMock.getLocal()[SAVED_CARDS_KEY] as unknown[]).length, 1);
		assert.deepEqual(chromeMock.getStored(), {});
	});

	it('keeps the label the user typed, trimmed and capped', async () => {
		const card = await addSavedCard(SECOND_CARD, `  ${'x'.repeat(MAX_LABEL_LENGTH + 10)}  `);
		assert.equal(card.label, 'x'.repeat(MAX_LABEL_LENGTH));
	});

	it('numbers a default label per bank when none is given', async () => {
		const first = await addSavedCard(SECOND_CARD, '');
		const second = await addSavedCard(THIRD_CARD, '   ');
		const citi = await addSavedCard(CITI_PAGE, '');
		assert.deepEqual([first.label, second.label, citi.label], ['Capital One card 1', 'Capital One card 2', 'Citi card 1']);
	});

	it('records which bank the card belongs to', async () => {
		const card = await addSavedCard(CITI_PAGE, 'Citi');
		assert.equal(card.bankId, 'citi');
	});

	it('refuses links that are not card pages', async () => {
		await assert.rejects(addSavedCard('https://example.com/vc/virtual-cards', 'x'), CardPageError);
		assert.deepEqual(await getSavedCards(), []);
	});

	it('refuses the same card page twice', async () => {
		await addSavedCard(SECOND_CARD, 'One');
		await assert.rejects(addSavedCard(` ${SECOND_CARD} `, 'Two'), /already saved/);
		assert.equal((await getSavedCards()).length, 1);
	});

	it('knows which pages are already saved', async () => {
		await addSavedCard(SECOND_CARD, 'One');
		const cards = await getSavedCards();
		assert.equal(isSaved(SECOND_CARD, cards), true);
		assert.equal(isSaved(THIRD_CARD, cards), false);
		assert.equal(isSaved('https://example.com', cards), false);
	});

	it('defaultLabel counts only that bank’s cards', async () => {
		await addSavedCard(CITI_PAGE, '');
		assert.equal(defaultLabel('capitalOne', await getSavedCards()), 'Capital One card 1');
	});
});

describe('renaming card pages', () => {
	it('renames one card and leaves the others alone', async () => {
		const typo = await addSavedCard(SECOND_CARD, 'Ventrue X');
		const other = await addSavedCard(THIRD_CARD, 'Other');
		await renameSavedCard(typo.id, '  Venture X  ');
		assert.deepEqual((await getSavedCards()).map((card) => card.label), ['Venture X', 'Other']);
		assert.equal((await findSavedCard(other.id))?.label, 'Other');
	});

	it('caps the new name at the maximum length', async () => {
		const card = await addSavedCard(SECOND_CARD, 'x');
		await renameSavedCard(card.id, 'y'.repeat(MAX_LABEL_LENGTH + 5));
		assert.equal((await findSavedCard(card.id))?.label, 'y'.repeat(MAX_LABEL_LENGTH));
	});

	it('ignores a blank name', async () => {
		const card = await addSavedCard(SECOND_CARD, 'Keep me');
		await renameSavedCard(card.id, '   ');
		assert.equal((await findSavedCard(card.id))?.label, 'Keep me');
	});
});

describe('deleting card pages', () => {
	it('deletes one card', async () => {
		const keep = await addSavedCard(SECOND_CARD, 'Keep');
		const drop = await addSavedCard(THIRD_CARD, 'Drop');
		await removeSavedCard(drop.id);
		assert.deepEqual((await getSavedCards()).map((card) => card.id), [keep.id]);
		assert.equal(await findSavedCard(drop.id), undefined);
	});

	it('forgets every card at once', async () => {
		await addSavedCard(SECOND_CARD, 'One');
		await addSavedCard(CITI_PAGE, 'Two');
		await forgetAllCards();
		assert.deepEqual(await getSavedCards(), []);
		assert.equal(SAVED_CARDS_KEY in chromeMock.getLocal(), false);
	});

	it('forgets where the bank buttons landed too', async () => {
		chromeMock.setLocal({ [BANK_LANDINGS_KEY]: { capitalOne: THIRD_CARD } });
		await forgetAllCards();
		assert.equal(BANK_LANDINGS_KEY in chromeMock.getLocal(), false);
	});
});

describe('reading stored cards', () => {
	it('ignores malformed or tampered entries', async () => {
		chromeMock.setLocal({
			[SAVED_CARDS_KEY]: [
				{ id: 'ok', bankId: 'capitalOne', label: 'OK', url: SECOND_CARD },
				{ id: 'wrong-bank', bankId: 'citi', label: 'Bad', url: SECOND_CARD },
				{ id: 'evil', bankId: 'capitalOne', label: 'Bad', url: 'https://example.com/vc/virtual-cards' },
				{ id: 'partial' },
				'nonsense',
			],
		});
		assert.deepEqual((await getSavedCards()).map((card) => card.id), ['ok']);
	});

	it('returns nothing when storage holds something else', async () => {
		chromeMock.setLocal({ [SAVED_CARDS_KEY]: 'nope' });
		assert.deepEqual(await getSavedCards(), []);
	});
});

describe('bank pages', () => {
	it('counts the bank’s general page and the card page its button last landed on', () => {
		const landings = { capitalOne: THIRD_CARD };
		assert.equal(isBankPage(BANKS.capitalOne.url, landings), true);
		assert.equal(isBankPage(BANKS.citi.url, landings), true);
		assert.equal(isBankPage(THIRD_CARD, landings), true);
		assert.equal(isBankPage(SECOND_CARD, landings), false);
		assert.equal(isBankPage(CITI_PAGE, landings), false);
		assert.equal(isBankPage('https://example.com', landings), false);
	});

	it('ignores malformed or tampered landing pages', async () => {
		chromeMock.setLocal({
			[BANK_LANDINGS_KEY]: { capitalOne: THIRD_CARD, citi: 'https://example.com/US/', other: THIRD_CARD },
		});
		assert.deepEqual(await getBankLandings(), { capitalOne: THIRD_CARD });

		chromeMock.setLocal({ [BANK_LANDINGS_KEY]: 'nope' });
		assert.deepEqual(await getBankLandings(), {});
	});
});
