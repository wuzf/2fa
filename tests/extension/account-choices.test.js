import { describe, expect, it } from 'vitest';
import { getAccountChoices } from '../../extension/src/popup/accounts.js';

const accounts = [
	{ id: 'other', name: 'GitHub', account: 'dev@example.com' },
	{ id: 'alice', name: 'NodeSeek', account: 'alice' },
	{ id: 'bob', name: 'Node Seek', account: 'bob@example.com' },
	{ id: 'alias', name: '论坛主号', account: '自己的账号' },
];
const flow = { targetOrigin: 'https://www.nodeseek.com', accounts, boundAccountIds: [] };
const ids = (result) => result.choices.map((choice) => choice.account.id);

describe('website account suggestions and search', () => {
	it('recognizes NodeSeek and filters out unrelated accounts without automatically binding or selecting', () => {
		const result = getAccountChoices(flow);
		expect(ids(result).sort()).toEqual(['alice', 'bob']);
		expect(result.siteCount).toBe(2);
		expect(result.totalCount).toBe(4);
		expect(result.choices.every((choice) => choice.suggested && !choice.bound)).toBe(true);
		expect(flow.boundAccountIds).toEqual([]);
	});

	it('includes every explicit site binding even when its name does not resemble the site', () => {
		const result = getAccountChoices({ ...flow, boundAccountIds: ['alias', 'alice'] });
		expect(ids(result).slice(0, 2).sort()).toEqual(['alias', 'alice']);
		expect(result.siteCount).toBe(3);
		expect(result.choices.filter((choice) => choice.bound)).toHaveLength(2);
	});

	it('searches all accounts by case-insensitive service, username or email regardless of site filter', () => {
		expect(ids(getAccountChoices(flow, { query: '  GITHUB  ' }))).toEqual(['other']);
		expect(ids(getAccountChoices(flow, { query: 'BOB@example' }))).toEqual(['bob']);
		expect(ids(getAccountChoices(flow, { query: 'GITHUB DEV@' }))).toEqual([]);
		expect(ids(getAccountChoices(flow, { query: 'NODE bob@example' }))).toEqual([]);
		expect(ids(getAccountChoices(flow, { query: '自己的' }))).toEqual(['alias']);
		expect(ids(getAccountChoices(flow, { query: 'no-such-account' }))).toEqual([]);
	});

	it('allows showing all accounts and falls back to all when there are no site suggestions', () => {
		expect(ids(getAccountChoices(flow, { scope: 'all' }))).toHaveLength(4);
		const result = getAccountChoices({ ...flow, targetOrigin: 'https://unrelated.example' });
		expect(result.siteCount).toBe(0);
		expect(result.choices).toHaveLength(4);
	});

	it('does not mistake a deceptive subdomain for NodeSeek', () => {
		const result = getAccountChoices({ ...flow, targetOrigin: 'https://www.nodeseek.com.evil.example' });
		expect(result.siteCount).toBe(0);
		expect(result.choices.every((choice) => !choice.suggested)).toBe(true);
	});

	it.each(['EU.org', 'EU org', 'EU-org', 'EUORG', 'EU.org 备用账号'])(
		'recognizes the short service domain in %s without matching the short label alone',
		(name) => {
			const result = getAccountChoices({
				targetOrigin: 'https://nic.eu.org',
				accounts: [
					{ id: 'euorg', name, account: 'my-handle' },
					{ id: 'short', name: 'EU', account: 'another-handle' },
					{ id: 'unrelated', name: 'Neural service', account: 'eu.org@example.com' },
				],
			});
			expect(ids(result)).toEqual(['euorg']);
			expect(result.siteCount).toBe(1);
			expect(result.choices[0]).toMatchObject({ bound: false, suggested: true });
		},
	);

	it('keeps multiple EU.org accounts and puts explicitly bound accounts first', () => {
		const euFlow = {
			targetOrigin: 'https://nic.eu.org',
			accounts: [
				{ id: 'primary', name: 'EU.org', account: 'primary' },
				{ id: 'secondary', name: 'EU org', account: 'secondary' },
				{ id: 'bound', name: '域名管理', account: 'personal' },
				...accounts,
			],
			boundAccountIds: ['bound'],
		};
		const result = getAccountChoices(euFlow);
		expect(ids(result)[0]).toBe('bound');
		expect(ids(result).sort()).toEqual(['bound', 'primary', 'secondary']);
		expect(ids(getAccountChoices(euFlow, { query: 'DEV@' }))).toEqual(['other']);
		expect(euFlow.boundAccountIds).toEqual(['bound']);
	});

	it.each([
		'https://nic.eu.org.evil.example',
		'https://eu.example',
		'https://nic.eu.org.evil.co.uk',
		'https://unrelated.eu.org',
		'https://nic.eu.org.unrelated.eu.org',
		'https://org.eu.org',
		'https://euorg.eu.org',
	])('does not recommend EU.org based on a deceptive subdomain or short label in %s', (targetOrigin) => {
		const result = getAccountChoices({ targetOrigin, accounts: [{ id: 'euorg', name: 'EU.org', account: 'user' }] });
		expect(result.siteCount).toBe(0);
		expect(result.choices[0].suggested).toBe(false);
	});

	it.each(['https://eu.org', 'https://www.eu.org', 'https://nic.eu.org'])(
		'recommends EU.org accounts on the explicit management host %s',
		(targetOrigin) => {
			const result = getAccountChoices({ targetOrigin, accounts: [{ id: 'euorg', name: 'EU.org', account: 'user' }] });
			expect(result.siteCount).toBe(1);
			expect(result.choices[0].suggested).toBe(true);
		},
	);

	it.each(['https://alice.eu.org', 'https://login.alice.eu.org'])(
		'recommends the independently operated service on %s without suggesting EU.org administration',
		(targetOrigin) => {
			const result = getAccountChoices({
				targetOrigin,
				accounts: [
					{ id: 'alice', name: 'Alice', account: 'user' },
					{ id: 'euorg', name: 'EU.org', account: 'alice' },
					{ id: 'management', name: 'EU.org Alice管理', account: 'alice' },
				],
			});
			expect(ids(result)).toEqual(['alice']);
			expect(result.siteCount).toBe(1);
		},
	);

	it('continues recognizing service names before a co.uk suffix', () => {
		const result = getAccountChoices({ ...flow, targetOrigin: 'https://login.nodeseek.co.uk' });
		expect(ids(result).sort()).toEqual(['alice', 'bob']);
	});

	it('uses the complete service domain for short names before a co.uk suffix', () => {
		const result = getAccountChoices({
			targetOrigin: 'https://login.eu.co.uk',
			accounts: [
				{ id: 'uk', name: 'EU.co.uk', account: 'user' },
				{ id: 'org', name: 'EU.org', account: 'user' },
				{ id: 'short', name: 'EU', account: 'user' },
			],
		});
		expect(ids(result)).toEqual(['uk']);
	});
});

it('pins favorites within the chosen scope without promoting unrelated sites to matches', () => {
	const favoriteFlow = { ...flow, favoriteAccountIds: ['other', 'bob'] };
	expect(ids(getAccountChoices(favoriteFlow))[0]).toBe('bob');
	expect(ids(getAccountChoices(favoriteFlow))).not.toContain('other');
	expect(
		ids(getAccountChoices(favoriteFlow, { scope: 'all' }))
			.slice(0, 2)
			.sort(),
	).toEqual(['bob', 'other']);
});

it('filters a Google challenge by exact email and service rather than shared email alone', () => {
	const googleFlow = {
		targetOrigin: 'https://accounts.google.com',
		loginContext: { provider: 'google', email: 'alice@example.com' },
		boundAccountIds: [],
		accounts: [
			{ id: 'google-a', name: 'Google', account: 'Alice@Example.com', type: 'TOTP' },
			{ id: 'google-b', name: 'Google', account: 'bob@example.com', type: 'TOTP' },
			{ id: 'github-a', name: 'GitHub', account: 'alice@example.com', type: 'TOTP' },
			{ id: 'gmail-a', name: 'Gmail', account: 'alice@example.com', type: 'TOTP' },
		],
	};
	expect(ids(getAccountChoices(googleFlow)).sort()).toEqual(['gmail-a', 'google-a']);
	expect(ids(getAccountChoices(googleFlow, { scope: 'all' }))).toHaveLength(4);
	expect(ids(getAccountChoices(googleFlow, { query: 'bob' }))).toEqual(['google-b']);
	expect(ids(getAccountChoices({ ...googleFlow, loginContext: { provider: 'google', email: 'missing@example.com' } }))).toEqual([]);
});
it('accepts an explicitly bound custom Google account name but never rewrites email aliases', () => {
	const googleFlow = {
		targetOrigin: 'https://accounts.google.com',
		loginContext: { provider: 'google', email: 'alice@gmail.com' },
		boundAccountIds: ['custom'],
		accounts: [
			{ id: 'custom', name: '私人主号', account: 'alice@gmail.com', type: 'TOTP' },
			{ id: 'alias', name: 'Google', account: 'a.lice@gmail.com', type: 'TOTP' },
			{ id: 'tag', name: 'Google', account: 'alice+work@gmail.com', type: 'TOTP' },
		],
	};
	expect(ids(getAccountChoices(googleFlow))).toEqual(['custom']);
});

it.each(['Google:alice@gmail.com', ' Google : Alice@Gmail.com ', 'Gmail:alice@gmail.com'])(
	'matches the Google Authenticator imported account label %s without changing stored metadata',
	(account) => {
		const stored = { id: 'imported', name: 'Google', account, type: 'TOTP' };
		const result = getAccountChoices({
			targetOrigin: 'https://accounts.google.com',
			loginContext: { provider: 'google', email: 'alice@gmail.com' },
			accounts: [stored, { ...stored, id: 'github', name: 'GitHub' }],
		});
		expect(ids(result)).toEqual(['imported']);
		expect(result.siteCount).toBe(1);
		expect(stored.account).toBe(account);
	},
);

it.each([
	'GitHub:alice@gmail.com',
	'Unknown:alice@gmail.com',
	'Google:Google:alice@gmail.com',
	'Google:alice@gmail.com bob@gmail.com',
	'Google:alice@gmail.com.evil.example',
	'Google:prefix-alice@gmail.com',
	'Google:alice+work@gmail.com',
	'Google:a.lice@gmail.com',
	'Google:alice',
	'Google:https://alice@gmail.com',
	'https://google.com:alice@gmail.com',
	'google.com.evil.example:alice@gmail.com',
])('rejects unrelated or ambiguous imported account labels: %s', (account) => {
	const result = getAccountChoices({
		targetOrigin: 'https://accounts.google.com',
		loginContext: { provider: 'google', email: 'alice@gmail.com' },
		accounts: [{ id: 'invalid', name: 'Google', account, type: 'TOTP' }],
	});
	expect(ids(result)).toEqual([]);
});
