import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';
import { JSDOM } from 'jsdom';
import type { CheckoutButton } from '../src/checkout-messages.ts';
import { createPromptUI } from '../src/checkout/prompt.ts';
import type { PromptHandlers, PromptUI } from '../src/checkout/prompt.ts';
import { PRESS_TIMEOUT_MS } from '../src/checkout/prompt.ts';

let dom: JSDOM;
let doc: Document;
let anchor: HTMLInputElement;
let handlers: { [K in keyof PromptHandlers]: ReturnType<typeof mock.fn<PromptHandlers[K]>> };
let ui: PromptUI;

const buttons: CheckoutButton[] = [
	{ label: 'Capital One', bankId: 'capitalOne', bankName: 'Capital One' },
	{ label: 'Netflix', bankId: 'capitalOne', bankName: 'Capital One', cardId: 'c1' },
	{ label: 'Citi', bankId: 'citi', bankName: 'Citi' },
];

function root(): ShadowRoot {
	const host = doc.querySelector('cardhop-prompt');
	assert.ok(host?.shadowRoot, 'host with an open shadow root');
	return host.shadowRoot;
}

function shadowButtons(): HTMLButtonElement[] {
	return [...root().querySelectorAll('button')];
}

function byText(text: string): HTMLButtonElement {
	const found = shadowButtons().find((button) => button.textContent?.trim() === text);
	assert.ok(found, `button "${text}"`);
	return found;
}

beforeEach(() => {
	dom = new JSDOM('<!doctype html><body><input id="a" autocomplete="cc-number"></body>');
	doc = dom.window.document;
	anchor = doc.getElementById('a') as HTMLInputElement;
	handlers = {
		onOpen: mock.fn(),
		onClose: mock.fn(),
		onDisableSite: mock.fn(),
		onOpenSettings: mock.fn(),
		onIconClick: mock.fn(),
		onPressChange: mock.fn(),
	};
	ui = createPromptUI(doc, handlers, { shadowMode: 'open' });
});

describe('createPromptUI', () => {
	it('creates the host lazily', () => {
		assert.equal(doc.querySelector('cardhop-prompt'), null);
		ui.showPrompt(anchor, buttons);
		const host = doc.querySelector('cardhop-prompt') as HTMLElement;
		assert.equal(host.parentElement, doc.documentElement);
		assert.match(host.style.cssText, /position:\s*fixed/);
		assert.match(host.style.cssText, /z-index:\s*2147483647/);
	});

	it('defaults to a closed shadow root', () => {
		const closed = createPromptUI(doc, handlers);
		closed.showPrompt(anchor, buttons);
		assert.equal(doc.querySelector('cardhop-prompt')?.shadowRoot, null);
	});

	it('renders one button per item in order, grouped under each bank, and calls onOpen with the item', () => {
		ui.showPrompt(anchor, buttons);
		const items = [...root().querySelectorAll<HTMLButtonElement>('.items button.secondary')];
		assert.deepEqual(items.map((b) => b.textContent?.trim()), ['Capital One', 'Netflix', 'Citi']);
		assert.deepEqual([...root().querySelectorAll('.group > .bank')].map((n) => n.textContent), ['Capital One', 'Citi']);
		assert.deepEqual([...root().querySelectorAll('.group')].map((g) => g.querySelectorAll('button').length), [2, 1]);
		items[1]?.click();
		assert.equal(handlers.onOpen.mock.callCount(), 1);
		assert.deepEqual(handlers.onOpen.mock.calls[0]?.arguments[0], buttons[1]);
	});

	it('✕ calls onClose and Not on this site calls onDisableSite', () => {
		ui.showPrompt(anchor, buttons);
		const close = byText('✕');
		assert.equal(close.getAttribute('aria-label'), 'Close');
		close.click();
		assert.equal(handlers.onClose.mock.callCount(), 1);
		byText('Not on this site').click();
		assert.equal(handlers.onDisableSite.mock.callCount(), 1);
	});

	it('shows a settings prompt when there are no buttons', () => {
		ui.showPrompt(anchor, []);
		assert.match(root().textContent ?? '', /Choose your bank in CardHop's settings/);
		const open = shadowButtons().find((b) => b !== byText('✕') && b !== byText('Not on this site'));
		assert.ok(open);
		open.click();
		assert.equal(handlers.onOpenSettings.mock.callCount(), 1);
	});

	it('showIcon renders a single button that calls onIconClick', () => {
		ui.showIcon(anchor);
		assert.equal(ui.isShowing(), 'icon');
		const all = shadowButtons();
		assert.equal(all.length, 1);
		all[0]?.click();
		assert.equal(handlers.onIconClick.mock.callCount(), 1);
	});

	it('draws the CardHop icon as SVG elements, without innerHTML', () => {
		// addons-linter flags innerHTML assignments, even of a constant.
		const proto = dom.window.Element.prototype;
		const descriptor = Object.getOwnPropertyDescriptor(proto, 'innerHTML');
		assert.ok(descriptor);
		Object.defineProperty(proto, 'innerHTML', {
			...descriptor,
			set() {
				throw new Error('innerHTML was set');
			},
		});
		try {
			ui.showPrompt(anchor, buttons);
			ui.showIcon(anchor);
		} finally {
			Object.defineProperty(proto, 'innerHTML', descriptor);
		}

		const svg = root().querySelector('button.icon svg');
		assert.ok(svg);
		assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg');
		assert.equal(svg.getAttribute('viewBox'), '0 0 128 128');
		assert.equal(svg.getAttribute('width'), '20');
		assert.equal(svg.getAttribute('height'), '20');
		assert.equal(svg.getAttribute('aria-hidden'), 'true');
		assert.equal(svg.getAttribute('focusable'), 'false');
		assert.deepEqual([...svg.children].map((child) => child.localName), ['rect', 'rect', 'rect', 'rect', 'circle', 'polygon']);
		assert.ok([...svg.children].every((child) => child.namespaceURI === 'http://www.w3.org/2000/svg'));
		assert.equal(svg.querySelector('circle')?.getAttribute('fill'), '#22a06b');
		assert.equal(svg.querySelector('polygon')?.getAttribute('points'), '88,76 108,76 108,96 101,89 90,100 84,94 95,83');
	});

	it('mousedown inside the prompt is cancelled so focus stays in the card field', () => {
		ui.showPrompt(anchor, buttons);
		const event = new dom.window.Event('mousedown', { bubbles: true, cancelable: true, composed: true });
		shadowButtons()[1]?.dispatchEvent(event);
		assert.equal(event.defaultPrevented, true);
	});

	it('does not cancel pointerdown', () => {
		// Cancelling pointerdown suppresses the compatibility mousedown, which is what must be cancelled.
		ui.showPrompt(anchor, buttons);
		const event = new dom.window.Event('pointerdown', { bubbles: true, cancelable: true, composed: true });
		shadowButtons()[1]?.dispatchEvent(event);
		assert.equal(event.defaultPrevented, false);
	});

	it('reports a press from pointerdown until click, pointerup or pointercancel', () => {
		ui.showPrompt(anchor, buttons);
		const pressed = () => handlers.onPressChange.mock.calls.map((call) => call.arguments[0]);
		for (const release of ['click', 'pointerup', 'pointercancel']) {
			shadowButtons()[1]?.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true, composed: true }));
			assert.equal(ui.isPressed(), true);
			// Released on the document: the pointer may come up outside the prompt.
			doc.body.dispatchEvent(new dom.window.Event(release, { bubbles: true, composed: true }));
			assert.equal(ui.isPressed(), false, release);
		}
		assert.deepEqual(pressed(), [true, false, true, false, true, false]);
	});

	it('releases a press after a safety timeout', () => {
		mock.timers.enable({ apis: ['setTimeout'] });
		try {
			ui.showPrompt(anchor, buttons);
			shadowButtons()[1]?.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true, composed: true }));
			mock.timers.tick(PRESS_TIMEOUT_MS - 1);
			assert.equal(ui.isPressed(), true);
			mock.timers.tick(1);
			assert.equal(ui.isPressed(), false);
			assert.deepEqual(handlers.onPressChange.mock.calls.map((call) => call.arguments[0]), [true, false]);
		} finally {
			mock.timers.reset();
		}
	});

	it('re-attaches the host if the page detached it', () => {
		ui.showPrompt(anchor, buttons);
		doc.querySelector('cardhop-prompt')?.remove();
		ui.showPrompt(anchor, buttons);
		assert.ok(doc.querySelector('cardhop-prompt')?.isConnected);
		assert.equal(shadowButtons().length, 5);
	});

	it('reposition hides it once the anchor is removed', () => {
		ui.showPrompt(anchor, buttons);
		assert.equal(ui.isShowing(), 'prompt');
		anchor.remove();
		ui.reposition();
		assert.equal(ui.isShowing(), false);
	});

	it('puts the prompt in the top-right corner, wherever the field is', () => {
		anchor.getBoundingClientRect = () => ({ top: 0, left: 0, width: 1024, height: 768, bottom: 768, right: 1024, x: 0, y: 0, toJSON() {} });
		ui.showPrompt(anchor, buttons);
		const host = doc.querySelector<HTMLElement>('cardhop-prompt');
		assert.equal(host?.style.top, '8px');
		assert.equal(host?.style.left, `${doc.defaultView!.innerWidth - 260 - 8}px`);
	});

	it('keeps the corner prompt when the field scrolls out of view', () => {
		anchor.getBoundingClientRect = () => ({ top: -100, left: 0, width: 100, height: 40, bottom: -60, right: 100, x: 0, y: -100, toJSON() {} });
		ui.showPrompt(anchor, buttons);
		ui.reposition();
		assert.equal(ui.isShowing(), 'prompt');
	});

	it('reposition hides the field icon when the field is out of view', () => {
		anchor.getBoundingClientRect = () => ({ top: -100, left: 0, width: 100, height: 40, bottom: -60, right: 100, x: 0, y: -100, toJSON() {} });
		ui.showIcon(anchor);
		ui.reposition();
		assert.equal(ui.isShowing(), false);
	});

	it('hide removes the prompt', () => {
		ui.showPrompt(anchor, buttons);
		ui.hide();
		assert.equal(ui.isShowing(), false);
		assert.equal(root().querySelectorAll('button').length, 0);
	});

	it('labels the dialog', () => {
		ui.showPrompt(anchor, buttons);
		const dialog = root().querySelector('[role="dialog"]');
		assert.equal(dialog?.getAttribute('aria-label'), 'CardHop virtual cards');
	});

	it('contains() recognises the host', () => {
		ui.showPrompt(anchor, buttons);
		assert.equal(ui.contains(doc.querySelector('cardhop-prompt') as Element), true);
		assert.equal(ui.contains(anchor), false);
	});

	it('focusFirst focuses the first button', () => {
		ui.showPrompt(anchor, buttons);
		ui.focusFirst();
		assert.equal(root().activeElement?.textContent?.trim(), 'Capital One');
	});

	it('never reads the anchor value', () => {
		Object.defineProperty(anchor, 'value', {
			get() {
				throw new Error('value was read');
			},
		});
		ui.showPrompt(anchor, buttons);
		ui.reposition();
		ui.showIcon(anchor);
		ui.reposition();
		ui.focusFirst();
		ui.hide();
	});
});
