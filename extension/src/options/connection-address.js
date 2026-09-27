import { normalizeInstanceOrigin } from '../shared/origin.js';

export function normalizeConnectionAddress(value) {
	if (typeof value !== 'string' || value.trim() === '') {
		return normalizeInstanceOrigin(value);
	}
	const address = value.trim();
	if (/\p{Cc}/u.test(address)) {
		throw new Error('实例地址不是有效 URL');
	}
	// A dotted hostname or localhost followed by a numeric port is not a URL
	// scheme. Other explicit schemes must reach the shared protocol validator.
	const hostWithPort = /^(?:localhost|[^/?#:@\\\s]+\.[^/?#:@\\\s]+):\d+(?:[/?#]|$)/i.test(address);
	if (/^[a-z][a-z\d+.-]*:/i.test(address) && !hostWithPort) {
		return normalizeInstanceOrigin(address);
	}
	const localAddress = /^(?:localhost|127\.0\.0\.1)(?::\d+)?(?:[/?#]|$)/i.test(address);
	return normalizeInstanceOrigin(`${localAddress ? 'http' : 'https'}://${address}`);
}
