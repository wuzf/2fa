import { describe, expect, it } from 'vitest';

import { getAuthCode } from '../../src/ui/scripts/auth.js';
import { getCoreCode } from '../../src/ui/scripts/core.js';
import { getOTPCode } from '../../src/ui/scripts/otp.js';
import { getTimeCode } from '../../src/ui/scripts/time.js';

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

describe('emitted OTP animation cleanup contracts', () => {
	it.each([
		['getCoreCode', getCoreCode, 'renderFilteredSecrets'],
		['getAuthCode', getAuthCode, 'logout'],
		['getTimeCode', getTimeCode, 'refreshTOTPsAfterClockChange'],
	])('%s cleans animations in %s', (_generatorName, generateCode, functionName) => {
		const generatedFunction = extractNamedFunction(generateCode(), functionName);

		expect(generatedFunction).toMatch(cleanupCallPattern);
	});

	it('registers hidden-document cleanup without a forced offsetWidth layout read', () => {
		const otpCode = getOTPCode();
		const visibilityListener = extractEventListener(otpCode, 'visibilitychange');

		expect(visibilityListener).toMatch(cleanupCallPattern);
		expect(otpCode).not.toContain('offsetWidth');
	});
});
