import { BANK_IDS, bankLabel, BANKS } from './shared.ts';
import type { BankId, Settings } from './shared.ts';
// Type-only: this file is bundled into the content script, which must not pull in saved-cards.ts.
import type { SavedCard } from './saved-cards.ts';

// What a card field's frame tells the top frame, so one prompt can follow focus across iframes.
export type FrameEvent = 'focus' | 'blur' | 'escape' | 'shortcut';

const FRAME_EVENTS: readonly FrameEvent[] = ['focus', 'blur', 'escape', 'shortcut'];

export interface CheckoutFrameMessage {
	type: 'checkoutFrame';
	event: FrameEvent;
}

// The prompt asks the background for the buttons to show.
export interface CheckoutButtonsRequest {
	type: 'checkoutButtons';
}

// The empty prompt links to the settings page, which only the background can open.
export interface OpenOptionsRequest {
	type: 'openOptions';
}

export interface CheckoutButton {
	label: string;
	bankId: BankId;
	// The prompt groups buttons under this heading. It can't look it up itself: it runs without the extension API.
	bankName: string;
	cardId?: string;
}

function hasType(value: unknown, type: string): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && (value as Record<string, unknown>).type === type;
}

export function isCheckoutFrameMessage(value: unknown): value is CheckoutFrameMessage {
	return hasType(value, 'checkoutFrame') && FRAME_EVENTS.includes(value.event as FrameEvent);
}

export function isCheckoutButtonsRequest(value: unknown): value is CheckoutButtonsRequest {
	return hasType(value, 'checkoutButtons');
}

export function isOpenOptionsRequest(value: unknown): value is OpenOptionsRequest {
	return hasType(value, 'openOptions');
}

// Same order and labels as the popup: each bank's general page, then its saved cards.
export function buildCheckoutButtons(
	settings: Pick<Settings, 'banks' | 'bankLabels'>,
	cards: readonly SavedCard[],
): CheckoutButton[] {
	return BANK_IDS
		.filter((bankId) => settings.banks.includes(bankId))
		.flatMap((bankId): CheckoutButton[] => [
			{ label: bankLabel(bankId, settings), bankId, bankName: BANKS[bankId].name },
			...cards
				.filter((card) => card.bankId === bankId)
				.map((card): CheckoutButton => ({ label: card.label, bankId, bankName: BANKS[bankId].name, cardId: card.id })),
		]);
}
