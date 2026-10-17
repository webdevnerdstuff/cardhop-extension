import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { createChromeMock } from './helpers/chrome-mock.ts';

const chromeMock = createChromeMock();
chromeMock.install();

const {
	CHECKOUT_DISABLED_SITES_KEY,
	disableSite,
	enableSite,
	getDisabledSites,
} = await import('../src/checkout-sites.ts');

beforeEach(() => chromeMock.reset());

describe('disabled checkout sites', () => {
	it('stores a lower-cased hostname', async () => {
		await disableSite('Shop.Example.com');
		assert.deepEqual(await getDisabledSites(), ['shop.example.com']);
	});

	it('stores a site once however often it is disabled', async () => {
		await disableSite('shop.example.com');
		await disableSite('SHOP.example.com');
		assert.deepEqual(await getDisabledSites(), ['shop.example.com']);
	});

	it('returns sites sorted', async () => {
		await disableSite('b.example.com');
		await disableSite('a.example.com');
		assert.deepEqual(await getDisabledSites(), ['a.example.com', 'b.example.com']);
	});

	it('ignores an empty hostname', async () => {
		await disableSite('');
		assert.deepEqual(await getDisabledSites(), []);
		assert.deepEqual(chromeMock.getLocal(), {});
	});

	it('removes a site when it is turned back on', async () => {
		await disableSite('a.example.com');
		await disableSite('b.example.com');
		await enableSite('A.example.com');
		assert.deepEqual(await getDisabledSites(), ['b.example.com']);
	});

	it('gives an empty list when the stored value is not an array', async () => {
		chromeMock.setLocal({ [CHECKOUT_DISABLED_SITES_KEY]: 'shop.example.com' });
		assert.deepEqual(await getDisabledSites(), []);
	});

	it('drops stored values that are not strings', async () => {
		chromeMock.setLocal({ [CHECKOUT_DISABLED_SITES_KEY]: ['b.example.com', 5, null, 'A.example.com', 'a.example.com'] });
		assert.deepEqual(await getDisabledSites(), ['a.example.com', 'b.example.com']);
	});

	it('keeps the list in local storage, not sync', async () => {
		await disableSite('shop.example.com');
		assert.deepEqual(chromeMock.getLocal(), { [CHECKOUT_DISABLED_SITES_KEY]: ['shop.example.com'] });
		assert.deepEqual(chromeMock.getStored(), {});
	});
});
