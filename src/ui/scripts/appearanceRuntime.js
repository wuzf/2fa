import { serializeBrowserFunction } from './browserSource.js';
import { createAccountRenderer } from '../themes/renderer.js';
import { getAppearanceStyles } from '../styles/appearance.js';
import { getVariables } from '../styles/variables.js';
import { getComponentStyles } from '../styles/components.js';
import { getWorkspaceStyles } from '../styles/workspace.js';
import { getBaseStyles } from '../styles/base.js';
import { getResponsiveStyles } from '../styles/responsive.js';

/** Self contained DOM adapter, shared by the application and sandbox preview. */
export function createAppearanceController(document, options = {}) {
	const win = document.defaultView;
	const root = document.documentElement;
	const regions = ['header', 'leading', 'main', 'trailing', 'footer'];
	const components = new Map();
	const customComponents = new Map();
	let current = null;
	let layoutRoot = null;
	let originalContent = [];
	let regionNodes = [];
	const originalPlacements = [];
	let clearServiceButton = null;
	let serviceFilter = '';
	let serviceGroups = [];
	let currentServices = [];
	let knownAttributes = [];
	const label = (key, fallback) => options.translate?.(key) || fallback;
	const element = (tag, part) => {
		const node = document.createElement(tag);
		if (part) {
			node.dataset.part = part;
		}
		return node;
	};
	const safeUrl = (value, image = false) => {
		const text = String(value || '');
		if (image && /^(blob:|data:image\/(png|jpeg|webp|gif);)/i.test(text)) {
			return text;
		}
		if (!image && /^mailto:/i.test(text)) {
			return text;
		}
		if (/^\/(?!\/)/.test(text) || /^https:\/\//i.test(text)) {
			return text;
		}
		return '';
	};
	const resolvedAsset = (value) => {
		const resource = (current?.resources || []).find((entry) => entry.hash === value || entry.name === value);
		return safeUrl(resource?.url || value, true);
	};
	function captureInteraction() {
		const node = document.activeElement;
		return { node, start: node?.selectionStart, end: node?.selectionEnd, x: win.scrollX, y: win.scrollY };
	}
	function restoreInteraction(saved) {
		if (saved.node?.isConnected && !saved.node.closest('[hidden]')) {
			saved.node.focus?.({ preventScroll: true });
			if (typeof saved.start === 'number') {
				try {
					saved.node.setSelectionRange(saved.start, saved.end);
				} catch {
					/* Non-text controls. */
				}
			}
		}
		if (typeof win.scrollTo === 'function') {
			win.scrollTo(saved.x, saved.y);
		}
	}
	function initialise() {
		if (layoutRoot) {
			return;
		}
		layoutRoot = document.querySelector('.container > .content');
		if (!layoutRoot) {
			return;
		}
		const move = (part, selectors) => {
			const wrapper = element('div', part);
			selectors.forEach((selector) => {
				const node = document.querySelector(selector);
				if (node) {
					const anchor = document.createComment('appearance: ' + part);
					node.before(anchor);
					originalPlacements.push({ node, anchor, wrapper });
					wrapper.append(node);
				}
			});
			components.set(part, wrapper);
			return wrapper;
		};
		move('view-controls', ['.sort-controls']);
		const search = move('search', ['.search-section']);
		clearServiceButton = element('button');
		clearServiceButton.type = 'button';
		clearServiceButton.className = 'appearance-service-clear';
		clearServiceButton.hidden = true;
		clearServiceButton.addEventListener('click', () => {
			serviceFilter = '';
			renderNavigation();
			options.onFilter?.(null);
		});
		search.append(clearServiceButton);
		move('system-status', ['#offlineQueue', '#hiddenSecrets']);
		move('accounts', ['#loading', '#secretsList', '#emptyState']);
		move('actions', ['.action-menu-float']);
		move('footer', ['.page-footer']);
		const overlay = document.getElementById('menuOverlay');
		if (overlay) {
			document.body.append(overlay);
		}
		components.set('brand', element('div', 'brand'));
		const nav = element('details', 'service-nav');
		const smallScreen = win.matchMedia?.('(max-width: 767px)');
		nav.open = !smallScreen?.matches;
		smallScreen?.addEventListener('change', (event) => {
			nav.open = !event.matches;
		});
		const summary = element('summary');
		summary.textContent = label('appearanceServiceNavigation', 'Services');
		nav.append(summary, element('nav'));
		nav.addEventListener('toggle', () => {
			if (!nav.open && nav.contains(document.activeElement) && document.activeElement !== summary) {
				summary.focus();
			}
		});
		nav.addEventListener('click', (event) => {
			const button = event.target.closest('[data-service-key]');
			if (!button) {
				return;
			}
			serviceFilter = button.dataset.serviceKey;
			renderNavigation();
			options.onFilter?.(serviceFilter || null);
		});
		components.set('service-nav', nav);
		originalContent = Array.from(layoutRoot.childNodes);
		layoutRoot.replaceChildren();
		layoutRoot.classList.add('appearance-layout');
		regions.forEach((name) => {
			const node = element(name === 'main' ? 'main' : 'div', 'region-' + name);
			node.dataset.region = name;
			layoutRoot.append(node);
		});
		regionNodes = Array.from(layoutRoot.children);
		document.querySelectorAll('.modal').forEach((node) => {
			node.dataset.part = 'dialog';
		});
		// The accounts wrapper is still detached until apply() places its region.
		const list = components.get('accounts').querySelector('#secretsList');
		if (list) {
			list.dataset.part = 'account-grid';
		}
	}
	function renderNavigation() {
		const nav = components.get('service-nav')?.querySelector('nav');
		if (!nav) {
			return;
		}
		const focusedKey = nav.contains(document.activeElement) ? document.activeElement.getAttribute('data-service-key') : null;
		components.get('service-nav').querySelector('summary').textContent = label('appearanceServiceNavigation', 'Services');
		if (clearServiceButton) {
			const selected = serviceGroups.find((group) => group.key === serviceFilter);
			clearServiceButton.hidden = !selected;
			clearServiceButton.textContent = selected ? '× ' + selected.name : '';
			clearServiceButton.setAttribute('aria-label', label('appearanceAllServices', 'All accounts'));
			clearServiceButton.title = label('appearanceAllServices', 'All accounts');
		}
		const choices = [
			{ key: '', name: label('appearanceAllServices', 'All accounts'), totalCount: currentServices.length },
			...serviceGroups,
		];
		nav.replaceChildren(
			...choices.map((group) => {
				const button = element('button');
				button.type = 'button';
				button.className = 'appearance-service';
				button.dataset.serviceKey = group.key;
				button.setAttribute('aria-current', String(group.key === serviceFilter));
				const name = element('span');
				name.textContent = group.name;
				const count = element('span');
				count.textContent = String(group.totalCount ?? group.items?.length ?? 0);
				button.append(name, count);
				return button;
			}),
		);
		if (focusedKey !== null && nav.isConnected) {
			const destination =
				Array.from(nav.querySelectorAll('[data-service-key]')).find((button) => button.dataset.serviceKey === focusedKey) ||
				nav.querySelector('[data-service-key=""]');
			destination?.focus({ preventScroll: true });
		}
	}
	function filterServices(items, allItems) {
		currentServices = allItems || [];
		serviceGroups = options.groupServices?.(currentServices) || [];
		if (serviceFilter && !serviceGroups.some((group) => group.key === serviceFilter)) {
			serviceFilter = '';
		}
		renderNavigation();
		if (!serviceFilter) {
			return items;
		}
		const group = serviceGroups.find((entry) => entry.key === serviceFilter);
		const ids = new Set((group?.items || []).map((entry) => String(entry.id)));
		const visible = items.filter((entry) => ids.has(String(entry.id)));
		const stats = document.getElementById('searchStats');
		if (stats) {
			stats.textContent =
				options.translate?.('searchFoundCount', { found: visible.length, total: currentServices.length }) ||
				String(visible.length) + ' / ' + currentServices.length;
			stats.style.color = 'var(--2fa-muted)';
		}
		return visible;
	}
	function setStyle(id, css) {
		let node = document.getElementById(id);
		if (!node) {
			node = element('style');
			node.id = id;
			document.head.append(node);
		}
		node.textContent = css;
	}
	function apply(snapshot = {}) {
		const saved = captureInteraction();
		initialise();
		current = snapshot;
		const manifest = snapshot.manifest || {};
		const settings = snapshot.settings || {};
		const builtinFluent = snapshot.packageId === 'builtin:fluent';
		const nativeLayout = builtinFluent;
		// The default Fluent preset is the published workspace. Its generic theme
		// tokens are editor defaults, not a request to restyle an untouched page.
		const nativeStyles =
			builtinFluent &&
			(manifest.settings || []).every((field) => settings[field.key] === undefined || settings[field.key] === field.default);
		const content = JSON.parse(JSON.stringify({ ...(manifest.content || {}), ...(snapshot.content || {}) }));
		const standardContentLabels = {
			'Your space': 'appearanceWelcomeTitle',
			'Make this 2FA your own. Customize the layout, colors and typography in Appearance.': 'appearanceWelcomeText',
		};
		for (const [id, value] of Object.entries(content)) {
			for (const field of ['title', 'text']) {
				if (snapshot.content?.[id]?.[field] !== undefined && snapshot.content[id][field] !== manifest.content?.[id]?.[field]) {
					continue;
				}
				const key = standardContentLabels[value[field]];
				if (key) {
					value[field] = label(key, value[field]);
				}
			}
		}
		let variables = '';
		knownAttributes.forEach((name) => root.removeAttribute(name));
		knownAttributes = [];
		(manifest.settings || []).forEach((field) => {
			const value = Object.prototype.hasOwnProperty.call(settings, field.key) ? settings[field.key] : field.default;
			const binding = field.binding || {};
			if (binding.type === 'variable' && /^--(?:theme|2fa)-[a-z0-9-]+$/i.test(binding.name)) {
				variables += binding.name + ':' + String(value ?? '') + (field.type === 'number' ? binding.unit || '' : '') + ';';
			} else if (binding.type === 'attribute' && /^data-theme-option-[a-z0-9-]+$/.test(binding.name)) {
				root.setAttribute(binding.name, String(value ?? ''));
				knownAttributes.push(binding.name);
			} else if (binding.type === 'content' && ['text', 'title', 'src', 'alt'].includes(binding.field)) {
				content[binding.component] = { ...content[binding.component], [binding.field]: value };
			}
		});
		const tokens = ['light', 'dark']
			.map((mode) => {
				const values = Object.entries(manifest.tokens?.[mode] || {})
					.filter(([key]) => /^--(?:2fa|theme)-[a-z0-9-]+$/i.test(key))
					.map(([key, value]) => key + ':' + String(value) + ';')
					.join('');
				return ':root[data-theme="' + mode + '"]{' + values + '}';
			})
			.join('\n');
		setStyle('appearance-theme-css', nativeStyles ? '' : tokens + '\n' + (snapshot.css || ''));
		setStyle('appearance-config-css', nativeStyles ? '' : ':root[data-theme]{' + variables + '}');
		document.getElementById('appearance-first-paint')?.remove();
		root.dataset.themeId = snapshot.themeId || manifest.id || 'fluent';
		if (nativeStyles) {
			delete root.dataset.appearanceReady;
		} else {
			root.dataset.appearanceReady = 'true';
		}
		root.dataset.appearanceRevision = String(snapshot.revision || 0);
		if (layoutRoot) {
			// Reuse the same live controls when switching out of the native layout.
			if (!layoutRoot.classList.contains('appearance-layout')) {
				layoutRoot.replaceChildren(...regionNodes);
			}
			components.forEach((node) => node.removeAttribute('data-native-component'));
			layoutRoot.classList.add('appearance-layout');
			const fallback = {
				header: [],
				leading: [],
				main: ['search', 'view-controls', 'system-status', 'accounts', 'actions'],
				trailing: [],
				footer: ['footer'],
			};
			const layout = snapshot.layout || manifest.layout || fallback;
			const used = new Set();
			const usedCustom = new Set();
			const required = ['search', 'view-controls', 'system-status', 'accounts', 'actions'];
			regions.forEach((region) => {
				const target = layoutRoot.querySelector('[data-region="' + region + '"]');
				for (const item of layout[region] || []) {
					const definition = typeof item === 'string' ? { id: item, type: item } : item;
					const type = definition.type;
					const id = definition.id || type;
					if ((required.includes(type) && used.has(type)) || (type === 'accounts' && region !== 'main')) {
						continue;
					}
					let node = components.get(type);
					if (['text', 'image', 'links'].includes(type)) {
						node = customComponents.get(id);
						if (!node) {
							node = element('div', type);
							customComponents.set(id, node);
						}
						node.replaceChildren();
						const details = content[id] || {};
						if (details.title) {
							const heading = element('h3');
							heading.textContent = details.title;
							node.append(heading);
						}
						if (type === 'text') {
							const text = element('div');
							text.textContent = details.text || '';
							node.append(text);
						}
						if (type === 'image') {
							const image = element('img');
							const src = resolvedAsset(details.src);
							if (src) {
								image.src = src;
							}
							image.alt = details.alt || '';
							node.append(image);
						}
						if (type === 'links') {
							for (const item of details.items || []) {
								const link = element('a');
								link.textContent = item.label || '';
								link.href = safeUrl(item.href) || '#';
								link.rel = 'noopener noreferrer';
								node.append(link);
							}
						}
					}
					if (!node) {
						continue;
					}
					node.dataset.componentId = id;
					node.hidden = required.includes(type) ? false : Boolean(definition.hidden);
					target.append(node);
					if (customComponents.get(id) === node) {
						usedCustom.add(id);
					} else {
						used.add(type);
					}
					if (type === 'actions') {
						options.setActionMode?.(definition.mode === 'toolbar' ? 'toolbar' : 'floating');
					}
				}
			});
			const main = layoutRoot.querySelector('[data-region="main"]');
			required.forEach((type) => {
				if (!used.has(type)) {
					const node = components.get(type);
					node.hidden = false;
					main.append(node);
					used.add(type);
					if (type === 'actions') {
						options.setActionMode?.('floating');
					}
				}
			});
			components.forEach((node, type) => {
				if (!used.has(type)) {
					node.remove();
				}
			});
			customComponents.forEach((node, id) => {
				if (!usedCustom.has(id)) {
					node.remove();
					customComponents.delete(id);
				}
			});
			regions.forEach((region) => {
				const node = layoutRoot.querySelector('[data-region="' + region + '"]');
				node.hidden = !Array.from(node.children).some((child) => !child.hidden);
			});
			layoutRoot.dataset.leading = String(!layoutRoot.querySelector('[data-region="leading"]').hidden);
			layoutRoot.dataset.trailing = String(!layoutRoot.querySelector('[data-region="trailing"]').hidden);
			const brand = components.get('brand');
			brand.replaceChildren();
			const identity = element('div');
			const title = element('strong');
			title.textContent = '2FA';
			identity.append(title);
			brand.append(identity);
			renderNavigation();
			if (nativeLayout) {
				layoutRoot.classList.remove('appearance-layout');
				layoutRoot.replaceChildren(...originalContent);
				const placed = new Set();
				originalPlacements.forEach(({ anchor, wrapper }) => {
					if (!placed.has(wrapper)) {
						wrapper.setAttribute('data-native-component', '');
						anchor.after(wrapper);
						placed.add(wrapper);
					}
				});
			}
		}
		options.onApplied?.(snapshot);
		restoreInteraction(saved);
		return snapshot;
	}
	function updateView(selection) {
		serviceFilter = selection.serviceFilter || '';
		serviceGroups = selection.services.map((group) => ({
			key: group.groupId,
			name: group.label,
			totalCount: group.count,
			items: group.ids.map((id) => ({ id })),
		}));
		currentServices = serviceGroups.flatMap((group) => group.items);
		renderNavigation();
	}
	return { apply, filterServices, updateView, hasFilter: () => Boolean(serviceFilter), getSnapshot: () => current };
}

/** Browser bindings intentionally leave all account mutation logic in core.js. */
export function getAppearanceRuntimeCode() {
	return `
    const appearanceController = (${serializeBrowserFunction(createAppearanceController)})(document, {
      translate: (key, values) => typeof t === 'function' ? t(key, values) : '',
      groupServices: (items) => typeof groupSecretsByServiceFamily === 'function' ? groupSecretsByServiceFamily(items, items) : [],
      onFilter: groupId => { if (typeof getAccountViewState === 'function') getAccountViewState().setServiceFilter(groupId); },
      setActionMode: (mode) => { if (typeof setActionPresentation === 'function') setActionPresentation(mode); },
      onApplied: (snapshot) => {
        window.__2FA_APPEARANCE__ = snapshot;
        if (typeof updateAppearanceBranding === 'function') updateAppearanceBranding(snapshot);
        window.dispatchEvent(new CustomEvent('appearance-applied', { detail: snapshot }));
      }
    });
    function applyAppearance(snapshot) {
      const isApp = value => value?.kind === 'app' || value?.manifest?.kind === 'app';
      const previous = window.__2FA_APPEARANCE__;
      if (isApp(previous) || isApp(snapshot)) {
        if (!isApp(previous) || !isApp(snapshot) || previous.packageId !== snapshot.packageId) {
          window.__2FA_PENDING_APPEARANCE__ = snapshot;
          window.dispatchEvent(new CustomEvent('appearance-navigation-required', { detail: snapshot }));
          return { status: 'reload-required', reason: 'appearance-kind-or-package-changed' };
        }
        if (typeof window.updateAppThemeAppearance === 'function') return window.updateAppThemeAppearance(snapshot);
        // Boot metadata remains available to the app integration; never feed it
        // into the v1 DOM/CSS adapter while the authenticated host is starting.
        if (typeof updateAppearanceBranding === 'function') updateAppearanceBranding(snapshot);
        return { status: 'pending', reason: 'app-host-not-ready' };
      }
      return appearanceController.apply(snapshot);
    }
    function filterAppearanceServices(items, allItems) { return appearanceController.filterServices(items, allItems); }
    function hasAppearanceServiceFilter() { return appearanceController.hasFilter(); }
    function syncAppearanceView(selection) { appearanceController.updateView(selection); }
    function refreshAppearanceLanguage() {
      const snapshot = appearanceController.getSnapshot();
      if (snapshot) appearanceController.apply(snapshot);
    }
    window.applyAppearance = applyAppearance;
    document.addEventListener('DOMContentLoaded', () => {
      if (window.__2FA_APPEARANCE__) applyAppearance(window.__2FA_APPEARANCE__);
    });
  `;
}

/** Official preview code only: no account API, credentials, or business boot. */
export function getAppearancePreviewDocument({ nonce = 'appearance-preview', baseStyles } = {}) {
	const safeNonce = String(nonce).replace(/[^a-z0-9_-]/gi, '');
	const styles =
		baseStyles ||
		getVariables() + getBaseStyles() + getComponentStyles() + getResponsiveStyles() + getWorkspaceStyles() + getAppearanceStyles();
	const script = `
    const nonce = ${JSON.stringify(safeNonce)};
    const renderer = (${serializeBrowserFunction(createAccountRenderer)})();
    const examples = [
      {id:'sample-google-1',name:'Google',account:'alex@example.com',code:'482 619',nextCode:'109 273'},
      {id:'sample-google-2',name:'Google',account:'work@example.com',code:'738 245',nextCode:'651 087'},
      {id:'sample-github',name:'GitHub',account:'alex-developer',code:'246 810',nextCode:'135 792'},
      {id:'sample-cloud',name:'Cloudflare',account:'a-long-account-name@example.com',code:'573 921',nextCode:'804 163'},
      {id:'sample-hotp',name:'Security key',account:'Recovery',isHOTP:true,counter:42,code:'918 407'}
    ];
    let sampleQuery = '';
    let sampleScene = 'workspace';
    const controller = (${serializeBrowserFunction(createAppearanceController)})(document, {
      translate: (key) => labels[key],
      groupServices: (items) => ['Google','GitHub','Cloudflare','Security key'].map(name => ({ key:name,name,totalCount:items.filter(item=>item.name===name).length,items:items.filter(item=>item.name===name) })),
      onFilter: () => render(),
      setActionMode: (mode) => document.documentElement.dataset.actionsMode = mode
    });
    let labels = {};
    let resourceUrls = [];
    let lastSequence = 0;
    function render() {
      const available = sampleScene === 'empty' ? [] : examples;
      const items = controller.filterServices(available.filter(item => (item.name+' '+item.account).toLowerCase().includes(sampleQuery)), available);
      document.getElementById('secretsList').innerHTML = items.map(item => renderer.card(item, labels)).join('');
      document.getElementById('emptyState').hidden = items.length > 0;
    }
    renderer.bind(document.getElementById('secretsList'), (action,id) => {
      document.getElementById('previewFeedback').textContent = (labels.appearancePreviewAction || 'Example action') + ': ' + action;
      if (action === 'menu') document.getElementById('menu-'+id).classList.toggle('show');
    });
    document.getElementById('searchInput').addEventListener('input', event => {sampleQuery=event.target.value.toLowerCase(); render();});
    document.getElementById('previewLoginButton').addEventListener('click', () => document.getElementById('previewFeedback').textContent = labels.appearanceSampleOnly || 'Sample preview');
    document.addEventListener('click', event => {
      if (!event.target.closest('a')) return;
      event.preventDefault();
      document.getElementById('previewFeedback').textContent = labels.appearancePreviewAction || 'Example action';
    }, true);
    document.getElementById('mainActionBtn').addEventListener('click', () => document.querySelector('.action-submenu').classList.toggle('show'));
    for (const id of ['previewAdd', 'previewSettings']) document.getElementById(id).addEventListener('click', () => document.getElementById('previewFeedback').textContent = labels.appearancePreviewAction || 'Example action');
    window.addEventListener('message', event => {
      const message = event.data;
      if (event.source !== parent || !message || message.type !== 'appearance-preview' || message.nonce !== nonce) return;
      if (message.sequence && message.sequence < lastSequence) return;
      lastSequence = message.sequence || lastSequence + 1;
      labels = message.labels || {};
      let snapshot = structuredClone(message.snapshot || {});
      const replaced = [];
      for (const resource of message.resources || []) {
        if (!(resource.bytes instanceof ArrayBuffer)) continue;
        const url = URL.createObjectURL(new Blob([resource.bytes], {type:resource.mime}));
        replaced.push(url);
        const replacement = snapshot.resources?.find(entry=>(resource.hash && entry.hash===resource.hash) || (resource.url && entry.url===resource.url));
        const aliases = new Set([resource.url, replacement?.url]);
        if (resource.hash) {
          aliases.add('/api/appearance/assets/' + resource.hash);
          if (replacement?.name || resource.name) aliases.add('/theme-assets/' + resource.hash + '/' + encodeURIComponent(replacement?.name || resource.name));
        }
        if (replacement) replacement.url = url;
        for (const old of aliases) {
          if (old) {
            const replace = value => typeof value === 'string' ? value.split(old).join(url)
              : Array.isArray(value) ? value.map(replace)
              : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key,entry])=>[key,replace(entry)])) : value;
            snapshot = replace(snapshot);
          }
        }
      }
      document.documentElement.dataset.theme = message.mode === 'dark' ? 'dark' : 'light';
      document.documentElement.lang = message.language || 'en';
      sampleScene = ['workspace','login','empty','offline'].includes(message.scene) ? message.scene : 'workspace';
      controller.apply(snapshot);
      render();
      resourceUrls.forEach(url => URL.revokeObjectURL(url)); resourceUrls = replaced;
      document.getElementById('previewFeedback').textContent = labels.appearanceSampleOnly || 'Sample preview';
      document.getElementById('previewLoginTitle').textContent = labels.appearanceLoginTitle || 'Unlock your authenticator';
      document.getElementById('previewLoginButton').textContent = labels.appearanceLoginButton || 'Unlock';
      document.getElementById('searchInput').placeholder = labels.searchInputPlaceholder || 'Search accounts';
      document.getElementById('searchInput').setAttribute('aria-label', labels.searchInputPlaceholder || 'Search accounts');
      document.getElementById('emptyState').textContent = sampleScene === 'empty' ? labels.emptyTitle || 'No accounts yet' : labels.searchNoMatch || 'No matching accounts';
      const offline = document.getElementById('offlineQueue');
      offline.hidden = sampleScene !== 'offline';
      offline.textContent = labels.appearanceOfflineScene || 'Offline';
      document.getElementById('previewAdd').textContent = labels.emptyAddBtn || 'Add account';
      document.getElementById('previewSettings').textContent = labels.fabSettings || 'Settings';
      document.querySelector('.container').hidden = message.scene === 'login';
      document.getElementById('previewLogin').hidden = message.scene !== 'login';
    });
    parent.postMessage({type:'appearance-preview-ready',nonce}, '*');
  `;
	return `<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${safeNonce}'; style-src 'unsafe-inline'; img-src blob: data:; font-src blob: data:; connect-src 'none'; base-uri 'none'; form-action 'none'"><style>${styles.replace(/<\/style/gi, '<\\/style')}</style></head><body class="fluent-app"><div id="previewFeedback" class="appearance-preview-notice" role="status">Sample preview</div><div class="container"><div class="content"><div class="search-section"><div class="search-action-row"><div class="search-input-wrapper"><input id="searchInput" class="search-input" type="search" placeholder="Search accounts" aria-label="Search accounts"></div><div class="sort-controls"><button type="button">A–Z</button></div></div></div><div id="offlineQueue" hidden></div><div id="hiddenSecrets" hidden></div><div id="loading" hidden></div><div id="secretsList" class="secrets-list" data-view="flat"></div><div id="emptyState" hidden>No matching accounts</div></div></div><div class="action-menu-float"><button id="mainActionBtn" class="main-action-button" type="button">+</button><div class="action-submenu"><button id="previewAdd" class="submenu-item" type="button">Add account</button><button id="previewSettings" class="submenu-item" type="button">Settings</button></div></div><footer class="page-footer">2FA</footer><section id="previewLogin" class="appearance-preview-login" hidden><h2 id="previewLoginTitle">Unlock your authenticator</h2><input type="password" aria-label="Example password" placeholder="••••••••" autocomplete="off"><button id="previewLoginButton" type="button">Unlock</button></section><script nonce="${safeNonce}">${script.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}
