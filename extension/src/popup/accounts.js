import { getLanguage, t } from '../shared/i18n.js';
import { getOtherServiceAccounts } from '../shared/search-family.js';
import { matchingLoginAccounts } from '../shared/account-match.js';
import { sanitizeLoginContext } from '../shared/login-context.js';
import { matchesSiteAccountName } from '../shared/site-match.js';
import { filterAccountsByQuery, getSearchFamilyNames } from '../../../src/shared/search-filter.js';

function normalize(value) {
	return String(value || '')
		.normalize('NFKC')
		.toLocaleLowerCase();
}

function compact(value) {
	return normalize(value).replace(/[^\p{L}\p{N}]/gu, '');
}

// A name hint only orders suggestions. It never creates a binding or selects a code.
function siteHint(targetOrigin) {
	try {
		const hostname = new URL(targetOrigin).hostname.replace(/\.$/, '');
		if (hostname === 'localhost' || /^[\d.:\[\]]+$/.test(hostname)) {
			return null;
		}
		if (['eu.org', 'www.eu.org', 'nic.eu.org'].includes(hostname)) {
			return { include: 'euorg', exclude: '' };
		}
		const labels = hostname.split('.');
		let serviceIndex = labels.length - 2;
		let label = labels[serviceIndex] || '';
		// EU.org also hosts independently operated domains; its suffix is not their service name.
		const euOrgUserDomain = hostname.endsWith('.eu.org');
		if (euOrgUserDomain || (labels.at(-1)?.length === 2 && ['co', 'com', 'org', 'net', 'ac'].includes(label))) {
			serviceIndex -= 1;
			label = labels[serviceIndex] || '';
		}
		const hint = compact(label);
		if (!hint) {
			return null;
		}
		// Short names such as EU need their domain suffix to avoid broad matches.
		return {
			include: hint.length >= 3 ? hint : compact(labels.slice(serviceIndex).join('.')),
			exclude: euOrgUserDomain ? 'euorg' : '',
		};
	} catch {
		return null;
	}
}

export function getAccountChoices(flow, { query = '', scope = 'site' } = {}) {
	const boundIds = new Set(flow.boundAccountIds || (flow.boundAccountId ? [flow.boundAccountId] : []));
	const favorites = new Set(flow.favoriteAccountIds || []);
	const hint = siteHint(flow.targetOrigin);
	const loginContext = sanitizeLoginContext(flow.loginContext, flow.targetOrigin);
	const loginMatches = new Set(matchingLoginAccounts(flow).map((account) => account.id));
	const searching = Boolean(String(query || '').trim());
	let matches;
	if (searching) {
		// Bridge labels reflect the complete vault, including accounts not offered for TOTP filling.
		const familyNames = flow.accounts.some((account) => typeof account.searchFamily !== 'string')
			? getSearchFamilyNames(flow.accounts)
			: new WeakMap();
		const otherServices = getOtherServiceAccounts(flow.accounts);
		for (const account of flow.accounts) {
			if (account.searchFamilyKind === 'other' || (typeof account.searchFamily !== 'string' && otherServices.has(account))) {
				familyNames.set(account, t('popupOtherServices'));
			} else if (typeof account.searchFamily === 'string') {
				familyNames.set(account, account.searchFamily);
			}
		}
		matches = new Set(filterAccountsByQuery(flow.accounts, query, familyNames));
	}
	const choices = flow.accounts.map((account) => {
		const bound = boundIds.has(account.id);
		const name = compact(account.name);
		const suggested =
			!bound &&
			(matchesSiteAccountName(account.name, flow.targetOrigin) ||
				Boolean(hint && name.includes(hint.include) && !(hint.exclude && name.includes(hint.exclude))));
		return {
			account,
			bound,
			suggested,
			favorite: favorites.has(account.id),
			...(loginMatches.has(account.id) ? { loginMatched: true } : {}),
		};
	});
	const siteCount = loginContext ? loginMatches.size : choices.filter((choice) => choice.bound || choice.suggested).length;
	const visible = choices.filter(({ account, bound, suggested }) => {
		if (searching) {
			return matches.has(account);
		}
		if (loginContext && scope !== 'all') {
			return loginMatches.has(account.id);
		}
		return scope === 'all' || siteCount === 0 || bound || suggested;
	});
	visible.sort((left, right) => {
		const rank = (choice) => (choice.bound ? 0 : choice.suggested ? 1 : 2);
		return (
			Number(right.favorite) - Number(left.favorite) ||
			rank(left) - rank(right) ||
			left.account.name.localeCompare(right.account.name, getLanguage()) ||
			left.account.account.localeCompare(right.account.account, getLanguage()) ||
			left.account.id.localeCompare(right.account.id)
		);
	});
	return { choices: visible, siteCount, totalCount: choices.length, searching };
}
