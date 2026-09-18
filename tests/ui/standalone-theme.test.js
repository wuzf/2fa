import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { getStandaloneThemeScript } from '../../src/ui/standalone.js';

function themeHarness(savedTheme, systemDark, storageAvailable = true, legacyMedia = false) {
	let selected = savedTheme;
	let applied;
	let onMediaChange;
	let onStorage;
	const media = { matches: systemDark };
	media[legacyMedia ? 'addListener' : 'addEventListener'] = (...args) => {
		onMediaChange = args.at(-1);
	};
	const context = createContext({
		window: {
			matchMedia: () => media,
			addEventListener: (_name, fn) => {
				onStorage = fn;
			},
		},
		document: {
			documentElement: {
				setAttribute: (_name, value) => {
					applied = value;
				},
			},
		},
		localStorage: {
			getItem: vi.fn(() => {
				if (!storageAvailable) {throw new Error('Storage denied');}
				return selected;
			}),
		},
	});
	runInContext(getStandaloneThemeScript(), context);
	return {
		current: () => applied,
		system(dark) {
			media.matches = dark;
			onMediaChange();
		},
		storage(theme, key = 'theme') {
			selected = theme;
			onStorage({ key });
		},
	};
}

describe('standalone page theme preferences', () => {
	it.each([
		['light', true],
		['dark', false],
	])('honors saved %s even when the OS disagrees', (saved, system) => {
		const h = themeHarness(saved, system);
		expect(h.current()).toBe(saved);
		h.system(!system);
		expect(h.current()).toBe(saved);
	});
	it('follows live system changes in auto mode and theme changes from other tabs', () => {
		const h = themeHarness('auto', false);
		expect(h.current()).toBe('light');
		h.system(true);
		expect(h.current()).toBe('dark');
		h.storage('light');
		expect(h.current()).toBe('light');
		h.storage(null, null);
		expect(h.current()).toBe('dark');
	});
	it('still follows the OS when an exported file cannot read localStorage', () => {
		const h = themeHarness(null, true, false, true);
		expect(h.current()).toBe('dark');
		h.system(false);
		expect(h.current()).toBe('light');
	});
});
