import { serializeBrowserFunction } from './browserSource.js';
import { getAppearancePreviewDocument } from './appearanceRuntime.js';
import { getAppearanceErrorCode } from './appearanceMessages.js';
import { migrateSettings, validateSettingValue } from '../../themes/schema.js';
import { APP_LINKS } from './versionCheck.js';

/** Keep valid user values across versions while preserving each theme's saved profile. */
export function createAppearanceDraft(theme, current = {}, { reset = false } = {}, migrate = migrateSettings) {
	const clone = (value) => JSON.parse(JSON.stringify(value));
	const format = (value) => (value?.kind === 'app' || value?.manifest?.kind === 'app' ? 'app' : 'v1');
	const app = format(theme) === 'app';
	const sameTheme = current.themeId === theme.manifest.id && format(current) === format(theme);
	const profile = format(theme.profile) === format(theme) ? theme.profile : null;
	const previous = reset ? {} : sameTheme ? current : profile || {};
	const migration = migrate(previous.manifest || { settings: [] }, theme.manifest, clone(previous.settings || {}));
	return {
		draft: {
			packageId: theme.packageId,
			themeId: theme.manifest.id,
			manifest: clone(theme.manifest),
			...(app
				? { kind: 'app' }
				: { css: theme.css || '', layout: clone(theme.manifest.layout), content: clone(theme.manifest.content || {}) }),
			settings: clone(migration.settings),
			resources: clone(theme.assets || theme.resources || []),
		},
		changes: previous.manifest ? migration.changes : [],
	};
}

/** The editor keeps one in-memory draft; only an explicit apply publishes it. */
export function getAppearanceEditorCode() {
	const template = getAppearancePreviewDocument({ nonce: 'APPEARANCEPREVIEWNONCE' });
	return `${getAppearanceErrorCode()}\nwindow.createAppearancePreviewDocument = function(nonce) { return ${JSON.stringify(template).replace(/</g, '\\u003c')}.split('APPEARANCEPREVIEWNONCE').join(nonce.replace(/[^a-z0-9_-]/gi, '')); };\n(function() { const validateValue = ${serializeBrowserFunction(validateSettingValue)}; const migrate = function(previous, next, values) { return (${serializeBrowserFunction(migrateSettings)})(previous, next, values, validateValue); }; const createDraft = function(theme, current, options) { return (${serializeBrowserFunction(createAppearanceDraft)})(theme, current, options, migrate); }; (${serializeBrowserFunction(appearanceEditorClient)})(createDraft, ${JSON.stringify(APP_LINKS.themes)}); })();`;
}

function appearanceEditorClient(createAppearanceDraft, themeGuideUrl) {
	const state = {
		open: false,
		busy: false,
		dirty: false,
		revision: 0,
		remoteRevision: 0,
		loadGeneration: 0,
		library: [],
		applied: null,
		catalog: [],
		catalogSources: [],
		customCatalogs: [],
		catalogInput: '',
		catalogStatus: 'idle',
		catalogGeneration: 0,
		autoUpdate: null,
		draft: null,
		capabilities: { write: false },
		profiles: new Map(),
		migration: [],
		mode: 'light',
		scene: 'workspace',
		width: 1440,
		nonce: '',
		ready: false,
		previewTimer: null,
		previewGeneration: 0,
		trustedPackages: new Set(),
		appPreview: null,
		appPreviewPackage: null,
		previewTask: null,
		previewSessionInvalid: false,
		conflict: false,
		reloadRequired: false,
	};
	const resourceCache = new Map();
	const clone = (value) => JSON.parse(JSON.stringify(value));
	const tr = (key, params) => (window.t ? window.t(key, params) : key);
	const localName = (value) =>
		typeof value === 'string' ? value : value?.[document.documentElement.lang] || value?.en || Object.values(value || {})[0] || '';
	const uid = () => window.crypto.randomUUID();
	const isApp = (value) => value?.kind === 'app' || value?.manifest?.kind === 'app';
	const profileKey = (value) => (isApp(value) ? 'app:' : 'v1:') + (value.themeId || value.manifest?.id);
	const builtinLabels = {
		'Accent color': 'appearanceAccent',
		'Corner radius': 'appearanceRadius',
		Square: 'appearanceSquare',
		Soft: 'appearanceSoft',
		Rounded: 'appearanceRounded',
		Round: 'appearanceRound',
		Density: 'appearanceDensity',
		Comfortable: 'appearanceComfortable',
		Compact: 'appearanceCompactOption',
		Font: 'appearanceFont',
		System: 'appearanceSystem',
		Serif: 'appearanceSerif',
		Monospace: 'appearanceMonospace',
	};
	const builtin = () => state.draft?.packageId?.startsWith('builtin:');
	const optionLabel = (label) => (builtin() && builtinLabels[label] ? tr(builtinLabels[label]) : localName(label));
	function settingLabel(setting, part = 'label') {
		const translated = setting.translations?.[document.documentElement.lang]?.[part];
		return translated || (part === 'label' ? optionLabel(setting.label || setting.key) : setting.description || '');
	}
	function message(text, error = false) {
		const element = document.getElementById('appearanceStatus');
		if (!element) {
			return;
		}
		element.textContent = text;
		element.dataset.error = String(error);
		element.hidden = !text;
		if (state.conflict) {
			element.append(button('appearanceReload', 'reload', 'btn btn-secondary btn-sm'));
		}
		if (state.reloadRequired) {
			element.append(button('appearanceRefreshNow', 'refresh-runtime', 'btn btn-secondary btn-sm'));
		}
	}
	async function api(url, options = {}) {
		const response = await window.authenticatedFetch(url, options);
		if (!response.ok) {
			const data = await response.json().catch(() => ({}));
			const error = new Error(window.localizeAppearanceError(data, response.status));
			error.status = response.status;
			error.code = data.code || data.error;
			if (error.code === 'THEME_REVISION_CONFLICT') {
				state.conflict = true;
			}
			throw error;
		}
		return response;
	}
	function errorMessage(error) {
		message(tr('appearanceError', { message: String(error?.message || error) }), true);
	}
	function canWrite() {
		return Boolean(state.capabilities.write && window.__2FA_BUILD_ID__ && navigator.onLine);
	}
	function setBusy(value) {
		state.busy = value;
		const modal = document.getElementById('appearanceModal');
		modal?.setAttribute('aria-busy', String(value));
		modal?.querySelectorAll('[data-editor-control]').forEach((control) => {
			control.disabled = value;
		});
		modal?.querySelectorAll('[data-write]').forEach((control) => {
			control.disabled = value || !canWrite();
		});
		const apply = modal?.querySelector('[data-appearance-action="apply"]');
		if (apply) {
			apply.disabled = value || !canWrite() || !state.dirty;
		}
	}
	function node(tag, className, text) {
		const element = document.createElement(tag);
		if (className) {
			element.className = className;
		}
		if (text !== undefined) {
			element.textContent = text;
		}
		return element;
	}
	function button(label, action, className = 'btn btn-secondary') {
		const element = node('button', className, tr(label));
		element.type = 'button';
		element.dataset.appearanceAction = action;
		element.dataset.editorControl = '';
		return element;
	}
	function field(label, control, help) {
		const row = node('label', 'appearance-field');
		row.append(node('span', 'appearance-field-label', label), control);
		control.dataset.editorControl = '';
		if (help) {
			row.append(node('small', 'appearance-field-help', help));
		}
		return row;
	}
	function notifyPreview() {
		clearTimeout(state.previewTimer);
		state.previewTimer = setTimeout(() => void preview().catch(previewError), 120);
	}
	function changed() {
		state.dirty = true;
		if (state.draft?.themeId) {
			state.profiles.set(profileKey(state.draft), clone(state.draft));
		}
		message('');
		setBusy(state.busy);
		notifyPreview();
	}
	function rememberProfile(snapshot) {
		if (!snapshot?.themeId) {
			return;
		}
		for (const theme of state.library) {
			if (profileKey(theme) === profileKey(snapshot)) {
				theme.profile = clone(snapshot);
			}
		}
	}
	function makeDraft(theme, previous = {}, options) {
		const local = state.profiles.get(profileKey(theme));
		const selected = local && profileKey(previous) !== profileKey(theme) ? { ...theme, profile: local } : theme;
		const result = createAppearanceDraft(selected, previous, options);
		state.migration = result.changes;
		return { revision: state.revision, ...result.draft };
	}
	async function load({ replaceDraft = false } = {}) {
		const generation = ++state.loadGeneration;
		if (!navigator.onLine) {
			state.capabilities.write = false;
			message(tr('appearanceOffline'));
			return;
		}
		const [library, appLibrary, appearance] = await Promise.all([
			api('/api/themes').then((response) => response.json()),
			api('/api/themes?format=app').then((response) => response.json()),
			api('/api/appearance').then((response) => response.json()),
		]);
		if (generation !== state.loadGeneration) {
			return;
		}
		state.library = [...(library.themes || []), ...(appLibrary.themes || [])];
		state.capabilities = appearance.capabilities || { write: false };
		state.previewSessionInvalid = false;
		const revision = appearance.revision || 0;
		state.remoteRevision = Math.max(state.remoteRevision, revision);
		state.applied = clone(appearance.active || null);
		rememberProfile(appearance.active);
		if (replaceDraft || !state.dirty) {
			state.revision = revision;
			state.draft = clone(appearance.active || (state.library[0] && makeDraft(state.library[0])) || {});
			state.dirty = false;
			state.conflict = false;
		} else if (state.remoteRevision > state.revision) {
			state.conflict = true;
			message(tr('appearanceConflict'), true);
		}
		if (!state.capabilities.write) {
			message(tr('appearanceNoBinding'));
		}
	}
	function segmented(label, action, items, current) {
		const group = node('div', 'appearance-segmented');
		group.setAttribute('role', 'group');
		group.setAttribute('aria-label', tr(label));
		for (const [value, key] of items) {
			const control = button(key, action, 'appearance-segment');
			control.dataset.value = String(value);
			control.setAttribute('aria-pressed', String(String(current) === String(value)));
			group.append(control);
		}
		return group;
	}
	function ensureEditor() {
		if (document.getElementById('appearanceModal')) {
			return;
		}
		const modal = node('div', 'modal appearance-modal');
		modal.id = 'appearanceModal';
		modal.setAttribute('role', 'dialog');
		modal.setAttribute('aria-modal', 'true');
		modal.setAttribute('aria-labelledby', 'appearanceTitle');
		const content = node('div', 'modal-content appearance-modal-content');
		const header = node('div', 'modal-header');
		const heading = node('h2', '', tr('appearanceTitle'));
		heading.id = 'appearanceTitle';
		const close = button('close', 'close', 'close-btn');
		close.textContent = '×';
		close.setAttribute('aria-label', tr('close'));
		header.append(heading, close);
		const workspace = node('div', 'appearance-workspace');
		const panel = node('div', 'appearance-panel');
		panel.id = 'appearancePanel';
		const previewSection = node('section', 'appearance-preview-section');
		previewSection.setAttribute('aria-label', tr('appearancePreview'));
		const toolbar = node('div', 'appearance-preview-toolbar');
		toolbar.id = 'appearancePreviewToolbar';
		const viewport = node('div', 'appearance-preview-viewport');
		const frame = document.createElement('iframe');
		frame.id = 'appearancePreview';
		frame.title = tr('appearancePreview');
		frame.setAttribute('sandbox', 'allow-scripts');
		const appContainer = node('div');
		appContainer.id = 'appearanceAppPreview';
		appContainer.hidden = true;
		viewport.append(frame, appContainer);
		const previewStatus = node('p', 'appearance-preview-status');
		previewStatus.id = 'appearanceAppPreviewStatus';
		previewStatus.setAttribute('role', 'status');
		previewStatus.hidden = true;
		previewSection.append(toolbar, viewport, previewStatus);
		workspace.append(panel, previewSection);
		const footer = node('div', 'appearance-footer');
		const status = node('div', 'appearance-status');
		status.id = 'appearanceStatus';
		status.setAttribute('role', 'status');
		status.setAttribute('aria-live', 'polite');
		status.hidden = true;
		const actions = node('div', 'appearance-footer-actions');
		const apply = button('appearanceApply', 'apply', 'btn btn-primary');
		actions.append(button('cancel', 'close'), apply);
		footer.append(status, actions);
		content.append(header, workspace, footer);
		modal.append(content);
		document.body.append(modal);
		modal.addEventListener('click', (event) => {
			const target = event.target.closest('[data-appearance-action]');
			if (!target || state.busy) {
				return;
			}
			event.stopPropagation();
			void action(target.dataset.appearanceAction, target).catch(errorMessage);
		});
	}
	function renderToolbar() {
		const toolbar = document.getElementById('appearancePreviewToolbar');
		const scenes = document.createElement('select');
		scenes.id = 'appearanceScene';
		scenes.className = 'appearance-scene';
		scenes.setAttribute('aria-label', tr('appearancePreview'));
		for (const [scene, label] of [
			['workspace', 'appearanceSceneWorkspace'],
			['login', 'appearanceSceneLogin'],
			['empty', 'appearanceSceneEmpty'],
			['offline', 'appearanceSceneOffline'],
		]) {
			const option = node('option', '', tr(label));
			option.value = scene;
			scenes.append(option);
		}
		scenes.value = state.scene;
		scenes.addEventListener('change', () => {
			state.scene = scenes.value;
			notifyPreview();
		});
		toolbar.replaceChildren(
			segmented(
				'appearancePreview',
				'width',
				[
					[1440, 'appearanceDesktop'],
					[768, 'appearanceTablet'],
					[390, 'appearanceMobile'],
				],
				state.width,
			),
			segmented(
				'appearancePreview',
				'mode',
				[
					['light', 'appearanceLight'],
					['dark', 'appearanceDark'],
				],
				state.mode,
			),
			scenes,
		);
	}
	function themeName(theme) {
		if (theme.packageId === 'builtin:fluent') {
			return tr('appearanceOfficialDefault');
		}
		if (theme.packageId.startsWith('builtin:')) {
			return tr({ document: 'appearanceDocument', compact: 'appearanceCompact' }[theme.manifest.id] || 'appearanceBuiltin');
		}
		return localName(theme.manifest.name);
	}
	function swatch(theme) {
		const palette = node('span', 'appearance-theme-swatch');
		const tokens = theme.manifest?.tokens?.light || {};
		// App themes publish their colours instead of v1 tokens.
		const colors = theme.profile?.publicAppearance?.light || {};
		palette.style.backgroundColor = tokens['--2fa-background'] || colors.subtle || '#f5f5f5';
		for (const color of [
			tokens['--2fa-accent'] || colors.accent || '#0f6cbd',
			tokens['--2fa-surface'] || colors.surface || '#fff',
			tokens['--2fa-text'] || colors.text || '#242424',
		]) {
			const dot = node('i');
			dot.style.backgroundColor = color;
			palette.append(dot);
		}
		return palette;
	}
	// The screenshot an installed theme ships; its colours when it has none or the image fails.
	function thumbnail(theme) {
		const preview = isApp(theme) && theme.packageId && theme.manifest?.preview;
		if (!preview) {
			return swatch(theme);
		}
		const frame = node('span', 'appearance-theme-swatch appearance-theme-shot');
		const image = node('img');
		image.alt = '';
		image.decoding = 'async';
		image.addEventListener('error', () => frame.replaceWith(swatch(theme)), { once: true });
		image.src = '/api/themes/' + encodeURIComponent(theme.packageId) + '/files/' + preview.split('/').map(encodeURIComponent).join('/');
		frame.append(image);
		return frame;
	}
	function themeCard(theme) {
		const wrap = node('div', 'appearance-theme-item');
		const card = button('appearanceCatalogSelect', 'select', 'appearance-theme-card');
		card.dataset.package = theme.packageId;
		card.replaceChildren();
		card.setAttribute('aria-pressed', String(theme.packageId === state.draft?.packageId));
		const text = node('span', 'appearance-theme-text');
		text.append(node('strong', '', themeName(theme)));
		const meta = [theme.packageId.startsWith('builtin:') ? tr('appearanceBuiltin') : theme.manifest.version];
		if (theme.packageId === state.applied?.packageId) {
			meta.push(tr('appearanceCurrent'));
		}
		text.append(node('small', '', meta.filter(Boolean).join(' · ')));
		card.append(thumbnail(theme), text);
		wrap.append(card);
		if (!theme.packageId.startsWith('builtin:')) {
			const remove = button('appearanceDelete', 'delete', 'appearance-theme-delete');
			remove.dataset.package = theme.packageId;
			remove.dataset.write = '';
			remove.textContent = '×';
			remove.title = tr('appearanceDelete');
			remove.setAttribute('aria-label', tr('appearanceDelete') + ': ' + themeName(theme));
			wrap.append(remove);
		}
		return wrap;
	}
	function installedThemes() {
		const latest = new Map();
		const installedAt = (theme) => (Number.isFinite(theme.installedAt) && theme.installedAt > 0 ? theme.installedAt : 0);
		for (const theme of state.library) {
			if (theme.superseded || theme.packageId.startsWith('builtin:')) {
				continue;
			}
			const key = profileKey(theme);
			const existing = latest.get(key);
			if (
				!existing ||
				installedAt(theme) > installedAt(existing) ||
				(installedAt(theme) === installedAt(existing) && theme.packageId.localeCompare(existing.packageId) > 0)
			) {
				latest.set(key, theme);
			}
		}
		return [...latest.values()].sort((a, b) => themeName(a).localeCompare(themeName(b)));
	}
	function visibleThemes() {
		const shown = state.library.filter(
			(theme) =>
				theme.packageId === 'builtin:fluent' ||
				(theme.packageId.startsWith('builtin:') && [state.draft?.packageId, state.applied?.packageId].includes(theme.packageId)),
		);
		return [...shown, ...installedThemes()];
	}
	function renderCatalog() {
		const section = node('section', 'appearance-section appearance-catalog');
		section.id = 'appearanceCatalog';
		section.setAttribute('aria-labelledby', 'appearanceCatalogTitle');
		const title = node('h3', 'appearance-section-title', tr('appearanceCommunityThemes'));
		title.id = 'appearanceCatalogTitle';
		section.append(title);
		const available = [];
		for (const theme of state.catalog) {
			if (
				!state.library.some((item) => item.packageId === theme.packageId) &&
				!available.some((item) => item.packageId === theme.packageId)
			) {
				available.push(theme);
			}
		}
		const unavailable = (text) => {
			const row = node('div', 'appearance-note appearance-note-row');
			const status = node('span', '', text);
			status.setAttribute('role', 'status');
			row.append(status, button('appearanceCatalogRetry', 'catalog-retry', 'btn btn-secondary btn-sm'));
			section.append(row);
		};
		const failed = state.catalogSources.filter((source) => source.status === 'error');
		if (state.catalogStatus === 'loading' || state.catalogStatus === 'idle') {
			section.append(node('p', 'appearance-note', tr('appearanceCatalogLoading')));
		} else if (state.catalogStatus === 'error') {
			unavailable(tr('appearanceCatalogUnavailable'));
		} else {
			for (const source of failed) {
				unavailable(
					source.official
						? tr('appearanceCatalogUnavailable')
						: tr('appearanceCatalogSourceUnavailable', { repository: source.repository }),
				);
			}
			if (!available.length && !failed.length) {
				section.append(node('p', 'appearance-note', tr('appearanceCatalogEmpty')));
			}
		}
		const cards = node('div', 'appearance-theme-grid');
		for (const theme of available) {
			const update = state.library.some((item) => item.manifest.id === theme.id && isApp(item) === (theme.kind === 'app'));
			const official =
				!theme.repository || state.catalogSources.some((source) => source.official && source.repository === theme.repository);
			const card = button('appearanceCatalogSelect', 'catalog-install', 'appearance-theme-card');
			card.dataset.catalogId = theme.id;
			card.dataset.package = theme.packageId;
			card.dataset.repository = official ? '' : theme.repository;
			card.dataset.write = '';
			card.replaceChildren();
			card.setAttribute('aria-pressed', 'false');
			const text = node('span', 'appearance-theme-text');
			text.append(node('strong', '', localName(theme.name)));
			const meta = update ? [tr('appearanceCatalogUpdate')] : [theme.version, theme.author];
			if (!official) {
				meta.push(tr('appearanceCatalogFrom', { repository: theme.repository }));
			}
			text.append(node('small', '', meta.filter(Boolean).join(' · ')));
			if (theme.description) {
				card.title = localName(theme.description);
			}
			card.append(swatch(theme), text);
			const wrap = node('div', 'appearance-theme-item');
			wrap.append(card);
			cards.append(wrap);
		}
		section.append(cards);
		if (state.capabilities.write && state.autoUpdate) {
			section.append(renderAutoUpdate());
		}
		if (state.capabilities.write) {
			section.append(renderCatalogSources());
		}
		return section;
	}
	/** Off by default; the store updates official-catalog themes once a day. */
	function renderAutoUpdate() {
		const block = node('div', 'appearance-auto-update');
		const input = node('input');
		input.type = 'checkbox';
		input.id = 'appearanceAutoUpdate';
		input.checked = state.autoUpdate.enabled === true;
		input.dataset.appearanceAction = 'auto-update';
		input.dataset.editorControl = '';
		input.dataset.write = '';
		const label = node('label', 'appearance-auto-update-toggle');
		label.append(input, node('span', '', tr('appearanceAutoUpdate')));
		block.append(label, node('p', 'appearance-note', tr('appearanceAutoUpdateHelp')));
		const reasons = {
			'host-version': 'appearanceAutoUpdateHostVersion',
			capabilities: 'appearanceAutoUpdateCapabilities',
			settings: 'appearanceAutoUpdateSettings',
		};
		for (const item of (state.autoUpdate.history || []).slice(0, 3)) {
			const params = { name: localName(item.name) || item.id, version: item.to };
			let text;
			if (item.status === 'applied' || item.status === 'installed') {
				text = tr('appearanceAutoUpdated', {
					...params,
					date: new Date(item.at).toLocaleDateString(document.documentElement.lang || undefined),
				});
			} else if (item.status === 'skipped' && reasons[item.reason]) {
				text = tr('appearanceAutoUpdateSkipped', { ...params, reason: tr(reasons[item.reason]) });
			} else {
				text = tr('appearanceAutoUpdateFailed', params);
			}
			block.append(node('p', 'appearance-note appearance-auto-update-entry', text));
		}
		return block;
	}
	/** The owner's own public GitHub catalogs, listed after the official one. */
	function renderCatalogSources() {
		const block = node('div', 'appearance-catalog-sources');
		block.append(
			node('h4', 'appearance-section-subtitle', tr('appearanceCatalogSources')),
			node('p', 'appearance-note', tr('appearanceCatalogSourcesHelp')),
		);
		const list = node('ul', 'appearance-catalog-source-list');
		for (const repository of state.customCatalogs) {
			const item = node('li', 'appearance-catalog-source');
			const remove = button('appearanceCatalogRemove', 'catalog-remove', 'appearance-catalog-source-remove');
			remove.dataset.repository = repository;
			remove.dataset.write = '';
			remove.textContent = '×';
			remove.title = tr('appearanceCatalogRemove');
			remove.setAttribute('aria-label', tr('appearanceCatalogRemove') + ': ' + repository);
			item.append(node('span', 'appearance-catalog-source-name', repository), remove);
			list.append(item);
		}
		if (state.customCatalogs.length) {
			block.append(list);
		}
		const input = node('input');
		input.id = 'appearanceCatalogRepository';
		input.type = 'text';
		input.placeholder = 'owner/name';
		input.autocomplete = 'off';
		input.spellcheck = false;
		input.value = state.catalogInput;
		input.dataset.write = '';
		input.addEventListener('input', () => {
			state.catalogInput = input.value;
		});
		input.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' && !state.busy) {
				event.preventDefault();
				void action('catalog-add', input).catch(errorMessage);
			}
		});
		const row = node('div', 'appearance-catalog-source-add');
		const add = button('appearanceCatalogAdd', 'catalog-add', 'btn btn-secondary btn-sm');
		add.dataset.write = '';
		row.append(field(tr('appearanceCatalogRepository'), input), add);
		block.append(row);
		return block;
	}
	/** After any install, reload the library and select the new theme for preview. */
	async function installed(response, nonce, packageId) {
		const data = await response.json();
		if (!state.open || nonce !== state.nonce) {
			return;
		}
		await load();
		const theme = data.theme || state.library.find((item) => item.packageId === packageId);
		if (theme) {
			select(state.library.find((item) => item.packageId === theme.packageId) || theme);
		}
		message(tr('appearanceInstalled'));
	}
	/** Uploads a theme ZIP chosen by the owner; nothing is applied until Apply. */
	async function importFile(file) {
		if (!canWrite()) {
			message(tr(navigator.onLine ? 'appearanceNoBinding' : 'appearanceOffline'), true);
			return;
		}
		if (file.size > 12 * 1024 * 1024) {
			message(tr('appearanceErrorLimit'), true);
			return;
		}
		const nonce = state.nonce;
		setBusy(true);
		try {
			message(tr('appearanceInstalling'));
			const response = await api('/api/themes/import', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/zip',
					'X-File-Name': String(file.name || 'theme.zip').replace(/[^\x20-\x7e]/g, '_'),
				},
				body: file,
			});
			await installed(response, nonce);
		} finally {
			setBusy(false);
		}
	}
	async function saveCatalogs(repositories) {
		const response = await api('/api/themes/catalogs', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ repositories }),
		});
		const data = await response.json();
		state.customCatalogs = Array.isArray(data.custom) ? data.custom : [];
		refreshCatalogSection();
	}
	function refreshCatalogSection() {
		const current = document.getElementById('appearanceCatalog');
		if (!state.open || !current) {
			return;
		}
		current.replaceWith(renderCatalog());
		setBusy(state.busy);
	}
	async function loadCatalog() {
		const generation = ++state.catalogGeneration;
		state.catalogStatus = navigator.onLine ? 'loading' : 'error';
		refreshCatalogSection();
		if (!navigator.onLine) {
			return;
		}
		try {
			// The switch is optional: a store without it (or an error) just hides it.
			const [data, autoUpdate] = await Promise.all([
				api('/api/themes/catalog').then((response) => response.json()),
				state.capabilities.write
					? api('/api/themes/auto-update')
							.then((response) => response.json())
							.catch(() => null)
					: null,
			]);
			if (!state.open || generation !== state.catalogGeneration) {
				return;
			}
			state.autoUpdate = autoUpdate && typeof autoUpdate.enabled === 'boolean' ? autoUpdate : null;
			state.catalog = Array.isArray(data.themes) ? data.themes : [];
			state.catalogSources = Array.isArray(data.sources) ? data.sources : [];
			state.customCatalogs = state.catalogSources.filter((source) => !source.official).map((source) => source.repository);
			state.catalogStatus = 'ready';
		} catch {
			if (!state.open || generation !== state.catalogGeneration) {
				return;
			}
			state.catalogStatus = 'error';
		}
		refreshCatalogSection();
	}
	function settingControl(setting) {
		const value = state.draft.settings[setting.key] ?? setting.default;
		let control;
		if (setting.type === 'select' || setting.type === 'boolean') {
			control = document.createElement('select');
			const options =
				setting.type === 'boolean'
					? [
							{ value: 'true', label: tr('yes') },
							{ value: 'false', label: tr('no') },
						]
					: setting.options || [];
			for (const option of options) {
				const item = typeof option === 'object' ? option : { value: option, label: String(option) };
				const element = node('option', '', optionLabel(item.label));
				element.value = String(item.value);
				control.append(element);
			}
			control.value = String(value);
			control.addEventListener('change', () => {
				state.draft.settings[setting.key] = setting.type === 'boolean' ? control.value === 'true' : control.value;
				changed();
			});
		} else {
			control = document.createElement(setting.type === 'textarea' ? 'textarea' : 'input');
			if (setting.type !== 'textarea') {
				control.type = setting.type === 'number' ? 'number' : setting.type === 'color' ? 'color' : 'text';
			}
			control.value = value ?? '';
			for (const name of ['min', 'max', 'step']) {
				if (setting[name] !== undefined) {
					control[name] = String(setting[name]);
				}
			}
			control.addEventListener('input', () => {
				state.draft.settings[setting.key] = setting.type === 'number' ? Number(control.value) : control.value;
				changed();
			});
		}
		control.dataset.themeSetting = setting.key;
		return field(settingLabel(setting), control, settingLabel(setting, 'description'));
	}
	function renderSettings() {
		const section = node('section', 'appearance-section appearance-settings');
		const head = node('div', 'appearance-section-head');
		head.append(node('h3', 'appearance-section-title', tr('appearanceThemeSettings')));
		const settings = state.draft.manifest?.settings || [];
		if (settings.length) {
			head.append(button('appearanceReset', 'reset', 'appearance-link'));
		}
		section.append(head);
		if (state.migration.length) {
			section.append(node('p', 'appearance-note', tr('appearanceMigration')));
		}
		if (!settings.length) {
			section.append(node('p', 'appearance-note', tr('appearanceNoThemeSettings')));
		}
		state.draft.settings ||= {};
		const grid = node('div', 'appearance-settings-grid');
		for (const setting of settings) {
			grid.append(settingControl(setting));
		}
		section.append(grid);
		if (isApp(state.draft)) {
			section.append(node('p', 'appearance-note', tr('appearanceAppTrust')));
		}
		return section;
	}
	function render() {
		const panel = document.getElementById('appearancePanel');
		if (!panel || !state.draft) {
			return;
		}
		const mine = node('section', 'appearance-section');
		const head = node('div', 'appearance-section-head');
		head.append(node('h3', 'appearance-section-title', tr('appearanceLibrary')));
		// Authors start from the theme guide, which leads to the template and the SDK reference.
		const guide = node('a', 'appearance-link appearance-guide', tr('appearanceMakeTheme'));
		guide.href = themeGuideUrl;
		guide.target = '_blank';
		guide.rel = 'noopener noreferrer';
		head.append(guide);
		if (state.capabilities.write) {
			const file = node('input');
			file.id = 'appearanceImportFile';
			file.type = 'file';
			file.accept = '.zip,application/zip';
			file.hidden = true;
			file.addEventListener('change', () => {
				const selected = file.files?.[0];
				file.value = '';
				if (selected && !state.busy) {
					void importFile(selected).catch(errorMessage);
				}
			});
			const trigger = button('appearanceImport', 'import-file', 'btn btn-secondary btn-sm');
			trigger.dataset.write = '';
			head.append(trigger, file);
		}
		mine.append(head);
		const grid = node('div', 'appearance-theme-grid');
		for (const theme of visibleThemes()) {
			grid.append(themeCard(theme));
		}
		mine.append(grid);
		panel.replaceChildren(mine, renderCatalog(), ...(state.draft.manifest ? [renderSettings()] : []));
		renderToolbar();
		setBusy(state.busy);
	}
	async function confirm(key, danger = true) {
		return window.showConfirmDialog({
			i18n: { title: 'appearanceTitle', message: key, confirmText: 'confirm', cancelText: 'cancel' },
			danger,
		});
	}
	function select(theme) {
		if (state.draft?.themeId) {
			state.profiles.set(profileKey(state.draft), clone(state.draft));
		}
		stopAppPreview();
		state.draft = makeDraft(theme, state.draft || {});
		changed();
		render();
	}
	async function action(name, target) {
		if (name === 'width' || name === 'mode') {
			state[name] = name === 'width' ? Number(target.dataset.value) : target.dataset.value;
			renderToolbar();
			notifyPreview();
			return;
		}
		if (name === 'close') {
			return window.requestAppearanceClose();
		}
		if (name === 'refresh-preview') {
			await preview(true);
			return;
		}
		if (name === 'catalog-retry') {
			await loadCatalog();
			return;
		}
		if (name === 'select') {
			const theme = state.library.find((item) => item.packageId === target.dataset.package);
			if (theme && theme.packageId !== state.draft?.packageId) {
				select(theme);
				document
					.querySelector('#appearancePanel .appearance-theme-card[data-package="' + theme.packageId + '"]')
					?.focus({ preventScroll: true });
			}
			return;
		}
		if (name === 'reset') {
			const theme = state.library.find((item) => item.packageId === state.draft.packageId) || state.draft;
			state.draft = makeDraft(theme, {}, { reset: true });
			changed();
			render();
			return;
		}
		if (name === 'refresh-runtime') {
			await refreshRuntime({ patience: APPLY_REFRESH_PATIENCE });
			return;
		}
		if (name === 'reload') {
			if (state.dirty && !(await confirm('appearanceDiscardChanges'))) {
				return;
			}
			setBusy(true);
			try {
				await load({ replaceDraft: true });
				render();
			} finally {
				setBusy(false);
			}
			return;
		}
		if (!canWrite()) {
			message(tr(navigator.onLine ? 'appearanceNoBinding' : 'appearanceOffline'), true);
			return;
		}
		if (name === 'apply') {
			if (isApp(state.draft) && !state.trustedPackages.has(state.draft.packageId)) {
				if (!(await confirm('appearanceAppTrust', false))) {
					return;
				}
				state.trustedPackages.add(state.draft.packageId);
			}
		}
		if (name === 'import-file') {
			document.getElementById('appearanceImportFile')?.click();
			return;
		}
		if (name === 'delete' && !(await confirm('appearanceDeleteConfirm'))) {
			return;
		}
		setBusy(true);
		try {
			if (name === 'apply') {
				message(tr('appearanceSaving'));
				// Switching packages ends in a reload; show that from the click instead of after the save.
				const running = switchesPackage() ? window.__2FA_APPEARANCE__ : null;
				if (running) {
					showApplying();
				}
				try {
					await apply();
					if (running && state.reloadRequired) {
						await prepareOrRestore(running);
					}
				} catch (error) {
					hideApplying();
					throw error;
				}
			} else if (name === 'catalog-add') {
				const repository = state.catalogInput.trim();
				if (!repository) {
					document.getElementById('appearanceCatalogRepository')?.focus();
					return;
				}
				await saveCatalogs([...state.customCatalogs, repository]);
				state.catalogInput = '';
				message('');
				await loadCatalog();
			} else if (name === 'auto-update') {
				try {
					const response = await api('/api/themes/auto-update', {
						method: 'PUT',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ enabled: target.checked }),
					});
					state.autoUpdate = await response.json();
				} finally {
					// A failed save puts the switch back to the stored value.
					refreshCatalogSection();
				}
			} else if (name === 'catalog-remove') {
				await saveCatalogs(state.customCatalogs.filter((repository) => repository !== target.dataset.repository));
				message('');
				await loadCatalog();
			} else if (name === 'catalog-install') {
				const repository = target.dataset.repository || '';
				const theme = state.catalog.find(
					(item) =>
						item.id === target.dataset.catalogId &&
						item.packageId === target.dataset.package &&
						(!repository || item.repository === repository),
				);
				if (!theme) {
					return;
				}
				const nonce = state.nonce;
				message(tr('appearanceInstalling'));
				try {
					const response = await api('/api/themes/catalog/install', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ id: theme.id, packageId: theme.packageId, ...(repository ? { repository } : {}) }),
					});
					await installed(response, nonce, theme.packageId);
				} catch (error) {
					if (error.code === 'THEME_CATALOG_CHANGED') {
						void loadCatalog();
					}
					throw error;
				}
			} else if (name === 'delete') {
				const id = target.dataset.package;
				await api('/api/themes/' + encodeURIComponent(id), { method: 'DELETE' });
				state.library = state.library.filter((theme) => theme.packageId !== id);
				const selected = state.draft?.packageId === id;
				await load({ replaceDraft: selected || !state.dirty });
				render();
				notifyPreview();
			}
		} finally {
			setBusy(false);
		}
		// Applying a different theme package needs a new page; do it right away instead of asking.
		if (
			name === 'apply' &&
			state.reloadRequired &&
			!window.__2FA_SAFE_MODE__ &&
			typeof window.requestAppearanceRuntimeReload === 'function'
		) {
			await refreshRuntime({ patience: APPLY_REFRESH_PATIENCE });
		} else if (name === 'apply') {
			hideApplying();
		}
	}
	function switchesPackage() {
		const running = window.__2FA_APPEARANCE__;
		return (
			!window.__2FA_SAFE_MODE__ &&
			typeof window.requestAppearanceRuntimeReload === 'function' &&
			(isApp(running) || isApp(state.draft)) &&
			running?.packageId !== state.draft?.packageId
		);
	}
	// The page reloads into the saved theme only once every file it needs is downloaded and checked.
	// Otherwise the running theme is saved back, so this device never switches into a half-loaded one.
	const PREPARE_PATIENCE = 60000;
	async function prepareOrRestore(running) {
		if (typeof window.prepareAppearanceRuntime !== 'function') {
			return;
		}
		showApplying('appearanceDownloading');
		let timer;
		const result = await Promise.race([
			Promise.resolve()
				.then(() => window.prepareAppearanceRuntime(window.__2FA_APPEARANCE__))
				.catch(() => ({ status: 'blocked', reason: 'prepare-failed' })),
			new Promise((resolve) => {
				timer = setTimeout(() => resolve({ status: 'blocked', reason: 'prepare-timeout' }), PREPARE_PATIENCE);
			}),
		]);
		clearTimeout(timer);
		// No worker means nothing can be prepared; the switch goes ahead as before. So does a worker
		// from before 2.0: the update that replaces it on the reload prepares the theme instead.
		if (!result || result.status === 'ready' || result.reason === 'legacy-worker') {
			return;
		}
		const target = clone(state.draft);
		const response = await api('/api/appearance', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				expectedRevision: state.revision,
				operationId: uid(),
				packageId: running.packageId,
				settings: running.settings,
			}),
		});
		await acceptCurrent(response);
		state.reloadRequired = false;
		// The chosen theme stays selected, so trying again is one click.
		state.draft = target;
		state.dirty = true;
		render();
		throw new Error(tr('appearanceNotReady'));
	}
	function showApplying(key = 'appearanceApplying') {
		let cover = document.getElementById('appearanceApplying');
		if (!cover) {
			cover = document.createElement('div');
			cover.id = 'appearanceApplying';
			cover.setAttribute('role', 'status');
			cover.setAttribute('aria-live', 'polite');
			document.body.append(cover);
		}
		cover.textContent = tr(key);
		cover.hidden = false;
	}
	function hideApplying() {
		const cover = document.getElementById('appearanceApplying');
		if (cover) {
			cover.hidden = true;
		}
	}
	// A save or account write that is still finishing only delays the refresh after applying.
	const APPLY_REFRESH_PATIENCE = 8000;
	const REFRESH_RETRY_DELAY = 250;
	async function refreshRuntime({ patience = 0 } = {}) {
		close();
		// Opened from the settings dialog, that dialog is still open and would block the refresh;
		// only unsaved settings should.
		if (document.getElementById('settingsModal') && !window.hasUnsavedSettingsChanges?.()) {
			window.hideModal('settingsModal');
		}
		let retries = Math.ceil(patience / REFRESH_RETRY_DELAY);
		while (true) {
			// A waiting app update is taken in the same reload, so the next page is current too.
			const waiting = Boolean((await navigator.serviceWorker?.getRegistration?.().catch(() => null))?.waiting);
			let result = await window.requestAppearanceRuntimeReload?.(waiting ? 'update' : 'theme-change');
			if (waiting && result?.status !== 'completed' && result?.reason !== 'unsaved-or-pending') {
				result = await window.requestAppearanceRuntimeReload?.('theme-change');
			}
			if (['completed', 'cancelled'].includes(result?.status)) {
				return;
			}
			if (result?.reason !== 'unsaved-or-pending' || retries-- <= 0) {
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, REFRESH_RETRY_DELAY));
		}
		hideApplying();
		await window.showAppearanceEditor();
		message(tr('moduleRefreshBlocked'), true);
	}
	async function apply() {
		const draft = state.draft;
		const response = await api('/api/appearance', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				expectedRevision: state.revision,
				operationId: uid(),
				packageId: draft.packageId,
				settings: draft.settings,
			}),
		});
		await acceptCurrent(response);
	}
	function validAppearanceResponse(data) {
		const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
		return Boolean(
			Number.isSafeInteger(data?.revision) &&
			data.revision >= 0 &&
			record(data.active) &&
			data.active.revision === data.revision &&
			typeof data.active.packageId === 'string' &&
			data.active.packageId.length &&
			typeof data.active.themeId === 'string' &&
			record(data.active.manifest) &&
			Array.isArray(data.active.manifest.settings) &&
			record(data.active.settings),
		);
	}
	async function acceptCurrent(response) {
		let data = await response?.json().catch(() => null);
		// A receipt is a historical commit; re-read the current state instead.
		if (!validAppearanceResponse(data) || data.replayed) {
			data = await (await api('/api/appearance')).json();
		}
		if (!validAppearanceResponse(data)) {
			throw new Error(tr('appearanceErrorFormat'));
		}
		if (data.revision < Math.max(state.revision, state.remoteRevision)) {
			state.conflict = true;
			throw new Error(tr('appearanceConflict'));
		}
		const running = window.__2FA_APPEARANCE__;
		state.revision = data.revision;
		state.remoteRevision = Math.max(state.remoteRevision, data.revision);
		state.draft = clone(data.active);
		state.applied = clone(data.active);
		state.dirty = false;
		state.conflict = false;
		state.migration = [];
		state.profiles.clear();
		rememberProfile(data.active);
		state.reloadRequired ||= Boolean((isApp(running) || isApp(data.active)) && running?.packageId !== data.active?.packageId);
		window.__2FA_APPEARANCE__ = data.active;
		if (!window.__2FA_SAFE_MODE__ && !state.reloadRequired) {
			window.applyAppearance?.(data.active);
		}
		window.updateAppearanceMetadata?.();
		if (window.__2FA_SAFE_MODE__ || state.reloadRequired) {
			window.dispatchEvent(new CustomEvent('appearance-applied', { detail: data.active }));
		}
		message(tr(state.reloadRequired ? 'appearancePublishedReload' : 'appearanceApplied'));
		render();
	}
	function sizePreview(frame) {
		if (!frame?.parentElement) {
			return;
		}
		const viewport = document.querySelector('.appearance-preview-viewport');
		const available = viewport?.clientWidth || state.width;
		const height = viewport?.clientHeight || 600;
		const scale = Math.min(1, available / state.width);
		frame.style.width = state.width + 'px';
		frame.style.transformOrigin = 'top left';
		frame.style.transform = 'scale(' + scale + ')';
		frame.style.height = Math.ceil(height / scale) + 'px';
		frame.style.marginLeft = scale < 1 ? '0' : Math.max(0, (available - state.width) / 2) + 'px';
	}
	function appPreviewStatus(status) {
		if (!state.open || !isApp(state.draft)) {
			return;
		}
		const element = document.getElementById('appearanceAppPreviewStatus');
		const key =
			status.status === 'ready'
				? ''
				: status.reason === 'offline-preview-unavailable'
					? 'appearancePreviewOffline'
					: status.reason === 'preview-expired'
						? 'appearancePreviewExpired'
						: status.status === 'blocked'
							? 'appearancePreviewBlocked'
							: 'appearanceLoading';
		element.hidden = !key;
		element.replaceChildren(key ? tr(key) : '');
		if (key && status.status === 'blocked') {
			element.append(button('appearanceRefreshPreview', 'refresh-preview', 'btn btn-secondary btn-sm'));
		}
		sizePreview(document.querySelector('#appearanceAppPreview iframe'));
	}
	function previewError(error) {
		if (!state.open) {
			return;
		}
		const status = document.getElementById('appearanceAppPreviewStatus');
		if (status) {
			status.hidden = false;
			status.textContent = tr('appearanceError', { message: String(error?.message || error) });
		}
	}
	function stopAppPreview() {
		state.previewGeneration += 1;
		state.previewTask = null;
		state.appPreview?.close();
		state.appPreviewPackage = null;
	}
	async function previewApp(force) {
		if (state.previewTask) {
			state.previewTask.changed = true;
			return;
		}
		const task = { changed: false };
		state.previewTask = task;
		try {
			await runAppPreview(force);
		} finally {
			if (state.previewTask === task) {
				state.previewTask = null;
				if (task.changed && state.open) {
					notifyPreview();
				}
			}
		}
	}
	async function runAppPreview(force) {
		const generation = ++state.previewGeneration;
		const draft = clone(state.draft);
		if (state.previewSessionInvalid) {
			appPreviewStatus({ status: 'blocked', reason: 'session-invalidated' });
			return;
		}
		if (!navigator.onLine) {
			stopAppPreview();
			appPreviewStatus({ status: 'blocked', reason: 'offline-preview-unavailable' });
			return;
		}
		if (!window.createAppThemePreview) {
			appPreviewStatus({ status: 'blocked' });
			return;
		}
		state.appPreview ||= window.createAppThemePreview({
			container: document.getElementById('appearanceAppPreview'),
			request: (url, options) => api(url, options),
			translate: tr,
			onStatus: appPreviewStatus,
			onSessionInvalidated: () => {
				stopAppPreview();
				state.previewSessionInvalid = true;
				state.capabilities.write = false;
				state.loadGeneration += 1;
				setBusy(state.busy);
				if (state.open) {
					message(tr('loginModalDesc'), true);
					appPreviewStatus({ status: 'blocked', reason: 'session-invalidated' });
				}
			},
		});
		const fresh = force || state.appPreviewPackage !== draft.packageId;
		if (fresh) {
			// Claim this package synchronously so typing never opens a second capability.
			state.appPreviewPackage = draft.packageId;
			appPreviewStatus({ status: 'preparing' });
		}
		const payload = {
			packageId: draft.packageId,
			appearance: { settings: draft.settings },
			mode: state.mode,
			language: document.documentElement.lang,
			scene: state.scene,
		};
		try {
			await state.appPreview[fresh ? 'open' : 'update'](payload);
		} catch (error) {
			if (state.open && generation === state.previewGeneration) {
				appPreviewStatus({ status: 'blocked' });
				previewError(error);
			}
		}
		if (state.open && generation === state.previewGeneration) {
			sizePreview(document.querySelector('#appearanceAppPreview iframe'));
		}
	}
	async function resourceBytes(resource) {
		let bytes = resourceCache.get(resource.hash);
		if (bytes) {
			return bytes;
		}
		let response;
		if (navigator.onLine) {
			try {
				response = await api('/api/appearance/assets/' + resource.hash);
			} catch {
				/* Try the immutable offline copy. */
			}
		}
		if (!response && window.caches) {
			const canonical = '/theme-assets/' + resource.hash + '/' + encodeURIComponent(resource.name);
			response = await window.caches.match(new URL(canonical, window.location.origin).href);
		}
		if (!response?.ok) {
			throw new Error(tr('appearanceErrorMissing'));
		}
		bytes = await response.arrayBuffer();
		resourceCache.set(resource.hash, bytes);
		return bytes;
	}
	async function preview(force = false) {
		if (!state.open || !state.draft) {
			return;
		}
		const frame = document.getElementById('appearancePreview');
		const app = isApp(state.draft);
		frame.style.display = app ? 'none' : 'block';
		document.getElementById('appearanceAppPreview').hidden = !app;
		if (app) {
			return previewApp(force);
		}
		document.getElementById('appearanceAppPreviewStatus').hidden = true;
		if (state.appPreviewPackage) {
			stopAppPreview();
		}
		if (!state.ready) {
			return;
		}
		const generation = ++state.previewGeneration;
		if (!frame?.contentWindow || !frame.isConnected) {
			return;
		}
		const resources = [];
		for (const resource of state.draft.resources || []) {
			const url = resource.url || '/theme-assets/' + resource.hash + '/' + encodeURIComponent(resource.name);
			try {
				resources.push({ url, hash: resource.hash, mime: resource.mime, bytes: await resourceBytes(resource) });
			} catch {
				/* The preview keeps its plain background if a theme resource is unavailable. */
			}
		}
		if (generation !== state.previewGeneration || !state.open || !frame.isConnected) {
			return;
		}
		sizePreview(frame);
		frame.contentWindow.postMessage(
			{
				type: 'appearance-preview',
				nonce: state.nonce,
				sequence: generation,
				snapshot: clone(state.draft),
				mode: state.mode,
				scene: state.scene,
				language: document.documentElement.lang,
				resources,
				labels: Object.fromEntries(
					[
						'appearanceAllServices',
						'appearanceServiceNavigation',
						'appearanceSampleOnly',
						'appearancePreviewAction',
						'appearanceLoginTitle',
						'appearanceLoginButton',
						'appearanceWelcomeTitle',
						'appearanceWelcomeText',
						'appearanceOfflineScene',
						'searchInputPlaceholder',
						'searchNoMatch',
						'emptyAddBtn',
						'fabSettings',
						'cardMenuQRCode',
						'cardMenuQRCodeTitle',
						'cardMenuCopyURI',
						'cardMenuCopyURITitle',
						'cardMenuCopyLink',
						'cardMenuCopyLinkTitle',
						'cardMenuEdit',
						'cardMenuEditTitle',
						'cardMenuDelete',
						'cardMenuDeleteTitle',
						'cardCopyTooltip',
						'counterLabel',
						'cardMenuTriggerTitle',
						'copyOtpBtnTitle',
						'copyOtpBtnAriaLabel',
						'copyNextOtpBtnTitle',
						'otpNextLabel',
					].map((key) => [key, tr(key)]),
				),
			},
			'*',
		);
	}
	function close() {
		state.open = false;
		state.dirty = false;
		state.catalogGeneration += 1;
		state.loadGeneration += 1;
		clearTimeout(state.previewTimer);
		stopAppPreview();
		window.hideModal('appearanceModal');
	}
	window.hasAppearancePendingChanges = () => state.open || state.busy;
	window.requestAppearanceClose = async () => {
		if (state.busy) {
			return;
		}
		if (state.dirty && !(await confirm('appearanceDiscardChanges'))) {
			return;
		}
		close();
	};
	window.showAppearanceEditor = async () => {
		if (state.open || state.busy) {
			return;
		}
		ensureEditor();
		state.open = true;
		state.catalogStatus = 'idle';
		state.ready = false;
		state.nonce = uid();
		state.width = window.innerWidth < 760 ? 390 : 1440;
		state.library = window.__2FA_BUILTIN_THEMES__ || state.library;
		state.draft = clone(window.__2FA_APPEARANCE__ || {});
		state.applied = clone(window.__2FA_APPEARANCE__ || null);
		state.revision = state.draft.revision || 0;
		state.remoteRevision = Math.max(state.remoteRevision, state.revision);
		state.dirty = false;
		state.conflict = false;
		state.migration = [];
		state.profiles.clear();
		if (!state.draft.packageId && state.library[0]) {
			state.draft = makeDraft(state.library[0]);
		}
		setBusy(true);
		window.showModal('appearanceModal');
		message(tr('appearanceLoading'));
		render();
		try {
			await load({ replaceDraft: true });
			if (navigator.onLine && state.capabilities.write) {
				message('');
			}
		} catch (error) {
			errorMessage(error);
		}
		if (!window.__2FA_BUILD_ID__) {
			message(tr('appearanceSourceMode'));
		}
		const frame = document.getElementById('appearancePreview');
		frame.srcdoc = window.createAppearancePreviewDocument(state.nonce);
		frame.onload = () => {
			state.ready = true;
			notifyPreview();
		};
		setBusy(false);
		render();
		notifyPreview();
		void loadCatalog();
	};
	window.addEventListener('message', (event) => {
		const frame = document.getElementById('appearancePreview');
		if (event.source !== frame?.contentWindow || event.data?.nonce !== state.nonce) {
			return;
		}
		if (event.data.type === 'appearance-preview-ready') {
			state.ready = true;
			notifyPreview();
		}
	});
	window.addEventListener('beforeunload', (event) => {
		if (state.open && state.dirty) {
			event.preventDefault();
			event.returnValue = '';
		}
	});
	window.addEventListener('resize', () => {
		if (state.open) {
			notifyPreview();
		}
	});
	window.addEventListener('appearance-updated-elsewhere', (event) => {
		if (Number.isSafeInteger(event.detail?.revision)) {
			state.remoteRevision = Math.max(state.remoteRevision, event.detail.revision);
		}
		state.conflict = true;
		message(tr('appearanceUpdatedElsewhere'));
	});
	window.addEventListener('online', () => {
		if (!state.open) {
			return;
		}
		void loadCatalog();
		void load()
			.then(() => {
				setBusy(state.busy);
				if (state.open && !state.busy) {
					render();
					if (!state.conflict) {
						message('');
					}
				}
			})
			.catch(errorMessage);
	});
	window.addEventListener('offline', () => {
		state.catalogGeneration += 1;
		state.catalogStatus = 'error';
		refreshCatalogSection();
		stopAppPreview();
		state.capabilities.write = false;
		state.loadGeneration += 1;
		setBusy(state.busy);
		if (state.open) {
			message(tr('appearanceOffline'));
			if (isApp(state.draft)) {
				appPreviewStatus({ status: 'blocked', reason: 'offline-preview-unavailable' });
			}
		}
	});
}
