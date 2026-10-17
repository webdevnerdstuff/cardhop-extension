import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { callArgs, createChromeMock, flush } from './helpers/chrome-mock.ts';

const chromeMock = createChromeMock();
chromeMock.install();
const { api } = chromeMock;

const {
	CHECKOUT_ORIGINS,
	CHECKOUT_SCRIPT_ID,
	checkoutExcludeMatches,
	hasCheckoutAccess,
	removeCheckoutAccess,
	requestCheckoutAccess,
	syncCheckoutScript,
} = await import('../src/checkout-access.ts');
// Importing registers the background script's listeners on the mock.
await import('../src/background.ts');

const CAPITAL_ONE = 'https://myaccounts.capitalone.com/*';

beforeEach(() => chromeMock.reset());

describe('checkoutExcludeMatches', () => {
	it('excludes each whole bank domain once', () => {
		assert.deepEqual(checkoutExcludeMatches(), ['https://*.capitalone.com/*', 'https://*.citi.com/*']);
	});
});

describe('access', () => {
	it('reports whether <all_urls> is granted', async () => {
		assert.equal(await hasCheckoutAccess(), false);
		chromeMock.grant('<all_urls>');
		assert.equal(await hasCheckoutAccess(), true);
		assert.deepEqual(callArgs(api.permissions.contains)[0], [{ origins: CHECKOUT_ORIGINS }]);
	});

	it('requests access and registers the script once granted', async () => {
		assert.equal(await requestCheckoutAccess(), true);
		await flush();
		assert.deepEqual(callArgs(api.permissions.request), [[{ origins: ['<all_urls>'] }]]);
		assert.deepEqual(chromeMock.registeredScripts().map((script) => script.id), [CHECKOUT_SCRIPT_ID]);
	});

	it('returns false and registers nothing when access is declined', async () => {
		chromeMock.answerPermissionPrompts(false);
		assert.equal(await requestCheckoutAccess(), false);
		await flush();
		assert.deepEqual(chromeMock.registeredScripts(), []);
	});
});

describe('syncCheckoutScript', () => {
	it('registers the content script when access is granted and nothing is registered', async () => {
		chromeMock.grant('<all_urls>');
		await syncCheckoutScript();

		assert.deepEqual(callArgs(api.scripting.registerContentScripts), [[[{
			id: 'cardhop-checkout',
			js: ['checkout/content.js'],
			matches: ['<all_urls>'],
			excludeMatches: ['https://*.capitalone.com/*', 'https://*.citi.com/*'],
			allFrames: true,
			runAt: 'document_idle',
			persistAcrossSessions: true,
		}]]]);
	});

	it('unregisters the script when access is gone', async () => {
		chromeMock.setRegisteredScripts([{ id: 'cardhop-checkout' }]);
		await syncCheckoutScript();

		assert.deepEqual(callArgs(api.scripting.unregisterContentScripts), [[{ ids: ['cardhop-checkout'] }]]);
		assert.deepEqual(chromeMock.registeredScripts(), []);
	});

	it('makes no register call when already registered', async () => {
		chromeMock.grant('<all_urls>');
		chromeMock.setRegisteredScripts([{ id: 'cardhop-checkout' }]);
		await syncCheckoutScript();

		assert.equal(api.scripting.registerContentScripts.mock.callCount(), 0);
	});

	it('does nothing without access and without a registration', async () => {
		await syncCheckoutScript();

		assert.equal(api.scripting.registerContentScripts.mock.callCount(), 0);
		assert.equal(api.scripting.unregisterContentScripts.mock.callCount(), 0);
	});
});

describe('permissions.onRemoved', () => {
	it('unregisters the script', async () => {
		await requestCheckoutAccess();
		await flush();
		assert.equal(chromeMock.registeredScripts().length, 1);

		await api.permissions.remove({ origins: ['<all_urls>'] });
		await flush();
		assert.deepEqual(chromeMock.registeredScripts(), []);
	});
});

describe('removeCheckoutAccess', () => {
	it('keeps a separate Capital One grant', async () => {
		chromeMock.grant('<all_urls>', CAPITAL_ONE);
		await removeCheckoutAccess();

		assert.deepEqual(chromeMock.granted(), [CAPITAL_ONE]);
		assert.deepEqual(callArgs(api.permissions.remove), [[{ origins: ['<all_urls>'] }]]);
	});

	it('unregisters the script', async () => {
		chromeMock.grant('<all_urls>');
		chromeMock.setRegisteredScripts([{ id: 'cardhop-checkout' }]);
		await removeCheckoutAccess();

		assert.deepEqual(chromeMock.registeredScripts(), []);
	});
});
