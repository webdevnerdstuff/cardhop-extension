import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import type { Mock } from 'node:test';
import { JSDOM } from 'jsdom';
import { callArgs, createChromeMock, flush } from './helpers/chrome-mock.ts';

const chromeMock = createChromeMock();
chromeMock.install();
const { api } = chromeMock;


const popupHtml = (await readFile(new URL('../src/popup/popup.html', import.meta.url), 'utf8'))
	// The test loads popup.ts itself, so drop the module tag jsdom can't resolve.
	.replace(/<script[^>]*src="popup.js"[^>]*><\/script>/, '');

let loadCount = 0;
let dom: JSDOM;
let closePopup: Mock<() => void>;

// Renders popup.html and runs a fresh copy of popup.ts against it.
async function openPopup({ stored = {}, query = '' }: { stored?: Record<string, unknown>; query?: string } = {}): Promise<Document> {
	chromeMock.setStored(stored);
	dom = new JSDOM(popupHtml, { url: `chrome-extension://cardhop/popup/popup.html${query}` });
	closePopup = mock.fn(() => {});
	dom.window.close = closePopup;

	Object.assign(globalThis, {
		window: dom.window,
		document: dom.window.document,
		location: dom.window.location,
	});

	// A unique query string makes Node evaluate popup.ts again instead of reusing the cached module.
	loadCount += 1;
	await import(`../src/popup/popup.ts?load=${loadCount}`);
	await flush();
	return dom.window.document;
}

function openButtonLabels(doc: Document): string[] {
	return [...doc.querySelectorAll('#open-buttons button')].map((button) => button.textContent ?? '');
}

function element<T extends Element = HTMLElement>(doc: Document, selector: string): T {
	const found = doc.querySelector<T>(selector);
	assert.ok(found, `missing ${selector}`);
	return found;
}

function bankCheckbox(doc: Document, bankId: string): HTMLInputElement {
	return element<HTMLInputElement>(doc, `#bank-options input[value="${bankId}"]`);
}

function change(target: Element): void {
	target.dispatchEvent(new dom.window.Event('change'));
}

beforeEach(() => chromeMock.reset());

afterEach(() => {
	['window', 'document', 'location'].forEach((name) => Reflect.deleteProperty(globalThis, name));
});

describe('with no bank selected (first run)', () => {
	it('shows no open buttons and asks the user to choose a bank', async () => {
		const doc = await openPopup();
		assert.deepEqual(openButtonLabels(doc), []);
		assert.equal(element(doc, '#choose-bank').hidden, false);
		assert.equal(element(doc, '#sign-in-hint').hidden, true);
	});

	it('opens settings so the bank choices are visible', async () => {
		const doc = await openPopup();
		assert.equal(element<HTMLDetailsElement>(doc, '.settings').open, true);
	});

	it('lists every bank, unticked', async () => {
		const doc = await openPopup();
		assert.equal(bankCheckbox(doc, 'capitalOne').checked, false);
		assert.equal(bankCheckbox(doc, 'citi').checked, false);
	});

	it('names every supported bank in the disclaimer', async () => {
		const doc = await openPopup();
		assert.equal(element(doc, '#disclaimer-banks').textContent, 'Capital One or Citi');
	});

	it('does not allow skipping the popup', async () => {
		const doc = await openPopup();
		assert.equal(element<HTMLInputElement>(doc, '#open-directly').disabled, true);
	});
});

describe('with one bank selected', () => {
	const stored = { banks: ['capitalOne'] };

	it('shows a single open button for that bank', async () => {
		const doc = await openPopup({ stored });
		assert.deepEqual(openButtonLabels(doc), ['Open Capital One Virtual Cards']);
		assert.equal(element(doc, '#choose-bank').hidden, true);
		assert.equal(element(doc, '#sign-in-hint').hidden, false);
	});

	it('lists every bank and lets the selected one be unticked', async () => {
		const doc = await openPopup({ stored });
		assert.equal(bankCheckbox(doc, 'capitalOne').checked, true);
		assert.equal(bankCheckbox(doc, 'capitalOne').disabled, false);
		assert.equal(bankCheckbox(doc, 'citi').checked, false);
		assert.equal(bankCheckbox(doc, 'citi').disabled, false);
	});

	it('allows skipping the popup', async () => {
		const doc = await openPopup({ stored });
		assert.equal(element<HTMLInputElement>(doc, '#open-directly').disabled, false);
		assert.match(element(doc, '#open-directly-note').textContent ?? '', /right-click the icon/);
	});

	it('names only that bank in the disclaimer', async () => {
		const doc = await openPopup({ stored: { banks: ['citi'] } });
		assert.equal(element(doc, '#disclaimer-banks').textContent, 'Citi');
	});
});

describe('with both banks selected', () => {
	const stored = { banks: ['capitalOne', 'citi'] };

	it('shows one button per bank, in order', async () => {
		const doc = await openPopup({ stored });
		assert.deepEqual(openButtonLabels(doc), ['Open Capital One Virtual Cards', 'Open Citi Virtual Cards']);
	});

	it('lets either bank be unticked', async () => {
		const doc = await openPopup({ stored });
		assert.equal(bankCheckbox(doc, 'capitalOne').disabled, false);
		assert.equal(bankCheckbox(doc, 'citi').disabled, false);
	});

	it('disables skipping the popup and explains why', async () => {
		const doc = await openPopup({ stored: { ...stored, openDirectly: true } });
		assert.equal(element<HTMLInputElement>(doc, '#open-directly').disabled, true);
		assert.equal(element(doc, '#open-directly-note').textContent, 'Only available with one bank and no saved card pages.');
	});

	it('names both banks in the disclaimer', async () => {
		const doc = await openPopup({ stored });
		assert.equal(element(doc, '#disclaimer-banks').textContent, 'Capital One or Citi');
	});
});

describe('open buttons', () => {
	it('ask the background to open that bank, then close the popup', async () => {
		const doc = await openPopup({ stored: { banks: ['capitalOne', 'citi'] } });
		element<HTMLButtonElement>(doc, '#open-buttons .bank-group:last-child button').click();
		await flush();

		assert.deepEqual(callArgs(api.runtime.sendMessage), [[{ type: 'openBank', bankId: 'citi' }]]);
		assert.equal(closePopup.mock.callCount(), 1);
	});

	// Opening a tab closes the popup, which would cut off watching the tab for a sign-in detour.
	it('never open tabs from the popup itself', async () => {
		const doc = await openPopup({ stored: { banks: ['capitalOne'], openIn: 'currentTab' } });
		element<HTMLButtonElement>(doc, '#open-buttons button').click();
		await flush();

		assert.equal(api.tabs.create.mock.callCount(), 0);
		assert.equal(api.tabs.update.mock.callCount(), 0);
	});
});

describe('changing settings', () => {
	it('ticking the first bank saves it, adds its button and clears the prompt', async () => {
		const doc = await openPopup();
		const citi = bankCheckbox(doc, 'citi');
		citi.checked = true;
		change(citi);
		await flush();

		assert.deepEqual(chromeMock.getStored().banks, ['citi']);
		assert.deepEqual(openButtonLabels(doc), ['Open Citi Virtual Cards']);
		assert.equal(element(doc, '#choose-bank').hidden, true);
		assert.equal(element<HTMLInputElement>(doc, '#open-directly').disabled, false);
	});

	it('ticking a second bank saves it and adds its button', async () => {
		const doc = await openPopup({ stored: { banks: ['capitalOne'] } });
		const citi = bankCheckbox(doc, 'citi');
		citi.checked = true;
		change(citi);
		await flush();

		assert.deepEqual(chromeMock.getStored().banks, ['capitalOne', 'citi']);
		assert.deepEqual(openButtonLabels(doc), ['Open Capital One Virtual Cards', 'Open Citi Virtual Cards']);
		assert.equal(element<HTMLInputElement>(doc, '#open-directly').disabled, true);
	});

	it('unticking a bank saves it and removes its button', async () => {
		const doc = await openPopup({ stored: { banks: ['capitalOne', 'citi'] } });
		const capitalOne = bankCheckbox(doc, 'capitalOne');
		capitalOne.checked = false;
		change(capitalOne);
		await flush();

		assert.deepEqual(chromeMock.getStored().banks, ['citi']);
		assert.deepEqual(openButtonLabels(doc), ['Open Citi Virtual Cards']);
		assert.equal(element(doc, '#disclaimer-banks').textContent, 'Citi');
	});

	it('unticking the last bank brings back the prompt', async () => {
		const doc = await openPopup({ stored: { banks: ['citi'] } });
		const citi = bankCheckbox(doc, 'citi');
		citi.checked = false;
		change(citi);
		await flush();

		assert.deepEqual(chromeMock.getStored().banks, []);
		assert.deepEqual(openButtonLabels(doc), []);
		assert.equal(element(doc, '#choose-bank').hidden, false);
		assert.equal(element(doc, '#disclaimer-banks').textContent, 'Capital One or Citi');
	});

	it('saves "skip this popup"', async () => {
		const doc = await openPopup({ stored: { banks: ['capitalOne'] } });
		const input = element<HTMLInputElement>(doc, '#open-directly');
		input.checked = true;
		change(input);
		await flush();

		assert.equal(chromeMock.getStored().openDirectly, true);
	});

	it('saves where cards open', async () => {
		const doc = await openPopup();
		const select = element<HTMLSelectElement>(doc, '#open-in');
		select.value = 'currentTab';
		change(select);
		await flush();

		assert.equal(chromeMock.getStored().openIn, 'currentTab');
	});

	it('shows the stored settings when opened', async () => {
		const doc = await openPopup({ stored: { openDirectly: true, openIn: 'currentTab' } });
		assert.equal(element<HTMLInputElement>(doc, '#open-directly').checked, true);
		assert.equal(element<HTMLSelectElement>(doc, '#open-in').value, 'currentTab');
	});
});

describe('layout', () => {
	it('uses the compact popup layout with settings collapsed once a bank is chosen', async () => {
		const doc = await openPopup({ stored: { banks: ['capitalOne'] } });
		assert.equal(doc.body.classList.contains('is-options'), false);
		assert.equal(element<HTMLDetailsElement>(doc, '.settings').open, false);
	});

	it('uses the options layout with settings expanded for ?view=options', async () => {
		const doc = await openPopup({ stored: { banks: ['capitalOne'] }, query: '?view=options' });
		assert.equal(doc.body.classList.contains('is-options'), true);
		assert.equal(element<HTMLDetailsElement>(doc, '.settings').open, true);
	});
});

describe('returning after sign-in', () => {
	const SITE = 'https://myaccounts.capitalone.com/*';

	async function tick(doc: Document, bankId: string, checked: boolean): Promise<void> {
		const box = bankCheckbox(doc, bankId);
		box.checked = checked;
		change(box);
		await flush();
		await flush();
	}

	function notice(doc: Document): HTMLElement | null {
		return doc.querySelector<HTMLElement>('#sign-in-return-options .notice[data-bank="capitalOne"]');
	}

	function noticeShown(doc: Document): boolean {
		const found = notice(doc);
		return found !== null && !found.hidden && !element(doc, '#sign-in-return-options').hidden;
	}

	it('has no separate on/off checkbox', async () => {
		chromeMock.grant(SITE);
		const doc = await openPopup({ stored: { banks: ['capitalOne'] } });
		assert.equal(doc.querySelector('#sign-in-return-options input'), null);
	});

	// The browser words the prompt "read and change your data", so explain before it appears.
	it('ticking Capital One explains the setting instead of prompting straight away', async () => {
		const doc = await openPopup();
		await tick(doc, 'capitalOne', true);

		assert.equal(api.permissions.request.mock.callCount(), 0);
		assert.equal(noticeShown(doc), true);
		assert.match(notice(doc)?.textContent ?? '', /CardHop can bring you back to your virtual cards/);
		assert.match(notice(doc)?.textContent ?? '', /"read and change your data" on myaccounts\.capitalone\.com/);
		assert.match(notice(doc)?.textContent ?? '', /never reads or changes the page/);
		assert.deepEqual(chromeMock.getStored().banks, ['capitalOne']);
	});

	it('shows the notice outside Settings so it stays visible', async () => {
		const doc = await openPopup({ stored: { banks: ['capitalOne'] } });
		assert.equal(element<HTMLDetailsElement>(doc, '.settings').open, false);
		assert.equal(doc.querySelector('.settings #sign-in-return-options'), null);
		assert.equal(noticeShown(doc), true);
	});

	it('shows nothing extra when the permission is granted', async () => {
		chromeMock.grant(SITE);
		const doc = await openPopup({ stored: { banks: ['capitalOne'] } });
		assert.equal(noticeShown(doc), false);
	});

	it('keeps offering if the browser prompt is declined', async () => {
		chromeMock.answerPermissionPrompts(false);
		const doc = await openPopup({ stored: { banks: ['capitalOne'] } });
		element<HTMLButtonElement>(doc, '#sign-in-return-options .notice-action').click();
		await flush();
		await flush();

		assert.equal(api.permissions.request.mock.callCount(), 1);
		assert.equal(noticeShown(doc), true);
		assert.deepEqual(chromeMock.getStored().banks, ['capitalOne'], 'Capital One stays selected');
	});

	it('the notice’s Turn on button asks again and disappears once allowed', async () => {
		const doc = await openPopup({ stored: { banks: ['capitalOne'] } });
		assert.equal(noticeShown(doc), true);

		element<HTMLButtonElement>(doc, '#sign-in-return-options .notice-action').click();
		await flush();
		await flush();

		assert.deepEqual(callArgs(api.permissions.request), [[{ origins: [SITE] }]]);
		assert.equal(noticeShown(doc), false);
	});

	it('unticking Capital One gives the permission back', async () => {
		chromeMock.grant(SITE);
		const doc = await openPopup({ stored: { banks: ['capitalOne'] } });
		await tick(doc, 'capitalOne', false);

		assert.deepEqual(callArgs(api.permissions.remove), [[{ origins: [SITE] }]]);
		assert.deepEqual(chromeMock.granted(), []);
	});

	it('never asks or shows anything for Citi', async () => {
		const doc = await openPopup();
		await tick(doc, 'citi', true);

		assert.equal(api.permissions.request.mock.callCount(), 0);
		assert.equal(notice(doc), null);
		assert.equal(element(doc, '#sign-in-return-options').hidden, true);
	});
});

describe('saved card pages', () => {
	const SITE = 'https://myaccounts.capitalone.com/*';
	const SECOND_CARD = 'https://myaccounts.capitalone.com/vc/virtual-cards/home?arid=second';
	const PRIVACY = /Saved only in this browser on this device\. CardHop never sends it anywhere\./;

	async function saveCardDirectly(url: string, label: string): Promise<void> {
		const { addSavedCard } = await import('../src/saved-cards.ts');
		await addSavedCard(url, label);
	}

	async function savedLabels(): Promise<string[]> {
		const { getSavedCards } = await import('../src/saved-cards.ts');
		return (await getSavedCards()).map((card) => card.label);
	}

	async function settle(): Promise<void> {
		await flush();
		await flush();
		await flush();
	}

	it('shows a button for each saved card under its bank', async () => {
		await saveCardDirectly(SECOND_CARD, 'Venture X');
		const doc = await openPopup({ stored: { banks: ['capitalOne'] } });
		assert.deepEqual(openButtonLabels(doc), ['Open Capital One Virtual Cards', 'Open Venture X']);
	});

	it('groups each bank\'s buttons under the bank\'s name', async () => {
		await saveCardDirectly(SECOND_CARD, 'Venture X');
		const doc = await openPopup({ stored: { banks: ['capitalOne', 'citi'] } });
		const groups = [...doc.querySelectorAll('#open-buttons .bank-group')];
		assert.deepEqual(groups.map((group) => group.querySelector('.bank-heading')?.textContent), ['Capital One', 'Citi']);
		assert.deepEqual(groups.map((group) => group.querySelectorAll('button').length), [2, 1]);
	});

	it('a saved card button asks the background to open that card', async () => {
		await saveCardDirectly(SECOND_CARD, 'Venture X');
		const doc = await openPopup({ stored: { banks: ['capitalOne'] } });
		element<HTMLButtonElement>(doc, '#open-buttons button:last-child').click();
		await flush();

		const [[message]] = callArgs(api.runtime.sendMessage) as [[{ type: string; bankId: string; cardId?: string }]];
		assert.equal(message.bankId, 'capitalOne');
		assert.equal(typeof message.cardId, 'string');
	});

	it('offers to save the card page in the active tab', async () => {
		chromeMock.grant(SITE);
		chromeMock.setActiveTabUrl(SECOND_CARD);
		const doc = await openPopup({ stored: { banks: ['capitalOne'] } });

		assert.equal(element(doc, '#save-current').hidden, false);
		assert.match(element(doc, '#save-current').textContent ?? '', PRIVACY);
		assert.equal(element<HTMLInputElement>(doc, '#save-current-label').placeholder, 'Capital One card 1');
	});

	it('saves the active card page with the typed name', async () => {
		chromeMock.setActiveTabUrl(SECOND_CARD);
		const doc = await openPopup({ stored: { banks: ['capitalOne'] } });
		element<HTMLInputElement>(doc, '#save-current-label').value = 'Venture X';
		element<HTMLButtonElement>(doc, '#save-current-button').click();
		await settle();

		assert.deepEqual(await savedLabels(), ['Venture X']);
		assert.equal(element(doc, '#save-current').hidden, true, 'no longer offered once saved');
		assert.deepEqual(openButtonLabels(doc), ['Open Capital One Virtual Cards', 'Open Venture X']);
		assert.deepEqual(chromeMock.getStored().savedCards, undefined, 'never in synced storage');
	});

	it('does not offer pages that are not card pages, or are already saved', async () => {
		chromeMock.setActiveTabUrl('https://myaccounts.capitalone.com/accountSummary');
		let doc = await openPopup({ stored: { banks: ['capitalOne'] } });
		assert.equal(element(doc, '#save-current').hidden, true);

		await saveCardDirectly(SECOND_CARD, 'Venture X');
		chromeMock.setStored({ banks: ['capitalOne'] });
		chromeMock.setActiveTabUrl(SECOND_CARD);
		doc = await openPopup({ stored: { banks: ['capitalOne'] } });
		assert.equal(element(doc, '#save-current').hidden, true);
	});

	it('does not offer a card page when its bank is not selected', async () => {
		chromeMock.setActiveTabUrl(SECOND_CARD);
		const doc = await openPopup({ stored: { banks: ['citi'] } });
		assert.equal(element(doc, '#save-current').hidden, true);
	});

	it('saves a pasted card page link', async () => {
		const doc = await openPopup({ stored: { banks: ['capitalOne'] } });
		element<HTMLInputElement>(doc, '#add-card-label').value = 'Business';
		element<HTMLInputElement>(doc, '#add-card-url').value = SECOND_CARD;
		element<HTMLFormElement>(doc, '#add-card-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
		await settle();

		assert.deepEqual(await savedLabels(), ['Business']);
		assert.equal(element(doc, '#add-card-error').hidden, true);
		assert.equal(element<HTMLInputElement>(doc, '#add-card-url').value, '', 'form clears after saving');
	});

	it('explains why a pasted link was refused', async () => {
		const doc = await openPopup({ stored: { banks: ['capitalOne'] } });
		element<HTMLInputElement>(doc, '#add-card-url').value = 'https://example.com/vc/virtual-cards';
		element<HTMLFormElement>(doc, '#add-card-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
		await settle();

		assert.deepEqual(await savedLabels(), []);
		assert.equal(element(doc, '#add-card-error').hidden, false);
		assert.match(element(doc, '#add-card-error').textContent ?? '', /isn’t a virtual card page/);
	});

	it('lists saved cards in Settings and deletes one', async () => {
		await saveCardDirectly(SECOND_CARD, 'Venture X');
		const doc = await openPopup({ stored: { banks: ['capitalOne'] } });
		assert.equal(element(doc, '#saved-cards-list [data-bank="capitalOne"] h3').textContent, 'Capital One');
		assert.match(element(doc, '#saved-cards-list li[data-card]').textContent ?? '', /^Venture X/);
		assert.doesNotMatch(element(doc, '#saved-cards-list li[data-card]').textContent ?? '', /\(Capital One\)/);

		element<HTMLButtonElement>(doc, '#saved-cards-list li[data-card] button[aria-label^="Delete"]').click();
		await settle();

		assert.deepEqual(await savedLabels(), []);
		assert.equal(doc.querySelectorAll('#saved-cards-list li[data-card]').length, 0);
		assert.deepEqual(openButtonLabels(doc), ['Open Capital One Virtual Cards']);
	});

	it('Forget my cards removes every saved card', async () => {
		await saveCardDirectly(SECOND_CARD, 'One');
		await saveCardDirectly('https://online.citi.com/US/ag/repcard/van2?card=2', 'Two');
		const doc = await openPopup({ stored: { banks: ['capitalOne', 'citi'] } });
		assert.equal(element(doc, '#forget-cards').hidden, false);

		element<HTMLButtonElement>(doc, '#forget-cards').click();
		await settle();

		assert.deepEqual(await savedLabels(), []);
		assert.equal(element(doc, '#forget-cards').hidden, true);
		assert.equal(element(doc, '#saved-cards-empty').hidden, false);
	});

	it('explains where saved cards are kept', async () => {
		const doc = await openPopup({ stored: { banks: ['capitalOne'] } });
		assert.match(element(doc, '.settings').textContent ?? '', PRIVACY);
	});

	it('turns off skipping the popup once a card is saved for the bank', async () => {
		await saveCardDirectly(SECOND_CARD, 'One');
		const doc = await openPopup({ stored: { banks: ['capitalOne'] } });
		assert.equal(element<HTMLInputElement>(doc, '#open-directly').disabled, true);
	});
});

describe('renaming saved card pages', () => {
	const SECOND_CARD = 'https://myaccounts.capitalone.com/vc/virtual-cards/home?arid=second';

	async function setUp(): Promise<Document> {
		const { addSavedCard } = await import('../src/saved-cards.ts');
		await addSavedCard(SECOND_CARD, 'Ventrue X');
		return openPopup({ stored: { banks: ['capitalOne'] } });
	}

	async function labels(): Promise<string[]> {
		const { getSavedCards } = await import('../src/saved-cards.ts');
		return (await getSavedCards()).map((card) => card.label);
	}

	function clickButton(doc: Document, labelStart: string): void {
		// The row keeps its data-card attribute while it shows the edit box.
		element<HTMLButtonElement>(doc, `#saved-cards-list li[data-card] button[aria-label^="${labelStart}"]`).click();
	}

	function renameInput(doc: Document): HTMLInputElement {
		return element<HTMLInputElement>(doc, '#saved-cards-list .rename-input');
	}

	function press(doc: Document, key: string): void {
		renameInput(doc).dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, cancelable: true }));
	}

	async function settle(): Promise<void> {
		await flush();
		await flush();
		await flush();
	}

	it('Rename turns the name into an edit box with the current name', async () => {
		const doc = await setUp();
		clickButton(doc, 'Rename');
		assert.equal(renameInput(doc).value, 'Ventrue X');
	});

	it('Save keeps the new name and updates the button', async () => {
		const doc = await setUp();
		clickButton(doc, 'Rename');
		renameInput(doc).value = 'Venture X';
		clickButton(doc, 'Save new name');
		await settle();

		assert.deepEqual(await labels(), ['Venture X']);
		assert.deepEqual(openButtonLabels(doc), ['Open Capital One Virtual Cards', 'Open Venture X']);
		assert.match(element(doc, '#saved-cards-list li[data-card]').textContent ?? '', /Venture X/);
	});

	it('Enter saves too', async () => {
		const doc = await setUp();
		clickButton(doc, 'Rename');
		renameInput(doc).value = 'Venture X';
		press(doc, 'Enter');
		await settle();

		assert.deepEqual(await labels(), ['Venture X']);
	});

	it('Escape and Cancel leave the name unchanged', async () => {
		const doc = await setUp();
		clickButton(doc, 'Rename');
		renameInput(doc).value = 'Something else';
		press(doc, 'Escape');
		await settle();
		assert.deepEqual(await labels(), ['Ventrue X']);
		assert.equal(doc.querySelector('#saved-cards-list .rename-input'), null);

		clickButton(doc, 'Rename');
		renameInput(doc).value = 'Something else';
		clickButton(doc, 'Cancel');
		await settle();
		assert.deepEqual(await labels(), ['Ventrue X']);
	});

	it('a blank name keeps the old one', async () => {
		const doc = await setUp();
		clickButton(doc, 'Rename');
		renameInput(doc).value = '   ';
		press(doc, 'Enter');
		await settle();

		assert.deepEqual(await labels(), ['Ventrue X']);
	});
});

describe('renaming the default page button', () => {
	async function settle(): Promise<void> {
		await flush();
		await flush();
		await flush();
	}

	function defaultRow(doc: Document): HTMLElement {
		return element(doc, '#saved-cards-list li[data-default="capitalOne"]');
	}

	it('lists the default page first under its bank, marked as the default', async () => {
		const doc = await openPopup({ stored: { banks: ['capitalOne'] } });
		assert.match(defaultRow(doc).textContent ?? '', /Capital One Virtual Cards \(default page\)/);
		assert.equal(defaultRow(doc).querySelector('button[aria-label^="Delete"]'), null, 'cannot be deleted');
	});

	it('renames the default button and its popup button', async () => {
		const doc = await openPopup({ stored: { banks: ['capitalOne'] } });
		element<HTMLButtonElement>(doc, 'li[data-default="capitalOne"] button[aria-label^="Rename"]').click();
		element<HTMLInputElement>(doc, 'li[data-default="capitalOne"] .rename-input').value = 'Quicksilver';
		element<HTMLButtonElement>(doc, 'li[data-default="capitalOne"] button[aria-label^="Save"]').click();
		await settle();

		assert.deepEqual(chromeMock.getStored().bankLabels, { capitalOne: 'Quicksilver' });
		assert.deepEqual(openButtonLabels(doc), ['Open Quicksilver']);
	});

	it('Reset puts the original name back', async () => {
		const doc = await openPopup({ stored: { banks: ['capitalOne'], bankLabels: { capitalOne: 'Quicksilver' } } });
		assert.deepEqual(openButtonLabels(doc), ['Open Quicksilver']);

		element<HTMLButtonElement>(doc, 'li[data-default="capitalOne"] button[aria-label^="Reset"]').click();
		await settle();

		assert.deepEqual(openButtonLabels(doc), ['Open Capital One Virtual Cards']);
		assert.equal(doc.querySelector('li[data-default="capitalOne"] button[aria-label^="Reset"]'), null);
	});

	it('only offers Reset after a rename', async () => {
		const doc = await openPopup({ stored: { banks: ['capitalOne'] } });
		assert.equal(doc.querySelector('li[data-default="capitalOne"] button[aria-label^="Reset"]'), null);
	});

	it('groups each bank under its own heading', async () => {
		const { addSavedCard } = await import('../src/saved-cards.ts');
		await addSavedCard('https://online.citi.com/US/ag/repcard/van2?card=2', 'Citi Two');
		const doc = await openPopup({ stored: { banks: ['capitalOne', 'citi'] } });

		const headings = [...doc.querySelectorAll('#saved-cards-list h3')].map((heading) => heading.textContent);
		assert.deepEqual(headings, ['Capital One', 'Citi']);
		assert.match(element(doc, '#saved-cards-list [data-bank="citi"]').textContent ?? '', /Citi Two/);
	});

	it('still lists saved cards of a bank that was unticked, so they can be deleted', async () => {
		const { addSavedCard } = await import('../src/saved-cards.ts');
		await addSavedCard('https://online.citi.com/US/ag/repcard/van2?card=2', 'Citi Two');
		const doc = await openPopup({ stored: { banks: ['capitalOne'] } });

		assert.ok(doc.querySelector('#saved-cards-list [data-bank="citi"] li[data-card]'));
		assert.equal(doc.querySelector('#saved-cards-list li[data-default="citi"]'), null);
	});
});

describe('saved cards tip', () => {
	it('explains how to save another card until one is saved', async () => {
		const doc = await openPopup({ stored: { banks: ['capitalOne'] } });
		assert.equal(element(doc, '#saved-cards-tip').hidden, false);
		assert.match(element(doc, '#saved-cards-tip').textContent ?? '', /Have more than one card\?/);
	});

	it('is hidden before a bank is chosen', async () => {
		const doc = await openPopup();
		assert.equal(element(doc, '#saved-cards-tip').hidden, true);
	});

	it('Got it hides it for good', async () => {
		const doc = await openPopup({ stored: { banks: ['capitalOne'] } });
		element<HTMLButtonElement>(doc, '#dismiss-tip').click();
		await flush();

		assert.equal(element(doc, '#saved-cards-tip').hidden, true);
		assert.equal(chromeMock.getStored().savedCardsTipDismissed, true);
	});

	it('is hidden once a card is saved, or while the save offer is showing', async () => {
		const { addSavedCard } = await import('../src/saved-cards.ts');
		chromeMock.setActiveTabUrl('https://myaccounts.capitalone.com/vc/virtual-cards/home?arid=x');
		let doc = await openPopup({ stored: { banks: ['capitalOne'] } });
		assert.equal(element(doc, '#saved-cards-tip').hidden, true, 'save offer is enough');

		chromeMock.setActiveTabUrl(undefined);
		await addSavedCard('https://myaccounts.capitalone.com/vc/virtual-cards/home?arid=y', 'Saved');
		doc = await openPopup({ stored: { banks: ['capitalOne'] } });
		assert.equal(element(doc, '#saved-cards-tip').hidden, true);
	});
});

describe('at checkout settings', () => {
	const ALL = '<all_urls>';
	const SITES_KEY = 'checkoutDisabledSites';

	function enabledBox(doc: Document): HTMLInputElement {
		return element<HTMLInputElement>(doc, '#checkout-enabled');
	}

	async function tickEnabled(doc: Document, checked: boolean): Promise<void> {
		const box = enabledBox(doc);
		box.checked = checked;
		change(box);
		await flush();
		await flush();
	}

	async function click(doc: Document, selector: string): Promise<void> {
		element<HTMLButtonElement>(doc, selector).click();
		await flush();
		await flush();
	}

	it('is titled At checkout and starts off', async () => {
		const doc = await openPopup();
		assert.equal(element(doc, '#settings fieldset:has(#checkout-enabled) legend').textContent, 'At checkout');
		assert.match(element(doc, '#checkout-enabled').closest('label')?.textContent ?? '', /Offer CardHop at checkout/);
		assert.equal(element(doc, '#settings fieldset:has(#saved-cards-list) + fieldset:has(#checkout-enabled)') !== null, true);
	});

	it('toggle shows actual permission state', async () => {
		chromeMock.grant(ALL);
		let doc = await openPopup({ stored: { checkoutAutoOpen: false } });
		assert.equal(enabledBox(doc).checked, true);

		chromeMock.reset();
		doc = await openPopup();
		assert.equal(enabledBox(doc).checked, false);
		assert.equal(element(doc, '#checkout-auto-open-row').hidden, true);
	});

	it('ticking without access explains first and does not prompt', async () => {
		const doc = await openPopup();
		assert.equal(element(doc, '#checkout-explain').hidden, true);
		await tickEnabled(doc, true);

		assert.equal(enabledBox(doc).checked, false);
		assert.equal(element(doc, '#checkout-explain').hidden, false);
		assert.match(
			element(doc, '#checkout-explain').textContent ?? '',
			/To spot card fields, CardHop needs access to the sites you visit\. It only checks whether a field is a card field\. It never reads what you type or anything else on the page\./,
		);
		assert.equal(element(doc, '#checkout-continue').textContent, 'Continue');
		assert.equal(element(doc, '#checkout-cancel').textContent, 'Not now');
		assert.equal(api.permissions.request.mock.callCount(), 0);
	});

	it('Continue asks for access and, once granted, ticks the box and shows auto-open', async () => {
		const doc = await openPopup();
		await tickEnabled(doc, true);
		await click(doc, '#checkout-continue');

		assert.deepEqual(callArgs(api.permissions.request), [[{ origins: [ALL] }]]);
		assert.equal(enabledBox(doc).checked, true);
		assert.equal(element(doc, '#checkout-auto-open-row').hidden, false);
		assert.equal(element(doc, '#checkout-explain').hidden, true);
	});

	it('Continue asks first, before anything else is awaited', async () => {
		const doc = await openPopup();
		await tickEnabled(doc, true);
		element<HTMLButtonElement>(doc, '#checkout-continue').click();

		assert.equal(api.permissions.request.mock.callCount(), 1, 'requested synchronously within the click');
		await flush();
	});

	it('Continue leaves the box unticked when the browser prompt is refused', async () => {
		chromeMock.answerPermissionPrompts(false);
		const doc = await openPopup();
		await tickEnabled(doc, true);
		await click(doc, '#checkout-continue');

		assert.equal(api.permissions.request.mock.callCount(), 1);
		assert.equal(enabledBox(doc).checked, false);
		assert.equal(element(doc, '#checkout-auto-open-row').hidden, true);
	});

	it('Not now hides the explanation without asking', async () => {
		const doc = await openPopup();
		await tickEnabled(doc, true);
		await click(doc, '#checkout-cancel');

		assert.equal(element(doc, '#checkout-explain').hidden, true);
		assert.equal(enabledBox(doc).checked, false);
		assert.equal(api.permissions.request.mock.callCount(), 0);
	});

	it('unticking gives the access back and hides auto-open', async () => {
		chromeMock.grant(ALL);
		const doc = await openPopup();
		await tickEnabled(doc, false);

		assert.deepEqual(callArgs(api.permissions.remove), [[{ origins: [ALL] }]]);
		assert.equal(enabledBox(doc).checked, false);
		assert.equal(element(doc, '#checkout-auto-open-row').hidden, true);
	});

	it('Open the prompt automatically saves checkoutAutoOpen', async () => {
		chromeMock.grant(ALL);
		const doc = await openPopup();
		const box = element<HTMLInputElement>(doc, '#checkout-auto-open');
		assert.equal(box.checked, true, 'on by default');
		assert.match(box.closest('label')?.textContent ?? '', /Open the prompt automatically/);

		box.checked = false;
		change(box);
		await flush();
		assert.equal(chromeMock.getStored().checkoutAutoOpen, false);

		box.checked = true;
		change(box);
		await flush();
		assert.equal(chromeMock.getStored().checkoutAutoOpen, true);
	});

	it('shows the saved auto-open choice on open', async () => {
		chromeMock.grant(ALL);
		const doc = await openPopup({ stored: { checkoutAutoOpen: false } });
		assert.equal(element<HTMLInputElement>(doc, '#checkout-auto-open').checked, false);
	});

	// The re-render must show what is stored, not the value the popup loaded with.
	it('shows the saved auto-open choice after turning checkout off and on again', async () => {
		chromeMock.grant(ALL);
		const doc = await openPopup();
		const autoOpen = element<HTMLInputElement>(doc, '#checkout-auto-open');
		autoOpen.checked = false;
		change(autoOpen);
		await flush();
		assert.equal(chromeMock.getStored().checkoutAutoOpen, false);

		await tickEnabled(doc, false);
		await tickEnabled(doc, true);
		await click(doc, '#checkout-continue');

		assert.equal(enabledBox(doc).checked, true);
		assert.equal(element<HTMLInputElement>(doc, '#checkout-auto-open').checked, false);
	});

	it('hides the sites list when no site is turned off', async () => {
		chromeMock.grant(ALL);
		const doc = await openPopup();
		assert.equal(element(doc, '#checkout-sites').hidden, true);
	});

	it('lists turned-off sites sorted, and Turn back on removes one', async () => {
		chromeMock.grant(ALL);
		chromeMock.setLocal({ [SITES_KEY]: ['shop.example', 'a.example'] });
		const doc = await openPopup();

		assert.equal(element(doc, '#checkout-sites').hidden, false);
		assert.match(element(doc, '#checkout-sites').textContent ?? '', /Turned off on these sites/);
		const items = () => [...doc.querySelectorAll('#checkout-sites-list li')];
		assert.deepEqual(items().map((item) => item.textContent?.replace('Turn back on', '').trim()), ['a.example', 'shop.example']);

		const firstButton = element<HTMLButtonElement>(doc, '#checkout-sites-list li button');
		assert.equal(firstButton.textContent, 'Turn back on');
		firstButton.click();
		await flush();
		await flush();

		assert.deepEqual(chromeMock.getLocal()[SITES_KEY], ['shop.example']);
		assert.deepEqual(items().map((item) => item.textContent?.replace('Turn back on', '').trim()), ['shop.example']);

		element<HTMLButtonElement>(doc, '#checkout-sites-list li button').click();
		await flush();
		await flush();
		assert.equal(element(doc, '#checkout-sites').hidden, true);
	});
});
