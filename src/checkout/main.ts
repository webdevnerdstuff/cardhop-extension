import { isCheckoutFrameMessage } from '../checkout-messages.ts';
import type { CheckoutButton, CheckoutFrameMessage, FrameEvent } from '../checkout-messages.ts';
import { disableSite, getDisabledSites } from '../checkout-sites.ts';
import { ext } from '../ext.ts';
import type { OpenBankMessage } from '../open.ts';
import { getSettings } from '../shared.ts';
import { cardFieldFromEvent, isCardField } from './detect.ts';
import { createPromptUI } from './prompt.ts';

// How long a blur waits before hiding, so focus can reach the next card field (or the next
// payment iframe, whose focus arrives via the background) and keep the prompt open.
export const BLUR_DELAY_MS = 150;

export interface CheckoutOptions {
	shadowMode?: ShadowRootMode;
}

type Cleanup = () => void;

// The background may be unreachable (extension reloaded or updated); the page must never see that.
function send(message: unknown): Promise<unknown> {
	try {
		return Promise.resolve(ext.runtime.sendMessage(message)).catch(() => undefined);
	} catch {
		return Promise.resolve(undefined);
	}
}

function listen<E extends Event>(cleanups: Cleanup[], target: EventTarget, type: string, handler: (event: E) => void, capture = false): void {
	const listener = handler as EventListener;
	target.addEventListener(type, listener, capture);
	cleanups.push(() => target.removeEventListener(type, listener, capture));
}

// event.code, because Alt+Shift+C types "Ç" on macOS.
function isShortcut(event: KeyboardEvent): boolean {
	return event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey
		&& (event.code === 'KeyC' || event.key.toLowerCase() === 'c');
}

// When focus is in a frame, the frame's own document sees it; the top document's active element is the outermost <iframe>.
function deepActiveElement(doc: Document): Element | null {
	let active = doc.activeElement;
	while (active?.shadowRoot?.activeElement) {
		active = active.shadowRoot.activeElement;
	}
	return active;
}

// A sub-frame never draws: it reports card-field focus to the top frame, which owns the one prompt.
export interface CheckoutController {
	// What the prompt is showing for: a card field or a payment iframe. Always undefined in a sub-frame.
	anchor(): Element | undefined;
	stop(): void;
}

function startFrame(win: Window): CheckoutController {
	const cleanups: Cleanup[] = [];
	const report = (event: FrameEvent) => void send({ type: 'checkoutFrame', event } satisfies CheckoutFrameMessage);

	listen<FocusEvent>(cleanups, win.document, 'focusin', (event) => {
		if (cardFieldFromEvent(event)) {
			report('focus');
		}
	}, true);
	listen<FocusEvent>(cleanups, win.document, 'focusout', (event) => {
		if (cardFieldFromEvent(event)) {
			report('blur');
		}
	}, true);
	listen<KeyboardEvent>(cleanups, win.document, 'keydown', (event) => {
		if (!cardFieldFromEvent(event)) {
			return;
		}
		if (event.key === 'Escape') {
			report('escape');
		} else if (isShortcut(event)) {
			event.preventDefault();
			report('shortcut');
		}
	}, true);

	return { anchor: () => undefined, stop: () => cleanups.splice(0).forEach((cleanup) => cleanup()) };
}

function startTop(win: Window, options: CheckoutOptions): CheckoutController {
	const doc = win.document;
	const hostname = win.location.hostname;
	const cleanups: Cleanup[] = [];
	let anchor: Element | undefined;
	let closedThisPage = false;
	let hideTimer: ReturnType<typeof setTimeout> | undefined;
	// A blur's hide came due during a press on the prompt, and waits for the press to end.
	let hideDue = false;
	// Set while hide() hands focus back to the anchor, so that focus doesn't re-open the prompt.
	let restoringFocus = false;
	let frame = 0;
	// Bumped by every show and hide, so an async show that finishes late can't draw over a newer decision.
	let token = 0;

	const ui = createPromptUI(doc, {
		onOpen(button) {
			const message: OpenBankMessage = {
				type: 'openBank',
				bankId: button.bankId,
				...(button.cardId === undefined ? {} : { cardId: button.cardId }),
				newTab: true,
			};
			void send(message);
			hide();
		},
		onClose() {
			closedThisPage = true;
			hide();
		},
		onDisableSite() {
			void disableSite(hostname).catch(() => {});
			hide();
		},
		onOpenSettings() {
			void send({ type: 'openOptions' });
		},
		onIconClick() {
			if (anchor) {
				void show(anchor, true);
			}
		},
		// Some browsers move focus out of a payment iframe on the (cancelled) mousedown, so the frame's
		// blur can arrive mid-click. Re-checked once the press ends: after pointerup, the click comes first.
		onPressChange(pressing) {
			if (!pressing && hideDue) {
				hideDue = false;
				scheduleHide(0);
			}
		},
	}, { shadowMode: options.shadowMode });

	function cancelHide(): void {
		hideDue = false;
		if (hideTimer !== undefined) {
			clearTimeout(hideTimer);
			hideTimer = undefined;
		}
	}

	function focusInPrompt(): boolean {
		return doc.activeElement !== null && ui.contains(doc.activeElement);
	}

	function hide(): void {
		// Removing the focused button would drop focus to <body>; hand it back to the field (or its iframe).
		const returnTo = focusInPrompt() ? anchor : undefined;
		if (returnTo && 'focus' in returnTo && typeof returnTo.focus === 'function') {
			restoringFocus = true;
			try {
				(returnTo as HTMLElement).focus();
			} finally {
				restoringFocus = false;
			}
		}
		token += 1;
		cancelHide();
		ui.hide();
	}

	function scheduleHide(delay = BLUR_DELAY_MS): void {
		cancelHide();
		hideTimer = setTimeout(() => {
			hideTimer = undefined;
			if (ui.isPressed()) {
				hideDue = true;
				return;
			}
			// It stays if focus moved into the prompt (the shortcut), or is already on a page card field:
			// a frame's blur, relayed through the background, can arrive after that field's focusin.
			const active = deepActiveElement(doc);
			if (!focusInPrompt() && !(active && isCardField(active))) {
				hide();
			}
		}, delay);
	}

	async function fetchButtons(): Promise<CheckoutButton[]> {
		const response = await send({ type: 'checkoutButtons' });
		return Array.isArray(response) ? response as CheckoutButton[] : [];
	}

	async function show(target: Element, forcePrompt: boolean): Promise<void> {
		cancelHide();
		token += 1;
		const current = token;
		try {
			const [sites, settings] = await Promise.all([getDisabledSites(), getSettings()]);
			if (current !== token) {
				return;
			}
			if (sites.includes(hostname.toLowerCase())) {
				ui.hide();
				return;
			}
			if (!forcePrompt && (!settings.checkoutAutoOpen || closedThisPage)) {
				anchor = target;
				ui.showIcon(target);
				return;
			}
			const buttons = await fetchButtons();
			if (current === token) {
				anchor = target;
				ui.showPrompt(target, buttons);
			}
		} catch {
			// Storage unavailable (extension reloaded): show nothing rather than break the page.
		}
	}

	// The focused card field, or for a frame's message the iframe that has focus. A relayed event is
	// only trusted when focus really is in a frame.
	function targetFor(field?: Element): Element | undefined {
		if (field) {
			return field;
		}
		const active = deepActiveElement(doc);
		return active?.localName === 'iframe' ? active : undefined;
	}

	// Also re-opens the prompt after ✕ or Escape: the shortcut is an explicit request.
	async function shortcut(target?: Element): Promise<void> {
		const on = target ?? (ui.isShowing() ? anchor : undefined);
		if (ui.isShowing() !== 'prompt' && on) {
			await show(on, true);
		}
		if (ui.isShowing() === 'prompt') {
			ui.focusFirst();
		}
	}

	function handle(event: FrameEvent, field?: Element): void {
		if (event === 'focus') {
			const target = targetFor(field);
			if (target) {
				void show(target, false);
			}
		} else if (event === 'blur') {
			scheduleHide();
		} else if (event === 'escape') {
			hide();
		} else {
			void shortcut(targetFor(field));
		}
	}

	function onMessage(message: unknown): void {
		if (isCheckoutFrameMessage(message)) {
			handle(message.event);
		}
	}

	listen<FocusEvent>(cleanups, doc, 'focusin', (event) => {
		const field = cardFieldFromEvent(event);
		if (field && !restoringFocus) {
			handle('focus', field);
		}
	}, true);
	listen<FocusEvent>(cleanups, doc, 'focusout', (event) => {
		// Events from inside the prompt are retargeted to its host.
		if (cardFieldFromEvent(event) || (event.target && ui.contains(event.target))) {
			handle('blur');
		}
	}, true);
	listen<KeyboardEvent>(cleanups, doc, 'keydown', (event) => {
		if (!cardFieldFromEvent(event) && !(event.target && ui.contains(event.target))) {
			return;
		}
		if (event.key === 'Escape') {
			handle('escape');
		} else if (isShortcut(event)) {
			event.preventDefault();
			handle('shortcut', cardFieldFromEvent(event));
		}
	}, true);
	listen<PointerEvent>(cleanups, doc, 'pointerdown', (event) => {
		// A press on another card field leaves it to that field's focusin, which moves the prompt without a flicker.
		if (!ui.isShowing() || (event.target && ui.contains(event.target)) || (anchor && event.composedPath().includes(anchor))
			|| cardFieldFromEvent(event)) {
			return;
		}
		hide();
	}, true);

	const onLayout = () => {
		if (frame === 0 && ui.isShowing()) {
			frame = win.requestAnimationFrame(() => {
				frame = 0;
				ui.reposition();
			});
		}
	};
	// Capture, so scrolling inside any scroll container counts.
	listen(cleanups, win, 'scroll', onLayout, true);
	listen(cleanups, win, 'resize', onLayout);

	ext.runtime.onMessage.addListener(onMessage);
	cleanups.push(() => ext.runtime.onMessage.removeListener(onMessage));

	return {
		// The card field (or payment iframe) the prompt belongs to. The prompt itself sits in a fixed corner.
		anchor: () => (ui.isShowing() ? anchor : undefined),
		stop() {
			cleanups.splice(0).forEach((cleanup) => cleanup());
			if (frame !== 0) {
				win.cancelAnimationFrame(frame);
				frame = 0;
			}
			hide();
		},
	};
}

// Every frame runs this; only the top frame decides and draws.
export function startCheckout(win: Window, options: CheckoutOptions = {}): CheckoutController {
	return win.top === win ? startTop(win, options) : startFrame(win);
}
