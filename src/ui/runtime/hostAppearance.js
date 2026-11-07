/** Pure, serializable API 1 visual contract. No selectors, URLs or business state. */
export function normalizeHostAppearance(input) {
	if (input === null) {
		return null;
	}
	const invalid = () => {
		throw new TypeError('invalid-appearance');
	};
	const record = (value) => {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) {
			return false;
		}
		const prototype = Object.getPrototypeOf(value);
		return prototype === null || Object.getPrototypeOf(prototype) === null;
	};
	if (!record(input)) {
		return invalid();
	}
	const colors = [
		'surface',
		'subtle',
		'hover',
		'text',
		'muted',
		'line',
		'stroke',
		'accent',
		'accentHover',
		'accentText',
		'selected',
		'danger',
		'dangerBackground',
		'dangerFill',
		'dangerFillHover',
		'dangerText',
		'warning',
		'warningBackground',
		'success',
		'successBackground',
	];
	const geometry = { radius: [0, 24], controlRadius: [0, 16], borderWidth: [1, 3] };
	const allowed = [...colors, ...Object.keys(geometry), 'shadow', 'controlShadow', 'fontFamily'];
	if (
		Reflect.ownKeys(input).some((key) => !allowed.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(input, key), 'value'))
	) {
		return invalid();
	}
	const result = {};
	const color = (value) => {
		if (typeof value !== 'string' || !/^#(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})$/i.test(value)) {
			return invalid();
		}
		return value.toLowerCase();
	};
	const number = (value, min, max) => {
		if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
			return invalid();
		}
		return Object.is(value, -0) ? 0 : value;
	};
	for (const key of colors) {
		if (Object.hasOwn(input, key)) {
			result[key] = color(input[key]);
		}
	}
	for (const [key, range] of Object.entries(geometry)) {
		if (Object.hasOwn(input, key)) {
			result[key] = number(input[key], ...range);
		}
	}
	for (const key of ['shadow', 'controlShadow']) {
		if (!Object.hasOwn(input, key)) {
			continue;
		}
		const value = input[key];
		if (value === null) {
			result[key] = null;
			continue;
		}
		if (
			!record(value) ||
			Reflect.ownKeys(value).length !== 5 ||
			Reflect.ownKeys(value).some(
				(name) =>
					!['x', 'y', 'blur', 'spread', 'color'].includes(name) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, name), 'value'),
			)
		) {
			return invalid();
		}
		result[key] = {
			x: number(value.x, -8, 8),
			y: number(value.y, -8, 8),
			blur: number(value.blur, 0, 64),
			spread: number(value.spread, 0, 8),
			color: color(value.color),
		};
	}
	if (Object.hasOwn(input, 'fontFamily')) {
		const families = input.fontFamily;
		if (!Array.isArray(families) || families.length < 1 || families.length > 8) {
			return invalid();
		}
		result.fontFamily = [];
		for (const family of families) {
			if (typeof family !== 'string' || !family.trim() || family.length > 80 || /[\p{Cc}\p{Cf}"'\\;:{}()<>@]/u.test(family)) {
				return invalid();
			}
			result.fontFamily.push(family.trim());
		}
	}
	return result;
}

/** Scope-owned presentation. The host alone activates a successfully started app. */
export function createHostAppearanceManager({ document, normalize }) {
	const attribute = 'data-app-host-appearance';
	const exclusion = ':where(:not(#appThemeRoot,#appThemeRoot *))';
	let owner = null,
		style = null,
		serial = 0,
		signature = '',
		marker = null,
		previousMarker = null,
		browserColor = null,
		colorFrame = 0;
	// Android paints an installed PWA's status and navigation bars with
	// theme-color, which the page sets for the default interface. While an app
	// theme owns the presentation, follow the background it actually painted.
	function paintedBackground() {
		const view = document.defaultView;
		const mounts = [...document.querySelectorAll('#appThemeRoot > [data-app-mount]')].filter((node) => node.style.visibility !== 'hidden');
		let node = mounts.at(-1);
		for (let depth = 0; node && depth < 4; depth++, node = node.firstElementChild) {
			const color = view?.getComputedStyle?.(node).backgroundColor;
			if (color && !/^(?:transparent|rgba\(.*,\s*0\))$/.test(color)) {
				return color;
			}
		}
		return null;
	}
	function syncBrowserColor(tokens) {
		const meta = document.querySelector('meta[name="theme-color"]');
		if (!meta) {
			return;
		}
		if (browserColor === null) {
			browserColor = meta.getAttribute('content') || '';
		}
		const view = document.defaultView;
		view?.cancelAnimationFrame?.(colorFrame);
		// The theme may update its own DOM after setting the appearance; read the
		// color once that frame's styles apply.
		const apply = () => {
			colorFrame = 0;
			const color = paintedBackground() || tokens.subtle || tokens.surface;
			if (color) {
				meta.setAttribute('content', color);
			}
		};
		if (view?.requestAnimationFrame) {
			colorFrame = view.requestAnimationFrame(apply);
		} else {
			apply();
		}
	}
	function restoreBrowserColor() {
		document.defaultView?.cancelAnimationFrame?.(colorFrame);
		colorFrame = 0;
		if (browserColor !== null) {
			document.querySelector('meta[name="theme-color"]')?.setAttribute('content', browserColor);
			browserColor = null;
		}
	}
	function remove() {
		restoreBrowserColor();
		style?.remove();
		style = null;
		signature = '';
		if (marker !== null && document.documentElement.getAttribute(attribute) === marker) {
			if (previousMarker === null) {
				document.documentElement.removeAttribute(attribute);
			} else {
				document.documentElement.setAttribute(attribute, previousMarker);
			}
		}
		marker = null;
	}
	function render(tokens) {
		if (!tokens || !Object.keys(tokens).length) {
			remove();
			return;
		}
		syncBrowserColor(tokens);
		const next = JSON.stringify(tokens);
		if (next === signature && style?.isConnected) {
			return;
		}
		if (!style) {
			previousMarker = document.documentElement.getAttribute(attribute);
			marker = String(++serial);
			style = document.createElement('style');
			style.dataset.appHostAppearance = marker;
			document.head.append(style);
			document.documentElement.setAttribute(attribute, marker);
		}
		const prefix = ':root[' + attribute + '="' + marker + '"] ';
		// The explicit root exclusion also outranks existing ID-scoped editor
		// rules, without accepting selectors from a theme.
		const modal = '.modal:not(#appThemeRoot)' + exclusion;
		const surfaces = ':is(.modal,.center-toast,.dialog-toast):not(#appThemeRoot)' + exclusion;
		const controls =
			modal + ' :is(button,input:not([type=checkbox],[type=radio],[type=range],[type=hidden],[type=file]),select,textarea,.btn)';
		const shapes =
			modal +
			' :is(.appearance-theme-card,.appearance-disclosure,.appearance-preview-viewport,.settings-code-item,.settings-code-empty,.result-content,.key-result,.check-result,.time-info,.qr-decode-result,.sync-status,.dest-card,.format-card,.format-option,.sub-format-option,.dialog-backup-format,.file-info-badge,.import-preview-compact,.import-progress-panel,.backup-list-container,.backup-preview-content,.restore-preview,.dialog-qr-state,.backup-table,.video-wrapper,.scanner-frame,.qr-code-container,.theme-option,.offline-queue,.scanner-error,.scan-counter,.change-password-result,.login-modal-error,.import-tips,.restore-instructions,.dialog-warning,.login-insecure-warning,.result-text,.decode-result,.oauth-warning,.dialog-export-help,.dialog-transfer-list,.dialog-transfer-summary,.dialog-token-chip)';
		const panels = [modal + ' .modal-content', '.center-toast' + exclusion + ' .toast-content', '.dialog-toast'];
		const rules = [];
		const rule = (selectors, declarations) => {
			const scoped = selectors.flatMap((selector) =>
				selector.startsWith(modal) ? ['#appearanceModal.modal' + exclusion + selector.slice(modal.length), selector] : [selector],
			);
			rules.push(scoped.map((selector) => prefix + selector + exclusion).join(',') + '{' + declarations + '}');
		};
		const mappings = {
			surface: ['--dialog-surface'],
			subtle: ['--dialog-subtle', '--progress-bg'],
			hover: ['--dialog-hover'],
			text: ['--dialog-text'],
			muted: ['--dialog-muted', '--host-muted'],
			line: ['--dialog-line'],
			stroke: ['--dialog-stroke'],
			accent: ['--dialog-brand', '--btn-primary-bg', '--progress-fill'],
			accentHover: ['--dialog-brand-hover', '--btn-primary-hover'],
			accentText: ['--btn-primary-text'],
			selected: ['--dialog-selected'],
			danger: ['--dialog-danger', '--host-danger', '--border-error'],
			dangerBackground: ['--dialog-danger-bg'],
			warning: ['--dialog-warning'],
			warningBackground: ['--dialog-warning-bg'],
			success: ['--dialog-success'],
			successBackground: ['--dialog-success-bg'],
		};
		const declarations = [];
		for (const [key, variables] of Object.entries(mappings)) {
			if (Object.hasOwn(tokens, key)) {
				for (const variable of variables) {
					declarations.push(variable + ':' + tokens[key]);
				}
			}
		}
		if (declarations.length) {
			rule([surfaces], declarations.join(';'));
		}
		const field = (key, selectors, property, suffix = '') => {
			if (Object.hasOwn(tokens, key)) {
				rule(selectors, property + ':' + tokens[key] + suffix);
			}
		};
		field('radius', panels, 'border-radius', 'px');
		field('radius', [surfaces], '--host-panel-radius', 'px');
		field('controlRadius', [surfaces], '--host-control-radius', 'px');
		field('borderWidth', [surfaces], '--host-border-width', 'px');
		field('controlRadius', [controls, shapes], 'border-radius', 'px');
		field('borderWidth', [...panels, controls, shapes], 'border-width', 'px');
		// The existing outline button uses an important border shorthand.
		field('borderWidth', [modal + ' .btn-outline'], 'border-width', 'px!important');
		field('stroke', [controls], 'border-color');
		field('accentText', [modal + ' .btn-primary'], 'color');
		field('dangerFill', [modal + ' .btn-danger'], 'background-color');
		field('dangerFill', [modal + ' .btn-danger'], 'border-color');
		field('dangerFillHover', [modal + ' .btn-danger:hover'], 'background-color');
		field('dangerFillHover', [modal + ' .btn-danger:hover'], 'border-color');
		field('dangerText', [modal + ' .btn-danger'], 'color');
		if (tokens.fontFamily) {
			const generic = new Set([
				'serif',
				'sans-serif',
				'monospace',
				'cursive',
				'fantasy',
				'system-ui',
				'ui-serif',
				'ui-sans-serif',
				'ui-monospace',
				'ui-rounded',
				'emoji',
				'math',
				'fangsong',
			]);
			const font = tokens.fontFamily.map((name) => (generic.has(name.toLowerCase()) ? name.toLowerCase() : JSON.stringify(name))).join(',');
			rule([surfaces, controls], 'font-family:' + font);
			rule([surfaces], '--host-font-family:' + font);
			rule(
				[modal + ' :is(code,pre,.result-text,.settings-code-editor,#secretKey,.key-code,.backup-preview-content)'],
				'font-family:ui-monospace,SFMono-Regular,Consolas,monospace',
			);
		}
		for (const [key, selectors] of [
			['shadow', panels],
			['controlShadow', [controls, controls + ':hover']],
		]) {
			if (!Object.hasOwn(tokens, key)) {
				continue;
			}
			const value = tokens[key];
			const shadow = value === null ? 'none' : `${value.x}px ${value.y}px ${value.blur}px ${value.spread}px ${value.color}`;
			rule(selectors, 'box-shadow:' + shadow);
			rule([surfaces], (key === 'shadow' ? '--host-panel-shadow:' : '--host-control-shadow:') + shadow);
		}
		rule([modal + ' :is(.settings-tab,.tool-item,.sync-card,.close-btn,.appearance-tab)'], 'box-shadow:none');
		style.textContent = rules.join('\n');
		signature = next;
	}
	return Object.freeze({
		createScope({ isCurrent = () => true } = {}) {
			const identity = {};
			let disposed = false,
				activated = false,
				staged = null;
			const alive = () => !disposed && isCurrent() && (!activated || owner === identity);
			return Object.freeze({
				setAppearance(input) {
					if (!alive()) {
						return { status: 'rejected', reason: 'mount-invalidated' };
					}
					let value;
					try {
						value = normalize(input);
					} catch {
						return { status: 'rejected', reason: 'invalid-appearance' };
					}
					staged = value;
					if (activated) {
						render(staged);
					}
					return { status: 'completed' };
				},
				activate() {
					if (!alive()) {
						return { status: 'rejected', reason: 'mount-invalidated' };
					}
					owner = identity;
					activated = true;
					render(staged);
					return { status: 'completed' };
				},
				dispose() {
					disposed = true;
					staged = null;
					if (owner === identity) {
						owner = null;
						remove();
					}
				},
			});
		},
	});
}
