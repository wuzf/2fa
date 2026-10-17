// @vitest-environment happy-dom

import { createContext, runInContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMainPage } from '../../src/ui/page.js';
import { getCoreCode } from '../../src/ui/scripts/core.js';
import { getSearchCode } from '../../src/ui/scripts/search.js';
import { getServiceAggregationCode } from '../../src/ui/scripts/serviceAggregation.js';
import { getStateCode } from '../../src/ui/scripts/state.js';

const html = await (await createMainPage()).text();
const accounts = [
	{ id: 'google', name: 'Google', account: 'a@example.com', secret: 'JBSWY3DPEHPK3PXP' },
	{ id: 'microsoft', name: 'Microsoft', account: 'a@example.com', secret: 'JBSWY3DPEHPK3PXP' },
	{ id: 'gmail', name: 'Gmail', account: 'z@example.com', secret: 'JBSWY3DPEHPK3PXP' },
	{ id: 'outlook', name: 'Outlook', account: 'z@example.com', secret: 'JBSWY3DPEHPK3PXP' },
];

function createHarness({ online, viewMode, defaultViewMode }) {
	document.body.innerHTML = html;
	localStorage.setItem('2fa-secrets-cache', JSON.stringify({ data: accounts, timestamp: 1 }));
	localStorage.setItem('2fa-view-mode', viewMode);
	if (defaultViewMode) {
		localStorage.setItem('2fa-default-view-mode', defaultViewMode);
	}
	localStorage.setItem('2fa-flat-sort-preference', 'newest-first');
	localStorage.setItem('2fa-group-item-sort-preference', 'account-desc');
	localStorage.setItem('2fa-group-sort-preference', 'name-desc');
	const listeners = new Map();
	const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => accounts }));
	const updateOTPSecretsInBatch = vi.fn(async () => {});
	const clock = vi.fn(async () => {});
	const warnings = vi.fn();
	const api = createContext({
		document: {
			getElementById: document.getElementById.bind(document),
			querySelector: document.querySelector.bind(document),
			querySelectorAll: document.querySelectorAll.bind(document),
			addEventListener: (type, listener) => listeners.set(type, listener),
		},
		window: { addEventListener: vi.fn(), innerHeight: 800 },
		navigator: { onLine: online },
		localStorage,
		console: { log() {}, warn: warnings, error: warnings },
		AbortController,
		performance,
		setTimeout,
		clearTimeout,
		setInterval: vi.fn(),
		clearInterval: vi.fn(),
		initializeTrustedClock: vi.fn(),
		ensureServerTimeSynchronized: clock,
		checkAuth: () => true,
		initTheme: vi.fn(),
		authenticatedFetch: fetch,
		updateOTPSecretsInBatch,
		startOTPInterval: vi.fn(),
		t: (key) => key,
		escapeHTML: (value) =>
			String(value).replace(
				/[&<>"']/g,
				(character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character],
			),
	});
	runInContext(getStateCode() + getSearchCode() + getCoreCode() + getServiceAggregationCode(), api);
	return { startPage: () => listeners.get('DOMContentLoaded')(), fetch, clock, updateOTPSecretsInBatch, warnings };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
	document.body.replaceChildren();
	localStorage.clear();
});

describe('saved view and sort preferences on cached startup', () => {
	it.each([
		{ online: true, viewMode: 'flat' },
		{ online: false, viewMode: 'flat' },
		{ online: true, viewMode: 'grouped' },
		{ online: false, viewMode: 'grouped' },
		{ online: true, viewMode: 'grouped', defaultViewMode: 'flat' },
		{ online: false, viewMode: 'grouped', defaultViewMode: 'flat' },
		{ online: true, viewMode: 'flat', defaultViewMode: 'grouped' },
		{ online: false, viewMode: 'flat', defaultViewMode: 'grouped' },
	])(
		'restores $viewMode / default $defaultViewMode before the first cached render (online: $online)',
		async ({ online, viewMode, defaultViewMode }) => {
			const h = createHarness({ online, viewMode, defaultViewMode });
			h.startPage();

			// Cache rendering is synchronous up to OTP generation. Assert the first
			// visible cards before an online response can mask a startup-order bug.
			const list = document.getElementById('secretsList');
			const grouped = (defaultViewMode || viewMode) === 'grouped';
			expect(list.classList.contains('is-grouped')).toBe(grouped);
			expect(list.style.display).toBe(grouped ? 'block' : 'grid');
			expect([...list.querySelectorAll('.otp-code')].map((node) => node.id)).toEqual(
				grouped ? ['otp-outlook', 'otp-microsoft', 'otp-gmail', 'otp-google'] : ['otp-outlook', 'otp-gmail', 'otp-microsoft', 'otp-google'],
			);
			expect([...list.querySelectorAll('.service-group-title')].map((node) => node.textContent)).toEqual(
				grouped ? ['Microsoft', 'Google'] : [],
			);
			expect(h.fetch).not.toHaveBeenCalled();
			const firstCard = list.querySelector('.secret-card');

			await vi.advanceTimersByTimeAsync(0);

			// An identical server snapshot deliberately keeps the original DOM.
			// Offline startup has no subsequent response that could repair it either.
			expect(list.querySelector('.secret-card')).toBe(firstCard);
			expect(h.updateOTPSecretsInBatch).toHaveBeenCalledOnce();
			expect(h.fetch).toHaveBeenCalledTimes(online ? 1 : 0);
			expect(h.clock).toHaveBeenCalledTimes(online ? 1 : 0);
			expect(h.warnings).not.toHaveBeenCalled();
		},
	);
});
