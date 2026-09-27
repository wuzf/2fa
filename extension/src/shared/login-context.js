export const GOOGLE_LOGIN_ORIGIN = 'https://accounts.google.com';

/**
 * Websites whose accounts are told apart by login email. Several accounts share
 * one sign-in origin there, so each remembered account is scoped by the email
 * the account itself records in the instance, whether or not a page shows one.
 */
export function usesLoginEmailScope(origin) {
	return origin === GOOGLE_LOGIN_ORIGIN;
}

export function normalizeLoginEmail(value) {
	if (typeof value !== 'string') {
		return null;
	}
	const email = value.trim().toLowerCase();
	return email.length <= 254 && /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,63}$/.test(email) ? email : null;
}

export function sanitizeLoginContext(value, origin) {
	if (origin !== GOOGLE_LOGIN_ORIGIN || value?.provider !== 'google') {
		return null;
	}
	const email = normalizeLoginEmail(value.email);
	return email ? { provider: 'google', email } : null;
}

export function loginContextsMatch(left, right) {
	return (!left && !right) || Boolean(left && right && left.provider === right.provider && left.email === right.email);
}
