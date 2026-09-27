import { resolveServiceDomain } from '../../../src/shared/service-aggregation.js';
import { normalizeInstanceOrigin } from './origin.js';

const MAX_DOMAINS = 128;
const MAX_IMAGE_BYTES = 32 * 1024;
const MAX_TOTAL_CHARS = 1024 * 1024;
const FETCH_BUDGET_MS = 18000;
const IMAGE_TYPE = /^image\/(?:png|jpeg|webp|gif|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml)$/;
const DATA_IMAGE = /^data:(image\/(?:png|jpeg|webp|gif|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml));base64,([A-Za-z0-9+/]+={0,2})$/;
// Remember only one instance, so repeatedly slow domains cannot starve later
// accounts on each online refresh without retaining an unbounded per-site map.
let fetchCursor = { origin: null, nextDomain: null };

function validDomain(value) {
	return (
		typeof value === 'string' &&
		value.length <= 253 &&
		value.includes('.') &&
		value.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
	);
}

export function collectServiceDomains(accounts) {
	const domains = new Set();
	for (const account of Array.isArray(accounts) ? accounts : []) {
		if (typeof account?.name !== 'string') {
			continue;
		}
		const domain = resolveServiceDomain(account.name);
		if (validDomain(domain)) {
			domains.add(domain);
		}
		if (domains.size === MAX_DOMAINS) {
			break;
		}
	}
	return [...domains];
}

export function sanitizeServiceIcons(value, domains) {
	const icons = {};
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return icons;
	}
	const allowed = domains === undefined ? null : new Set(domains);
	let total = 0;
	let count = 0;
	for (const [domain, data] of Object.entries(value)) {
		if (!validDomain(domain) || (allowed && !allowed.has(domain)) || typeof data !== 'string') {
			continue;
		}
		if (data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64 || total + data.length > MAX_TOTAL_CHARS) {
			continue;
		}
		const match = DATA_IMAGE.exec(data);
		if (!match) {
			continue;
		}
		try {
			const bytes = atob(match[2]);
			if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || btoa(bytes) !== match[2]) {
				continue;
			}
		} catch {
			continue;
		}
		icons[domain] = data;
		total += data.length;
		if (++count === MAX_DOMAINS) {
			break;
		}
	}
	return icons;
}

function abortable(promise, signal) {
	return new Promise((resolve, reject) => {
		const abort = () => reject(new Error('Icon read cancelled'));
		if (signal.aborted) {
			abort();
		} else {
			signal.addEventListener('abort', abort, { once: true });
		}
		Promise.resolve(promise)
			.then(resolve, reject)
			.finally(() => signal.removeEventListener('abort', abort));
	});
}

async function readImage(response, signal) {
	const type = response?.headers?.get('content-type')?.split(';')[0].trim().toLowerCase();
	if (!response?.ok || response.redirected || !IMAGE_TYPE.test(type || '') || !response.body?.getReader) {
		response?.body?.cancel?.().catch(() => {});
		return null;
	}
	if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) {
		response.body.cancel().catch(() => {});
		return null;
	}
	const reader = response.body.getReader();
	let size = 0;
	let binary = '';
	try {
		while (!signal.aborted) {
			const { value, done } = await abortable(reader.read(), signal);
			if (done) {
				return size ? `data:${type};base64,${btoa(binary)}` : null;
			}
			size += value.byteLength;
			if (size > MAX_IMAGE_BYTES) {
				return null;
			}
			binary += String.fromCharCode(...value);
		}
		return null;
	} finally {
		// Do not wait for a stalled stream to acknowledge cancellation.
		reader.cancel().catch(() => {});
	}
}

export async function fetchServiceIcons(
	instanceOrigin,
	accounts,
	{ cached = {}, signal, timeoutMs = FETCH_BUDGET_MS, excludedDomains = [], checkCurrent, onResult } = {},
) {
	const domains = collectServiceDomains(accounts);
	const icons = sanitizeServiceIcons(cached, domains);
	const budgetMs = Number.isFinite(timeoutMs) ? Math.max(0, Math.min(FETCH_BUDGET_MS, timeoutMs)) : FETCH_BUDGET_MS;
	try {
		if (normalizeInstanceOrigin(instanceOrigin) !== instanceOrigin || signal?.aborted || budgetMs === 0) {
			return icons;
		}
	} catch {
		return icons;
	}
	if (fetchCursor.origin !== instanceOrigin) {
		fetchCursor = { origin: instanceOrigin, nextDomain: null };
	}
	const cursor = fetchCursor;
	const start = Math.max(0, domains.indexOf(cursor.nextDomain));
	const excluded = new Set(excludedDomains);
	const pending = [...domains.slice(start), ...domains.slice(0, start)].filter((domain) => !icons[domain] && !excluded.has(domain));
	if (!pending.length) {
		return icons;
	}
	const controller = new AbortController();
	const cancel = () => controller.abort();
	signal?.addEventListener('abort', cancel, { once: true });
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		cancel();
	}, budgetMs);
	let index = 0;
	let total = Object.values(icons).reduce((sum, icon) => sum + icon.length, 0);
	async function worker() {
		while (!controller.signal.aborted && index < pending.length && total < MAX_TOTAL_CHARS) {
			const domain = pending[index++];
			let attempted = false;
			try {
				if (checkCurrent) {
					try {
						await abortable(checkCurrent(), controller.signal);
					} catch {
						cancel();
						return;
					}
				}
				if (controller.signal.aborted || globalThis.navigator?.onLine === false) {
					cancel();
					return;
				}
				attempted = true;
				const response = await abortable(
					fetch(`${instanceOrigin}/api/favicon/${encodeURIComponent(domain)}`, {
						credentials: 'omit',
						redirect: 'error',
						referrerPolicy: 'no-referrer',
						signal: controller.signal,
					}),
					controller.signal,
				);
				const data = await readImage(response, controller.signal);
				if (data && !controller.signal.aborted && total + data.length <= MAX_TOTAL_CHARS) {
					icons[domain] = data;
					total += data.length;
				}
			} catch {
				// Icons are optional; a failure must not prevent accounts from syncing.
			} finally {
				if (attempted && (!controller.signal.aborted || timedOut)) {
					onResult?.(domain, Boolean(icons[domain]));
				}
			}
		}
	}
	try {
		await Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker));
	} finally {
		clearTimeout(timeout);
		signal?.removeEventListener('abort', cancel);
		if (fetchCursor === cursor) {
			cursor.nextDomain = timedOut && index < pending.length ? pending[index] : null;
		}
	}
	return sanitizeServiceIcons(icons, domains);
}

// This function is serialized into the main website. Keep every dependency local
// and use Cache Storage only, so importing offline accounts never starts requests.
export async function readWebServiceIcons(origin, domains) {
	const icons = {};
	let controller;
	let timeout;
	try {
		const url = new URL(origin);
		if (
			url.origin !== origin ||
			globalThis.location.origin !== origin ||
			(url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) ||
			!Array.isArray(domains)
		) {
			return icons;
		}
		const selected = [...new Set(domains)]
			.filter(
				(domain) =>
					typeof domain === 'string' &&
					domain.length <= 253 &&
					domain.includes('.') &&
					domain.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)),
			)
			.slice(0, 128);
		controller = new AbortController();
		timeout = setTimeout(() => controller.abort(), 3000);
		const bounded = (promise) =>
			new Promise((resolve, reject) => {
				const cancel = () => reject(new Error('Icon read cancelled'));
				if (controller.signal.aborted) {
					cancel();
				} else {
					controller.signal.addEventListener('abort', cancel, { once: true });
				}
				Promise.resolve(promise)
					.then(resolve, reject)
					.finally(() => controller.signal.removeEventListener('abort', cancel));
			});
		let index = 0;
		let total = 0;
		const worker = async () => {
			while (!controller.signal.aborted && index < selected.length && total < 1024 * 1024) {
				const domain = selected[index++];
				let reader;
				try {
					const expected = `${origin}/api/favicon/${encodeURIComponent(domain)}`;
					const response = await bounded(caches.match(expected));
					const type = response?.headers?.get('content-type')?.split(';')[0].trim().toLowerCase();
					if (
						!response?.ok ||
						response.redirected ||
						(response.url && response.url !== expected) ||
						!/^image\/(?:png|jpeg|webp|gif|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml)$/.test(type || '') ||
						Number(response.headers.get('content-length')) > 32 * 1024 ||
						!response.body?.getReader
					) {
						response?.body?.cancel?.().catch(() => {});
						continue;
					}
					reader = response.body.getReader();
					let size = 0;
					let binary = '';
					while (!controller.signal.aborted) {
						const { value, done } = await bounded(reader.read());
						if (done) {
							const data = `data:${type};base64,${btoa(binary)}`;
							if (size && !controller.signal.aborted && total + data.length <= 1024 * 1024) {
								icons[domain] = data;
								total += data.length;
							}
							break;
						}
						size += value.byteLength;
						if (size > 32 * 1024) {
							break;
						}
						binary += String.fromCharCode(...value);
					}
				} catch {
					// Missing, opaque, corrupt or unavailable entries keep the letter fallback.
				} finally {
					reader?.cancel().catch(() => {});
				}
			}
		};
		await Promise.all(Array.from({ length: Math.min(4, selected.length) }, worker));
	} catch {
		// A blocked Cache Storage implementation should not block the import.
	} finally {
		clearTimeout(timeout);
	}
	return icons;
}
