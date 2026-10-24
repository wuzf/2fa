import { validateManifest } from './schema.js';

const light = {
	'--2fa-background': '#fafafa',
	'--2fa-surface': '#ffffff',
	'--2fa-text': '#172033',
	'--2fa-muted': '#667085',
	'--2fa-accent': '#0078d4',
	'--2fa-border': '#dfe4eb',
	'--2fa-success': '#168052',
	'--2fa-danger': '#c43c39',
	'--2fa-font': 'system-ui,sans-serif',
	'--2fa-code-font': 'ui-monospace,monospace',
	'--2fa-font-size': '14px',
	'--2fa-page-width': '1440px',
	'--2fa-sidebar-width': '230px',
	'--2fa-gap': '20px',
	'--2fa-card-padding': '20px',
	'--2fa-radius': '8px',
	'--2fa-icon-size': '40px',
	'--2fa-shadow': '0 4px 20px rgb(30 50 80/6%)',
	'--2fa-background-image': 'none',
	'--2fa-opacity': '1',
	'--2fa-blur': '0px',
	'--2fa-animation-duration': '160ms',
};
const dark = {
	...light,
	'--2fa-background': '#11151d',
	'--2fa-surface': '#1d2430',
	'--2fa-text': '#edf1f7',
	'--2fa-muted': '#a1adbe',
	'--2fa-accent': '#65b5ff',
	'--2fa-border': '#344153',
	'--2fa-success': '#6ed3a2',
	'--2fa-danger': '#ff8d86',
	'--2fa-shadow': '0 4px 24px rgb(0 0 0/20%)',
};

const settings = [
	{ key: 'accent', type: 'color', label: 'Accent color', default: '#0078d4', binding: { type: 'variable', name: '--2fa-accent' } },
	{
		key: 'radius',
		type: 'select',
		label: 'Corner radius',
		default: '8px',
		options: [
			{ value: '0px', label: 'Square' },
			{ value: '8px', label: 'Soft' },
			{ value: '16px', label: 'Rounded' },
			{ value: '24px', label: 'Round' },
		],
		binding: { type: 'variable', name: '--2fa-radius' },
	},
	{
		key: 'density',
		type: 'select',
		label: 'Density',
		default: 'comfortable',
		options: [
			{ value: 'comfortable', label: 'Comfortable' },
			{ value: 'compact', label: 'Compact' },
		],
		binding: { type: 'attribute', name: 'data-theme-option-density' },
	},
	{
		key: 'background',
		type: 'asset',
		label: 'Background image',
		default: '',
		binding: { type: 'variable', name: '--2fa-background-image' },
	},
	{
		key: 'font',
		type: 'select',
		label: 'Font',
		default: 'system-ui,sans-serif',
		options: [
			{ value: 'system-ui,sans-serif', label: 'System' },
			{ value: 'Georgia,serif', label: 'Serif' },
			{ value: 'ui-monospace,monospace', label: 'Monospace' },
		],
		binding: { type: 'variable', name: '--2fa-font' },
	},
	{
		key: 'codeFont',
		type: 'select',
		label: 'Code font',
		default: 'ui-monospace,monospace',
		options: [
			{ value: 'ui-monospace,monospace', label: 'Monospace' },
			{ value: 'system-ui,sans-serif', label: 'System' },
			{ value: 'Georgia,serif', label: 'Serif' },
		],
		binding: { type: 'variable', name: '--2fa-code-font' },
	},
	{
		key: 'fontSize',
		type: 'number',
		label: 'Font size',
		default: 14,
		min: 12,
		max: 24,
		step: 1,
		binding: { type: 'variable', name: '--2fa-font-size', unit: 'px' },
	},
	{
		key: 'pageWidth',
		type: 'select',
		label: 'Page width',
		default: '1440px',
		options: ['900px', '1100px', '1200px', '1440px', '1680px', '100%'].map((value) => ({ value, label: value })),
		binding: { type: 'variable', name: '--2fa-page-width' },
	},
	{
		key: 'spacing',
		type: 'select',
		label: 'Spacing',
		default: '20px',
		options: ['8px', '10px', '12px', '16px', '20px', '24px', '32px'].map((value) => ({ value, label: value })),
		binding: { type: 'variable', name: '--2fa-gap' },
	},
	{
		key: 'cardPadding',
		type: 'select',
		label: 'Card padding',
		default: '20px',
		options: ['8px', '12px', '16px', '20px', '24px', '32px'].map((value) => ({ value, label: value })),
		binding: { type: 'variable', name: '--2fa-card-padding' },
	},
	{
		key: 'iconSize',
		type: 'select',
		label: 'Icon size',
		default: '40px',
		options: ['24px', '30px', '32px', '40px', '48px', '56px'].map((value) => ({ value, label: value })),
		binding: { type: 'variable', name: '--2fa-icon-size' },
	},
	{
		key: 'shadow',
		type: 'select',
		label: 'Shadow',
		default: '0 4px 20px rgb(30 50 80/6%)',
		options: [
			{ value: 'none', label: 'None' },
			{ value: '0 4px 20px rgb(30 50 80/6%)', label: 'Soft' },
			{ value: '0 8px 32px rgb(0 0 0/20%)', label: 'Strong' },
		],
		binding: { type: 'variable', name: '--2fa-shadow' },
	},
	{
		key: 'columns',
		type: 'select',
		label: 'Columns',
		default: 'auto',
		options: [{ value: 'auto', label: 'Automatic' }, ...['1', '2', '3'].map((value) => ({ value, label: value }))],
		binding: { type: 'attribute', name: 'data-theme-option-columns' },
	},
	{
		key: 'animation',
		type: 'select',
		label: 'Animation',
		default: '160ms',
		options: [
			{ value: '0ms', label: 'None' },
			{ value: '160ms', label: 'Soft' },
			{ value: '300ms', label: 'Strong' },
		],
		binding: { type: 'variable', name: '--2fa-animation-duration' },
	},
	{
		key: 'surfaceOpacity',
		type: 'number',
		label: 'Surface opacity',
		default: 1,
		min: 0.2,
		max: 1,
		step: 0.05,
		binding: { type: 'variable', name: '--2fa-opacity' },
	},
	{
		key: 'backgroundBlur',
		type: 'number',
		label: 'Background blur',
		default: 0,
		min: 0,
		max: 30,
		step: 1,
		binding: { type: 'variable', name: '--2fa-blur', unit: 'px' },
	},
];

const baseCss = `
[data-part="account"]{background:var(--2fa-surface);background:color-mix(in srgb,var(--2fa-surface) calc(var(--2fa-opacity)*100%),transparent);backdrop-filter:blur(var(--2fa-blur));border:1px solid var(--2fa-border);border-radius:var(--2fa-radius);padding:var(--2fa-card-padding);box-shadow:var(--2fa-shadow)}
[data-part="code"],[data-part="next-code"]{font-family:var(--2fa-code-font)}
[data-theme-option-density="compact"] [data-part="account"]{padding:calc(var(--2fa-card-padding)*.75);gap:calc(var(--2fa-gap)*.75)}
[data-part="region-leading"],[data-part="region-trailing"]{min-width:0}
@media (min-width: 768px){[data-theme-option-columns="1"] [data-part="account-grid"],[data-theme-option-columns="1"] .service-group-grid{grid-template-columns:1fr}[data-theme-option-columns="2"] [data-part="account-grid"],[data-theme-option-columns="2"] .service-group-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (min-width: 1200px){[data-theme-option-columns="3"] [data-part="account-grid"],[data-theme-option-columns="3"] .service-group-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (prefers-reduced-motion: reduce){:root{--2fa-animation-duration:0ms}}
`;

const definitions = [
	{
		id: 'fluent',
		name: 'Fluent',
		layout: {
			header: ['brand'],
			leading: [],
			main: ['search', 'view-controls', 'system-status', 'accounts', { id: 'actions', type: 'actions', mode: 'floating' }],
			trailing: [],
			footer: ['footer'],
		},
		css: baseCss,
	},
	{
		id: 'document',
		name: 'Document',
		layout: {
			header: ['brand', { id: 'actions', type: 'actions', mode: 'toolbar' }],
			leading: ['service-nav'],
			main: ['search', 'view-controls', 'system-status', 'accounts'],
			trailing: [{ id: 'welcome', type: 'text' }],
			footer: ['footer'],
		},
		content: {
			welcome: { title: 'Your space', text: 'Make this 2FA your own. Customize the layout, colors and typography in Appearance.' },
		},
		css:
			baseCss +
			`
[data-part="region-leading"],[data-part="region-trailing"]{padding:20px;background:var(--2fa-surface);border:1px solid var(--2fa-border);border-radius:var(--2fa-radius);align-self:start}
[data-part="service-nav"]{display:flex;flex-direction:column;gap:6px}
[data-part="service-nav"] button{text-align:left;border-radius:8px;padding:10px}
@media (min-width: 1200px){[data-part="region-leading"],[data-part="region-trailing"]{position:sticky;top:24px}}
`,
		tokens: { '--2fa-radius': '8px', '--2fa-shadow': 'none', '--2fa-sidebar-width': '220px' },
	},
	{
		id: 'compact',
		name: 'Compact',
		layout: {
			header: ['brand', 'search'],
			leading: [],
			main: ['view-controls', 'system-status', 'accounts', { id: 'actions', type: 'actions', mode: 'toolbar' }],
			trailing: [],
			footer: ['footer'],
		},
		css:
			baseCss +
			`
[data-part="account-grid"],.service-group-grid{grid-template-columns:1fr}
[data-part="account"]{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:var(--2fa-gap);padding:var(--2fa-card-padding)}
[data-part="account-header"]{margin-bottom:0;min-width:0;height:auto;width:100%;align-items:center}
[data-part="account"] [data-part="identity"]{min-width:0}
[data-part="account"] [data-part="progress"]{grid-column:1/-1}
[data-part="account"] [data-part="codes"]{min-width:0;margin:0;padding:0}
[data-part="account"] [data-part="code"]{font-size:25px}
@media (max-width: 767px){[data-part="account"]{grid-template-columns:minmax(0,1fr);gap:8px;text-align:left}[data-part="account"] [data-part="codes"]{width:100%}[data-part="account"] [data-part="code"]{line-height:36px}}
`,
		tokens: {
			'--2fa-radius': '8px',
			'--2fa-gap': '10px',
			'--2fa-card-padding': '12px',
			'--2fa-icon-size': '30px',
			'--2fa-page-width': '1100px',
			'--2fa-shadow': 'none',
		},
	},
];

export const BUILTIN_THEMES = Object.freeze(
	definitions.map((definition) => ({
		packageId: 'builtin:' + definition.id,
		builtin: true,
		manifest: validateManifest(
			{
				themeApiVersion: 1,
				id: definition.id,
				name: definition.name,
				version: '1.0.0',
				author: '2FA',
				styles: 'theme.css',
				layout: definition.layout,
				content: definition.content ?? {},
				tokens: { light: { ...light, ...definition.tokens }, dark: { ...dark, ...definition.tokens } },
				settings: settings.map((field) =>
					field.binding.type === 'variable' && definition.tokens?.[field.binding.name] !== undefined
						? { ...field, default: definition.tokens[field.binding.name] }
						: field,
				),
			},
			{ builtin: true },
		),
		css: definition.css,
		assets: [],
	})),
);

/** Return copies: callers must never accidentally mutate the shared built-in definition. */
export function getBuiltinThemes() {
	return JSON.parse(JSON.stringify(BUILTIN_THEMES));
}

export function getBuiltinTheme(id = 'builtin:fluent') {
	return getBuiltinThemes().find((theme) => theme.packageId === id || theme.manifest.id === id) ?? null;
}
