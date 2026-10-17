import type { CheckoutButton } from '../checkout-messages.ts';
import { ICON_SIZE, isInView, placeIcon, placePromptCorner, PROMPT_WIDTH } from './position.ts';

export interface PromptHandlers {
	onOpen(button: CheckoutButton): void;
	onClose(): void;
	onDisableSite(): void;
	onOpenSettings(): void;
	onIconClick(): void;
	// A press on the prompt started (true) or ended (false). A click lands only at the end of a press,
	// so the prompt must not be hidden while one is in progress.
	onPressChange(pressing: boolean): void;
}

export interface PromptUI {
	showPrompt(anchor: Element, buttons: CheckoutButton[]): void;
	showIcon(anchor: Element): void;
	hide(): void;
	reposition(): void; // hides itself if the anchor is disconnected, or (field icon only) out of view
	isShowing(): 'prompt' | 'icon' | false;
	contains(node: EventTarget): boolean; // events from inside the shadow root are retargeted to the host
	focusFirst(): void;
	isPressed(): boolean;
}

// src/icons/icon.svg, inlined: with no web_accessible_resources, pages can't fetch it to detect the extension.
// Built element by element rather than parsed from markup, so nothing is assigned to innerHTML.
const SVG_NS = 'http://www.w3.org/2000/svg';
const ICON_SVG: { attributes: Record<string, string>; children: [string, Record<string, string>][] } = {
	attributes: { viewBox: '0 0 128 128', width: `${ICON_SIZE}`, height: `${ICON_SIZE}`, 'aria-hidden': 'true', focusable: 'false' },
	children: [
		['rect', { x: '4', y: '4', width: '120', height: '120', rx: '28', fill: '#d6e6f5' }],
		['rect', { x: '18', y: '34', width: '80', height: '54', rx: '9', fill: '#2f86d6' }],
		['rect', { x: '18', y: '45', width: '80', height: '10', fill: '#0f4f8a' }],
		['rect', { x: '27', y: '67', width: '26', height: '7', rx: '3.5', fill: '#a9d0f2' }],
		['circle', { cx: '96', cy: '88', r: '24', fill: '#22a06b', stroke: '#d6e6f5', 'stroke-width': '5' }],
		['polygon', { points: '88,76 108,76 108,96 101,89 90,100 84,94 95,83', fill: '#ffffff' }],
	],
};

// A press that never reports its end (pointerup outside the window, a lost event) stops counting after this.
export const PRESS_TIMEOUT_MS = 1000;

// Colours match src/popup/popup.css.
const STYLES = `
:host { --bg: #ffffff; --fg: #1b1f24; --muted: #5b6672; --border: #dde3ea; --brand: #0b3b60; --tint: #e8eef4; --tint-hover: #d9e3ed; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :host { --bg: #1d2127; --fg: #e9edf1; --muted: #a1abb6; --border: #343b44; --brand: #3d8bd0; --tint: #25303c; --tint-hover: #2e3c4b; } }
* { box-sizing: border-box; }
.panel { width: ${PROMPT_WIDTH}px; padding: 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg); color: var(--fg); box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25); font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-weight: 600; }
.header svg { flex: none; }
.title { flex: 1; }
.close { padding: 2px 6px; border: 0; border-radius: 6px; background: transparent; color: var(--muted); font: inherit; cursor: pointer; }
.items { display: flex; flex-direction: column; gap: 12px; }
.group { display: flex; flex-direction: column; gap: 6px; }
.bank { margin: 0; color: var(--muted); font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.empty { margin: 0; color: var(--muted); font-size: 13px; }
.secondary { width: 100%; padding: 8px 12px; border: 0; border-radius: 8px; background: var(--tint); color: var(--brand); font: inherit; font-weight: 600; cursor: pointer; }
.secondary:hover { background: var(--tint-hover); }
.disable { display: block; margin: 10px 0 0; padding: 0; border: 0; background: transparent; color: var(--muted); font: inherit; font-size: 12px; text-decoration: underline; cursor: pointer; }
.icon { display: block; width: ${ICON_SIZE}px; height: ${ICON_SIZE}px; padding: 0; border: 0; background: transparent; cursor: pointer; }
button:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
`;

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
	const node = doc.createElement(tag);
	if (className) {
		node.className = className;
	}
	if (text !== undefined) {
		node.textContent = text;
	}
	return node;
}

export function createPromptUI(doc: Document, handlers: PromptHandlers, options: { shadowMode?: ShadowRootMode } = {}): PromptUI {
	let host: HTMLElement | undefined;
	let shadow: ShadowRoot | undefined;
	let content: HTMLElement | undefined;
	let mode: 'prompt' | 'icon' | false = false;
	let anchor: Element | undefined;
	let pressed = false;
	let pressTimer: ReturnType<typeof setTimeout> | undefined;

	const release = () => setPressed(false);
	// On the document, capturing: the pointer may come up outside the prompt.
	const RELEASE_EVENTS = ['click', 'pointerup', 'pointercancel'];

	function setPressed(next: boolean): void {
		if (pressed === next) {
			return;
		}
		pressed = next;
		if (next) {
			pressTimer = setTimeout(release, PRESS_TIMEOUT_MS);
			RELEASE_EVENTS.forEach((type) => doc.addEventListener(type, release, true));
		} else {
			clearTimeout(pressTimer);
			pressTimer = undefined;
			RELEASE_EVENTS.forEach((type) => doc.removeEventListener(type, release, true));
		}
		handlers.onPressChange(next);
	}

	// Created on first use, so pages that never show the prompt get no extra element.
	function ensureHost(): ShadowRoot {
		if (shadow && host) {
			// The page may have detached the host (documentElement rewritten, document.open()).
			if (!host.isConnected) {
				doc.documentElement.append(host);
			}
			return shadow;
		}

		host = doc.createElement('cardhop-prompt');
		host.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; z-index: 2147483647;';
		shadow = host.attachShadow({ mode: options.shadowMode ?? 'closed' });
		shadow.append(el(doc, 'style', undefined, STYLES));

		// Focus moves as mousedown's default action, so that is what keeps focus in the card field (or its
		// iframe) while buttons are clicked. Don't cancel pointerdown: that would suppress the mousedown
		// event, and with it the only place the focus change can be cancelled.
		shadow.addEventListener('mousedown', (event) => event.preventDefault());
		shadow.addEventListener('pointerdown', () => setPressed(true));

		doc.documentElement.append(host);
		return shadow;
	}

	function svgElement(tag: string, attributes: Record<string, string>): SVGElement {
		const node = doc.createElementNS(SVG_NS, tag) as SVGElement;
		for (const [name, value] of Object.entries(attributes)) {
			node.setAttribute(name, value);
		}
		return node;
	}

	function iconMarkup(): HTMLElement {
		const svg = svgElement('svg', ICON_SVG.attributes);
		svg.append(...ICON_SVG.children.map(([tag, attributes]) => svgElement(tag, attributes)));
		const span = el(doc, 'span');
		span.append(svg);
		return span;
	}

	function action(className: string, label: string, onClick: () => void): HTMLButtonElement {
		const button = el(doc, 'button', className, label);
		button.type = 'button';
		button.addEventListener('click', onClick);
		return button;
	}

	function mount(node: HTMLElement): void {
		content?.remove();
		content = node;
		ensureHost().append(node);
	}

	function buildPrompt(buttons: CheckoutButton[]): HTMLElement {
		const panel = el(doc, 'div', 'panel');
		panel.setAttribute('role', 'dialog');
		panel.setAttribute('aria-label', 'CardHop virtual cards');

		const header = el(doc, 'div', 'header');
		const close = action('close', '✕', () => handlers.onClose());
		close.setAttribute('aria-label', 'Close');
		header.append(iconMarkup(), el(doc, 'span', 'title', 'CardHop'), close);

		const items = el(doc, 'div', 'items');
		if (buttons.length === 0) {
			items.append(
				el(doc, 'p', 'empty', 'Choose your bank in CardHop\'s settings'),
				action('secondary', 'Open settings', () => handlers.onOpenSettings()),
			);
		}
		// One group per bank, under the bank's name, like the popup.
		for (const bankId of new Set(buttons.map((button) => button.bankId))) {
			const bankButtons = buttons.filter((item) => item.bankId === bankId);
			const group = el(doc, 'div', 'group');
			group.append(el(doc, 'p', 'bank', bankButtons[0]?.bankName ?? ''));
			for (const button of bankButtons) {
				group.append(action('secondary', button.label, () => handlers.onOpen(button)));
			}
			items.append(group);
		}

		panel.append(header, items, action('disable', 'Not on this site', () => handlers.onDisableSite()));
		return panel;
	}

	function show(target: Element, node: HTMLElement, next: 'prompt' | 'icon'): void {
		anchor = target;
		mode = next;
		mount(node);
		reposition();
	}

	function hide(): void {
		content?.remove();
		content = undefined;
		mode = false;
		anchor = undefined;
	}

	function reposition(): void {
		if (!mode || !anchor || !content || !host) {
			return;
		}

		const viewport = { width: doc.defaultView?.innerWidth ?? 0, height: doc.defaultView?.innerHeight ?? 0 };
		if (!anchor.isConnected) {
			hide();
			return;
		}

		let spot = placePromptCorner(viewport);
		if (mode === 'icon') {
			// The icon sits inside the field, so it goes when the field scrolls away. The corner prompt stays.
			const rect = anchor.getBoundingClientRect();
			if (!isInView(rect, viewport)) {
				hide();
				return;
			}
			spot = placeIcon(rect);
		}
		host.style.top = `${spot.top}px`;
		host.style.left = `${spot.left}px`;
	}

	return {
		showPrompt: (target, buttons) => show(target, buildPrompt(buttons), 'prompt'),
		showIcon(target) {
			const button = action('icon', '', () => handlers.onIconClick());
			button.setAttribute('aria-label', 'Show CardHop virtual cards');
			button.append(iconMarkup());
			show(target, button, 'icon');
		},
		hide,
		reposition,
		isShowing: () => mode,
		contains: (node) => node === host,
		focusFirst() {
			const first = content?.querySelector<HTMLElement>('.items button') ?? content?.querySelector<HTMLElement>('button');
			first?.focus();
		},
		isPressed: () => pressed,
	};
}
