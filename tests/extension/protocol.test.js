import { describe, expect, it } from 'vitest';

import {
	accountMetadataMatches,
	createNonce,
	isValidNonce,
	sanitizeAccountList,
	sanitizeAccountMetadata,
} from '../../extension/src/shared/protocol.js';

const ACCOUNT = Object.freeze({
	id: 'account-1',
	name: 'GitHub',
	account: 'person@example.com',
	type: 'TOTP',
	digits: 6,
});

describe('extension account metadata protocol', () => {
	it('returns only explicitly allowed metadata fields', () => {
		const sanitized = sanitizeAccountMetadata({
			...ACCOUNT,
			secret: 'JBSWY3DPEHPK3PXP',
			algorithm: 'SHA1',
			period: 30,
			counter: 10,
			unexpected: { nested: true },
		});

		expect(sanitized).toEqual(ACCOUNT);
		expect(Object.keys(sanitized)).toEqual(['id', 'name', 'account', 'type', 'digits']);
		expect(sanitized).not.toHaveProperty('secret');
		expect(Object.isFrozen(sanitized)).toBe(true);
	});

	it('allows a bounded display group name while continuing to strip private fields', () => {
		const metadata = { ...ACCOUNT, searchFamily: 'Google' };
		expect(sanitizeAccountMetadata({ ...metadata, secret: 'private', period: 30 })).toEqual(metadata);
		expect(sanitizeAccountMetadata({ ...ACCOUNT, searchFamily: 'x'.repeat(200) })).not.toBeNull();
		expect(sanitizeAccountList([metadata])).toEqual([metadata]);
	});

	it.each([undefined, null, 42, {}, [], '', '   ', 'x'.repeat(201)])(
		'rejects an invalid supplied display group name: %s',
		(searchFamily) => {
			expect(sanitizeAccountMetadata({ ...ACCOUNT, searchFamily })).toBeNull();
			expect(sanitizeAccountList([{ ...ACCOUNT, searchFamily }])).toBeNull();
		},
	);

	it('ignores display group changes when comparing the selected account identity', () => {
		expect(accountMetadataMatches(ACCOUNT, { ...ACCOUNT, searchFamily: '其他服务', searchFamilyKind: 'other' })).toBe(true);
		expect(accountMetadataMatches(ACCOUNT, { ...ACCOUNT, searchFamily: 'GitHub' })).toBe(true);
		expect(accountMetadataMatches({ ...ACCOUNT, searchFamily: 'GitHub' }, { ...ACCOUNT, searchFamily: '其他服务' })).toBe(true);
		expect(accountMetadataMatches({ ...ACCOUNT, searchFamily: 'GitHub' }, { ...ACCOUNT, name: 'GitLab', searchFamily: 'GitHub' })).toBe(
			false,
		);
	});
	it('retains only the explicit system group kind without treating user labels as system groups', () => {
		expect(sanitizeAccountMetadata({ ...ACCOUNT, searchFamily: '__other-services__' })).not.toHaveProperty('searchFamilyKind');
		expect(sanitizeAccountMetadata({ ...ACCOUNT, searchFamilyKind: 'other' })).toEqual({ ...ACCOUNT, searchFamilyKind: 'other' });
	});
	it.each(['user', 'constructor', '', null, true, {}, []])('rejects an invalid supplied system group kind %j', (searchFamilyKind) => {
		expect(sanitizeAccountMetadata({ ...ACCOUNT, searchFamilyKind })).toBeNull();
	});

	it.each([
		null,
		[],
		{ ...ACCOUNT, id: '' },
		{ ...ACCOUNT, name: '' },
		{ ...ACCOUNT, account: 123 },
		{ ...ACCOUNT, type: 'HOTP' },
		{ ...ACCOUNT, digits: 7 },
	])('rejects invalid public account metadata', (metadata) => {
		expect(sanitizeAccountMetadata(metadata)).toBeNull();
	});

	it('rejects duplicate account IDs in a metadata list', () => {
		expect(sanitizeAccountList([ACCOUNT, { ...ACCOUNT, name: 'GitLab' }])).toBeNull();
	});
});

describe('extension nonces', () => {
	it('creates a lowercase 144-bit hexadecimal nonce', () => {
		const nonce = createNonce();

		expect(nonce).toMatch(/^[a-f0-9]{36}$/);
		expect(isValidNonce(nonce)).toBe(true);
	});

	it.each([
		undefined,
		'',
		'0123456789abcdef0123456789abcdef012',
		'0123456789abcdef0123456789abcdef01234',
		'0123456789ABCDEF0123456789ABCDEF0123',
		'0123456789abcdef0123456789abcdef012g',
	])('rejects an invalid nonce: %s', (nonce) => {
		expect(isValidNonce(nonce)).toBe(false);
	});
});
