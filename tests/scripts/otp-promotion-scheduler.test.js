import { describe, expect, it, vi } from 'vitest';

import { getOTPCode } from '../../src/ui/scripts/otp.js';
import { getTimeCode } from '../../src/ui/scripts/time.js';

const BASE_TIME_MS = Date.UTC(2026, 0, 1);

function createDeferred() {
	let resolve;
	let reject;
	const promise = new Promise((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

async function flushMicrotasks() {
	for (let index = 0; index < 8; index += 1) {
		await Promise.resolve();
	}
}

function createHarness(
	periods = [30, 30],
	secretOverrides = [],
	{ sharedSchedulerAvailable = true } = {},
) {
	const state = { monotonicMs: 0, wallClockAdjustmentMs: 0 };
	const domEvents = [];
	const secretAccessStats = {
		idReads: 0,
		reset() {
			this.idReads = 0;
		},
	};
	const secrets = periods.map(
		(period, index) =>
			new Proxy(
				{
					id: String.fromCharCode(97 + index),
					name: 'Scheduler test ' + index,
					secret: 'SECRET' + index,
					period,
					type: 'TOTP',
					...(secretOverrides[index] ?? {}),
				},
				{
					get(target, property, receiver) {
						if (property === 'id') {
							secretAccessStats.idReads += 1;
						}
						return Reflect.get(target, property, receiver);
					},
				},
			),
	);
	const elements = {};
	const createdElements = [];
	const timeoutCallbacks = new Map();
	const frameCallbacks = new Map();
	const intervalCallbacks = new Map();
	const documentListeners = new Map();
	let timeoutId = 0;
	let frameId = 0;
	let intervalId = 0;

	function createClassList(label) {
		const classes = new Set();
		return {
			add: vi.fn((...names) => {
				domEvents.push({ type: 'class-add', label, names, at: state.monotonicMs });
				names.forEach((name) => classes.add(name));
			}),
			remove: vi.fn((...names) => names.forEach((name) => classes.delete(name))),
			contains: vi.fn((name) => classes.has(name)),
			toggle: vi.fn((name, force) => {
				const shouldHave = force === undefined ? !classes.has(name) : force;
				if (shouldHave) {
					classes.add(name);
				} else {
					classes.delete(name);
				}
				return shouldHave;
			}),
		};
	}

	function createElement(textContent, rect, label) {
		const attributes = new Map();
		const parentElement = { offsetWidth: 0 };
		const style = {
			setProperty: vi.fn((name, value) => {
				style[name] = value;
			}),
		};
		const normalizedRect = rect
			? {
					...rect,
					right: rect.right ?? rect.left + rect.width,
					bottom: rect.bottom ?? rect.top + rect.height,
				}
			: null;
		const element = {
			textContent,
			className: '',
			classList: createClassList(label),
			isConnected: true,
			parentElement,
			parentNode: parentElement,
			style,
			setAttribute: vi.fn((name, value) => attributes.set(name, String(value))),
			getAttribute: vi.fn((name) => attributes.get(name) ?? null),
			getBoundingClientRect: vi.fn(() => {
				domEvents.push({ type: 'rect-read', label, at: state.monotonicMs });
				return normalizedRect;
			}),
			remove: vi.fn(() => {
				if (element.parentNode && typeof element.parentNode.removeChild === 'function') {
					element.parentNode.removeChild(element);
				}
				element.isConnected = false;
			}),
		};
		return element;
	}

	secrets.forEach((secret, index) => {
		const currentRect = { left: 20 + index * 320, top: 32, width: 220, height: 46 };
		const nextRect = { left: 260 + index * 320, top: 40, width: 70, height: 24 };
		elements['otp-' + secret.id] = createElement('------', currentRect, 'otp-' + secret.id);
		elements['next-otp-' + secret.id] = createElement('------', nextRect, 'next-otp-' + secret.id);
		elements['progress-' + secret.id] = createElement('', null, 'progress-' + secret.id);
	});

	const body = {
		children: [],
		appendChild: vi.fn((element) => {
			domEvents.push({ type: 'append', label: element.tagName || 'flyer', at: state.monotonicMs });
			element.parentNode = body;
			body.children.push(element);
			return element;
		}),
		removeChild: vi.fn((element) => {
			const index = body.children.indexOf(element);
			if (index >= 0) {
				body.children.splice(index, 1);
			}
			element.parentNode = null;
			return element;
		}),
	};

	const document = {
		hidden: false,
		documentElement: { clientWidth: 1440, clientHeight: 900 },
		body,
		addEventListener: vi.fn((type, listener) => {
			const listeners = documentListeners.get(type) || new Set();
			listeners.add(listener);
			documentListeners.set(type, listeners);
		}),
		getElementById: vi.fn((id) => elements[id] ?? null),
		createElement: vi.fn((tagName) => {
			const element = createElement('', null, 'created-' + createdElements.length);
			element.tagName = String(tagName).toUpperCase();
			createdElements.push(element);
			return element;
		}),
	};

	const localStorage = {
		getItem: vi.fn((key) => (key === '2fa-otp-animation' ? 'flow' : null)),
		setItem: vi.fn(),
		removeItem: vi.fn(),
	};
	const setTimeout = vi.fn((callback, delay) => {
		const id = ++timeoutId;
		timeoutCallbacks.set(id, { callback, delay });
		return id;
	});
	const clearTimeout = vi.fn((id) => timeoutCallbacks.delete(id));
	const setInterval = vi.fn((callback, delay) => {
		if (delay === 250 && !sharedSchedulerAvailable) {
			throw new Error('simulated shared scheduler registration failure');
		}
		const id = ++intervalId;
		intervalCallbacks.set(id, { callback, delay });
		return id;
	});
	const clearInterval = vi.fn((id) => intervalCallbacks.delete(id));
	const requestAnimationFrame = vi.fn((callback) => {
		const id = ++frameId;
		frameCallbacks.set(id, callback);
		return id;
	});
	const cancelAnimationFrame = vi.fn((id) => frameCallbacks.delete(id));
	const computedStyleValues = {
		fontFamily: 'monospace',
		fontSize: '16px',
		fontWeight: '600',
		fontVariantNumeric: 'tabular-nums',
		letterSpacing: '2px',
		lineHeight: '16px',
		color: 'rgb(0, 0, 0)',
	};
	const getComputedStyle = vi.fn(
		() =>
			new Proxy(computedStyleValues, {
				get(target, property) {
					if (typeof property === 'string') {
						domEvents.push({ type: 'style-read', label: property, at: state.monotonicMs });
					}
					return target[property];
				},
			}),
	);

	function FakeDate(...args) {
		return new Date(...(args.length > 0 ? args : [FakeDate.now()]));
	}
	FakeDate.now = () => BASE_TIME_MS + state.monotonicMs + state.wallClockAdjustmentMs;
	FakeDate.UTC = Date.UTC;
	FakeDate.parse = Date.parse;

	const window = {
		crypto: globalThis.crypto,
		innerWidth: 1440,
		innerHeight: 900,
		matchMedia: vi.fn(() => ({ matches: false })),
		requestAnimationFrame,
		cancelAnimationFrame,
		addEventListener: vi.fn(),
	};
	const quietConsole = { error: vi.fn(), log: vi.fn(), warn: vi.fn() };

	// The UI scripts are emitted into one browser scope, so evaluate them in the same way here.
	// eslint-disable-next-line no-new-func
	const api = new Function(
		'Date',
		'performance',
		'fetch',
		'localStorage',
		'navigator',
		'document',
		'window',
		'setTimeout',
		'clearTimeout',
		'setInterval',
		'clearInterval',
		'AbortController',
		'requestAnimationFrame',
		'cancelAnimationFrame',
		'getComputedStyle',
		'console',
		'secrets',
		'otpIntervals',
		`${getTimeCode()}${getOTPCode()}; return {
			trustedClock,
			otpCalculator,
			refreshTOTPsAfterClockChange,
			updateOTP,
			startOTPInterval,
			updateCountdown
		};`,
	)(
		FakeDate,
		{ now: () => state.monotonicMs },
		vi.fn(),
		localStorage,
		{ onLine: true },
		document,
		window,
		setTimeout,
		clearTimeout,
		setInterval,
		clearInterval,
		AbortController,
		requestAnimationFrame,
		cancelAnimationFrame,
		getComputedStyle,
		quietConsole,
		secrets,
		{},
	);

	const generationCalls = [];
	api.otpCalculator.generateTOTP = vi.fn((secret, counter) => {
		const deferred = createDeferred();
		generationCalls.push({ secret, counter, ...deferred });
		return deferred.promise;
	});

	async function flushFrames() {
		const callbacks = [...frameCallbacks.entries()];
		for (const [id, callback] of callbacks) {
			if (!frameCallbacks.has(id)) {
				continue;
			}
			frameCallbacks.delete(id);
			callback(state.monotonicMs);
		}
		await flushMicrotasks();
	}

	async function resolvePair(startIndex, currentToken, nextToken) {
		generationCalls[startIndex].resolve(currentToken);
		generationCalls[startIndex + 1].resolve(nextToken);
		await flushMicrotasks();
	}

	async function rejectPair(startIndex) {
		generationCalls[startIndex].reject(new Error('simulated OTP failure'));
		generationCalls[startIndex + 1].reject(new Error('simulated OTP failure'));
		await flushMicrotasks();
	}

	async function runWindowScheduler() {
		const scheduler = [...intervalCallbacks.values()].find(({ delay }) => delay === 250);
		expect(scheduler, 'shared OTP window scheduler was not registered').toBeDefined();
		scheduler.callback();
		await flushMicrotasks();
	}

	async function dispatchDocumentEvent(type) {
		for (const listener of documentListeners.get(type) ?? []) {
			listener({ type });
			await flushMicrotasks();
		}
	}

	return {
		api,
		dispatchDocumentEvent,
		document,
		domEvents,
		elements,
		flushFrames,
		generationCalls,
		intervalCallbacks,
		requestAnimationFrame,
		rejectPair,
		resolvePair,
		runWindowScheduler,
		secretAccessStats,
		secrets,
		state,
		timeoutCallbacks,
	};
}

function animationAdds(harness, id) {
	return harness.elements['otp-' + id].classList.add.mock.calls.flat();
}

describe('OTP promotion scheduling', () => {
	it('batches two cards that promote in one window into a single animation frame', async () => {
		const harness = createHarness([30, 30]);

		const initialA = harness.api.updateOTP('a');
		const initialB = harness.api.updateOTP('b');
		await harness.resolvePair(0, '111111', '222222');
		await harness.resolvePair(2, '333333', '444444');
		await Promise.all([initialA, initialB]);
		harness.api.startOTPInterval('a');
		harness.api.startOTPInterval('b');

		// Once the shared scheduler is active, a per-card boundary check is only
		// a progress update and must not launch another OTP calculation.
		const originalGetRemainingTime = harness.api.otpCalculator.getRemainingTime;
		harness.api.otpCalculator.getRemainingTime = vi.fn(() => 0);
		harness.api.updateCountdown('a');
		harness.api.updateCountdown('b');
		expect(harness.generationCalls).toHaveLength(4);
		harness.api.otpCalculator.getRemainingTime = originalGetRemainingTime;

		harness.state.monotonicMs += 30_000;
		await harness.runWindowScheduler();
		expect(harness.generationCalls).toHaveLength(8);
		await harness.resolvePair(4, '222222', '555555');
		expect(harness.requestAnimationFrame).not.toHaveBeenCalled();
		await harness.resolvePair(6, '444444', '666666');
		await flushMicrotasks();

		expect(harness.requestAnimationFrame).toHaveBeenCalledTimes(1);
		expect(animationAdds(harness, 'a')).toEqual([]);
		expect(animationAdds(harness, 'b')).toEqual([]);

		await harness.flushFrames();

		expect(animationAdds(harness, 'a')).toEqual(['otp-promote-current']);
		expect(animationAdds(harness, 'b')).toEqual(['otp-promote-current']);
		const firstWrite = harness.domEvents.findIndex((event) => event.type === 'append' || event.type === 'class-add');
		const lastRead = harness.domEvents.reduce(
			(lastIndex, event, index) => (event.type === 'rect-read' || event.type === 'style-read' ? index : lastIndex),
			-1,
		);
		expect(lastRead).toBeGreaterThanOrEqual(3);
		expect(firstWrite).toBeGreaterThan(lastRead);
	});

	it('does not promote eight-digit fallback placeholders', async () => {
		const harness = createHarness([30]);
		harness.secrets[0].digits = 8;

		const initial = harness.api.updateOTP('a');
		await harness.resolvePair(0, '--------', '--------');
		await initial;

		harness.state.monotonicMs += 30_000;
		const failedPromotion = harness.api.updateOTP('a');
		await harness.resolvePair(2, '--------', '--------');
		await failedPromotion;

		expect(harness.elements['otp-a'].textContent).toBe('--------');
		expect(harness.elements['next-otp-a'].textContent).toBe('--------');
		expect(harness.requestAnimationFrame).not.toHaveBeenCalled();
		expect(animationAdds(harness, 'a')).toEqual([]);
		expect(harness.timeoutCallbacks.size).toBe(0);
	});

	it('treats an eight-digit all-dash scheduler result as uncommitted', async () => {
		const harness = createHarness([30]);
		harness.secrets[0].digits = 8;

		const initial = harness.api.updateOTP('a');
		await harness.resolvePair(0, '11111111', '22222222');
		await initial;
		harness.api.startOTPInterval('a');

		harness.state.monotonicMs = 30_000;
		await harness.runWindowScheduler();
		await harness.resolvePair(2, '--------', '--------');
		expect(harness.elements['otp-a'].textContent).toBe('--------');

		await harness.runWindowScheduler();
		expect(harness.generationCalls).toHaveLength(4);
		harness.state.monotonicMs += 1000;
		await harness.runWindowScheduler();
		expect(harness.generationCalls).toHaveLength(6);
		await harness.resolvePair(4, '22222222', '33333333');
		expect(harness.elements['otp-a'].textContent).toBe('22222222');
	});

	it('defensively refreshes any all-dash placeholder when no scheduler is active', async () => {
		const harness = createHarness([30]);
		harness.secrets[0].digits = 8;
		harness.elements['otp-a'].textContent = '--------';

		harness.api.updateCountdown('a');
		expect(harness.generationCalls).toHaveLength(2);
		await harness.resolvePair(0, '11111111', '22222222');
		expect(harness.elements['otp-a'].textContent).toBe('11111111');
	});

	it('falls back by committed window when the shared scheduler is unavailable', async () => {
		const harness = createHarness(
			[30],
			[{ digits: 8 }],
			{ sharedSchedulerAvailable: false },
		);
		const initial = harness.api.updateOTP('a');
		await harness.resolvePair(0, '11111111', '22222222');
		await initial;

		harness.api.startOTPInterval('a', harness.secrets[0]);
		const perCardInterval = [...harness.intervalCallbacks.values()].find(({ delay }) => delay === 1000);
		expect(perCardInterval, 'per-card countdown interval was not registered').toBeDefined();
		expect(harness.generationCalls).toHaveLength(2);

		harness.state.monotonicMs = 29_999;
		perCardInterval.callback();
		await flushMicrotasks();
		expect(harness.generationCalls).toHaveLength(2);

		harness.state.monotonicMs = 30_000;
		perCardInterval.callback();
		await flushMicrotasks();
		expect(harness.generationCalls).toHaveLength(4);
		await harness.resolvePair(2, '22222222', '33333333');
		expect(harness.elements['otp-a'].textContent).toBe('22222222');
		expect(harness.elements['next-otp-a'].textContent).toBe('33333333');

		perCardInterval.callback();
		await flushMicrotasks();
		expect(harness.generationCalls).toHaveLength(4);
	});

	it('skips countdown work while hidden and resumes through the shared scheduler', async () => {
		const harness = createHarness([30]);
		const initial = harness.api.updateOTP('a');
		await harness.resolvePair(0, '111111', '222222');
		await initial;
		harness.api.startOTPInterval('a', harness.secrets[0]);

		const perCardInterval = [...harness.intervalCallbacks.values()].find(({ delay }) => delay === 1000);
		expect(perCardInterval, 'per-card countdown interval was not registered').toBeDefined();
		harness.document.hidden = true;
		await harness.dispatchDocumentEvent('visibilitychange');
		harness.elements['progress-a'].style.width = 'sentinel';
		harness.elements['otp-a'].textContent = '------';
		harness.state.monotonicMs = 30_000;

		perCardInterval.callback();
		await flushMicrotasks();
		expect(harness.elements['progress-a'].style.width).toBe('sentinel');
		expect(harness.generationCalls).toHaveLength(2);

		harness.document.hidden = false;
		await harness.dispatchDocumentEvent('visibilitychange');
		perCardInterval.callback();
		await flushMicrotasks();
		expect(harness.elements['progress-a'].style.width).toBe('100%');
		expect(harness.generationCalls).toHaveLength(2);

		await harness.runWindowScheduler();
		expect(harness.generationCalls).toHaveLength(4);
		await harness.resolvePair(2, '222222', '333333');
		expect(harness.elements['otp-a'].textContent).toBe('222222');
		expect(harness.elements['next-otp-a'].textContent).toBe('333333');
	});

	it('does not queue a promotion when the page becomes hidden during calculation', async () => {
		const harness = createHarness([30]);
		const initial = harness.api.updateOTP('a');
		await harness.resolvePair(0, '111111', '222222');
		await initial;

		harness.state.monotonicMs += 30_000;
		const promotion = harness.api.updateOTP('a');
		harness.document.hidden = true;
		await harness.dispatchDocumentEvent('visibilitychange');
		await harness.resolvePair(2, '222222', '333333');
		await promotion;

		expect(harness.elements['otp-a'].textContent).toBe('222222');
		expect(harness.elements['next-otp-a'].textContent).toBe('333333');
		expect(harness.requestAnimationFrame).not.toHaveBeenCalled();
		expect(animationAdds(harness, 'a')).toEqual([]);
		expect(harness.timeoutCallbacks.size).toBe(0);
	});

	it('cleans a held scheduler batch when the page becomes hidden', async () => {
		const harness = createHarness([30, 30]);
		const initialA = harness.api.updateOTP('a');
		const initialB = harness.api.updateOTP('b');
		await harness.resolvePair(0, '111111', '222222');
		await harness.resolvePair(2, '333333', '444444');
		await Promise.all([initialA, initialB]);
		harness.api.startOTPInterval('a');
		harness.api.startOTPInterval('b');

		harness.state.monotonicMs = 30_000;
		await harness.runWindowScheduler();
		await harness.resolvePair(4, '222222', '555555');
		expect(harness.requestAnimationFrame).not.toHaveBeenCalled();

		harness.document.hidden = true;
		await harness.dispatchDocumentEvent('visibilitychange');
		await harness.resolvePair(6, '444444', '666666');

		expect(harness.requestAnimationFrame).not.toHaveBeenCalled();
		expect(animationAdds(harness, 'a')).toEqual([]);
		expect(animationAdds(harness, 'b')).toEqual([]);
		expect(harness.document.body.children).toHaveLength(0);
	});

	it('reuses an in-flight calculation and does not replay a queued promotion', async () => {
		const harness = createHarness([30]);

		const initial = harness.api.updateOTP('a');
		const duplicateInitial = harness.api.updateOTP('a');
		expect(duplicateInitial).toBe(initial);
		expect(harness.generationCalls).toHaveLength(2);
		await harness.resolvePair(0, '111111', '222222');
		await initial;

		harness.state.monotonicMs += 30_000;
		const promotion = harness.api.updateOTP('a');
		const duplicatePromotion = harness.api.updateOTP('a');
		expect(duplicatePromotion).toBe(promotion);
		expect(harness.generationCalls).toHaveLength(4);
		await harness.resolvePair(2, '222222', '333333');
		await promotion;

		expect(harness.requestAnimationFrame).toHaveBeenCalledTimes(1);
		await harness.flushFrames();
		expect(animationAdds(harness, 'a')).toEqual(['otp-promote-current']);
		expect(harness.timeoutCallbacks.size).toBe(1);

		// A same-window refresh after the frame must keep the active handoff intact.
		await harness.api.updateOTP('a');
		expect(animationAdds(harness, 'a')).toEqual(['otp-promote-current']);
		expect(harness.timeoutCallbacks.size).toBe(1);
	});

	it('keeps 30-second and 60-second cards on their own scheduler boundaries', async () => {
		const harness = createHarness([30, 60]);

		const initialA = harness.api.updateOTP('a');
		const initialB = harness.api.updateOTP('b');
		await harness.resolvePair(0, '111111', '222222');
		await harness.resolvePair(2, '333333', '444444');
		await Promise.all([initialA, initialB]);
		harness.api.startOTPInterval('a');
		harness.api.startOTPInterval('b');

		harness.state.monotonicMs += 30_000;
		await harness.runWindowScheduler();
		expect(harness.generationCalls).toHaveLength(6);
		await harness.resolvePair(4, '222222', '555555');
		await flushMicrotasks();
		await harness.flushFrames();

		expect(animationAdds(harness, 'a')).toEqual(['otp-promote-current']);
		expect(animationAdds(harness, 'b')).toEqual([]);
		expect(harness.requestAnimationFrame).toHaveBeenCalledTimes(1);

		// At the 60-second boundary both cards advance, but the longer-period card
		// must not be pulled into the earlier 30-second handoff.
		harness.state.monotonicMs += 30_000;
		await harness.runWindowScheduler();
		expect(harness.generationCalls).toHaveLength(10);
		await harness.resolvePair(6, '555555', '777777');
		await harness.resolvePair(8, '444444', '888888');
		await flushMicrotasks();
		await harness.flushFrames();

		expect(animationAdds(harness, 'b')).toEqual(['otp-promote-current']);
	});

	it('backfills a window crossed before the first interval is registered', async () => {
		const harness = createHarness([30]);
		harness.state.monotonicMs = 29_900;

		const initial = harness.api.updateOTP('a');
		await harness.resolvePair(0, '111111', '222222');
		await initial;

		// The initial card committed the old window, but registration happens
		// after the clock has already entered the next one.
		harness.state.monotonicMs += 200;
		harness.api.otpCalculator.clearCache();
		harness.api.startOTPInterval('a');
		await harness.runWindowScheduler();
		expect(harness.generationCalls).toHaveLength(4);

		await harness.resolvePair(2, '222222', '333333');
		await flushMicrotasks();
		await harness.flushFrames();

		expect(harness.elements['otp-a'].textContent).toBe('222222');
		expect(harness.elements['next-otp-a'].textContent).toBe('333333');
		expect(animationAdds(harness, 'a')).toEqual(['otp-promote-current']);
	});

	it('backs off before retrying an uncommitted update in the same window', async () => {
		const harness = createHarness([30]);

		const initial = harness.api.updateOTP('a');
		await harness.resolvePair(0, '111111', '222222');
		await initial;

		harness.api.startOTPInterval('a');
		harness.state.monotonicMs += 30_000;
		await harness.runWindowScheduler();
		expect(harness.generationCalls).toHaveLength(4);

		// A failed calculation is represented by placeholder values. Rejections
		// avoid caching that failed result, leaving the window uncommitted.
		await harness.rejectPair(2);
		await flushMicrotasks();
		expect(harness.elements['otp-a'].textContent).toBe('------');
		const perCardInterval = [...harness.intervalCallbacks.values()].find(({ delay }) => delay === 1000);
		expect(perCardInterval, 'per-card countdown interval was not registered').toBeDefined();
		perCardInterval.callback();
		await flushMicrotasks();
		expect(harness.generationCalls).toHaveLength(4);

		await harness.runWindowScheduler();
		expect(harness.generationCalls).toHaveLength(4);
		harness.state.monotonicMs += 999;
		await harness.runWindowScheduler();
		expect(harness.generationCalls).toHaveLength(4);
		harness.state.monotonicMs += 1;
		await harness.runWindowScheduler();
		expect(harness.generationCalls).toHaveLength(6);
		await harness.resolvePair(4, '222222', '333333');
		await flushMicrotasks();
		await harness.flushFrames();

		expect(harness.elements['otp-a'].textContent).toBe('222222');
		expect(harness.elements['next-otp-a'].textContent).toBe('333333');
	});

	it('caps retries for a persistently failing window and resets at the next window', async () => {
		const harness = createHarness([30]);

		const initial = harness.api.updateOTP('a');
		await harness.resolvePair(0, '111111', '222222');
		await initial;
		harness.api.startOTPInterval('a');

		harness.state.monotonicMs = 30_000;
		await harness.runWindowScheduler();
		await harness.rejectPair(2);

		const retryDelays = [1000, 2000, 4000, 8000];
		for (const [retryIndex, delayMs] of retryDelays.entries()) {
			harness.state.monotonicMs += delayMs - 1;
			await harness.runWindowScheduler();
			expect(harness.generationCalls).toHaveLength(4 + retryIndex * 2);
			harness.state.monotonicMs += 1;
			await harness.runWindowScheduler();
			expect(harness.generationCalls).toHaveLength(6 + retryIndex * 2);
			await harness.rejectPair(4 + retryIndex * 2);
		}

		// Five failed attempts exhaust this window even after the maximum backoff elapses.
		harness.state.monotonicMs = 59_999;
		await harness.runWindowScheduler();
		expect(harness.generationCalls).toHaveLength(12);

		harness.state.monotonicMs = 60_000;
		await harness.runWindowScheduler();
		expect(harness.generationCalls).toHaveLength(14);
		await harness.resolvePair(12, '333333', '444444');
		expect(harness.elements['otp-a'].textContent).toBe('333333');
	});

	it('invalidates a pending same-window attempt when the clock generation changes', async () => {
		const harness = createHarness([30]);

		const initial = harness.api.updateOTP('a');
		await harness.resolvePair(0, '111111', '222222');
		await initial;
		harness.api.startOTPInterval('a');

		harness.state.monotonicMs = 30_000;
		await harness.runWindowScheduler();
		expect(harness.generationCalls).toHaveLength(4);

		// Leave the original scheduler calculation unresolved, then start a fresh
		// request for the new trusted-clock generation in the same TOTP window.
		harness.api.trustedClock.generation += 1;
		harness.api.refreshTOTPsAfterClockChange();
		expect(harness.generationCalls).toHaveLength(6);
		await harness.runWindowScheduler();
		expect(harness.generationCalls).toHaveLength(6);
		await harness.rejectPair(4);

		harness.state.monotonicMs += 1000;
		await harness.runWindowScheduler();
		expect(harness.generationCalls).toHaveLength(8);
		await harness.resolvePair(6, '222222', '333333');
		expect(harness.elements['otp-a'].textContent).toBe('222222');
		expect(harness.requestAnimationFrame).not.toHaveBeenCalled();

		// The superseded request may finish later, but cannot overwrite the fresh result.
		await harness.resolvePair(2, 'stale-current', 'stale-next');
		expect(harness.elements['otp-a'].textContent).toBe('222222');
		expect(harness.requestAnimationFrame).not.toHaveBeenCalled();
	});

	it('keeps a delayed HOTP initial result through background clock invalidation', async () => {
		const harness = createHarness([30], [{ type: 'HOTP', counter: 42 }]);
		const initialUpdate = harness.api.updateOTP('a');
		expect(harness.generationCalls).toHaveLength(2);
		expect(harness.generationCalls.map(({ counter }) => counter)).toEqual([42, 43]);

		// A cached clock lets initial rendering continue while synchronization runs
		// in the background. Its completion invalidates TOTP work, but HOTP is not
		// time-based and has no interval that could recover a discarded first result.
		harness.api.trustedClock.generation += 1;
		harness.api.refreshTOTPsAfterClockChange();
		await flushMicrotasks();
		expect(harness.generationCalls).toHaveLength(2);

		await harness.resolvePair(0, '123456', '234567');
		await initialUpdate;

		expect(harness.elements['otp-a'].textContent).toBe('123456');
		expect(harness.elements['next-otp-a'].textContent).toBe('234567');
		expect(harness.api.otpCalculator.generateTOTP).toHaveBeenCalledTimes(2);
	});

	it('still replaces delayed TOTP work after background clock invalidation', async () => {
		const harness = createHarness([30]);
		const staleUpdate = harness.api.updateOTP('a');
		expect(harness.generationCalls).toHaveLength(2);

		harness.api.trustedClock.generation += 1;
		harness.api.refreshTOTPsAfterClockChange();
		await flushMicrotasks();
		expect(harness.generationCalls).toHaveLength(4);

		await harness.resolvePair(2, '345678', '456789');
		expect(harness.elements['otp-a'].textContent).toBe('345678');
		expect(harness.elements['next-otp-a'].textContent).toBe('456789');

		await harness.resolvePair(0, '123456', '234567');
		await staleUpdate;
		expect(harness.elements['otp-a'].textContent).toBe('345678');
		expect(harness.elements['next-otp-a'].textContent).toBe('456789');
		expect(harness.api.otpCalculator.generateTOTP).toHaveBeenCalledTimes(4);
	});

	it('refreshes countdown progress as soon as a scheduled window commits', async () => {
		const harness = createHarness([30]);

		const initial = harness.api.updateOTP('a');
		await harness.resolvePair(0, '111111', '222222');
		await initial;
		harness.api.startOTPInterval('a');
		harness.elements['progress-a'].style.width = '0%';

		harness.state.monotonicMs = 30_000;
		await harness.runWindowScheduler();
		await harness.resolvePair(2, '222222', '333333');

		expect(harness.elements['progress-a'].style.width).toBe('100%');
	});

	it('does not reuse an in-flight result after the secret material changes', async () => {
		const harness = createHarness([30]);
		const staleUpdate = harness.api.updateOTP('a');
		harness.secrets[0].secret = 'REPLACED-SECRET';
		const freshUpdate = harness.api.updateOTP('a');

		expect(freshUpdate).not.toBe(staleUpdate);
		expect(harness.generationCalls).toHaveLength(4);

		await harness.resolvePair(2, 'fresh-current', 'fresh-next');
		await freshUpdate;
		await harness.resolvePair(0, 'stale-current', 'stale-next');
		await staleUpdate;

		expect(harness.elements['otp-a'].textContent).toBe('fresh-current');
		expect(harness.elements['next-otp-a'].textContent).toBe('fresh-next');
	});

	it('does not rescan the secrets array for every entry on a scheduler boundary', async () => {
		const entryCount = 1000;
		const harness = createHarness(Array(entryCount).fill(30));

		for (const secret of harness.secrets) {
			harness.api.startOTPInterval(secret.id, secret);
		}
		harness.secretAccessStats.reset();
		harness.state.monotonicMs = 30_000;

		await harness.runWindowScheduler();

		expect(harness.generationCalls).toHaveLength(entryCount * 2);
		expect(harness.secretAccessStats.idReads).toBeLessThanOrEqual(entryCount);
	});

	it('keeps retry deadlines independent from forward and backward wall-clock jumps', async () => {
		const harness = createHarness([30]);
		harness.api.trustedClock.establishAnchor(BASE_TIME_MS, harness.state.monotonicMs);
		const initial = harness.api.updateOTP('a');
		await harness.resolvePair(0, '111111', '222222');
		await initial;
		harness.api.startOTPInterval('a');

		harness.state.monotonicMs = 30_000;
		await harness.runWindowScheduler();
		await harness.rejectPair(2);
		harness.api.otpCalculator.clearCache();

		harness.state.wallClockAdjustmentMs = 24 * 60 * 60 * 1000;
		await harness.runWindowScheduler();
		expect(harness.generationCalls).toHaveLength(4);

		harness.state.wallClockAdjustmentMs = -24 * 60 * 60 * 1000;
		harness.state.monotonicMs += 999;
		await harness.runWindowScheduler();
		expect(harness.generationCalls).toHaveLength(4);

		harness.state.monotonicMs += 1;
		await harness.runWindowScheduler();
		expect(harness.generationCalls).toHaveLength(6);
	});

	it('holds mixed-period scheduler promotions until every candidate in the tick settles', async () => {
		const harness = createHarness([30, 60]);
		harness.state.monotonicMs = 30_000;
		const initialA = harness.api.updateOTP('a');
		const initialB = harness.api.updateOTP('b');
		await harness.resolvePair(0, '111111', '222222');
		await harness.resolvePair(2, '333333', '444444');
		await Promise.all([initialA, initialB]);
		harness.api.startOTPInterval('a');
		harness.api.startOTPInterval('b');

		harness.state.monotonicMs = 60_000;
		await harness.runWindowScheduler();
		await harness.resolvePair(4, '222222', '555555');
		expect(harness.requestAnimationFrame).not.toHaveBeenCalled();
		expect(harness.elements['otp-a'].textContent).toBe('111111');
		expect(harness.elements['next-otp-a'].textContent).toBe('222222');
		expect(harness.elements['otp-b'].textContent).toBe('333333');

		await harness.resolvePair(6, '444444', '666666');
		expect(harness.elements['otp-a'].textContent).toBe('222222');
		expect(harness.elements['next-otp-a'].textContent).toBe('555555');
		expect(harness.elements['otp-b'].textContent).toBe('444444');
		expect(harness.elements['next-otp-b'].textContent).toBe('666666');
		expect(harness.requestAnimationFrame).toHaveBeenCalledTimes(1);
	});

	it('holds clock-refresh promotions until every TOTP refresh settles', async () => {
		const harness = createHarness([30, 60]);
		harness.state.monotonicMs = 30_000;
		const initialA = harness.api.updateOTP('a');
		const initialB = harness.api.updateOTP('b');
		await harness.resolvePair(0, '111111', '222222');
		await harness.resolvePair(2, '333333', '444444');
		await Promise.all([initialA, initialB]);

		harness.state.monotonicMs = 60_000;
		harness.api.trustedClock.generation += 1;
		harness.api.refreshTOTPsAfterClockChange();
		await harness.resolvePair(4, '222222', '555555');
		expect(harness.requestAnimationFrame).not.toHaveBeenCalled();
		expect(harness.elements['otp-a'].textContent).toBe('111111');
		expect(harness.elements['next-otp-a'].textContent).toBe('222222');
		expect(harness.elements['otp-b'].textContent).toBe('333333');

		await harness.resolvePair(6, '444444', '666666');
		expect(harness.elements['otp-a'].textContent).toBe('222222');
		expect(harness.elements['next-otp-a'].textContent).toBe('555555');
		expect(harness.elements['otp-b'].textContent).toBe('444444');
		expect(harness.elements['next-otp-b'].textContent).toBe('666666');
		expect(harness.requestAnimationFrame).toHaveBeenCalledTimes(1);
	});

	it('flushes successful batch commits when another candidate fails', async () => {
		const harness = createHarness([30, 60]);
		harness.state.monotonicMs = 30_000;
		const initialA = harness.api.updateOTP('a');
		const initialB = harness.api.updateOTP('b');
		await harness.resolvePair(0, '111111', '222222');
		await harness.resolvePair(2, '333333', '444444');
		await Promise.all([initialA, initialB]);
		harness.api.startOTPInterval('a');
		harness.api.startOTPInterval('b');

		harness.state.monotonicMs = 60_000;
		await harness.runWindowScheduler();
		await harness.resolvePair(4, '222222', '555555');
		expect(harness.elements['otp-a'].textContent).toBe('111111');

		await harness.rejectPair(6);
		expect(harness.elements['otp-a'].textContent).toBe('222222');
		expect(harness.elements['otp-b'].textContent).toBe('------');
		expect(harness.requestAnimationFrame).toHaveBeenCalledTimes(1);
	});

	it('drops expired staged commits without locking the rest of the batch', async () => {
		const harness = createHarness([30, 30]);
		const initialA = harness.api.updateOTP('a');
		const initialB = harness.api.updateOTP('b');
		await harness.resolvePair(0, '111111', '222222');
		await harness.resolvePair(2, '333333', '444444');
		await Promise.all([initialA, initialB]);
		harness.api.startOTPInterval('a');
		harness.api.startOTPInterval('b');

		harness.state.monotonicMs = 30_000;
		await harness.runWindowScheduler();
		await harness.resolvePair(4, '222222', '555555');
		harness.state.monotonicMs = 60_000;
		await harness.resolvePair(6, '444444', '666666');
		expect(harness.generationCalls).toHaveLength(9);

		harness.generationCalls[8].resolve('888888');
		await flushMicrotasks();
		expect(harness.elements['otp-a'].textContent).toBe('111111');
		expect(harness.elements['otp-b'].textContent).toBe('666666');
		expect(harness.requestAnimationFrame).not.toHaveBeenCalled();
	});

	it('replaces a same-context unbatched request before it can commit early', async () => {
		const harness = createHarness([30]);
		const initial = harness.api.updateOTP('a');
		await harness.resolvePair(0, '111111', '222222');
		await initial;
		harness.api.startOTPInterval('a');

		harness.state.monotonicMs = 30_000;
		const unbatchedUpdate = harness.api.updateOTP('a');
		await harness.runWindowScheduler();
		expect(harness.generationCalls).toHaveLength(6);

		await harness.resolvePair(2, '999999', '888888');
		await unbatchedUpdate;
		expect(harness.elements['otp-a'].textContent).toBe('111111');

		await harness.resolvePair(4, '222222', '333333');
		expect(harness.elements['otp-a'].textContent).toBe('222222');
		expect(harness.requestAnimationFrame).toHaveBeenCalledTimes(1);
	});
});
