import { ext } from './ext.ts';

// Sites where the user chose "Not on this site". Kept in local storage: the list is a browsing
// history of sorts, so it stays on this device and is never synced.
export const CHECKOUT_DISABLED_SITES_KEY = 'checkoutDisabledSites';

function normalize(hostname: string): string {
	return hostname.trim().toLowerCase();
}

export async function getDisabledSites(): Promise<string[]> {
	const stored = await ext.storage.local.get(CHECKOUT_DISABLED_SITES_KEY);
	const sites: unknown = stored[CHECKOUT_DISABLED_SITES_KEY];
	if (!Array.isArray(sites)) {
		return [];
	}
	const hostnames = sites.filter((site): site is string => typeof site === 'string').map(normalize);
	return [...new Set(hostnames)].filter((site) => site !== '').sort();
}

async function saveSites(sites: string[]): Promise<void> {
	await ext.storage.local.set({ [CHECKOUT_DISABLED_SITES_KEY]: sites });
}

export async function disableSite(hostname: string): Promise<void> {
	const site = normalize(hostname);
	if (site === '') {
		return;
	}
	const sites = await getDisabledSites();
	await saveSites([...new Set([...sites, site])].sort());
}

export async function enableSite(hostname: string): Promise<void> {
	const site = normalize(hostname);
	const sites = await getDisabledSites();
	await saveSites(sites.filter((existing) => existing !== site));
}
