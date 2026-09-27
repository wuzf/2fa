import { describe, expect, it } from 'vitest';

import { normalizeConnectionAddress } from '../../extension/src/options/connection-address.js';
import { normalizeInstanceOrigin } from '../../extension/src/shared/origin.js';

describe('settings connection address', () => {
	it.each([
		['https://vault.example.com', 'https://vault.example.com'],
		['  HTTPS://VAULT.EXAMPLE.COM:443/accounts?session=private#login  ', 'https://vault.example.com'],
		['https://vault.example.com:8443/login', 'https://vault.example.com:8443'],
		['vault.example.com', 'https://vault.example.com'],
		[' vault.example.com/accounts?session=private#login ', 'https://vault.example.com'],
		['vault.example.com:8443/login', 'https://vault.example.com:8443'],
		['192.168.1.10:8443', 'https://192.168.1.10:8443'],
		['[2001:db8::1]:8443/login', 'https://[2001:db8::1]:8443'],
		['[::1]', 'https://[::1]'],
		['localhost', 'http://localhost'],
		['LOCALHOST:8787/login', 'http://localhost:8787'],
		['127.0.0.1:8787/?session=private', 'http://127.0.0.1:8787'],
		['http://localhost:8787', 'http://localhost:8787'],
		['https://localhost:8787', 'https://localhost:8787'],
		['localhost.example.com:8443', 'https://localhost.example.com:8443'],
	])('connects %s using only origin %s', (address, expected) => {
		expect(normalizeConnectionAddress(address)).toBe(expected);
	});

	it.each([
		undefined,
		null,
		42,
		'',
		'   ',
		'not a domain',
		'vault.example.com:65536',
		'http://vault.example.com',
		'http://192.168.1.10:8787',
		'http://[::1]:8787',
		'javascript:alert(1)',
		'javascript:443',
		'java\nscript:443',
		'data:text/html,hello',
		'ftp://vault.example.com',
		'ftp:443',
		'file:///tmp/vault',
		'chrome://settings',
		'https://user:pass@vault.example.com',
		'user:pass@vault.example.com',
		'user@vault.example.com',
		'http://localhost@vault.example.com',
	])('rejects unsafe or invalid input %s', (address) => {
		expect(() => normalizeConnectionAddress(address)).toThrow();
	});

	it('keeps missing-protocol convenience local to the settings form', () => {
		expect(normalizeConnectionAddress('vault.example.com')).toBe('https://vault.example.com');
		expect(() => normalizeInstanceOrigin('vault.example.com')).toThrow();
		expect(() => normalizeInstanceOrigin('http://vault.example.com')).toThrow();
	});
});
