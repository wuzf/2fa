// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getAuthCode } from '../../src/ui/scripts/auth.js';
import { getCoreCode } from '../../src/ui/scripts/core.js';
import { getOTPCode } from '../../src/ui/scripts/otp.js';
import { getTimeCode } from '../../src/ui/scripts/time.js';
import { getStateCode } from '../../src/ui/scripts/state.js';

function findMatchingDelimiter(source, openingIndex, openingDelimiter, closingDelimiter) {
	let depth = 0;
	let quote = null;
	let escaped = false;
	let lineComment = false;
	let blockComment = false;

	for (let index = openingIndex; index < source.length; index += 1) {
		const character = source[index];
		const nextCharacter = source[index + 1];

		if (lineComment) {
			if (character === '\n') {
				lineComment = false;
			}
			continue;
		}

		if (blockComment) {
			if (character === '*' && nextCharacter === '/') {
				blockComment = false;
				index += 1;
			}
			continue;
		}

		if (quote) {
			if (escaped) {
				escaped = false;
			} else if (character === '\\') {
				escaped = true;
			} else if (character === quote) {
				quote = null;
			}
			continue;
		}

		if (character === '/' && nextCharacter === '/') {
			lineComment = true;
			index += 1;
			continue;
		}

		if (character === '/' && nextCharacter === '*') {
			blockComment = true;
			index += 1;
			continue;
		}

		if (character === "'" || character === '"' || character === '`') {
			quote = character;
			continue;
		}

		if (character === openingDelimiter) {
			depth += 1;
		} else if (character === closingDelimiter) {
			depth -= 1;
			if (depth === 0) {
				return index;
			}
		}
	}

	throw new Error(`Unmatched ${openingDelimiter} at index ${openingIndex}`);
}

function extractNamedFunction(source, functionName) {
	const declaration = new RegExp(`\\b(?:async\\s+)?function\\s+${functionName}\\s*\\(`).exec(source);
	if (!declaration) {
		throw new Error(`Missing generated function: ${functionName}`);
	}

	const openingParenthesis = source.indexOf('(', declaration.index);
	const closingParenthesis = findMatchingDelimiter(source, openingParenthesis, '(', ')');
	const openingBrace = source.indexOf('{', closingParenthesis);
	const closingBrace = findMatchingDelimiter(source, openingBrace, '{', '}');

	return source.slice(declaration.index, closingBrace + 1);
}

function extractEventListener(source, eventName) {
	const registrationPattern = /\bdocument\s*\.\s*addEventListener\s*\(/g;
	let registration;

	while ((registration = registrationPattern.exec(source))) {
		const openingParenthesis = source.indexOf('(', registration.index);
		const closingParenthesis = findMatchingDelimiter(source, openingParenthesis, '(', ')');
		const listenerSource = source.slice(registration.index, closingParenthesis + 1);
		if (new RegExp(`['"]${eventName}['"]`).test(listenerSource)) {
			return listenerSource;
		}
		registrationPattern.lastIndex = closingParenthesis + 1;
	}

	throw new Error(`Missing generated ${eventName} listener`);
}

const cleanupCallPattern = /\bclearAllOTPAnimations\s*\(\s*\)/;

afterEach(() => {
	document.body.replaceChildren();
	vi.useRealTimers();
});

async function animatedAccount() {
	vi.useFakeTimers();
	document.body.innerHTML = '<div><span id="otp-a"></span><span id="next-otp-a"></span><span id="progress-a"></span></div>';
	for (const id of ['otp-a', 'next-otp-a']) {
		document.getElementById(id).getBoundingClientRect = () => ({ left: 10, top: 10, width: 120, height: 30, right: 130, bottom: 40 });
	}
	const browser = {
		addEventListener() {},
		matchMedia: () => ({ matches: false }),
		requestAnimationFrame(callback) {
			callback();
			return 1;
		},
		cancelAnimationFrame() {},
	};
	// Actual emitted state, engine, presentation and auth; network and the calculation values are controlled.
	// eslint-disable-next-line no-new-func
	const api = new Function(
		'document',
		'window',
		'navigator',
		'fetch',
		'setInterval',
		'clearInterval',
		`
      let now = 0;
      function getCorrectedNowMs() { return now; }
      function getTrustedClockGeneration() { return 0; }
      function getTrustedMonotonicNowMs() { return now; }
      function t(key) { return key; }
      function getLanguage() { return 'en'; }
      function showCenterToast() {}
      ${getStateCode()}${getOTPCode()}${getAuthCode()}${getCoreCode()}
      setOTPAnimationMode('flow');
      replaceSecretRecords([{id:'a',name:'Example',secret:'JBSWY3DPEHPK3PXP',type:'TOTP',period:30,digits:6}]);
      return { accountStore, calculator:otpCalculator, refresh:()=>getOtpEngine().refresh(),
        advance:()=>{now=30000;}, active:()=>isNextOTPTransitionActive('a'),
        committed:()=>getOtpEngine().readCommitted('a'), logout, discardInvalidSecretsSnapshot,
        dispose:()=>{getOtpEngine().dispose();otpPresentation.dispose();} };
    `,
	)(
		document,
		browser,
		{ onLine: true },
		async () => ({ ok: true, headers: new Headers() }),
		vi.fn(() => 1),
		vi.fn(),
	);
	let advanced = false;
	api.calculator.calculateCurrentOTP = async () => (advanced ? '222222' : '111111');
	api.calculator.calculateNextOTP = async () => (advanced ? '333333' : '222222');
	await api.refresh();
	advanced = true;
	api.advance();
	return api;
}

describe('emitted OTP animation cleanup contracts', () => {
	it.each(['logout', 'invalid-data'])('clears active presentation through store invalidation on %s', async (reason) => {
		const api = await animatedAccount();
		try {
			await api.refresh();
			expect(api.active()).toBe(true);
			expect(document.querySelector('.otp-promotion-flyer')).not.toBeNull();
			if (reason === 'logout') {
				expect(await api.logout()).toBe(true);
			} else {
				api.discardInvalidSecretsSnapshot();
			}
			expect(api.active()).toBe(false);
			expect(document.querySelector('.otp-promotion-flyer')).toBeNull();
			expect(api.committed()).toBeNull();
			expect(api.accountStore.getRecords()).toEqual([]);
			expect(document.getElementById('otp-a').textContent).toBe('------');
		} finally {
			api.dispose();
		}
	});
	it('cleans presentation when the trusted clock changes', () => {
		const generatedFunction = extractNamedFunction(getTimeCode(), 'refreshTOTPsAfterClockChange');

		expect(generatedFunction).toMatch(cleanupCallPattern);
	});

	it('registers hidden-document cleanup without a forced offsetWidth layout read', () => {
		const otpCode = getOTPCode();
		const visibilityListener = extractEventListener(otpCode, 'visibilitychange');

		expect(visibilityListener).toContain('handleOTPVisibilityChange');
		expect(extractNamedFunction(otpCode, 'handleOTPVisibilityChange')).toMatch(cleanupCallPattern);
		expect(otpCode).not.toContain('offsetWidth');
	});
});
