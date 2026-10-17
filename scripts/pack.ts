// Builds store-ready zips in dist/:
//   cardhop-chromium-<version>.zip  Chrome Web Store, Microsoft Edge Add-ons, Opera add-ons
//   cardhop-firefox-<version>.zip   Firefox Add-ons (AMO)
//   cardhop-source-<version>.zip    source code AMO asks for, because the extension is compiled from TypeScript
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { build, ROOT, TARGETS } from './build.ts';

const DIST_DIR = path.join(ROOT, 'dist');

export const SOURCE_FILES = [
	'.nvmrc',
	'LICENSE',
	'README.md',
	'package.json',
	'pnpm-lock.yaml',
	'pnpm-workspace.yaml', // allowBuilds for esbuild: without it a frozen-lockfile install exits 1
	'scripts',
	'src',
	'tsconfig.build.json',
	'tsconfig.json',
];

function zip(outFile: string, entries: string[], cwd: string): void {
	execFileSync('zip', ['-rq', outFile, ...entries, '-x', '*.DS_Store'], { cwd, stdio: 'inherit' });
}

// Only when run as a script, so tests can import SOURCE_FILES.
if (import.meta.main) {
	const { version } = JSON.parse(await readFile(path.join(ROOT, 'src', 'manifest.json'), 'utf8')) as { version: string };
	await mkdir(DIST_DIR, { recursive: true });

	for (const target of TARGETS) {
		const outDir = await build(target);
		const outFile = path.join(DIST_DIR, `cardhop-${target}-${version}.zip`);
		await rm(outFile, { force: true });
		zip(outFile, ['.'], outDir);
		console.log(`Created ${path.relative(ROOT, outFile)}`);
	}

	const sourceFile = path.join(DIST_DIR, `cardhop-source-${version}.zip`);
	await rm(sourceFile, { force: true });
	zip(sourceFile, SOURCE_FILES, ROOT);
	console.log(`Created ${path.relative(ROOT, sourceFile)}`);
}
