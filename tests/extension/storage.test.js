import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LANGUAGE_PREFERENCES } from '../../src/shared/languages.js';

import {
	findBinding,
	findBindings,
	getBindings,
	lockStorageToTrustedContexts,
	getConnectionStatus,
	getSettings,
	getLanguagePreference,
	saveLanguagePreference,
	getFavoriteIds,
	setFavorite,
	getInstanceOrigins,
	removeBinding,
	removeBindingsForInstance,
	rememberBinding,
	saveSettings,
} from '../../extension/src/shared/storage.js';

const INSTANCE = 'https://twofa.example';
const TARGET = 'https://www.nodeseek.com';
const FIRST = { instanceOrigin: INSTANCE, targetOrigin: TARGET, accountId: 'first' };
const SECOND = { ...FIRST, accountId: 'second' };
let values;
let session;

beforeEach(() => {
	values = { settings: { instanceOrigin: INSTANCE } };
	session = {};
	globalThis.chrome = {
		storage: {
			local: {
				get: vi.fn(async (key) =>
					Object.fromEntries((Array.isArray(key) ? key : [key]).map((item) => [item, structuredClone(values[item])])),
				),
				set: vi.fn(async (entries) => Object.assign(values, structuredClone(entries))),
				remove: vi.fn(async (key) => {
					delete values[key];
				}),
				setAccessLevel: vi.fn(async () => {}),
			},
			session: {
				get: vi.fn(async (key) => ({ [key]: structuredClone(session[key]) })),
				set: vi.fn(async (entries) => Object.assign(session, structuredClone(entries))),
				remove: vi.fn(async (key) => {
					delete session[key];
				}),
				setAccessLevel: vi.fn(async () => {}),
			},
		},
	};
});

afterEach(() => {
	delete globalThis.chrome;
});

describe('independent language preference', () => {
	it('defaults missing or corrupt preferences to the browser language without writing storage', async () => {
		for (const value of [undefined, null, '', 'zh-HK', 'constructor', {}, []]) {
			values.language = value;
			expect(await getLanguagePreference()).toBe('auto');
		}
		expect(chrome.storage.local.set).not.toHaveBeenCalled();
	});
	it('persists every supported preference independently of connection and user metadata', async () => {
		values.bindings = [FIRST];
		values.offlineInstances = [INSTANCE];
		for (const preference of LANGUAGE_PREFERENCES) {
			await saveLanguagePreference(preference);
			expect(await getLanguagePreference()).toBe(preference);
			expect(await getSettings()).toEqual({ instanceOrigin: INSTANCE });
			expect(await getConnectionStatus(INSTANCE)).toEqual({ mode: 'offline' });
			expect(values.bindings).toEqual([FIRST]);
		}
	});
	it('serializes language writes together with instance changes and favorites', async () => {
		await Promise.all([
			saveLanguagePreference('zh-TW'),
			saveSettings(INSTANCE, { mode: 'offline' }),
			setFavorite(INSTANCE, 'first', true),
			saveLanguagePreference('en'),
		]);
		expect(await getLanguagePreference()).toBe('en');
		expect(await getSettings()).toEqual({ instanceOrigin: INSTANCE });
		expect(await getConnectionStatus(INSTANCE)).toEqual({ mode: 'offline' });
		expect(await getFavoriteIds(INSTANCE)).toEqual(['first']);
	});
	it.each([undefined, null, '', 'zh', 'zh-HK', 'ar', 'constructor', {}, []])(
		'rejects unsupported preference %j without mutation',
		async (value) => {
			await expect(saveLanguagePreference(value)).rejects.toMatchObject({ code: 'INVALID_REQUEST', messageKey: 'error_LANGUAGE_INVALID' });
			expect(chrome.storage.local.set).not.toHaveBeenCalled();
		},
	);
});

describe('per-site account bindings', () => {
	it('loads a legacy single binding and removes duplicates or invalid records', async () => {
		values.bindings = [FIRST, { ...FIRST, targetOrigin: `${TARGET}/signIn.html` }, null, { ...FIRST, accountId: '' }, SECOND];
		expect(await getBindings()).toEqual([FIRST, SECOND]);
		expect(await findBindings(INSTANCE, TARGET)).toEqual([FIRST, SECOND]);
		expect(await findBinding(INSTANCE, TARGET)).toBeNull();
		values.bindings = [FIRST];
		expect(await findBinding(INSTANCE, TARGET)).toEqual(FIRST);
	});

	it('ignores a page login email saved by an earlier version, and drops it on the next write', async () => {
		values.bindings = [
			{ ...FIRST, loginEmail: 'alice@example.com' },
			{ ...SECOND, loginEmail: 'bob@example.com' },
		];
		expect(await getBindings()).toEqual([FIRST, SECOND]);
		// Remembering the already bound accounts again changes no binding, yet rewrites them.
		await rememberBinding(FIRST, { scopeOf: (accountId) => ({ first: 'alice@example.com', second: 'bob@example.com' })[accountId] });
		expect(values.bindings).toEqual([FIRST, SECOND]);
		values.bindings = [{ ...FIRST, loginEmail: 'alice@example.com' }];
		await removeBinding(INSTANCE, 'https://other.example', FIRST.accountId);
		expect(values.bindings).toEqual([FIRST]);
		expect(JSON.stringify(values)).not.toContain('@example.com');
	});

	it('deletes one account without deleting its sibling or a binding on another site', async () => {
		const otherSite = { ...FIRST, targetOrigin: 'https://other.example' };
		values.bindings = [FIRST, SECOND, otherSite];
		await removeBinding(INSTANCE, TARGET, FIRST.accountId);
		expect(values.bindings).toEqual([SECOND, otherSite]);
	});

	it('supports an explicit whole-site cleanup when no account ID is supplied', async () => {
		values.bindings = [FIRST, SECOND];
		await removeBinding(INSTANCE, TARGET);
		expect(values.bindings).toEqual([]);
	});

	it.each([null, '', 123])('does not treat invalid account ID %s as a whole-site delete', async (accountId) => {
		values.bindings = [FIRST, SECOND];
		await expect(removeBinding(INSTANCE, TARGET, accountId)).rejects.toThrow('accountId');
		expect(values.bindings).toEqual([FIRST, SECOND]);
	});

	describe('remembering the account chosen for a website', () => {
		const OTHER_SITE = { ...FIRST, targetOrigin: 'https://other.example' };
		const OTHER_INSTANCE = { ...FIRST, instanceOrigin: 'https://second.example' };

		it('replaces the earlier account so the website keeps one automatic choice', async () => {
			values.bindings = [FIRST, OTHER_SITE, OTHER_INSTANCE];
			await expect(rememberBinding(SECOND)).resolves.toEqual(SECOND);
			expect(values.bindings).toEqual([OTHER_SITE, OTHER_INSTANCE, SECOND]);
			expect(await findBinding(INSTANCE, TARGET)).toEqual(SECOND);
		});

		it('converges older duplicate bindings when an already remembered account is filled again', async () => {
			values.bindings = [FIRST, SECOND, OTHER_SITE];
			await expect(rememberBinding(SECOND)).resolves.toEqual(SECOND);
			expect(values.bindings).toEqual([SECOND, OTHER_SITE]);
			expect(await findBinding(INSTANCE, TARGET)).toEqual(SECOND);
		});

		it('does not rewrite storage when the account is already the only binding', async () => {
			values.bindings = [FIRST, OTHER_SITE];
			await expect(rememberBinding(FIRST)).resolves.toEqual(FIRST);
			expect(values.bindings).toEqual([FIRST, OTHER_SITE]);
			expect(chrome.storage.local.set).not.toHaveBeenCalled();
		});

		it('keeps the last account when concurrent choices are queued', async () => {
			await Promise.all([rememberBinding(FIRST), rememberBinding(SECOND)]);
			expect(values.bindings).toEqual([SECOND]);
		});

		it('does not write a choice after the instance changed', async () => {
			values.bindings = [FIRST];
			await Promise.all([saveSettings('https://new.example'), removeBindingsForInstance(INSTANCE), rememberBinding(SECOND)]);
			expect(values.bindings).toEqual([]);
		});

		it('requires an account ID', async () => {
			await expect(rememberBinding({ ...FIRST, accountId: '' })).rejects.toThrow('accountId');
			expect(values.bindings).toBeUndefined();
		});
	});

	describe('remembering accounts told apart by their own login email', () => {
		const bound = (accountId) => ({ ...FIRST, accountId });
		const OTHER_SITE = { ...FIRST, targetOrigin: 'https://other.example' };
		// The emails the instance records for each account; missing means not visible.
		const EMAILS = {
			alice: 'alice@example.com',
			'alice-work': 'alice@example.com',
			bob: 'bob@example.com',
			'no-email': null,
			'other-no-email': null,
		};
		const byEmail = { scopeOf: (accountId) => (Object.hasOwn(EMAILS, accountId) ? EMAILS[accountId] : undefined) };

		it('keeps each account email remembered instead of replacing the other login', async () => {
			await rememberBinding(bound('alice'), byEmail);
			await rememberBinding(bound('bob'), byEmail);
			await rememberBinding(bound('alice'), byEmail);
			expect(values.bindings).toEqual([bound('alice'), bound('bob')]);
		});

		it('replaces only bindings of accounts with the same email, and stores no email', async () => {
			values.bindings = [bound('alice'), bound('bob'), OTHER_SITE];
			await expect(rememberBinding(bound('alice-work'), byEmail)).resolves.toEqual(bound('alice-work'));
			expect(values.bindings).toEqual([bound('bob'), OTHER_SITE, bound('alice-work')]);
			expect(JSON.stringify(values.bindings)).not.toContain('@');
		});

		it('scopes accounts without an email together, apart from accounts with one', async () => {
			values.bindings = [bound('alice'), bound('no-email')];
			await rememberBinding(bound('other-no-email'), byEmail);
			expect(values.bindings).toEqual([bound('alice'), bound('other-no-email')]);
		});

		it('keeps a binding whose account the caller cannot see', async () => {
			values.bindings = [bound('unavailable'), bound('alice-work')];
			await rememberBinding(bound('alice'), byEmail);
			expect(values.bindings).toEqual([bound('unavailable'), bound('alice')]);
		});

		it('converges duplicates of the same email when an already bound account is remembered', async () => {
			values.bindings = [bound('alice-work'), bound('alice'), bound('bob'), OTHER_SITE];
			await rememberBinding(bound('alice'), byEmail);
			expect(values.bindings).toEqual([bound('alice'), bound('bob'), OTHER_SITE]);
		});

		it('queues concurrent choices for different emails without losing either', async () => {
			await Promise.all([
				rememberBinding(bound('alice'), byEmail),
				rememberBinding(bound('bob'), byEmail),
				rememberBinding(bound('alice'), byEmail),
			]);
			expect(values.bindings).toEqual([bound('alice'), bound('bob')]);
		});

		it('replaces every binding on other websites, which have no email scope', async () => {
			values.bindings = [bound('alice'), bound('bob'), OTHER_SITE];
			await rememberBinding(bound('shared'));
			expect(values.bindings).toEqual([OTHER_SITE, bound('shared')]);
		});
	});

	it('does not resurrect old-instance bindings after a queued settings change', async () => {
		values.bindings = [FIRST, SECOND];
		await Promise.all([saveSettings('https://new.example'), removeBindingsForInstance(INSTANCE), rememberBinding(FIRST)]);
		expect(values.settings.instanceOrigin).toBe('https://new.example');
		expect(values.bindings).toEqual([]);
	});
});

it('remembers instance addresses across switches without removing any bindings', async () => {
	values.bindings = [FIRST, { ...SECOND, instanceOrigin: 'https://second.example' }];
	await saveSettings('https://second.example');
	await saveSettings(INSTANCE);
	expect(await getInstanceOrigins()).toEqual(['https://second.example', INSTANCE]);
	expect(values.bindings).toHaveLength(2);
	expect(values.settings.instanceOrigin).toBe(INSTANCE);
});

it('keeps favorites isolated by instance and serializes edits without binding changes', async () => {
	await Promise.all([setFavorite(INSTANCE, 'first', true), setFavorite(INSTANCE, 'second', true)]);
	expect(await getFavoriteIds(INSTANCE)).toEqual(['first', 'second']);
	await saveSettings('https://second.example');
	await setFavorite('https://second.example', 'first', true);
	await expect(setFavorite(INSTANCE, 'third', true)).rejects.toThrow('实例已变化');
	await setFavorite('https://second.example', 'first', false);
	expect(await getFavoriteIds(INSTANCE)).toEqual(['first', 'second']);
	expect(await getFavoriteIds('https://second.example')).toEqual([]);
	expect(values.bindings).toBeUndefined();
});

it('stores only session or offline connections and rejects the removed mode', async () => {
	await saveSettings(INSTANCE, { mode: 'offline' });
	expect(await getConnectionStatus(INSTANCE)).toEqual({ mode: 'offline' });
	await expect(saveSettings(INSTANCE, { mode: 'device', token: 'legacy-token' })).rejects.toThrow('连接方式无效');
	expect(await getConnectionStatus(INSTANCE)).toEqual({ mode: 'offline' });
	await saveSettings(INSTANCE, { mode: 'session' });
	expect(await getConnectionStatus(INSTANCE)).toEqual({ mode: 'session' });
	expect(values).not.toHaveProperty('deviceAuth');
});

describe('removal of legacy device authorization', () => {
	const OTHER = 'https://other.example';
	const LEGACY = 'https://legacy.example';
	const policy = (instanceOrigin) => ({ instanceOrigin, targetOrigin: TARGET });

	it('disconnects the current scoped connection and clears every historical token and policy without losing user metadata', async () => {
		values.deviceAuth = [
			{ instanceOrigin: INSTANCE, token: 'old-current-token' },
			{ instanceOrigin: LEGACY, token: 'old-history-token' },
		];
		values.instances = [OTHER, LEGACY, INSTANCE];
		values.bindings = [FIRST, { ...SECOND, instanceOrigin: LEGACY }];
		values.favorites = [{ instanceOrigin: INSTANCE, accountId: 'first' }];
		values.offlineInstances = [INSTANCE, OTHER, LEGACY];
		values.autofillSites = [policy(INSTANCE), policy(OTHER), policy(LEGACY)];
		values.offlineCache = { instanceOrigin: INSTANCE, snapshot: { privateData: 'stale-vault' } };
		session.pendingFlow = { instanceOrigin: INSTANCE, nonce: 'stale-nonce' };
		const metadata = structuredClone({ instances: values.instances, bindings: values.bindings, favorites: values.favorites });
		await lockStorageToTrustedContexts();
		expect(await getSettings()).toEqual({ instanceOrigin: null });
		expect(values).not.toHaveProperty('deviceAuth');
		expect(values).not.toHaveProperty('offlineCache');
		expect(session).not.toHaveProperty('pendingFlow');
		expect(values.offlineInstances).toEqual([OTHER]);
		expect(values.autofillSites).toEqual([policy(OTHER)]);
		expect(values).toMatchObject(metadata);
		for (const area of [chrome.storage.local, chrome.storage.session]) {
			expect(area.setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
		}
		// Reconnection is explicit, and it cannot restore old automatic grants.
		await saveSettings(INSTANCE, { mode: 'session' });
		expect(values.autofillSites).toEqual([policy(OTHER)]);
	});

	it.each(['session', 'offline'])('preserves the current %s connection while retiring a different instance', async (mode) => {
		values.deviceAuth = [{ instanceOrigin: LEGACY, token: 'old-history-token' }];
		values.offlineInstances = mode === 'offline' ? [INSTANCE, LEGACY] : [LEGACY];
		values.autofillSites = [policy(INSTANCE), policy(LEGACY)];
		values.offlineCache = { instanceOrigin: INSTANCE, snapshot: { privateData: 'current-vault' } };
		await lockStorageToTrustedContexts();
		expect(await getSettings()).toEqual({ instanceOrigin: INSTANCE });
		expect(await getConnectionStatus(INSTANCE)).toEqual({ mode });
		expect(values.autofillSites).toEqual([policy(INSTANCE)]);
		expect(values.offlineCache.snapshot.privateData).toBe('current-vault');
		expect(values).not.toHaveProperty('deviceAuth');
	});

	it('preserves the disconnected instance in history even when older history is absent', async () => {
		values.deviceAuth = [{ instanceOrigin: INSTANCE, token: 'old-token' }];
		await lockStorageToTrustedContexts();
		expect(await getInstanceOrigins()).toEqual([INSTANCE]);
	});

	it('moves the disconnected current instance to the end of history for the reconnect suggestion', async () => {
		values.deviceAuth = [{ instanceOrigin: INSTANCE, token: 'old-token' }];
		values.instances = [INSTANCE, OTHER, LEGACY];
		await lockStorageToTrustedContexts();
		expect(await getInstanceOrigins()).toEqual([OTHER, LEGACY, INSTANCE]);
		expect(await getSettings()).toEqual({ instanceOrigin: null });
	});

	it('does not write or clear pending flows when the legacy key is absent', async () => {
		session.pendingFlow = { instanceOrigin: INSTANCE, nonce: 'current-nonce' };
		await lockStorageToTrustedContexts();
		await lockStorageToTrustedContexts();
		expect(chrome.storage.local.set).not.toHaveBeenCalled();
		expect(chrome.storage.local.remove).not.toHaveBeenCalled();
		expect(chrome.storage.session.remove).not.toHaveBeenCalled();
	});

	it.each(['settings', 'pending', 'cache', 'credential'])(
		'retains the migration marker after a %s write failure and safely retries',
		async (stage) => {
			values.deviceAuth = [{ instanceOrigin: INSTANCE, token: 'old-token' }];
			values.autofillSites = [policy(INSTANCE)];
			if (stage === 'cache') {
				values.offlineCache = { instanceOrigin: INSTANCE, snapshot: { privateData: 'stale-vault' } };
			}
			session.pendingFlow = { instanceOrigin: INSTANCE, nonce: 'stale-nonce' };
			const operation =
				stage === 'settings' ? chrome.storage.local.set : stage === 'pending' ? chrome.storage.session.remove : chrome.storage.local.remove;
			operation.mockRejectedValueOnce(new Error('storage unavailable'));
			await expect(lockStorageToTrustedContexts()).rejects.toThrow('storage unavailable');
			expect(values.deviceAuth).toHaveLength(1);
			await lockStorageToTrustedContexts();
			expect(await getSettings()).toEqual({ instanceOrigin: null });
			expect(values).not.toHaveProperty('deviceAuth');
			expect(values).not.toHaveProperty('offlineCache');
			expect(values.autofillSites).toEqual([]);
			expect(session).not.toHaveProperty('pendingFlow');
		},
	);

	it('removes an empty legacy container without disconnecting the active offline connection', async () => {
		values.deviceAuth = [];
		values.offlineInstances = [INSTANCE];
		values.autofillSites = [policy(INSTANCE)];
		values.offlineCache = { instanceOrigin: INSTANCE, snapshot: { privateData: 'current-vault' } };
		await lockStorageToTrustedContexts();
		expect(await getSettings()).toEqual({ instanceOrigin: INSTANCE });
		expect(await getConnectionStatus(INSTANCE)).toEqual({ mode: 'offline' });
		expect(values.autofillSites).toEqual([policy(INSTANCE)]);
		expect(values.offlineCache.snapshot.privateData).toBe('current-vault');
		expect(values).not.toHaveProperty('deviceAuth');
		chrome.storage.local.set.mockClear();
		await lockStorageToTrustedContexts();
		expect(chrome.storage.local.set).not.toHaveBeenCalled();
	});

	it.each([{ token: 'corrupt-container' }, [{ token: 'missing-origin' }]])(
		'fails closed for a legacy entry with unknown scope: %j',
		async (legacy) => {
			values.deviceAuth = legacy;
			values.autofillSites = [policy(INSTANCE), policy(OTHER)];
			values.offlineInstances = [INSTANCE, OTHER];
			await lockStorageToTrustedContexts();
			expect(await getSettings()).toEqual({ instanceOrigin: null });
			expect(values.autofillSites).toEqual([]);
			expect(values.offlineInstances).toEqual([]);
			expect(values).not.toHaveProperty('deviceAuth');
		},
	);
});
