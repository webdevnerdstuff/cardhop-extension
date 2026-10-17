import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { callArgs, createChromeMock, flush } from './helpers/chrome-mock.ts';

const chromeMock = createChromeMock();
chromeMock.install();
const { api } = chromeMock;

const {
	disable,
	enable,
	forgetTab,
	handleTabUpdated,
	isEnabled,
	SETTLE_MS,
	trackTab,
	TRACK_FOR_MS,
} = await import('../src/sign-in-return.ts');
const { BANKS } = await import('../src/shared.ts');

const SITE = 'https://myaccounts.capitalone.com/*';
const TAB = 7;
const NOW = 1_000_000;

// Addresses from a real Capital One sign-in, as the browser reports them to CardHop
// (which has permission for myaccounts.capitalone.com only).
const CARDS = BANKS.capitalOne.url;
const CARD_DETAIL = 'https://myaccounts.capitalone.com/vc/virtual-cards/card/1234';
const ROOT = 'https://myaccounts.capitalone.com/';
const WELCOME = 'https://myaccounts.capitalone.com/welcome';
const ACCOUNT_HOME = 'https://myaccounts.capitalone.com/accountSummary';
const SIGN_IN = undefined; // verified.capitalone.com is hidden from CardHop

// Sends one tab event and records the address as the tab's current one.
async function update(url: string | undefined, status: 'loading' | 'complete' | undefined, now = NOW): Promise<void> {
	chromeMock.setTabUrl(TAB, url);
	await handleTabUpdated(TAB, status === undefined ? {} : { status }, url === undefined ? {} : { url }, now);
}

// Sends the events the browser fires for one page load.
async function visit(url: string | undefined, now = NOW): Promise<void> {
	await update(url, 'loading', now);
	await update(url, undefined, now);
	await update(url, 'complete', now);
}

// The real sequence: virtual cards, sign-in, then Capital One finishing sign-in on / and /welcome.
async function signIn(now = NOW): Promise<void> {
	await update(CARDS, 'loading', now);
	await visit(CARDS, now);
	await visit(SIGN_IN, now);
	await visit(ROOT, now);
	await visit(WELCOME, now);
}

// Lets any fire-and-forget work finish.
async function waitForRedirect(): Promise<void> {
	await flush();
}

function isTracked(): boolean {
	return `signInReturn:${TAB}` in chromeMock.getSession();
}

beforeEach(async () => {
	chromeMock.reset();
	chromeMock.grant(SITE);
	await trackTab(TAB, 'capitalOne', { now: NOW });
});

describe('signed out', () => {
	it('sends the tab to virtual cards as soon as sign-in lands on account summary', async () => {
		await signIn();
		await update(ACCOUNT_HOME, 'loading');
		assert.equal(api.tabs.update.mock.callCount(), 0, 'lets the landing page start loading');

		await update(ACCOUNT_HOME, undefined);
		assert.deepEqual(callArgs(api.tabs.update), [[TAB, { url: CARDS }]]);
		assert.equal(isTracked(), false);
	});

	// Regression: redirecting from /welcome interrupted Capital One's sign-in and signed the user out.
	it('never interrupts the pages that finish signing in', async () => {
		await signIn();
		await waitForRedirect();

		assert.equal(api.tabs.update.mock.callCount(), 0);
		assert.equal(isTracked(), true);
	});

	it('does not act while the landing page is still loading', async () => {
		await signIn();
		await update(ACCOUNT_HOME, 'loading');
		await waitForRedirect();

		assert.equal(api.tabs.update.mock.callCount(), 0);
	});

	// Regression: two simultaneous events used to send two redirects ("Navigation rejected").
	it('schedules only one redirect however many events arrive', async () => {
		await signIn();
		await Promise.all([
			update(ACCOUNT_HOME, undefined),
			update(ACCOUNT_HOME, 'complete'),
			update(ACCOUNT_HOME, undefined),
		]);
		await waitForRedirect();

		assert.equal(api.tabs.update.mock.callCount(), 1);
	});

	it('survives the browser rejecting the redirect', async () => {
		api.tabs.update.mock.mockImplementationOnce(async () => {
			throw new Error('Navigation rejected.');
		});
		await signIn();
		await visit(ACCOUNT_HOME);
		await waitForRedirect();

		assert.equal(api.tabs.update.mock.callCount(), 1);
	});

	// Regression: after sign-in returned straight to virtual cards, clicking to account summary
	// within the watch window was redirected back.
	it('stops watching once sign-in brings the tab to virtual cards itself', async () => {
		await signIn();
		await visit(CARD_DETAIL);
		assert.equal(isTracked(), false);

		await visit(ACCOUNT_HOME);
		assert.equal(api.tabs.update.mock.callCount(), 0);
	});

	it('stops watching if no landing page appears soon after sign-in', async () => {
		await signIn(NOW);
		await visit(ACCOUNT_HOME, NOW + SETTLE_MS + 1);
		await waitForRedirect();

		assert.equal(api.tabs.update.mock.callCount(), 0);
		assert.equal(isTracked(), false);
	});
});

describe('signed in', () => {
	it('leaves the tab alone when it goes straight to virtual cards', async () => {
		await update('', 'loading');
		await visit(CARDS);
		await visit(CARD_DETAIL);
		await waitForRedirect();

		assert.equal(api.tabs.update.mock.callCount(), 0);
	});

	it('does not pull the user back after they browse to account summary', async () => {
		await visit(CARDS);
		await visit(ACCOUNT_HOME);
		await waitForRedirect();

		assert.equal(api.tabs.update.mock.callCount(), 0);
	});

	it('ignores the blank address a new tab reports before loading', async () => {
		await update('about:blank', 'loading');
		await visit(ACCOUNT_HOME);
		await waitForRedirect();

		assert.equal(api.tabs.update.mock.callCount(), 0);
	});
});

describe('tracking lifetime', () => {
	it('stops watching after the time limit', async () => {
		const later = NOW + TRACK_FOR_MS + 1;
		await signIn(later);
		await visit(ACCOUNT_HOME, later);
		await waitForRedirect();

		assert.equal(api.tabs.update.mock.callCount(), 0);
		assert.equal(isTracked(), false);
	});

	it('stops watching when the tab is closed', async () => {
		await forgetTab(TAB);
		assert.equal(isTracked(), false);
	});

	it('ignores tabs it did not open', async () => {
		await handleTabUpdated(99, { status: 'complete' }, {}, NOW);
		await handleTabUpdated(99, { status: 'complete' }, { url: ACCOUNT_HOME }, NOW);
		await waitForRedirect();
		assert.equal(api.tabs.update.mock.callCount(), 0);
	});

	it('ignores malformed stored state', async () => {
		await api.storage.session.set({ [`signInReturn:${TAB}`]: { bankId: 'unknown' } });
		await visit(SIGN_IN);
		await visit(ACCOUNT_HOME);
		await waitForRedirect();
		assert.equal(api.tabs.update.mock.callCount(), 0);
	});
});

describe('permission', () => {
	beforeEach(() => chromeMock.reset());

	it('is off until the user grants access to the account site', async () => {
		assert.equal(await isEnabled('capitalOne'), false);
		chromeMock.grant(SITE);
		assert.equal(await isEnabled('capitalOne'), true);
	});

	it('enable asks for the account site only', async () => {
		assert.equal(await enable('capitalOne'), true);
		assert.deepEqual(callArgs(api.permissions.request), [[{ origins: [SITE] }]]);
		assert.deepEqual(chromeMock.granted(), [SITE]);
	});

	it('enable reports a declined prompt', async () => {
		chromeMock.answerPermissionPrompts(false);
		assert.equal(await enable('capitalOne'), false);
		assert.equal(await isEnabled('capitalOne'), false);
	});

	it('disable gives the permission back', async () => {
		chromeMock.grant(SITE);
		await disable('capitalOne');
		assert.deepEqual(chromeMock.granted(), []);
	});

	it('does nothing for banks without a sign-in rule', async () => {
		assert.equal(await isEnabled('citi'), false);
		assert.equal(await enable('citi'), false);
		await disable('citi');
		assert.equal(api.permissions.request.mock.callCount(), 0);
		assert.equal(api.permissions.remove.mock.callCount(), 0);
	});

	it('does not watch tabs without the permission', async () => {
		await trackTab(TAB, 'capitalOne', { now: NOW });
		assert.equal(isTracked(), false);
	});
});

describe('saved card pages', () => {
	const SAVED = 'https://myaccounts.capitalone.com/vc/virtual-cards/home?arid=second';
	const FIRST_CARD = 'https://myaccounts.capitalone.com/vc/virtual-cards/home?arid=first';

	beforeEach(async () => {
		chromeMock.reset();
		chromeMock.grant(SITE);
		await trackTab(TAB, 'capitalOne', { url: SAVED, now: NOW });
	});

	it('returns to the saved card, not the general page, after sign-in', async () => {
		await signIn();
		await visit(ACCOUNT_HOME);
		assert.deepEqual(callArgs(api.tabs.update), [[TAB, { url: SAVED }]]);
	});

	it('moves on from a different card that sign-in showed', async () => {
		await signIn();
		await visit(FIRST_CARD);
		assert.deepEqual(callArgs(api.tabs.update), [[TAB, { url: SAVED }]]);
	});

	it('stops once the saved card shows, even with extra parameters', async () => {
		await signIn();
		await visit(`${SAVED}&analyticsTag=x`);
		assert.equal(api.tabs.update.mock.callCount(), 0);
		assert.equal(isTracked(), false);
	});

	it('leaves a signed-in user on whichever card they pick', async () => {
		await visit(SAVED);
		await visit(FIRST_CARD);
		assert.equal(api.tabs.update.mock.callCount(), 0);
	});
});
