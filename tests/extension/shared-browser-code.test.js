import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';

import { filterAccountsByQuery } from '../../src/shared/search-filter.js';
import { groupSecretsByServiceFamily, resolveServiceDomain } from '../../src/shared/service-aggregation.js';
import { parseOfflineClockCache, parseOfflineSecretsCache } from '../../src/shared/offline-cache.js';

const accounts = [
	{ id: 'gmail', name: 'Gmail', account: 'alice' },
	{ id: 'youtube', name: 'YouTube', account: 'bob' },
	{ id: 'github', name: 'GitHub', account: 'alice' },
];
const baseTime = Date.UTC(2026, 0, 1);
const clock = {
	version: 2,
	offsetMs: 1500,
	syncedAtServerMs: baseTime + 1500,
	rttMs: 20,
	localWallAtSyncMs: baseTime,
	monotonicEpochAtSyncMs: baseTime,
};

describe('shared modules in standalone Worker pages', () => {
	it.each([
		{ minify: false, keepNames: false },
		{ minify: true, keepNames: false },
		{ minify: false, keepNames: true },
		{ minify: true, keepNames: true },
	])('executes the bundled Worker page (minify=$minify, keepNames=$keepNames)', async ({ minify, keepNames }) => {
		// Bundle the real Worker entry with the release target and resolver. IIFE
		// only exposes its exports to the isolated VM; all source is still bundled
		// and renamed before any client-side closure is serialized.
		const result = await build({
			entryPoints: ['src/worker.js'],
			bundle: true,
			format: 'iife',
			globalName: 'releaseWorker',
			target: 'es2022',
			platform: 'neutral',
			mainFields: ['browser', 'module', 'main'],
			minify,
			// Wrangler defaults to preserving names and may otherwise inject
			// helpers outside the closures serialized into the browser page.
			keepNames,
			write: false,
			logLevel: 'silent',
		});
		const silentConsole = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
		const worker = runInNewContext(`${result.outputFiles[0].text}\nreleaseWorker.default;`, {
			URL,
			Request,
			Response,
			Headers,
			crypto,
			TextEncoder,
			TextDecoder,
			btoa,
			atob,
			console: silentConsole,
			setInterval: () => 0,
			clearInterval() {},
			setTimeout: () => 0,
			clearTimeout() {},
		});
		const response = await worker.fetch(
			new Request('https://twofa.example/'),
			{
				SECRETS_KV: { get: async (key) => (key === 'user_password' ? 'configured-password-hash' : null) },
			},
			{ waitUntil() {} },
		);
		expect(response.status).toBe(200);
		const html = await response.text();
		const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
		expect(scripts.length).toBeGreaterThan(0);

		const browser = new Window({ url: 'https://twofa.example/' });
		try {
			// Parse and run the emitted declarations without starting page lifecycle
			// work or network timers; each helper is then invoked in the same realm.
			browser.addEventListener = () => {};
			browser.document.addEventListener = () => {};
			browser.setInterval = () => 0;
			browser.setTimeout = () => 0;
			browser.console = silentConsole;
			browser.localStorage.setItem('language', 'zh-CN');
			browser.testAccounts = accounts;
			browser.testCache = JSON.stringify({ data: accounts, timestamp: baseTime });
			browser.testClock = JSON.stringify(clock);
			browser.testNow = baseTime + 1000;
			const web = browser.eval(`${scripts.map(([, script]) => script).join('\n')}\n({
				filtered: filterAccountsByQuery(testAccounts, 'Google'),
				groups: groupSecretsByServiceFamily(testAccounts, testAccounts),
				domain: resolveServiceDomain('https://accounts.google.com/signin'),
				rejectedDomain: resolveServiceDomain('GitHub@evil.example/signin'),
				cache: parseOfflineSecretsCache(testCache),
				clock: parseOfflineClockCache(testClock, testNow, testNow),
				invalidClock: parseOfflineClockCache(testClock, testNow + 60001, testNow),
				localize(language) {
					setLanguage(language);
					return {
						group: groupSecretsByServiceFamily(testAccounts, testAccounts).at(-1),
						filtered: filterAccountsByQuery(testAccounts, getOtherServiceGroupName())
					};
				}
			})`);
			expect(web.filtered.map(({ id }) => id)).toEqual(['gmail', 'youtube']);
			expect(web.filtered).toEqual(filterAccountsByQuery(accounts, 'Google'));
			expect(web.groups).toEqual(groupSecretsByServiceFamily(accounts, accounts));
			expect(web.domain).toBe(resolveServiceDomain('https://accounts.google.com/signin'));
			expect(web.rejectedDomain).toBeNull();
			expect(web.cache).toEqual(parseOfflineSecretsCache(browser.testCache));
			expect(web.clock).toEqual(parseOfflineClockCache(browser.testClock, browser.testNow, browser.testNow));
			expect(web.invalidClock).toBeNull();

			for (const [language, label] of [
				['en', 'Other Services'],
				['zh-TW', '其他服務'],
			]) {
				const localized = web.localize(language);
				expect(localized.group.name).toBe(label);
				expect(localized.filtered.map(({ id }) => id)).toEqual(['github']);
			}
		} finally {
			await browser.happyDOM.close();
		}
	});
});
