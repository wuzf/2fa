import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeFixture } from '../helpers/theme-runtime.js';

const fixtures = [];
afterEach(async () => {
	for (const fixture of fixtures.splice(0)) {
		await fixture.dispose();
	}
});

async function createHarness(initialStorage = {}) {
	const clipboard = { writeText: vi.fn(async () => {}) };
	const fixture = await createRuntimeFixture({
		clipboard,
		extraSource: `window.__aggregationFixture = {
    filterSecrets, getServiceLogo, initSortDropdownOutsideClose, copyNextOTP, copyOTP,
    renderSecrets, renderFilteredSecrets, setLanguage, hideSecretModal, restoreGroupSortPreference,
    restoreSortPreference, restoreViewModePreference, selectViewMode, otpCalculator,
    setSecrets(value) { replaceSecretRecords(value, { source: 'server', accessVerified: true }); },
    getOTPIntervalIds: () => Object.keys(otpIntervals)
  };`,
	});
	fixtures.push(fixture);
	const { window, document } = fixture;
	const localStorage = window.localStorage;
	for (const [key, value] of Object.entries({ language: 'zh-CN', ...initialStorage })) {
		localStorage.setItem(key, value);
	}
	vi.spyOn(localStorage, 'setItem');
	const setInterval = vi.spyOn(window, 'setInterval');
	const clearInterval = vi.spyOn(window, 'clearInterval');
	vi.spyOn(window, 'addEventListener');
	fixture.setClock(50_000);
	const api = window.__aggregationFixture;
	api.setLanguage(initialStorage.language || 'zh-CN');
	const codes = new Map();
	const current = vi.fn(async (account) => codes.get(String(account.id))?.current || '-'.repeat(Number(account.digits) || 6));
	const next = vi.fn(async (account) => codes.get(String(account.id))?.next || '-'.repeat(Number(account.digits) || 6));
	api.otpCalculator.calculateCurrentOTP = current;
	api.otpCalculator.calculateNextOTP = next;
	const runtime = fixture.getThemeRuntime();
	fixture.getOfficialAccountView();
	return {
		...fixture,
		api,
		runtime,
		localStorage,
		navigator: window.navigator,
		clearInterval,
		setInterval,
		calculations: { current, next },
		async commitCodes(id, currentCode, nextCode) {
			codes.set(String(id), { current: currentCode, next: nextCode });
			await runtime.otp.refresh([id]);
		},
		dropdown: document.getElementById('sortDropdown'),
		trigger: document.querySelector('#sortDropdown .sort-trigger'),
		flatOption: document.querySelector('[data-view-mode="flat"]'),
		groupedOption: document.querySelector('[data-view-mode="grouped"]'),
	};
}

function secret(id, name, account = '') {
	return { id, name, account, secret: 'JBSWY3DPEHPK3PXP' };
}

const TEST_SECRETS = [
	secret('google', 'Google', 'owner@example.com'),
	secret('gmail', 'Gmail', 'mail@example.com'),
	secret('microsoft', 'Microsoft', 'admin@example.com'),
	secret('outlook', 'Outlook', 'work@example.com'),
	secret('github', 'GitHub', 'code@example.com'),
];

describe('smart aggregation rendering integration', () => {
	it('renders grouped and flat DOM and removes stale active states during mode changes', async () => {
		const { api, document, flatOption, groupedOption, localStorage } = await createHarness();
		api.restoreSortPreference();
		api.restoreGroupSortPreference();
		api.restoreViewModePreference();
		api.setSecrets(TEST_SECRETS);
		await api.renderFilteredSecrets();

		const list = document.getElementById('secretsList');
		expect(list.classList.contains('is-grouped')).toBe(true);
		expect(list.getAttribute('data-view')).toBe('grouped');
		expect(list.hidden).toBe(false);
		expect(list.style.display).toBe('');
		expect(Array.from(list.querySelectorAll('.service-group-title')).map((node) => node.textContent)).toEqual([
			'Google',
			'Microsoft',
			'其他服务',
		]);
		expect(Array.from(list.querySelectorAll('.service-group-count')).map((node) => node.textContent)).toEqual(['2 个', '2 个', '1 个']);
		expect(list.querySelectorAll('.secret-card')).toHaveLength(TEST_SECRETS.length);
		expect(groupedOption.classList.contains('active')).toBe(true);
		expect(groupedOption.getAttribute('aria-pressed')).toBe('true');
		expect(flatOption.classList.contains('active')).toBe(false);
		expect(flatOption.getAttribute('aria-pressed')).toBe('false');

		await api.selectViewMode('flat');

		expect(list.classList.contains('is-grouped')).toBe(false);
		expect(list.getAttribute('data-view')).toBe('flat');
		expect(list.hidden).toBe(false);
		expect(list.style.display).toBe('');
		expect(list.querySelectorAll('.service-group')).toHaveLength(0);
		expect(list.querySelectorAll('.secret-card')).toHaveLength(TEST_SECRETS.length);
		expect(groupedOption.classList.contains('active')).toBe(false);
		expect(flatOption.classList.contains('active')).toBe(true);
		expect(flatOption.getAttribute('aria-pressed')).toBe('true');
		expect(localStorage.setItem).toHaveBeenCalledWith('2fa-view-mode', 'flat');
	});

	it('renders global search results and per-group matched/total counts from the full list', async () => {
		const { api, document } = await createHarness();
		api.setSecrets(TEST_SECRETS);
		await api.filterSecrets('gmail');

		const list = document.getElementById('secretsList');
		const stats = document.getElementById('searchStats');
		const groupCount = list.querySelector('.service-group-count');
		expect(stats.textContent).toBe('找到 1 个匹配密钥（共 5 个）');
		expect(stats.style.display).toBe('');
		expect(list.querySelectorAll('.service-group')).toHaveLength(1);
		expect(list.querySelector('.service-group-title').textContent).toBe('Google');
		expect(groupCount.textContent).toBe('1 / 2');
		expect(groupCount.getAttribute('aria-label')).toBe('匹配 1 个，共 2 个');
		expect(list.querySelectorAll('.secret-card')).toHaveLength(1);
		expect(list.querySelector('h3').textContent).toBe('Gmail');
	});

	it('renders accounts while computation is pending and retains a single presentation timer across redraws', async () => {
		const h = await createHarness();
		let settleCurrent;
		let settleNext;
		const current = new Promise((resolve) => {
			settleCurrent = resolve;
		});
		const next = new Promise((resolve) => {
			settleNext = resolve;
		});
		h.calculations.current.mockImplementation(() => current);
		h.calculations.next.mockImplementation(() => next);
		const records = TEST_SECRETS.slice(0, 2);
		h.api.setSecrets(records);
		h.api.renderFilteredSecrets();
		expect(h.document.querySelectorAll('.secret-card')).toHaveLength(2);
		expect(h.runtime.otp.readCommitted('google')).toBeNull();
		expect(h.api.getOTPIntervalIds()).toEqual([]);
		expect(h.setInterval.mock.calls.filter(([, delay]) => delay === 1000)).toHaveLength(1);
		const calculationCount = h.calculations.current.mock.calls.length;
		h.api.renderFilteredSecrets();
		expect(h.calculations.current).toHaveBeenCalledTimes(calculationCount);
		const completed = h.runtime.otp.refresh(records.map((record) => record.id));
		settleCurrent('111111');
		settleNext('222222');
		await completed;
		expect(h.document.getElementById('otp-google').textContent).toBe('111111');
		expect(h.document.getElementById('next-otp-gmail').textContent).toBe('222222');
		expect(h.setInterval.mock.calls.filter(([, delay]) => delay === 1000)).toHaveLength(1);
	});

	it('searches displayed family names in grouped and flat views', async () => {
		const { api, document } = await createHarness();
		const familySecrets = [
			secret('gmail', 'Gmail', 'mail@example.com'),
			secret('youtube', 'YouTube', 'video@example.com'),
			secret('outlook', 'Outlook', 'work@example.com'),
			secret('onedrive', 'OneDrive', 'files@example.com'),
			secret('aws', 'AWS', 'cloud@example.com'),
			secret('prime-video', 'Prime Video', 'watch@example.com'),
		];
		const expectedFamilies = [
			['Google', ['Gmail', 'YouTube']],
			['Microsoft', ['Outlook', 'OneDrive']],
			['Amazon', ['AWS', 'Prime Video']],
		];
		const list = document.getElementById('secretsList');

		api.setSecrets(familySecrets);
		for (const [familyName, expectedNames] of expectedFamilies) {
			await api.filterSecrets(familyName);

			expect(list.querySelectorAll('.service-group')).toHaveLength(1);
			expect(list.querySelector('.service-group-title').textContent).toBe(familyName);
			expect(Array.from(list.querySelectorAll('h3')).map((node) => node.textContent)).toEqual(expectedNames);
		}

		await api.selectViewMode('flat');
		for (const [familyName, expectedNames] of expectedFamilies) {
			await api.filterSecrets(familyName);

			expect(list.querySelectorAll('.service-group')).toHaveLength(0);
			expect(Array.from(list.querySelectorAll('h3')).map((node) => node.textContent)).toEqual(expectedNames);
		}

		await api.filterSecrets('files@example.com');
		expect(Array.from(list.querySelectorAll('h3')).map((node) => node.textContent)).toEqual(['OneDrive']);
	});

	it('keeps family-name search working after replacing an item with the same service name', async () => {
		const { api, document } = await createHarness();
		const editedSecrets = [secret('gmail', 'Gmail', 'before@example.com'), secret('youtube', 'YouTube', 'video@example.com')];

		api.setSecrets(editedSecrets);
		await api.filterSecrets('google');
		editedSecrets[0] = secret('gmail', 'Gmail', 'after@example.com');
		api.setSecrets(editedSecrets);
		await api.filterSecrets('google');

		const list = document.getElementById('secretsList');
		expect(Array.from(list.querySelectorAll('h3')).map((node) => node.textContent)).toEqual(['Gmail', 'YouTube']);
		expect(Array.from(list.querySelectorAll('p')).map((node) => node.textContent)).toContain('after@example.com');
	});

	it('uses the smart service resolver for card logos', async () => {
		const { api } = await createHarness();

		expect(api.getServiceLogo('GoogleCloud')).toBe('/api/favicon/cloud.google.com');
		expect(api.getServiceLogo('AWSConsole')).toBe('/api/favicon/aws.amazon.com');
		expect(api.getServiceLogo('AppleMusic')).toBe('/api/favicon/music.apple.com');
		expect(api.getServiceLogo('GitHubEnterprise')).toBe('/api/favicon/github.com');
		expect(api.getServiceLogo('Google Cloud Platform')).toBe('/api/favicon/cloud.google.com');
		expect(api.getServiceLogo('gmail.user@example.com')).toBeNull();
		expect(api.getServiceLogo('github.com.evil.example')).toBeNull();
	});

	it('searches the displayed other-services heading', async () => {
		const { api, document } = await createHarness();
		api.setSecrets([
			secret('google', 'Google', 'owner@example.com'),
			secret('gmail', 'Gmail', 'mail@example.com'),
			secret('github', 'GitHub', 'code@example.com'),
			secret('discord', 'Discord', 'chat@example.com'),
		]);

		await api.filterSecrets('其他服务');

		const list = document.getElementById('secretsList');
		expect(list.querySelector('.service-group-title').textContent).toBe('其他服务');
		expect(list.querySelector('.service-group-count').textContent).toBe('2 个');
		expect(Array.from(list.querySelectorAll('h3')).map((node) => node.textContent)).toEqual(['GitHub', 'Discord']);
	});

	it('shows no heading when no service has two or more accounts', async () => {
		const { api, document } = await createHarness();
		api.restoreViewModePreference();
		api.setSecrets([secret('github', 'GitHub', 'code@example.com'), secret('discord', 'Discord', 'chat@example.com')]);
		await api.renderFilteredSecrets();

		const list = document.getElementById('secretsList');
		expect(list.classList.contains('is-grouped')).toBe(true);
		expect(list.querySelectorAll('.service-group-header')).toHaveLength(0);
		expect(list.querySelectorAll('.service-group-grid')).toHaveLength(1);
		expect(list.querySelectorAll('.secret-card')).toHaveLength(2);

		// Adding a second account of a service brings the headings back.
		api.setSecrets([
			secret('github', 'GitHub', 'code@example.com'),
			secret('github-work', 'GitHub', 'work@example.com'),
			secret('discord', 'Discord', 'chat@example.com'),
		]);
		await api.renderFilteredSecrets();
		expect(Array.from(list.querySelectorAll('.service-group-title')).map((node) => node.textContent)).toEqual(['GitHub', '其他服务']);
	});

	it('does not copy failed eight-digit OTPs or DOM forgeries and copies only committed values', async () => {
		const h = await createHarness();
		h.api.setSecrets([{ id: 'eight', name: 'Eight digit', digits: 8, secret: 'JBSWY3DPEHPK3PXP' }]);
		await h.runtime.otp.refresh(['eight']);
		await h.api.copyOTP('eight');
		await h.api.copyNextOTP('eight');
		expect(h.navigator.clipboard.writeText).not.toHaveBeenCalled();
		const current = h.document.getElementById('otp-eight');
		const next = h.document.getElementById('next-otp-eight');
		current.textContent = '99999999';
		next.textContent = '88888888';
		await h.api.copyOTP('eight');
		await h.api.copyNextOTP('eight');
		expect(h.navigator.clipboard.writeText).not.toHaveBeenCalled();
		await h.commitCodes('eight', '12345678', '87654321');
		current.textContent = '99999999';
		next.textContent = '88888888';
		await h.api.copyOTP('eight');
		await h.api.copyNextOTP('eight');
		expect(h.navigator.clipboard.writeText.mock.calls).toEqual([['12345678'], ['87654321']]);
		expect(current.textContent).toBe('12345678');
		expect(next.textContent).toBe('87654321');
	});

	it('closes the sort dropdown with Escape and restores focus to its trigger', async () => {
		const { api, document, dropdown, flatOption, trigger, window } = await createHarness();
		flatOption.focus();
		dropdown.setAttribute('open', '');
		api.initSortDropdownOutsideClose();

		document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', ctrlKey: false, bubbles: true }));

		expect(dropdown.hasAttribute('open')).toBe(false);
		expect(document.activeElement).toBe(trigger);
		expect(window.addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
	});

	it('removes unmatched cards without introducing per-card timers or repeating OTP computations', async () => {
		const h = await createHarness();
		h.api.setSecrets(TEST_SECRETS);
		await h.runtime.otp.refresh();
		const calculations = h.calculations.current.mock.calls.length;
		await h.api.filterSecrets('not-present');
		expect(h.api.getOTPIntervalIds()).toEqual([]);
		expect(h.document.getElementById('secretsList').innerHTML).toBe('');
		expect(h.calculations.current).toHaveBeenCalledTimes(calculations);
		expect(h.setInterval.mock.calls.filter(([, delay]) => delay === 1000)).toHaveLength(1);
	});
});

describe('translated empty states', () => {
	it('keeps an empty vault translated after loading and changing languages', async () => {
		const { api, document } = await createHarness({ language: 'en' }, { i18n: true });
		api.setSecrets([]);
		await api.renderSecrets();

		const emptyState = document.getElementById('emptyState');
		expect(emptyState.querySelector('h3').textContent).toBe('No Keys Yet');
		expect(emptyState.querySelector('p').textContent).toBe('Add your two-factor authentication keys to generate verification codes here');
		expect(emptyState.querySelector('button').textContent).toBe('Add Key');
		emptyState.querySelector('button').click();
		expect(document.getElementById('secretModal').style.display).toBe('flex');
		api.hideSecretModal();

		api.setLanguage('zh-TW');
		expect(emptyState.querySelector('h3').textContent).toBe('尚無金鑰');
		expect(emptyState.querySelector('p').textContent).toBe('新增帳號的雙重驗證金鑰，在此獲取驗證碼');
		expect(emptyState.querySelector('button').textContent).toBe('新增金鑰');

		await api.renderSecrets();
		expect(emptyState.querySelector('h3').textContent).toBe('尚無金鑰');
		api.setLanguage('zh-CN');
		expect(emptyState.querySelector('h3').textContent).toBe('还没有密钥');
		expect(emptyState.querySelector('button').textContent).toBe('添加密钥');
	});

	it('translates unmatched search results and preserves the query when switching languages', async () => {
		const { api, document } = await createHarness({ language: 'en' }, { i18n: true });
		api.setSecrets(TEST_SECRETS);
		document.getElementById('searchInput').value = 'not-present';
		await api.filterSecrets('not-present');

		const emptyState = document.getElementById('emptyState');
		expect(emptyState.querySelector('h3').textContent).toBe('No matching keys found');
		expect(emptyState.querySelector('p').textContent).toBe('Try searching with different keywords');
		expect(emptyState.querySelector('button').textContent).toBe('Clear search');
		expect(typeof emptyState.querySelector('button').onclick).toBe('function');

		api.setLanguage('zh-TW');
		expect(emptyState.querySelector('h3').textContent).toBe('未找到相符的金鑰');
		expect(emptyState.querySelector('p').textContent).toBe('嘗試使用不同的關鍵字搜尋');
		expect(emptyState.querySelector('button').textContent).toBe('清除搜尋');
		expect(document.getElementById('searchInput').value).toBe('not-present');
		expect(document.getElementById('secretsList').style.display).toBe('none');

		emptyState.querySelector('button').click();
		expect(document.getElementById('searchInput').value).toBe('');
		expect(document.querySelectorAll('.secret-card')).toHaveLength(TEST_SECRETS.length);
		api.setSecrets([]);
		await api.filterSecrets('');
		expect(emptyState.querySelector('h3').textContent).toBe('尚無金鑰');
		emptyState.querySelector('button').click();
		expect(document.getElementById('secretModal').style.display).toBe('flex');
		api.hideSecretModal();
	});
});
