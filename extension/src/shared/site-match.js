import { isPrivateIPv4Host } from './origin.js';

// Credential destinations are deliberately separate from logo/search grouping.
// Every hostname is explicit: a service's tenant subdomains are not login hosts.
const SITES = [
	{ names: ['GitHub'], hosts: ['github.com', 'www.github.com'] },
	{ names: ['GitLab'], hosts: ['gitlab.com', 'www.gitlab.com'] },
	{ names: ['Bitbucket'], hosts: ['bitbucket.org', 'www.bitbucket.org'] },
	{ names: ['NodeSeek', 'Node Seek'], hosts: ['nodeseek.com', 'www.nodeseek.com'] },
	{ names: ['EU.org', 'EU org', 'EU-org', 'EUORG'], hosts: ['eu.org', 'www.eu.org', 'nic.eu.org'] },
	{ names: ['Linux DO', 'Linux.do'], hosts: ['linux.do', 'www.linux.do'] },
	{ names: ['Cloudflare'], hosts: ['cloudflare.com', 'www.cloudflare.com', 'dash.cloudflare.com'] },
	{ names: ['Vultr', 'vultr.com'], hosts: ['console.vultr.com'] },
	{ names: ['Microsoft', 'Outlook', 'Hotmail', 'Live'], hosts: ['login.live.com', 'account.live.com', 'account.microsoft.com'] },
	{ names: ['Discord'], hosts: ['discord.com', 'www.discord.com'] },
	{ names: ['Facebook'], hosts: ['facebook.com', 'www.facebook.com', 'm.facebook.com'] },
	{ names: ['Instagram'], hosts: ['instagram.com', 'www.instagram.com'] },
	{ names: ['npm', 'npmjs'], hosts: ['npmjs.com', 'www.npmjs.com'] },
	{ names: ['PyPI'], hosts: ['pypi.org', 'www.pypi.org'] },
];

function normalizeName(name) {
	return String(name || '')
		.normalize('NFKC')
		.trim()
		.toLowerCase()
		.replace(/\s+/g, ' ');
}

const sitesByHost = new Map();
for (const site of SITES) {
	const names = new Set([...site.names, ...site.hosts].map(normalizeName));
	for (const host of site.hosts) {
		sitesByHost.set(host, names);
	}
}

function namesForOrigin(targetOrigin) {
	try {
		const url = new URL(targetOrigin);
		if (url.protocol !== 'https:' || url.port || url.username || url.password) {
			return null;
		}
		return sitesByHost.get(url.hostname) || null;
	} catch {
		return null;
	}
}

function privateTarget(targetOrigin) {
	if (typeof targetOrigin !== 'string') {
		return null;
	}
	// Check the spelling before URL parsing can turn shortened, octal or hex hosts
	// into an apparently canonical IPv4 destination.
	const match = /^(https?):\/\/(\d{1,3}(?:\.\d{1,3}){3})(?::([1-9]\d{0,4}))?\/?$/i.exec(targetOrigin);
	if (!match || !isPrivateIPv4Host(match[2])) {
		return null;
	}
	try {
		return new URL(targetOrigin);
	} catch {
		return null;
	}
}

function privateAccountAddress(name) {
	if (typeof name !== 'string' || /\p{Cc}/u.test(name)) {
		return null;
	}
	const match = /^(?:(https?):\/\/)?(\d{1,3}(?:\.\d{1,3}){3})(?::([1-9]\d{0,4}))?(?: +(.+))?$/i.exec(name.trim());
	if (!match || !isPrivateIPv4Host(match[2]) || (match[3] && Number(match[3]) > 65535)) {
		return null;
	}
	// A descriptive label must not identify a second address or URL. Such names
	// remain manual instead of guessing which destination owns the credential.
	if (match[4] && /(?:\d{1,3}\.){3}\d{1,3}|https?:\/\//i.test(match[4])) {
		return null;
	}
	return { protocol: match[1]?.toLowerCase(), host: match[2], port: match[3] || '' };
}

function matchesPrivateAddress(address, target) {
	if (!address || address.host !== target.hostname || (address.protocol && `${address.protocol}:` !== target.protocol)) {
		return false;
	}
	if (!address.port) {
		return !target.port;
	}
	const targetPort = target.port || (target.protocol === 'https:' ? '443' : '80');
	return address.port === targetPort;
}

export function matchesSiteAccountName(name, targetOrigin) {
	const target = privateTarget(targetOrigin);
	if (target) {
		return matchesPrivateAddress(privateAccountAddress(name), target);
	}
	return namesForOrigin(targetOrigin)?.has(normalizeName(name)) || false;
}

// Similar labels may hide a second account. They can prevent automatic choice,
// but can never authorize a credential destination on their own.
export function mayMatchSiteAccountName(name, targetOrigin) {
	const target = privateTarget(targetOrigin);
	if (target) {
		const address = privateAccountAddress(name);
		if (address) {
			return matchesPrivateAddress(address, target);
		}
		// Malformed labels cannot recommend a destination, but a complete textual
		// mention may conceal a second account and must block inferred uniqueness.
		const host = target.hostname.replace(/\./g, '\\.');
		return new RegExp(`(?:^|[^0-9])${host}(?![0-9])`).test(String(name || ''));
	}
	const names = namesForOrigin(targetOrigin);
	if (!names) {
		return false;
	}
	const compact = (value) => normalizeName(value).replace(/[^\p{L}\p{N}]/gu, '');
	const candidate = compact(name);
	return [...names].some((known) => candidate.includes(compact(known)));
}

export function matchingSiteAccounts(flow) {
	return flow.accounts.filter((account) => account.type === 'TOTP' && matchesSiteAccountName(account.name, flow.targetOrigin));
}
