import { ext } from './ext.ts';

// Some banks drop you on their home page after signing in instead of the page you asked for.
// With the user's permission, CardHop watches the tab it opened and sends it back once.
export interface SignInReturn {
	// Match pattern for the optional host permission that lets CardHop see addresses on the bank's site.
	origin: string;
	// Addresses that count as already being on the virtual cards pages.
	destinationPrefix: string;
	// Pages the bank lands on once sign-in has fully finished. CardHop only redirects from these,
	// never from the pages in between, which finish setting up the session.
	landingPaths: string[];
}

export interface Bank {
	name: string;
	url: string;
	// Where a specific card's page can live. Saved card links must start with this (scheme, host and path),
	// so CardHop can never be used to save and open links to other sites.
	cardPagePrefix: string;
	signInReturn?: SignInReturn;
}

export const BANKS = {
	capitalOne: {
		name: 'Capital One',
		url: 'https://myaccounts.capitalone.com/vc/virtual-cards/manager',
		cardPagePrefix: 'https://myaccounts.capitalone.com/vc/virtual-cards',
		// Signing in at verified.capitalone.com goes through / and /welcome, then lands on /accountSummary.
		signInReturn: {
			origin: 'https://myaccounts.capitalone.com/*',
			destinationPrefix: 'https://myaccounts.capitalone.com/vc/virtual-cards',
			landingPaths: ['/accountSummary'],
		},
	},
	// The van3 dashboard needs the card chosen earlier in the same tab, so link to van2, which sets that up.
	citi: {
		name: 'Citi',
		url: 'https://online.citi.com/US/ag/repcard/van2',
		cardPagePrefix: 'https://online.citi.com/US/',
	},
} as const satisfies Record<string, Bank>;

export type BankId = keyof typeof BANKS;

export const BANK_IDS = Object.keys(BANKS) as BankId[];

export function signInReturnFor(bankId: BankId): SignInReturn | undefined {
	const bank: Bank = BANKS[bankId];
	return bank.signInReturn;
}

export const OPEN_IN = {
	newTab: 'newTab',
	currentTab: 'currentTab',
} as const;

export type OpenIn = (typeof OPEN_IN)[keyof typeof OPEN_IN];

export const MAX_LABEL_LENGTH = 40;

export interface Settings {
	banks: BankId[];
	openDirectly: boolean;
	openIn: OpenIn;
	// Custom names for each bank's general virtual cards button.
	bankLabels: Partial<Record<BankId, string>>;
	// The popup's "save a card page" tip has been dismissed.
	savedCardsTipDismissed: boolean;
	// Open the checkout prompt as soon as a card field is focused, instead of waiting for a click on its icon.
	checkoutAutoOpen: boolean;
}

// No bank is pre-selected; the popup asks the user to choose.
export const DEFAULT_SETTINGS: Settings = {
	banks: [],
	openDirectly: false,
	openIn: OPEN_IN.newTab,
	bankLabels: {},
	savedCardsTipDismissed: false,
	checkoutAutoOpen: true,
};

export const POPUP_PATH = 'popup/popup.html';

export function isBankId(value: unknown): value is BankId {
	return typeof value === 'string' && Object.hasOwn(BANKS, value);
}

function isOpenIn(value: unknown): value is OpenIn {
	return Object.values<unknown>(OPEN_IN).includes(value);
}

export function cleanLabel(value: string): string {
	return value.trim().slice(0, MAX_LABEL_LENGTH);
}

function readBankLabels(value: unknown): Partial<Record<BankId, string>> {
	if (typeof value !== 'object' || value === null) {
		return {};
	}
	const labels: Partial<Record<BankId, string>> = {};
	Object.entries(value).forEach(([bankId, label]) => {
		if (isBankId(bankId) && typeof label === 'string' && cleanLabel(label) !== '') {
			labels[bankId] = cleanLabel(label);
		}
	});
	return labels;
}

export function defaultBankLabel(bankId: BankId): string {
	return `${BANKS[bankId].name} Virtual Cards`;
}

// The name on a bank's general virtual cards button and menu entry.
export function bankLabel(bankId: BankId, settings: Pick<Settings, 'bankLabels'>): string {
	return settings.bankLabels[bankId] ?? defaultBankLabel(bankId);
}

// Stored values come from sync storage, so validate them and fall back to the defaults.
export async function getSettings(): Promise<Settings> {
	const stored: Partial<Record<keyof Settings, unknown>> = await ext.storage.sync.get({ ...DEFAULT_SETTINGS });
	const storedBanks: unknown[] = Array.isArray(stored.banks) ? stored.banks : [];

	return {
		// Keep banks in BANKS order and drop any that no longer exist.
		banks: BANK_IDS.filter((id) => storedBanks.includes(id)),
		openDirectly: typeof stored.openDirectly === 'boolean' ? stored.openDirectly : DEFAULT_SETTINGS.openDirectly,
		openIn: isOpenIn(stored.openIn) ? stored.openIn : DEFAULT_SETTINGS.openIn,
		bankLabels: readBankLabels(stored.bankLabels),
		savedCardsTipDismissed: stored.savedCardsTipDismissed === true,
		checkoutAutoOpen: typeof stored.checkoutAutoOpen === 'boolean' ? stored.checkoutAutoOpen : DEFAULT_SETTINGS.checkoutAutoOpen,
	};
}

// A blank name keeps the current one; resetBankLabel goes back to the default.
export async function renameBank(bankId: BankId, label: string): Promise<void> {
	const name = cleanLabel(label);
	if (name === '') {
		return;
	}
	const { bankLabels } = await getSettings();
	await saveSettings({ bankLabels: { ...bankLabels, [bankId]: name } });
}

export async function resetBankLabel(bankId: BankId): Promise<void> {
	const { bankLabels } = await getSettings();
	const { [bankId]: _removed, ...rest } = bankLabels;
	await saveSettings({ bankLabels: rest });
}

export async function saveSettings(settings: Partial<Settings>): Promise<void> {
	await ext.storage.sync.set(settings);
}

// One click can only open a page directly when there is exactly one to choose from:
// a single bank and no saved card pages for it.
export function canOpenDirectly(
	settings: Pick<Settings, 'banks' | 'openDirectly'>,
	savedCards: readonly { bankId: BankId }[] = [],
): boolean {
	const [bankId] = settings.banks;
	return settings.openDirectly
		&& settings.banks.length === 1
		&& !savedCards.some((card) => card.bankId === bankId);
}

export function menuId(bankId: BankId): string {
	return `open-${bankId}`;
}

export function cardMenuId(cardId: string): string {
	return `open-card-${cardId}`;
}

// An empty popup string makes the browser fire action.onClicked instead of showing the popup.
export async function applyActionMode(openDirectly: boolean): Promise<void> {
	await ext.action.setPopup({ popup: openDirectly ? '' : POPUP_PATH });
}
