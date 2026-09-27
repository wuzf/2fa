import { afterEach, describe, expect, it } from 'vitest';
import { getAccountChoices } from '../../extension/src/popup/accounts.js';
import { listTotpAccounts } from '../../extension/src/bridge/api.js';
import { SERVICE_LOGOS } from '../../src/ui/config/serviceLogos.js';
import { getSearchCode } from '../../src/ui/scripts/search.js';
import { getServiceAggregationCode } from '../../src/ui/scripts/serviceAggregation.js';
import { setLanguage } from '../../extension/src/shared/i18n.js';
import { SUPPORTED_LANGUAGES } from '../../src/shared/languages.js';
import { LOCALES } from '../../src/ui/locales/index.js';

function mainPageSearch(secrets, language = 'zh-CN') {
	const document = {
		addEventListener() {},
		getElementById: () => ({ style: {} }),
	};
	// Exercise the main page's actual generated entry point, including its full-vault grouping.
	// eslint-disable-next-line no-new-func
	return new Function(
		'secrets',
		'document',
		'language',
		'dictionary',
		`
		const SERVICE_LOGOS = ${JSON.stringify(SERVICE_LOGOS)};
		const getLanguage = () => language;
		const t = key => dictionary[key] || key;
		let currentSearchQuery = '';
		let filteredSecrets = [];
		async function renderFilteredSecrets() {}
		${getServiceAggregationCode()}
		${getSearchCode()}
		return async (query) => {
			await filterSecrets(query);
			return filteredSecrets.filter(account => account.type !== 'HOTP').map(account => account.id).sort();
		};
	`,
	)(secrets, document, language, LOCALES[language]);
}

afterEach(() => setLanguage('zh-CN'));

const vault = (entries) =>
	entries.map((entry, index) => ({
		id: String(index),
		name: '',
		account: '',
		type: 'TOTP',
		digits: 6,
		secret: 'JBSWY3DPEHPK3PXP',
		...entry,
	}));

describe('extension and main page search parity', () => {
	it.each(SUPPORTED_LANGUAGES)('matches localized system groups in %s without translating user service names', async (language) => {
		setLanguage(language);
		const records = vault([
			{ name: 'Gmail', account: 'alice' },
			{ name: 'YouTube', type: 'HOTP' },
			{ name: 'GitHub', account: 'dev@example.com' },
			{ name: '__other-services__', account: 'one' },
			{ name: '__other-services__', account: 'two' },
			{ name: '其他服务', account: 'three' },
			{ name: '其他服务', account: 'four' },
		]);
		const searchMain = mainPageSearch(records, language);
		const accounts = await listTotpAccounts({
			instanceOrigin: 'https://twofa.example',
			fetchImpl: async () => new Response(JSON.stringify(records), { headers: { 'Content-Type': 'application/json' } }),
		});
		expect(accounts.find((account) => account.name === 'GitHub').searchFamilyKind).toBe('other');
		for (const account of accounts.filter((account) => ['__other-services__', '其他服务', 'Gmail'].includes(account.name))) {
			expect(account).not.toHaveProperty('searchFamilyKind');
		}
		const flow = { targetOrigin: 'https://github.com', accounts };
		for (const query of [LOCALES[language].otherServices, '__other-services__', '其他服务', 'Google', 'dev@']) {
			const expected = await searchMain(query);
			const actual = getAccountChoices(flow, { query })
				.choices.map(({ account }) => account.id)
				.sort();
			expect(actual, `${language}/${query}`).toEqual(expected);
		}
	});
	it.each([
		[
			'continuous phrases',
			[
				{ name: 'Alpha Beta', account: 'Work@example.com' },
				{ name: 'Alpha', account: 'Beta@example.com' },
				{ name: 'Alpha Production Beta' },
				{ name: 'Ａｌｐｈａ', account: '全角账户' },
			],
			['Alpha Beta', ' Alpha ', 'WORK@', 'Alpha Work', 'Alpha  Beta', 'Ａｌｐｈａ', '其他服务', 'missing'],
		],
		[
			'mixed TOTP and HOTP grouping',
			[
				{ name: 'Gmail', account: 'alice' },
				{ name: 'YouTube', type: 'HOTP' },
				{ name: 'GitHub', account: 'dev@example.com' },
			],
			['Google', 'gmail', 'GitHub dev@', 'DEV@', '其他服务', 'YouTube'],
		],
		[
			'identical service names',
			[
				{ name: 'Gmail', account: 'one' },
				{ name: 'Gmail', account: 'two' },
				{ name: 'EU.org', account: 'domain-admin' },
			],
			['Google', 'Gmail', 'eu.org', 'euorg', 'EU ORG', '其他服务'],
		],
	])('matches the main page for %s', async (_label, entries, queries) => {
		const records = vault(entries);
		const searchMain = mainPageSearch(records);
		const accounts = await listTotpAccounts({
			instanceOrigin: 'https://twofa.example',
			fetchImpl: async () => new Response(JSON.stringify(records), { headers: { 'Content-Type': 'application/json' } }),
		});
		const flow = { targetOrigin: 'https://github.com', accounts };
		for (const query of queries) {
			const expected = await searchMain(query);
			const actual = getAccountChoices(flow, { query })
				.choices.map(({ account }) => account.id)
				.sort();
			expect(actual, query).toEqual(expected);
		}
	});

	it('uses the same displayed group rules when no bridge labels are present', () => {
		const accounts = vault([{ name: 'Gmail' }, { name: 'YouTube' }, { name: 'GitHub' }]);
		const flow = { accounts, targetOrigin: 'https://github.com' };
		expect(getAccountChoices(flow, { query: 'google' }).choices.map(({ account }) => account.id)).toEqual(['0', '1']);
		expect(getAccountChoices(flow, { query: '其他服务' }).choices.map(({ account }) => account.id)).toEqual(['2']);
		expect(getAccountChoices(flow, { query: ' \t ' }).choices.map(({ account }) => account.id)).toEqual(['2']);
		expect(getAccountChoices(flow, { query: '', scope: 'all' }).choices).toHaveLength(3);
	});
});
