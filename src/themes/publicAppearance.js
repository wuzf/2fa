import { invariant, utf8Size } from './schema.js';
import { appRecord, appPath, assertAppData, validateAppSettings } from './appSchema.js';
import { normalizeHostAppearance } from '../ui/runtime/hostAppearance.js';

export const PUBLIC_APPEARANCE_PATH = 'public-appearance.json';
export const PUBLIC_APPEARANCE_LIMITS = Object.freeze({ bytes: 128 * 1024, families: 4, faces: 64, rangeBytes: 32 * 1024, ranges: 4096 });
const genericFamilies = new Set([
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
	'inherit',
	'initial',
	'unset',
	'revert',
	'revert-layer',
]);

function tokens(input) {
	try {
		const result = normalizeHostAppearance(input);
		invariant(result !== null, 'THEME_PUBLIC_APPEARANCE');
		return result;
	} catch {
		invariant(false, 'THEME_PUBLIC_APPEARANCE');
	}
}

/** Parse intervals instead of interpolating untrusted CSS syntax. */
export function normalizePublicUnicodeRange(input) {
	invariant(typeof input === 'string' && utf8Size(input) <= PUBLIC_APPEARANCE_LIMITS.rangeBytes, 'THEME_PUBLIC_FONT_RANGE');
	const parts = input.split(',');
	invariant(parts.length > 0 && parts.length <= PUBLIC_APPEARANCE_LIMITS.ranges, 'THEME_PUBLIC_FONT_RANGE');
	const ranges = parts
		.map((part) => {
			const match = /^U\+([0-9a-f]{1,6})(?:-([0-9a-f]{1,6}))?$/i.exec(part.trim());
			const wildcard = /^U\+([0-9a-f]{0,5})(\?{1,6})$/i.exec(part.trim());
			invariant(match || (wildcard && wildcard[1].length + wildcard[2].length <= 6), 'THEME_PUBLIC_FONT_RANGE');
			const start = match ? parseInt(match[1], 16) : parseInt(wildcard[1] + '0'.repeat(wildcard[2].length), 16);
			const end = match ? parseInt(match[2] || match[1], 16) : parseInt(wildcard[1] + 'f'.repeat(wildcard[2].length), 16);
			invariant(start <= end && end <= 0x10ffff, 'THEME_PUBLIC_FONT_RANGE');
			return [start, end];
		})
		.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const merged = [];
	for (const range of ranges) {
		const previous = merged.at(-1);
		if (previous && range[0] <= previous[1] + 1) {
			previous[1] = Math.max(previous[1], range[1]);
		} else {
			merged.push(range.slice());
		}
	}
	const hex = (value) => value.toString(16).toUpperCase();
	const result = merged.map(([start, end]) => 'U+' + hex(start) + (start === end ? '' : '-' + hex(end))).join(',');
	invariant(utf8Size(result) <= PUBLIC_APPEARANCE_LIMITS.rangeBytes, 'THEME_PUBLIC_FONT_RANGE');
	return result;
}

/** Called only after the complete package inventory and resource bytes have been verified. */
export function normalizePublicAppearanceDescriptor(input, { manifest, files }) {
	assertAppData(input);
	invariant(utf8Size(JSON.stringify(input)) <= PUBLIC_APPEARANCE_LIMITS.bytes, 'THEME_PUBLIC_APPEARANCE_LIMIT');
	appRecord(input, ['formatVersion', 'light', 'dark', 'fonts', 'variants']);
	invariant(input.formatVersion === 1, 'THEME_PUBLIC_APPEARANCE');
	const normalized = { formatVersion: 1, light: tokens(input.light), dark: tokens(input.dark), fonts: [], variants: [] };
	const fonts = input.fonts === undefined ? [] : input.fonts,
		variants = input.variants === undefined ? [] : input.variants;
	invariant(Array.isArray(fonts) && fonts.length <= PUBLIC_APPEARANCE_LIMITS.faces, 'THEME_PUBLIC_FONT_LIMIT');
	const families = new Set(),
		faces = new Set();
	for (const font of fonts) {
		appRecord(font, ['family', 'path', 'weight', 'style', 'unicodeRange']);
		const family = tokens({ fontFamily: [font.family] }).fontFamily[0];
		invariant(!genericFamilies.has(family.toLowerCase()), 'THEME_PUBLIC_FONT');
		families.add(family.toLowerCase());
		invariant(families.size <= PUBLIC_APPEARANCE_LIMITS.families, 'THEME_PUBLIC_FONT_LIMIT');
		const path = appPath(font.path);
		const inventory = manifest.files.find((entry) => entry.path === path);
		const file = files.find((entry) => entry.path === path);
		invariant(
			file &&
				inventory &&
				file.mime === 'font/woff2' &&
				inventory.mime === file.mime &&
				file.hash === inventory.sha256 &&
				file.size === inventory.size,
			'THEME_PUBLIC_FONT',
		);
		const weight = font.weight ?? 400,
			style = font.style ?? 'normal';
		const weights = Array.isArray(weight) ? weight : [weight];
		invariant(
			(!Array.isArray(weight) || weight.length === 2) &&
				weights.every((value) => Number.isInteger(value) && value >= 100 && value <= 900) &&
				(weights.length === 1 || weights[0] <= weights[1]),
			'THEME_PUBLIC_FONT',
		);
		invariant(style === 'normal' || style === 'italic', 'THEME_PUBLIC_FONT');
		const face = { family, path, weight: Array.isArray(weight) ? weight.slice() : weight, style };
		if (Object.hasOwn(font, 'unicodeRange')) {
			face.unicodeRange = normalizePublicUnicodeRange(font.unicodeRange);
		}
		const key = JSON.stringify({ ...face, family: family.toLowerCase() });
		invariant(!faces.has(key), 'THEME_PUBLIC_FONT');
		faces.add(key);
		normalized.fonts.push(face);
	}
	invariant(Array.isArray(variants) && variants.length <= 4, 'THEME_PUBLIC_VARIANT');
	const seen = new Set();
	for (const variant of variants) {
		appRecord(variant, ['setting', 'values']);
		const field = manifest.settings.find((entry) => entry.key === variant.setting);
		invariant(field && ['boolean', 'select'].includes(field.type) && !seen.has(field.key), 'THEME_PUBLIC_VARIANT');
		seen.add(field.key);
		const allowed = field.type === 'boolean' ? ['false', 'true'] : field.options.map((option) => option.value);
		appRecord(variant.values, allowed);
		const entries = Object.entries(variant.values);
		invariant(entries.length > 0 && entries.length <= 16, 'THEME_PUBLIC_VARIANT');
		const values = {};
		for (const [value, patch] of entries) {
			appRecord(patch, ['light', 'dark']);
			invariant(Object.keys(patch).length > 0, 'THEME_PUBLIC_VARIANT');
			values[value] = {};
			for (const mode of ['light', 'dark']) {
				if (Object.hasOwn(patch, mode)) {
					values[value][mode] = tokens(patch[mode]);
				}
			}
		}
		normalized.variants.push({ setting: field.key, values });
	}
	return normalized;
}

/** Resolve only selected finite tokens; never expose settings or variant definitions to public pages. */
export function resolvePublicAppearance(pkg, inputSettings, { baseUrl } = {}) {
	const description = pkg.publicAppearanceDescriptor;
	if (!description) {
		return null;
	}
	invariant(/^[a-f0-9]{64}$/.test(pkg.packageId), 'THEME_APP_HASH');
	const settings = validateAppSettings(pkg.manifest, inputSettings);
	if (baseUrl !== undefined) {
		invariant(/^\/theme-preview\/[a-f0-9]{64}\/$/.test(baseUrl), 'THEME_PUBLIC_FONT');
	}
	const result = { formatVersion: 1, packageId: pkg.packageId, light: { ...description.light }, dark: { ...description.dark }, fonts: [] };
	for (const variant of description.variants) {
		const patch = variant.values[String(settings[variant.setting])];
		for (const mode of ['light', 'dark']) {
			result[mode] = tokens({ ...result[mode], ...patch?.[mode] });
		}
	}
	const registered = [...new Set(description.fonts.map((font) => font.family.toLowerCase()))];
	const used = new Set();
	const internalFamily = (family) => '2fa-public-' + pkg.packageId + '-' + registered.indexOf(family.toLowerCase());
	for (const mode of ['light', 'dark']) {
		if (!result[mode].fontFamily) {
			continue;
		}
		result[mode].fontFamily = result[mode].fontFamily.map((family) => {
			if (!registered.includes(family.toLowerCase())) {
				return family;
			}
			used.add(family.toLowerCase());
			return internalFamily(family);
		});
	}
	result.fonts = description.fonts
		.filter((font) => used.has(font.family.toLowerCase()))
		.map((font) => {
			const file = pkg.files.find((entry) => entry.path === font.path);
			return {
				...font,
				family: internalFamily(font.family),
				url: (baseUrl || '/theme-packages/' + pkg.packageId + '/') + font.path,
				hash: file.hash,
				size: file.size,
			};
		});
	return result;
}
