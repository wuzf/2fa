import { describe, expect, it, vi } from 'vitest';

import { getOTPCode } from '../../src/ui/scripts/otp.js';
import { getTimeCode } from '../../src/ui/scripts/time.js';

const SERVER_BASE_MS = Date.UTC(2026, 0, 1);
const INITIAL_TOKEN = '111111';
const PROMOTED_TOKEN = '222222';
const NEXT_TOKEN = '333333';

function createDeferred() {
	let resolve;
	let reject;
	const promise = new Promise((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

async function flushMicrotasks() {
	for (let index = 0; index < 6; index += 1) {
		await Promise.resolve();
	}
}

function createHarness({
	nowMs = SERVER_BASE_MS,
	secretOverrides = {},
	reducedMotion = false,
	storedAnimationMode = null,
	documentHidden = false,
	currentRect = { left: 20, top: 32, width: 220, height: 46 },
	nextRect = { left: 260, top: 40, width: 70, height: 24 },
	viewportWidth = 1024,
	viewportHeight = 768,
	additionalSecretOverrides = [],
} = {}) {
	const state = {
		localEpochMs: nowMs,
		monotonicMs: 0,
	};
	const secret = {
		id: 'race',
		name: 'Race test',
		secret: 'JBSWY3DPEHPK3PXP',
		period: 30,
		type: 'TOTP',
		...secretOverrides,
	};
	const secrets = [
		secret,
		...additionalSecretOverrides.map((overrides, index) => ({
			id: `race-${index + 2}`,
			name: `Race test ${index + 2}`,
			secret: `KRSXG5DSNFXGOID${index}`,
			period: 30,
			type: 'TOTP',
			...overrides,
		})),
	];
	const domEvents = [];

	function createClassList(label) {
		const classes = new Set();
		return {
			add: vi.fn((...names) => {
				domEvents.push({ label, names, type: 'class-add' });
				names.forEach((name) => classes.add(name));
			}),
			remove: vi.fn((...names) => names.forEach((name) => classes.delete(name))),
			toggle: vi.fn((name, force) => {
				const shouldHave = force === undefined ? !classes.has(name) : force;
				if (shouldHave) {
					classes.add(name);
				} else {
					classes.delete(name);
				}
				return shouldHave;
			}),
			contains: vi.fn((name) => classes.has(name)),
			toString: () => [...classes].join(' '),
		};
	}

	function createElement(textContent, rect = null, label = 'element') {
		const normalizedRect = rect
			? {
					...rect,
					right: rect.right ?? rect.left + rect.width,
					bottom: rect.bottom ?? rect.top + rect.height,
				}
			: null;
		const parentElement = { offsetWidth: 0 };
		const attributes = new Map();
		const style = {
			setProperty: vi.fn((name, value) => {
				style[name] = value;
			}),
		};
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
				domEvents.push({ label, type: 'rect-read' });
				return normalizedRect;
			}),
			getClientRects: vi.fn(() => (normalizedRect ? [normalizedRect] : [])),
			remove: vi.fn(() => {
				if (element.parentNode && typeof element.parentNode.removeChild === 'function') {
					element.parentNode.removeChild(element);
				}
			}),
		};
		return element;
	}

	const elements = {};
	secrets.forEach(({ id }) => {
		elements[`next-otp-${id}`] = createElement('next-initial', nextRect, `next-otp-${id}`);
		elements[`otp-${id}`] = createElement('current-initial', currentRect, `otp-${id}`);
	});
	const createdElements = [];
	const body = {
		children: [],
		appendChild: vi.fn((element) => {
			domEvents.push({ label: element.tagName ?? 'element', type: 'append' });
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
	const timeoutCallbacks = new Map();
	let nextTimeoutId = 0;
	const setTimeout = vi.fn((callback, delay) => {
		const id = ++nextTimeoutId;
		timeoutCallbacks.set(id, { callback, delay });
		return id;
	});
	const clearTimeout = vi.fn((id) => {
		timeoutCallbacks.delete(id);
	});
	const animationFrameCallbacks = new Map();
	let nextAnimationFrameId = 0;
	const requestAnimationFrame = vi.fn((callback) => {
		const id = ++nextAnimationFrameId;
		animationFrameCallbacks.set(id, callback);
		return id;
	});
	const cancelAnimationFrame = vi.fn((id) => {
		animationFrameCallbacks.delete(id);
	});

	function FakeDate(...args) {
		return new Date(...(args.length > 0 ? args : [FakeDate.now()]));
	}
	FakeDate.now = () => state.localEpochMs + state.monotonicMs;
	FakeDate.UTC = Date.UTC;
	FakeDate.parse = Date.parse;

	const performance = {
		now: () => state.monotonicMs,
	};
	const documentEventListeners = new Map();
	const document = {
		hidden: documentHidden,
		visibilityState: documentHidden ? 'hidden' : 'visible',
		documentElement: {
			clientHeight: viewportHeight,
			clientWidth: viewportWidth,
		},
		body,
		addEventListener: vi.fn((type, listener) => {
			const listeners = documentEventListeners.get(type) ?? new Set();
			listeners.add(listener);
			documentEventListeners.set(type, listeners);
		}),
		getElementById: vi.fn((id) => elements[id] ?? null),
		createElement: vi.fn((tagName) => {
			const element = createElement('', null, `created-${createdElements.length}`);
			element.tagName = String(tagName).toUpperCase();
			createdElements.push(element);
			return element;
		}),
	};
	const localStorage = {
		getItem: vi.fn((key) => (key === '2fa-otp-animation' ? storedAnimationMode : null)),
		removeItem: vi.fn(),
		setItem: vi.fn(),
	};
	const silentConsole = {
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	};
	const window = {
		addEventListener: vi.fn(),
		cancelAnimationFrame,
		crypto: globalThis.crypto,
		innerHeight: viewportHeight,
		innerWidth: viewportWidth,
		matchMedia: vi.fn(() => ({ matches: reducedMotion })),
		requestAnimationFrame,
		setInterval: vi.fn(),
	};

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
		'console',
		'secrets',
		'otpIntervals',
		`${getTimeCode()}${getOTPCode()}; return {
			trustedClock,
			otpCalculator,
			getOTPAnimationMode,
			isNextOTPTransitionActive,
			setOTPAnimationMode,
			updateOTP
		};`,
	)(
		FakeDate,
		performance,
		vi.fn(),
		localStorage,
		{ onLine: true },
		document,
		window,
		setTimeout,
		clearTimeout,
		vi.fn(),
		vi.fn(),
		AbortController,
		requestAnimationFrame,
		cancelAnimationFrame,
		silentConsole,
		secrets,
		{},
	);

	const generationCalls = [];
	api.otpCalculator.generateTOTP = vi.fn((generatedSecret, counter) => {
		const deferred = createDeferred();
		generationCalls.push({ counter, secret: generatedSecret, ...deferred });
		return deferred.promise;
	});

	async function runTimeouts() {
		const callbacks = [...timeoutCallbacks.entries()];
		for (const [id, { callback }] of callbacks) {
			if (!timeoutCallbacks.has(id)) {
				continue;
			}
			timeoutCallbacks.delete(id);
			callback();
			await Promise.resolve();
		}
	}

	async function flushAnimationFrames() {
		for (let frame = 0; frame < 10 && animationFrameCallbacks.size > 0; frame += 1) {
			const callbacks = [...animationFrameCallbacks.entries()];
			for (const [id, callback] of callbacks) {
				if (!animationFrameCallbacks.has(id)) {
					continue;
				}
				animationFrameCallbacks.delete(id);
				callback(state.monotonicMs);
			}
			await flushMicrotasks();
		}
	}

	async function dispatchDocumentEvent(type) {
		for (const listener of documentEventListeners.get(type) ?? []) {
			listener({ type });
			await flushMicrotasks();
		}
	}

	return {
		api,
		animationFrameCallbacks,
		body,
		cancelAnimationFrame,
		clearTimeout,
		createdElements,
		document,
		dispatchDocumentEvent,
		domEvents,
		elements,
		generationCalls,
		flushAnimationFrames,
		localStorage,
		requestAnimationFrame,
		runTimeouts,
		setTimeout,
		state,
		timeoutCallbacks,
		window,
	};
}

async function resolveGenerationPair(harness, currentToken, nextToken, startIndex = 0) {
	harness.generationCalls[startIndex].resolve(currentToken);
	harness.generationCalls[startIndex + 1].resolve(nextToken);
	await flushMicrotasks();
}

async function advanceOneWindow(harness) {
	const initialUpdate = harness.api.updateOTP('race');
	await resolveGenerationPair(harness, INITIAL_TOKEN, PROMOTED_TOKEN);
	await initialUpdate;

	harness.state.monotonicMs += 30_000;
	const promotedUpdate = harness.api.updateOTP('race');
	await resolveGenerationPair(harness, PROMOTED_TOKEN, NEXT_TOKEN, 2);
	await promotedUpdate;
	await harness.flushAnimationFrames();
}

function getAnimationAdds(harness, elementId) {
	return harness.elements[elementId].classList.add.mock.calls.flat();
}

describe('OTP asynchronous result races', () => {
	it('does not let a pre-sync WebCrypto result overwrite the synchronized DOM', async () => {
		const harness = createHarness({ storedAnimationMode: 'flow' });
		const initialWindow = harness.api.otpCalculator.getCurrentTimeWindow(30);
		const initialGeneration = harness.api.trustedClock.generation;

		const staleUpdate = harness.api.updateOTP('race');
		expect(harness.generationCalls.map((call) => call.counter)).toEqual([initialWindow, initialWindow + 1]);

		harness.api.trustedClock.establishAnchor(SERVER_BASE_MS + 30_000, harness.state.monotonicMs);
		harness.api.trustedClock.generation += 1;
		expect(harness.api.trustedClock.generation).toBe(initialGeneration + 1);

		const synchronizedUpdate = harness.api.updateOTP('race');
		expect(harness.generationCalls.map((call) => call.counter)).toEqual([
			initialWindow,
			initialWindow + 1,
			initialWindow + 1,
			initialWindow + 2,
		]);

		harness.generationCalls[2].resolve('fresh-current');
		harness.generationCalls[3].resolve('fresh-next');
		await synchronizedUpdate;
		expect(harness.elements['otp-race'].textContent).toBe('fresh-current');
		expect(harness.elements['next-otp-race'].textContent).toBe('fresh-next');

		harness.generationCalls[0].resolve('stale-current');
		// The old "next" calculation targets the new current window and is deterministic.
		harness.generationCalls[1].resolve('fresh-current');
		await staleUpdate;

		expect(harness.elements['otp-race'].textContent).toBe('fresh-current');
		expect(harness.elements['next-otp-race'].textContent).toBe('fresh-next');
		expect(getAnimationAdds(harness, 'otp-race')).toEqual([]);
		expect(getAnimationAdds(harness, 'next-otp-race')).toEqual([]);
	});

	it('keeps the first render and same-window refresh animation-free', async () => {
		const harness = createHarness({ storedAnimationMode: 'flow' });
		const firstUpdate = harness.api.updateOTP('race');

		expect(harness.generationCalls).toHaveLength(2);
		await resolveGenerationPair(harness, 'current-0', 'next-0');
		await firstUpdate;

		expect(harness.elements['otp-race'].textContent).toBe('current-0');
		expect(harness.elements['next-otp-race'].textContent).toBe('next-0');
		expect(getAnimationAdds(harness, 'otp-race')).toEqual([]);
		expect(getAnimationAdds(harness, 'next-otp-race')).toEqual([]);
		expect(harness.setTimeout).not.toHaveBeenCalled();
		expect(harness.document.createElement).not.toHaveBeenCalled();
		expect(harness.body.children).toHaveLength(0);

		await harness.api.updateOTP('race');

		expect(getAnimationAdds(harness, 'otp-race')).toEqual([]);
		expect(getAnimationAdds(harness, 'next-otp-race')).toEqual([]);
		expect(harness.setTimeout).not.toHaveBeenCalled();
		expect(harness.document.createElement).not.toHaveBeenCalled();
		expect(harness.body.children).toHaveLength(0);
	});

	it.each([
		['flow', 'otp-promote-current', 'otp-promote-next', 'otp-promotion-flyer-active', 420, true],
		['flip', 'otp-promote-flip-current', 'otp-promote-flip-next', 'otp-promotion-flyer-flip', 520, false],
		['spotlight', 'otp-promote-spotlight-current', 'otp-promote-spotlight-next', 'otp-promotion-flyer-spotlight', 460, false],
	])(
		'uses the %s handoff to promote the previous next code into current',
		async (mode, currentClass, nextClass, flyerClass, duration, usesTravelPath) => {
			const harness = createHarness({ storedAnimationMode: mode });

			expect(harness.api.getOTPAnimationMode()).toBe(mode);
			await advanceOneWindow(harness);

			const currentElement = harness.elements['otp-race'];
			const nextElement = harness.elements['next-otp-race'];
			expect(harness.api.isNextOTPTransitionActive('race')).toBe(true);
			expect(currentElement.textContent).toBe(PROMOTED_TOKEN);
			expect(nextElement.textContent).toBe(NEXT_TOKEN);
			expect(currentElement.textContent).not.toBe(nextElement.textContent);
			expect(getAnimationAdds(harness, 'otp-race')).toEqual([currentClass]);
			expect(getAnimationAdds(harness, 'next-otp-race')).toEqual([nextClass]);
			expect(harness.setTimeout).toHaveBeenCalledTimes(1);
			expect(harness.setTimeout).toHaveBeenCalledWith(expect.any(Function), duration);

			// The transient copy proves that the previous right-side code becomes current.
			expect(harness.document.createElement).toHaveBeenCalledWith('span');
			expect(harness.body.appendChild).toHaveBeenCalledTimes(1);
			expect(harness.body.children).toHaveLength(1);
			const flyer = harness.body.children[0];
			expect(flyer.tagName).toBe('SPAN');
			expect(flyer.className).toBe('otp-promotion-flyer');
			expect(flyer.textContent).toBe(currentElement.textContent);
			expect(flyer.textContent).not.toBe(nextElement.textContent);
			expect(flyer.getAttribute('aria-hidden')).toBe('true');
			expect(flyer.classList.contains(flyerClass)).toBe(true);
			expect(flyer.style.left).toBe('295px');
			expect(flyer.style.top).toBe('52px');
			expect(flyer.style.position).toBe('fixed');
			expect(flyer.style.pointerEvents).toBe('none');
			expect(flyer.style.userSelect).toBe('none');
			if (usesTravelPath) {
				expect(flyer.style['--otp-fly-x']).toBe('-165px');
				expect(flyer.style['--otp-fly-y']).toBe('3px');
				expect(flyer.style['--otp-fly-start-scale']).toBe('0.35');
			} else {
				// Flip and spotlight stay at the source slot and apply their effect in place.
				expect(flyer.style['--otp-fly-x']).toBeUndefined();
				expect(flyer.style['--otp-fly-y']).toBeUndefined();
				expect(flyer.style['--otp-fly-start-scale']).toBeUndefined();
			}

			// A refresh with the same window and tokens must not replay or interrupt the handoff.
			await harness.api.updateOTP('race');
			expect(getAnimationAdds(harness, 'otp-race')).toEqual([currentClass]);
			expect(getAnimationAdds(harness, 'next-otp-race')).toEqual([nextClass]);
			expect(harness.document.createElement).toHaveBeenCalledTimes(1);
			expect(harness.body.children).toHaveLength(1);

			await harness.runTimeouts();
			expect(harness.api.isNextOTPTransitionActive('race')).toBe(false);
			expect(currentElement.classList.contains(currentClass)).toBe(false);
			expect(nextElement.classList.contains(nextClass)).toBe(false);
			expect(currentElement.classList.remove).toHaveBeenCalledWith(currentClass);
			expect(nextElement.classList.remove).toHaveBeenCalledWith(nextClass);
			expect(harness.clearTimeout).toHaveBeenCalledTimes(1);
			expect(harness.timeoutCallbacks.size).toBe(0);
			expect(flyer.remove).toHaveBeenCalledTimes(1);
			expect(harness.body.children).toHaveLength(0);
		},
	);

	it.each([
		[null, 'the default preference'],
		['none', 'an explicit preference'],
	])('disables promotion effects entirely for %s (%s)', async (storedAnimationMode) => {
		const harness = createHarness({ storedAnimationMode });

		expect(harness.api.getOTPAnimationMode()).toBe('none');
		await advanceOneWindow(harness);

		expect(getAnimationAdds(harness, 'otp-race')).toEqual([]);
		expect(getAnimationAdds(harness, 'next-otp-race')).toEqual([]);
		expect(harness.elements['otp-race'].classList.remove).not.toHaveBeenCalled();
		expect(harness.elements['next-otp-race'].classList.remove).not.toHaveBeenCalled();
		expect(harness.setTimeout).not.toHaveBeenCalled();
		expect(harness.document.createElement).not.toHaveBeenCalled();
		expect(harness.body.children).toHaveLength(0);
	});

	it('cleans up an active flow animation immediately when the mode changes to none', async () => {
		const harness = createHarness({ storedAnimationMode: 'flow' });
		await advanceOneWindow(harness);

		expect(harness.elements['otp-race'].classList.contains('otp-promote-current')).toBe(true);
		expect(harness.elements['next-otp-race'].classList.contains('otp-promote-next')).toBe(true);
		expect(harness.timeoutCallbacks.size).toBe(1);
		expect(harness.body.children).toHaveLength(1);
		const flyer = harness.body.children[0];

		expect(harness.api.setOTPAnimationMode('none')).toBe('none');

		expect(harness.api.isNextOTPTransitionActive('race')).toBe(false);
		expect(harness.elements['otp-race'].classList.contains('otp-promote-current')).toBe(false);
		expect(harness.elements['next-otp-race'].classList.contains('otp-promote-next')).toBe(false);
		expect(harness.clearTimeout).toHaveBeenCalledTimes(1);
		expect(harness.timeoutCallbacks.size).toBe(0);
		expect(flyer.remove).toHaveBeenCalledTimes(1);
		expect(harness.body.children).toHaveLength(0);
	});

	it('falls back invalid preferences to none and persists mode changes through the public API', async () => {
		const harness = createHarness({ storedAnimationMode: 'spin' });

		expect(harness.localStorage.getItem).toHaveBeenCalledWith('2fa-otp-animation');
		expect(harness.api.getOTPAnimationMode()).toBe('none');
		expect(harness.api.setOTPAnimationMode('flip')).toBe('flip');
		expect(harness.api.getOTPAnimationMode()).toBe('flip');
		expect(harness.localStorage.setItem).toHaveBeenLastCalledWith('2fa-otp-animation', 'flip');

		expect(harness.api.setOTPAnimationMode('unknown')).toBe('none');
		expect(harness.api.getOTPAnimationMode()).toBe('none');
		expect(harness.localStorage.setItem).toHaveBeenLastCalledWith('2fa-otp-animation', 'none');
	});

	it('normalizes the legacy fade preference to spotlight', () => {
		const harness = createHarness({ storedAnimationMode: 'fade' });

		expect(harness.api.getOTPAnimationMode()).toBe('spotlight');
		expect(harness.api.setOTPAnimationMode('fade')).toBe('spotlight');
		expect(harness.api.getOTPAnimationMode()).toBe('spotlight');
		expect(harness.localStorage.setItem).toHaveBeenLastCalledWith('2fa-otp-animation', 'spotlight');
	});

	it('keeps the code update safe and skips the traveler when reduced motion is preferred', async () => {
		const harness = createHarness({ reducedMotion: true, storedAnimationMode: 'flow' });
		const initialUpdate = harness.api.updateOTP('race');
		await resolveGenerationPair(harness, INITIAL_TOKEN, PROMOTED_TOKEN);
		await initialUpdate;

		harness.state.monotonicMs += 30_000;
		const promotedUpdate = harness.api.updateOTP('race');
		await resolveGenerationPair(harness, PROMOTED_TOKEN, NEXT_TOKEN, 2);
		await expect(promotedUpdate).resolves.toBeUndefined();
		await harness.flushAnimationFrames();

		expect(harness.elements['otp-race'].textContent).toBe(PROMOTED_TOKEN);
		expect(harness.elements['next-otp-race'].textContent).toBe(NEXT_TOKEN);
		expect(getAnimationAdds(harness, 'otp-race')).toEqual([]);
		expect(getAnimationAdds(harness, 'next-otp-race')).toEqual([]);
		expect(harness.setTimeout).not.toHaveBeenCalled();
		expect(harness.document.createElement).not.toHaveBeenCalled();
		expect(harness.body.children).toHaveLength(0);
		expect(harness.window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
	});

	it('does not treat eight-digit fallback placeholders as a successful promotion', async () => {
		const harness = createHarness({
			secretOverrides: { digits: 8 },
			storedAnimationMode: 'flow',
		});
		const firstUpdate = harness.api.updateOTP('race');
		await resolveGenerationPair(harness, '--------', '--------');
		await firstUpdate;

		harness.state.monotonicMs += 30_000;
		const fallbackUpdate = harness.api.updateOTP('race');
		await resolveGenerationPair(harness, '--------', '--------', 2);
		await fallbackUpdate;

		expect(harness.elements['otp-race'].textContent).toBe('--------');
		expect(harness.elements['next-otp-race'].textContent).toBe('--------');
		expect(getAnimationAdds(harness, 'otp-race')).toEqual([]);
		expect(getAnimationAdds(harness, 'next-otp-race')).toEqual([]);
		expect(harness.setTimeout).not.toHaveBeenCalled();
		expect(harness.document.createElement).not.toHaveBeenCalled();
		expect(harness.body.children).toHaveLength(0);
	});

	it('cleans up an active animation when the document becomes hidden', async () => {
		const harness = createHarness({ storedAnimationMode: 'flow' });
		await advanceOneWindow(harness);

		const flyer = harness.body.children[0];
		expect(harness.elements['otp-race'].classList.contains('otp-promote-current')).toBe(true);
		expect(harness.timeoutCallbacks.size).toBe(1);

		harness.document.hidden = true;
		harness.document.visibilityState = 'hidden';
		await harness.dispatchDocumentEvent('visibilitychange');

		expect(harness.api.isNextOTPTransitionActive('race')).toBe(false);
		expect(harness.elements['otp-race'].classList.contains('otp-promote-current')).toBe(false);
		expect(harness.elements['next-otp-race'].classList.contains('otp-promote-next')).toBe(false);
		expect(harness.clearTimeout).toHaveBeenCalledTimes(1);
		expect(harness.timeoutCallbacks.size).toBe(0);
		expect(flyer.remove).toHaveBeenCalledTimes(1);
		expect(harness.body.children).toHaveLength(0);
	});

	it('clears transition state when the promotion flyer cannot be created', async () => {
		const harness = createHarness({ storedAnimationMode: 'flow' });
		const initialUpdate = harness.api.updateOTP('race');
		await resolveGenerationPair(harness, INITIAL_TOKEN, PROMOTED_TOKEN);
		await initialUpdate;

		harness.document.createElement.mockImplementationOnce(() => {
			throw new Error('simulated flyer creation failure');
		});
		harness.state.monotonicMs += 30_000;
		const promotedUpdate = harness.api.updateOTP('race');
		await resolveGenerationPair(harness, PROMOTED_TOKEN, NEXT_TOKEN, 2);
		await promotedUpdate;
		await harness.flushAnimationFrames();

		expect(harness.api.isNextOTPTransitionActive('race')).toBe(false);
		expect(harness.body.children).toHaveLength(0);
		expect(harness.timeoutCallbacks.size).toBe(0);
	});

	it('does not queue a promotion when the document becomes hidden during OTP calculation', async () => {
		const harness = createHarness({ storedAnimationMode: 'flow' });
		const initialUpdate = harness.api.updateOTP('race');
		await resolveGenerationPair(harness, INITIAL_TOKEN, PROMOTED_TOKEN);
		await initialUpdate;

		harness.state.monotonicMs += 30_000;
		const promotedUpdate = harness.api.updateOTP('race');
		harness.document.hidden = true;
		harness.document.visibilityState = 'hidden';
		await harness.dispatchDocumentEvent('visibilitychange');
		await resolveGenerationPair(harness, PROMOTED_TOKEN, NEXT_TOKEN, 2);
		await promotedUpdate;

		expect(harness.elements['otp-race'].textContent).toBe(PROMOTED_TOKEN);
		expect(harness.elements['next-otp-race'].textContent).toBe(NEXT_TOKEN);
		expect(harness.requestAnimationFrame).not.toHaveBeenCalled();
		expect(harness.document.createElement).not.toHaveBeenCalled();
		expect(harness.setTimeout).not.toHaveBeenCalled();
		expect(harness.body.children).toHaveLength(0);
	});

	it.each([
		['the document is hidden', { documentHidden: true }, 0],
		[
			'the OTP card is outside the viewport',
			{
				currentRect: { left: 1200, top: 32, width: 220, height: 46 },
				nextRect: { left: 1440, top: 40, width: 70, height: 24 },
			},
			1,
		],
	])('does not create promotion effects when %s', async (_label, visibilityOverrides, scheduledFrames) => {
		const harness = createHarness({ storedAnimationMode: 'flow', ...visibilityOverrides });
		await advanceOneWindow(harness);

		expect(harness.elements['otp-race'].textContent).toBe(PROMOTED_TOKEN);
		expect(harness.elements['next-otp-race'].textContent).toBe(NEXT_TOKEN);
		expect(getAnimationAdds(harness, 'otp-race')).toEqual([]);
		expect(getAnimationAdds(harness, 'next-otp-race')).toEqual([]);
		expect(harness.setTimeout).not.toHaveBeenCalled();
		expect(harness.document.createElement).not.toHaveBeenCalled();
		expect(harness.requestAnimationFrame).toHaveBeenCalledTimes(scheduledFrames);
		expect(harness.body.children).toHaveLength(0);
	});

	it('batches simultaneous promotion candidates into one animation frame', async () => {
		const harness = createHarness({
			additionalSecretOverrides: [{ id: 'second', name: 'Second race', secret: 'MZXW6YTBOI======' }],
			storedAnimationMode: 'flow',
		});
		const initialUpdates = [harness.api.updateOTP('race'), harness.api.updateOTP('second')];
		harness.generationCalls[0].resolve(INITIAL_TOKEN);
		harness.generationCalls[1].resolve(PROMOTED_TOKEN);
		harness.generationCalls[2].resolve('444444');
		harness.generationCalls[3].resolve('555555');
		await Promise.all(initialUpdates);

		harness.state.monotonicMs += 30_000;
		const promotedUpdates = [harness.api.updateOTP('race'), harness.api.updateOTP('second')];
		harness.generationCalls[4].resolve(PROMOTED_TOKEN);
		harness.generationCalls[5].resolve(NEXT_TOKEN);
		harness.generationCalls[6].resolve('555555');
		harness.generationCalls[7].resolve('666666');
		await Promise.all(promotedUpdates);

		expect(harness.requestAnimationFrame).toHaveBeenCalledTimes(1);
		expect(harness.animationFrameCallbacks.size).toBe(1);
		expect(harness.document.createElement).not.toHaveBeenCalled();
		expect(getAnimationAdds(harness, 'otp-race')).toEqual([]);
		expect(getAnimationAdds(harness, 'otp-second')).toEqual([]);

		harness.domEvents.length = 0;
		await harness.flushAnimationFrames();

		expect(harness.requestAnimationFrame).toHaveBeenCalledTimes(1);
		expect(harness.animationFrameCallbacks.size).toBe(0);
		expect(harness.body.children).toHaveLength(2);
		expect(harness.setTimeout).toHaveBeenCalledTimes(2);
		expect(getAnimationAdds(harness, 'otp-race')).toEqual(['otp-promote-current']);
		expect(getAnimationAdds(harness, 'otp-second')).toEqual(['otp-promote-current']);
		const firstWriteIndex = harness.domEvents.findIndex(({ type }) => type === 'append' || type === 'class-add');
		const lastReadIndex = harness.domEvents.findLastIndex(({ type }) => type === 'rect-read');
		expect(lastReadIndex).toBeGreaterThanOrEqual(3);
		expect(firstWriteIndex).toBeGreaterThan(lastReadIndex);

		await harness.runTimeouts();
		expect(harness.body.children).toHaveLength(0);
	});

	it('cancels a queued promotion when a later refresh skips multiple windows', async () => {
		const harness = createHarness({ storedAnimationMode: 'flow' });
		const initialUpdate = harness.api.updateOTP('race');
		await resolveGenerationPair(harness, INITIAL_TOKEN, PROMOTED_TOKEN);
		await initialUpdate;

		harness.state.monotonicMs += 30_000;
		const promotedUpdate = harness.api.updateOTP('race');
		await resolveGenerationPair(harness, PROMOTED_TOKEN, NEXT_TOKEN, 2);
		await promotedUpdate;
		expect(harness.requestAnimationFrame).toHaveBeenCalledTimes(1);
		expect(harness.document.createElement).not.toHaveBeenCalled();

		harness.state.monotonicMs += 60_000;
		const skippedUpdate = harness.api.updateOTP('race');
		await resolveGenerationPair(harness, '444444', '555555', 4);
		await skippedUpdate;
		await harness.flushAnimationFrames();

		expect(harness.elements['otp-race'].textContent).toBe('444444');
		expect(harness.elements['next-otp-race'].textContent).toBe('555555');
		expect(getAnimationAdds(harness, 'otp-race')).toEqual([]);
		expect(getAnimationAdds(harness, 'next-otp-race')).toEqual([]);
		expect(harness.document.createElement).not.toHaveBeenCalled();
		expect(harness.setTimeout).not.toHaveBeenCalled();
		expect(harness.animationFrameCallbacks.size).toBe(0);
		expect(harness.body.children).toHaveLength(0);
	});

	it('does not animate when the result skips more than one time window', async () => {
		const harness = createHarness({ storedAnimationMode: 'flow' });
		const initialUpdate = harness.api.updateOTP('race');
		await resolveGenerationPair(harness, 'current-0', 'next-0');
		await initialUpdate;

		harness.state.monotonicMs += 60_000;
		const skippedUpdate = harness.api.updateOTP('race');
		await resolveGenerationPair(harness, 'current-2', 'next-2', 2);
		await skippedUpdate;

		expect(harness.elements['otp-race'].textContent).toBe('current-2');
		expect(harness.elements['next-otp-race'].textContent).toBe('next-2');
		expect(getAnimationAdds(harness, 'otp-race')).toEqual([]);
		expect(getAnimationAdds(harness, 'next-otp-race')).toEqual([]);
		expect(harness.setTimeout).not.toHaveBeenCalled();
		expect(harness.document.createElement).not.toHaveBeenCalled();
		expect(harness.body.children).toHaveLength(0);
	});

	it('cleans up an active animation when a refresh skips multiple time windows', async () => {
		const harness = createHarness({ storedAnimationMode: 'flow' });
		await advanceOneWindow(harness);

		const currentElement = harness.elements['otp-race'];
		const nextElement = harness.elements['next-otp-race'];
		const flyer = harness.body.children[0];
		expect(currentElement.classList.contains('otp-promote-current')).toBe(true);
		expect(nextElement.classList.contains('otp-promote-next')).toBe(true);
		expect(harness.timeoutCallbacks.size).toBe(1);
		expect(flyer).toBeDefined();

		harness.state.monotonicMs += 60_000;
		const skippedUpdate = harness.api.updateOTP('race');
		await resolveGenerationPair(harness, '444444', '555555', 4);
		await skippedUpdate;

		expect(currentElement.textContent).toBe('444444');
		expect(nextElement.textContent).toBe('555555');
		expect(currentElement.classList.contains('otp-promote-current')).toBe(false);
		expect(nextElement.classList.contains('otp-promote-next')).toBe(false);
		expect(harness.clearTimeout).toHaveBeenCalledTimes(1);
		expect(harness.timeoutCallbacks.size).toBe(0);
		expect(flyer.remove).toHaveBeenCalledTimes(1);
		expect(harness.body.children).toHaveLength(0);
	});

	it('cleans up an active animation when same-window tokens are replaced', async () => {
		const harness = createHarness({ storedAnimationMode: 'flow' });
		await advanceOneWindow(harness);

		const currentElement = harness.elements['otp-race'];
		const nextElement = harness.elements['next-otp-race'];
		const flyer = harness.body.children[0];
		expect(currentElement.classList.contains('otp-promote-current')).toBe(true);
		expect(harness.timeoutCallbacks.size).toBe(1);

		harness.api.otpCalculator.cache.clear();
		const replacementUpdate = harness.api.updateOTP('race');
		await resolveGenerationPair(harness, '777777', '888888', 4);
		await replacementUpdate;

		expect(currentElement.textContent).toBe('777777');
		expect(nextElement.textContent).toBe('888888');
		expect(currentElement.classList.contains('otp-promote-current')).toBe(false);
		expect(nextElement.classList.contains('otp-promote-next')).toBe(false);
		expect(harness.clearTimeout).toHaveBeenCalledTimes(1);
		expect(harness.timeoutCallbacks.size).toBe(0);
		expect(flyer.remove).toHaveBeenCalledTimes(1);
		expect(harness.body.children).toHaveLength(0);
	});

	it('ignores an obsolete asynchronous window result without replaying the animation', async () => {
		const harness = createHarness({ storedAnimationMode: 'flow' });
		const initialUpdate = harness.api.updateOTP('race');
		await resolveGenerationPair(harness, INITIAL_TOKEN, PROMOTED_TOKEN);
		await initialUpdate;

		harness.state.monotonicMs += 30_000;
		const staleUpdate = harness.api.updateOTP('race');
		harness.api.trustedClock.generation += 1;
		const freshUpdate = harness.api.updateOTP('race');
		expect(harness.generationCalls).toHaveLength(6);

		await resolveGenerationPair(harness, PROMOTED_TOKEN, NEXT_TOKEN, 4);
		await freshUpdate;
		await harness.flushAnimationFrames();
		expect(getAnimationAdds(harness, 'otp-race')).toEqual(['otp-promote-current']);
		expect(getAnimationAdds(harness, 'next-otp-race')).toEqual(['otp-promote-next']);

		await resolveGenerationPair(harness, 'stale-current', 'stale-next', 2);
		await staleUpdate;

		expect(harness.elements['otp-race'].textContent).toBe(PROMOTED_TOKEN);
		expect(harness.elements['next-otp-race'].textContent).toBe(NEXT_TOKEN);
		expect(getAnimationAdds(harness, 'otp-race')).toEqual(['otp-promote-current']);
		expect(getAnimationAdds(harness, 'next-otp-race')).toEqual(['otp-promote-next']);
	});

	it('keeps HOTP updates safe and animation-free', async () => {
		const harness = createHarness({ secretOverrides: { type: 'HOTP' }, storedAnimationMode: 'flow' });
		const firstUpdate = harness.api.updateOTP('race');
		await resolveGenerationPair(harness, 'hotp-current-0', 'hotp-next');
		await firstUpdate;

		harness.state.monotonicMs += 30_000;
		const secondUpdate = harness.api.updateOTP('race');
		await resolveGenerationPair(harness, 'hotp-next', 'hotp-next-1', 2);
		await expect(secondUpdate).resolves.toBeUndefined();

		expect(harness.elements['otp-race'].textContent).toBe('hotp-next');
		expect(harness.elements['next-otp-race'].textContent).toBe('hotp-next-1');
		expect(getAnimationAdds(harness, 'otp-race')).toEqual([]);
		expect(getAnimationAdds(harness, 'next-otp-race')).toEqual([]);
		expect(harness.setTimeout).not.toHaveBeenCalled();
		expect(harness.document.createElement).not.toHaveBeenCalled();
		expect(harness.body.children).toHaveLength(0);
	});

	it('recalculates instead of committing results when the time window changes during await', async () => {
		const windowStartMs = Math.floor(SERVER_BASE_MS / 30_000) * 30_000;
		const harness = createHarness({ nowMs: windowStartMs + 29_900, storedAnimationMode: 'flow' });
		const initialWindow = harness.api.otpCalculator.getCurrentTimeWindow(30);

		const update = harness.api.updateOTP('race');
		expect(harness.generationCalls.map((call) => call.counter)).toEqual([initialWindow, initialWindow + 1]);

		harness.state.monotonicMs += 200;
		harness.generationCalls[0].resolve('expired-current');
		harness.generationCalls[1].resolve('new-current');
		await flushMicrotasks();

		expect(harness.elements['otp-race'].textContent).toBe('current-initial');
		expect(harness.elements['next-otp-race'].textContent).toBe('next-initial');
		expect(harness.generationCalls.map((call) => call.counter)).toEqual([initialWindow, initialWindow + 1, initialWindow + 2]);

		harness.generationCalls[2].resolve('new-next');
		await update;
		await flushMicrotasks();

		expect(harness.elements['otp-race'].textContent).toBe('new-current');
		expect(harness.elements['next-otp-race'].textContent).toBe('new-next');
	});
});
