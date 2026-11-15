import { describe, it, expect, vi } from 'vitest';
import { Window } from 'happy-dom';
import { createAccountViewState } from '../../src/ui/runtime/accountViewState.js';
import { createThemeSdk } from '../../src/ui/runtime/themeSdk.js';
import { createHostFlows } from '../../src/ui/runtime/hostFlows.js';
import { createBrowserClipboardPort } from '../../src/ui/scripts/browserClipboard.js';
import { LOCALES } from '../../src/ui/locales/index.js';

function fixture(options = {}) {
	let clockNow = 59000;
	let records = [{ id: 'a', name: 'Google', account: 'a@example.test', secret: 'PRIVATE-SEED', digits: 6 }];
	let session = 1;
	let blocked = false;
	const subscribers = new Set();
	const accounts = {
		getRecords: () => records,
		getRecord: (id) => records.find((record) => record.id === id),
		getState: () => ({
			revision: 1,
			source: 'server',
			accessVerified: !blocked,
			blocked,
			hidden: { count: 1, records: [{ id: 'h', name: 'Hidden', reason: 'type', secret: 'HIDDEN-SEED' }] },
		}),
		getSessionGeneration: () => session,
		getAccountGeneration: () => 1,
		getOperationState: () => ({
			busy: false,
			operations: [{ accountId: 'a', operationId: 'op', status: 'running', body: 'PRIVATE-BODY' }],
		}),
		subscribe: (listener) => {
			subscribers.add(listener);
			return () => subscribers.delete(listener);
		},
	};
	const committed = {
		accountId: 'a',
		kind: 'TOTP',
		current: '012345',
		next: '067890',
		revision: 7,
		window: 2,
		period: 30,
		accountGeneration: 1,
		sessionGeneration: 1,
	};
	const otp = {
		readCommitted: () => committed,
		readCopyTarget: (accountId, slot) => ({ status: 'ready', target: { accountId, slot, value: committed[slot], revision: 7 } }),
	};
	const view = createAccountViewState({ filterAccountsByQuery: (items, query) => items.filter((item) => item.account.includes(query)) });
	const commands = {
		copy: vi.fn(() => Promise.resolve({ status: 'copied', secret: 'NO' })),
		refresh: vi.fn(() => ({ status: 'committed' })),
		copyURI: vi.fn(() => ({ status: 'copied' })),
		copyShareLink: vi.fn(() => ({ status: 'copied' })),
	};
	const environment = {
		getClockNow: () => clockNow,
		getSnapshot: () => ({
			queue: { operations: [{ id: 'x', type: 'ADD', name: 'Account', body: { secret: 'QUEUE-SEED' } }] },
			preferences: { language: 'en', authToken: 'TOKEN' },
			host: options.host,
		}),
	};
	const runtime = createThemeSdk({ identity: { hostBuild: 'test' }, accounts, otp, commands, view, environment });
	return {
		...runtime,
		accounts,
		commands,
		view,
		subscribers,
		setClockNow: (value) => {
			clockNow = value;
		},
		invalidate() {
			session += 1;
			blocked = true;
			records = [];
			subscribers.forEach((listener) => listener());
		},
	};
}

describe('theme SDK safe data and command contract', () => {
	it('reads the current trusted clock without reanchoring an old snapshot and invalidates it on disposal', () => {
		const runtime = fixture();
		const snapshot = runtime.sdk.getSnapshot();
		expect(runtime.sdk.clock.now()).toBe(59000);
		runtime.setClockNow(61000);
		expect(runtime.sdk.getSnapshot()).toBe(snapshot);
		expect(runtime.sdk.clock.now()).toBe(61000);
		runtime.dispose();
		expect(runtime.sdk.clock.now()).toBeNull();
	});
	it('delivers each revision once and in order when a subscriber submits another view change', () => {
		const h = fixture();
		const received = [];
		h.sdk.subscribe((snapshot) => {
			if (snapshot.library.view.query === 'first') {
				h.sdk.view.setQuery('second');
			}
		});
		h.sdk.subscribe((snapshot) => received.push([snapshot.revision, snapshot.library.view.query]));
		h.sdk.view.setQuery('first');
		expect(received).toEqual([
			[0, ''],
			[1, 'first'],
			[2, 'second'],
		]);
	});

	it('projects the current HOTP operation instead of an older settled entry or a queued edit', () => {
		const h = fixture();
		h.accounts.getOperationState = () => ({
			busy: true,
			operations: [
				{ operationId: 'old', accountId: 'a', type: 'hotp', status: 'settled', clipboard: 'copied' },
				{ operationId: 'current', accountId: 'a', type: 'hotp', status: 'running', clipboard: 'pending', reservation: 'confirmed' },
				{ operationId: 'edit', accountId: 'a', type: 'edit', status: 'queued' },
			],
		});
		h.publish();
		expect(h.sdk.getSnapshot().library.accounts[0].otp.operation).toMatchObject({
			operationId: 'current',
			clipboard: 'pending',
			reservation: 'confirmed',
		});
	});

	it('projects immutable values without private records, queue bodies or credentials, with no account DOM', () => {
		const { sdk } = fixture();
		const snapshot = sdk.getSnapshot();
		expect(snapshot.library.accounts[0].otp.current.value).toBe('012345');
		expect(snapshot.library.accounts[0].otp.next.value).toBe('067890');
		expect(Object.isFrozen(snapshot.library.accounts[0].ref)).toBe(true);
		expect(() => {
			snapshot.library.accounts[0].accountLabel = 'changed';
		}).toThrow();
		expect(JSON.stringify(snapshot)).not.toMatch(/PRIVATE|SEED|TOKEN|authToken|"body"/);
		expect(sdk.identity.sdkApiVersion).toBe(1);
	});
	it('binds targets to this SDK instance and starts the command in the click stack', async () => {
		const { sdk, commands } = fixture();
		const target = sdk.otp.readCopyTarget('a', 'next').target;
		const result = sdk.otp.copy(target);
		expect(commands.copy).toHaveBeenCalledTimes(1);
		expect(commands.copy.mock.calls[0][0].value).toBe('067890');
		expect(await result).toEqual({ status: 'copied' });
		expect(await sdk.otp.copy({ ...target })).toMatchObject({ reason: 'invalid-target' });
		expect(await fixture().sdk.otp.copy(target)).toMatchObject({ reason: 'invalid-target' });
	});
	it('notifies immediately, clears on session invalidation, and revokes subscriptions and commands on dispose', async () => {
		const runtime = fixture();
		const listener = vi.fn();
		const unsubscribe = runtime.sdk.subscribe(listener);
		expect(listener).toHaveBeenCalledTimes(1);
		runtime.sdk.view.setQuery('missing');
		expect(listener.mock.lastCall[0].library.view.found).toBe(0);
		runtime.invalidate();
		expect(listener.mock.lastCall[0].library.accounts).toEqual([]);
		expect(listener.mock.lastCall[0].queue.operations).toEqual([]);
		unsubscribe();
		const count = listener.mock.calls.length;
		runtime.sdk.view.setQuery('other');
		expect(listener).toHaveBeenCalledTimes(count);
		runtime.dispose();
		expect(runtime.subscribers.size).toBe(0);
		expect(await runtime.sdk.accounts.refresh()).toMatchObject({ reason: 'mount-invalidated' });
	});
	it('rejects an outdated account reference before URI or share generation', async () => {
		const { sdk, commands } = fixture();
		expect(await sdk.accounts.copyURI({ id: 'a', generation: 0 })).toMatchObject({ reason: 'account-changed' });
		expect(commands.copyURI).not.toHaveBeenCalled();
		expect(await sdk.accounts.copyShareLink(sdk.getSnapshot().library.accounts[0].ref)).toEqual({ status: 'copied' });
	});
});

describe('host about data', () => {
	it('passes the version, release and https project links to themes', () => {
		const runtime = fixture({
			host: {
				about: {
					version: '1.13.0',
					latestVersion: '1.14.0',
					upToDate: false,
					author: 'wuzf',
					license: 'MIT',
					links: { documentation: 'https://example.test/docs', source: 'javascript:alert(1)', secret: 'https://example.test/x' },
				},
			},
		});
		const { about } = runtime.sdk.getSnapshot().host;
		expect(about).toEqual({
			version: '1.13.0',
			latestVersion: '1.14.0',
			upToDate: false,
			author: 'wuzf',
			license: 'MIT',
			links: { documentation: 'https://example.test/docs' },
		});
		expect(Object.isFrozen(about.links)).toBe(true);
	});

	it('is null when the host has no about data', () => {
		expect(fixture().sdk.getSnapshot().host.about).toBeNull();
		expect(fixture({ host: { about: { latestVersion: '2.0.0' } } }).sdk.getSnapshot().host.about).toBeNull();
	});

	it('lists the settings in the settings dialog order, About after the theme settings, and signing out last', () => {
		const ids = createHostFlows()
			.listActions()
			.map((action) => action.actionId);
		const settings = ids.filter((id) => id.startsWith('settings:') || id === 'appearance');
		expect(settings).toEqual([
			'settings:security',
			'settings:sync',
			'settings:preferences',
			'settings:custom-code',
			'appearance',
			'settings:about',
		]);
		expect(ids.indexOf('settings:about')).toBe(ids.indexOf('appearance') + 1);
		expect(ids.slice(-2)).toEqual(['login', 'logout']);
		expect(ids.indexOf('extension')).toBeLessThan(ids.indexOf('logout'));
		expect(ids.indexOf('pwa-install')).toBeLessThan(ids.indexOf('logout'));
	});

	it('opens the about section of the settings', async () => {
		const settings = vi.fn(() => ({ status: 'completed' }));
		const host = createHostFlows({ handlers: { settings } });
		expect(await host.open({ kind: 'settings', section: 'about' }).closed).toEqual({ status: 'completed' });
		expect(settings.mock.calls[0][0]).toEqual({ kind: 'settings', section: 'about' });
	});
});

describe('typed host flows', () => {
	it('uses a translated label for every declared action in every supported language', () => {
		for (const action of createHostFlows().listActions()) {
			for (const language of Object.values(LOCALES)) {
				expect(language[action.labelKey], action.actionId).toBeTruthy();
			}
		}
	});
	it('accepts only the expected verified login/logout transition and rejects later sessions', async () => {
		let session = 1;
		let state = { blocked: true, accessVerified: false };
		const host = createHostFlows({
			getSessionGeneration: () => session,
			getSessionState: () => state,
			handlers: {
				login: () => {
					session += 1;
					state = { blocked: false, accessVerified: true };
					return { status: 'closed' };
				},
				logout: () => {
					session += 1;
					state = { blocked: true, accessVerified: false };
					return { status: 'unknown', reason: 'logout-local-only' };
				},
			},
		});
		expect(await host.open({ kind: 'login' }).closed).toEqual({ status: 'completed', reason: 'authenticated' });
		expect(await host.open({ kind: 'logout' }).closed).toEqual({ status: 'unknown', reason: 'logout-local-only' });
		const late = host.open({ kind: 'login' });
		session += 1;
		expect(await late.closed).toMatchObject({ reason: 'session-invalidated' });
	});

	it('maps all 47 features and dispatches each declared action to its actual port', async () => {
		const pending = createHostFlows();
		expect(Object.keys(pending.featureContracts)).toHaveLength(47);
		const handlers = Object.fromEntries(
			pending.listActions().map((action) => [action.request.kind, vi.fn(() => ({ status: 'completed' }))]),
		);
		const host = createHostFlows({ handlers, validateAccount: (ref) => ref.generation === 1 });
		for (const action of host.listActions()) {
			const request = {
				...action.request,
				...(action.requires === 'account'
					? { account: { id: 'a', generation: 1 } }
					: action.requires === 'operationId'
						? { operationId: 'op' }
						: {}),
			};
			expect(action.enabled).toBe(true);
			expect(await host.open(request).closed).toEqual({ status: 'completed' });
			expect(handlers[request.kind]).toHaveBeenCalledWith(request, expect.any(Object));
		}
	});
	it('rejects unknown fields and stale refs; an absent or void handler never claims success', async () => {
		const handler = vi.fn();
		const host = createHostFlows({ handlers: { 'account-edit': handler, tools: handler }, validateAccount: () => false });
		expect(host.open({ kind: 'tools', url: '/api/secrets' }).reason).toBe('invalid-request');
		expect(host.open({ kind: 'account-edit', account: { id: 'a', generation: 0 } }).reason).toBe('account-changed');
		expect(handler).not.toHaveBeenCalled();
		expect(host.open({ kind: 'import' }).reason).toBe('unavailable');
		expect(await host.open({ kind: 'tools' }).closed).toMatchObject({ reason: 'invalid-flow-result' });
	});
	it('reports only dialog closure and restores focus after closure, suppressing old-session feedback', async () => {
		let close;
		let session = 1;
		const restoreFocus = vi.fn();
		const host = createHostFlows({
			handlers: {
				settings: () => ({
					closed: new Promise((resolve) => {
						close = resolve;
					}),
				}),
			},
			getSessionGeneration: () => session,
			restoreFocus,
		});
		const handle = host.open({ kind: 'settings' }, { returnFocus: 'button' });
		expect(restoreFocus).not.toHaveBeenCalled();
		close({ status: 'closed', secret: 'not projected' });
		expect(await handle.closed).toEqual({ status: 'closed' });
		expect(restoreFocus).toHaveBeenCalledWith('button');
		const stale = host.open({ kind: 'settings' });
		session += 1;
		close({ status: 'committed' });
		expect(await stale.closed).toMatchObject({ reason: 'session-invalidated' });
	});
});

describe('single clipboard browser port', () => {
	it('calls native synchronously and preserves pending without running fallback', async () => {
		let resolve;
		const writeText = vi.fn(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		const window = new Window();
		window.document.execCommand = vi.fn(() => true);
		const port = createBrowserClipboardPort({ navigator: { clipboard: { writeText } }, document: window.document });
		const operation = port.writeText('001234');
		expect(writeText).toHaveBeenCalledWith('001234');
		await Promise.resolve();
		expect(window.document.execCommand).not.toHaveBeenCalled();
		resolve();
		expect(await operation).toBe(true);
	});
	it('requires actual fallback success and restores focused elements without leaving copied text in DOM', async () => {
		const window = new Window();
		const { document } = window;
		document.body.innerHTML = '<button id="trigger">copy</button>';
		const trigger = document.getElementById('trigger');
		trigger.focus();
		document.execCommand = vi.fn(() => true);
		const port = createBrowserClipboardPort({
			navigator: { clipboard: { writeText: () => Promise.reject(new Error('denied')) } },
			document,
		});
		expect(await port.writeText('001234')).toBe(true);
		expect(document.activeElement).toBe(trigger);
		expect(document.querySelector('textarea')).toBeNull();
		document.execCommand.mockReturnValue(false);
		await expect(port.writeText('001234')).rejects.toThrow('denied');
	});
	it('does not fall back after the session changes while native permission is pending', async () => {
		let reject;
		let current = true;
		const window = new Window();
		window.document.execCommand = vi.fn(() => true);
		const port = createBrowserClipboardPort({
			navigator: {
				clipboard: {
					writeText: () =>
						new Promise((_, fail) => {
							reject = fail;
						}),
				},
			},
			document: window.document,
			isCurrent: () => current,
		});
		const promise = port.writeText('123456');
		current = false;
		reject(new Error('denied'));
		await expect(promise).rejects.toThrow('denied');
		expect(window.document.execCommand).not.toHaveBeenCalled();
	});
});
