import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { JSDOM } from 'jsdom';
import type { CheckoutButton } from '../src/checkout-messages.ts';
import { callArgs, createChromeMock, flush } from './helpers/chrome-mock.ts';

const chromeMock = createChromeMock();
chromeMock.install();
const { api } = chromeMock;

// Imported after the mock is installed: ext.ts picks the global extension API at import time.
const { BLUR_DELAY_MS, startCheckout } = await import('../src/checkout/main.ts');
const { PRESS_TIMEOUT_MS } = await import('../src/checkout/prompt.ts');

const buttons: CheckoutButton[] = [
	{ label: 'Capital One', bankId: 'capitalOne', bankName: 'Capital One' },
	{ label: 'Netflix', bankId: 'capitalOne', bankName: 'Capital One', cardId: 'c1' },
];

let dom: JSDOM;
let doc: Document;
let checkout: ReturnType<typeof startCheckout>;
let buttonsResponse: () => Promise<unknown>;

function rect(top: number, left = 20, width = 200, height = 30): DOMRect {
	return { top, left, width, height, bottom: top + height, right: left + width, x: left, y: top, toJSON() {} } as DOMRect;
}

function addInput(attributes: Record<string, string>, parent: ParentNode = doc.body): HTMLInputElement {
	const input = doc.createElement('input');
	for (const [name, value] of Object.entries(attributes)) {
		input.setAttribute(name, value);
	}
	parent.append(input);
	return input;
}

function host(): HTMLElement | null {
	return doc.querySelector('cardhop-prompt');
}

function showing(): 'prompt' | 'icon' | false {
	const root = host()?.shadowRoot;
	if (root?.querySelector('.panel')) {
		return 'prompt';
	}
	return root?.querySelector('button.icon') ? 'icon' : false;
}

function labels(): string[] {
	return [...host()?.shadowRoot?.querySelectorAll('.items button.secondary') ?? []]
		.map((button) => button.textContent?.trim() ?? '');
}

function byText(text: string): HTMLButtonElement {
	const found = [...host()?.shadowRoot?.querySelectorAll('button') ?? []].find((button) => button.textContent?.trim() === text);
	assert.ok(found, `button "${text}"`);
	return found;
}

function sent(): unknown[] {
	return callArgs(api.runtime.sendMessage).map(([message]) => message);
}

function key(target: Element, init: KeyboardEventInit): KeyboardEvent {
	const view = target.ownerDocument.defaultView as Window & typeof globalThis;
	const event = new view.KeyboardEvent('keydown', { bubbles: true, cancelable: true, composed: true, ...init });
	target.dispatchEvent(event);
	return event;
}

const SHORTCUT = { key: 'C', code: 'KeyC', altKey: true, shiftKey: true };

function pointer(type: 'pointerdown' | 'pointerup' | 'pointercancel', target: Element): Event {
	const event = new dom.window.Event(type, { bubbles: true, cancelable: true, composed: true });
	target.dispatchEvent(event);
	return event;
}

function pointerdown(target: Element): void {
	pointer('pointerdown', target);
}

// Lets the storage reads and the checkoutButtons request resolve.
async function settle(): Promise<void> {
	await flush();
	await flush();
}

beforeEach(() => {
	chromeMock.reset();
	buttonsResponse = async () => structuredClone(buttons);
	api.runtime.sendMessage.mock.mockImplementation(async (message: unknown) => (
		(message as { type?: string }).type === 'checkoutButtons' ? buttonsResponse() : undefined
	));
	dom = new JSDOM('<!doctype html><body><input id="email" type="email" name="email"></body>', {
		url: 'https://shop.example/checkout',
		pretendToBeVisual: true,
	});
	doc = dom.window.document;
	checkout = startCheckout(dom.window as unknown as Window, { shadowMode: 'open' });
});

afterEach(() => {
	checkout.stop();
	mock.timers.reset();
	dom.window.close();
});

describe('startCheckout in the top frame', () => {
	it('shows the prompt when a card field added after load gets focus', async () => {
		const field = addInput({ autocomplete: 'cc-number' });
		field.focus();
		await settle();
		assert.equal(showing(), 'prompt');
		assert.deepEqual(labels(), ['Capital One', 'Netflix']);
		assert.ok(sent().some((message) => (message as { type?: string }).type === 'checkoutButtons'));
	});

	it('ignores focus on other fields', async () => {
		(doc.getElementById('email') as HTMLInputElement).focus();
		await settle();
		assert.equal(host(), null);
	});

	it('detects a field inside an open shadow root', async () => {
		const widget = doc.createElement('div');
		doc.body.append(widget);
		const shadow = widget.attachShadow({ mode: 'open' });
		const field = doc.createElement('input');
		field.setAttribute('autocomplete', 'cc-number');
		shadow.append(field);
		field.focus();
		await settle();
		assert.equal(showing(), 'prompt');
	});

	it('shows only the icon when auto-open is off', async () => {
		chromeMock.setStored({ checkoutAutoOpen: false });
		addInput({ autocomplete: 'cc-number' }).focus();
		await settle();
		assert.equal(showing(), 'icon');

		host()?.shadowRoot?.querySelector<HTMLButtonElement>('button.icon')?.click();
		await settle();
		assert.equal(showing(), 'prompt');
		assert.deepEqual(labels(), ['Capital One', 'Netflix']);
	});

	it('shows nothing on a site turned off', async () => {
		chromeMock.setLocal({ checkoutDisabledSites: ['shop.example'] });
		addInput({ autocomplete: 'cc-number' }).focus();
		await settle();
		assert.equal(showing(), false);
	});

	it('✕ stops auto-open until reload', async () => {
		const field = addInput({ autocomplete: 'cc-number' });
		field.focus();
		await settle();
		byText('✕').click();
		assert.equal(showing(), false);

		field.blur();
		field.focus();
		await settle();
		assert.equal(showing(), 'icon');
	});

	it('Not on this site stores the host and hides', async () => {
		addInput({ autocomplete: 'cc-number' }).focus();
		await settle();
		byText('Not on this site').click();
		await settle();
		assert.equal(showing(), false);
		assert.deepEqual(chromeMock.getLocal().checkoutDisabledSites, ['shop.example']);
	});

	it('opening a card sends openBank with newTab', async () => {
		addInput({ autocomplete: 'cc-number' }).focus();
		await settle();
		byText('Netflix').click();
		assert.deepEqual(sent().at(-1), { type: 'openBank', bankId: 'capitalOne', cardId: 'c1', newTab: true });
		assert.equal(showing(), false);
	});

	it('opening a bank sends openBank without a cardId', async () => {
		addInput({ autocomplete: 'cc-number' }).focus();
		await settle();
		byText('Capital One').click();
		assert.deepEqual(sent().at(-1), { type: 'openBank', bankId: 'capitalOne', newTab: true });
	});

	it('the empty prompt opens the settings page', async () => {
		buttonsResponse = async () => [];
		addInput({ autocomplete: 'cc-number' }).focus();
		await settle();
		byText('Open settings').click();
		assert.deepEqual(sent().at(-1), { type: 'openOptions' });
	});

	it('treats a failed checkoutButtons request as no buttons', async () => {
		buttonsResponse = async () => {
			throw new Error('storage error');
		};
		addInput({ autocomplete: 'cc-number' }).focus();
		await settle();
		assert.equal(showing(), 'prompt');
		assert.match(host()?.shadowRoot?.textContent ?? '', /Choose your bank in CardHop's settings/);
	});

	it('treats a non-array checkoutButtons response as no buttons', async () => {
		buttonsResponse = async () => undefined;
		addInput({ autocomplete: 'cc-number' }).focus();
		await settle();
		assert.equal(showing(), 'prompt');
		assert.deepEqual(labels(), ['Open settings']);
	});

	it('the latest focus wins over a show still in flight', async () => {
		const number = addInput({ autocomplete: 'cc-number' });
		const expiry = addInput({ autocomplete: 'cc-exp' });
		number.getBoundingClientRect = () => rect(100);
		expiry.getBoundingClientRect = () => rect(300);
		number.focus();
		expiry.focus();
		await settle();
		assert.equal(showing(), 'prompt');
		assert.equal(checkout.anchor(), expiry);
	});

	it('a slow checkoutButtons answer cannot move the prompt back to an old field', async () => {
		let release: (value: unknown) => void = () => {};
		let calls = 0;
		buttonsResponse = () => {
			calls += 1;
			return calls === 1 ? new Promise((resolve) => { release = resolve; }) : Promise.resolve(structuredClone(buttons));
		};
		const number = addInput({ autocomplete: 'cc-number' });
		const expiry = addInput({ autocomplete: 'cc-exp' });
		number.getBoundingClientRect = () => rect(100);
		expiry.getBoundingClientRect = () => rect(300);
		number.focus();
		await settle();
		expiry.focus();
		await settle();
		release(structuredClone(buttons));
		await settle();
		assert.equal(checkout.anchor(), expiry);
	});

	it('Escape during a show still in flight keeps it hidden', async () => {
		let release: (value: unknown) => void = () => {};
		buttonsResponse = () => new Promise((resolve) => { release = resolve; });
		const field = addInput({ autocomplete: 'cc-number' });
		field.focus();
		await settle();
		key(field, { key: 'Escape' });
		release(structuredClone(buttons));
		await settle();
		assert.equal(showing(), false);
	});

	it('hides after blur', async () => {
		mock.timers.enable({ apis: ['setTimeout'] });
		const field = addInput({ autocomplete: 'cc-number' });
		field.focus();
		await settle();
		field.blur();
		mock.timers.tick(BLUR_DELAY_MS - 1);
		assert.equal(showing(), 'prompt');
		mock.timers.tick(1);
		assert.equal(showing(), false);
	});

	it('keeps the prompt open when focus moves between fields', async () => {
		mock.timers.enable({ apis: ['setTimeout'] });
		const number = addInput({ autocomplete: 'cc-number' });
		const expiry = addInput({ autocomplete: 'cc-exp' });
		number.getBoundingClientRect = () => rect(100);
		expiry.getBoundingClientRect = () => rect(300);
		number.focus();
		await settle();
		assert.equal(checkout.anchor(), number);

		expiry.focus();
		await settle();
		mock.timers.tick(BLUR_DELAY_MS * 2);
		assert.equal(showing(), 'prompt');
		assert.equal(checkout.anchor(), expiry);
	});

	it('Escape hides it', async () => {
		const field = addInput({ autocomplete: 'cc-number' });
		field.focus();
		await settle();
		key(field, { key: 'Escape' });
		assert.equal(showing(), false);
	});

	it('ignores Escape and the shortcut outside a card field', async () => {
		const email = doc.getElementById('email') as HTMLInputElement;
		addInput({ autocomplete: 'cc-number' }).focus();
		await settle();
		const event = key(email, SHORTCUT);
		key(email, { key: 'Escape' });
		assert.equal(event.defaultPrevented, false);
		assert.equal(showing(), 'prompt');
	});

	it('Alt+Shift+C moves focus into the prompt', async () => {
		const field = addInput({ autocomplete: 'cc-number' });
		field.focus();
		await settle();
		const event = key(field, SHORTCUT);
		await settle();
		assert.equal(event.defaultPrevented, true);
		assert.equal(host()?.shadowRoot?.activeElement?.textContent?.trim(), 'Capital One');
	});

	it('Alt+Shift+C opens the prompt first when only the icon shows', async () => {
		chromeMock.setStored({ checkoutAutoOpen: false });
		const field = addInput({ autocomplete: 'cc-number' });
		field.focus();
		await settle();
		key(field, SHORTCUT);
		await settle();
		assert.equal(showing(), 'prompt');
		assert.equal(host()?.shadowRoot?.activeElement?.textContent?.trim(), 'Capital One');
	});

	it('stays open once the shortcut has moved focus into the prompt', async () => {
		mock.timers.enable({ apis: ['setTimeout'] });
		const field = addInput({ autocomplete: 'cc-number' });
		field.focus();
		await settle();
		key(field, SHORTCUT);
		await settle();
		mock.timers.tick(BLUR_DELAY_MS * 2);
		assert.equal(showing(), 'prompt');

		// Escape from inside the prompt still closes it.
		key(host()?.shadowRoot?.activeElement as Element, { key: 'Escape' });
		assert.equal(showing(), false);
	});

	it('Alt+Shift+C re-opens the prompt after ✕ or Escape', async () => {
		const field = addInput({ autocomplete: 'cc-number' });
		field.focus();
		await settle();
		byText('✕').click();
		key(field, SHORTCUT);
		await settle();
		assert.equal(showing(), 'prompt');
		assert.equal(host()?.shadowRoot?.activeElement?.textContent?.trim(), 'Capital One');

		field.focus();
		await settle();
		key(field, { key: 'Escape' });
		assert.equal(showing(), false);
		key(field, SHORTCUT);
		await settle();
		assert.equal(showing(), 'prompt');
	});

	it('Alt+Shift+C shows nothing on a site turned off', async () => {
		chromeMock.setLocal({ checkoutDisabledSites: ['shop.example'] });
		const field = addInput({ autocomplete: 'cc-number' });
		field.focus();
		key(field, SHORTCUT);
		await settle();
		assert.equal(showing(), false);
	});

	it('Escape inside the prompt returns focus to the card field and keeps it closed', async () => {
		const field = addInput({ autocomplete: 'cc-number' });
		field.focus();
		await settle();
		key(field, SHORTCUT);
		await settle();
		assert.equal(doc.activeElement, host());

		key(host()?.shadowRoot?.activeElement as Element, { key: 'Escape' });
		assert.equal(doc.activeElement, field);
		await settle();
		assert.equal(showing(), false);
	});

	it('✕ pressed from the keyboard returns focus to the card field without showing the icon', async () => {
		const field = addInput({ autocomplete: 'cc-number' });
		field.focus();
		await settle();
		key(field, SHORTCUT);
		await settle();
		byText('✕').focus();
		byText('✕').click();
		assert.equal(doc.activeElement, field);
		await settle();
		assert.equal(showing(), false);

		// The next focus shows the icon, as after any ✕.
		field.blur();
		field.focus();
		await settle();
		assert.equal(showing(), 'icon');
	});

	it('hiding leaves focus alone when it is not in the prompt', async () => {
		const field = addInput({ autocomplete: 'cc-number' });
		const email = doc.getElementById('email') as HTMLInputElement;
		field.focus();
		await settle();
		email.focus();
		key(field, { key: 'Escape' });
		assert.equal(doc.activeElement, email);
	});

	it('a pointerdown on another card field does not hide it first', async () => {
		const number = addInput({ autocomplete: 'cc-number' });
		const expiry = addInput({ autocomplete: 'cc-exp' });
		number.focus();
		await settle();
		pointerdown(expiry);
		assert.equal(showing(), 'prompt');
	});

	it('a pointerdown outside hides it', async () => {
		const field = addInput({ autocomplete: 'cc-number' });
		field.focus();
		await settle();
		pointerdown(field);
		pointerdown(byText('Netflix'));
		assert.equal(showing(), 'prompt');
		pointerdown(doc.body);
		assert.equal(showing(), false);
	});

	it('stays in the top-right corner on scroll and resize', async () => {
		const field = addInput({ autocomplete: 'cc-number' });
		let top = 100;
		field.getBoundingClientRect = () => rect(top);
		field.focus();
		await settle();
		assert.equal(host()?.style.top, '8px');
		assert.equal(host()?.style.left, `${dom.window.innerWidth - 260 - 8}px`);
		top = 200;
		doc.body.dispatchEvent(new dom.window.Event('scroll'));
		await new Promise((resolve) => dom.window.requestAnimationFrame(resolve));
		assert.equal(host()?.style.top, '8px');
		Object.defineProperty(dom.window, 'innerWidth', { value: 800, configurable: true });
		dom.window.dispatchEvent(new dom.window.Event('resize'));
		await new Promise((resolve) => dom.window.requestAnimationFrame(resolve));
		assert.equal(host()?.style.left, `${800 - 260 - 8}px`);
	});

	it('never reads the field value', async () => {
		const field = addInput({ autocomplete: 'cc-number' });
		Object.defineProperty(field, 'value', {
			get() {
				throw new Error('value was read');
			},
		});
		field.focus();
		await settle();
		key(field, SHORTCUT);
		await settle();
		key(field, { key: 'Escape' });
		field.blur();
		assert.equal(showing(), false);
	});

	it('stop() removes every listener', async () => {
		checkout.stop();
		addInput({ autocomplete: 'cc-number' }).focus();
		await api.runtime.onMessage.dispatch({ type: 'checkoutFrame', event: 'focus' });
		await settle();
		assert.equal(showing(), false);
		assert.equal(api.runtime.sendMessage.mock.callCount(), 0);
	});
});

describe('startCheckout with focus in a payment iframe (relayed)', () => {
	let iframe: HTMLIFrameElement;

	beforeEach(() => {
		iframe = doc.createElement('iframe');
		iframe.getBoundingClientRect = () => rect(400);
		doc.body.append(iframe);
	});

	function relay(event: 'focus' | 'blur' | 'escape' | 'shortcut'): Promise<unknown[]> {
		return api.runtime.onMessage.dispatch({ type: 'checkoutFrame', event });
	}

	it('shows the prompt anchored to the iframe', async () => {
		iframe.focus();
		assert.equal(doc.activeElement, iframe);
		await relay('focus');
		await settle();
		assert.equal(showing(), 'prompt');
		assert.equal(checkout.anchor(), iframe);
	});

	it('ignores a relayed focus when the active element is not an iframe', async () => {
		(doc.getElementById('email') as HTMLInputElement).focus();
		await relay('focus');
		await settle();
		assert.equal(showing(), false);
	});

	it('ignores messages that are not checkoutFrame messages', async () => {
		iframe.focus();
		await api.runtime.onMessage.dispatch({ type: 'checkoutFrame', event: 'nope' });
		await settle();
		assert.equal(showing(), false);
	});

	it('keeps the prompt open when focus moves between frames', async () => {
		mock.timers.enable({ apis: ['setTimeout'] });
		iframe.focus();
		await relay('focus');
		await settle();

		const expiry = doc.createElement('iframe');
		expiry.getBoundingClientRect = () => rect(500);
		doc.body.append(expiry);
		// Real order: the next frame is already active when the first frame's blur arrives.
		expiry.focus();
		await relay('blur');
		await relay('focus');
		await settle();
		mock.timers.tick(BLUR_DELAY_MS * 2);
		assert.equal(showing(), 'prompt');
		assert.equal(checkout.anchor(), expiry);
	});

	it('keeps the prompt open when focus moves from a frame to a page card field', async () => {
		mock.timers.enable({ apis: ['setTimeout'] });
		const name = addInput({ autocomplete: 'cc-name' });
		name.getBoundingClientRect = () => rect(100);
		iframe.focus();
		await relay('focus');
		await settle();
		// The page field's focusin is immediate; the frame's blur arrives later, through the background.
		name.focus();
		await settle();
		await relay('blur');
		mock.timers.tick(BLUR_DELAY_MS * 2);
		assert.equal(showing(), 'prompt');
		assert.equal(checkout.anchor(), name);
	});

	it('an ignored relayed focus does not cancel a pending hide', async () => {
		mock.timers.enable({ apis: ['setTimeout'] });
		const field = addInput({ autocomplete: 'cc-number' });
		field.focus();
		await settle();
		(doc.getElementById('email') as HTMLInputElement).focus();
		await relay('focus');
		await settle();
		mock.timers.tick(BLUR_DELAY_MS);
		assert.equal(showing(), false);
	});

	it('a relayed shortcut re-opens the prompt after Escape', async () => {
		iframe.focus();
		await relay('focus');
		await settle();
		await relay('escape');
		await relay('shortcut');
		await settle();
		assert.equal(showing(), 'prompt');
		assert.equal(host()?.shadowRoot?.activeElement?.textContent?.trim(), 'Capital One');
	});

	it('hides after a relayed blur', async () => {
		mock.timers.enable({ apis: ['setTimeout'] });
		iframe.focus();
		await relay('focus');
		await settle();
		await relay('blur');
		mock.timers.tick(BLUR_DELAY_MS);
		assert.equal(showing(), false);
	});

	it('a frame blur followed by a prompt click still opens cards', async () => {
		mock.timers.enable({ apis: ['setTimeout'] });
		iframe.focus();
		await relay('focus');
		await settle();
		await relay('blur');
		mock.timers.tick(BLUR_DELAY_MS - 50);
		byText('Capital One').click();
		assert.deepEqual(sent().at(-1), { type: 'openBank', bankId: 'capitalOne', newTab: true });
	});

	it('a press on the prompt holds off a relayed blur until the click lands', async () => {
		mock.timers.enable({ apis: ['setTimeout'] });
		iframe.focus();
		await relay('focus');
		await settle();
		const button = byText('Capital One');
		const down = pointer('pointerdown', button);
		assert.equal(down.defaultPrevented, false);
		// Some browsers move focus out of the frame on the (cancelled) mousedown.
		iframe.blur();
		await relay('blur');
		mock.timers.tick(300);
		assert.equal(showing(), 'prompt');

		pointer('pointerup', button);
		button.click();
		assert.deepEqual(sent().at(-1), { type: 'openBank', bankId: 'capitalOne', newTab: true });
		mock.timers.tick(BLUR_DELAY_MS);
		assert.equal(showing(), false);
	});

	it('a cancelled press hides it if focus did not come back', async () => {
		mock.timers.enable({ apis: ['setTimeout'] });
		iframe.focus();
		await relay('focus');
		await settle();
		const button = byText('Capital One');
		pointer('pointerdown', button);
		iframe.blur();
		await relay('blur');
		mock.timers.tick(300);
		assert.equal(showing(), 'prompt');

		pointer('pointercancel', button);
		mock.timers.tick(1);
		assert.equal(showing(), false);
	});

	it('a released press keeps it when focus is back on a card field', async () => {
		mock.timers.enable({ apis: ['setTimeout'] });
		const field = addInput({ autocomplete: 'cc-number' });
		field.focus();
		await settle();
		const button = byText('Capital One');
		pointer('pointerdown', button);
		field.blur();
		mock.timers.tick(300);
		assert.equal(showing(), 'prompt');

		field.focus();
		await settle();
		pointer('pointercancel', button);
		mock.timers.tick(BLUR_DELAY_MS * 2);
		assert.equal(showing(), 'prompt');
	});

	it('a press that never ends is released by a safety timeout', async () => {
		mock.timers.enable({ apis: ['setTimeout'] });
		iframe.focus();
		await relay('focus');
		await settle();
		pointer('pointerdown', byText('Capital One'));
		iframe.blur();
		await relay('blur');
		mock.timers.tick(PRESS_TIMEOUT_MS - 1);
		assert.equal(showing(), 'prompt');
		mock.timers.tick(2);
		assert.equal(showing(), false);
	});

	it('Escape inside the prompt returns focus to the payment iframe', async () => {
		iframe.focus();
		await relay('focus');
		await settle();
		await relay('shortcut');
		await settle();
		assert.equal(doc.activeElement, host());

		key(host()?.shadowRoot?.activeElement as Element, { key: 'Escape' });
		assert.equal(showing(), false);
		assert.equal(doc.activeElement, iframe);
	});

	it('a relayed escape hides it and a relayed shortcut focuses it', async () => {
		iframe.focus();
		await relay('focus');
		await settle();
		await relay('shortcut');
		await settle();
		assert.equal(host()?.shadowRoot?.activeElement?.textContent?.trim(), 'Capital One');
		await relay('escape');
		assert.equal(showing(), false);
	});
});

describe('startCheckout in a sub-frame', () => {
	let frameDoc: Document;
	let frameCheckout: { stop(): void };

	beforeEach(() => {
		// A real iframe, because jsdom won't let a test redefine window.top.
		const iframe = doc.createElement('iframe');
		doc.body.append(iframe);
		const frameWindow = iframe.contentWindow as Window;
		assert.notEqual(frameWindow.top, frameWindow);
		frameDoc = frameWindow.document;
		frameCheckout = startCheckout(frameWindow, { shadowMode: 'open' });
	});

	afterEach(() => frameCheckout.stop());

	function frameInput(): HTMLInputElement {
		const input = frameDoc.createElement('input');
		input.setAttribute('autocomplete', 'cc-number');
		frameDoc.body.append(input);
		return input;
	}

	it('reports focus and blur to the top frame and draws nothing', async () => {
		const field = frameInput();
		field.focus();
		await settle();
		assert.deepEqual(sent(), [{ type: 'checkoutFrame', event: 'focus' }]);
		assert.equal(frameDoc.querySelector('cardhop-prompt'), null);
		assert.equal(host(), null);

		field.blur();
		assert.deepEqual(sent().at(-1), { type: 'checkoutFrame', event: 'blur' });
	});

	it('reports Escape and the shortcut from a card field only', () => {
		const field = frameInput();
		field.focus();
		key(field, { key: 'Escape' });
		const shortcut = key(field, SHORTCUT);
		assert.equal(shortcut.defaultPrevented, true);
		assert.deepEqual(sent().slice(1), [
			{ type: 'checkoutFrame', event: 'escape' },
			{ type: 'checkoutFrame', event: 'shortcut' },
		]);
	});

	it('ignores other fields', () => {
		const other = frameDoc.createElement('input');
		other.setAttribute('name', 'email');
		frameDoc.body.append(other);
		other.focus();
		key(other, { key: 'Escape' });
		other.blur();
		assert.deepEqual(sent(), []);
	});
});
