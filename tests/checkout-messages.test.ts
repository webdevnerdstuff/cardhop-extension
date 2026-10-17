import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SavedCard } from '../src/saved-cards.ts';
import { createChromeMock } from './helpers/chrome-mock.ts';

// shared.ts reads the extension API when it loads.
createChromeMock().install();

const {
	buildCheckoutButtons,
	isCheckoutButtonsRequest,
	isCheckoutFrameMessage,
	isOpenOptionsRequest,
} = await import('../src/checkout-messages.ts');

const venture: SavedCard = {
	id: 'card-1',
	bankId: 'capitalOne',
	label: 'Venture',
	url: 'https://myaccounts.capitalone.com/vc/virtual-cards/home?arid=abc',
};

describe('buildCheckoutButtons', () => {
	it('lists each bank’s general page, then its saved cards, in popup order', () => {
		assert.deepEqual(buildCheckoutButtons({ banks: ['capitalOne', 'citi'], bankLabels: {} }, [venture]), [
			{ label: 'Capital One Virtual Cards', bankId: 'capitalOne', bankName: 'Capital One' },
			{ label: 'Venture', bankId: 'capitalOne', bankName: 'Capital One', cardId: 'card-1' },
			{ label: 'Citi Virtual Cards', bankId: 'citi', bankName: 'Citi' },
		]);
	});

	it('uses a custom bank label', () => {
		assert.deepEqual(buildCheckoutButtons({ banks: ['citi'], bankLabels: { citi: 'Citi Cards' } }, []), [
			{ label: 'Citi Cards', bankId: 'citi', bankName: 'Citi' },
		]);
	});

	it('leaves out cards for unselected banks', () => {
		const buttons = buildCheckoutButtons({ banks: ['citi'], bankLabels: {} }, [venture]);
		assert.deepEqual(buttons.map((button) => button.bankId), ['citi']);
	});

	it('gives no buttons when no bank is chosen', () => {
		assert.deepEqual(buildCheckoutButtons({ banks: [], bankLabels: {} }, [venture]), []);
	});
});

describe('message guards', () => {
	it('isCheckoutFrameMessage accepts known events only', () => {
		['focus', 'blur', 'escape', 'shortcut'].forEach((event) => {
			assert.equal(isCheckoutFrameMessage({ type: 'checkoutFrame', event }), true);
		});
		assert.equal(isCheckoutFrameMessage({ type: 'checkoutFrame', event: 'hover' }), false);
		assert.equal(isCheckoutFrameMessage({ type: 'checkoutFrame' }), false);
		assert.equal(isCheckoutFrameMessage({ type: 'other', event: 'focus' }), false);
		assert.equal(isCheckoutFrameMessage(null), false);
	});

	it('isCheckoutButtonsRequest accepts its exact shape', () => {
		assert.equal(isCheckoutButtonsRequest({ type: 'checkoutButtons' }), true);
		assert.equal(isCheckoutButtonsRequest({ type: 'other' }), false);
		assert.equal(isCheckoutButtonsRequest(null), false);
	});

	it('isOpenOptionsRequest accepts its exact shape', () => {
		assert.equal(isOpenOptionsRequest({ type: 'openOptions' }), true);
		assert.equal(isOpenOptionsRequest({ type: 'other' }), false);
		assert.equal(isOpenOptionsRequest(null), false);
	});
});
