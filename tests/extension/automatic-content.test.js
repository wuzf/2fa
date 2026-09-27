// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutomaticController } from '../../extension/src/content/automatic.js';
import { createContentController } from '../../extension/src/content/index.js';
import { autofillPathFromUrl } from '../../extension/src/shared/origin.js';
import { MESSAGE } from '../../extension/src/shared/protocol.js';

const NONCE = '0123456789abcdef0123456789abcdef0123';
const ACCOUNT = { id: 'one', name: 'GitHub', account: 'alice', type: 'TOTP', digits: 6 };
const SOURCE = 'https://2fa.example';
const SECOND_ACCOUNT = { ...ACCOUNT, id: 'two', account: 'bob' };
let responseNonce = 1000;
let controllers = [];
const AUTOMATIC_MARKER = '__twoFaAutomaticContentController__';
const MANUAL_MARKER = '__twoFaTargetContentListener__';

function accountResult(
	accounts,
	revision = 'revision-one',
	automaticId = accounts.length === 1 ? accounts[0].id : null,
	clockRevision = null,
) {
	return {
		ok: true,
		data: {
			nonce: (++responseNonce).toString(16).padStart(36, '0'),
			accounts,
			autoFillAccountId: automaticId,
			instanceOrigin: SOURCE,
			revision,
			clockRevision,
		},
	};
}

function input(attributes = {}, parent = document.body) {
	const element = parent.ownerDocument.createElement('input');
	element.setAttribute('autocomplete', 'one-time-code');
	for (const [name, value] of Object.entries(attributes)) {
		element.setAttribute(name, value);
	}
	Object.defineProperty(element, 'getClientRects', { value: () => [{ left: 20, top: 20, bottom: 40, width: 200, height: 20 }] });
	parent.append(element);
	return element;
}

function segmentedInputs(digits) {
	const group = document.createElement('div');
	group.setAttribute('role', 'group');
	group.setAttribute('aria-label', 'Authenticator code');
	document.body.append(group);
	return Array.from({ length: digits }, (_, index) => input({ maxlength: '1', 'aria-label': `Digit ${index + 1} of ${digits}` }, group));
}

function clippedInput() {
	const container = document.createElement('div');
	container.style.overflowY = 'auto';
	let height = 100;
	Object.defineProperties(container, {
		clientWidth: { get: () => 320 },
		clientHeight: { get: () => height },
		getBoundingClientRect: {
			value: () => ({ left: 0, top: 0, right: 320, bottom: height, width: 320, height }),
		},
	});
	const field = document.createElement('input');
	field.autocomplete = 'one-time-code';
	Object.defineProperty(field, 'getClientRects', {
		value: () => {
			const top = 300 - container.scrollTop;
			return [{ left: 20, top, bottom: top + 20, width: 200, height: 20 }];
		},
	});
	container.append(field);
	document.body.append(container);
	return { container, field, resize: (nextHeight) => (height = nextHeight) };
}

function trusted(target, type, attributes = {}) {
	const event = new window.Event(type, { bubbles: true, composed: true, cancelable: true });
	Object.defineProperty(event, 'isTrusted', { value: true });
	for (const [name, value] of Object.entries(attributes)) {
		Object.defineProperty(event, name, { value });
	}
	target.dispatchEvent(event);
}

function capturePicker(onCreated) {
	const original = window.HTMLElement.prototype.attachShadow;
	let root;
	vi.spyOn(window.HTMLElement.prototype, 'attachShadow').mockImplementation(function (options) {
		const created = original.call(this, options);
		if (options.mode === 'closed') {
			root = created;
			onCreated?.(created);
		}
		return created;
	});
	return () => root;
}

function fixture({ enabled = true, accounts = [ACCOUNT], automaticId = ACCOUNT.id, discover, select, status } = {}) {
	let listener;
	let nonceCounter = 0;
	const runtime = {
		id: 'extension-test',
		onMessage: {
			addListener: vi.fn((fn) => {
				listener = fn;
			}),
			removeListener: vi.fn(),
		},
		sendMessage: vi.fn(async (message) => {
			if (message.type === MESSAGE.AUTO_STATUS) {
				return status ? status(message) : { ok: true, data: { enabled } };
			}
			if (message.type === MESSAGE.AUTO_DISCOVER) {
				return discover
					? discover(message)
					: {
							ok: true,
							data: {
								nonce: (++nonceCounter).toString(16).padStart(36, '0'),
								accounts,
								autoFillAccountId: automaticId,
								instanceOrigin: SOURCE,
								revision: 'revision-one',
								clockRevision: null,
							},
						};
			}
			if (message.type === MESSAGE.AUTO_SELECT) {
				if (select) {
					return select(message);
				}
				const common = {
					episodeNonce: message.episodeNonce,
					expectedOrigin: document.location.origin,
					expectedTargetPath: autofillPathFromUrl(document.location.href),
					nonce: message.nonce,
				};
				const prepared = await controller.handle({ ...common, type: MESSAGE.AUTO_PREPARE, expectedDigits: 6 });
				if (!prepared.ok) {
					return prepared;
				}
				const filled = await controller.handle({ ...common, type: MESSAGE.AUTO_FILL, code: '123456', expiresAt: Date.now() + 30000 });
				return filled.ok ? { ok: true, data: { status: filled.status } } : filled;
			}
			return { ok: false };
		}),
	};
	const controller = createAutomaticController({ runtime });
	controllers.push(controller);
	return {
		controller,
		runtime,
		listen: (...args) => listener(...args),
		notify(revision, instanceOrigin = SOURCE, clockRevision = null) {
			const respond = vi.fn();
			listener({ type: MESSAGE.ACCOUNTS_CHANGED, instanceOrigin, revision, clockRevision }, { id: runtime.id }, respond);
			return respond;
		},
		messages: (type) => runtime.sendMessage.mock.calls.map(([message]) => message).filter((message) => message.type === type),
		async start() {
			await controller.refresh();
			await vi.advanceTimersByTimeAsync(150);
		},
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	document.body.replaceChildren();
	window.history.replaceState(null, '', '/login');
	Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

afterEach(() => {
	for (const controller of controllers) {
		controller.dispose();
	}
	controllers = [];
	globalThis[AUTOMATIC_MARKER]?.dispose();
	globalThis[MANUAL_MARKER]?.dispose?.();
	delete globalThis[AUTOMATIC_MARKER];
	delete globalThis[MANUAL_MARKER];
	document.querySelectorAll('[data-twofa-autofill]').forEach((element) => element.remove());
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe('authorized automatic content runner', () => {
	const lockKinds = ['disabled', 'readOnly', 'fieldset.disabled', 'aria-disabled'];
	function prepareLock(fields, lock) {
		if (lock === 'fieldset.disabled') {
			const container = document.createElement('fieldset');
			const root = fields.length === 1 ? fields[0] : fields[0].parentElement;
			root.before(container);
			container.append(root);
			return () => (container.disabled = true);
		}
		return () => fields.forEach((field) => (lock === 'aria-disabled' ? field.setAttribute(lock, 'true') : (field[lock] = true)));
	}
	it.each(['single', 'segmented'].flatMap((kind) => ['input', 'change'].flatMap((event) => lockKinds.map((lock) => [kind, event, lock]))))(
		'reports automatic %s filling as successful when its final %s event makes the fields %s',
		async (kind, event, lock) => {
			const fields = kind === 'single' ? [input()] : segmentedInputs(6);
			fields.at(-1).addEventListener(event, prepareLock(fields, lock));
			const app = fixture();
			const handle = vi.spyOn(app.controller, 'handle');
			await app.start();
			const fillIndex = handle.mock.calls.findIndex(([message]) => message.type === MESSAGE.AUTO_FILL);
			expect(fillIndex).toBeGreaterThanOrEqual(0);
			await expect(handle.mock.results[fillIndex].value).resolves.toEqual({ ok: true, status: 'filled', kind, digits: 6 });
			expect(fields.map((field) => field.value).join('')).toBe('123456');
			await vi.advanceTimersByTimeAsync(1000);
			expect(app.messages(MESSAGE.AUTO_SELECT)).toHaveLength(1);
		},
	);

	it.each(lockKinds.flatMap((lock) => ['purpose', 'competing input', 'route'].map((change) => [lock, change])))(
		'rejects a final automatic %s lock when the page also changes its %s',
		async (lock, change) => {
			const field = input();
			const applyLock = prepareLock([field], lock);
			field.addEventListener('input', () => {
				applyLock();
				if (change === 'purpose') {
					field.autocomplete = 'cc-csc';
				} else if (change === 'competing input') {
					input();
				} else {
					window.history.replaceState(null, '', '/other-login');
				}
			});
			const app = fixture();
			const handle = vi.spyOn(app.controller, 'handle');
			await app.start();
			const fillIndex = handle.mock.calls.findIndex(([message]) => message.type === MESSAGE.AUTO_FILL);
			expect(fillIndex).toBeGreaterThanOrEqual(0);
			await expect(handle.mock.results[fillIndex].value).resolves.toMatchObject({
				ok: false,
				error: { code: 'TARGET_UNAVAILABLE' },
			});
			await vi.advanceTimersByTimeAsync(1000);
			expect(app.messages(MESSAGE.AUTO_SELECT)).toHaveLength(1);
		},
	);

	describe('pages that withdraw and remount rejected verification fields', () => {
		// The page takes the fields away once it receives a complete code, then its
		// server rejects the code and it mounts fresh, empty fields every 300 ms.
		const withdrawals = {
			removed: (root) => root.remove(),
			hidden: (root) => (root.hidden = true),
			replaced: (root) => root.replaceWith(document.createElement('div')),
			'rewritten while visible': (root) => {
				for (const field of root.tagName === 'INPUT' ? [root] : root.querySelectorAll('input')) {
					field.value = '';
				}
			},
		};
		function rejectingPage(kind, event, withdrawal) {
			const submissions = [];
			let current;
			const mount = () => {
				const fields = kind === 'single' ? [input()] : segmentedInputs(6);
				const root = kind === 'single' ? fields[0] : fields[0].parentElement;
				fields.at(-1).addEventListener(event, () => {
					submissions.push(fields.map((field) => field.value).join(''));
					withdrawals[withdrawal](root);
					setTimeout(() => {
						root.remove();
						mount();
					}, 300);
				});
				current = fields;
			};
			mount();
			return { submissions, fields: () => current };
		}
		const cases = ['single', 'segmented'].flatMap((kind) =>
			['input', 'change'].flatMap((event) => Object.keys(withdrawals).map((withdrawal) => [kind, event, withdrawal])),
		);

		it.each(cases)('submits one automatic %s code when the %s handler leaves the fields %s', async (kind, event, withdrawal) => {
			const page = rejectingPage(kind, event, withdrawal);
			const app = fixture();
			const handle = vi.spyOn(app.controller, 'handle');
			await app.start();
			const fillIndex = handle.mock.calls.findIndex(([message]) => message.type === MESSAGE.AUTO_FILL);
			expect(fillIndex).toBeGreaterThanOrEqual(0);
			if (withdrawal === 'rewritten while visible') {
				await expect(handle.mock.results[fillIndex].value).resolves.toMatchObject({ ok: false });
			} else {
				await expect(handle.mock.results[fillIndex].value).resolves.toEqual({ ok: true, status: 'filled', kind, digits: 6 });
			}
			await vi.advanceTimersByTimeAsync(120000);
			expect(page.submissions).toEqual(['123456']);
			expect(app.messages(MESSAGE.AUTO_SELECT)).toHaveLength(1);
			expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(1);
			expect(
				page
					.fields()
					.map((field) => field.value)
					.join(''),
			).toBe('');
		});

		it('still allows a manual fill into the remounted field', async () => {
			const page = rejectingPage('single', 'input', 'removed');
			const app = fixture();
			await app.start();
			await vi.advanceTimersByTimeAsync(1000);
			expect(page.submissions).toEqual(['123456']);
			const manual = createContentController({ doc: document, detectionTimeoutMs: 0, getExplicitFocusedInput: () => null });
			try {
				expect(await manual.handle({ type: MESSAGE.PREPARE_TARGET, nonce: NONCE, expectedDigits: 6 })).toMatchObject({
					ok: true,
					status: 'ready',
				});
				expect(await manual.handle({ type: MESSAGE.FILL_CODE, nonce: NONCE, code: '654321', expiresAt: Date.now() + 30000 })).toEqual({
					ok: true,
					status: 'filled',
					kind: 'single',
					digits: 6,
				});
			} finally {
				manual.dispose();
			}
			expect(page.submissions).toEqual(['123456', '654321']);
			await vi.advanceTimersByTimeAsync(10000);
			expect(page.submissions).toEqual(['123456', '654321']);
			expect(app.messages(MESSAGE.AUTO_SELECT)).toHaveLength(1);
		});

		it('allows one automatic code again after the route changes', async () => {
			const page = rejectingPage('single', 'input', 'removed');
			const app = fixture();
			await app.start();
			await vi.advanceTimersByTimeAsync(1000);
			expect(page.submissions).toEqual(['123456']);
			window.history.pushState(null, '', '/login/next-step');
			await vi.advanceTimersByTimeAsync(10000);
			expect(page.submissions).toEqual(['123456', '123456']);
			expect(app.messages(MESSAGE.AUTO_SELECT)).toHaveLength(2);
		});

		// The page shows another route while verifying, then returns to the
		// challenge with fresh fields when the server rejects the code.
		function routingPage(returnBy) {
			const submissions = [];
			const mount = () => {
				const field = input();
				field.addEventListener('input', () => {
					submissions.push(field.value);
					field.remove();
					window.history.pushState(null, '', '/login/verifying');
					setTimeout(() => {
						if (returnBy === 'pushState') {
							window.history.pushState(null, '', '/login');
						} else {
							window.history.replaceState(null, '', '/login');
							window.dispatchEvent(new window.PopStateEvent('popstate'));
						}
						mount();
					}, 800);
				});
			};
			mount();
			return submissions;
		}

		it.each(['pushState', 'popstate'])('does not refill after the page leaves the path and returns (%s)', async (returnBy) => {
			const submissions = routingPage(returnBy);
			const app = fixture();
			await app.start();
			await vi.advanceTimersByTimeAsync(120000);
			expect(submissions).toEqual(['123456']);
			expect(app.messages(MESSAGE.AUTO_SELECT)).toHaveLength(1);
			expect(document.querySelector('input').value).toBe('');
			expect(window.location.pathname).toBe('/login');
		});

		it('allows one automatic code again in a new document', async () => {
			const submissions = routingPage('pushState');
			const first = fixture();
			await first.start();
			await vi.advanceTimersByTimeAsync(5000);
			expect(submissions).toEqual(['123456']);
			first.controller.dispose();
			const reloaded = fixture();
			await reloaded.start();
			await vi.advanceTimersByTimeAsync(5000);
			expect(submissions).toEqual(['123456', '123456']);
			expect(reloaded.messages(MESSAGE.AUTO_SELECT)).toHaveLength(1);
		});
	});

	it('waits for a native modal to close before filling its inert background', async () => {
		const background = input();
		const dialog = document.createElement('dialog');
		document.body.append(dialog);
		dialog.showModal();
		const matches = dialog.matches.bind(dialog);
		vi.spyOn(dialog, 'matches').mockImplementation((selector) => (selector === ':modal' ? dialog.open : matches(selector)));
		const app = fixture();
		await app.start();
		expect(background.value).toBe('');
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(0);
		dialog.close();
		await vi.advanceTimersByTimeAsync(200);
		expect(background.value).toBe('123456');
	});

	it('automatically fills only the OTP inside the active modal', async () => {
		const background = input();
		const dialog = document.createElement('dialog');
		document.body.append(dialog);
		const target = input({}, dialog);
		dialog.showModal();
		const matches = dialog.matches.bind(dialog);
		vi.spyOn(dialog, 'matches').mockImplementation((selector) => (selector === ':modal' ? dialog.open : matches(selector)));
		const app = fixture();
		await app.start();
		expect(target.value).toBe('123456');
		expect(background.value).toBe('');
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(1);
	});

	it.each([
		[0, false],
		[0, true],
		[50, false],
		[50, true],
	])('rediscovers after a modal reopens in %i ms (pending selection: %s)', async (reopenDelay, pendingSelection) => {
		const dialog = document.createElement('dialog');
		document.body.append(dialog);
		dialog.showModal();
		const matches = dialog.matches.bind(dialog);
		vi.spyOn(dialog, 'matches').mockImplementation((selector) => (selector === ':modal' ? dialog.open : matches(selector)));
		const picker = capturePicker((root) => {
			// Happy DOM has no native Popover API; actual top-layer behavior is
			// covered by the Chrome DevTools browser checks.
			root.host.showPopover = vi.fn();
			root.host.hidePopover = vi.fn();
		});
		const target = input({}, dialog);
		let releaseSelection;
		let selected;
		const app = fixture({
			accounts: [ACCOUNT, SECOND_ACCOUNT],
			automaticId: null,
			select: async (message) => {
				selected = message;
				const prepared = await app.controller.handle({
					...message,
					type: MESSAGE.AUTO_PREPARE,
					expectedOrigin: document.location.origin,
					expectedTargetPath: autofillPathFromUrl(document.location.href),
					expectedDigits: 6,
				});
				expect(prepared).toMatchObject({ ok: true, status: 'ready' });
				return new Promise((resolve) => {
					releaseSelection = resolve;
				});
			},
		});
		await app.start();
		// Let the initial panel insertion's own scheduled inspection settle.
		await vi.advanceTimersByTimeAsync(550);
		const originalHost = picker().host;
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(1);
		if (pendingSelection) {
			trusted(picker().querySelector('button.account'), 'click');
			await vi.advanceTimersByTimeAsync(0);
			expect(releaseSelection).toBeTypeOf('function');
		}
		dialog.close();
		if (reopenDelay) {
			await vi.advanceTimersByTimeAsync(reopenDelay);
		}
		expect(originalHost.isConnected).toBe(false);
		dialog.showModal();
		await vi.advanceTimersByTimeAsync(200);
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(2);
		expect(picker().host).not.toBe(originalHost);
		expect(picker().host.parentElement).toBe(dialog);
		if (pendingSelection) {
			const staleFill = await app.controller.handle({
				...selected,
				type: MESSAGE.AUTO_FILL,
				expectedOrigin: document.location.origin,
				expectedTargetPath: autofillPathFromUrl(document.location.href),
				code: '123456',
				expiresAt: Date.now() + 30000,
			});
			expect(staleFill).toMatchObject({ ok: false, error: { code: 'TARGET_UNAVAILABLE' } });
			releaseSelection({ ok: true, data: { status: 'filled' } });
			await vi.advanceTimersByTimeAsync(0);
			expect(picker().host.isConnected).toBe(true);
		}
		expect(target.value).toBe('');
	});

	it.each([
		[6, '123456', 23],
		[8, '12345678', 29],
	])('bounds full-page input scans while filling %i segmented digits', async (digits, code, expectedScans) => {
		const fields = segmentedInputs(digits);
		const queries = vi.spyOn(document, 'querySelectorAll');
		let fillResult;
		let scans;
		const app = fixture({
			accounts: [{ ...ACCOUNT, digits }],
			select: async (message) => {
				const common = {
					episodeNonce: message.episodeNonce,
					expectedOrigin: document.location.origin,
					expectedTargetPath: autofillPathFromUrl(document.location.href),
					nonce: message.nonce,
				};
				const prepared = await app.controller.handle({ ...common, type: MESSAGE.AUTO_PREPARE, expectedDigits: digits });
				if (!prepared.ok) {
					return prepared;
				}
				queries.mockClear();
				fillResult = await app.controller.handle({ ...common, type: MESSAGE.AUTO_FILL, code, expiresAt: Date.now() + 30000 });
				scans = queries.mock.calls.filter(([selector]) => selector === 'input').length;
				return fillResult.ok ? { ok: true, data: { status: fillResult.status } } : fillResult;
			},
		});
		await app.start();
		expect(fillResult).toMatchObject({ ok: true, status: 'filled', digits });
		expect(fields.map((field) => field.value).join('')).toBe(code);
		expect(scans).toBeLessThanOrEqual(expectedScans);
	});

	describe.each(['unsafe autocomplete', 'additional OTP', 'new shadow root', 'CSSOM visibility'])(
		'segmented target changes through %s',
		(change) => {
			it.each(['beforeinput', 'input', 'change'])('rechecks after %s and rolls back before reaching later digits', async (eventType) => {
				const fields = segmentedInputs(6);
				const laterEvents = vi.fn();
				for (const field of fields.slice(2)) {
					for (const type of ['beforeinput', 'input', 'change']) {
						field.addEventListener(type, laterEvents);
					}
				}
				let secondOtp;
				let changeTarget;
				let visibleAfterChange;
				if (change === 'unsafe autocomplete') {
					changeTarget = () => fields[1].setAttribute('autocomplete', 'cc-csc');
				} else if (change === 'additional OTP') {
					changeTarget = () => {
						secondOtp = input();
					};
				} else if (change === 'new shadow root') {
					const host = document.createElement('div');
					document.body.append(host);
					changeTarget = () => {
						secondOtp = input({}, host.attachShadow({ mode: 'open' }));
					};
				} else {
					const style = document.createElement('style');
					document.body.append(style);
					style.sheet.insertRule('.hidden-second-otp { display: none; }', 0);
					secondOtp = input({ class: 'hidden-second-otp' });
					expect(window.getComputedStyle(secondOtp).display).toBe('none');
					// Happy DOM does not invalidate computed styles after CSSOM changes.
					// Model the browser's live display result for this one rule/element;
					// the real CSSOM mutation still produces no DOM mutation records.
					const computedStyle = window.getComputedStyle.bind(window);
					vi.spyOn(window, 'getComputedStyle').mockImplementation((element, ...args) => {
						const computed = computedStyle(element, ...args);
						return element !== secondOtp
							? computed
							: new Proxy(computed, {
									get: (target, property) =>
										property === 'display'
											? style.sheet.cssRules.length
												? 'none'
												: 'inline-block'
											: Reflect.get(target, property, target),
								});
					});
					changeTarget = () => {
						style.sheet.deleteRule(0);
						visibleAfterChange = window.getComputedStyle(secondOtp).display !== 'none';
					};
				}
				let changed = false;
				let priorDigit;
				let mutationRecords;
				fields[1].addEventListener(
					eventType,
					() => {
						priorDigit = fields[0].value;
						const observer = new window.MutationObserver(() => {});
						observer.observe(document.documentElement, { attributes: true, childList: true, characterData: true, subtree: true });
						changeTarget();
						mutationRecords = observer.takeRecords();
						observer.disconnect();
						changed = true;
					},
					{ once: true },
				);
				let prepared;
				let filled;
				const app = fixture({
					select: async (message) => {
						const common = {
							episodeNonce: message.episodeNonce,
							expectedOrigin: document.location.origin,
							expectedTargetPath: autofillPathFromUrl(document.location.href),
							nonce: message.nonce,
						};
						prepared = await app.controller.handle({ ...common, type: MESSAGE.AUTO_PREPARE, expectedDigits: 6 });
						filled = await app.controller.handle({
							...common,
							type: MESSAGE.AUTO_FILL,
							code: '123456',
							expiresAt: Date.now() + 30000,
						});
						return filled;
					},
				});
				await app.start();
				expect(prepared).toMatchObject({ ok: true, status: 'ready' });
				expect(changed).toBe(true);
				expect(priorDigit).toBe('1');
				expect(filled).toMatchObject({ ok: false });
				expect(['TARGET_UNAVAILABLE', 'FILL_FAILED']).toContain(filled.error.code);
				expect(fields.map((field) => field.value)).toEqual(Array(6).fill(''));
				expect(laterEvents).not.toHaveBeenCalled();
				expect(JSON.stringify(filled)).not.toContain('123456');
				expect(JSON.stringify(app.runtime.sendMessage.mock.calls)).not.toContain('123456');
				if (secondOtp) {
					expect(secondOtp.value).toBe('');
				}
				if (change === 'new shadow root' || change === 'CSSOM visibility') {
					expect(mutationRecords).toHaveLength(0);
				}
				if (change === 'CSSOM visibility') {
					expect(visibleAfterChange).toBe(true);
				}
			});
		},
	);

	it.each(['status', 'discovery', 'selection'])('permanently disposes after extension context invalidation during %s', async (phase) => {
		input();
		const invalidated = () => {
			throw new Error('Extension context invalidated.');
		};
		const app = fixture({
			...(phase === 'status' ? { status: invalidated } : {}),
			...(phase === 'discovery' ? { discover: invalidated } : {}),
			...(phase === 'selection' ? { select: invalidated } : {}),
		});
		await app.start();
		expect(app.controller.isDisposed()).toBe(true);
		expect(app.runtime.onMessage.removeListener).toHaveBeenCalledOnce();
		expect(document.querySelector('[data-twofa-autofill]')).toBeNull();
		const requests = app.runtime.sendMessage.mock.calls.length;
		const reads = vi.spyOn(document, 'querySelectorAll');
		document.body.append(document.createElement('section'));
		window.history.pushState({}, '', '/another-visit');
		window.dispatchEvent(new window.Event('online'));
		window.dispatchEvent(new window.Event('pageshow'));
		document.dispatchEvent(new window.Event('visibilitychange'));
		await app.controller.refresh();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(app.runtime.sendMessage).toHaveBeenCalledTimes(requests);
		expect(reads).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each(['Extension has been unloaded.', 'Extension is disabled.', 'Extension was removed.'])(
		'recognizes the permanent runtime failure %s',
		async (message) => {
			const app = fixture({ status: () => Promise.reject(new Error(message)) });
			await app.start();
			expect(app.controller.isDisposed()).toBe(true);
			expect(vi.getTimerCount()).toBe(0);
		},
	);

	it('finishes all DOM teardown even if unregistering an invalidated runtime listener throws', async () => {
		input();
		const app = fixture({ accounts: [ACCOUNT, SECOND_ACCOUNT], automaticId: null });
		const removeDocument = vi.spyOn(document, 'removeEventListener');
		const removeWindow = vi.spyOn(window, 'removeEventListener');
		await app.start();
		app.runtime.onMessage.removeListener.mockImplementation(() => {
			throw new Error('Extension context invalidated.');
		});
		expect(() => {
			app.controller.dispose();
			app.controller.dispose();
		}).not.toThrow();
		expect(app.runtime.onMessage.removeListener).toHaveBeenCalledOnce();
		expect(removeDocument.mock.calls.filter(([type]) => type === 'visibilitychange')).toHaveLength(2);
		expect(removeWindow.mock.calls.filter(([type]) => type === 'pagehide')).toHaveLength(2);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('keeps a temporary lost port recoverable instead of disposing the context', async () => {
		const field = input();
		let attempts = 0;
		const app = fixture({
			discover: () =>
				++attempts === 1 ? Promise.reject(new Error('The message port closed before a response was received.')) : accountResult([ACCOUNT]),
		});
		await app.start();
		expect(app.controller.isDisposed()).toBe(false);
		await vi.advanceTimersByTimeAsync(30_200);
		expect(field.value).toBe('123456');
		expect(attempts).toBe(2);
	});

	it('disposes the side-effect manual listener on permanent invalidation and permits a fresh reinjection', async () => {
		const app = fixture();
		app.controller.dispose();
		app.runtime.sendMessage.mockRejectedValueOnce(new Error('Extension context invalidated.'));
		vi.stubGlobal('chrome', { runtime: app.runtime });
		vi.resetModules();
		await import('../../extension/src/content/automatic.js');
		await vi.advanceTimersByTimeAsync(150);
		expect(globalThis[AUTOMATIC_MARKER]).toBeUndefined();
		expect(globalThis[MANUAL_MARKER]).toBeUndefined();
		expect(vi.getTimerCount()).toBe(0);
		vi.resetModules();
		await import('../../extension/src/content/automatic.js');
		await vi.advanceTimersByTimeAsync(150);
		expect(globalThis[AUTOMATIC_MARKER].isDisposed()).toBe(false);
		expect(globalThis[MANUAL_MARKER].isDisposed()).toBe(false);
		// Disabling/destroying only the automatic runner must not affect manual use.
		globalThis[AUTOMATIC_MARKER].dispose();
		expect(globalThis[MANUAL_MARKER].isDisposed()).toBe(false);
	});
	it.each(['edited', 'dismissed', 'manual'])('allows a reused input on a new visit after the previous one was %s', async (mode) => {
		const picker = capturePicker();
		const field = input();
		const app = fixture({
			automaticId: null,
			status: ({ targetPath }) => ({ ok: true, data: { enabled: targetPath === '/login' } }),
		});
		await app.start();
		if (mode === 'edited') {
			trusted(field, 'input');
		}
		if (mode === 'dismissed') {
			trusted(picker().querySelector('button.close'), 'click');
		}
		if (mode === 'manual') {
			app.listen({ type: MESSAGE.PREPARE_TARGET }, { id: 'extension-test' }, vi.fn());
		}
		field.value = '';
		window.history.pushState(null, '', '/home');
		await vi.advanceTimersByTimeAsync(700);
		window.history.pushState(null, '', '/login');
		await vi.advanceTimersByTimeAsync(700);
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(2);
		expect(document.querySelector('[data-twofa-autofill]')).not.toBeNull();
	});
	it('keeps an automatically filled path blocked on later visits in the same document', async () => {
		const field = input();
		const app = fixture({ status: ({ targetPath }) => ({ ok: true, data: { enabled: targetPath === '/login' } }) });
		await app.start();
		expect(field.value).toBe('123456');
		field.value = '';
		for (let visit = 0; visit < 3; visit += 1) {
			window.history.pushState(null, '', '/home');
			await vi.advanceTimersByTimeAsync(700);
			window.history.pushState(null, '', '/login');
			await vi.advanceTimersByTimeAsync(700);
		}
		expect(field.value).toBe('');
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(1);
	});
	it.each(['#/totp', '#!/totp'])('resets visit guards for hash-router navigation %s', async (route) => {
		window.history.replaceState(null, '', `/app${route}`);
		const field = input();
		const app = fixture({
			automaticId: null,
			status: ({ targetPath }) => ({ ok: true, data: { enabled: targetPath === `/app${route}` } }),
		});
		await app.start();
		trusted(field, 'input');
		field.value = '';
		window.history.pushState(null, '', '/app#/home');
		window.dispatchEvent(new window.Event('hashchange'));
		await vi.advanceTimersByTimeAsync(200);
		window.history.pushState(null, '', `/app${route}`);
		window.dispatchEvent(new window.Event('hashchange'));
		await vi.advanceTimersByTimeAsync(200);
		expect(document.querySelector('[data-twofa-autofill]')).not.toBeNull();
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(2);
	});
	it.each(['#/totp', '#!/totp'])('keeps an automatically filled hash route %s blocked after hash navigation', async (route) => {
		window.history.replaceState(null, '', `/app${route}`);
		const field = input();
		const app = fixture({ status: ({ targetPath }) => ({ ok: true, data: { enabled: targetPath === `/app${route}` } }) });
		await app.start();
		expect(field.value).toBe('123456');
		field.value = '';
		window.history.pushState(null, '', '/app#/home');
		window.dispatchEvent(new window.Event('hashchange'));
		await vi.advanceTimersByTimeAsync(200);
		window.history.pushState(null, '', `/app${route}`);
		window.dispatchEvent(new window.Event('hashchange'));
		await vi.advanceTimersByTimeAsync(200);
		expect(field.value).toBe('');
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(1);
	});
	it('detects a route change even when explicit refresh happens before the URL poll', async () => {
		const field = input();
		const app = fixture({
			automaticId: null,
			status: ({ targetPath }) => ({ ok: true, data: { enabled: targetPath === '/login' } }),
		});
		await app.start();
		trusted(field, 'input');
		field.value = '';
		window.history.pushState(null, '', '/home');
		await app.controller.refresh();
		window.history.pushState(null, '', '/login');
		await app.controller.refresh();
		await vi.advanceTimersByTimeAsync(200);
		expect(document.querySelector('[data-twofa-autofill]')).not.toBeNull();
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(2);
	});
	it.each(['filled', 'dismissed', 'manual', 'edited'])(
		'keeps %s suppression through navigation, form replacement, scroll and resize without scanning',
		async (mode) => {
			const picker = capturePicker();
			const field = input();
			const app = fixture({ automaticId: mode === 'filled' ? ACCOUNT.id : null });
			await app.start();
			if (mode === 'dismissed') {
				trusted(picker().querySelector('button.close'), 'click');
			}
			if (mode === 'manual') {
				app.listen({ type: MESSAGE.PREPARE_TARGET }, { id: 'extension-test' }, vi.fn());
			}
			if (mode === 'edited') {
				trusted(field, 'input');
			}
			const query = vi.spyOn(document, 'querySelectorAll');
			field.remove();
			const next = input();
			for (const url of ['/login?challenge=second', '/login?challenge=second#help', '/login#other']) {
				window.history.replaceState(null, '', url);
				document.body.setAttribute('data-counter', url);
				for (let index = 0; index < 10; index++) {
					trusted(document.body, 'scroll');
					trusted(window, 'resize');
				}
				await vi.advanceTimersByTimeAsync(6000);
			}
			await app.controller.refresh();
			window.dispatchEvent(new window.Event('online'));
			await vi.advanceTimersByTimeAsync(1000);
			expect(next.value).toBe('');
			expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(1);
			expect(query.mock.calls.filter(([selector]) => selector === '*')).toHaveLength(0);
		},
	);
	it.each(['scroll', 'resize'])('automatically fills an OTP revealed by %s without DOM mutations or focus', async (event) => {
		const { container, field, resize } = clippedInput();
		const app = fixture();
		await app.start();
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(0);
		expect(field.value).toBe('');
		if (event === 'scroll') {
			container.scrollTop = 250;
			trusted(container, 'scroll');
		} else {
			resize(400);
			trusted(window, 'resize');
		}
		await vi.advanceTimersByTimeAsync(200);
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(1);
		expect(app.messages(MESSAGE.AUTO_SELECT)).toHaveLength(1);
		expect(field.value).toBe('123456');
	});
	it('coalesces continuous scroll and resize events into a bounded OTP scan', async () => {
		const app = fixture();
		await app.start();
		const query = vi.spyOn(document, 'querySelectorAll');
		for (let index = 0; index < 20; index++) {
			trusted(document.body, 'scroll');
			trusted(window, 'resize');
			await vi.advanceTimersByTimeAsync(4);
		}
		expect(query).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(50);
		expect(query.mock.calls.filter(([selector]) => selector === 'input')).toHaveLength(1);
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(500);
		expect(query.mock.calls.filter(([selector]) => selector === 'input')).toHaveLength(1);
	});
	it.each(['animationstart', 'animationend', 'animationcancel', 'animationiteration', 'transitionend', 'transitioncancel'])(
		'detects an OTP revealed by %s without a DOM mutation',
		async (event) => {
			const field = input();
			let opacity = '0';
			const computedStyle = window.getComputedStyle.bind(window);
			vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
				const computed = computedStyle(element);
				return element === field
					? new Proxy(computed, {
							get: (target, property) => (property === 'opacity' ? opacity : Reflect.get(target, property, target)),
						})
					: computed;
			});
			const app = fixture();
			await app.start();
			expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(0);
			opacity = '1';
			field.dispatchEvent(new window.Event(event, { bubbles: true }));
			await vi.advanceTimersByTimeAsync(200);
			expect(field.value).toBe('123456');
			field.value = '';
			field.dispatchEvent(new window.Event(event, { bubbles: true }));
			await vi.advanceTimersByTimeAsync(6000);
			expect(field.value).toBe('');
			expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(1);
		},
	);
	it('coalesces animation events and removes their listeners when stopped', async () => {
		const app = fixture();
		await app.start();
		const query = vi.spyOn(document, 'querySelectorAll');
		for (let index = 0; index < 20; index++) {
			document.body.dispatchEvent(new window.Event('animationend', { bubbles: true }));
			document.body.dispatchEvent(new window.Event('transitionend', { bubbles: true }));
		}
		await vi.advanceTimersByTimeAsync(200);
		expect(query.mock.calls.filter(([selector]) => selector === 'input')).toHaveLength(1);
		app.controller.stop();
		query.mockClear();
		document.body.dispatchEvent(new window.Event('animationend', { bubbles: true }));
		await vi.advanceTimersByTimeAsync(200);
		expect(query).not.toHaveBeenCalled();
	});
	it('ignores unrelated attribute churn before finding an OTP', async () => {
		const app = fixture();
		await app.start();
		const query = vi.spyOn(document, 'querySelectorAll');
		for (let index = 0; index < 4; index++) {
			document.body.setAttribute('data-unrelated', String(index));
			await vi.advanceTimersByTimeAsync(200);
		}
		expect(query).not.toHaveBeenCalled();
		const field = input({ autocomplete: 'off', name: 'unrelated' });
		await vi.advanceTimersByTimeAsync(200);
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(0);
		field.setAttribute('autocomplete', 'one-time-code');
		await vi.advanceTimersByTimeAsync(200);
		expect(field.value).toBe('123456');
	});
	it('does not rescan the document for every event while typing into an ordinary login field', async () => {
		const field = input({ autocomplete: 'username', name: 'username' });
		const app = fixture();
		await app.start();
		const query = vi.spyOn(document, 'querySelectorAll');
		trusted(field, 'beforeinput');
		const firstScans = query.mock.calls.filter(([selector]) => selector === '*').length;
		expect(firstScans).toBeGreaterThan(0);
		for (let index = 0; index < 5; index++) {
			field.value += 'a';
			for (const event of ['beforeinput', 'input', 'change']) {
				trusted(field, event);
			}
		}
		await vi.advanceTimersByTimeAsync(500);
		expect(query.mock.calls.filter(([selector]) => selector === '*')).toHaveLength(firstScans);
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(0);
	});
	it('requires a new explicit Google identity before resuming a completed same-path form', async () => {
		const originalUrl = window.location.href;
		window.happyDOM.setURL('https://accounts.google.com/v3/signin/challenge/totp');
		try {
			const selected = document.createElement('div');
			selected.setAttribute('role', 'link');
			selected.setAttribute('aria-label', 'Account');
			const identifier = document.createElement('span');
			identifier.setAttribute('data-profile-identifier', '');
			identifier.textContent = 'alice@example.com';
			selected.append(identifier);
			document.body.append(selected);
			for (const element of [selected, identifier]) {
				Object.defineProperty(element, 'getClientRects', { value: () => [{ width: 100, height: 20 }] });
			}
			const hidden = document.createElement('input');
			hidden.type = 'hidden';
			hidden.id = 'identifierId';
			hidden.value = 'alice@example.com';
			document.body.append(hidden);
			const field = input({ id: 'totpPin', name: 'totpPin' });
			const app = fixture();
			await app.start();
			expect(field.value).toBe('123456');
			field.remove();
			const replacement = input({ id: 'totpPin', name: 'totpPin' });
			identifier.remove();
			await vi.advanceTimersByTimeAsync(700);
			selected.append(identifier);
			await vi.advanceTimersByTimeAsync(700);
			expect(replacement.value).toBe('');
			expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(1);
			identifier.textContent = 'bob@example.com';
			hidden.value = 'bob@example.com';
			await vi.advanceTimersByTimeAsync(700);
			expect(replacement.value).toBe('123456');
			expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(2);
		} finally {
			window.happyDOM.setURL(originalUrl);
		}
	});
	it('rescans when only a label association changes to identify the existing OTP input', async () => {
		const field = input({ id: 'verification', autocomplete: 'off' });
		const label = document.createElement('label');
		label.textContent = 'Authenticator code';
		label.htmlFor = 'other-input';
		document.body.append(label);
		const app = fixture();
		await app.start();
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(0);
		label.htmlFor = 'verification';
		await vi.advanceTimersByTimeAsync(200);
		expect(field.value).toBe('123456');
	});
	it.each(['AUTH_REQUIRED', 'PERMISSION_REQUIRED', 'NOT_CONFIGURED', 'INVALID_RESPONSE'])(
		'pauses %s until an explicit retry, including visibility and query changes',
		async (code) => {
			const picker = capturePicker();
			input();
			const app = fixture({ discover: () => ({ ok: false, error: { code } }) });
			await app.start();
			await vi.advanceTimersByTimeAsync(90000);
			for (let index = 0; index < 3; index++) {
				window.history.replaceState(null, '', `/login?attempt=${index}#help`);
				window.dispatchEvent(new window.Event('online'));
				Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
				document.dispatchEvent(new window.Event('visibilitychange'));
				Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
				document.dispatchEvent(new window.Event('visibilitychange'));
				await vi.advanceTimersByTimeAsync(31000);
			}
			expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(1);
			expect(document.querySelector('[data-twofa-autofill]')).not.toBeNull();
			trusted(picker().querySelector('button.retry'), 'click');
			await vi.advanceTimersByTimeAsync(500);
			expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(2);
			await vi.advanceTimersByTimeAsync(65000);
			expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(2);
		},
	);
	it('pauses authentication failure from code generation as well as account discovery', async () => {
		input();
		const app = fixture({ select: () => ({ ok: false, error: { code: 'AUTH_REQUIRED' } }) });
		await app.start();
		await vi.advanceTimersByTimeAsync(65000);
		window.dispatchEvent(new window.Event('online'));
		await vi.advanceTimersByTimeAsync(31000);
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(1);
		expect(app.messages(MESSAGE.AUTO_SELECT)).toHaveLength(1);
	});
	it('allows one recovery from an unchanged account revision after code generation requires login', async () => {
		input();
		const app = fixture({ select: () => ({ ok: false, error: { code: 'AUTH_REQUIRED' } }) });
		await app.start();
		app.notify('revision-one');
		await vi.advanceTimersByTimeAsync(500);
		expect(app.messages(MESSAGE.AUTO_SELECT)).toHaveLength(2);
		app.notify('revision-one');
		await vi.advanceTimersByTimeAsync(65000);
		expect(app.messages(MESSAGE.AUTO_SELECT)).toHaveLength(2);
	});
	it.each(['notification', 'configuration'])(
		'recovers initial authentication failure after %s despite lacking an instance identity',
		async (recovery) => {
			let authorized = false;
			const field = input();
			const app = fixture({ discover: () => (authorized ? accountResult([ACCOUNT]) : { ok: false, error: { code: 'AUTH_REQUIRED' } }) });
			await app.start();
			authorized = true;
			if (recovery === 'notification') {
				app.notify('login-recovered');
			} else {
				await app.controller.handle({ type: MESSAGE.AUTO_REFRESH });
			}
			await vi.advanceTimersByTimeAsync(500);
			expect(field.value).toBe('123456');
			expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(2);
		},
	);
	it('does not retry a permanent failure repeatedly for duplicate account notifications', async () => {
		input();
		const app = fixture({ discover: () => ({ ok: false, error: { code: 'AUTH_REQUIRED' } }) });
		await app.start();
		app.notify('changed');
		await vi.advanceTimersByTimeAsync(500);
		app.notify('changed');
		await vi.advanceTimersByTimeAsync(65000);
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(2);
	});
	it.each(['discovery', 'selection'])('preserves one new source-update recovery when an older %s later returns 401', async (stage) => {
		let finish;
		let calls = 0;
		input();
		const app = fixture(
			stage === 'discovery'
				? {
						discover: () =>
							++calls === 1
								? new Promise((resolve) => {
										finish = resolve;
									})
								: { ok: false, error: { code: 'AUTH_REQUIRED' } },
					}
				: {
						select: () =>
							++calls === 1
								? new Promise((resolve) => {
										finish = resolve;
									})
								: { ok: false, error: { code: 'AUTH_REQUIRED' } },
					},
		);
		await app.start();
		app.notify('new-after-login');
		finish({ ok: false, error: { code: 'AUTH_REQUIRED' } });
		await vi.advanceTimersByTimeAsync(500);
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(2);
		app.notify('new-after-login');
		await vi.advanceTimersByTimeAsync(65000);
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(2);
	});
	it.each(['pushState', 'replaceState'])('starts on an authorized route reached through %s without any DOM mutation', async (method) => {
		window.history.replaceState(null, '', '/unapproved');
		const field = input();
		const app = fixture({ status: ({ targetPath }) => ({ ok: true, data: { enabled: targetPath === '/login' } }) });
		await app.start();
		await vi.advanceTimersByTimeAsync(5000);
		expect(app.messages(MESSAGE.AUTO_STATUS)).toHaveLength(1);
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(0);
		window.history[method](null, '', '/login?session=temporary#help');
		await vi.advanceTimersByTimeAsync(750);
		expect(app.messages(MESSAGE.AUTO_STATUS).map(({ targetPath }) => targetPath)).toEqual(['/unapproved', '/login']);
		expect(app.messages(MESSAGE.AUTO_DISCOVER)[0]).toMatchObject({ targetPath: '/login' });
		expect(app.messages(MESSAGE.AUTO_SELECT)[0]).toMatchObject({ targetPath: '/login' });
		expect(field.value).toBe('123456');
	});
	it.each(['#/', '#!/'])('tracks hash routes %s without granting other pages on the same host', async (prefix) => {
		window.history.replaceState(null, '', `/app${prefix}other`);
		const field = input();
		const targetPath = `/app${prefix}totp`;
		const app = fixture({ status: (message) => ({ ok: true, data: { enabled: message.targetPath === targetPath } }) });
		await app.start();
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(0);
		window.history.pushState(null, '', `${targetPath}?challenge=temporary`);
		window.dispatchEvent(new window.Event('hashchange'));
		await vi.advanceTimersByTimeAsync(250);
		expect(app.messages(MESSAGE.AUTO_DISCOVER)[0]).toMatchObject({ targetPath });
		expect(field.value).toBe('123456');
	});
	it('ignores an old successful status response after the path changes', async () => {
		let finishStatus;
		input();
		const app = fixture({
			status: ({ targetPath }) =>
				targetPath === '/login'
					? new Promise((resolve) => {
							finishStatus = resolve;
						})
					: { ok: true, data: { enabled: false } },
		});
		const pending = app.controller.refresh();
		window.history.pushState(null, '', '/unapproved');
		finishStatus({ ok: true, data: { enabled: true } });
		await pending;
		await vi.advanceTimersByTimeAsync(750);
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(0);
		expect(app.messages(MESSAGE.AUTO_STATUS).map(({ targetPath }) => targetPath)).toEqual(['/login', '/unapproved']);
	});
	it('drops in-flight accounts immediately after navigation before the URL poll runs', async () => {
		let finish;
		const field = input();
		const app = fixture({
			discover: () =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		});
		await app.start();
		window.history.pushState(null, '', '/unapproved');
		finish(accountResult([ACCOUNT]));
		await vi.advanceTimersByTimeAsync(0);
		expect(app.messages(MESSAGE.AUTO_SELECT)).toHaveLength(0);
		expect(field.value).toBe('');
	});
	it('requires the exact live path for probes, preparation and code delivery', async () => {
		const field = input();
		const app = fixture({ automaticId: null });
		await app.start();
		const { episodeNonce } = app.messages(MESSAGE.AUTO_DISCOVER)[0];
		const common = { episodeNonce, nonce: NONCE, expectedOrigin: document.location.origin };
		for (const type of [MESSAGE.AUTO_PROBE, MESSAGE.AUTO_PREPARE, MESSAGE.AUTO_FILL]) {
			for (const expectedTargetPath of [undefined, '/different']) {
				expect(
					await app.controller.handle({
						...common,
						type,
						expectedTargetPath,
						expectedDigits: 6,
						code: '123456',
						expiresAt: Date.now() + 30000,
					}),
				).toMatchObject({ ok: false });
			}
		}
		expect(await app.controller.handle({ ...common, type: MESSAGE.AUTO_PROBE, expectedTargetPath: '/login' })).toMatchObject({
			ok: true,
			targetPath: '/login',
		});
		expect(
			await app.controller.handle({ ...common, type: MESSAGE.AUTO_PREPARE, expectedTargetPath: '/login', expectedDigits: 6 }),
		).toMatchObject({ ok: true, status: 'ready' });
		window.history.pushState(null, '', '/different');
		expect(
			await app.controller.handle({
				...common,
				type: MESSAGE.AUTO_FILL,
				expectedTargetPath: '/login',
				code: '123456',
				expiresAt: Date.now() + 30000,
			}),
		).toMatchObject({ ok: false });
		expect(field.value).toBe('');
	});
	it('stops writing when a beforeinput handler navigates to an unapproved SPA path', async () => {
		const field = input();
		field.addEventListener('beforeinput', () => window.history.pushState(null, '', '/unapproved'), { once: true });
		const app = fixture();
		await app.start();
		expect(field.value).toBe('');
	});
	it('pauses local URL monitoring while hidden and resumes path authorization on visibility', async () => {
		window.history.replaceState(null, '', '/unapproved');
		const field = input();
		const app = fixture({ status: ({ targetPath }) => ({ ok: true, data: { enabled: targetPath === '/login' } }) });
		await app.start();
		Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
		document.dispatchEvent(new window.Event('visibilitychange'));
		window.history.pushState(null, '', '/login');
		await vi.advanceTimersByTimeAsync(10000);
		expect(app.messages(MESSAGE.AUTO_STATUS)).toHaveLength(1);
		Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
		document.dispatchEvent(new window.Event('visibilitychange'));
		await vi.advanceTimersByTimeAsync(250);
		expect(field.value).toBe('123456');
	});
	it('fills a unique clear empty OTP without a popup or submission and never refills that input', async () => {
		const field = input();
		const submit = vi.fn();
		document.addEventListener('submit', submit);
		const app = fixture();
		await app.start();
		expect(field.value).toBe('123456');
		expect(app.messages(MESSAGE.AUTO_SELECT)[0]).toMatchObject({ accountId: 'one', automatic: true });
		expect(submit).not.toHaveBeenCalled();
		field.value = '';
		await app.controller.refresh();
		await vi.advanceTimersByTimeAsync(6000);
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(1);
		expect(field.value).toBe('');
		document.removeEventListener('submit', submit);
	});

	it('does no discovery when the site is disabled or no OTP target exists', async () => {
		const app = fixture();
		await app.start();
		await vi.advanceTimersByTimeAsync(15000);
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(0);
		app.controller.stop();
		input();
		const disabled = fixture({ enabled: false });
		await disabled.start();
		expect(disabled.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(0);
	});

	it.each([
		{ autocomplete: 'off', name: 'anything' },
		{ name: 'sms_code', 'aria-label': 'SMS verification code' },
	])('never uses a focused fallback or channel-ambiguous input %j', async (attributes) => {
		input(attributes).focus();
		const app = fixture();
		await app.start();
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(0);
	});

	it.each(['SMS', 'email'])('waits for an authenticator step when adjacent instructions describe %s delivery', async (channel) => {
		const form = document.createElement('form');
		form.innerHTML = `<p>Enter the verification code sent via ${channel}.</p><a href="#sms">Send a code via SMS</a>`;
		document.body.append(form);
		const field = input({ 'aria-label': 'Verification code' }, form);
		const app = fixture();
		await app.start();
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(0);
		expect(field.value).toBe('');
		form.querySelector('p').textContent = 'Enter your authenticator code.';
		await vi.advanceTimersByTimeAsync(300);
		expect(app.messages(MESSAGE.AUTO_SELECT)).toHaveLength(1);
		expect(field.value).toBe('123456');
	});

	it.each([
		'<button type="button">Resend SMS</button>',
		'<a href="#resend">Resend code to your email</a>',
		'<a href="#resend">重新发送短信</a>',
	])('does not automatically fill segmented fields beside a resend action: %s', async (action) => {
		const form = document.createElement('form');
		form.innerHTML = `<p>Enter the 6-digit verification code</p>${action}`;
		document.body.append(form);
		const fields = Array.from({ length: 6 }, () => input({ maxlength: '1' }, form));
		const app = fixture();
		await app.start();
		await vi.advanceTimersByTimeAsync(1000);
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(0);
		expect(fields.every((field) => field.value === '')).toBe(true);
	});

	it.each(['<a href="/lost">Lost your phone?</a>', '<a href="/lost">手机丢了？</a>'])(
		'automatically fills a segmented authenticator form beside an unrelated action: %s',
		async (action) => {
			const form = document.createElement('form');
			form.innerHTML = `<p>Enter the authentication code</p>${action}`;
			document.body.append(form);
			const fields = Array.from({ length: 6 }, () => input({ maxlength: '1' }, form));
			const app = fixture();
			await app.start();
			expect(fields.map((field) => field.value).join('')).toBe('123456');
		},
	);

	it.each(['短信验证', 'SMS verification', 'Email verification'])(
		'does not automatically fill one-time-code fields under the channel legend "%s"',
		async (legend) => {
			const form = document.createElement('form');
			form.innerHTML = `<fieldset><legend>${legend}</legend><div class="row"><div></div></div></fieldset>`;
			document.body.append(form);
			const fields = Array.from({ length: 6 }, () => input({ maxlength: '1' }, form.querySelector('.row div')));
			const app = fixture();
			await app.start();
			await vi.advanceTimersByTimeAsync(1000);
			expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(0);
			expect(fields.every((field) => field.value === '')).toBe(true);
		},
	);

	it('automatically fills a legend-labelled group while the legend shows a countdown', async () => {
		const form = document.createElement('form');
		form.innerHTML = '<fieldset><legend>Authenticator code <span>(30s)</span></legend><div class="row"><div></div></div></fieldset>';
		document.body.append(form);
		const fields = Array.from({ length: 6 }, () => input({ maxlength: '1', autocomplete: 'off' }, form.querySelector('.row div')));
		let seconds = 30;
		const timer = setInterval(() => {
			seconds -= 1;
			form.querySelector('legend span').textContent = `(${seconds}s)`;
		}, 1000);
		try {
			const app = fixture({
				discover: () => new Promise((resolve) => setTimeout(() => resolve(accountResult([ACCOUNT])), 2500)),
			});
			await app.start();
			await vi.advanceTimersByTimeAsync(4000);
			expect(fields.map((field) => field.value).join('')).toBe('123456');
			expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(1);
		} finally {
			clearInterval(timer);
		}
	});

	it('rejects an in-flight discovery after adjacent instructions change from authenticator to SMS', async () => {
		const form = document.createElement('form');
		form.innerHTML = '<p>Enter your authenticator code.</p>';
		document.body.append(form);
		const field = input({}, form);
		let finish;
		const app = fixture({
			discover: () => new Promise((resolve) => (finish = resolve)),
		});
		await app.start();
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(1);
		form.querySelector('p').textContent = 'Enter the verification code sent via SMS.';
		finish(accountResult([ACCOUNT]));
		await vi.advanceTimersByTimeAsync(300);
		expect(app.messages(MESSAGE.AUTO_SELECT)).toHaveLength(0);
		expect(field.value).toBe('');
	});

	it('rejects a generated code after the prepared field changes to email delivery', async () => {
		const form = document.createElement('form');
		form.innerHTML = '<p>Enter your authenticator code.</p>';
		document.body.append(form);
		const field = input({}, form);
		let filled;
		const app = fixture({
			select: async (message) => {
				const common = {
					episodeNonce: message.episodeNonce,
					expectedOrigin: document.location.origin,
					expectedTargetPath: autofillPathFromUrl(document.location.href),
					nonce: message.nonce,
				};
				expect(await app.controller.handle({ ...common, type: MESSAGE.AUTO_PREPARE, expectedDigits: 6 })).toMatchObject({
					ok: true,
					status: 'ready',
				});
				form.querySelector('p').textContent = 'Enter the verification code sent to your email.';
				filled = await app.controller.handle({ ...common, type: MESSAGE.AUTO_FILL, code: '123456', expiresAt: Date.now() + 30000 });
				return filled;
			},
		});
		await app.start();
		expect(filled).toMatchObject({ ok: false, error: { code: 'TARGET_UNAVAILABLE' } });
		expect(field.value).toBe('');
	});

	it('does not select between multiple OTP forms even when one field has focus', async () => {
		input().focus();
		input();
		const app = fixture();
		await app.start();
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(0);
	});

	it('never overwrites existing values', async () => {
		const field = input();
		field.value = '999';
		const app = fixture();
		await app.start();
		expect(field.value).toBe('999');
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(0);
	});

	it('records user edits even if the field is cleared before discovery', async () => {
		const app = fixture();
		await app.start();
		const field = input();
		field.value = '9';
		field.dispatchEvent(new window.Event('input', { bubbles: true }));
		field.value = '';
		await vi.advanceTimersByTimeAsync(500);
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(0);
	});

	it('rejects an in-flight source response after a user edit and clear', async () => {
		let finish;
		const field = input();
		const app = fixture({
			discover: () =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		});
		await app.start();
		const episodeNonce = app.messages(MESSAGE.AUTO_DISCOVER)[0].episodeNonce;
		field.value = '8';
		field.dispatchEvent(new window.Event('input', { bubbles: true }));
		field.value = '';
		finish({ ok: true, data: { nonce: NONCE, accounts: [ACCOUNT], autoFillAccountId: 'one' } });
		await vi.advanceTimersByTimeAsync(200);
		expect(app.messages(MESSAGE.AUTO_SELECT)).toHaveLength(0);
		expect(
			await app.controller.handle({
				type: MESSAGE.AUTO_PROBE,
				episodeNonce,
				expectedOrigin: document.location.origin,
				expectedTargetPath: autofillPathFromUrl(document.location.href),
			}),
		).toMatchObject({ ok: false });
	});

	it('fills a new open shadow root on an existing host but does not repeat after a form rerender', async () => {
		const host = document.createElement('div');
		document.body.append(host);
		const app = fixture();
		await app.start();
		const field = input({}, host.attachShadow({ mode: 'open' }));
		await vi.advanceTimersByTimeAsync(5400);
		expect(field.value).toBe('123456');
		field.remove();
		const next = input();
		await vi.advanceTimersByTimeAsync(500);
		expect(next.value).toBe('');
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(1);
	});

	it('fills a delayed SPA field', async () => {
		const app = fixture();
		await app.start();
		const field = input();
		await vi.advanceTimersByTimeAsync(500);
		expect(field.value).toBe('123456');
	});

	it('remembers a nonempty initial OTP even when a later script clears it', async () => {
		const field = input();
		field.value = '333';
		const app = fixture();
		await app.start();
		field.value = '';
		field.setAttribute('aria-label', 'Authenticator code');
		await vi.advanceTimersByTimeAsync(500);
		expect(field.value).toBe('');
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(0);
	});

	it('manual preparation before passive discovery suppresses a competing automatic task', async () => {
		input();
		const app = fixture();
		await app.controller.refresh();
		app.listen({ type: MESSAGE.PREPARE_TARGET }, { id: 'extension-test' }, vi.fn());
		await vi.advanceTimersByTimeAsync(500);
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(0);
	});

	it('fills accessible same-origin iframe fields', async () => {
		const frame = document.createElement('iframe');
		// Happy DOM has no layout; model a visible frame viewport explicitly.
		Object.defineProperties(frame, {
			clientWidth: { value: 300 },
			clientHeight: { value: 150 },
			offsetWidth: { value: 300 },
			offsetHeight: { value: 150 },
			getBoundingClientRect: { value: () => ({ left: 0, top: 0, right: 300, bottom: 150, width: 300, height: 150 }) },
		});
		document.body.append(frame);
		const field = input({}, frame.contentDocument.body);
		const app = fixture();
		await app.start();
		expect(field.value).toBe('123456');
	});

	it('fills segmented fields using the guarded native filling path', async () => {
		const group = document.createElement('div');
		group.setAttribute('role', 'group');
		group.setAttribute('aria-label', 'Authenticator code');
		document.body.append(group);
		const fields = Array.from({ length: 6 }, (_, index) => input({ maxlength: '1', 'aria-label': `Digit ${index + 1} of 6` }, group));
		const app = fixture();
		await app.start();
		expect(fields.map((field) => field.value).join('')).toBe('123456');
	});

	it('refuses filling if the target changes synchronously during beforeinput', async () => {
		const field = input();
		field.addEventListener('beforeinput', () => input(), { once: true });
		const app = fixture();
		await app.start();
		expect(field.value).toBe('');
	});

	it('suspends hidden pages and resumes when visible', async () => {
		const field = input();
		Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
		const app = fixture();
		await app.start();
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(0);
		Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
		document.dispatchEvent(new window.Event('visibilitychange'));
		await vi.advanceTimersByTimeAsync(300);
		expect(field.value).toBe('123456');
	});

	it('discards pending episodes on pagehide and resumes on pageshow', async () => {
		const field = input();
		const app = fixture({ automaticId: null });
		await app.start();
		const oldEpisode = app.messages(MESSAGE.AUTO_DISCOVER)[0].episodeNonce;
		window.dispatchEvent(new window.Event('pagehide'));
		expect(document.querySelector('[data-twofa-autofill]')).toBeNull();
		expect(
			await app.controller.handle({
				type: MESSAGE.AUTO_PROBE,
				episodeNonce: oldEpisode,
				expectedOrigin: document.location.origin,
				expectedTargetPath: autofillPathFromUrl(document.location.href),
			}),
		).toMatchObject({ ok: false });
		window.dispatchEvent(new window.Event('pageshow'));
		await vi.advanceTimersByTimeAsync(300);
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(2);
		expect(field.value).toBe('');
	});

	it('STOP invalidates old nonces while refresh can resume a still-empty target', async () => {
		input();
		const app = fixture({ automaticId: null });
		await app.start();
		const oldEpisode = app.messages(MESSAGE.AUTO_DISCOVER)[0].episodeNonce;
		await app.controller.handle({ type: MESSAGE.AUTO_STOP });
		expect(
			await app.controller.handle({
				type: MESSAGE.AUTO_PROBE,
				episodeNonce: oldEpisode,
				expectedOrigin: document.location.origin,
				expectedTargetPath: autofillPathFromUrl(document.location.href),
			}),
		).toMatchObject({ ok: false });
		await app.controller.refresh();
		await vi.advanceTimersByTimeAsync(300);
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(2);
	});

	it('manual preparation cancels passive filling without changing manual overwrite', async () => {
		const field = input();
		const app = fixture({ automaticId: null });
		await app.start();
		expect(app.listen({ type: MESSAGE.PREPARE_TARGET }, { id: 'extension-test' }, vi.fn())).toBe(false);
		field.value = '111111';
		const manual = createContentController({ detectionTimeoutMs: 0 });
		expect(await manual.handle({ type: MESSAGE.PREPARE_TARGET, nonce: NONCE })).toMatchObject({ status: 'ready' });
		expect(await manual.handle({ type: MESSAGE.FILL_CODE, nonce: NONCE, code: '654321', expiresAt: Date.now() + 30000 })).toMatchObject({
			status: 'filled',
		});
		expect(field.value).toBe('654321');
		field.value = '';
		await app.controller.refresh();
		await vi.advanceTimersByTimeAsync(300);
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(1);
	});

	it('only accepts runtime messages from this extension background', async () => {
		input();
		const app = fixture({ automaticId: null });
		await app.start();
		const respond = vi.fn();
		expect(app.listen({ type: MESSAGE.AUTO_STOP }, { id: 'other' }, respond)).toBe(false);
		expect(app.listen({ type: MESSAGE.AUTO_STOP }, { id: 'extension-test', tab: { id: 4 } }, respond)).toBe(false);
		expect(respond).not.toHaveBeenCalled();
		expect(document.querySelector('[data-twofa-autofill]')).not.toBeNull();
	});

	it('keeps account choice isolated in closed shadow DOM and rejects synthetic clicks', async () => {
		const original = window.HTMLElement.prototype.attachShadow;
		let picker;
		vi.spyOn(window.HTMLElement.prototype, 'attachShadow').mockImplementation(function (options) {
			const root = original.call(this, options);
			if (options.mode === 'closed') {
				picker = root;
			}
			return root;
		});
		const field = input();
		const app = fixture({ accounts: [ACCOUNT, { ...ACCOUNT, id: 'two', account: 'bob' }], automaticId: null });
		await app.start();
		const host = document.querySelector('[data-twofa-autofill]');
		expect(host.shadowRoot).toBeNull();
		expect(host.textContent).toBe('');
		const buttons = picker.querySelectorAll('button.account');
		expect(buttons).toHaveLength(2);
		buttons[1].click();
		await vi.advanceTimersByTimeAsync(100);
		expect(app.messages(MESSAGE.AUTO_SELECT)).toHaveLength(0);
		trusted(buttons[1], 'click');
		await vi.advanceTimersByTimeAsync(100);
		expect(app.messages(MESSAGE.AUTO_SELECT)[0]).toMatchObject({ accountId: 'two', automatic: false });
		expect(field.value).toBe('123456');
		expect(document.querySelector('[data-twofa-autofill]')).toBeNull();
	});

	it('Escape dismisses a picker without recreating it and returns focus to the OTP', async () => {
		const original = window.HTMLElement.prototype.attachShadow;
		let picker;
		vi.spyOn(window.HTMLElement.prototype, 'attachShadow').mockImplementation(function (options) {
			const root = original.call(this, options);
			if (options.mode === 'closed') {
				picker = root;
			}
			return root;
		});
		const field = input();
		const app = fixture({ automaticId: null });
		await app.start();
		trusted(picker.querySelector('button.account'), 'keydown', { key: 'Escape' });
		await vi.advanceTimersByTimeAsync(600);
		expect(document.querySelector('[data-twofa-autofill]')).toBeNull();
		expect(document.activeElement).toBe(field);
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(1);
	});

	it('does not expose an empty picker when there are no matching accounts', async () => {
		input();
		const app = fixture({ accounts: [], automaticId: null });
		await app.start();
		expect(document.querySelector('[data-twofa-autofill]')).toBeNull();
		expect(app.messages(MESSAGE.AUTO_SELECT)).toHaveLength(0);
	});

	it('limits automatic expiry recovery and provides a visible retry fallback', async () => {
		input();
		const app = fixture({ select: async () => ({ ok: false, error: { code: 'REQUEST_EXPIRED' } }) });
		await app.start();
		await vi.advanceTimersByTimeAsync(6000);
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(2);
		expect(app.messages(MESSAGE.AUTO_SELECT)).toHaveLength(2);
		expect(document.querySelector('[data-twofa-autofill]')).not.toBeNull();
	});

	it('recovers an expired initial discovery without requiring a cache-change notification', async () => {
		let calls = 0;
		const field = input();
		const app = fixture({
			discover: () => (++calls === 1 ? { ok: false, error: { code: 'REQUEST_EXPIRED' } } : accountResult([ACCOUNT], 'unchanged-cache')),
		});
		await app.start();
		await vi.advanceTimersByTimeAsync(300);
		const discoveries = app.messages(MESSAGE.AUTO_DISCOVER);
		expect(discoveries.map((message) => message.refreshSource)).toEqual([true, false]);
		expect(discoveries[1].episodeNonce).not.toBe(discoveries[0].episodeNonce);
		expect(field.value).toBe('123456');
		expect(app.messages(MESSAGE.AUTO_SELECT)).toHaveLength(1);
	});

	it('bounds immediate discovery-expiry recovery to one retry', async () => {
		input();
		const app = fixture({ discover: () => ({ ok: false, error: { code: 'REQUEST_EXPIRED' } }) });
		await app.start();
		await vi.advanceTimersByTimeAsync(6000);
		expect(app.messages(MESSAGE.AUTO_DISCOVER).map((message) => message.refreshSource)).toEqual([true, false]);
		expect(app.messages(MESSAGE.AUTO_SELECT)).toHaveLength(0);
		expect(document.querySelector('[data-twofa-autofill]')).not.toBeNull();
	});

	it.each([
		['multiple', [ACCOUNT, SECOND_ACCOUNT]],
		['zero', []],
	])('refreshes %s candidates from a background change and fills the new unique account', async (_name, initial) => {
		let accounts = initial;
		let revision = 'initial';
		const field = input();
		const app = fixture({ discover: () => accountResult(accounts, revision) });
		await app.start();
		expect(field.value).toBe('');
		accounts = [ACCOUNT];
		revision = 'latest';
		expect(app.notify(revision)).toHaveBeenCalledWith({ ok: true });
		await vi.advanceTimersByTimeAsync(200);
		expect(field.value).toBe('123456');
		expect(app.messages(MESSAGE.AUTO_DISCOVER).map((message) => message.refreshSource)).toEqual([true, false]);
	});

	it('discards an old unique result when a newer multiple-account notice arrives during discovery', async () => {
		let resolveOld;
		let count = 0;
		const field = input();
		const app = fixture({
			discover: () =>
				++count === 1
					? new Promise((resolve) => {
							resolveOld = resolve;
						})
					: accountResult([ACCOUNT, SECOND_ACCOUNT], 'latest'),
		});
		await app.start();
		app.notify('latest');
		resolveOld(accountResult([ACCOUNT], 'old'));
		await vi.advanceTimersByTimeAsync(300);
		expect(app.messages(MESSAGE.AUTO_SELECT)).toHaveLength(0);
		expect(field.value).toBe('');
		expect(document.querySelector('[data-twofa-autofill]')).not.toBeNull();
		expect(app.messages(MESSAGE.AUTO_DISCOVER).map((message) => message.refreshSource)).toEqual([true, false]);
	});

	it('uses a fresh response covering its own cache notification without another fetch', async () => {
		const field = input();
		const app = fixture({
			discover: () => {
				app.notify('latest');
				return accountResult([ACCOUNT], 'latest');
			},
		});
		await app.start();
		await vi.advanceTimersByTimeAsync(1000);
		expect(field.value).toBe('123456');
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(1);
		expect(app.messages(MESSAGE.AUTO_SELECT)).toHaveLength(1);
	});

	it('coalesces rapid notifications and ignores duplicates and notices for another instance', async () => {
		let revision = 'initial';
		input();
		const app = fixture({ discover: () => accountResult([ACCOUNT, SECOND_ACCOUNT], revision) });
		await app.start();
		for (let index = 1; index <= 12; index++) {
			revision = `change-${index}`;
			app.notify(revision);
		}
		await vi.advanceTimersByTimeAsync(500);
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(2);
		app.notify(revision);
		app.notify('different', 'https://other.example');
		await vi.advanceTimersByTimeAsync(500);
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(2);
	});

	it('rejects a stale selection already in flight and rediscovers the latest candidates', async () => {
		let finishSelect;
		let revision = 'old';
		let accounts = [ACCOUNT];
		const field = input();
		const app = fixture({
			discover: () => accountResult(accounts, revision),
			select: () =>
				new Promise((resolve) => {
					finishSelect = resolve;
				}),
		});
		await app.start();
		const selected = app.messages(MESSAGE.AUTO_SELECT)[0];
		revision = 'latest';
		accounts = [ACCOUNT, SECOND_ACCOUNT];
		app.notify(revision);
		expect(
			await app.controller.handle({
				type: MESSAGE.AUTO_PROBE,
				episodeNonce: selected.episodeNonce,
				expectedOrigin: document.location.origin,
				expectedTargetPath: autofillPathFromUrl(document.location.href),
			}),
		).toMatchObject({ ok: false });
		finishSelect({ ok: false, error: { code: 'REQUEST_EXPIRED' } });
		await vi.advanceTimersByTimeAsync(300);
		expect(field.value).toBe('');
		expect(app.messages(MESSAGE.AUTO_SELECT)).toHaveLength(1);
		expect(app.messages(MESSAGE.AUTO_DISCOVER).map((message) => message.refreshSource)).toEqual([true, false]);
		expect(document.querySelector('[data-twofa-autofill]')).not.toBeNull();
	});

	it('retries a failed empty episode with fresh source data when the browser comes online', async () => {
		let online = false;
		const field = input();
		const app = fixture({
			discover: () => (online ? accountResult([ACCOUNT], 'online') : { ok: false, error: { code: 'CONNECTION_FAILED' } }),
		});
		await app.start();
		expect(field.value).toBe('');
		online = true;
		window.dispatchEvent(new window.Event('online'));
		await vi.advanceTimersByTimeAsync(300);
		expect(field.value).toBe('123456');
		expect(app.messages(MESSAGE.AUTO_DISCOVER).map((message) => message.refreshSource)).toEqual([true, true]);
	});

	it('refreshes an unresolved visible episode every thirty seconds and stops on pagehide', async () => {
		input();
		const app = fixture({ accounts: [], automaticId: null });
		await app.start();
		await vi.advanceTimersByTimeAsync(30500);
		expect(app.messages(MESSAGE.AUTO_DISCOVER).map((message) => message.refreshSource)).toEqual([true, true]);
		window.dispatchEvent(new window.Event('pagehide'));
		app.notify('new');
		window.dispatchEvent(new window.Event('online'));
		await vi.advanceTimersByTimeAsync(90000);
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(2);
	});

	it('does not poll when there is no OTP or after a successful fill', async () => {
		const idle = fixture();
		await idle.start();
		await vi.advanceTimersByTimeAsync(90000);
		expect(idle.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(0);
		idle.controller.dispose();
		const field = input();
		const completed = fixture();
		await completed.start();
		field.value = '';
		completed.notify('new');
		window.dispatchEvent(new window.Event('online'));
		await vi.advanceTimersByTimeAsync(90000);
		expect(completed.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(1);
		expect(field.value).toBe('');
	});

	it('keeps user-edited or dismissed episodes suppressed after notifications and online recovery', async () => {
		const original = window.HTMLElement.prototype.attachShadow;
		let picker;
		vi.spyOn(window.HTMLElement.prototype, 'attachShadow').mockImplementation(function (options) {
			const root = original.call(this, options);
			if (options.mode === 'closed') {
				picker = root;
			}
			return root;
		});
		const field = input();
		const app = fixture({ accounts: [ACCOUNT, SECOND_ACCOUNT], automaticId: null });
		await app.start();
		trusted(picker.querySelector('button.close'), 'click');
		app.notify('new');
		window.dispatchEvent(new window.Event('online'));
		await vi.advanceTimersByTimeAsync(35000);
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(1);
		app.controller.dispose();
		const edited = fixture({ accounts: [], automaticId: null });
		await edited.start();
		field.value = '8';
		field.dispatchEvent(new window.Event('input', { bubbles: true }));
		field.value = '';
		edited.notify('new');
		window.dispatchEvent(new window.Event('online'));
		await vi.advanceTimersByTimeAsync(35000);
		expect(edited.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(1);
	});

	it('does not accept account-change notifications from another extension or a content sender', async () => {
		input();
		const app = fixture({ accounts: [], automaticId: null });
		await app.start();
		const response = vi.fn();
		const message = { type: MESSAGE.ACCOUNTS_CHANGED, instanceOrigin: SOURCE, revision: 'new' };
		expect(app.listen(message, { id: 'other' }, response)).toBe(false);
		expect(app.listen(message, { id: 'extension-test', tab: { id: 1 } }, response)).toBe(false);
		await vi.advanceTimersByTimeAsync(500);
		expect(response).not.toHaveBeenCalled();
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(1);
	});

	it('refreshes an open picker when only its clock revision changes', async () => {
		let clockRevision = 'clock-old';
		input();
		const app = fixture({ discover: () => accountResult([ACCOUNT, SECOND_ACCOUNT], 'same-data', null, clockRevision) });
		await app.start();
		expect(document.querySelector('[data-twofa-autofill]')).not.toBeNull();
		clockRevision = 'clock-new';
		app.notify('same-data', SOURCE, clockRevision);
		await vi.advanceTimersByTimeAsync(300);
		expect(app.messages(MESSAGE.AUTO_DISCOVER).map((message) => message.refreshSource)).toEqual([true, false]);
		expect(app.messages(MESSAGE.AUTO_SELECT)).toHaveLength(0);
		app.notify('same-data', SOURCE, clockRevision);
		await vi.advanceTimersByTimeAsync(300);
		expect(app.messages(MESSAGE.AUTO_DISCOVER)).toHaveLength(2);
	});

	it('requires both returned revisions to cover a notification during discovery', async () => {
		let finishOld;
		let calls = 0;
		const field = input();
		const app = fixture({
			discover: () =>
				++calls === 1
					? new Promise((resolve) => {
							finishOld = resolve;
						})
					: accountResult([ACCOUNT], 'same-data', 'one', 'clock-new'),
		});
		await app.start();
		app.notify('same-data', SOURCE, 'clock-new');
		finishOld(accountResult([ACCOUNT], 'same-data', 'one', 'clock-old'));
		await vi.advanceTimersByTimeAsync(300);
		expect(app.messages(MESSAGE.AUTO_DISCOVER).map((message) => message.refreshSource)).toEqual([true, false]);
		expect(app.messages(MESSAGE.AUTO_SELECT)).toHaveLength(1);
		expect(app.messages(MESSAGE.AUTO_SELECT)[0].episodeNonce).toBe(app.messages(MESSAGE.AUTO_DISCOVER)[1].episodeNonce);
		expect(field.value).toBe('123456');
	});

	it('blocks an in-flight selection on a clock-only change and retries unresolved clock state later', async () => {
		let finishSelect;
		let discoveries = 0;
		const field = input();
		const app = fixture({
			discover: () =>
				++discoveries === 1 ? accountResult([ACCOUNT], 'same-data', 'one', 'clock-old') : { ok: false, error: { code: 'CLOCK_CHANGED' } },
			select: () =>
				new Promise((resolve) => {
					finishSelect = resolve;
				}),
		});
		await app.start();
		const selection = app.messages(MESSAGE.AUTO_SELECT)[0];
		app.notify('same-data', SOURCE, 'clock-new');
		expect(
			await app.controller.handle({
				type: MESSAGE.AUTO_PROBE,
				episodeNonce: selection.episodeNonce,
				expectedOrigin: document.location.origin,
				expectedTargetPath: autofillPathFromUrl(document.location.href),
			}),
		).toMatchObject({ ok: false });
		finishSelect({ ok: false, error: { code: 'CLOCK_CHANGED' } });
		await vi.advanceTimersByTimeAsync(300);
		expect(field.value).toBe('');
		expect(app.messages(MESSAGE.AUTO_DISCOVER).map((message) => message.refreshSource)).toEqual([true, false]);
		expect(document.querySelector('[data-twofa-autofill]')).not.toBeNull();
		await vi.advanceTimersByTimeAsync(30500);
		expect(app.messages(MESSAGE.AUTO_DISCOVER).map((message) => message.refreshSource)).toEqual([true, false, true]);
		expect(app.messages(MESSAGE.AUTO_SELECT)).toHaveLength(1);
	});
});
