import { serializeBrowserFunction } from './browserSource.js';
import { getAppearancePreviewDocument } from './appearanceRuntime.js';
import { getAppearanceErrorCode } from './appearanceMessages.js';
import { migrateSettings, validateSettingValue } from '../../themes/schema.js';

/** Keep valid user values across versions while preserving each theme's saved profile. */
export function createAppearanceDraft(theme, current = {}, { reset = false } = {}, migrate = migrateSettings) {
	const clone = (value) => JSON.parse(JSON.stringify(value));
	const format = (value) => (value?.kind === 'app' || value?.manifest?.kind === 'app' ? 'app' : 'v1');
	const app = format(theme) === 'app';
	const sameTheme = current.themeId === theme.manifest.id && format(current) === format(theme);
	const profile = format(theme.profile) === format(theme) ? theme.profile : null;
	const previous = reset ? {} : sameTheme ? current : profile || {};
	const values = clone(previous.settings || {});
	if (app && previous.packageId) {
		const prefix = '/theme-packages/' + previous.packageId + '/';
		for (const field of theme.manifest.settings) {
			if (field.type === 'asset' && typeof values[field.key] === 'string' && values[field.key].startsWith(prefix)) {
				values[field.key] = values[field.key].slice(prefix.length);
			}
		}
	}
	const migration = migrate(previous.manifest || { settings: [] }, theme.manifest, values);
	if (app) {
		for (const field of theme.manifest.settings) {
			const value = migration.settings[field.key];
			if (field.type !== 'asset' || !value || /^local:|^\/(?:theme-assets|api\/appearance\/assets)\/[a-f0-9]{64}(?:\/|$)/.test(value)) {
				continue;
			}
			if (!theme.manifest.files?.some((file) => file.path === value && (file.mime?.startsWith('image/') || file.mime === 'font/woff2'))) {
				migration.settings[field.key] = field.default;
				if (!migration.changes.some((change) => change.key === field.key)) {
					migration.changes.push({ key: field.key, reason: 'asset-missing', value: field.default });
				}
			}
		}
	}
	const sameVersion = previous.packageId === theme.packageId;
	const resources = new Map();
	const brandHashes = new Set(
		['logo', 'icon192', 'icon512', 'appleTouchIcon', 'background']
			.map((key) => /^\/(?:theme-assets|api\/appearance\/assets)\/([a-f0-9]{64})(?:\/|$)/.exec(current.branding?.[key] || '')?.[1])
			.filter(Boolean),
	);
	const brandResources = (current.resources || []).filter((resource) => brandHashes.has(resource.hash));
	for (const resource of [...(theme.assets || theme.resources || []), ...(previous.resources || []), ...brandResources]) {
		resources.set(resource.hash || resource.url, resource);
	}
	return {
		draft: {
			packageId: theme.packageId,
			themeId: theme.manifest.id,
			manifest: clone(theme.manifest),
			...(app
				? { kind: 'app' }
				: {
						css: theme.css || '',
						layout: clone(sameVersion && previous.layout ? previous.layout : theme.manifest.layout),
						content: clone(sameVersion && previous.content ? previous.content : theme.manifest.content || {}),
						customCss: previous.customCss || '',
					}),
			settings: clone(migration.settings),
			branding: clone(current.branding || previous.branding || {}),
			resources: clone([...resources.values()]),
		},
		changes: previous.manifest ? migration.changes : [],
	};
}

/** The editor owns local drafts; only an explicit apply publishes them. */
export function getAppearanceEditorCode() {
	const template = getAppearancePreviewDocument({ nonce: 'APPEARANCEPREVIEWNONCE' });
	return `${getAppearanceErrorCode()}\nwindow.createAppearancePreviewDocument = function(nonce) { return ${JSON.stringify(template).replace(/</g, '\\u003c')}.split('APPEARANCEPREVIEWNONCE').join(nonce.replace(/[^a-z0-9_-]/gi, '')); };\n(function() { const validateValue = ${serializeBrowserFunction(validateSettingValue)}; const migrate = function(previous, next, values) { return (${serializeBrowserFunction(migrateSettings)})(previous, next, values, validateValue); }; const createDraft = function(theme, current, options) { return (${serializeBrowserFunction(createAppearanceDraft)})(theme, current, options, migrate); }; (${serializeBrowserFunction(appearanceEditorClient)})(createDraft); })();`;
}

function appearanceEditorClient(createAppearanceDraft) {
	const state = {
		open: false,
		busy: false,
		dirty: false,
		revision: 0,
		remoteRevision: 0,
		loadGeneration: 0,
		draftEpoch: 0,
		version: 0,
		persisted: 0,
		library: [],
		draft: null,
		capabilities: { write: false },
		blobs: new Map(),
		panel: 'library',
		mode: 'light',
		scene: 'workspace',
		migration: [],
		width: 1440,
		nonce: '',
		ready: false,
		previewTimer: null,
		persistTimer: null,
		queue: Promise.resolve(),
		previewGeneration: 0,
		localProfiles: new Map(),
		importFormat: 'v1',
		trustedPackages: new Set(),
		appPreview: null,
		appPreviewPackage: null,
		previewReferences: [],
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
	const importUrl = (url) => url + (state.importFormat === 'app' ? '?format=app' : '');
	const regions = ['header', 'leading', 'main', 'trailing', 'footer'];
	const regionKeys = ['appearanceHeader', 'appearanceLeading', 'appearanceMain', 'appearanceTrailing', 'appearanceFooterRegion'];
	const required = new Set(['search', 'view-controls', 'system-status', 'accounts', 'actions']);
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
		'Background image': 'appearanceBackground',
		Font: 'appearanceFont',
		'Code font': 'appearanceCodeFont',
		'Font size': 'appearanceFontSize',
		'Page width': 'appearancePageWidth',
		Spacing: 'appearanceSpacing',
		'Card padding': 'appearanceCardPadding',
		'Icon size': 'appearanceIconSize',
		Shadow: 'appearanceShadow',
		Columns: 'appearanceColumns',
		Animation: 'appearanceAnimation',
		'Surface opacity': 'appearanceOpacity',
		'Background blur': 'appearanceBlur',
		System: 'appearanceSystem',
		Serif: 'appearanceSerif',
		Monospace: 'appearanceMonospace',
		None: 'appearanceNone',
		Strong: 'appearanceStrong',
		Automatic: 'appearanceAuto',
	};
	const componentLabels = {
		brand: 'appearanceBrand',
		'service-nav': 'appearanceServiceNavigation',
		search: 'searchInputPlaceholder',
		'view-controls': 'appearanceViewComponent',
		'system-status': 'appearanceStatusComponent',
		accounts: 'appearanceAllServices',
		actions: 'appearanceActions',
		footer: 'appearanceFooterRegion',
		text: 'appearanceTextComponent',
		image: 'appearanceImageComponent',
		links: 'appearanceLinksComponent',
	};
	const builtin = () => state.draft?.packageId?.startsWith('builtin:');
	const optionLabel = (label) => (builtin() && builtinLabels[label] ? tr(builtinLabels[label]) : localName(label));
	function settingLabel(setting, part = 'label') {
		const translated = setting.translations?.[document.documentElement.lang]?.[part];
		return translated || (part === 'label' ? optionLabel(setting.label || setting.key) : setting.description || '');
	}
	let database;

	function db() {
		if (!database) {
			database = new Promise((resolve, reject) => {
				const request = indexedDB.open('2fa-appearance-drafts', 1);
				request.onupgradeneeded = () => request.result.createObjectStore('drafts');
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => {
					database = null;
					reject(request.error);
				};
			});
		}
		return database;
	}
	async function draftStore(mode, value) {
		const connection = await db();
		return new Promise((resolve, reject) => {
			const transaction = connection.transaction('drafts', mode === 'get' ? 'readonly' : 'readwrite');
			const store = transaction.objectStore('drafts');
			const request = mode === 'get' ? store.get('current') : mode === 'delete' ? store.delete('current') : store.put(value, 'current');
			transaction.oncomplete = () => resolve(request.result);
			transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error(tr('appearanceDraftFailed')));
		});
	}
	function message(text, error = false) {
		const element = document.getElementById('appearanceStatus');
		if (element) {
			element.textContent = text;
			element.dataset.error = String(error);
			if (state.conflict) {
				element.append(button('appearanceReload', 'reload'));
			}
			if (state.reloadRequired) {
				element.append(button('appearanceRefreshNow', 'refresh-runtime'));
			}
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
			control.disabled = value || control.dataset.fixedDisabled === 'true';
		});
		modal?.querySelectorAll('[data-write]').forEach((button) => {
			button.disabled = value || !canWrite();
		});
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
			row.append(node('small', 'settings-desc', help));
		}
		return row;
	}
	function input(value, change, type = 'text') {
		const element = document.createElement(type === 'textarea' ? 'textarea' : 'input');
		if (type !== 'textarea') {
			element.type = type;
		}
		element.value = value ?? '';
		element.addEventListener('input', () => {
			change(type === 'number' ? Number(element.value) : element.value);
			changed();
		});
		return element;
	}
	function notifyPreview() {
		clearTimeout(state.previewTimer);
		state.previewTimer = setTimeout(() => void preview().catch(errorMessage), 120);
	}
	function changed() {
		state.dirty = true;
		if (state.draft?.themeId) {
			state.localProfiles.set(profileKey(state.draft), clone(state.draft));
		}
		state.version += 1;
		message(tr('appearanceUnsaved'));
		clearTimeout(state.persistTimer);
		state.persistTimer = setTimeout(() => void persist().catch(() => message(tr('appearanceDraftFailed'), true)), 250);
		notifyPreview();
	}
	function persist() {
		clearTimeout(state.persistTimer);
		state.persistTimer = null;
		if (!state.draft) {
			return state.queue;
		}
		const epoch = state.draftEpoch;
		const version = state.version;
		const saved = {
			draft: clone(state.draft),
			revision: state.revision,
			blobs: Array.from(state.blobs),
			dirty: state.dirty,
			pendingApply: state.pendingApply,
			profiles: Array.from(state.localProfiles),
			migration: clone(state.migration),
		};
		const task = state.queue
			.catch(() => {})
			.then(() => (epoch === state.draftEpoch ? draftStore('put', saved) : undefined))
			.then(() => {
				if (epoch === state.draftEpoch) {
					state.persisted = Math.max(state.persisted, version);
				}
			});
		state.queue = task;
		return task;
	}
	function clearStoredDraft() {
		clearTimeout(state.persistTimer);
		state.persistTimer = null;
		const epoch = ++state.draftEpoch;
		state.loadGeneration += 1;
		const task = state.queue
			.catch(() => {})
			.then(() => draftStore('delete'))
			.then(() => {
				if (epoch !== state.draftEpoch) {
					return;
				}
				state.version = 0;
				state.persisted = 0;
				state.pendingApply = null;
				state.dirty = false;
				state.conflict = false;
				state.migration = [];
				state.blobs.clear();
				state.localProfiles.clear();
			});
		state.queue = task;
		return task;
	}
	function selectedTheme() {
		return state.library.find((theme) => theme.packageId === state.draft?.packageId);
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
		const local = state.localProfiles.get(profileKey(theme));
		const selected = local && profileKey(previous) !== profileKey(theme) ? { ...theme, profile: local } : theme;
		const result = createAppearanceDraft(selected, previous, options);
		state.migration = result.changes;
		return { revision: state.revision, ...result.draft };
	}
	async function load({ replaceDraft = false, preserveDraft = false } = {}) {
		const generation = ++state.loadGeneration;
		const epoch = state.draftEpoch;
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
		if (generation !== state.loadGeneration || epoch !== state.draftEpoch) {
			return;
		}
		state.library = [...(library.themes || []), ...(appLibrary.themes || [])];
		state.capabilities = appearance.capabilities || { write: false };
		state.previewSessionInvalid = false;
		const revision = appearance.revision || 0;
		state.remoteRevision = Math.max(state.remoteRevision, revision);
		if (revision >= state.remoteRevision) {
			rememberProfile(appearance.active);
		}
		if (!preserveDraft && (replaceDraft || (!state.dirty && !state.pendingApply)) && revision >= state.remoteRevision) {
			state.revision = revision;
			state.draft = clone(appearance.active || (state.library[0] && makeDraft(state.library[0])) || {});
			state.conflict = false;
		} else if (state.remoteRevision > state.revision) {
			state.conflict = true;
			message(tr('appearanceConflict'), true);
		}
		if (!state.capabilities.write) {
			message(tr('appearanceNoBinding'));
		}
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
		const sidebar = node('div', 'appearance-controls');
		const tabs = node('nav', 'appearance-tabs');
		tabs.setAttribute('aria-label', tr('appearanceTitle'));
		for (const [name, key] of [
			['library', 'appearanceLibrary'],
			['brand', 'appearanceBrand'],
			['design', 'appearanceDesign'],
			['layout', 'appearanceLayout'],
			['advanced', 'appearanceAdvanced'],
		]) {
			const tab = button(key, 'panel', 'appearance-tab');
			tab.dataset.panel = name;
			tabs.append(tab);
		}
		const panel = node('div', 'appearance-panel');
		panel.id = 'appearancePanel';
		sidebar.append(tabs, panel);
		const previewSection = node('section', 'appearance-preview-section');
		const toolbar = node('div', 'appearance-preview-toolbar');
		for (const [label, width] of [
			['appearanceDesktop', 1440],
			['appearanceTablet', 768],
			['appearanceMobile', 390],
		]) {
			const control = button(label, 'width', 'btn btn-secondary btn-sm');
			control.dataset.width = String(width);
			toolbar.append(control);
		}
		for (const mode of ['light', 'dark']) {
			const control = button(mode === 'light' ? 'appearanceLight' : 'appearanceDark', 'mode', 'btn btn-secondary btn-sm');
			control.dataset.mode = mode;
			toolbar.append(control);
		}
		const scenes = document.createElement('select');
		scenes.id = 'appearanceScene';
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
		scenes.addEventListener('change', () => {
			state.scene = scenes.value;
			notifyPreview();
		});
		toolbar.append(scenes);
		const refreshPreview = button('appearanceRefreshPreview', 'refresh-preview', 'btn btn-secondary btn-sm');
		refreshPreview.id = 'appearanceRefreshPreview';
		refreshPreview.hidden = true;
		toolbar.append(refreshPreview);
		const viewport = node('div', 'appearance-preview-viewport');
		const frame = document.createElement('iframe');
		frame.id = 'appearancePreview';
		frame.title = tr('appearancePreview');
		frame.setAttribute('sandbox', 'allow-scripts');
		viewport.append(frame);
		const appContainer = node('div');
		appContainer.id = 'appearanceAppPreview';
		appContainer.hidden = true;
		viewport.append(appContainer);
		const previewStatus = node('p', 'settings-desc');
		previewStatus.id = 'appearanceAppPreviewStatus';
		previewStatus.setAttribute('role', 'status');
		previewSection.append(previewStatus);
		previewSection.append(toolbar, viewport, node('p', 'settings-desc', tr('appearancePreviewHelp')));
		workspace.append(sidebar, previewSection);
		const status = node('div', 'appearance-status');
		status.id = 'appearanceStatus';
		status.setAttribute('role', 'status');
		status.setAttribute('aria-live', 'polite');
		const actions = node('div', 'appearance-footer-actions');
		const apply = button('appearanceApply', 'apply', 'btn btn-primary');
		apply.dataset.write = '';
		const rollback = button('appearanceRollback', 'rollback');
		rollback.dataset.write = '';
		actions.append(button('appearanceDiscardDraft', 'discard'), button('appearanceKeepDraft', 'keep'), rollback, apply);
		content.append(header, workspace, status, actions);
		modal.append(content);
		document.body.append(modal);
		modal.addEventListener('click', (event) => {
			const target = event.target.closest('[data-appearance-action]');
			if (!target || state.busy) {
				return;
			}
			void action(target.dataset.appearanceAction, target).catch(errorMessage);
		});
	}
	function render() {
		const panel = document.getElementById('appearancePanel');
		if (!panel || !state.draft) {
			return;
		}
		panel.replaceChildren();
		if (isApp(state.draft) && ['layout', 'advanced'].includes(state.panel)) {
			state.panel = 'design';
		}
		if (state.migration.length) {
			const note = node('div', 'appearance-migration', tr('appearanceMigration'));
			const changes = node('ul');
			for (const change of state.migration) {
				const setting = state.draft.manifest.settings.find((entry) => entry.key === change.key);
				changes.append(node('li', '', setting ? settingLabel(setting) : change.key));
			}
			note.append(changes);
			panel.append(note);
		}
		document.querySelectorAll('.appearance-tab').forEach((tab) => {
			tab.hidden = Boolean(isApp(state.draft) && ['layout', 'advanced'].includes(tab.dataset.panel));
			tab.style.display = tab.hidden ? 'none' : '';
			tab.classList.toggle('active', tab.dataset.panel === state.panel);
			tab.setAttribute('aria-current', tab.dataset.panel === state.panel ? 'page' : 'false');
		});
		if (state.panel === 'library') {
			renderLibrary(panel);
		} else if (state.panel === 'brand') {
			renderBrand(panel);
		} else if (state.panel === 'design') {
			renderSettings(panel);
		} else if (state.panel === 'layout') {
			renderLayout(panel);
		} else {
			panel.append(
				field(
					tr('appearanceAdvanced'),
					input(
						state.draft.customCss,
						(value) => {
							state.draft.customCss = value;
						},
						'textarea',
					),
					tr('appearanceCssHelp'),
				),
			);
		}
		setBusy(state.busy);
		notifyPreview();
	}
	function fileButton(label, restore) {
		const wrapper = node('label', 'btn btn-secondary appearance-file-button', tr(label));
		const file = document.createElement('input');
		file.type = 'file';
		file.accept = restore || state.importFormat === 'app' ? '.zip' : '.zip,.json,.css';
		file.dataset.write = '';
		file.dataset.editorControl = '';
		file.addEventListener('change', () => {
			if (file.files[0]) {
				void importFile(file.files[0], restore).catch(errorMessage);
			}
		});
		wrapper.append(file);
		return wrapper;
	}
	function renderLibrary(panel) {
		const cards = node('div', 'appearance-theme-list');
		for (const theme of state.library) {
			const card = button('appearancePreview', 'select', 'appearance-theme-card');
			card.dataset.package = theme.packageId;
			card.replaceChildren();
			card.setAttribute('aria-pressed', String(theme.packageId === state.draft.packageId));
			const palette = node('div', 'appearance-theme-swatch');
			const tokens = theme.manifest.tokens?.light || {};
			palette.style.backgroundColor = tokens['--2fa-background'] || '#f5f5f5';
			for (const color of [tokens['--2fa-accent'] || '#0f6cbd', tokens['--2fa-surface'] || '#fff', tokens['--2fa-text'] || '#242424']) {
				const dot = node('i');
				dot.style.backgroundColor = color;
				palette.append(dot);
			}
			card.append(
				palette,
				node(
					'strong',
					'',
					theme.packageId.startsWith('builtin:')
						? tr({ fluent: 'appearanceFluent', document: 'appearanceDocument', compact: 'appearanceCompact' }[theme.manifest.id])
						: localName(theme.manifest.name),
				),
				node('small', '', theme.builtIn || theme.packageId.startsWith('builtin:') ? tr('appearanceBuiltin') : theme.manifest.version),
			);
			if (isApp(theme)) {
				card.append(node('small', '', tr('appearanceAppTheme')));
			}
			cards.append(card);
		}
		panel.append(cards);
		const format = document.createElement('select');
		format.id = 'appearanceImportFormat';
		for (const [value, label] of [
			['v1', 'appearanceStyleTheme'],
			['app', 'appearanceAppTheme'],
		]) {
			const option = node('option', '', tr(label));
			option.value = value;
			format.append(option);
		}
		format.value = state.importFormat;
		format.addEventListener('change', () => {
			state.importFormat = format.value;
			render();
		});
		panel.append(field(tr('appearanceImportFormat'), format));
		if (isApp(state.draft) || state.importFormat === 'app') {
			panel.append(node('p', 'settings-desc', tr('appearanceAppTrust')));
		}
		const imports = node('div', 'appearance-import-actions');
		imports.append(fileButton('appearanceImport', false), fileButton('appearanceRestore', true));
		panel.append(imports);
		const source = input('', () => {});
		source.id = 'appearanceSource';
		source.type = 'url';
		panel.append(field(tr('appearanceSource'), source));
		const install = button('appearanceInstall', 'install');
		install.dataset.write = '';
		panel.append(install);
		const exports = node('div', 'appearance-import-actions');
		for (const [key, act] of [
			['appearanceExport', 'export'],
			['appearanceBackup', 'backup'],
			['appearanceDelete', 'delete'],
		]) {
			const control = button(key, act);
			control.dataset.write = '';
			exports.append(control);
		}
		panel.append(exports);
	}
	function assetField(panel, key, label, icon = false) {
		const wrap = node('div', 'appearance-asset-field');
		const current = state.draft.branding?.[key];
		if (current) {
			wrap.append(node('small', 'appearance-asset-name', current.startsWith('local:') ? tr('appearanceUnsaved') : current));
		}
		const upload = node('label', 'btn btn-secondary appearance-file-button', tr('appearanceAssetUpload'));
		const file = document.createElement('input');
		file.type = 'file';
		file.accept = 'image/png,image/jpeg,image/webp,image/gif';
		file.dataset.editorControl = '';
		file.addEventListener('change', () => {
			if (file.files[0]) {
				void addImage(file.files[0], key, icon).catch(errorMessage);
			}
		});
		upload.append(file);
		wrap.append(upload);
		const source = document.createElement('input');
		source.type = 'url';
		source.placeholder = 'https://';
		source.dataset.editorControl = '';
		const load = button('appearanceAssetUrl', 'noop');
		load.addEventListener('click', () => {
			if (source.value) {
				void importImage(source.value, key, icon).catch(errorMessage);
			}
		});
		const remove = button('appearanceAssetRemove', 'noop');
		remove.addEventListener('click', () => {
			delete state.draft.branding[key];
			if (icon) {
				for (const sizeKey of ['icon192', 'icon512', 'appleTouchIcon']) {
					delete state.draft.branding[sizeKey];
				}
			}
			changed();
			render();
		});
		wrap.append(source, load, remove);
		panel.append(field(tr(label), wrap));
	}
	function renderBrand(panel) {
		state.draft.branding ||= {};
		for (const [key, label] of [
			['name', 'appearanceName'],
			['description', 'appearanceDescription'],
			['loginText', 'appearanceLoginText'],
			['footer', 'appearanceFooter'],
		]) {
			panel.append(
				field(
					tr(label),
					input(state.draft.branding[key], (value) => {
						state.draft.branding[key] = value;
					}),
				),
			);
		}
		assetField(panel, 'logo', 'appearanceLogo');
		assetField(panel, 'icon512', 'appearanceAppIcon', true);
		assetField(panel, 'background', 'appearanceBackground');
		panel.append(node('p', 'settings-desc', tr('appearanceAssetHelp')));
	}
	function resourceControl(value, update) {
		const wrapper = node('div', 'appearance-asset-field');
		if (value) {
			wrapper.append(node('small', 'appearance-asset-name', state.blobs.get(value)?.name || value));
		}
		const upload = node('label', 'btn btn-secondary appearance-file-button', tr('appearanceResourceUpload'));
		const file = document.createElement('input');
		file.type = 'file';
		file.accept = '.png,.jpg,.jpeg,.webp,.gif,.woff2';
		file.dataset.editorControl = '';
		file.addEventListener('change', () => {
			const selected = file.files[0];
			if (!selected) {
				return;
			}
			try {
				if (!/\.(?:png|jpe?g|webp|gif|woff2)$/i.test(selected.name)) {
					throw new Error(tr('appearanceErrorFormat'));
				}
				update(rememberBlob(selected, selected.name));
				changed();
				render();
			} catch (error) {
				errorMessage(error);
			}
		});
		upload.append(file);
		const source = document.createElement('input');
		source.type = 'url';
		source.placeholder = 'https://';
		source.dataset.editorControl = '';
		const load = button('appearanceResourceUrl', 'noop');
		load.dataset.write = '';
		load.addEventListener('click', () => {
			if (!source.value || state.busy) {
				return;
			}
			void (async () => {
				setBusy(true);
				try {
					const data = await (
						await api('/api/appearance/assets', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ url: source.value }),
						})
					).json();
					const asset = data.asset || data;
					const blob = await (await api('/api/appearance/assets/' + asset.hash)).blob();
					update(rememberBlob(blob, asset.name));
					changed();
					render();
				} finally {
					setBusy(false);
				}
			})().catch(errorMessage);
		});
		const remove = button('appearanceResourceRemove', 'noop');
		remove.addEventListener('click', () => {
			update('');
			changed();
			render();
		});
		wrapper.append(upload, source, load, remove);
		return wrapper;
	}
	function renderSettings(panel) {
		state.draft.settings ||= {};
		for (const setting of state.draft.manifest?.settings || []) {
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
			} else if (setting.type === 'asset') {
				control = resourceControl(value, (reference) => {
					state.draft.settings[setting.key] = reference;
				});
			} else {
				control = input(
					value,
					(next) => {
						state.draft.settings[setting.key] = next;
					},
					setting.type === 'number' ? 'number' : setting.type === 'color' ? 'color' : setting.type === 'textarea' ? 'textarea' : 'text',
				);
				if (setting.min !== undefined) {
					control.min = String(setting.min);
				}
				if (setting.max !== undefined) {
					control.max = String(setting.max);
				}
				if (setting.step !== undefined) {
					control.step = String(setting.step);
				}
			}
			panel.append(field(settingLabel(setting), control, settingLabel(setting, 'description')));
		}
		panel.append(button('appearanceReset', 'reset'));
	}
	function renderLayout(panel) {
		const layout = state.draft.layout || state.draft.manifest.layout;
		regions.forEach((region, regionIndex) => {
			const section = node('section', 'appearance-layout-region');
			section.append(node('h3', 'settings-section-title', tr(regionKeys[regionIndex])));
			(layout[region] || []).forEach((raw, index) => {
				const item = typeof raw === 'string' ? { id: raw, type: raw } : raw;
				const row = node('div', 'appearance-layout-item');
				row.append(node('strong', '', tr(componentLabels[item.type]) || item.type));
				const select = document.createElement('select');
				select.setAttribute('aria-label', tr('appearanceRegion'));
				select.dataset.editorControl = '';
				regions.forEach((name, i) => {
					const option = node('option', '', tr(regionKeys[i]));
					option.value = name;
					option.disabled = item.type === 'accounts' && name !== 'main';
					select.append(option);
				});
				select.value = region;
				select.addEventListener('change', () => {
					layout[region].splice(index, 1);
					layout[select.value].push(item);
					state.draft.layout = layout;
					changed();
					render();
				});
				row.append(select);
				if (item.type === 'actions') {
					const mode = document.createElement('select');
					mode.dataset.editorControl = '';
					mode.setAttribute('aria-label', tr('appearanceActions'));
					for (const [value, label] of [
						['floating', 'appearanceFloating'],
						['toolbar', 'appearanceToolbar'],
					]) {
						const option = node('option', '', tr(label));
						option.value = value;
						mode.append(option);
					}
					mode.value = item.mode || 'floating';
					mode.addEventListener('change', () => {
						item.mode = mode.value;
						layout[region][index] = item;
						state.draft.layout = layout;
						changed();
					});
					row.append(mode);
				}
				for (const [label, step] of [
					['appearanceMoveUp', -1],
					['appearanceMoveDown', 1],
				]) {
					const move = button(label, 'noop', 'btn btn-secondary btn-sm');
					move.disabled = index + step < 0 || index + step >= layout[region].length;
					move.dataset.fixedDisabled = String(move.disabled);
					move.addEventListener('click', () => {
						if (index + step < 0 || index + step >= layout[region].length) {
							return;
						}
						[layout[region][index], layout[region][index + step]] = [layout[region][index + step], layout[region][index]];
						state.draft.layout = layout;
						changed();
						render();
					});
					row.append(move);
				}
				if (!required.has(item.type)) {
					const visible = document.createElement('input');
					visible.type = 'checkbox';
					visible.checked = Boolean(item.hidden);
					visible.dataset.editorControl = '';
					visible.addEventListener('change', () => {
						item.hidden = visible.checked;
						layout[region][index] = item;
						state.draft.layout = layout;
						changed();
					});
					row.append(field(tr('appearanceHidden'), visible));
					const remove = button('delete', 'noop', 'btn btn-secondary btn-sm');
					remove.addEventListener('click', () => {
						layout[region].splice(index, 1);
						if (state.draft.content) {
							delete state.draft.content[item.id];
						}
						state.draft.layout = layout;
						changed();
						render();
					});
					row.append(remove);
				}
				if (['text', 'links', 'image'].includes(item.type)) {
					state.draft.content ||= clone(state.draft.manifest.content || {});
					const content = (state.draft.content[item.id] ||= {});
					const value =
						item.type === 'links'
							? (content.items || []).map((link) => link.label + ' | ' + link.href).join('\n')
							: content.text || content.src || '';
					if (item.type === 'image') {
						row.append(
							field(
								tr('appearanceContent'),
								resourceControl(content.src || '', (reference) => {
									content.src = reference;
									state.draft.layout = layout;
								}),
							),
						);
					} else {
						row.append(
							field(
								tr('appearanceContent'),
								input(
									value,
									(next) => {
										if (item.type === 'links') {
											content.items = next
												.split('\n')
												.filter(Boolean)
												.map((line) => {
													const split = line.indexOf('|');
													return split < 0
														? { label: line.trim(), href: '' }
														: { label: line.slice(0, split).trim(), href: line.slice(split + 1).trim() };
												});
										} else {
											content.text = next;
										}
										state.draft.layout = layout;
									},
									item.type === 'image' ? 'text' : 'textarea',
								),
								item.type === 'links' ? tr('appearanceLinksHelp') : '',
							),
						);
					}
				}
				section.append(row);
			});
			panel.append(section);
		});
		for (const [type, label] of [
			['text', 'appearanceAddText'],
			['links', 'appearanceAddLinks'],
			['image', 'appearanceAddImage'],
		]) {
			const add = button(label, 'noop');
			add.addEventListener('click', () => {
				const id = type + '-' + uid();
				layout.trailing.push({ id, type });
				state.draft.content ||= {};
				state.draft.content[id] = type === 'links' ? { items: [] } : type === 'image' ? { src: '', alt: '' } : { text: '' };
				state.draft.layout = layout;
				changed();
				render();
			});
			panel.append(add);
		}
	}
	async function confirm(key) {
		return window.showConfirmDialog({
			i18n: { title: 'appearanceTitle', message: key, confirmText: 'confirm', cancelText: 'cancel' },
			danger: true,
		});
	}
	async function action(name, target) {
		if (name === 'noop') {
			return;
		}
		if (name === 'panel') {
			state.panel = target.dataset.panel;
			render();
			return;
		}
		if (name === 'width') {
			state.width = Number(target.dataset.width);
			notifyPreview();
			return;
		}
		if (name === 'mode') {
			state.mode = target.dataset.mode;
			notifyPreview();
			return;
		}
		if (name === 'select') {
			const theme = state.library.find((item) => item.packageId === target.dataset.package);
			if (theme) {
				setBusy(true);
				try {
					const previous =
						isApp(state.draft) && state.draft.packageId !== theme.packageId
							? await portableBranding(state.draft, theme.packageId)
							: state.draft;
					state.localProfiles.set(profileKey(state.draft), clone(state.draft));
					stopAppPreview();
					state.draft = makeDraft(theme, previous);
					changed();
					render();
				} finally {
					setBusy(false);
				}
			}
			return;
		}
		if (name === 'refresh-preview') {
			await preview(true);
			return;
		}
		if (name === 'refresh-runtime') {
			if (state.dirty) {
				await persist();
			}
			close();
			const result = await window.requestAppearanceRuntimeReload?.('theme-change');
			if (result?.status !== 'completed') {
				await window.showAppearanceEditor();
				message(tr('moduleRefreshBlocked'), true);
			}
			return;
		}
		if (name === 'close') {
			return window.requestAppearanceClose();
		}
		if (name === 'keep') {
			setBusy(true);
			try {
				await persist();
				close();
			} finally {
				setBusy(false);
			}
			return;
		}
		if (name === 'discard') {
			setBusy(true);
			try {
				await clearStoredDraft();
				state.draft = null;
				close();
			} finally {
				setBusy(false);
			}
			return;
		}
		if (name === 'reset') {
			if (await confirm('appearanceResetConfirm')) {
				state.draft = makeDraft(
					selectedTheme() || { packageId: state.draft.packageId, manifest: state.draft.manifest, css: state.draft.css },
					{ branding: state.draft.branding },
					{ reset: true },
				);
				changed();
				render();
			}
			return;
		}
		if (name === 'reload') {
			if (!navigator.onLine) {
				message(tr('appearanceOffline'));
				return;
			}
			if (state.dirty && !(await confirm('appearanceDiscardDraft'))) {
				return;
			}
			setBusy(true);
			try {
				await clearStoredDraft();
				state.draft = null;
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
		setBusy(true);
		try {
			if (name === 'apply') {
				await apply();
			} else if (name === 'install') {
				const url = document.getElementById('appearanceSource').value;
				const response = await api(importUrl('/api/themes/import'), {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ url, operationId: uid() }),
				});
				await installed(await response.json());
			} else if (name === 'export' || name === 'backup') {
				await download(
					name === 'backup' ? '/api/appearance/export' : '/api/themes/' + encodeURIComponent(state.draft.packageId) + '/export',
					name === 'backup' ? '2fa-appearance.zip' : '2fa-theme.zip',
				);
			} else if (name === 'delete' && (await confirm('appearanceDeleteConfirm'))) {
				await api('/api/themes/' + encodeURIComponent(state.draft.packageId), { method: 'DELETE' });
				await clearStoredDraft();
				state.draft = null;
				await load({ replaceDraft: true });
				render();
			} else if (name === 'rollback' && (await confirm('appearanceRollbackConfirm'))) {
				const response = await api('/api/appearance/rollback', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ expectedRevision: state.revision, operationId: uid() }),
				});
				await response.json();
				await acceptCurrent();
			}
		} finally {
			setBusy(false);
		}
	}
	async function download(url, name) {
		const response = await api(url);
		const objectUrl = URL.createObjectURL(await response.blob());
		const anchor = document.createElement('a');
		anchor.href = objectUrl;
		anchor.download = name;
		anchor.click();
		setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
	}
	async function importFile(file, restore) {
		if (!canWrite()) {
			throw new Error(tr('appearanceNoBinding'));
		}
		setBusy(true);
		try {
			const form = new FormData();
			form.append('file', file);
			form.append('operationId', uid());
			const response = await api(importUrl(restore ? '/api/appearance/restore-inspect' : '/api/themes/import'), {
				method: 'POST',
				body: form,
			});
			await installed(await response.json());
		} finally {
			setBusy(false);
		}
	}
	async function installed(data) {
		await load({ preserveDraft: true });
		const theme = data.theme || state.library.find((item) => item.packageId === data.packageId);
		if (theme) {
			const previous = await portableBranding(state.draft || {}, theme.packageId);
			if (state.draft?.themeId) {
				state.localProfiles.set(profileKey(state.draft), clone(state.draft));
			}
			stopAppPreview();
			state.draft = makeDraft(theme, previous);
			if (data.appearance) {
				state.draft = makeDraft(theme, { ...data.appearance, manifest: theme.manifest, themeId: theme.manifest.id });
			}
			if (data.appearance) {
				await preserveDraftResources();
			}
			changed();
		}
		message(tr('appearanceInstalled'));
		render();
	}
	async function portableBranding(draft, nextPackage) {
		if (!isApp(draft) || draft.packageId === nextPackage) {
			return draft;
		}
		const portable = clone(draft);
		for (const key of ['logo', 'icon192', 'icon512', 'appleTouchIcon', 'background']) {
			const value = portable.branding?.[key];
			if (!value || value.startsWith('local:') || value.startsWith('/theme-assets/')) {
				continue;
			}
			const path = value.startsWith('/theme-packages/' + draft.packageId + '/')
				? value.slice(('/theme-packages/' + draft.packageId + '/').length)
				: value;
			const file = draft.manifest?.files?.find((entry) => entry.path === path && entry.mime.startsWith('image/'));
			if (!file) {
				throw new Error(tr('appearanceErrorMissing'));
			}
			if (!navigator.onLine) {
				throw new Error(tr('appearanceOfflineBrand'));
			}
			const response = await api('/api/themes/' + encodeURIComponent(draft.packageId) + '/files/' + file.path);
			portable.branding[key] = rememberBlob(await response.blob(), file.path.split('/').pop());
		}
		return portable;
	}
	function rememberBlob(blob, name) {
		if (blob.size > 10 * 1024 * 1024) {
			throw new Error(tr('appearanceErrorLimit'));
		}
		const key = 'local:' + uid();
		const mime =
			blob.type ||
			(/\.woff2$/i.test(name)
				? 'font/woff2'
				: /\.png$/i.test(name)
					? 'image/png'
					: /\.gif$/i.test(name)
						? 'image/gif'
						: /\.webp$/i.test(name)
							? 'image/webp'
							: 'image/jpeg');
		state.blobs.set(key, { blob, name, mime });
		return key;
	}
	async function preserveDraftResources() {
		const replacements = [];
		for (const asset of state.draft.resources || []) {
			const response = await api('/api/appearance/assets/' + asset.hash);
			const key = rememberBlob(await response.blob(), asset.name);
			for (const url of [
				asset.url,
				'/theme-assets/' + asset.hash + '/' + encodeURIComponent(asset.name),
				'/api/appearance/assets/' + asset.hash,
			]) {
				if (url) {
					replacements.push([url, key]);
				}
			}
		}
		state.draft = replaceReferences(state.draft, replacements);
	}
	async function resourceBytes(resource) {
		let bytes = resourceCache.get(resource.hash);
		if (bytes) {
			return bytes;
		}
		const canonical = '/theme-assets/' + resource.hash + '/' + encodeURIComponent(resource.name);
		let response;
		if (navigator.onLine) {
			try {
				response = await api('/api/appearance/assets/' + resource.hash);
			} catch {
				/* Try the immutable offline copy. */
			}
		}
		if (!response && window.caches) {
			response = await window.caches.match(new URL(canonical, window.location.origin).href);
		}
		if (!response?.ok) {
			throw new Error(tr('appearanceErrorMissing'));
		}
		bytes = await response.arrayBuffer();
		resourceCache.set(resource.hash, bytes);
		return bytes;
	}
	async function addImage(blob, key, icon, assetName) {
		if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(blob.type)) {
			throw new Error(tr('appearanceErrorFormat'));
		}
		const wasBusy = state.busy;
		const draft = state.draft;
		const epoch = state.draftEpoch;
		const generated = [];
		setBusy(true);
		try {
			if (icon) {
				const image = new window.Image();
				const objectUrl = URL.createObjectURL(blob);
				try {
					await new Promise((resolve, reject) => {
						image.onload = resolve;
						image.onerror = () => reject(new Error(tr('appearanceErrorFormat')));
						image.src = objectUrl;
					});
					for (const [name, size] of [
						['icon192', 192],
						['icon512', 512],
						['appleTouchIcon', 180],
					]) {
						const canvas = document.createElement('canvas');
						canvas.width = canvas.height = size;
						const ratio = Math.min(size / image.width, size / image.height);
						canvas
							.getContext('2d')
							.drawImage(
								image,
								(size - image.width * ratio) / 2,
								(size - image.height * ratio) / 2,
								image.width * ratio,
								image.height * ratio,
							);
						const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
						if (!png) {
							throw new Error(tr('appearanceDraftFailed'));
						}
						generated.push({ key: name, blob: png, name: name + '.png' });
					}
				} finally {
					URL.revokeObjectURL(objectUrl);
				}
			} else {
				const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[blob.type];
				generated.push({ key, blob, name: assetName || blob.name || 'image.' + extension });
			}
			if (state.draft !== draft || state.draftEpoch !== epoch) {
				return;
			}
			const references = Object.fromEntries(generated.map((asset) => [asset.key, rememberBlob(asset.blob, asset.name)]));
			Object.assign(draft.branding, references);
			changed();
			render();
		} finally {
			setBusy(wasBusy);
		}
	}
	async function importImage(url, key, icon) {
		if (!canWrite()) {
			throw new Error(tr('appearanceOffline'));
		}
		setBusy(true);
		try {
			const response = await api('/api/appearance/assets', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url }),
			});
			const data = await response.json();
			const asset = data.asset || data;
			const file = await api('/api/appearance/assets/' + asset.hash);
			const blob = await file.blob();
			await addImage(blob, key, icon, asset.name);
		} finally {
			setBusy(false);
		}
	}
	function replaceReferences(value, replacements) {
		if (typeof value === 'string') {
			for (const [from, to] of replacements) {
				value = value.split(from).join(to);
			}
			return value;
		}
		if (Array.isArray(value)) {
			return value.map((item) => replaceReferences(item, replacements));
		}
		if (value && typeof value === 'object') {
			return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceReferences(item, replacements)]));
		}
		return value;
	}
	async function uploadLocalResources(source) {
		const replacements = [];
		for (const [key, asset] of state.blobs) {
			if (!JSON.stringify(source).includes(key)) {
				continue;
			}
			const form = new FormData();
			form.append('file', asset.blob, asset.name);
			const data = await (await api('/api/appearance/assets', { method: 'POST', body: form })).json();
			const stored = data.asset || data;
			replacements.push([key, '/theme-assets/' + stored.hash + '/' + encodeURIComponent(stored.name)]);
		}
		return replacements;
	}
	async function apply() {
		if (isApp(state.draft) && !state.trustedPackages.has(state.draft.packageId)) {
			if (!(await confirm('appearanceAppTrust'))) {
				return;
			}
			state.trustedPackages.add(state.draft.packageId);
		}
		const replacements = await uploadLocalResources(state.draft);
		const draft = replaceReferences(state.draft, replacements);
		const payload = {
			expectedRevision: state.revision,
			operationId: uid(),
			packageId: draft.packageId,
			settings: draft.settings,
			branding: draft.branding,
			...(!isApp(draft) ? { layout: draft.layout, content: draft.content, customCss: draft.customCss } : {}),
		};
		const serialized = JSON.stringify(payload);
		// Preserve the operation identity for a retry after a lost response.
		if (state.pendingApply?.contents === JSON.stringify({ ...payload, operationId: '' })) {
			payload.operationId = state.pendingApply.id;
		}
		state.pendingApply = { id: payload.operationId, contents: JSON.stringify({ ...payload, operationId: '' }) };
		await persist();
		await api('/api/appearance', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: payload.operationId === JSON.parse(serialized).operationId ? serialized : JSON.stringify(payload),
		});
		await acceptCurrent();
	}
	async function acceptCurrent() {
		const running = window.__2FA_APPEARANCE__;
		const data = await (await api('/api/appearance')).json();
		if (data.revision < state.remoteRevision) {
			state.conflict = true;
			throw new Error(tr('appearanceConflict'));
		}
		await clearStoredDraft();
		state.revision = data.revision;
		state.remoteRevision = Math.max(state.remoteRevision, data.revision);
		state.draft = data.active;
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
		frame.style.width = state.width + 'px';
		const viewport = document.querySelector('.appearance-preview-viewport');
		const available = viewport?.clientWidth || state.width;
		const scale = Math.min(1, available / state.width);
		frame.style.transformOrigin = 'top left';
		frame.style.transform = 'scale(' + scale + ')';
		frame.style.height = Math.ceil(600 / scale) + 'px';
		frame.style.border = '0';
		frame.style.maxWidth = 'none';
	}
	function appPreviewStatus(status) {
		if (!state.open || !isApp(state.draft)) {
			return;
		}
		const key =
			status.status === 'ready'
				? 'appearancePreviewReady'
				: status.reason === 'offline-preview-unavailable'
					? 'appearancePreviewOffline'
					: status.reason === 'preview-expired'
						? 'appearancePreviewExpired'
						: status.reason === 'preview-resources-changed'
							? 'appearancePreviewChanged'
							: status.status === 'blocked'
								? 'appearancePreviewBlocked'
								: 'appearanceLoading';
		document.getElementById('appearanceAppPreviewStatus').textContent = tr(key);
		sizePreview(document.querySelector('#appearanceAppPreview iframe'));
	}
	function stopAppPreview() {
		state.previewGeneration += 1;
		state.previewTask = null;
		state.appPreview?.close();
		state.appPreviewPackage = null;
		state.previewReferences = [];
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
		if (state.previewSessionInvalid || generation !== state.previewGeneration) {
			return;
		}
		const fresh = force || state.appPreviewPackage !== draft.packageId;
		if (fresh) {
			// Claim this package synchronously so typing while staging never opens a second capability.
			state.appPreviewPackage = draft.packageId;
			appPreviewStatus({ status: 'preparing' });
			try {
				const references = await uploadLocalResources({ settings: draft.settings, branding: draft.branding });
				if (!state.open || generation !== state.previewGeneration || draft.packageId !== state.draft?.packageId) {
					return;
				}
				state.previewReferences = references;
			} catch (error) {
				if (state.open && generation === state.previewGeneration) {
					appPreviewStatus({ status: 'blocked' });
					errorMessage(error);
				}
				return;
			}
		}
		if (!state.open || generation !== state.previewGeneration) {
			return;
		}
		const appearance = replaceReferences({ settings: draft.settings, branding: draft.branding }, state.previewReferences);
		const assetValues = [
			...draft.manifest.settings.filter((field) => field.type === 'asset').map((field) => appearance.settings[field.key]),
			...['logo', 'icon192', 'icon512', 'appleTouchIcon', 'background'].map((key) => appearance.branding[key]),
		];
		if (assetValues.some((value) => typeof value === 'string' && value.startsWith('local:'))) {
			appPreviewStatus({ status: 'blocked', reason: 'preview-resources-changed' });
			return;
		}
		const payload = {
			packageId: draft.packageId,
			appearance,
			mode: state.mode,
			language: document.documentElement.lang,
			scene: state.scene,
		};
		try {
			await state.appPreview[fresh ? 'open' : 'update'](payload);
		} catch (error) {
			if (state.open && generation === state.previewGeneration) {
				appPreviewStatus({ status: 'blocked' });
				errorMessage(error);
			}
		}
		if (state.open && generation === state.previewGeneration) {
			sizePreview(document.querySelector('#appearanceAppPreview iframe'));
		}
	}
	async function preview(force = false) {
		if (!state.open || !state.draft) {
			return;
		}
		const frame = document.getElementById('appearancePreview');
		const app = isApp(state.draft);
		frame.style.display = app ? 'none' : 'block';
		document.getElementById('appearanceAppPreview').hidden = !app;
		document.getElementById('appearanceRefreshPreview').hidden = !app;
		document.getElementById('appearanceAppPreviewStatus').hidden = !app;
		if (app) {
			return previewApp(force);
		}
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
		for (const [url, entry] of state.blobs) {
			resources.push({ url, mime: entry.mime, bytes: await entry.blob.arrayBuffer() });
		}
		for (const resource of state.draft.resources || []) {
			const url = resource.url || '/theme-assets/' + resource.hash + '/' + encodeURIComponent(resource.name);
			if (url.startsWith('local:') && state.blobs.has(url)) {
				continue;
			}
			try {
				const bytes = await resourceBytes(resource);
				resources.push({ url, hash: resource.hash, mime: resource.mime, bytes });
			} catch {
				/* The preview retains its plain background if a draft resource is unavailable. */
			}
		}
		if (generation !== state.previewGeneration || !state.open || !frame.isConnected || !frame.parentElement) {
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
		clearTimeout(state.previewTimer);
		stopAppPreview();
		window.hideModal('appearanceModal');
	}
	window.hasAppearancePendingChanges = () => state.open || state.busy || state.persisted < state.version;
	window.requestAppearanceClose = async () => {
		if (state.busy) {
			return;
		}
		try {
			if (state.dirty) {
				const keep = await window.showConfirmDialog({
					i18n: {
						title: 'appearanceTitle',
						message: 'appearanceCloseDraft',
						confirmText: 'appearanceKeepDraft',
						cancelText: 'dialogKeepEditing',
					},
				});
				if (!keep) {
					return;
				}
				await persist();
			}
			close();
		} catch {
			message(tr('appearanceDraftFailed'), true);
		}
	};
	window.showAppearanceEditor = async () => {
		if (state.open || state.busy) {
			return;
		}
		ensureEditor();
		state.open = true;
		setBusy(true);
		state.ready = false;
		state.nonce = uid();
		state.library = window.__2FA_BUILTIN_THEMES__ || state.library;
		state.draft = clone(window.__2FA_APPEARANCE__ || state.draft || {});
		state.revision = state.draft.revision || 0;
		state.remoteRevision = Math.max(state.remoteRevision, state.revision);
		state.dirty = false;
		state.conflict = false;
		state.pendingApply = null;
		state.version = 0;
		state.persisted = 0;
		if (!state.draft.packageId && state.library[0]) {
			state.draft = makeDraft(state.library[0]);
		}
		window.showModal('appearanceModal');
		message(tr('appearanceLoading'));
		try {
			await state.queue.catch(() => {});
			const saved = await draftStore('get');
			if (saved?.draft) {
				state.draft = saved.draft;
				state.revision = saved.revision;
				state.blobs = new Map(saved.blobs || []);
				state.dirty = saved.dirty;
				state.pendingApply = saved.pendingApply;
				state.localProfiles = new Map(saved.profiles || []);
				state.migration = saved.migration || [];
				message(tr('appearanceDraftRestored'));
			}
			await load();
			if (!saved?.draft && navigator.onLine && state.capabilities.write && !state.conflict) {
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
		if (state.dirty && state.persisted < state.version) {
			event.preventDefault();
			event.returnValue = '';
		}
	});
	window.addEventListener('resize', notifyPreview);
	window.addEventListener('appearance-updated-elsewhere', (event) => {
		if (Number.isSafeInteger(event.detail?.revision)) {
			state.remoteRevision = Math.max(state.remoteRevision, event.detail.revision);
		}
		state.conflict = true;
		message(tr('appearanceUpdatedElsewhere'));
	});
	window.addEventListener('online', () => {
		state.capabilities.write = false;
		setBusy(state.busy);
		void load({ preserveDraft: true })
			.then(() => {
				setBusy(state.busy);
				if (state.open && !state.busy) {
					render();
					if (!state.conflict) {
						message(tr(state.dirty ? 'appearanceUnsaved' : 'appearanceSaved'));
					}
				}
			})
			.catch((error) => {
				if (state.open) {
					errorMessage(error);
				}
				setBusy(state.busy);
			});
	});
	window.addEventListener('offline', () => {
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
