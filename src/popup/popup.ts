import { hasCheckoutAccess, removeCheckoutAccess, requestCheckoutAccess } from '../checkout-access.ts';
import { enableSite, getDisabledSites } from '../checkout-sites.ts';
import { ext } from '../ext.ts';
import { requestOpen } from '../open.ts';
import {
	addSavedCard,
	bankForCardUrl,
	CardPageError,
	defaultLabel,
	forgetAllCards,
	getSavedCards,
	isSaved,
	removeSavedCard,
	renameSavedCard,
} from '../saved-cards.ts';
import type { SavedCard } from '../saved-cards.ts';
import {
	BANK_IDS,
	bankLabel,
	BANKS,
	canOpenDirectly,
	DEFAULT_SETTINGS,
	getSettings,
	isBankId,
	MAX_LABEL_LENGTH,
	OPEN_IN,
	renameBank,
	resetBankLabel,
	saveSettings,
	signInReturnFor,
} from '../shared.ts';
import type { BankId, OpenIn, Settings } from '../shared.ts';
import * as signInReturn from '../sign-in-return.ts';

const OPEN_DIRECTLY_NOTE = 'To get back here, right-click the icon and choose Options.';
const OPEN_DIRECTLY_DISABLED_NOTE = 'Only available with one bank and no saved card pages.';

function byId<T extends HTMLElement>(id: string): T {
	const element = document.getElementById(id);
	if (!element) {
		throw new Error(`popup.html is missing #${id}`);
	}
	return element as T;
}

const chooseBank = byId<HTMLParagraphElement>('choose-bank');
const openButtons = byId<HTMLDivElement>('open-buttons');
const signInHint = byId<HTMLParagraphElement>('sign-in-hint');
const signInReturnOptions = byId<HTMLDivElement>('sign-in-return-options');
const saveCurrent = byId<HTMLElement>('save-current');
const saveCurrentLabel = byId<HTMLInputElement>('save-current-label');
const saveCurrentButton = byId<HTMLButtonElement>('save-current-button');
const savedCardsTip = byId<HTMLElement>('saved-cards-tip');
const dismissTipButton = byId<HTMLButtonElement>('dismiss-tip');
const settingsPanel = byId<HTMLDetailsElement>('settings');
const bankOptions = byId<HTMLDivElement>('bank-options');
const savedCardsList = byId<HTMLDivElement>('saved-cards-list');
const savedCardsEmpty = byId<HTMLParagraphElement>('saved-cards-empty');
const addCardForm = byId<HTMLFormElement>('add-card-form');
const addCardLabel = byId<HTMLInputElement>('add-card-label');
const addCardUrl = byId<HTMLInputElement>('add-card-url');
const addCardError = byId<HTMLParagraphElement>('add-card-error');
const forgetCardsButton = byId<HTMLButtonElement>('forget-cards');
const openDirectlyInput = byId<HTMLInputElement>('open-directly');
const openDirectlyNote = byId<HTMLElement>('open-directly-note');
const openInSelect = byId<HTMLSelectElement>('open-in');
const disclaimerBanks = byId<HTMLSpanElement>('disclaimer-banks');
const checkoutEnabledInput = byId<HTMLInputElement>('checkout-enabled');
const checkoutExplain = byId<HTMLElement>('checkout-explain');
const checkoutContinueButton = byId<HTMLButtonElement>('checkout-continue');
const checkoutCancelButton = byId<HTMLButtonElement>('checkout-cancel');
const checkoutAutoOpenRow = byId<HTMLElement>('checkout-auto-open-row');
const checkoutAutoOpenInput = byId<HTMLInputElement>('checkout-auto-open');
const checkoutSites = byId<HTMLElement>('checkout-sites');
const checkoutSitesList = byId<HTMLUListElement>('checkout-sites-list');

const orList = new Intl.ListFormat('en', { type: 'disjunction' });

let settings: Settings = DEFAULT_SETTINGS;
let savedCards: SavedCard[] = [];
// The page in the active tab, when it is a card page CardHop could offer to save.
let currentCardUrl: string | undefined;

function selectedBanks(): BankId[] {
	return [...bankOptions.querySelectorAll<HTMLInputElement>('input:checked')]
		.map((input) => input.value)
		.filter(isBankId);
}

function cardsFor(bankId: BankId): SavedCard[] {
	return savedCards.filter((card) => card.bankId === bankId);
}

function openButton(label: string, className: string, open: () => Promise<void>): HTMLButtonElement {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = className;
	button.textContent = label;
	button.addEventListener('click', async () => {
		await open();
		window.close();
	});
	return button;
}

// One group per selected bank, under the bank's name: its button, followed by its saved card pages.
function renderOpenButtons(banks: BankId[]): void {
	openButtons.replaceChildren(...banks.map((bankId) => {
		const group = document.createElement('div');
		group.className = 'bank-group';
		const heading = document.createElement('h2');
		heading.className = 'bank-heading';
		heading.textContent = BANKS[bankId].name;
		group.append(
			heading,
			openButton(`Open ${bankLabel(bankId, settings)}`, `secondary ${bankId}`, () => requestOpen(bankId)),
			...cardsFor(bankId).map((card) => openButton(`Open ${card.label}`, `secondary ${bankId}`, () => requestOpen(bankId, card.id))),
		);
		return group;
	}));
}

// Returning after sign-in is on whenever its permission is granted. Until then, the popup explains it and
// offers to turn it on, so people know what the browser's "read and change your data" prompt is for.
function renderSignInReturnNotices(banks: BankId[]): void {
	const supported = banks.filter((bankId) => signInReturnFor(bankId));
	signInReturnOptions.hidden = true;

	signInReturnOptions.replaceChildren(...supported.map((bankId) => {
		const notice = document.createElement('p');
		notice.className = 'notice';
		notice.dataset.bank = bankId;
		notice.hidden = true;

		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'notice-action';
		button.textContent = 'Turn on';
		button.addEventListener('click', () => {
			// Request first, with no awaits before it, so the browser treats it as part of the click.
			void signInReturn.enable(bankId).catch(() => false).finally(() => {
				renderSignInReturnNotices(selectedBanks());
				void refreshCurrentCard();
			});
		});

		const site = new URL(signInReturnFor(bankId)?.destinationPrefix ?? BANKS[bankId].url).host;
		const detail = document.createElement('small');
		detail.textContent = `Your browser will call this "read and change your data" on ${site}. `
			+ 'CardHop only looks at the page address. It never reads or changes the page.';

		notice.append(
			`Signed out? ${BANKS[bankId].name} sends you to its home page after sign-in. `
			+ 'CardHop can bring you back to your virtual cards. ',
			button,
			detail,
		);

		void signInReturn.isEnabled(bankId).then((enabled) => {
			notice.hidden = enabled;
			signInReturnOptions.hidden = ![...signInReturnOptions.children].some((child) => !(child as HTMLElement).hidden);
		});
		return notice;
	}));
}

// Offers to save the card page in the active tab. The browser only reveals that tab's address on
// sites CardHop has permission for, so this appears once returning after sign-in is turned on.
function renderSaveCurrent(banks: BankId[]): void {
	const bankId = currentCardUrl === undefined ? undefined : bankForCardUrl(currentCardUrl);
	const show = bankId !== undefined && banks.includes(bankId) && currentCardUrl !== undefined && !isSaved(currentCardUrl, savedCards);
	saveCurrent.hidden = !show;
	if (show) {
		saveCurrentLabel.placeholder = defaultLabel(bankId, savedCards);
	}
	renderTip(banks);
}

// Tells people how to save another card's page, until they have saved one or dismissed the tip.
function renderTip(banks: BankId[]): void {
	savedCardsTip.hidden = banks.length === 0
		|| savedCards.length > 0
		|| settings.savedCardsTipDismissed
		|| !saveCurrent.hidden;
}

async function refreshCurrentCard(): Promise<void> {
	const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
	currentCardUrl = tab?.url !== undefined && bankForCardUrl(tab.url) ? tab.url : undefined;
	renderSaveCurrent(selectedBanks());
}

function smallButton(text: string, ariaLabel: string, onClick: () => void): HTMLButtonElement {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'card-action';
	button.textContent = text;
	button.setAttribute('aria-label', ariaLabel);
	button.addEventListener('click', onClick);
	return button;
}

// Swaps a row for an edit box. Enter or Save keeps the new name; Escape or Cancel doesn't.
function startRename(item: HTMLLIElement, currentLabel: string, save: (label: string) => Promise<void>): void {
	const input = document.createElement('input');
	input.type = 'text';
	input.className = 'rename-input';
	input.value = currentLabel;
	input.maxLength = MAX_LABEL_LENGTH;
	input.setAttribute('aria-label', `New name for ${currentLabel}`);

	const commit = (): void => {
		void save(input.value).then(reload);
	};
	const cancel = (): void => {
		renderCardButtonsList();
	};

	input.addEventListener('keydown', (event) => {
		if (event.key === 'Enter') {
			event.preventDefault();
			commit();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			cancel();
		}
	});

	const actions = document.createElement('span');
	actions.className = 'card-actions';
	actions.append(
		smallButton('Save', `Save new name for ${currentLabel}`, commit),
		smallButton('Cancel', 'Cancel renaming', cancel),
	);

	item.replaceChildren(input, actions);
	input.focus();
	input.select();
}

function cardRow(label: string, note: string | undefined, actions: (item: HTMLLIElement) => HTMLButtonElement[]): HTMLLIElement {
	const item = document.createElement('li');
	item.className = 'saved-card';

	const name = document.createElement('span');
	name.className = 'card-name';
	name.textContent = label;
	if (note) {
		const small = document.createElement('small');
		small.textContent = ` ${note}`;
		name.append(small);
	}

	const buttons = document.createElement('span');
	buttons.className = 'card-actions';
	buttons.append(...actions(item));

	item.append(name, buttons);
	return item;
}

// Settings list of every button, grouped under each bank: its general page first, then saved cards.
// Banks that are no longer selected still show their saved cards, so they can be deleted.
function renderCardButtonsList(): void {
	const banks = selectedBanks();
	const shown = BANK_IDS.filter((bankId) => banks.includes(bankId) || cardsFor(bankId).length > 0);

	savedCardsEmpty.hidden = savedCards.length > 0;
	forgetCardsButton.hidden = savedCards.length === 0;

	savedCardsList.replaceChildren(...shown.map((bankId) => {
		const group = document.createElement('section');
		group.className = 'card-group';
		group.dataset.bank = bankId;

		const heading = document.createElement('h3');
		heading.textContent = BANKS[bankId].name;

		const list = document.createElement('ul');
		list.className = 'saved-cards';

		if (banks.includes(bankId)) {
			const label = bankLabel(bankId, settings);
			const custom = settings.bankLabels[bankId] !== undefined;
			const row = cardRow(label, '(default page)', (item) => [
				smallButton('Rename', `Rename ${label}`, () => startRename(item, label, (name) => renameBank(bankId, name))),
				...(custom ? [smallButton('Reset', `Reset ${label} to its original name`, () => {
					void resetBankLabel(bankId).then(reload);
				})] : []),
			]);
			row.dataset.default = bankId;
			list.append(row);
		}

		cardsFor(bankId).forEach((card) => {
			const row = cardRow(card.label, undefined, (item) => [
				smallButton('Rename', `Rename ${card.label}`, () => startRename(item, card.label, (name) => renameSavedCard(card.id, name))),
				smallButton('Delete', `Delete ${card.label}`, () => {
					void removeSavedCard(card.id).then(reload);
				}),
			]);
			row.dataset.card = card.id;
			list.append(row);
		});

		group.append(heading, list);
		return group;
	}));
}

function renderBankState(banks: BankId[]): void {
	const hasBanks = banks.length > 0;
	renderOpenButtons(banks);
	renderSignInReturnNotices(banks);
	renderSaveCurrent(banks);
	renderCardButtonsList();
	chooseBank.hidden = hasBanks;
	signInHint.hidden = !hasBanks;

	// With no bank chosen yet, name every supported bank so the sentence still reads correctly.
	const named = hasBanks ? banks : BANK_IDS;
	disclaimerBanks.textContent = orList.format(named.map((bankId) => BANKS[bankId].name));

	const directAllowed = canOpenDirectly({ banks, openDirectly: true }, savedCards);
	openDirectlyInput.disabled = !directAllowed;
	openDirectlyNote.textContent = directAllowed ? OPEN_DIRECTLY_NOTE : OPEN_DIRECTLY_DISABLED_NOTE;
}

// Re-reads settings and saved cards after a change, then redraws.
async function reload(): Promise<void> {
	settings = await getSettings();
	savedCards = await getSavedCards();
	renderBankState(selectedBanks());
}

function renderBankOptions(banks: BankId[]): void {
	bankOptions.replaceChildren(...BANK_IDS.map((bankId) => {
		const label = document.createElement('label');
		label.className = 'toggle';

		const input = document.createElement('input');
		input.type = 'checkbox';
		input.value = bankId;
		input.checked = banks.includes(bankId);
		input.addEventListener('change', () => {
			// Unchoosing a bank gives back the permission its return-after-sign-in used.
			if (!input.checked && signInReturnFor(bankId)) {
				void signInReturn.disable(bankId).catch(() => undefined).finally(() => renderSignInReturnNotices(selectedBanks()));
			}

			const selected = selectedBanks();
			renderBankState(selected);
			void saveSettings({ banks: selected });
		});

		const name = document.createElement('span');
		name.textContent = BANKS[bankId].name;

		label.append(input, name);
		return label;
	}));
}

async function saveCard(url: string, label: string): Promise<string | undefined> {
	try {
		await addSavedCard(url, label);
		await reload();
		return undefined;
	} catch (error) {
		return error instanceof CardPageError ? error.message : 'Couldn’t save that card page.';
	}
}

function isOpenIn(value: string): value is OpenIn {
	return Object.values<string>(OPEN_IN).includes(value);
}

saveCurrentButton.addEventListener('click', async () => {
	if (currentCardUrl !== undefined) {
		await saveCard(currentCardUrl, saveCurrentLabel.value);
		saveCurrentLabel.value = '';
	}
});

addCardForm.addEventListener('submit', async (event) => {
	event.preventDefault();
	const error = await saveCard(addCardUrl.value, addCardLabel.value);
	addCardError.textContent = error ?? '';
	addCardError.hidden = error === undefined;
	if (error === undefined) {
		addCardForm.reset();
	}
});

dismissTipButton.addEventListener('click', () => {
	savedCardsTip.hidden = true;
	void saveSettings({ savedCardsTipDismissed: true });
});

forgetCardsButton.addEventListener('click', () => {
	void forgetAllCards().then(reload);
});

openDirectlyInput.addEventListener('change', () => {
	void saveSettings({ openDirectly: openDirectlyInput.checked });
});

openInSelect.addEventListener('change', () => {
	if (isOpenIn(openInSelect.value)) {
		void saveSettings({ openIn: openInSelect.value });
	}
});

// Sites where the prompt was turned off, each with a way to turn it back on.
async function renderCheckoutSites(): Promise<void> {
	const sites = await getDisabledSites();
	checkoutSites.hidden = sites.length === 0;
	checkoutSitesList.replaceChildren(...sites.map((site) => {
		const item = document.createElement('li');
		item.className = 'saved-card';

		const name = document.createElement('span');
		name.className = 'card-name';
		name.textContent = site;

		const actions = document.createElement('span');
		actions.className = 'card-actions';
		actions.append(smallButton('Turn back on', `Turn CardHop back on for ${site}`, () => {
			void enableSite(site).catch(() => undefined).then(renderCheckoutSites);
		}));

		item.append(name, actions);
		return item;
	}));
}

// The checkbox mirrors the browser's actual grant, never a stored flag, so access revoked from the
// browser's extension page reads as off here too.
async function renderCheckout(): Promise<void> {
	const access = await hasCheckoutAccess().catch(() => false);
	checkoutEnabledInput.checked = access;
	checkoutAutoOpenRow.hidden = !access;
	checkoutAutoOpenInput.checked = settings.checkoutAutoOpen;
	await renderCheckoutSites();
}

checkoutEnabledInput.addEventListener('change', () => {
	if (checkoutEnabledInput.checked) {
		// Explain before the browser's "read and change your data" prompt. The box ticks once access is granted.
		checkoutEnabledInput.checked = false;
		checkoutExplain.hidden = false;
		return;
	}
	checkoutExplain.hidden = true;
	void removeCheckoutAccess().catch(() => undefined).finally(() => renderCheckout());
});

checkoutContinueButton.addEventListener('click', () => {
	// Request first, with no awaits before it, so the browser treats it as part of the click.
	void requestCheckoutAccess().catch(() => false).finally(() => {
		checkoutExplain.hidden = true;
		void renderCheckout();
	});
});

checkoutCancelButton.addEventListener('click', () => {
	checkoutExplain.hidden = true;
});

checkoutAutoOpenInput.addEventListener('change', () => {
	// Keep the loaded copy current: renderCheckout reads it when the row comes back after re-ticking.
	settings = { ...settings, checkoutAutoOpen: checkoutAutoOpenInput.checked };
	void saveSettings({ checkoutAutoOpen: checkoutAutoOpenInput.checked });
});

// options.html loads this page with ?view=options for the options dialog.
function applyOptionsLayout(): void {
	if (new URLSearchParams(location.search).get('view') === 'options') {
		document.body.classList.add('is-options');
		settingsPanel.open = true;
	}
}

async function init(): Promise<void> {
	applyOptionsLayout();
	saveCurrentLabel.maxLength = MAX_LABEL_LENGTH;
	addCardLabel.maxLength = MAX_LABEL_LENGTH;

	settings = await getSettings();
	savedCards = await getSavedCards();

	openDirectlyInput.checked = settings.openDirectly;
	openInSelect.value = settings.openIn;
	renderBankOptions(settings.banks);
	renderBankState(settings.banks);
	await renderCheckout();
	await refreshCurrentCard();

	// First run: open settings so the bank choices are visible.
	if (settings.banks.length === 0) {
		settingsPanel.open = true;
	}
}

void init();
