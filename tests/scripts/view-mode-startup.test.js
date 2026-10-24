import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeFixture } from '../helpers/theme-runtime.js';
import { createAppearanceController } from '../../src/ui/scripts/appearanceRuntime.js';
import { getBuiltinTheme } from '../../src/themes/builtins.js';

const accounts = [
	{ id: 'google', name: 'Google', account: 'a@example.com', secret: 'JBSWY3DPEHPK3PXP' },
	{ id: 'microsoft', name: 'Microsoft', account: 'a@example.com', secret: 'JBSWY3DPEHPK3PXP' },
	{ id: 'gmail', name: 'Gmail', account: 'z@example.com', secret: 'JBSWY3DPEHPK3PXP' },
	{ id: 'outlook', name: 'Outlook', account: 'z@example.com', secret: 'JBSWY3DPEHPK3PXP' },
];

const fixtures = [];
afterEach(async () => {
	await Promise.all(fixtures.splice(0).map((h) => h.dispose()));
});
async function createHarness({ online, viewMode, defaultViewMode }) {
	const fetch = vi.fn(async () => Response.json(accounts));
	const clock = vi.fn(async () => true);
	const warnings = vi.fn();
	const h = await createRuntimeFixture({
		fetch,
		setupWindow(window) {
			window.localStorage.setItem('2fa-secrets-cache', JSON.stringify({ data: accounts, timestamp: 1 }));
			window.localStorage.setItem('2fa-view-mode', viewMode);
			if (defaultViewMode) {
				window.localStorage.setItem('2fa-default-view-mode', defaultViewMode);
			}
			window.localStorage.setItem('2fa-flat-sort-preference', 'newest-first');
			window.localStorage.setItem('2fa-group-item-sort-preference', 'account-desc');
			window.localStorage.setItem('2fa-group-sort-preference', 'name-desc');
			Object.defineProperty(window.navigator, 'onLine', { value: online, configurable: true });
			window.__startupClock = clock;
			window.console = { log() {}, warn: warnings, error: warnings };
		},
		extraSource:
			'initializeTrustedClock=()=>{}; ensureServerTimeSynchronized=window.__startupClock; initCustomCodeAutoReload=()=>{}; const startupLoad=loadSecrets; loadSecrets=(...args)=>window.__startupLoad=startupLoad(...args);',
	});
	fixtures.push(h);
	h.setClock(59000);
	return { ...h, startPage: h.initializeThemeApplication, selectViewMode: h.window.selectViewMode, fetch, clock, warnings };
}

describe('saved view and sort preferences on cached startup', () => {
	it('preserves the account grid marker through actual view changes and theme switches', async () => {
		const h = await createHarness({ online: false, viewMode: 'grouped' });
		h.startPage();
		await h.window.__startupLoad;
		const list = h.document.getElementById('secretsList');
		const controller = createAppearanceController(h.document);
		for (const theme of ['compact', 'document', 'compact']) {
			controller.apply(getBuiltinTheme(theme));
			for (const mode of ['flat', 'grouped', 'flat']) {
				await h.selectViewMode(mode);
				expect(h.document.getElementById('secretsList')).toBe(list);
				expect(list.dataset.part).toBe('account-grid');
				expect(list.dataset.view).toBe(mode);
				expect(list.querySelectorAll('.secret-card')).toHaveLength(accounts.length);
			}
		}
		expect(h.warnings).not.toHaveBeenCalled();
	});
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
			const h = await createHarness({ online, viewMode, defaultViewMode });
			h.startPage();

			// Cache rendering is synchronous up to OTP generation. Assert the first
			// visible cards before an online response can mask a startup-order bug.
			const list = h.document.getElementById('secretsList');
			const grouped = (defaultViewMode || viewMode) === 'grouped';
			expect(list.classList.contains('is-grouped')).toBe(grouped);
			expect(list.dataset.view).toBe(grouped ? 'grouped' : 'flat');
			expect(list.style.display).toBe('');
			expect(list.hidden).toBe(false);
			expect(h.window.getComputedStyle(list).display).toBe(grouped ? 'block' : 'grid');
			expect([...list.querySelectorAll('.otp-code')].map((node) => node.id)).toEqual(
				grouped ? ['otp-outlook', 'otp-microsoft', 'otp-gmail', 'otp-google'] : ['otp-outlook', 'otp-gmail', 'otp-microsoft', 'otp-google'],
			);
			expect([...list.querySelectorAll('.service-group-title')].map((node) => node.textContent)).toEqual(
				grouped ? ['Microsoft', 'Google'] : [],
			);
			expect(h.fetch).not.toHaveBeenCalled();
			const firstCard = list.querySelector('.secret-card');

			await h.window.__startupLoad;

			// An identical server snapshot deliberately keeps the original DOM.
			// Offline startup has no subsequent response that could repair it either.
			expect(list.querySelector('.secret-card')).toBe(firstCard);
			expect(h.getThemeRuntime().sdk.getSnapshot().library.accounts).toHaveLength(accounts.length);
			expect(h.fetch.mock.calls.filter(([url]) => url === '/api/secrets')).toHaveLength(online ? 1 : 0);
			expect(h.clock).toHaveBeenCalledTimes(online ? 1 : 0);
			expect(h.warnings).not.toHaveBeenCalled();
		},
	);
});
