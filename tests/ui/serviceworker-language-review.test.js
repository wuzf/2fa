import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { createServiceWorker } from '../../src/ui/serviceworker.js';
import { SUPPORTED_LANGUAGES } from '../../src/shared/languages.js';
import { getRequestLanguage } from '../../src/utils/i18n.js';
import { OFFLINE_MESSAGES } from '../../src/ui/locales/offline.js';

async function worker() {
	const listeners = new Map();
	const records = [];
	const fetch = vi.fn(async () => {
		throw new TypeError('offline');
	});
	const self = {
		location: new URL('https://example.test/sw.js'),
		navigator: { onLine: true, language: 'en' },
		registration: { sync: { register: vi.fn(async () => {}) }, showNotification: vi.fn(async () => {}) },
		clients: { matchAll: async () => [] },
		addEventListener: (type, listener) => listeners.set(type, [...(listeners.get(type) || []), listener]),
	};
	const context = createContext({
		self,
		location: self.location,
		Request,
		Response,
		URL,
		fetch,
		setTimeout,
		clearTimeout,
		console: { log() {}, warn() {}, error() {} },
	});
	runInContext(await createServiceWorker().text(), context);
	context.saveOperation = async (operation) => {
		records.push({ ...operation, id: 'queued', timestamp: 1, status: 'pending' });
		return 'queued';
	};
	context.getOfflineOperations = async () => records;
	context.deleteOperation = async (id) =>
		records.splice(
			records.findIndex((record) => record.id === id),
			1,
		);
	function dispatch(type, fields) {
		let response;
		const tasks = [];
		for (const listener of listeners.get(type) || []) {
			listener({
				...fields,
				respondWith: (result) => {
					response = result;
				},
				waitUntil: (task) => tasks.push(task),
			});
		}
		return { response, done: Promise.all(tasks) };
	}
	return { api: context, fetch, records, self, dispatch };
}

describe('independent offline request language review', () => {
	it('matches server negotiation for every explicit, regional and unsupported preference', async () => {
		const app = await worker();
		const requests = [
			...SUPPORTED_LANGUAGES.map((language) => new Request('https://example.test/api', { headers: { 'X-Language': language } })),
			...['', 'unsupported', 'de-DE', 'pt_PT', 'zh-Hant-HK'].map(
				(language) => new Request('https://example.test/api?lang=ja', { headers: { 'X-Language': language, 'Accept-Language': 'zh-CN' } }),
			),
			new Request('https://example.test/api?lang=unsupported', { headers: { 'Accept-Language': 'zh-CN' } }),
			new Request('https://example.test/api?lang=', { headers: { 'Accept-Language': 'zh-CN' } }),
			new Request('https://example.test/api'),
		];
		for (const request of requests) {
			expect(app.api.offlineRequestLanguage(request), `${request.url} ${request.headers.get('X-Language')}`).toBe(
				getRequestLanguage(request),
			);
		}
	});
	it.each([
		['en,en-US;q=0.9', 'en'],
		['zh-TW,zh;q=0.9,en;q=0.8', 'zh-TW'],
		['fr-FR,zh-TW;q=0.8,en;q=0.7', 'fr'],
		['zh-CN;q=0.2,en-US;q=0.9', 'en'],
		['en;q=0,zh-TW;q=1', 'zh-TW'],
	])('uses the highest-priority supported language from %s', async (header, language) => {
		const app = await worker();
		const { response } = app.dispatch('fetch', {
			request: new Request('https://example.test/api/settings', { headers: { 'Accept-Language': header } }),
		});
		expect(await (await response).json()).toMatchObject({ error: OFFLINE_MESSAGES[language].networkFailed });
	});

	it.each(['/api/settings?language=en', '/resource.txt?language=en'])('honors the language URL alias for %s', async (path) => {
		const app = await worker();
		const { response } = app.dispatch('fetch', { request: new Request('https://example.test' + path) });
		const result = await response;
		const text = await result.text();
		expect(text).not.toMatch(/[\u3400-\u9fff]/);
	});

	it('falls back to English for an unsupported explicit language ahead of lower-priority preferences', async () => {
		const app = await worker();
		const { response } = app.dispatch('fetch', {
			request: new Request('https://example.test/api/settings?lang=ja', {
				headers: { 'X-Language': 'unsupported', 'Accept-Language': 'zh-CN' },
			}),
		});
		expect(await (await response).json()).toMatchObject({ error: OFFLINE_MESSAGES.en.networkFailed });
	});
});

describe('independent offline operation preservation review', () => {
	it.each(SUPPORTED_LANGUAGES)('replays %s operations in their original language without translating request data', async (language) => {
		const app = await worker();
		const data = {
			name: '用户的 Chinese 名称',
			secret: 'JBSWY3DPEHPK3PXP',
			account: '服務名稱',
			details: { error: '网络连接失败', message: '授权成功' },
		};
		const { response } = app.dispatch('fetch', {
			request: new Request('https://example.test/api/secrets', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'X-Language': language },
				body: JSON.stringify(data),
			}),
		});
		expect((await response).status).toBe(202);
		expect(app.records[0].headers['X-Language']).toBe(language);
		expect(app.records[0].data).toEqual(data);
		app.self.navigator.language = 'en-US';
		app.fetch.mockResolvedValue({ ok: true, status: 200 });
		await app.api.syncPendingOperations();
		const [url, options] = app.fetch.mock.calls.at(-1);
		expect(url).toBe('/api/secrets');
		expect(options.headers['X-Language']).toBe(language);
		expect(JSON.parse(options.body)).toEqual(data);
		expect(options.credentials).toBe('include');
		expect(app.records).toHaveLength(0);
	});

	it.each(['zh-TW', 'en'])('localizes the %s storage-failure response and queue-control failure', async (language) => {
		const app = await worker();
		app.api.saveOperation = async () => {
			throw new Error('IndexedDB unavailable');
		};
		const { response } = app.dispatch('fetch', {
			request: new Request('https://example.test/api/secrets', { method: 'POST', headers: { 'X-Language': language }, body: '{}' }),
		});
		expect(await (await response).json()).toMatchObject({
			error: OFFLINE_MESSAGES[language].networkFailed,
			detail: OFFLINE_MESSAGES[language].queueFailed,
		});
		const postMessage = vi.fn();
		await app.dispatch('message', { data: { type: 'OFFLINE_QUEUE_CANCEL', language }, source: null, ports: [{ postMessage }] }).done;
		expect(postMessage).toHaveBeenCalledWith({ ok: false, error: OFFLINE_MESSAGES[language].queueUnavailable });
	});
});
