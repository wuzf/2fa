import { resolveServiceDomain } from '../../../src/shared/service-aggregation.js';
import { GOOGLE_LOGIN_ORIGIN, normalizeLoginEmail, sanitizeLoginContext } from './login-context.js';
import { matchingSiteAccounts, mayMatchSiteAccountName } from './site-match.js';

function isGoogleService(name) {
	const domain = resolveServiceDomain(name);
	return (
		domain === 'google.com' ||
		domain?.endsWith('.google.com') ||
		['gmail.com', 'youtube.com', 'googleapis.com', 'googlemail.com'].includes(domain)
	);
}

export function readAccountEmail(value) {
	const email = normalizeLoginEmail(value);
	if (email || typeof value !== 'string') {
		return email;
	}
	// Google Authenticator imports can retain an issuer-prefixed account label.
	// Require one recognized Google issuer and a complete email, not a substring.
	const parts = value.split(':');
	return parts.length === 2 && isGoogleService(parts[0]) ? normalizeLoginEmail(parts[1]) : null;
}

export function matchingLoginAccounts(flow) {
	const login = sanitizeLoginContext(flow.loginContext, flow.targetOrigin);
	if (!login || flow.targetOrigin !== GOOGLE_LOGIN_ORIGIN) {
		return [];
	}
	const bound = new Set(flow.boundAccountIds || (flow.boundAccountId ? [flow.boundAccountId] : []));
	return flow.accounts.filter((account) => {
		if (account.type !== 'TOTP' || readAccountEmail(account.account) !== login.email) {
			return false;
		}
		return isGoogleService(account.name) || bound.has(account.id);
	});
}

export function chooseAutoFillAccountId(flow) {
	if (flow.viewOnly || flow.canFill === false || !flow.targetOrigin) {
		return null;
	}
	const boundIds = flow.retainedBindingIds || flow.boundAccountIds || (flow.boundAccountId ? [flow.boundAccountId] : []);
	const unavailable = flow.unavailableAccounts || [];
	if (flow.loginContext) {
		const matches = matchingLoginAccounts(flow);
		// Diagnostics lack the email, so an unavailable Google record may be a second match.
		if (unavailable.some((account) => isGoogleService(account.name) || boundIds.includes(account.id))) {
			return null;
		}
		return matches.length === 1 ? matches[0].id : null;
	}
	if (boundIds.length) {
		const account = flow.accounts.find((account) => account.id === boundIds[0] && account.type === 'TOTP');
		return boundIds.length === 1 && account ? account.id : null;
	}
	if (unavailable.some((account) => mayMatchSiteAccountName(account.name, flow.targetOrigin))) {
		return null;
	}
	const matches = matchingSiteAccounts(flow);
	const possibleMatches = flow.accounts.filter(
		(account) => account.type === 'TOTP' && mayMatchSiteAccountName(account.name, flow.targetOrigin),
	);
	return matches.length === 1 && possibleMatches.length === 1 ? matches[0].id : null;
}
