import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { callArgs, createChromeMock } from './helpers/chrome-mock.ts';

const chromeMock = createChromeMock();
chromeMock.install();
const { api } = chromeMock;

const {
	applyActionMode,
	BANK_IDS,
	BANKS,
	canOpenDirectly,
	bankLabel,
	cardMenuId,
	renameBank,
	resetBankLabel,
	DEFAULT_SETTINGS,
	getSettings,
	isBankId,
	menuId,
	saveSettings,
	signInReturnFor,
} = await import('../src/shared.ts');

beforeEach(() => chromeMock.reset());

describe('BANKS', () => {
	it('uses https URLs on each bank’s own domain', () => {
		assert.equal(new URL(BANKS.capitalOne.url).host, 'myaccounts.capitalone.com');
		assert.equal(new URL(BANKS.citi.url).host, 'online.citi.com');
		Object.values(BANKS).forEach(({ url }) => assert.equal(new URL(url).protocol, 'https:'));
	});

	it('opens the Capital One virtual card manager', () => {
		assert.equal(BANKS.capitalOne.url, 'https://myaccounts.capitalone.com/vc/virtual-cards/manager');
	});

	it('opens Citi’s van2 page, not the van3 dashboard that fails without in-tab state', () => {
		assert.equal(BANKS.citi.url, 'https://online.citi.com/US/ag/repcard/van2');
	});

	it('lists bank ids in display order', () => {
		assert.deepEqual(BANK_IDS, ['capitalOne', 'citi']);
	});
});

describe('isBankId', () => {
	it('accepts known banks only', () => {
		assert.equal(isBankId('citi'), true);
		assert.equal(isBankId('chase'), false);
		assert.equal(isBankId('toString'), false);
		assert.equal(isBankId(42), false);
	});
});

describe('getSettings', () => {
	it('returns the defaults when nothing is stored', async () => {
		assert.deepEqual(await getSettings(), DEFAULT_SETTINGS);
		assert.deepEqual(DEFAULT_SETTINGS, {
			banks: [],
			openDirectly: false,
			openIn: 'newTab',
			bankLabels: {},
			savedCardsTipDismissed: false,
			checkoutAutoOpen: true,
		});
	});

	it('returns stored values', async () => {
		chromeMock.setStored({
			banks: ['citi'],
			openDirectly: true,
			openIn: 'currentTab',
			bankLabels: { capitalOne: 'Quicksilver' },
			savedCardsTipDismissed: true,
			checkoutAutoOpen: false,
		});
		assert.deepEqual(await getSettings(), {
			banks: ['citi'],
			openDirectly: true,
			openIn: 'currentTab',
			bankLabels: { capitalOne: 'Quicksilver' },
			savedCardsTipDismissed: true,
			checkoutAutoOpen: false,
		});
	});

	it('keeps banks in display order regardless of stored order', async () => {
		chromeMock.setStored({ banks: ['citi', 'capitalOne'] });
		assert.deepEqual((await getSettings()).banks, ['capitalOne', 'citi']);
	});

	it('drops banks that no longer exist', async () => {
		chromeMock.setStored({ banks: ['citi', 'removedBank'] });
		assert.deepEqual((await getSettings()).banks, ['citi']);
	});

	it('returns no banks when none are valid', async () => {
		chromeMock.setStored({ banks: ['removedBank'] });
		assert.deepEqual((await getSettings()).banks, []);

		chromeMock.setStored({ banks: 'citi' });
		assert.deepEqual((await getSettings()).banks, []);
	});

	it('falls back to a new tab for an unknown openIn value', async () => {
		chromeMock.setStored({ openIn: 'backgroundTab' });
		assert.equal((await getSettings()).openIn, 'newTab');
	});

	it('falls back to the popup for a non-boolean openDirectly value', async () => {
		chromeMock.setStored({ openDirectly: 'yes' });
		assert.equal((await getSettings()).openDirectly, false);
	});

	it('defaults checkoutAutoOpen to on and ignores non-boolean values', async () => {
		assert.equal((await getSettings()).checkoutAutoOpen, true);
		chromeMock.setStored({ checkoutAutoOpen: 'no' });
		assert.equal((await getSettings()).checkoutAutoOpen, true);
		chromeMock.setStored({ checkoutAutoOpen: false });
		assert.equal((await getSettings()).checkoutAutoOpen, false);
	});

	it('does not hand out the shared defaults array', async () => {
		const settings = await getSettings();
		settings.banks.push('citi');
		assert.deepEqual(DEFAULT_SETTINGS.banks, []);
	});
});

describe('saveSettings', () => {
	it('writes the given settings to sync storage', async () => {
		await saveSettings({ banks: ['citi'] });
		assert.deepEqual(chromeMock.getStored(), { banks: ['citi'] });
	});
});

describe('canOpenDirectly', () => {
	it('is true only when enabled with exactly one bank', () => {
		assert.equal(canOpenDirectly({ openDirectly: true, banks: ['capitalOne'] }), true);
		assert.equal(canOpenDirectly({ openDirectly: true, banks: ['capitalOne', 'citi'] }), false);
		assert.equal(canOpenDirectly({ openDirectly: false, banks: ['capitalOne'] }), false);
	});
});

describe('menuId', () => {
	it('gives each bank a unique context menu id', () => {
		const ids = BANK_IDS.map(menuId);
		assert.deepEqual(ids, ['open-capitalOne', 'open-citi']);
		assert.equal(new Set(ids).size, ids.length);
	});
});

describe('signInReturnFor', () => {
	it('returns Capital One’s rule, scoped to its account site', () => {
		assert.deepEqual(signInReturnFor('capitalOne'), {
			origin: 'https://myaccounts.capitalone.com/*',
			destinationPrefix: 'https://myaccounts.capitalone.com/vc/virtual-cards',
			landingPaths: ['/accountSummary'],
		});
		assert.ok(BANKS.capitalOne.url.startsWith(signInReturnFor('capitalOne')?.destinationPrefix ?? '-'));
	});

	it('returns nothing for banks that don’t need it', () => {
		assert.equal(signInReturnFor('citi'), undefined);
	});
});

describe('applyActionMode', () => {
	it('removes the popup so a toolbar click fires action.onClicked', async () => {
		await applyActionMode(true);
		assert.deepEqual(callArgs(api.action.setPopup), [[{ popup: '' }]]);
	});

	it('restores the popup', async () => {
		await applyActionMode(false);
		assert.deepEqual(callArgs(api.action.setPopup), [[{ popup: 'popup/popup.html' }]]);
	});
});

describe('saved card pages and shared helpers', () => {
	it('every bank limits card pages to its own https site', () => {
		Object.values(BANKS).forEach((bank) => {
			const prefix = new URL(bank.cardPagePrefix);
			assert.equal(prefix.protocol, 'https:');
			assert.equal(new URL(bank.url).origin, prefix.origin);
		});
	});

	it('the general Capital One page is itself a card page', () => {
		assert.ok(BANKS.capitalOne.url.startsWith(BANKS.capitalOne.cardPagePrefix));
	});

	it('cannot open directly when the bank has saved card pages', () => {
		const settings = { openDirectly: true, banks: ['capitalOne' as const] };
		assert.equal(canOpenDirectly(settings, [{ bankId: 'capitalOne' }]), false);
		assert.equal(canOpenDirectly(settings, [{ bankId: 'citi' }]), true);
		assert.equal(canOpenDirectly(settings, []), true);
	});

	it('gives saved cards their own menu ids', () => {
		assert.equal(cardMenuId('abc'), 'open-card-abc');
		assert.notEqual(cardMenuId('capitalOne'), 'open-capitalOne');
	});
});

describe('default button names', () => {
	it('uses the bank name until renamed', () => {
		assert.equal(bankLabel('capitalOne', { bankLabels: {} }), 'Capital One Virtual Cards');
		assert.equal(bankLabel('capitalOne', { bankLabels: { capitalOne: 'Quicksilver' } }), 'Quicksilver');
	});

	it('renameBank saves a trimmed name in synced settings', async () => {
		await renameBank('capitalOne', '  Quicksilver  ');
		assert.deepEqual(chromeMock.getStored().bankLabels, { capitalOne: 'Quicksilver' });
	});

	it('renameBank ignores a blank name', async () => {
		await renameBank('capitalOne', 'Quicksilver');
		await renameBank('capitalOne', '   ');
		assert.equal((await getSettings()).bankLabels.capitalOne, 'Quicksilver');
	});

	it('resetBankLabel removes only that bank’s name', async () => {
		await renameBank('capitalOne', 'Quicksilver');
		await renameBank('citi', 'Citi Premier');
		await resetBankLabel('capitalOne');
		assert.deepEqual((await getSettings()).bankLabels, { citi: 'Citi Premier' });
	});

	it('ignores stored names for unknown banks or of the wrong type', async () => {
		chromeMock.setStored({ bankLabels: { capitalOne: 5, chase: 'x', citi: '  ' } });
		assert.deepEqual((await getSettings()).bankLabels, {});
	});
});

