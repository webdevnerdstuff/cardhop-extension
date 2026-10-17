import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

let loadCount = 0;

// A unique query string makes Node evaluate ext.ts again with the current globals.
async function loadExt(): Promise<unknown> {
	loadCount += 1;
	const module = await import(`../src/ext.ts?load=${loadCount}`) as { ext: unknown };
	return module.ext;
}

afterEach(() => {
	Reflect.deleteProperty(globalThis, 'browser');
	Reflect.deleteProperty(globalThis, 'chrome');
});

describe('ext', () => {
	it('uses `browser` when it exists, as in Firefox', async () => {
		const firefoxApi = { name: 'browser' };
		Object.assign(globalThis, { browser: firefoxApi, chrome: { name: 'chrome' } });
		assert.equal(await loadExt(), firefoxApi);
	});

	it('falls back to `chrome` in Chromium browsers without `browser`', async () => {
		const chromiumApi = { name: 'chrome' };
		Object.assign(globalThis, { chrome: chromiumApi });
		assert.equal(await loadExt(), chromiumApi);
	});
});
