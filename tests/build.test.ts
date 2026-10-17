import assert from 'node:assert/strict';
import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { build, FIREFOX_ADDON_ID, ROOT, TARGETS } from '../scripts/build.ts';
import type { Target } from '../scripts/build.ts';
import { createChromeMock } from './helpers/chrome-mock.ts';

// src/ext.ts reads the extension API when it loads, so provide one before importing src.
createChromeMock().install();
const { BANK_IDS, signInReturnFor } = await import('../src/shared.ts');

type Manifest = {
	manifest_version: number;
	version: string;
	description: string;
	permissions: string[];
	host_permissions?: unknown;
	optional_host_permissions?: string[];
	content_scripts?: unknown;
	commands?: unknown;
	icons: Record<string, string>;
	action: { default_popup: string; default_icon: Record<string, string> };
	options_ui: { page: string };
	background: { service_worker?: string; scripts?: string[]; type?: string };
	browser_specific_settings?: {
		gecko?: { id?: string; strict_min_version?: string; data_collection_permissions?: { required?: string[] } };
	};
};

let workDir: string;
const outDirs = {} as Record<Target, string>;
const manifests = {} as Record<Target, Manifest>;

async function listFiles(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { recursive: true, withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile())
		.map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
		.sort();
}

before(async () => {
	workDir = await mkdtemp(path.join(tmpdir(), 'cardhop-build-'));
	for (const target of TARGETS) {
		outDirs[target] = await build(target, path.join(workDir, target));
		manifests[target] = JSON.parse(await readFile(path.join(outDirs[target], 'manifest.json'), 'utf8')) as Manifest;
	}
});

after(async () => {
	await rm(workDir, { recursive: true, force: true });
});

for (const target of TARGETS) {
	describe(`${target} build`, () => {
		it('is Manifest V3', () => {
			assert.equal(manifests[target].manifest_version, 3);
		});

		it('references files that exist', async () => {
			const manifest = manifests[target];
			const paths = [
				...(manifest.background.service_worker ? [manifest.background.service_worker] : []),
				...(manifest.background.scripts ?? []),
				manifest.action.default_popup,
				manifest.options_ui.page,
				...Object.values(manifest.icons),
				...Object.values(manifest.action.default_icon),
			];
			await Promise.all(paths.map((file) => access(path.join(outDirs[target], file))));
		});

		it('ships the compiled scripts the pages load', async () => {
			const files = await listFiles(outDirs[target]);
			['background.js', 'ext.js', 'shared.js', 'popup/popup.js', 'popup/options.js'].forEach((file) => {
				assert.ok(files.includes(file), `missing ${file}`);
			});
		});

		it('ships no TypeScript, source artwork, or base manifest copies', async () => {
			const files = await listFiles(outDirs[target]);
			assert.deepEqual(files.filter((file) => /\.(ts|svg)$/.test(file) || file.endsWith('.DS_Store')), []);
			assert.equal(files.filter((file) => file.endsWith('manifest.json')).length, 1);
		});

		it('rewrites TypeScript imports to the compiled .js files', async () => {
			const background = await readFile(path.join(outDirs[target], 'background.js'), 'utf8');
			assert.match(background, /from '\.\/shared\.js'/);
			assert.doesNotMatch(background, /\.ts'/);
		});

		it('keeps the store description within the 132-character limit', () => {
			const { description } = manifests[target];
			assert.ok(description.length <= 132, `description is ${description.length} characters`);
		});

		it('asks only for the permissions CardHop needs', () => {
			const manifest = manifests[target];
			assert.deepEqual([...manifest.permissions].sort(), ['contextMenus', 'scripting', 'storage']);
			assert.equal(manifest.host_permissions, undefined);
			assert.equal(manifest.content_scripts, undefined);
		});

		it('lists exactly the sites return-after-sign-in can ask for, as optional', () => {
			const origins = BANK_IDS.flatMap((bankId) => signInReturnFor(bankId)?.origin ?? []);
			assert.deepEqual(manifests[target].optional_host_permissions, [...origins, '<all_urls>']);
			assert.deepEqual(origins, ['https://myaccounts.capitalone.com/*']);
		});

		it('bundles the checkout script as a classic script', async () => {
			const source = await readFile(path.join(outDirs[target], 'checkout', 'content.js'), 'utf8');
			assert.doesNotMatch(source, /^\s*(import|export)\b/m);
		});

		it('ships none of the unbundled checkout modules', async () => {
			const files = await listFiles(path.join(outDirs[target], 'checkout'));
			assert.deepEqual(files, ['content.js']);
		});

		it('declares no keyboard shortcuts', () => {
			assert.equal(manifests[target].commands, undefined);
		});

		it('points the popup where applyActionMode restores it', () => {
			assert.equal(manifests[target].action.default_popup, 'popup/popup.html');
		});

		it('matches the version in package.json', async () => {
			const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8')) as { version: string };
			assert.equal(manifests[target].version, pkg.version);
		});
	});
}

describe('browser-specific manifest settings', () => {
	it('runs the Chromium background as a module service worker', () => {
		assert.deepEqual(manifests.chromium.background, { service_worker: 'background.js', type: 'module' });
		assert.equal(manifests.chromium.browser_specific_settings, undefined);
	});

	it('runs the Firefox background as a module script', () => {
		assert.deepEqual(manifests.firefox.background, { scripts: ['background.js'], type: 'module' });
	});

	it('gives Firefox an add-on id and declares no data collection', () => {
		const gecko = manifests.firefox.browser_specific_settings?.gecko;
		assert.equal(gecko?.id, FIREFOX_ADDON_ID);
		assert.deepEqual(gecko?.data_collection_permissions, { required: ['none'] });
		assert.ok(gecko?.strict_min_version, 'Firefox needs a minimum version');
	});
});

describe('options page', () => {
	it('sends the options dialog to the popup page in options mode', async () => {
		const script = await readFile(path.join(outDirs.chromium, 'popup', 'options.js'), 'utf8');
		assert.match(script, /location\.replace\('popup\.html\?view=options'\)/);
	});
});
