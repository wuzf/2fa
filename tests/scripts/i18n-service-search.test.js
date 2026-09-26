import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { SERVICE_LOGOS } from '../../src/ui/config/serviceLogos.js';
import { getI18nCode } from '../../src/ui/scripts/i18n.js';
import { getSearchCode } from '../../src/ui/scripts/search.js';
import { getServiceAggregationCode } from '../../src/ui/scripts/serviceAggregation.js';

function createHarness(language) {
	const elements = {
		searchClear: { style: {} },
		searchStats: { style: {}, textContent: '' },
	};
	const storage = new Map([['language', language]]);
	const context = createContext({
		navigator: { language: 'zh-CN' },
		localStorage: {
			getItem: (key) => storage.get(key) ?? null,
			setItem: (key, value) => storage.set(key, value),
		},
		document: {
			documentElement: { setAttribute() {} },
			querySelectorAll: () => [],
			getElementById: (id) => elements[id] ?? null,
		},
		secrets: [
			{ id: 'google', name: 'Google' },
			{ id: 'gmail', name: 'Gmail' },
			{ id: 'github', name: 'GitHub' },
			{ id: 'discord', name: 'Discord' },
		],
		filteredSecrets: [],
		currentSearchQuery: '',
		renderFilteredSecrets: async () => {},
	});
	runInContext(
		`const SERVICE_LOGOS = ${JSON.stringify(SERVICE_LOGOS)};` +
			getI18nCode() +
			getServiceAggregationCode() +
			getSearchCode() +
			'Object.assign(globalThis, { groupSecretsByServiceFamily, getServiceFamilyMetadata });',
		context,
	);
	return context;
}

describe('localized service group search', () => {
	it.each([
		['en', 'Other Services'],
		['zh-TW', '其他服務'],
		['zh-CN', '其他服务'],
	])('finds the singleton group by its displayed name in %s', async (language, label) => {
		const h = createHarness(language);
		const groups = h.groupSecretsByServiceFamily(h.secrets, h.secrets);
		expect(groups.at(-1).name).toBe(label);

		await h.filterSecrets(groups.at(-1).name);
		expect(Array.from(h.filteredSecrets, (secret) => secret.id)).toEqual(['github', 'discord']);
	});

	it('updates both the group title and searchable name after changing language with cached metadata', async () => {
		const h = createHarness('en');
		const metadata = h.getServiceFamilyMetadata(h.secrets);
		expect(h.groupSecretsByServiceFamily(h.secrets, h.secrets).at(-1).name).toBe('Other Services');

		h.setLanguage('zh-TW');
		expect(h.getServiceFamilyMetadata(h.secrets)).toBe(metadata);
		const groups = h.groupSecretsByServiceFamily(h.secrets, h.secrets);
		expect(groups.at(-1).name).toBe('其他服務');
		await h.filterSecrets(groups.at(-1).name);
		expect(Array.from(h.filteredSecrets, (secret) => secret.id)).toEqual(['github', 'discord']);
	});
});
