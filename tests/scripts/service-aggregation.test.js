import { describe, expect, it } from 'vitest';

import { SERVICE_LOGOS } from '../../src/ui/config/serviceLogos.js';
import { getCoreCode } from '../../src/ui/scripts/core.js';
import { getServiceAggregationCode } from '../../src/ui/scripts/serviceAggregation.js';

function createHarness() {
	const code = `
    const SERVICE_LOGOS = ${JSON.stringify(SERVICE_LOGOS)};
    ${getServiceAggregationCode()}
    return {
      normalizeServiceExactName,
      splitServiceWords,
      resolveServiceDomain,
      resolveServiceIdentity,
      getServiceFamilyMetadata,
      groupSecretsByServiceFamily,
      getIdentityCacheSize: () => SERVICE_IDENTITY_CACHE.size,
      getFamilyDomainCacheSize: () => SERVICE_FAMILY_DOMAIN_CACHE.size,
      OTHER_SERVICE_GROUP_KEY
    };
  `;

	// eslint-disable-next-line no-new-func
	return new Function(code)();
}

function secret(id, name) {
	return { id, name };
}

describe('service identity resolution', () => {
	const api = createHarness();

	it('normalizes whitespace, full-width text, punctuation, and camel case', () => {
		expect(api.splitServiceWords('  Google\tDrive  ')).toEqual(['google', 'drive']);
		expect(api.splitServiceWords('Ｇｏｏｇｌｅ　Ｄｒｉｖｅ')).toEqual(['google', 'drive']);
		expect(api.splitServiceWords('GoogleDriveBackup')).toEqual(['google', 'drive', 'backup']);
		expect(api.resolveServiceDomain('Google Drive Backup')).toBe('drive.google.com');
		expect(api.resolveServiceDomain('GoogleDriveBackup')).toBe('drive.google.com');
	});

	it('normalizes plus signs, words, and camel case to the same streaming services', () => {
		const disneyNames = ['Disney+', 'Disney +', 'Disney Plus', 'DisneyPlus', 'Ｄｉｓｎｅｙ＋'];
		const paramountNames = ['Paramount+', 'Paramount +', 'Paramount Plus', 'ParamountPlus', 'Ｐａｒａｍｏｕｎｔ＋'];

		expect(api.splitServiceWords('Disney+')).toEqual(['disney', 'plus']);
		expect(new Set(disneyNames.map((name) => api.resolveServiceDomain(name)))).toEqual(new Set(['disneyplus.com']));
		expect(new Set(paramountNames.map((name) => api.resolveServiceDomain(name)))).toEqual(new Set(['paramountplus.com']));
		expect(api.resolveServiceDomain('Disney')).toBeNull();
		expect(api.resolveServiceDomain('Paramount')).toBeNull();
		expect(api.resolveServiceDomain('C++')).toBeNull();
	});

	it('merges services that share a configured account ecosystem', () => {
		const googleNames = ['Google', 'Gmail', 'YouTube', 'GCP', 'Firebase', 'Google Docs'];
		const microsoftNames = ['Microsoft', 'Azure', 'Outlook', 'OneDrive', 'Teams', 'Office 365'];
		const amazonNames = ['Amazon', 'AWS', 'Route53', 'Prime Video', 'amazonaws'];

		expect(new Set(googleNames.map((name) => api.resolveServiceIdentity(name).key))).toEqual(new Set(['domain:google.com']));
		expect(new Set(microsoftNames.map((name) => api.resolveServiceIdentity(name).key))).toEqual(new Set(['domain:microsoft.com']));
		expect(new Set(amazonNames.map((name) => api.resolveServiceIdentity(name).key))).toEqual(new Set(['domain:amazon.com']));
		expect(api.resolveServiceIdentity('Jira').key).toBe(api.resolveServiceIdentity('Confluence').key);
	});

	it('recognizes configured services written as hostnames or URLs', () => {
		const googleKey = api.resolveServiceIdentity('Google').key;
		const githubKey = api.resolveServiceIdentity('GitHub').key;

		expect(api.resolveServiceIdentity('drive.google.com').key).toBe(googleKey);
		expect(api.resolveServiceIdentity('accounts.google.com').key).toBe(googleKey);
		expect(api.resolveServiceIdentity('accounts.google.com:443/signin').key).toBe(googleKey);
		expect(api.resolveServiceIdentity('https://accounts.google.com/signin?continue=%2F').key).toBe(googleKey);
		expect(api.resolveServiceIdentity('//drive.google.com/path').key).toBe(googleKey);
		expect(api.resolveServiceIdentity('https://accounts.google.com./signin').key).toBe(googleKey);
		expect(api.resolveServiceIdentity('foo.github.com').key).toBe(githubKey);
		expect(api.resolveServiceDomain('unknown.example')).toBeNull();
		expect(api.resolveServiceDomain('https://google.com.evil.example/signin')).toBeNull();
	});

	it('rejects bare email addresses without brand fallback', () => {
		expect(api.resolveServiceDomain('alice@gmail.com')).toBeNull();
		expect(api.resolveServiceDomain('Gmail@example.com')).toBeNull();
		expect(api.resolveServiceDomain('Gmail@example.com:invalid')).toBeNull();
		expect(api.resolveServiceIdentity('alice@gmail.com').key).toBe('name:alice gmail com');
	});

	it.each([
		'GitHub@evil.example/signin',
		'Gmail@example.com/signin',
		'Gmail@example.com\\signin',
		'github.com@evil.example/path',
		'Google:secret@evil.example/path',
		'Gmail@example.com:invalid/signin',
		'Gmail@%/signin',
		'Gmail@bad host/signin',
		'Gmail@/signin',
		'Git@Hub/',
		'//Gmail@example.com/signin',
		'https://alice@gmail.com/signin',
		'https://gmail:secret@google.com/signin',
	])('rejects URL userinfo before exact or fuzzy brand matching: %s', (name) => {
		expect(api.resolveServiceDomain(name)).toBeNull();
		expect(api.resolveServiceIdentity(name).key.startsWith('name:')).toBe(true);
	});

	it('allows @ in URL paths and queries with or without a scheme', () => {
		expect(api.resolveServiceDomain('https://accounts.google.com/@alice')).toBe('accounts.google.com');
		expect(api.resolveServiceDomain('https://accounts.google.com/signin?email=alice@gmail.com')).toBe('accounts.google.com');
		expect(api.resolveServiceDomain('accounts.google.com/@alice')).toBe('accounts.google.com');
		expect(api.resolveServiceDomain('accounts.google.com\\@alice')).toBe('accounts.google.com');
		expect(api.resolveServiceDomain('accounts.google.com?email=alice@gmail.com')).toBe('accounts.google.com');
		expect(api.resolveServiceDomain('//accounts.google.com/signin?email=alice@gmail.com')).toBe('accounts.google.com');
	});

	it('falls back to fuzzy labels after rejecting a syntactically valid unknown hostname', () => {
		expect(api.resolveServiceDomain('GitHub.comEnterprise')).toBe('github.com');
		expect(api.resolveServiceDomain('Battle.NetAccount')).toBe('blizzard.com');
		expect(api.resolveServiceDomain('Unknown.example')).toBeNull();
		expect(api.resolveServiceDomain('github.com.evil.example')).toBeNull();
		expect(api.resolveServiceDomain('https://github.com.evil.example/signin')).toBeNull();
	});

	it('honors explicit family aliases before folding into a generic parent domain', () => {
		const wechatKey = api.resolveServiceIdentity('WeChat').key;
		const wechatWorkKey = api.resolveServiceIdentity('WeChat Work').key;
		const nestedWeChatWorkKey = api.resolveServiceIdentity('tenant.work.weixin.qq.com').key;
		const qqKey = api.resolveServiceIdentity('QQ').key;

		expect(wechatWorkKey).toBe('domain:wecom.cn');
		expect(nestedWeChatWorkKey).toBe(wechatWorkKey);
		expect(wechatWorkKey).not.toBe(wechatKey);
		expect(wechatWorkKey).not.toBe(qqKey);
	});

	it('uses an unambiguous normalized exact-name index for every configured service', () => {
		expect(api.resolveServiceIdentity('Apple Music').key).toBe(api.resolveServiceIdentity('AppleMusic').key);
		expect(api.resolveServiceIdentity('applemusic').key).toBe(api.resolveServiceIdentity('apple_music').key);
		expect(api.resolveServiceIdentity('Stack Overflow').key).toBe(api.resolveServiceIdentity('Stack-Overflow').key);
		expect(api.resolveServiceIdentity('stackoverflow').key).toBe(api.resolveServiceIdentity('stack.overflow').key);
	});

	it('does not turn short or partial names into unrelated brands', () => {
		expect(api.resolveServiceDomain('Project X')).toBeNull();
		expect(api.resolveServiceDomain('Amazonian Bank')).toBeNull();
		expect(api.resolveServiceDomain('Box Office')).toBeNull();
		expect(api.resolveServiceDomain('Line Manager')).toBeNull();
		expect(api.resolveServiceDomain('Max Planck Institute')).toBeNull();
		expect(api.resolveServiceDomain('Medium Rare')).toBeNull();
		expect(api.resolveServiceDomain('Wise Guys')).toBeNull();
		expect(api.resolveServiceDomain('constructor')).toBeNull();
		expect(api.resolveServiceDomain('__proto__')).toBeNull();
		expect(api.resolveServiceIdentity('MyService').key).toBe(api.resolveServiceIdentity('my.service').key);
		expect(api.resolveServiceIdentity('MyService').key).toBe(api.resolveServiceIdentity('Ｍｙ　Ｓｅｒｖｉｃｅ').key);
	});

	it('recognizes configured brands with camel-cased or descriptive suffixes', () => {
		expect(api.resolveServiceDomain('GitHub Enterprise')).toBe('github.com');
		expect(api.resolveServiceDomain('GitHub.Enterprise')).toBe('github.com');
		expect(api.resolveServiceDomain('github.enterprise')).toBe('github.com');
		expect(api.resolveServiceDomain('GitHub.enterprise')).toBe('github.com');
		expect(api.resolveServiceDomain('github.Enterprise')).toBe('github.com');
		expect(api.resolveServiceDomain('GitHubEnterprise')).toBe('github.com');
		expect(api.resolveServiceDomain('GitHub.Evil')).toBeNull();
		expect(api.resolveServiceDomain('github.com.evil.example')).toBeNull();
		expect(api.resolveServiceDomain('YouTube Premium')).toBe('youtube.com');
		expect(api.resolveServiceDomain('OneDrive Business')).toBe('onedrive.live.com');
		expect(api.resolveServiceDomain('ChatGPT Team')).toBe('openai.com');
		expect(api.resolveServiceDomain('PayPal Business')).toBe('paypal.com');
		expect(api.resolveServiceDomain('AWSConsole')).toBe('aws.amazon.com');
	});

	it('keeps punctuation-sensitive exact mappings distinct', () => {
		expect(api.resolveServiceDomain('yandex.mail')).toBe('yandex.com');
		expect(api.resolveServiceDomain('yandex mail')).toBe('yandex.ru');
		expect(api.resolveServiceDomain('YandexMail')).toBeNull();
	});

	it('caches resolved identities by service name', () => {
		const before = api.getIdentityCacheSize();
		api.resolveServiceIdentity('GitHub Enterprise Cache Test');
		const afterFirstResolve = api.getIdentityCacheSize();
		api.resolveServiceIdentity('GitHub Enterprise Cache Test');

		expect(afterFirstResolve).toBe(before + 1);
		expect(api.getIdentityCacheSize()).toBe(afterFirstResolve);
	});

	it('bounds dynamic identity and family-domain caches', () => {
		for (let index = 0; index < 5000; index++) {
			api.resolveServiceIdentity('tenant-' + index + '.google.com');
		}

		expect(api.getIdentityCacheSize()).toBeLessThanOrEqual(4096);
		expect(api.getFamilyDomainCacheSize()).toBeLessThanOrEqual(4096);
	});
});

describe('automatic service grouping', () => {
	const api = createHarness();
	const allSecrets = [
		secret('google', 'Google'),
		secret('gmail', 'Gmail'),
		secret('youtube', 'YouTube'),
		secret('microsoft', 'Microsoft'),
		secret('outlook', 'Outlook'),
		secret('github', 'GitHub'),
		secret('discord', 'Discord'),
	];

	it('creates groups for families with at least two entries and puts singletons last', () => {
		const groups = api.groupSecretsByServiceFamily(allSecrets, allSecrets);

		expect(groups.map((group) => group.name)).toEqual(['Google', 'Microsoft', '其他服务']);
		expect(groups.map((group) => group.totalCount)).toEqual([3, 2, 2]);
		expect(groups.at(-1).key).toBe(api.OTHER_SERVICE_GROUP_KEY);
		expect(groups.flatMap((group) => group.items.map((item) => item.id)).sort()).toEqual(allSecrets.map((item) => item.id).sort());
	});

	it('sorts aggregate service names in the selected name direction and keeps other services last', () => {
		const ascendingGroups = api.groupSecretsByServiceFamily(allSecrets, allSecrets, 'name-asc');
		const descendingGroups = api.groupSecretsByServiceFamily(allSecrets, allSecrets, 'name-desc');

		expect(ascendingGroups.map((group) => group.name)).toEqual(['Google', 'Microsoft', '其他服务']);
		expect(descendingGroups.map((group) => group.name)).toEqual(['Microsoft', 'Google', '其他服务']);
	});

	it('uses totals from the full list when a search only leaves part of a family visible', () => {
		const visibleSecrets = allSecrets.filter((item) => item.id === 'gmail' || item.id === 'youtube');
		const groups = api.groupSecretsByServiceFamily(visibleSecrets, allSecrets);

		expect(groups).toHaveLength(1);
		expect(groups[0]).toMatchObject({ name: 'Google', matchedCount: 2, totalCount: 3 });
	});

	it('preserves the incoming item order inside each group', () => {
		const visibleSecrets = [allSecrets[2], allSecrets[0], allSecrets[1]];
		const [googleGroup] = api.groupSecretsByServiceFamily(visibleSecrets, allSecrets);

		expect(googleGroup.items.map((item) => item.id)).toEqual(['youtube', 'google', 'gmail']);
	});

	it('uses configured brand casing for mixed service-name variants', () => {
		const githubSecrets = [secret('github', 'GitHub'), secret('github-enterprise', 'GitHub Enterprise')];
		const [githubGroup] = api.groupSecretsByServiceFamily(githubSecrets, githubSecrets);

		expect(githubGroup.name).toBe('GitHub');
	});

	it('preserves a repeated service name while mixed family services use the family name', () => {
		const gmailSecrets = [secret('gmail-one', 'Gmail'), secret('gmail-two', 'Gmail')];
		const outlookSecrets = [secret('outlook-one', 'Outlook'), secret('outlook-two', 'Outlook')];
		const mixedGoogleSecrets = [secret('gmail', 'Gmail'), secret('youtube', 'YouTube')];
		const mixedMicrosoftSecrets = [secret('outlook', 'Outlook'), secret('teams', 'Teams')];

		expect(api.groupSecretsByServiceFamily(gmailSecrets, gmailSecrets)[0].name).toBe('Gmail');
		expect(api.groupSecretsByServiceFamily(outlookSecrets, outlookSecrets)[0].name).toBe('Outlook');
		expect(api.groupSecretsByServiceFamily(mixedGoogleSecrets, mixedGoogleSecrets)[0].name).toBe('Google');
		expect(api.groupSecretsByServiceFamily(mixedMicrosoftSecrets, mixedMicrosoftSecrets)[0].name).toBe('Microsoft');
	});

	it('groups WeChat Work separately from personal WeChat and QQ', () => {
		const mixedSecrets = [
			secret('wechat-work', 'WeChat Work'),
			secret('wechat-work-host', 'tenant.work.weixin.qq.com'),
			secret('wechat', 'WeChat'),
			secret('qq', 'QQ'),
		];
		const groups = api.groupSecretsByServiceFamily(mixedSecrets, mixedSecrets);

		expect(groups.map((group) => group.name)).toEqual(['WeChat Work', '其他服务']);
		expect(groups[0].items.map((item) => item.id)).toEqual(['wechat-work', 'wechat-work-host']);
		expect(groups[1].items.map((item) => item.id)).toEqual(['wechat', 'qq']);
	});

	it('reuses full-list metadata and invalidates it after in-place name or list changes', () => {
		const mutableSecrets = [secret('one', 'Acme Service'), secret('two', 'Acme.Service')];
		const initialMetadata = api.getServiceFamilyMetadata(mutableSecrets);

		expect(api.getServiceFamilyMetadata(mutableSecrets)).toBe(initialMetadata);

		mutableSecrets[1].name = 'Google';
		const renamedMetadata = api.getServiceFamilyMetadata(mutableSecrets);
		expect(renamedMetadata).not.toBe(initialMetadata);

		mutableSecrets.push(secret('three', 'Gmail'));
		const appendedMetadata = api.getServiceFamilyMetadata(mutableSecrets);
		expect(appendedMetadata).not.toBe(renamedMetadata);
		expect(api.groupSecretsByServiceFamily(mutableSecrets, mutableSecrets).map((group) => group.name)).toEqual(['Google', '其他服务']);
	});

	it('invalidates cached identities when an item is replaced with the same service name', () => {
		const mutableSecrets = [secret('gmail', 'Gmail'), secret('youtube', 'YouTube')];
		const initialMetadata = api.getServiceFamilyMetadata(mutableSecrets);

		mutableSecrets[0] = { ...mutableSecrets[0], account: 'edited@example.com' };
		const replacedMetadata = api.getServiceFamilyMetadata(mutableSecrets);

		expect(replacedMetadata).not.toBe(initialMetadata);
		expect(replacedMetadata.identityBySecret.get(mutableSecrets[0]).key).toBe('domain:google.com');
	});

	it('keeps repeated 1000-entry grouping on the cached metadata path', () => {
		const manySecrets = Array.from({ length: 1000 }, (_, index) =>
			secret(String(index), index % 2 === 0 ? 'Google Workspace ' + index : 'Microsoft Tenant ' + index),
		);

		const initialMetadata = api.getServiceFamilyMetadata(manySecrets);
		for (let iteration = 0; iteration < 20; iteration++) {
			const groups = api.groupSecretsByServiceFamily(manySecrets, manySecrets);
			expect(groups).toHaveLength(2);
			expect(api.getServiceFamilyMetadata(manySecrets)).toBe(initialMetadata);
		}
	});

	it('wires aggregate group order independently from item sorting', () => {
		expect(getCoreCode()).toContain('groupSecretsByServiceFamily(sortedSecrets, secrets, currentGroupSortType)');
	});
});
