import { GOOGLE_LOGIN_ORIGIN, normalizeLoginEmail } from '../shared/login-context.js';
import { treeParent } from './dom.js';

function visible(element) {
	if (!element?.isConnected || element.getClientRects().length === 0) {
		return false;
	}
	for (let current = element; current; current = treeParent(current)) {
		const style = current.ownerDocument.defaultView.getComputedStyle(current);
		if (
			current.hidden ||
			current.hasAttribute('inert') ||
			current.getAttribute('aria-hidden') === 'true' ||
			['none'].includes(style.display) ||
			['hidden', 'collapse'].includes(style.visibility) ||
			style.opacity === '0' ||
			style.contentVisibility === 'hidden'
		) {
			return false;
		}
	}
	return true;
}

// Read the account identifier, never free-form page text or URL/session parameters.
export function readLoginContext(doc = globalThis.document) {
	if (doc?.location?.origin !== GOOGLE_LOGIN_ORIGIN || !/^\/(?:v3\/signin|signin\/v2)\/challenge\/totp\/?$/.test(doc.location.pathname)) {
		return null;
	}
	const pins = [...doc.querySelectorAll('input#totpPin[name="totpPin"]')].filter(visible);
	if (pins.length !== 1) {
		return null;
	}
	const identifiers = [...doc.querySelectorAll('[data-profile-identifier]')].filter(visible);
	if (identifiers.length !== 1) {
		return null;
	}
	const selected = identifiers[0].closest('[role="link"][aria-label]');
	const email = normalizeLoginEmail(identifiers[0].textContent);
	const hidden = doc.querySelectorAll('input#identifierId[type="hidden"]');
	if (!selected || !visible(selected) || !email || hidden.length !== 1 || normalizeLoginEmail(hidden[0].value) !== email) {
		return null;
	}
	return { provider: 'google', email };
}
