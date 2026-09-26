import { createContext, runInContext, Script } from 'node:vm';
import { Window } from 'happy-dom';
import { describe, expect, it, vi } from 'vitest';
import { getToolsCode } from '../../src/ui/scripts/tools.js';
import { TOOLS_LOCALES } from '../../src/ui/locales/tools.js';
import { LOCALES } from '../../src/ui/locales/index.js';

const providers = [
	['Webdav', 'webdav', 'WebDAV'],
	['S3', 's3', 'S3'],
	['OneDrive', 'oneDrive', 'OneDrive'],
	['GoogleDrive', 'googleDrive', 'Google Drive'],
];

function createHarness(language = 'en') {
	const window = new Window({ url: 'https://2fa.example.com' });
	const { document } = window;
	const ids = [
		'encodedResult',
		'decodedResult',
		'generatedKeyText',
		'keyResultSection',
		'keyCheckResult',
		'checkResultContent',
		'decodeScannerStatus',
		'decodeErrorMessage',
		'decodeScannerError',
		'decodeScannerVideo',
		'decodeScannerContainer',
		'decodeResultContent',
		'decodeResultSection',
		'decodeQRSection',
		'qrResultSection',
		'generatedQRCode',
		'decodeQRCode',
		'currentTimestamp',
		'totpPeriod',
		'totpCounter',
		'remainingTime',
		'progressBar',
		'period30Btn',
		'period60Btn',
		'period120Btn',
	];
	for (const id of ids) {
		document.body.insertAdjacentHTML('beforeend', `<div id="${id}"></div>`);
	}
	for (const id of ['plainTextInput', 'base32TextInput', 'keyCheckInput', 'qrContentInput']) {
		document.body.insertAdjacentHTML('beforeend', `<input id="${id}" />`);
	}
	for (const [, prefix] of providers) {
		for (const suffix of ['DestinationList', 'OauthWarning', 'FormArea', 'AddBtn', 'SaveBtn', 'TestBtn', 'AuthorizeBtn']) {
			document.body.insertAdjacentHTML('beforeend', `<div id="${prefix}${suffix}"></div>`);
		}
		for (const suffix of [
			'EditId',
			'Name',
			'Url',
			'Username',
			'Password',
			'Path',
			'Endpoint',
			'Bucket',
			'Region',
			'AccessKeyId',
			'SecretAccessKey',
			'Prefix',
			'FolderPath',
		]) {
			document.body.insertAdjacentHTML('beforeend', `<input id="${prefix}${suffix}" />`);
		}
	}
	let currentLanguage = language;
	const t = (key, params = {}) => {
		const value = { ...LOCALES[currentLanguage], ...TOOLS_LOCALES[currentLanguage] }[key];
		if (value === undefined) {
			throw new Error(`Missing translation: ${currentLanguage}/${key}`);
		}
		return value.replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match);
	};
	const state = { count: 1, maxAllowed: 5, oauthConfigured: false, destinations: [] };
	const toasts = vi.fn();
	const context = createContext({
		window,
		document,
		console,
		URL,
		t,
		formatI18nDate: (value) => new Date(value).toLocaleString(currentLanguage === 'en' ? 'en-US' : currentLanguage),
		navigator: { clipboard: { writeText: vi.fn(async () => {}) }, mediaDevices: {} },
		authenticatedFetch: vi.fn(async () => ({ ok: true, json: async () => state })),
		showCenterToast: toasts,
		showModal: (_id, onShow) => onShow(),
		hideModal: vi.fn(),
		showConfirmDialog: vi.fn(async () => false),
		dialogIcon: () => '',
		requestAnimationFrame: vi.fn(() => 1),
		cancelAnimationFrame: vi.fn(),
		setTimeout,
		clearTimeout,
		clearInterval,
		generateQRCodeDataURL: vi.fn(async () => 'data:image/png;base64,QR'),
	});
	runInContext(getToolsCode(), context);
	return {
		api: context,
		state,
		document,
		t,
		toasts,
		element: (id) => document.getElementById(id),
		setLanguage: (lang) => {
			currentLanguage = lang;
			context.refreshToolsTranslations();
		},
	};
}

function destination(overrides = {}) {
	return {
		id: 'destination-1',
		name: 'My backup',
		enabled: true,
		authorized: true,
		status: {},
		account: { email: 'me@example.com' },
		config: { url: 'https://dav.example.com', endpoint: 'https://s3.example.com', bucket: 'backup', folderPath: '/2FA' },
		...overrides,
	};
}

describe.each(['zh-CN', 'zh-TW', 'en'])('dynamic tools in %s', (language) => {
	it('translates converter, generator, copy, and validation results while retaining user content', async () => {
		const { api, element, t, toasts } = createHarness(language);
		api.encodeBase32();
		expect(toasts).toHaveBeenLastCalledWith('❌', t('toolEncodeInput'));
		element('plainTextInput').value = 'Hello 世界';
		api.encodeBase32();
		expect(toasts).toHaveBeenLastCalledWith('✅', t('toolEncodeSuccess'));
		element('base32TextInput').value = element('encodedResult').textContent;
		api.decodeBase32();
		expect(element('decodedResult').textContent).toBe('Hello 世界');
		await api.copyDecodedText();
		expect(toasts).toHaveBeenLastCalledWith('✅', t('toolDecodedCopied'));
		element('base32TextInput').value = '!bad';
		api.decodeBase32();
		expect(toasts).toHaveBeenLastCalledWith('❌', t('toolDecodeError', { message: t('toolBase32Invalid') }));
		element('keyCheckInput').value = 'AB!';
		api.checkSecret();
		expect(element('checkResultContent').textContent).toContain(t('toolKeyInvalid'));
		expect(element('checkResultContent').textContent).toContain(t('toolKeyMinLength'));
		api.generateKey();
		expect(element('generatedKeyText').textContent).toMatch(/^[A-Z2-7]{16}$/);
		expect(toasts).toHaveBeenLastCalledWith('✅', t('toolKeyGenerated'));
		await api.generateQRCode();
		expect(toasts).toHaveBeenLastCalledWith('❌', t('toolQrInput'));
		element('qrContentInput').value = '保留原始内容';
		await api.generateQRCode();
		expect(api.generateQRCodeDataURL).toHaveBeenCalledWith('保留原始内容', { width: 300, height: 300 });
	});

	it.each(providers)('renders %s dates, statuses, actions, and accessible labels', (name, prefix) => {
		const { api, document, t } = createHarness(language);
		const html = api[`_render${name}Card`](destination({ status: { lastSuccess: { timestamp: '2026-09-24T05:14:00Z' } } }));
		const card = document.createElement('div');
		card.innerHTML = html;
		expect(card.querySelector('[type=checkbox]').getAttribute('aria-label')).toBe(t('toolSyncEnabledLabel'));
		expect(card.textContent).toContain(t('edit'));
		expect(card.textContent).toContain(t('delete'));
		expect(card.textContent).toContain(api.formatI18nDate('2026-09-24T05:14:00Z'));
		if (prefix === 'googleDrive' || prefix === 'oneDrive') {
			expect(card.textContent).toContain(t('toolSyncReauthorize'));
		}
	});

	it('translates camera denial and clipboard failure states', async () => {
		const { api, element, t, toasts } = createHarness(language);
		api.navigator.mediaDevices.getUserMedia = vi.fn(async () => {
			throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
		});
		await api.startDecodeCamera();
		expect(element('decodeErrorMessage').textContent).toBe(t('toolCameraDenied'));
		api.navigator.clipboard.read = vi.fn(async () => {
			throw Object.assign(new Error('Denied'), { name: 'NotAllowedError' });
		});
		await api.pasteImageForDecode();
		expect(toasts).toHaveBeenLastCalledWith('❌', t('toolClipboardDenied'));
	});
});

describe('tool language switching', () => {
	it.each(providers)('refreshes %s output without closing the form or overwriting edits', async (name, prefix, label) => {
		const { api, element, state, setLanguage, t } = createHarness('zh-CN');
		state.destinations = [destination()];
		await api[`load${name}Destinations`]();
		api[`show${name}Form`]('destination-1');
		element(`${prefix}Name`).value = 'Unsaved edit';
		setLanguage('en');
		expect(element(`${prefix}FormArea`).style.display).toBe('block');
		expect(element(`${prefix}Name`).value).toBe('Unsaved edit');
		expect(element(`${prefix}DestinationList`).textContent).toContain(t('edit'));
		if (prefix === 'googleDrive' || prefix === 'oneDrive') {
			expect(element(`${prefix}OauthWarning`).textContent).toBe(t('toolSyncOAuthMissing', { provider: label }));
		}
	});

	it('refreshes the last checked result, timer accessibility text, and camera error in place', async () => {
		const { api, element, setLanguage, t } = createHarness('zh-CN');
		element('keyCheckInput').value = 'AB!';
		api.checkSecret();
		element('keyCheckInput').value = 'unsubmitted edit';
		api.showTimestampModal();
		await api.startDecodeCamera();
		setLanguage('en');
		expect(element('checkResultContent').textContent).toContain(t('toolKeyMinLength'));
		expect(element('keyCheckInput').value).toBe('unsubmitted edit');
		expect(element('totpPeriod').textContent).toBe('30 s');
		expect(element('progressBar').getAttribute('aria-valuetext')).toMatch(/^\d+ s$/);
		expect(element('decodeErrorMessage').textContent).toBe(t('toolCameraStartError', { message: t('toolCameraUnsupported') }));
	});
});

describe('destination data safety', () => {
	it.each(providers)('keeps quotes and markup in %s names outside inline JavaScript', (name) => {
		const { api, document } = createHarness();
		const dest = destination({ id: 'id\"\'><img src=x>', name: 'My \"backup\"\');alert(1);// <script>bad</script>' });
		const card = document.createElement('div');
		card.innerHTML = api[`_render${name}Card`](dest);
		expect(card.querySelector('.dest-card').dataset.id).toBe(dest.id);
		expect(card.querySelector('.dest-card-name').textContent).toBe(dest.name);
		expect(card.querySelector('img, script')).toBeNull();
		for (const control of card.querySelectorAll('[onclick], [onchange]')) {
			const handler = control.getAttribute('onclick') || control.getAttribute('onchange');
			expect(() => new Script(handler)).not.toThrow();
			expect(handler).not.toContain(dest.name);
		}
		api[`delete${name}Dest`] = vi.fn();
		api.button = card.querySelector('.btn-danger-outline');
		api.event = { stopPropagation: vi.fn() };
		runInContext(`(function() { ${api.button.getAttribute('onclick')} }).call(button)`, api);
		expect(api[`delete${name}Dest`]).toHaveBeenCalledWith(dest.id, dest.name);
	});
});
