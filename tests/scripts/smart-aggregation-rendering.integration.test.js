import { describe, expect, it, vi } from 'vitest';

import { getCoreCode } from '../../src/ui/scripts/core.js';
import { getSearchCode } from '../../src/ui/scripts/search.js';
import { getServiceAggregationCode } from '../../src/ui/scripts/serviceAggregation.js';
import { getStateCode } from '../../src/ui/scripts/state.js';

class TestClassList {
	constructor(element) {
		this.element = element;
		this.values = new Set();
	}

	reset(value) {
		this.values = new Set(
			String(value || '')
				.split(/\s+/)
				.filter(Boolean),
		);
	}

	sync() {
		this.element.attributes.set('class', Array.from(this.values).join(' '));
	}

	add(...names) {
		names.forEach((name) => this.values.add(name));
		this.sync();
	}

	remove(...names) {
		names.forEach((name) => this.values.delete(name));
		this.sync();
	}

	toggle(name, enabled) {
		const shouldEnable = enabled === undefined ? !this.values.has(name) : enabled;
		if (shouldEnable) {
			this.values.add(name);
		} else {
			this.values.delete(name);
		}
		this.sync();
		return shouldEnable;
	}

	contains(name) {
		return this.values.has(name);
	}
}

class TestTextNode {
	constructor(text, ownerDocument) {
		this.nodeType = 3;
		this.ownerDocument = ownerDocument;
		this.parentNode = null;
		this.textContent = text;
	}
}

function dataAttributeProperty(name) {
	return name
		.slice(5)
		.split('-')
		.map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
		.join('');
}

function matchesSelector(element, selector) {
	if (selector.startsWith('.')) {
		return element.classList.contains(selector.slice(1));
	}
	if (selector.startsWith('#')) {
		return element.id === selector.slice(1);
	}

	const attributeMatch = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
	if (attributeMatch) {
		return (
			element.hasAttribute(attributeMatch[1]) &&
			(attributeMatch[2] === undefined || element.getAttribute(attributeMatch[1]) === attributeMatch[2])
		);
	}

	return element.tagName.toLowerCase() === selector.toLowerCase();
}

class TestElement {
	constructor(tagName, ownerDocument) {
		this.nodeType = 1;
		this.tagName = tagName.toUpperCase();
		this.ownerDocument = ownerDocument;
		this.parentNode = null;
		this.children = [];
		this.attributes = new Map();
		this.classList = new TestClassList(this);
		this.dataset = {};
		this.style = {};
		this.hidden = false;
		this.value = '';
		this.listeners = new Map();
		this.ownText = '';
	}

	get id() {
		return this.getAttribute('id') || '';
	}

	set id(value) {
		this.setAttribute('id', value);
	}

	get textContent() {
		return this.ownText + this.children.map((child) => child.textContent).join('');
	}

	set textContent(value) {
		this.ownerDocument.unregisterChildren(this);
		this.children = [];
		this.ownText = String(value);
	}

	get innerHTML() {
		return this.children.map((child) => child.textContent).join('');
	}

	set innerHTML(value) {
		this.ownerDocument.unregisterChildren(this);
		this.children = [];
		this.ownText = '';
		parseFragment(String(value), this);
	}

	setAttribute(name, value) {
		const normalizedName = name.toLowerCase();
		const stringValue = String(value);
		if (normalizedName === 'id') {
			this.ownerDocument.unregisterId(this);
		}
		this.attributes.set(normalizedName, stringValue);
		if (normalizedName === 'class') {
			this.classList.reset(stringValue);
		}
		if (normalizedName.startsWith('data-')) {
			this.dataset[dataAttributeProperty(normalizedName)] = stringValue;
		}
		if (normalizedName === 'id') {
			this.ownerDocument.registerId(this);
		}
	}

	getAttribute(name) {
		return this.attributes.get(name.toLowerCase()) ?? null;
	}

	hasAttribute(name) {
		return this.attributes.has(name.toLowerCase());
	}

	removeAttribute(name) {
		const normalizedName = name.toLowerCase();
		if (normalizedName === 'id') {
			this.ownerDocument.unregisterId(this);
		}
		this.attributes.delete(normalizedName);
	}

	appendChild(child) {
		child.parentNode = this;
		this.children.push(child);
		this.ownerDocument.registerTree(child);
		return child;
	}

	removeChild(child) {
		const index = this.children.indexOf(child);
		if (index >= 0) {
			this.ownerDocument.unregisterTree(child);
			this.children.splice(index, 1);
			child.parentNode = null;
		}
		return child;
	}

	querySelectorAll(selector) {
		const matches = [];
		const visit = (node) => {
			if (node.nodeType !== 1) {
				return;
			}
			if (matchesSelector(node, selector)) {
				matches.push(node);
			}
			node.children.forEach(visit);
		};
		this.children.forEach(visit);
		return matches;
	}

	querySelector(selector) {
		return this.querySelectorAll(selector)[0] || null;
	}

	closest(selector) {
		let current = this;
		while (current) {
			if (current.nodeType === 1 && matchesSelector(current, selector)) {
				return current;
			}
			current = current.parentNode;
		}
		return null;
	}

	contains(node) {
		let current = node;
		while (current) {
			if (current === this) {
				return true;
			}
			current = current.parentNode;
		}
		return false;
	}

	addEventListener(type, listener) {
		const listeners = this.listeners.get(type) || [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	dispatchEvent(event) {
		if (!event.target) {
			event.target = this;
		}
		(this.listeners.get(event.type) || []).forEach((listener) => listener(event));
	}

	focus() {
		this.ownerDocument.activeElement = this;
	}

	getBoundingClientRect() {
		return { top: 0, right: 0, bottom: 44, left: 0, width: 0, height: 44 };
	}
}

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source']);

function parseFragment(html, parent) {
	const stack = [parent];
	const tokens = html.match(/<[^>]+>|[^<]+/g) || [];

	for (const token of tokens) {
		if (token.startsWith('</')) {
			if (stack.length > 1) {
				stack.pop();
			}
			continue;
		}
		if (!token.startsWith('<')) {
			stack.at(-1).appendChild(new TestTextNode(token, parent.ownerDocument));
			continue;
		}

		const openingTag = token.match(/^<([^\s/>]+)([\s\S]*?)(\/?)>$/);
		if (!openingTag) {
			continue;
		}
		const element = parent.ownerDocument.createElement(openingTag[1]);
		const attributeSource = openingTag[2];
		const attributePattern = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
		let attributeMatch;
		while ((attributeMatch = attributePattern.exec(attributeSource))) {
			element.setAttribute(attributeMatch[1], attributeMatch[2] ?? attributeMatch[3] ?? attributeMatch[4] ?? '');
		}
		stack.at(-1).appendChild(element);
		if (!openingTag[3] && !VOID_ELEMENTS.has(openingTag[1].toLowerCase())) {
			stack.push(element);
		}
	}
}

class TestDocument {
	constructor() {
		this.ids = new Map();
		this.listeners = new Map();
		this.hidden = false;
		this.body = new TestElement('body', this);
		this.activeElement = this.body;
	}

	createElement(tagName) {
		return new TestElement(tagName, this);
	}

	getElementById(id) {
		return this.ids.get(id) || null;
	}

	querySelectorAll(selector) {
		return this.body.querySelectorAll(selector);
	}

	querySelector(selector) {
		return this.querySelectorAll(selector)[0] || null;
	}

	addEventListener(type, listener) {
		const listeners = this.listeners.get(type) || [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	dispatchEvent(event) {
		if (!event.target) {
			event.target = this;
		}
		(this.listeners.get(event.type) || []).forEach((listener) => listener(event));
	}

	registerId(element) {
		if (element.id) {
			this.ids.set(element.id, element);
		}
	}

	unregisterId(element) {
		const id = element.getAttribute('id');
		if (id && this.ids.get(id) === element) {
			this.ids.delete(id);
		}
	}

	registerTree(node) {
		if (node.nodeType !== 1) {
			return;
		}
		this.registerId(node);
		node.children.forEach((child) => this.registerTree(child));
	}

	unregisterTree(node) {
		if (node.nodeType !== 1) {
			return;
		}
		this.unregisterId(node);
		node.children.forEach((child) => this.unregisterTree(child));
	}

	unregisterChildren(element) {
		element.children.forEach((child) => this.unregisterTree(child));
	}
}

function appendElement(document, tagName, options = {}) {
	const element = document.createElement(tagName);
	if (options.id) {
		element.id = options.id;
	}
	if (options.className) {
		element.setAttribute('class', options.className);
	}
	Object.entries(options.dataset || {}).forEach(([name, value]) => {
		const attributeName = 'data-' + name.replace(/[A-Z]/g, (character) => '-' + character.toLowerCase());
		element.setAttribute(attributeName, value);
	});
	document.body.appendChild(element);
	return element;
}

function createPageDocument() {
	const document = new TestDocument();
	for (const id of ['loading', 'secretsList', 'emptyState', 'searchClear', 'searchStats', 'searchInput', 'sortModeLabel']) {
		appendElement(document, 'div', { id });
	}
	const sortSelect = appendElement(document, 'select', { id: 'sortSelect' });
	sortSelect.value = 'oldest-first';

	const dropdown = appendElement(document, 'details', { id: 'sortDropdown' });
	const trigger = document.createElement('button');
	trigger.setAttribute('class', 'sort-trigger');
	dropdown.appendChild(trigger);
	const menu = document.createElement('div');
	menu.setAttribute('class', 'sort-menu');
	dropdown.appendChild(menu);

	const groupedOption = appendElement(document, 'button', {
		className: 'view-mode-option active',
		dataset: { viewMode: 'grouped' },
	});
	const flatOption = appendElement(document, 'button', {
		className: 'view-mode-option active',
		dataset: { viewMode: 'flat' },
	});
	for (const groupSort of ['name-asc', 'name-desc']) {
		appendElement(document, 'button', {
			className: 'group-sort-option group-sort-only active',
			dataset: { groupSort },
		});
	}
	for (const sort of ['oldest-first', 'newest-first', 'name-asc', 'name-desc', 'account-asc', 'account-desc']) {
		appendElement(document, 'button', {
			className: 'sort-option active' + (sort.startsWith('name-') ? ' flat-sort-only' : ''),
			dataset: { sort },
		});
	}
	appendElement(document, 'div', { className: 'group-sort-only' });

	return { document, dropdown, flatOption, groupedOption, trigger };
}

function createStorage(initialValues = {}) {
	const values = new Map(Object.entries(initialValues));
	return {
		getItem: vi.fn((key) => values.get(key) ?? null),
		setItem: vi.fn((key, value) => values.set(key, value)),
	};
}

function createHarness(initialStorage = {}, overrides = {}) {
	const page = createPageDocument();
	const localStorage = createStorage(initialStorage);
	const updateOTP = overrides.updateOTP ?? vi.fn(async () => {});
	const updateOTPSecretsInBatch =
		overrides.updateOTPSecretsInBatch ?? vi.fn(async () => {});
	const startOTPInterval = overrides.startOTPInterval ?? vi.fn();
	const window = {
		addEventListener: vi.fn(),
		innerHeight: 800,
		visualViewport: null,
	};
	const navigator = {
		clipboard: {
			writeText: vi.fn(async () => {}),
		},
	};
	const quietConsole = { error: vi.fn(), log: vi.fn(), warn: vi.fn() };
	const source = `
    function escapeHTML(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
    function hideSecretModal() {}
    function hideQRModal() {}
    function hideQRScanner() {}
    function hideImportModal() {}
    function showCenterToast() {}
    ${getStateCode()}
    ${getCoreCode()}
    ${getServiceAggregationCode()}
    ${getSearchCode()}
    return {
      filterSecrets,
      getServiceLogo,
      initSortDropdownOutsideClose,
      copyNextOTP,
      copyOTP,
      renderFilteredSecrets,
      restoreGroupSortPreference,
      restoreSortPreference,
      restoreViewModePreference,
      selectViewMode,
      setSecrets(value) {
        secrets = value;
        filteredSecrets = [...value];
      },
      setOTPIntervals(value) {
        otpIntervals = value;
      },
      getOTPIntervalIds() {
        return Object.keys(otpIntervals);
      }
    };
  `;

	const clearInterval = vi.fn();
	// eslint-disable-next-line no-new-func
	const api = new Function(
		'document',
		'window',
		'navigator',
		'localStorage',
		'console',
		'setInterval',
		'clearInterval',
		'setTimeout',
		'clearTimeout',
		'ResizeObserver',
		'requestAnimationFrame',
		'cancelAnimationFrame',
		'performance',
		'updateOTP',
		'updateOTPSecretsInBatch',
		'startOTPInterval',
		source,
	)(
		page.document,
		window,
		navigator,
		localStorage,
		quietConsole,
		vi.fn(() => 1),
		clearInterval,
		vi.fn(() => 1),
		vi.fn(),
		undefined,
		undefined,
		undefined,
		{ now: vi.fn(() => 0) },
		updateOTP,
		updateOTPSecretsInBatch,
		startOTPInterval,
	);

	return {
		...page,
		api,
		clearInterval,
		localStorage,
		navigator,
		startOTPInterval,
		updateOTP,
		updateOTPSecretsInBatch,
		window,
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
		const { api, document, flatOption, groupedOption, localStorage } = createHarness();
		api.restoreSortPreference();
		api.restoreGroupSortPreference();
		api.restoreViewModePreference();
		api.setSecrets(TEST_SECRETS);
		await api.renderFilteredSecrets();

		const list = document.getElementById('secretsList');
		expect(list.classList.contains('is-grouped')).toBe(true);
		expect(list.style.display).toBe('block');
		expect(list.querySelectorAll('.service-group-title').map((node) => node.textContent)).toEqual(['Google', 'Microsoft', '其他服务']);
		expect(list.querySelectorAll('.service-group-count').map((node) => node.textContent)).toEqual(['2 个', '2 个', '1 个']);
		expect(list.querySelectorAll('.secret-card')).toHaveLength(TEST_SECRETS.length);
		expect(groupedOption.classList.contains('active')).toBe(true);
		expect(groupedOption.getAttribute('aria-pressed')).toBe('true');
		expect(flatOption.classList.contains('active')).toBe(false);
		expect(flatOption.getAttribute('aria-pressed')).toBe('false');

		await api.selectViewMode('flat');

		expect(list.classList.contains('is-grouped')).toBe(false);
		expect(list.style.display).toBe('grid');
		expect(list.querySelectorAll('.service-group')).toHaveLength(0);
		expect(list.querySelectorAll('.secret-card')).toHaveLength(TEST_SECRETS.length);
		expect(groupedOption.classList.contains('active')).toBe(false);
		expect(flatOption.classList.contains('active')).toBe(true);
		expect(flatOption.getAttribute('aria-pressed')).toBe('true');
		expect(localStorage.setItem).toHaveBeenCalledWith('2fa-view-mode', 'flat');
	});

	it('renders global search results and per-group matched/total counts from the full list', async () => {
		const { api, document } = createHarness();
		api.setSecrets(TEST_SECRETS);
		await api.filterSecrets('gmail');

		const list = document.getElementById('secretsList');
		const stats = document.getElementById('searchStats');
		const groupCount = list.querySelector('.service-group-count');
		expect(stats.textContent).toBe('找到 1 个匹配密钥（共 5 个）');
		expect(stats.style.display).toBeUndefined();
		expect(list.querySelectorAll('.service-group')).toHaveLength(1);
		expect(list.querySelector('.service-group-title').textContent).toBe('Google');
		expect(groupCount.textContent).toBe('1 / 2');
		expect(groupCount.getAttribute('aria-label')).toBe('匹配 1 个，共 2 个');
		expect(list.querySelectorAll('.secret-card')).toHaveLength(1);
		expect(list.querySelector('h3').textContent).toBe('Gmail');
	});

	it('clears old intervals before awaiting render and starts new ones with secret hints', async () => {
		let resolveBatch;
		const batchPromise = new Promise((resolve) => {
			resolveBatch = resolve;
		});
		const updateOTPSecretsInBatch = vi.fn(() => batchPromise);
		const { api, clearInterval, startOTPInterval } = createHarness(
			{},
			{ updateOTPSecretsInBatch },
		);
		const renderedSecrets = TEST_SECRETS.slice(0, 2);
		api.setSecrets(renderedSecrets);
		api.setOTPIntervals({ google: 101, gmail: 102 });

		const renderPromise = api.renderFilteredSecrets();

		expect(updateOTPSecretsInBatch).toHaveBeenCalledWith(renderedSecrets, {
			includeHOTP: true,
		});
		expect(api.getOTPIntervalIds()).toEqual([]);
		expect(clearInterval.mock.calls).toEqual([[101], [102]]);
		expect(startOTPInterval).not.toHaveBeenCalled();

		resolveBatch();
		await renderPromise;

		expect(startOTPInterval).toHaveBeenCalledTimes(renderedSecrets.length);
		for (const item of renderedSecrets) {
			expect(startOTPInterval).toHaveBeenCalledWith(item.id, item);
		}
	});

	it('searches displayed family names in grouped and flat views', async () => {
		const { api, document } = createHarness();
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
			expect(list.querySelectorAll('h3').map((node) => node.textContent)).toEqual(expectedNames);
		}

		await api.selectViewMode('flat');
		for (const [familyName, expectedNames] of expectedFamilies) {
			await api.filterSecrets(familyName);

			expect(list.querySelectorAll('.service-group')).toHaveLength(0);
			expect(list.querySelectorAll('h3').map((node) => node.textContent)).toEqual(expectedNames);
		}

		await api.filterSecrets('files@example.com');
		expect(list.querySelectorAll('h3').map((node) => node.textContent)).toEqual(['OneDrive']);
	});

	it('keeps family-name search working after replacing an item with the same service name', async () => {
		const { api, document } = createHarness();
		const editedSecrets = [
			secret('gmail', 'Gmail', 'before@example.com'),
			secret('youtube', 'YouTube', 'video@example.com'),
		];

		api.setSecrets(editedSecrets);
		await api.filterSecrets('google');
		editedSecrets[0] = secret('gmail', 'Gmail', 'after@example.com');
		api.setSecrets(editedSecrets);
		await api.filterSecrets('google');

		const list = document.getElementById('secretsList');
		expect(list.querySelectorAll('h3').map((node) => node.textContent)).toEqual(['Gmail', 'YouTube']);
		expect(list.querySelectorAll('p').map((node) => node.textContent)).toContain('after@example.com');
	});

	it('uses the smart service resolver for card logos', () => {
		const { api } = createHarness();

		expect(api.getServiceLogo('GoogleCloud')).toBe('/api/favicon/cloud.google.com');
		expect(api.getServiceLogo('AWSConsole')).toBe('/api/favicon/aws.amazon.com');
		expect(api.getServiceLogo('AppleMusic')).toBe('/api/favicon/music.apple.com');
		expect(api.getServiceLogo('GitHubEnterprise')).toBe('/api/favicon/github.com');
		expect(api.getServiceLogo('Google Cloud Platform')).toBe('/api/favicon/cloud.google.com');
		expect(api.getServiceLogo('gmail.user@example.com')).toBeNull();
		expect(api.getServiceLogo('github.com.evil.example')).toBeNull();
	});

	it('searches the displayed other-services heading', async () => {
		const { api, document } = createHarness();
		api.setSecrets([
			secret('github', 'GitHub', 'code@example.com'),
			secret('discord', 'Discord', 'chat@example.com'),
		]);

		await api.filterSecrets('其他服务');

		const list = document.getElementById('secretsList');
		expect(list.querySelector('.service-group-title').textContent).toBe('其他服务');
		expect(list.querySelectorAll('h3').map((node) => node.textContent)).toEqual(['GitHub', 'Discord']);
	});

	it('does not copy failed eight-digit OTP placeholders', async () => {
		const { api, document, navigator } = createHarness();
		api.setSecrets([{ id: 'eight', name: 'Eight digit', digits: 8, secret: 'JBSWY3DPEHPK3PXP' }]);

		const current = document.createElement('div');
		current.id = 'otp-eight';
		current.textContent = '--------';
		document.body.appendChild(current);
		const next = document.createElement('div');
		next.id = 'next-otp-eight';
		next.textContent = '--------';
		document.body.appendChild(next);

		await api.copyOTP('eight');
		await api.copyNextOTP('eight');

		expect(navigator.clipboard.writeText).not.toHaveBeenCalled();

		current.textContent = '12345678';
		next.textContent = '87654321';
		await api.copyOTP('eight');
		await api.copyNextOTP('eight');

		expect(navigator.clipboard.writeText.mock.calls).toEqual([['12345678'], ['87654321']]);
	});

	it('closes the sort dropdown with Escape and restores focus to its trigger', () => {
		const { api, document, dropdown, flatOption, trigger, window } = createHarness();
		flatOption.focus();
		dropdown.setAttribute('open', '');
		api.initSortDropdownOutsideClose();

		document.dispatchEvent({ type: 'keydown', key: 'Escape', ctrlKey: false });

		expect(dropdown.hasAttribute('open')).toBe(false);
		expect(document.activeElement).toBe(trigger);
		expect(window.addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
	});

	it('clears active OTP intervals when a search has no matches', async () => {
		const { api, clearInterval, document } = createHarness();
		api.setSecrets(TEST_SECRETS);
		api.setOTPIntervals(Object.fromEntries(TEST_SECRETS.map((item, index) => [item.id, index + 1])));

		await api.filterSecrets('not-present');

		expect(api.getOTPIntervalIds()).toEqual([]);
		expect(clearInterval).toHaveBeenCalledTimes(TEST_SECRETS.length);
		expect(document.getElementById('secretsList').innerHTML).toBe('');
	});
});
