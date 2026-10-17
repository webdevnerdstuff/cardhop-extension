// Builds a loadable extension folder per browser family: build/chromium and build/firefox.
// Usage: node scripts/build.ts [chromium|firefox ...]   (no arguments builds both)
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

export const TARGETS = ['chromium', 'firefox'] as const;
export type Target = (typeof TARGETS)[number];

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC_DIR = path.join(ROOT, 'src');
const CHECKOUT_DIR = path.join(SRC_DIR, 'checkout');
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

// Firefox's add-on ID. Firefox requires an email-like format, but this is not an email address and
// nothing is sent to it. It must never change once published.
export const FIREFOX_ADDON_ID = 'cardhop@webdevnerdstuff';

type Manifest = Record<string, unknown>;

// Chromium runs the background as a service worker; Firefox runs it as an event page script.
const TARGET_MANIFEST: Record<Target, Manifest> = {
	chromium: {
		background: { service_worker: 'background.js', type: 'module' },
	},
	firefox: {
		background: { scripts: ['background.js'], type: 'module' },
		browser_specific_settings: {
			gecko: {
				id: FIREFOX_ADDON_ID,
				strict_min_version: '140.0',
				// Mozilla requires new add-ons to declare data collection. CardHop collects nothing.
				data_collection_permissions: { required: ['none'] },
			},
		},
	},
};

export function isTarget(value: string): value is Target {
	return (TARGETS as readonly string[]).includes(value);
}

export async function manifestFor(target: Target): Promise<Manifest> {
	const base = JSON.parse(await readFile(path.join(SRC_DIR, 'manifest.json'), 'utf8')) as Manifest;
	return { ...base, ...TARGET_MANIFEST[target] };
}

// Everything in src except TypeScript (compiled separately), the base manifest, and source artwork.
// The checkout script is bundled by esbuild instead, and has no static assets.
function isStaticAsset(source: string): boolean {
	return source !== CHECKOUT_DIR
		&& !source.startsWith(`${CHECKOUT_DIR}${path.sep}`)
		&& !source.endsWith('.ts')
		&& !source.endsWith('.svg')
		&& source !== path.join(SRC_DIR, 'manifest.json')
		&& path.basename(source) !== '.DS_Store';
}

export async function build(target: Target, outDir = path.join(ROOT, 'build', target)): Promise<string> {
	await rm(outDir, { recursive: true, force: true });
	await mkdir(outDir, { recursive: true });

	execFileSync(process.execPath, [TSC, '-p', path.join(ROOT, 'tsconfig.build.json'), '--outDir', outDir], { stdio: 'inherit' });
	await cp(SRC_DIR, outDir, { recursive: true, filter: isStaticAsset });
	// Content scripts can't be ES modules, so the checkout script is bundled into one classic script.
	await esbuild.build({
		entryPoints: [path.join(CHECKOUT_DIR, 'content.ts')],
		bundle: true,
		format: 'iife',
		target: 'es2022',
		outfile: path.join(outDir, 'checkout', 'content.js'),
		logLevel: 'warning',
	});
	await writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify(await manifestFor(target), null, '\t')}\n`);

	return outDir;
}

if (import.meta.main) {
	const requested = process.argv.slice(2);
	const unknown = requested.filter((name) => !isTarget(name));
	if (unknown.length > 0) {
		console.error(`Unknown target(s): ${unknown.join(', ')}. Use: ${TARGETS.join(', ')}`);
		process.exit(1);
	}

	const targets = requested.length > 0 ? requested.filter(isTarget) : [...TARGETS];
	for (const target of targets) {
		const outDir = await build(target);
		console.log(`Built ${target}: ${path.relative(ROOT, outDir)}`);
	}
}
