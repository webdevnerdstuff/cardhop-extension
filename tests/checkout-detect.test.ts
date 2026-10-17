import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JSDOM } from 'jsdom';
import { cardFieldFromEvent, isCardField } from '../src/checkout/detect.ts';

const { document } = new JSDOM('<!doctype html><body></body>').window;

function field(html: string): Element {
	const host = document.createElement('div');
	host.innerHTML = html;
	return host.firstElementChild as Element;
}

describe('isCardField', () => {
	const yes: [string, string][] = [
		['autocomplete cc-number', '<input autocomplete="cc-number">'],
		['autocomplete token list', '<input autocomplete="section-pay billing cc-exp">'],
		['stripe cardnumber', '<input name="cardnumber">'],
		['braintree credit-card-number', '<input id="credit-card-number">'],
		['camelCase cardNumber', '<input name="cardNumber">'],
		['placeholder Card number', '<input placeholder="Card number">'],
		['aria-label CVC', '<input aria-label="CVC">'],
		['cc-exp-month name', '<input name="cc-exp-month">'],
		['expiry-date with MM / YY', '<input placeholder="MM / YY" name="expiry-date">'],
		['nameOnCard', '<input name="nameOnCard">'],
		['tel type', '<input type="tel" name="cardnumber">'],
	];
	for (const [label, html] of yes) {
		it(`detects ${label}`, () => assert.equal(isCardField(field(html)), true));
	}

	const no: [string, string][] = [
		['discard', '<input name="discard">'],
		['account-number', '<input name="account-number">'],
		['gift-card-number', '<input name="gift-card-number">'],
		['promo-code', '<input name="promo-code">'],
		['hidden cc-number', '<input type="hidden" autocomplete="cc-number">'],
		['email cc-number', '<input type="email" autocomplete="cc-number">'],
		['disabled cc-number', '<input autocomplete="cc-number" disabled>'],
		['readonly cc-number', '<input autocomplete="cc-number" readonly>'],
		['textarea cardnumber', '<textarea name="cardnumber"></textarea>'],
		['cardigan-size', '<input name="cardigan-size">'],
	];
	for (const [label, html] of no) {
		it(`ignores ${label}`, () => assert.equal(isCardField(field(html)), false));
	}
});

describe('cardFieldFromEvent', () => {
	it('returns the inner input for a focusin from an open shadow root', () => {
		const host = document.createElement('div');
		document.body.append(host);
		const root = host.attachShadow({ mode: 'open' });
		const input = document.createElement('input');
		input.setAttribute('autocomplete', 'cc-number');
		root.append(input);

		let found: HTMLInputElement | undefined;
		document.addEventListener('focusin', (event) => {
			found = cardFieldFromEvent(event);
		});
		input.dispatchEvent(new document.defaultView!.FocusEvent('focusin', { bubbles: true, composed: true }));
		assert.equal(found, input);
	});

	it('returns undefined when the target is not a card field', () => {
		const input = document.createElement('input');
		input.name = 'email';
		document.body.append(input);
		let found: HTMLInputElement | undefined = input;
		document.addEventListener('focusin', (event) => {
			found = cardFieldFromEvent(event);
		}, { once: true });
		input.dispatchEvent(new document.defaultView!.FocusEvent('focusin', { bubbles: true }));
		assert.equal(found, undefined);
	});
});
