import { normalizeHostAppearance } from './runtime/hostAppearance.js';

/** Shared by every public HTML entry, including the legacy recovery query. */
export function isAppearanceSafeMode(requestOrUrl) {
	try {
		const url = new URL(typeof requestOrUrl === 'string' ? requestOrUrl : requestOrUrl?.url || requestOrUrl?.href);
		return url.searchParams.get('safeMode') === '1' || url.searchParams.get('disableCustomCode') === '1';
	} catch {
		return false;
	}
}

/** Self-contained for the serialized client updater. Only a server-derived projection is consumed. */
function renderPublicAppearanceStyles(appearance, surface, safeMode, normalize) {
	const projection = appearance?.publicAppearance;
	if (
		safeMode ||
		appearance?.kind !== 'app' ||
		!projection ||
		projection.formatVersion !== 1 ||
		projection.packageId !== appearance.packageId ||
		!/^[a-f0-9]{64}$/.test(projection.packageId) ||
		!['host', 'standalone', 'setup'].includes(surface)
	) {
		return '';
	}
	try {
		const light = normalize(projection.light),
			dark = normalize(projection.dark);
		if (!light || !dark || !Array.isArray(projection.fonts) || projection.fonts.length > 64) {
			return '';
		}
		const rules = [];
		const id = 'public-appearance-baseline';
		const exclusion = ':not(#appThemeRoot):not(#appThemeRoot *)';
		const root = ':root:has(style#' + id + ')' + (surface === 'host' ? ':not([data-app-host-appearance])' : '');
		const quote = (value) => JSON.stringify(value).replace(/</g, '\\3c ');
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
		const familyCss = (families) => families.map((name) => (generic.has(name.toLowerCase()) ? name.toLowerCase() : quote(name))).join(',');
		const used = new Set([...(light.fontFamily || []), ...(dark.fontFamily || [])]);
		for (const face of projection.fonts) {
			if (!used.has(face.family)) {
				continue;
			}
			if (
				!new RegExp('^2fa-public-' + projection.packageId + '-[0-3]$').test(face.family) ||
				!/^\/[A-Za-z0-9._/-]+$/.test(face.url) ||
				!/^[A-Za-z0-9._/-]+\.woff2$/.test(face.path) ||
				face.path.split('/').some((part) => !part || part === '.' || part === '..') ||
				!['normal', 'italic'].includes(face.style)
			) {
				return '';
			}
			const base = appearance.baseUrl || '/theme-packages/' + projection.packageId + '/';
			if (
				!(base === '/theme-packages/' + projection.packageId + '/' || /^\/theme-preview\/[a-f0-9]{64}\/$/.test(base)) ||
				face.url !== base + face.path
			) {
				return '';
			}
			const weights = Array.isArray(face.weight) ? face.weight : [face.weight];
			if (
				![1, 2].includes(weights.length) ||
				weights.some((value) => !Number.isInteger(value) || value < 100 || value > 900) ||
				(weights.length === 2 && weights[0] > weights[1])
			) {
				return '';
			}
			let range = '';
			if (face.unicodeRange !== undefined) {
				if (typeof face.unicodeRange !== 'string' || face.unicodeRange.length > 32768) {
					return '';
				}
				const ranges = face.unicodeRange.split(',');
				if (
					!ranges.length ||
					ranges.length > 4096 ||
					ranges.some((value) => {
						const match = /^U\+([0-9A-F]{1,6})(?:-([0-9A-F]{1,6}))?$/.exec(value);
						return !match || parseInt(match[1], 16) > parseInt(match[2] || match[1], 16) || parseInt(match[2] || match[1], 16) > 0x10ffff;
					})
				) {
					return '';
				}
				range = ';unicode-range:' + ranges.join(',');
			}
			rules.push(
				'@font-face{font-family:' +
					quote(face.family) +
					';src:url(' +
					quote(face.url) +
					') format("woff2");font-weight:' +
					weights.join(' ') +
					';font-style:' +
					face.style +
					';font-display:swap' +
					range +
					'}',
			);
		}
		const shadowCss = (value) => (value === null ? 'none' : `${value.x}px ${value.y}px ${value.blur}px ${value.spread}px ${value.color}`);
		function modeRules(tokens, prefix) {
			const css = [];
			const rule = (selectors, declarations) => {
				if (declarations) {
					css.push(selectors.map((selector) => prefix + ' ' + selector + exclusion).join(',') + '{' + declarations + '}');
				}
			};
			const surfaces = surface === 'host' ? ['.modal', '.center-toast', '.dialog-toast'] : ['body'];
			const panel =
				surface === 'host'
					? ['.modal .modal-content', '.center-toast .toast-content', '.dialog-toast']
					: [surface === 'setup' ? '.setup-container' : '.standalone-card'];
			const controls =
				surface === 'host'
					? ['.modal :is(button,input:not([type=checkbox],[type=radio],[type=range],[type=hidden],[type=file]),select,textarea,.btn)']
					: [
							surface === 'setup'
								? ':is(.form-input,.submit-button,.setup-lang-select,.toggle-password)'
								: ':is(.page-input,.page-button,.standalone-language,.retry-button,.token-button)',
						];
			const variablePrefix = surface === 'host' ? '--dialog-' : surface === 'setup' ? '--setup-' : '--page-';
			const mappings = {
				surface: 'surface',
				subtle: surface === 'host' ? 'subtle' : 'bg',
				hover: 'hover',
				text: 'text',
				muted: 'muted',
				line: 'line',
				stroke: 'stroke',
				accent: 'brand',
				accentHover: 'brand-hover',
				accentText: 'brand-text',
				selected: 'selected',
				danger: 'danger',
				dangerBackground: 'danger-bg',
				warning: 'warning',
				warningBackground: 'warning-bg',
				success: 'success',
				successBackground: 'success-bg',
			};
			const variables = Object.entries(mappings)
				.filter(([key]) => tokens[key] !== undefined)
				.map(([key, name]) => variablePrefix + name + ':' + tokens[key]);
			const field = (key, selectors, property, suffix = '') => {
				if (Object.hasOwn(tokens, key)) {
					rule(selectors, property + ':' + tokens[key] + suffix);
				}
			};
			const geometry = { radius: '--host-panel-radius', controlRadius: '--host-control-radius', borderWidth: '--host-border-width' };
			for (const [key, name] of Object.entries(geometry)) {
				if (Object.hasOwn(tokens, key)) {
					variables.push(name + ':' + tokens[key] + 'px');
				}
			}
			if (tokens.accent) {
				variables.push('--progress-fill:' + tokens.accent);
			}
			if (tokens.subtle) {
				variables.push('--progress-bg:' + tokens.subtle);
			}
			if (tokens.fontFamily) {
				variables.push('--host-font-family:' + familyCss(tokens.fontFamily));
			}
			for (const [key, name] of [
				['shadow', '--host-panel-shadow'],
				['controlShadow', '--host-control-shadow'],
			]) {
				if (Object.hasOwn(tokens, key)) {
					variables.push(name + ':' + shadowCss(tokens[key]));
				}
			}
			if (surface === 'host') {
				if (tokens.accent) {
					variables.push('--btn-primary-bg:' + tokens.accent);
				}
				if (tokens.accentHover) {
					variables.push('--btn-primary-hover:' + tokens.accentHover);
				}
				if (tokens.accentText) {
					variables.push('--btn-primary-text:' + tokens.accentText);
				}
			}
			if (Object.hasOwn(tokens, 'shadow') && surface !== 'host') {
				variables.push(variablePrefix + 'shadow:' + shadowCss(tokens.shadow));
			}
			rule(surfaces, variables.join(';'));
			field('surface', panel, 'background-color');
			field('text', panel, 'color');
			field('line', panel, 'border-color');
			field('radius', panel, 'border-radius', 'px');
			field('controlRadius', controls, 'border-radius', 'px');
			field('borderWidth', [...panel, ...controls], 'border-width', 'px');
			field('stroke', controls, 'border-color');
			if (tokens.fontFamily) {
				rule([...surfaces, ...controls], 'font-family:' + familyCss(tokens.fontFamily));
			}
			if (Object.hasOwn(tokens, 'shadow')) {
				rule(panel, 'box-shadow:' + shadowCss(tokens.shadow));
			}
			if (Object.hasOwn(tokens, 'controlShadow')) {
				rule(controls, 'box-shadow:' + shadowCss(tokens.controlShadow));
			}
			const primary =
				surface === 'host' ? ['.modal .btn-primary'] : [surface === 'setup' ? '.submit-button:not(:disabled)' : '.page-button'];
			field('accent', primary, 'background-color');
			field('accent', primary, 'border-color');
			field('accentText', primary, 'color');
			field(
				'accentHover',
				primary.map((selector) => selector + ':hover'),
				'background-color',
			);
			if (surface === 'host') {
				field('dangerFill', ['.modal .btn-danger'], 'background-color');
				field('dangerFillHover', ['.modal .btn-danger:hover'], 'background-color');
				field('dangerText', ['.modal .btn-danger'], 'color');
				// The public login surface keeps the official DOM available for
				// cancellation/recovery, while removing competing background UI.
				const login = prefix + ' body:has(> #loginModal.show:not([hidden]))';
				const background = ['#officialThemeRoot', '#officialThemeActions', '#officialThemeFooter'];
				const hidden = background.flatMap((selector) => [selector, selector + ' *']);
				hidden.push('#appThemeRuntimeStatus[data-phase="login-required"]:not(:has(.app-theme-status-recovery))');
				css.push(hidden.map((selector) => login + ' > ' + selector + exclusion).join(',') + '{visibility:hidden}');
				const backdrop = tokens.subtle || tokens.surface;
				if (backdrop) {
					css.push(login + '{background-color:' + backdrop + ';background-image:none}');
					// Until the app theme mounts, the page already shows the theme's own background.
					css.push(prefix + '[data-app-theme-startup] body{background-color:' + backdrop + ';background-image:none}');
				}
			} else {
				field('subtle', ['body'], 'background-color');
				field('text', ['body'], 'color');
			}
			return css.join('\n');
		}
		rules.push(modeRules(light, root + ':not([data-theme="dark"])'));
		rules.push(modeRules(dark, root + '[data-theme="dark"]'));
		rules.push('@media(prefers-color-scheme:dark){' + modeRules(dark, root + ':not([data-theme="light"]):not([data-theme="dark"])') + '}');
		return rules.join('\n').replace(/<\/style/gi, '<\\/style');
	} catch {
		return '';
	}
}

/**
 * The background an app theme shows in light mode, the same color the page
 * paints while the theme starts. The installed app takes its navigation bar
 * and splash colors from the manifest, which holds a single color.
 */
export function getPublicAppearanceBackdrop(appearance) {
	const projection = appearance?.publicAppearance;
	if (
		appearance?.kind !== 'app' ||
		projection?.formatVersion !== 1 ||
		projection.packageId !== appearance.packageId ||
		!/^[a-f0-9]{64}$/.test(projection.packageId)
	) {
		return null;
	}
	try {
		const light = normalizeHostAppearance(projection.light);
		return light?.subtle || light?.surface || null;
	} catch {
		return null;
	}
}

export function getPublicAppearanceStyles(appearance, { surface = 'host', safeMode = false } = {}) {
	return renderPublicAppearanceStyles(appearance, surface, safeMode, normalizeHostAppearance);
}

export function getPublicAppearanceHead(appearance, options) {
	const css = getPublicAppearanceStyles(appearance, options);
	return css ? '<style id="public-appearance-baseline">' + css + '</style>' : '';
}

/** The host invokes this only for a current tuple that has confirmed running. */
export function getPublicAppearanceClientCode() {
	return `(() => {
    const normalize = ${normalizeHostAppearance.toString()};
    const render = ${renderPublicAppearanceStyles.toString()};
    const safe = ${isAppearanceSafeMode.toString()};
    window.updatePublicAppearanceBaseline = (snapshot) => {
      const css = render(snapshot, 'host', Boolean(window.__2FA_SAFE_MODE__) || safe(location.href), normalize);
      let style = document.getElementById('public-appearance-baseline');
      if (!css) { style?.remove(); return; }
      if (!style) { style = document.createElement('style'); style.id = 'public-appearance-baseline'; document.head.append(style); }
      if (style.textContent !== css) style.textContent = css;
    };
  })();`;
}
