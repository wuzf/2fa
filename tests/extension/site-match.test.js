import { describe, expect, it } from 'vitest';
import { chooseAutoFillAccountId } from '../../extension/src/shared/account-match.js';
import { getAccountChoices } from '../../extension/src/popup/accounts.js';
import { matchesSiteAccountName, mayMatchSiteAccountName } from '../../extension/src/shared/site-match.js';

const github = { id: 'github', name: 'GitHub', account: 'alice@example.com', type: 'TOTP' };
const other = { ...github, id: 'other', name: 'Other', account: 'bob@example.com' };
function flow(overrides = {}) {
	return { targetOrigin: 'https://github.com', accounts: [github, other], ...overrides };
}

describe('automatic website account choice', () => {
	it.each([
		['https://github.com', 'GitHub'],
		['https://www.github.com', ' github '],
		['https://github.com', 'github.com'],
		['https://gitlab.com', 'GitLab'],
		['https://bitbucket.org', 'Bitbucket'],
		['https://www.nodeseek.com', 'Node Seek'],
		['https://nic.eu.org', 'EU-org'],
		['https://linux.do', 'Linux DO'],
		['https://dash.cloudflare.com', 'Cloudflare'],
		['https://console.vultr.com', 'Vultr'],
		['https://console.vultr.com/', ' VULTR '],
		['https://console.vultr.com', 'vultr.com'],
		['https://console.vultr.com', 'console.vultr.com'],
		['https://login.live.com', 'Microsoft'],
		['https://account.live.com', 'Hotmail'],
		['https://discord.com', 'Discord'],
		['https://www.facebook.com', 'Facebook'],
		['https://www.instagram.com', 'Instagram'],
		['https://www.npmjs.com', 'npm'],
		['https://pypi.org', 'PyPI'],
		['https://www.v2ex.com', 'V2EX'],
		['https://www.dropbox.com', 'Dropbox'],
		['https://www.reddit.com', 'Reddit'],
		['https://www.twitch.tv', 'Twitch'],
		['https://www.epicgames.com', 'Epic Games'],
		['https://www.paypal.com', 'PayPal'],
		['https://login.coinbase.com', 'Coinbase'],
		['https://accounts.binance.com', 'Binance.com'],
		['https://www.kraken.com', 'Kraken'],
		['https://www.amazon.com', 'Amazon'],
		['https://signin.aws.amazon.com', 'Amazon Web Services'],
		['https://signin.aws.amazon.com', 'AWS'],
		['https://login.yahoo.com', 'Yahoo'],
		['https://account.proton.me', 'Proton Mail'],
		['https://accounts.firefox.com', 'Firefox'],
		['https://vault.bitwarden.eu', 'Bitwarden'],
		['https://id.atlassian.com', 'Atlassian'],
		['https://dashboard.stripe.com', 'Stripe'],
		['https://cloud.digitalocean.com', 'Digital Ocean'],
		['https://id.heroku.com', 'Heroku'],
		['https://login.docker.com', 'Docker'],
		['https://vercel.com', 'Vercel'],
		['https://huggingface.co', 'Hugging Face'],
		['https://auth.openai.com', 'OpenAI'],
		['https://www.namecheap.com', 'Namecheap'],
		['https://accounts.hetzner.com', 'Hetzner'],
	])('automatically chooses the unique %s / %s account and includes it in the popup', (targetOrigin, name) => {
		const state = flow({ targetOrigin, accounts: [{ ...github, name }, other] });
		expect(chooseAutoFillAccountId(state)).toBe(github.id);
		expect(getAccountChoices(state).choices.map(({ account }) => account.id)).toContain(github.id);
	});

	it.each([
		'https://github.com.evil.example',
		'https://github.co.uk',
		'https://github.io',
		'https://github.github.io',
		'https://login.github.com',
		'https://tenant.github.com',
		'https://github.eu.org',
		'https://github.com:8443',
		'http://github.com',
		'https://github.com@evil.example',
		'https://evil.example@github.com',
		'chrome://newtab',
		'https://127.0.0.1',
		'https://localhost',
		'not a URL',
	])('does not treat a name hint as authority on %s', (targetOrigin) => {
		expect(chooseAutoFillAccountId(flow({ targetOrigin }))).toBeNull();
	});

	it.each(['GitHub Enterprise', 'My GitHub', 'GitHub GitLab', 'github.com.evil.example', 'github@example.com'])(
		'keeps the fuzzy label %s manual even when it is the only suggestion',
		(name) => expect(chooseAutoFillAccountId(flow({ accounts: [{ ...github, name }] }))).toBeNull(),
	);

	it.each(['https://alice.eu.org', 'https://nic.eu.org.alice.eu.org', 'https://tenant.cloudflare.com'])(
		'never extends official hosts to tenants at %s',
		(targetOrigin) => {
			expect(chooseAutoFillAccountId(flow({ targetOrigin, accounts: [{ ...github, name: 'EU.org' }] }))).toBeNull();
			expect(chooseAutoFillAccountId(flow({ targetOrigin, accounts: [{ ...github, name: 'Cloudflare' }] }))).toBeNull();
		},
	);

	it.each([
		['https://tenant.signin.aws.amazon.com', 'AWS'],
		['https://www.amazon.co.uk', 'Amazon'],
		['https://aws.amazon.com', 'AWS'],
		['https://signin.aws.amazon.com', 'Amazon'],
		['https://www.amazon.com', 'AWS'],
		['https://team.atlassian.net', 'Atlassian'],
		['https://stripe.com', 'Stripe'],
		['https://dropbox.com.evil.example', 'Dropbox'],
		['https://www.paypal.com:8443', 'PayPal'],
		['http://vercel.com', 'Vercel'],
		['https://proton.me', 'Proton'],
		['https://vault.bitwarden.com.evil.example', 'Bitwarden'],
	])('keeps an added service manual outside its own login hosts: %s / %s', (targetOrigin, name) => {
		expect(chooseAutoFillAccountId(flow({ targetOrigin, accounts: [{ ...github, name }, other] }))).toBeNull();
	});

	it.each([
		['https://www.amazon.com', 'Amazon', 'Amazon Web Services'],
		['https://www.dropbox.com', 'Dropbox', 'Dropbox Work'],
		['https://accounts.firefox.com', 'Firefox', 'Mozilla account'],
	])('keeps %s manual when a second account may belong to it: %s and %s', (targetOrigin, name, second) => {
		const state = flow({
			targetOrigin,
			accounts: [
				{ ...github, name },
				{ ...other, name: second },
			],
		});
		expect(chooseAutoFillAccountId(state)).toBeNull();
	});

	it('does not select from an unrelated full-vault fallback or a favorite', () => {
		expect(chooseAutoFillAccountId(flow({ accounts: [other], favoriteAccountIds: [other.id] }))).toBeNull();
	});
	it.each([
		'https://vultr.com',
		'https://www.vultr.com',
		'https://tenant.vultr.com',
		'https://console.vultr.com.evil.example',
		'https://console.vultr.com:8443',
		'http://console.vultr.com',
	])('does not infer a Vultr credential destination from a logo or similar hostname: %s', (targetOrigin) => {
		expect(chooseAutoFillAccountId(flow({ targetOrigin, accounts: [{ ...github, name: 'Vultr' }] }))).toBeNull();
	});
	it('offers both Vultr accounts and only chooses automatically when one is explicitly bound', () => {
		const state = flow({
			targetOrigin: 'https://console.vultr.com',
			accounts: [
				{ ...github, name: 'Vultr' },
				{ ...other, name: 'Vultr' },
			],
		});
		expect(getAccountChoices(state).siteCount).toBe(2);
		expect(chooseAutoFillAccountId(state)).toBeNull();
		expect(chooseAutoFillAccountId({ ...state, boundAccountIds: [other.id] })).toBe(other.id);
	});
	it('keeps multiple service accounts manual even with a favorite', () => {
		expect(chooseAutoFillAccountId(flow({ accounts: [github, { ...github, id: 'second' }], favoriteAccountIds: [github.id] }))).toBeNull();
	});
	it.each(['GitHub Work', 'My GitHub', 'GitHub主号', 'GitHub Enterprise'])(
		'counts %s as a possible second account without allowing it to trigger automatic filling',
		(name) => {
			const second = { ...github, id: 'second', name };
			expect(chooseAutoFillAccountId(flow({ accounts: [github, second] }))).toBeNull();
			expect(chooseAutoFillAccountId(flow({ accounts: [second] }))).toBeNull();
			expect(chooseAutoFillAccountId(flow({ unavailableAccounts: [{ id: 'bad', name }] }))).toBeNull();
		},
	);
	it('also counts a custom NodeSeek label that has no logo mapping', () => {
		expect(
			chooseAutoFillAccountId(
				flow({
					targetOrigin: 'https://nodeseek.com',
					accounts: [
						{ ...github, name: 'NodeSeek' },
						{ ...other, name: 'NodeSeek备用' },
					],
				}),
			),
		).toBeNull();
	});
	it('respects a unique explicit origin binding before service suggestions', () => {
		expect(chooseAutoFillAccountId(flow({ boundAccountIds: [other.id] }))).toBe(other.id);
		expect(chooseAutoFillAccountId(flow({ targetOrigin: 'http://custom.example:8080', boundAccountIds: [other.id] }))).toBe(other.id);
	});
	it.each([['other', 'github'], ['github', 'unavailable'], ['unavailable']].map((ids) => [ids]))(
		'does not ignore retained bindings %j',
		(retainedBindingIds) => {
			expect(chooseAutoFillAccountId(flow({ boundAccountIds: [github.id], retainedBindingIds }))).toBeNull();
		},
	);
	it('does not infer uniqueness by skipping an incompatible account of the same service', () => {
		expect(chooseAutoFillAccountId(flow({ unavailableAccounts: [{ id: 'broken', name: 'GitHub' }] }))).toBeNull();
		expect(chooseAutoFillAccountId(flow({ unavailableAccounts: [{ id: 'broken', name: 'Discord' }] }))).toBe(github.id);
	});
	it.each([{ viewOnly: true }, { canFill: false }, { accounts: [{ ...github, type: 'HOTP' }] }])(
		'never auto fills an ineligible flow %j',
		(overrides) => {
			expect(chooseAutoFillAccountId(flow(overrides))).toBeNull();
		},
	);
	it('does not fall back to the Google service name when page identity is absent', () => {
		expect(
			chooseAutoFillAccountId(flow({ targetOrigin: 'https://accounts.google.com', accounts: [{ ...github, name: 'Google' }] })),
		).toBeNull();
	});
});

describe('private IPv4 account destinations', () => {
	const targetOrigin = 'http://172.16.0.10';
	const account = { ...github, name: '172.16.0.10 堡垒机' };
	const privateFlow = (overrides = {}) => flow({ targetOrigin, accounts: [account, other], ...overrides });

	it.each([
		['http://172.16.0.10', '172.16.0.10 堡垒机'],
		['https://172.16.0.10', '172.16.0.10 堡垒机'],
		['http://172.16.0.10/', '172.16.0.10'],
		['http://172.16.0.10:80', '172.16.0.10'],
		['https://172.16.0.10:443', '172.16.0.10'],
		['http://10.0.0.1', '10.0.0.1'],
		['https://10.255.255.254', '10.255.255.254 管理'],
		['http://172.16.0.1', '172.16.0.1'],
		['https://172.31.255.254', '172.31.255.254'],
		['http://192.168.0.1', '192.168.0.1 路由器'],
		['https://192.168.255.254', '192.168.255.254'],
		['http://172.16.0.10', 'http://172.16.0.10 堡垒机'],
		['https://172.16.0.10', 'HTTPS://172.16.0.10 堡垒机'],
		['http://172.16.0.10:8080', '172.16.0.10:8080 堡垒机'],
		['https://172.16.0.10:8443', 'https://172.16.0.10:8443 堡垒机'],
		['http://172.16.0.10:443', 'http://172.16.0.10:443'],
		['https://172.16.0.10', '172.16.0.10:443'],
		['http://172.16.0.10', ' http://172.16.0.10:80 堡垒机 '],
	])('suggests and uniquely selects only the explicit address %s / %s', (origin, name) => {
		const state = privateFlow({ targetOrigin: origin, accounts: [{ ...account, name }, other] });
		expect(matchesSiteAccountName(name, origin)).toBe(true);
		expect(mayMatchSiteAccountName(name, origin)).toBe(true);
		expect(chooseAutoFillAccountId(state)).toBe(account.id);
		const choices = getAccountChoices(state);
		expect(choices.siteCount).toBe(1);
		expect(choices.choices.map(({ account: choice }) => choice.id)).toEqual([account.id]);
		expect(choices.choices[0]).toMatchObject({ suggested: true, bound: false });
	});

	it.each([
		'堡垒机 172.16.0.10',
		'172.16.0.10堡垒机',
		'1172.16.0.10',
		'172.16.0.1000',
		'172.16.0.10.evil.example',
		'http://172.16.0.10.evil.example',
		'http://user@172.16.0.10',
		'http://172.16.0.10@evil.example',
		'http://172.16.0.10/',
		'http://172.16.0.10/admin',
		'172.16.0.10/admin',
		'http://172.16.0.10?account=1',
		'http://172.16.0.10#admin',
		'172.16.0.10:0',
		'172.16.0.10:080',
		'172.16.0.10:65536',
		'172.16.0.10:999999',
		'172.16.0.10 192.168.1.1 堡垒机',
		'172.16.0.10 或 https://10.0.0.1',
		'172.16.0.10 https://another.example',
		'172.16.0.10/192.168.1.1',
		'172.16.0.10\n堡垒机',
		'172.16.0.10\t堡垒机',
		'１７２.１６.０.１０ 堡垒机',
		'172.016.0.10',
		'0xac10000a',
		'2886729738',
		'172.16.10',
		'http://172.016.0.10',
		'http://0xac10000a',
	])('never recommends or auto-selects ambiguous or noncanonical label %s', (name) => {
		const state = privateFlow({ accounts: [{ ...account, name }] });
		expect(matchesSiteAccountName(name, targetOrigin)).toBe(false);
		expect(chooseAutoFillAccountId(state)).toBeNull();
		expect(getAccountChoices(state).siteCount).toBe(0);
	});

	it.each([
		['http://172.16.0.11', '172.16.0.10'],
		['http://172.16.0.10:8080', '172.16.0.10'],
		['https://172.16.0.10:8443', '172.16.0.10'],
		['http://172.16.0.10:8081', '172.16.0.10:8080'],
		['http://172.16.0.10', 'https://172.16.0.10'],
		['https://172.16.0.10', 'http://172.16.0.10'],
		['https://172.16.0.10:8443', 'http://172.16.0.10:8443'],
		['http://172.16.0.10:443', 'https://172.16.0.10:443'],
		['https://172.16.0.10', '172.16.0.10:80'],
	])('keeps a different host, scheme or port manual: %s / %s', (origin, name) => {
		expect(matchesSiteAccountName(name, origin)).toBe(false);
		expect(mayMatchSiteAccountName(name, origin)).toBe(false);
		expect(chooseAutoFillAccountId(privateFlow({ targetOrigin: origin, accounts: [{ ...account, name }] }))).toBeNull();
	});

	it.each([
		'http://8.8.8.8',
		'https://8.8.8.8',
		'http://172.15.255.255',
		'https://172.32.0.1',
		'http://192.169.0.1',
		'http://100.64.0.1',
		'http://169.254.1.1',
		'http://127.0.0.1',
		'http://172.016.0.10',
		'http://0xac10000a',
		'http://2886729738',
		'http://172.16.10',
		'http://172.16.0.10.evil.example',
		'http://user@172.16.0.10',
		'http://172.16.0.10@evil.example',
		'http://172.16.0.10/admin',
		'http://172.16.0.10?next=1',
		'http://172.16.0.10#admin',
		'ftp://172.16.0.10',
	])('does not authorize a private address label on unsupported or noncanonical origin %s', (origin) => {
		const name = `${new URL(origin).hostname} 堡垒机`;
		expect(matchesSiteAccountName(name, origin)).toBe(false);
		expect(mayMatchSiteAccountName(name, origin)).toBe(false);
		expect(chooseAutoFillAccountId(privateFlow({ targetOrigin: origin, accounts: [{ ...account, name }] }))).toBeNull();
	});

	it('retains all same-address candidates even when one account is a favorite', () => {
		const second = { ...account, id: 'second', name: '172.16.0.10 运维' };
		const state = privateFlow({ accounts: [account, second], favoriteAccountIds: [account.id] });
		expect(getAccountChoices(state).siteCount).toBe(2);
		expect(chooseAutoFillAccountId(state)).toBeNull();
		expect(chooseAutoFillAccountId({ ...state, boundAccountIds: [second.id] })).toBe(second.id);
	});

	it.each([
		'172.16.0.10',
		'http://172.16.0.10 运维',
		'堡垒机 172.16.0.10',
		'172.16.0.10.evil.example',
		'172.16.0.10 192.168.1.1',
		'http://172.16.0.10/admin',
	])('does not infer uniqueness by ignoring a possible same-IP account: %s', (name) => {
		expect(mayMatchSiteAccountName(name, targetOrigin)).toBe(true);
		expect(chooseAutoFillAccountId(privateFlow({ accounts: [account, { ...other, name }] }))).toBeNull();
		expect(chooseAutoFillAccountId(privateFlow({ unavailableAccounts: [{ id: 'broken', name }] }))).toBeNull();
	});

	it('does not treat explicitly different ports or unrelated unavailable records as same-address ambiguity', () => {
		const state = privateFlow({
			accounts: [account, { ...other, name: '172.16.0.10:8080 管理' }],
			unavailableAccounts: [
				{ id: 'other-host', name: '172.16.0.11 堡垒机' },
				{ id: 'other-port', name: '172.16.0.10:8443 堡垒机' },
			],
		});
		expect(chooseAutoFillAccountId(state)).toBe(account.id);
	});
});
