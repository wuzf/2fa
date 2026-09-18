import { createContext, runInContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMainPage } from '../../src/ui/page.js';
import { getSettingsCode } from '../../src/ui/scripts/settings.js';

const html = await (await createMainPage()).text();
const reply = (data, ok = true) => ({ ok, json: async () => data });

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function createHarness({ settings = { jwtExpiryDays: 30, maxBackups: 100, defaultExportFormat: 'json' }, fetchImpl } = {}) {
	const elements = new Map();
	for (const match of html.matchAll(/<(?:input|select|p)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
		const attributes = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
		elements.set(match[2], {
			attributes,
			value: attributes.value || '',
			textContent: '',
			className: attributes.class || '',
			style: {},
			setAttribute(name, value) {
				this.attributes[name] = value;
			},
		});
	}
	const fetch = vi.fn(async (url, options) => {
		if (fetchImpl) {
			return fetchImpl(url, options, settings);
		}
		if (options?.method === 'POST') {
			Object.assign(settings, JSON.parse(options.body));
			return reply({ success: true, settings: { ...settings } });
		}
		return reply({ ...settings });
	});
	const storage = new Map();
	const context = createContext({
		document: { getElementById: (id) => elements.get(id), querySelectorAll: () => [] },
		localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
		authenticatedFetch: fetch,
		getOTPAnimationMode: () => 'none',
		showCenterToast: vi.fn(),
		setTimeout,
		clearTimeout,
	});
	runInContext(getSettingsCode(), context);
	const event = (id, name) => runInContext(elements.get(id).attributes[name], context);
	return {
		api: context,
		settings,
		fetch,
		elements,
		input(id, value) {
			elements.get(id).value = String(value);
			event(id, 'oninput');
		},
		blur: (id) => event(id, 'onblur'),
		enter(id) {
			context.event = { key: 'Enter', preventDefault: vi.fn() };
			return event(id, 'onkeydown');
		},
		posts: () => fetch.mock.calls.filter(([, options]) => options?.method === 'POST').map(([, options]) => JSON.parse(options.body)),
	};
}

describe('numeric preference autosave', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('saves the completed input after a short pause without save buttons', async () => {
		const h = createHarness();
		await h.api.loadPreferences();
		expect(html).not.toMatch(/<button\b[^>]*onclick="save(?:JwtExpiryDays|MaxBackups)\(\)"/);
		h.input('settingsJwtExpiryDays', '4');
		await vi.advanceTimersByTimeAsync(250);
		h.input('settingsJwtExpiryDays', '45');
		await vi.advanceTimersByTimeAsync(499);
		expect(h.posts()).toEqual([]);
		await vi.advanceTimersByTimeAsync(1);
		expect(h.posts()).toEqual([{ jwtExpiryDays: 45 }]);
		expect(h.settings.jwtExpiryDays).toBe(45);
		expect(h.elements.get('settingsJwtExpiryResult').textContent).toBe('已保存，下次登录生效');
	});

	it('flushes on blur or Enter once and supports zero as unlimited backups', async () => {
		const h = createHarness();
		await h.api.loadPreferences();
		h.input('settingsJwtExpiryDays', '60');
		await h.blur('settingsJwtExpiryDays');
		h.input('settingsMaxBackups', '0');
		await h.enter('settingsMaxBackups');
		await vi.advanceTimersByTimeAsync(1000);
		expect(h.posts()).toEqual([{ jwtExpiryDays: 60 }, { maxBackups: 0 }]);
		expect(h.api.event.preventDefault).toHaveBeenCalledOnce();
		expect(h.elements.get('settingsMaxBackupsResult').textContent).toBe('已保存，备份不限数量');
	});

	it('does not save untouched defaults or repeat an already confirmed value', async () => {
		const h = createHarness();
		await h.blur('settingsJwtExpiryDays');
		await h.api.loadPreferences();
		h.input('settingsJwtExpiryDays', '30');
		await vi.advanceTimersByTimeAsync(500);
		await h.blur('settingsJwtExpiryDays');
		expect(h.posts()).toEqual([]);
	});

	it('rejects empty, fractional and out-of-range drafts and clears the error when corrected', async () => {
		const h = createHarness();
		await h.api.loadPreferences();
		for (const [id, value] of [
			['settingsJwtExpiryDays', ''],
			['settingsJwtExpiryDays', '1.5'],
			['settingsJwtExpiryDays', '366'],
			['settingsMaxBackups', '-1'],
			['settingsMaxBackups', '1001'],
			['settingsMaxBackups', 'invalid'],
		]) {
			h.input(id, value);
			await vi.advanceTimersByTimeAsync(500);
			expect(h.elements.get(id).attributes['aria-invalid']).toBe('true');
		}
		expect(h.posts()).toEqual([]);
		h.input('settingsMaxBackups', '150');
		await vi.advanceTimersByTimeAsync(500);
		expect(h.posts()).toEqual([{ maxBackups: 150 }]);
		expect(h.elements.get('settingsMaxBackups').attributes['aria-invalid']).toBe('false');
		expect(h.elements.get('settingsMaxBackupsResult').className).toContain('success');
	});

	it('ignores a preference load that started before the user edited a value', async () => {
		const load = deferred();
		const h = createHarness({
			fetchImpl: (_url, options) => (options?.method === 'POST' ? reply({ success: true }) : load.promise),
		});
		const loading = h.api.loadPreferences();
		h.input('settingsJwtExpiryDays', '90');
		await vi.advanceTimersByTimeAsync(500);
		load.resolve(reply({ jwtExpiryDays: 30, maxBackups: 100 }));
		await loading;
		expect(h.elements.get('settingsJwtExpiryDays').value).toBe('90');
		expect(h.elements.get('settingsMaxBackups').value).toBe('100');
	});

	it('coalesces edits during an active save and ignores a load started while saving', async () => {
		const pending = [];
		const load = deferred();
		const h = createHarness({
			fetchImpl: (_url, options) => {
				if (options?.method !== 'POST') {
					return load.promise;
				}
				const save = deferred();
				pending.push(save);
				return save.promise;
			},
		});
		h.input('settingsJwtExpiryDays', '45');
		await vi.advanceTimersByTimeAsync(500);
		const loading = h.api.loadPreferences();
		h.input('settingsJwtExpiryDays', '46');
		await vi.advanceTimersByTimeAsync(500);
		h.input('settingsJwtExpiryDays', '47');
		await vi.advanceTimersByTimeAsync(500);
		expect(h.posts()).toEqual([{ jwtExpiryDays: 45 }]);
		pending[0].resolve(reply({ success: true }));
		await vi.advanceTimersByTimeAsync(0);
		expect(h.posts()).toEqual([{ jwtExpiryDays: 45 }, { jwtExpiryDays: 47 }]);
		expect(h.elements.get('settingsJwtExpiryDays').value).toBe('47');
		expect(h.elements.get('settingsJwtExpiryResult').textContent).toBe('保存中…');
		pending[1].resolve(reply({ success: true }));
		await vi.advanceTimersByTimeAsync(0);
		load.resolve(reply({ jwtExpiryDays: 30, maxBackups: 100 }));
		await loading;
		expect(h.elements.get('settingsJwtExpiryDays').value).toBe('47');
		expect(h.elements.get('settingsJwtExpiryResult').className).toContain('success');
	});

	it('serializes both numeric controls and export-format writes without losing another field', async () => {
		const pending = [];
		const h = createHarness({
			fetchImpl: (_url, options, settings) => {
				const snapshot = { ...settings };
				const changes = JSON.parse(options.body);
				return new Promise((resolve) =>
					pending.push(() => {
						Object.assign(settings, snapshot, changes);
						resolve(reply({ success: true, settings: { ...settings } }));
					}),
				);
			},
		});
		h.input('settingsJwtExpiryDays', '60');
		const days = h.blur('settingsJwtExpiryDays');
		h.input('settingsMaxBackups', '7');
		const backups = h.blur('settingsMaxBackups');
		h.elements.get('settingsDefaultExportFormat').value = 'csv';
		const format = h.api.saveDefaultExportFormat();
		await vi.advanceTimersByTimeAsync(0);
		expect(h.posts()).toHaveLength(1);
		pending[0]();
		await vi.advanceTimersByTimeAsync(0);
		expect(h.posts()).toHaveLength(2);
		pending[1]();
		await vi.advanceTimersByTimeAsync(0);
		expect(h.posts()).toHaveLength(3);
		pending[2]();
		await Promise.all([days, backups, format]);
		expect(h.settings).toEqual({ jwtExpiryDays: 60, maxBackups: 7, defaultExportFormat: 'csv' });
	});

	it.each(['network', 'server'])('reports a %s failure and lets blur retry the unsaved value', async (failure) => {
		let fail = true;
		const h = createHarness({
			fetchImpl: (_url, options, settings) => {
				if (fail) {
					if (failure === 'network') {
						throw new Error('Connection lost');
					}
					return reply({ success: false, message: '暂时无法保存' }, false);
				}
				Object.assign(settings, JSON.parse(options.body));
				return reply({ success: true, settings });
			},
		});
		h.input('settingsMaxBackups', '80');
		await vi.advanceTimersByTimeAsync(500);
		expect(h.elements.get('settingsMaxBackupsResult').className).toContain('error');
		expect(h.elements.get('settingsMaxBackupsResult').textContent).toContain(failure === 'network' ? '未保存' : '暂时无法保存');
		fail = false;
		await h.blur('settingsMaxBackups');
		expect(h.settings.maxBackups).toBe(80);
		expect(h.posts()).toHaveLength(2);
		expect(h.elements.get('settingsMaxBackupsResult').className).toContain('success');
	});

	it('resends the original value if an intervening save lost its response', async () => {
		const lost = deferred();
		let first = true;
		const h = createHarness({
			fetchImpl: (_url, options, settings) => {
				if (!options) {
					return reply({ ...settings });
				}
				Object.assign(settings, JSON.parse(options.body));
				if (first) {
					first = false;
					return lost.promise;
				}
				return reply({ success: true, settings });
			},
		});
		await h.api.loadPreferences();
		h.input('settingsJwtExpiryDays', '45');
		await vi.advanceTimersByTimeAsync(500);
		h.input('settingsJwtExpiryDays', '30');
		await vi.advanceTimersByTimeAsync(500);
		lost.reject(new Error('Response lost after server saved'));
		await vi.advanceTimersByTimeAsync(0);
		expect(h.posts()).toEqual([{ jwtExpiryDays: 45 }, { jwtExpiryDays: 30 }]);
		expect(h.settings.jwtExpiryDays).toBe(30);
	});

	it('restores automatically saved values in a fresh page session', async () => {
		const h = createHarness();
		h.input('settingsJwtExpiryDays', '120');
		h.input('settingsMaxBackups', '0');
		await vi.advanceTimersByTimeAsync(500);
		const reloaded = createHarness({ settings: h.settings });
		await reloaded.api.loadPreferences();
		expect(reloaded.elements.get('settingsJwtExpiryDays').value).toBe('120');
		expect(reloaded.elements.get('settingsMaxBackups').value).toBe('0');
		expect(reloaded.posts()).toEqual([]);
	});
});
