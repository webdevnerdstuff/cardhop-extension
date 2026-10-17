import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { ROOT } from '../scripts/build.ts';
import { SOURCE_FILES } from '../scripts/pack.ts';

describe('source zip for AMO', () => {
	it('includes everything a frozen-lockfile install and the build need', () => {
		// pnpm-workspace.yaml carries allowBuilds for esbuild; without it the install exits 1.
		['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.nvmrc', 'scripts', 'src', 'tsconfig.json', 'tsconfig.build.json']
			.forEach((file) => assert.ok(SOURCE_FILES.includes(file), `missing ${file}`));
	});

	it('lists only files that exist', async () => {
		await Promise.all(SOURCE_FILES.map((file) => access(path.join(ROOT, file))));
	});
});
