import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isInView, placeIcon, placePromptCorner } from '../src/checkout/position.ts';

const anchor = { top: 100, left: 50, width: 300, height: 40 };
const viewport = { width: 1000, height: 800 };

describe('placePromptCorner', () => {
	// The top-right corner sits just under the browser toolbar, where the CardHop icon usually is.
	it('pins the prompt to the top-right corner', () => {
		assert.deepEqual(placePromptCorner(viewport), { top: 8, left: 1000 - 260 - 8 });
	});

	it('keeps the left edge visible when the viewport is narrower than the prompt', () => {
		assert.deepEqual(placePromptCorner({ width: 200, height: 800 }), { top: 8, left: 8 });
	});
});

describe('placeIcon', () => {
	it('centres vertically with its right edge inside the anchor', () => {
		assert.deepEqual(placeIcon(anchor), { top: 110, left: 324 });
	});
});

describe('isInView', () => {
	it('is false when the anchor is fully above the viewport', () => {
		assert.equal(isInView({ ...anchor, top: -50, height: 40 }, viewport), false);
	});

	it('is false when fully below, left or right', () => {
		assert.equal(isInView({ ...anchor, top: 900 }, viewport), false);
		assert.equal(isInView({ ...anchor, left: -400 }, viewport), false);
		assert.equal(isInView({ ...anchor, left: 1100 }, viewport), false);
	});

	it('is true when partly visible', () => {
		assert.equal(isInView({ ...anchor, top: -20 }, viewport), true);
		assert.equal(isInView(anchor, viewport), true);
	});
});
