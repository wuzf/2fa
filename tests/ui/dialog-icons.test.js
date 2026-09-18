import { createContext, runInContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { dialogIcon, getDialogIconCode } from '../../src/ui/dialogIcons.js';

function createLegacyBrowserIconRenderer() {
	const context = createContext({});
	// Safari 14 and other supported browsers do not provide Object.hasOwn.
	// Remove it only inside the VM so the test runner keeps its native globals.
	runInContext('Object.hasOwn = undefined; globalThis.window = globalThis;', context);
	runInContext(getDialogIconCode(), context);
	expect(runInContext('typeof Object.hasOwn', context)).toBe('undefined');
	return context.dialogIcon;
}

describe('dialog icons in supported older browsers', () => {
	it.each(['check', 'error', 'warning'])('renders the %s icon without Object.hasOwn', (name) => {
		const renderIcon = createLegacyBrowserIconRenderer();
		const svg = renderIcon(name);

		expect(svg).toMatch(/^<svg\b[^>]*><path d="[^"]+"><\/path><\/svg>$/);
		expect(svg).toContain('aria-hidden="true"');
		expect(svg).toBe(dialogIcon(name));
		expect(svg).not.toBe(renderIcon('info'));
	});

	it.each(['unknown', '__proto__', 'constructor'])('uses the information icon for %s instead of inherited properties', (name) => {
		const renderIcon = createLegacyBrowserIconRenderer();
		const svg = renderIcon(name);

		expect(svg).toBe(renderIcon('info'));
		expect(svg).toBe(dialogIcon(name));
		expect(svg).toMatch(/<path d="[Mm][0-9 .,-]+[\s\S]*"><\/path>/);
		expect(svg).not.toContain('[object Object]');
		expect(svg).not.toContain('function');
	});
});
