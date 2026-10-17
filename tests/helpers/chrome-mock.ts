import { mock } from 'node:test';
import type { Mock } from 'node:test';

// Minimal in-memory stand-in for the extension APIs CardHop uses.
// Listeners survive reset() because modules register them once, at import time.

type Listener<Args extends unknown[]> = (...args: Args) => unknown;

export interface MockEvent<Args extends unknown[]> {
	addListener: (listener: Listener<Args>) => void;
	removeListener: (listener: Listener<Args>) => void;
	dispatch: (...args: Args) => Promise<unknown[]>;
}

function createEvent<Args extends unknown[]>(): MockEvent<Args> {
	const listeners: Listener<Args>[] = [];
	return {
		addListener: (listener) => {
			listeners.push(listener);
		},
		removeListener: (listener) => {
			const index = listeners.indexOf(listener);
			if (index !== -1) {
				listeners.splice(index, 1);
			}
		},
		dispatch: (...args) => Promise.all(listeners.map((listener) => listener(...args))),
	};
}

type Stored = Record<string, unknown>;
type Tab = { id?: number; url?: string };
type Permissions = { origins?: string[] };
type Sender = { tab?: Tab; frameId?: number };
// The slice of a registered content script the extension code sets.
export type RegisteredScript = {
	id: string;
	matches?: string[];
	js?: string[];
	runAt?: string;
	allFrames?: boolean;
	persistAcrossSessions?: boolean;
};

// A granted <all_urls> covers every origin, as in the browser.
const ALL_URLS = '<all_urls>';

// Tab ids the fake browser hands out for new tabs.
export const NEW_TAB_ID = 101;
export const ACTIVE_TAB_ID = 55;

export function createChromeMock() {
	let syncStore: Stored = {};
	let sessionStore: Stored = {};
	let localStore: Stored = {};
	// What tabs.query reports for the active tab. Undefined url means hidden from CardHop.
	let activeTab: Tab = { id: ACTIVE_TAB_ID };
	let grantedOrigins = new Set<string>();
	let grantOnRequest = true;
	// Each tab's current address, as tabs.get reports it. Missing means hidden from CardHop.
	let tabUrls = new Map<number, string>();
	let registeredScripts: RegisteredScript[] = [];

	const api = {
		storage: {
			sync: {
				// Matches storage.sync.get(defaults): stored values override the defaults passed in.
				get: mock.fn(async (defaults: Stored = {}) => ({ ...defaults, ...structuredClone(syncStore) })),
				set: mock.fn(async (items: Stored) => {
					syncStore = { ...syncStore, ...structuredClone(items) };
				}),
			},
			session: {
				get: mock.fn(async (key: string) => (key in sessionStore ? { [key]: structuredClone(sessionStore[key]) } : {})),
				set: mock.fn(async (items: Stored) => {
					sessionStore = { ...sessionStore, ...structuredClone(items) };
				}),
				remove: mock.fn(async (key: string) => {
					delete sessionStore[key];
				}),
			},
			local: {
				get: mock.fn(async (key: string) => (key in localStore ? { [key]: structuredClone(localStore[key]) } : {})),
				set: mock.fn(async (items: Stored) => {
					localStore = { ...localStore, ...structuredClone(items) };
				}),
				remove: mock.fn(async (key: string) => {
					delete localStore[key];
				}),
			},
			onChanged: createEvent<[changes: Record<string, { newValue?: unknown }>, area: string]>(),
		},
		tabs: {
			query: mock.fn(async (_query: { active?: boolean; currentWindow?: boolean }): Promise<Tab[]> => [structuredClone(activeTab)]),
			get: mock.fn(async (tabId: number): Promise<Tab> => {
				const url = tabUrls.get(tabId);
				return url === undefined ? { id: tabId } : { id: tabId, url };
			}),
			create: mock.fn(async (props: { url: string }): Promise<Tab> => ({ id: NEW_TAB_ID, url: props.url })),
			update: mock.fn(async (...args: [number, { url: string }] | [{ url: string }]): Promise<Tab> => (
				args.length === 2 ? { id: args[0], url: args[1].url } : { id: ACTIVE_TAB_ID, url: args[0].url }
			)),
			onUpdated: createEvent<[tabId: number, changeInfo: { status?: string; url?: string }, tab: Tab]>(),
			onRemoved: createEvent<[tabId: number]>(),
			sendMessage: mock.fn(async (_tabId: number, _message: unknown, _options?: { frameId?: number }): Promise<unknown> => undefined),
		},
		scripting: {
			registerContentScripts: mock.fn(async (scripts: RegisteredScript[]) => {
				const duplicate = scripts.find((script) => registeredScripts.some((existing) => existing.id === script.id));
				if (duplicate) {
					throw new Error(`Duplicate script ID '${duplicate.id}'`);
				}
				registeredScripts = [...registeredScripts, ...structuredClone(scripts)];
			}),
			unregisterContentScripts: mock.fn(async (filter: { ids?: string[] } = {}) => {
				const { ids } = filter;
				registeredScripts = ids ? registeredScripts.filter((script) => !ids.includes(script.id)) : [];
			}),
			getRegisteredContentScripts: mock.fn(async (filter: { ids?: string[] } = {}): Promise<RegisteredScript[]> => {
				const { ids } = filter;
				return structuredClone(ids ? registeredScripts.filter((script) => ids.includes(script.id)) : registeredScripts);
			}),
		},
		action: {
			setPopup: mock.fn(async (_details: { popup: string }) => {}),
			setBadgeText: mock.fn(async (_details: { tabId?: number; text: string }) => {}),
			setBadgeBackgroundColor: mock.fn(async (_details: { tabId?: number; color: string }) => {}),
			setTitle: mock.fn(async (_details: { tabId?: number; title: string }) => {}),
			onClicked: createEvent<[tab: Tab]>(),
		},
		contextMenus: {
			create: mock.fn((_props: { id: string; title: string; contexts: string[] }): string | number => ''),
			removeAll: mock.fn(async () => {}),
			onClicked: createEvent<[info: { menuItemId: string | number }, tab?: Tab]>(),
		},
		permissions: {
			contains: mock.fn(async ({ origins = [] }: Permissions) => (
				origins.every((origin) => grantedOrigins.has(origin) || grantedOrigins.has(ALL_URLS))
			)),
			request: mock.fn(async ({ origins = [] }: Permissions) => {
				if (grantOnRequest) {
					origins.forEach((origin) => grantedOrigins.add(origin));
					await api.permissions.onAdded.dispatch({ origins });
				}
				return grantOnRequest;
			}),
			remove: mock.fn(async ({ origins = [] }: Permissions) => {
				origins.forEach((origin) => grantedOrigins.delete(origin));
				await api.permissions.onRemoved.dispatch({ origins });
				return true;
			}),
			onAdded: createEvent<[permissions: Permissions]>(),
			onRemoved: createEvent<[permissions: Permissions]>(),
		},
		runtime: {
			sendMessage: mock.fn(async (_message: unknown): Promise<unknown> => undefined),
			openOptionsPage: mock.fn(async () => {}),
			onMessage: createEvent<[message: unknown, sender?: Sender, sendResponse?: (response: unknown) => void]>(),
			onInstalled: createEvent<[details: { reason: string }]>(),
			onStartup: createEvent<[]>(),
		},
	};

	const spies: Mock<(...args: never[]) => unknown>[] = [
		api.storage.sync.get,
		api.storage.sync.set,
		api.storage.session.get,
		api.storage.session.set,
		api.storage.session.remove,
		api.storage.local.get,
		api.storage.local.set,
		api.storage.local.remove,
		api.tabs.query,
		api.tabs.get,
		api.tabs.create,
		api.tabs.update,
		api.tabs.sendMessage,
		api.scripting.registerContentScripts,
		api.scripting.unregisterContentScripts,
		api.scripting.getRegisteredContentScripts,
		api.action.setPopup,
		api.action.setBadgeText,
		api.action.setBadgeBackgroundColor,
		api.action.setTitle,
		api.contextMenus.create,
		api.contextMenus.removeAll,
		api.permissions.contains,
		api.permissions.request,
		api.permissions.remove,
		api.runtime.sendMessage,
		api.runtime.openOptionsPage,
	];

	return {
		api,
		// Installs the mock as the global `chrome` the extension code reads.
		install() {
			Object.assign(globalThis, { chrome: api });
		},
		setStored(items: Stored) {
			syncStore = structuredClone(items);
		},
		getStored(): Stored {
			return structuredClone(syncStore);
		},
		getSession(): Stored {
			return structuredClone(sessionStore);
		},
		setLocal(items: Stored) {
			localStore = structuredClone(items);
		},
		getLocal(): Stored {
			return structuredClone(localStore);
		},
		setActiveTabUrl(url: string | undefined) {
			activeTab = url === undefined ? { id: ACTIVE_TAB_ID } : { id: ACTIVE_TAB_ID, url };
		},
		setTabUrl(tabId: number, url: string | undefined) {
			if (url === undefined) {
				tabUrls.delete(tabId);
			} else {
				tabUrls.set(tabId, url);
			}
		},
		grant(...origins: string[]) {
			origins.forEach((origin) => grantedOrigins.add(origin));
		},
		granted(): string[] {
			return [...grantedOrigins];
		},
		registeredScripts(): RegisteredScript[] {
			return structuredClone(registeredScripts);
		},
		setRegisteredScripts(list: RegisteredScript[]) {
			registeredScripts = structuredClone(list);
		},
		// Whether the next permission prompt is accepted.
		answerPermissionPrompts(accept: boolean) {
			grantOnRequest = accept;
		},
		reset() {
			syncStore = {};
			sessionStore = {};
			localStore = {};
			activeTab = { id: ACTIVE_TAB_ID };
			grantedOrigins = new Set();
			grantOnRequest = true;
			tabUrls = new Map();
			registeredScripts = [];
			spies.forEach((spy) => spy.mock.resetCalls());
		},
	};
}

// Lets un-awaited async work (listeners that fire and forget) finish.
export function flush(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

export function callArgs<Args extends unknown[]>(spy: Mock<(...args: Args) => unknown>): Args[] {
	return spy.mock.calls.map((call) => call.arguments);
}
