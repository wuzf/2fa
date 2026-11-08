import { describe, expect, it } from 'vitest';
import { harness, flush, json } from '../helpers/appearance-editor.js';
import { getBuiltinTheme } from '../../src/themes/builtins.js';
import { LOCALES } from '../../src/ui/locales/index.js';

const zh = LOCALES['zh-CN'];
const toggle = (h) => h.document.getElementById('appearanceAutoUpdate');
const block = (h) => h.document.querySelector('#appearanceCatalog .appearance-auto-update');

function setup(h, { autoUpdate, save, write = true } = {}) {
	const puts = [];
	h.window.authenticatedFetch.mockImplementation(async (url, options = {}) => {
		if (url === '/api/themes/auto-update') {
			if (options.method === 'PUT') {
				const body = JSON.parse(options.body);
				puts.push(body);
				return save ? save(body) : json({ ...autoUpdate, enabled: body.enabled });
			}
			return typeof autoUpdate === 'function' ? autoUpdate() : json(autoUpdate);
		}
		if (url === '/api/themes/catalog') {
			return json({ themes: [] });
		}
		if (url === '/api/themes') {
			return json({ themes: [getBuiltinTheme('fluent')] });
		}
		if (url === '/api/themes?format=app') {
			return json({ themes: [] });
		}
		return json({ revision: 1, active: h.initial, capabilities: { write } });
	});
	return puts;
}

describe('official theme auto-update switch', () => {
	it('starts off and saves the owner’s choice', async () => {
		const h = harness({ theme: getBuiltinTheme('fluent') });
		const puts = setup(h, { autoUpdate: { enabled: false, history: [] } });
		await h.window.showAppearanceEditor();
		await flush();
		expect(block(h).textContent).toContain(zh.appearanceAutoUpdate);
		expect(block(h).textContent).toContain(zh.appearanceAutoUpdateHelp);
		expect(toggle(h).checked).toBe(false);
		toggle(h).click();
		await flush();
		expect(puts).toEqual([{ enabled: true }]);
		expect(toggle(h).checked).toBe(true);
	});

	it('puts the switch back when saving fails', async () => {
		const h = harness({ theme: getBuiltinTheme('fluent') });
		setup(h, { autoUpdate: { enabled: false, history: [] }, save: () => json({ error: 'THEME_RATE_LIMIT' }, 429) });
		await h.window.showAppearanceEditor();
		await flush();
		toggle(h).click();
		await flush();
		expect(toggle(h).checked).toBe(false);
		expect(h.document.getElementById('appearanceStatus').dataset.error).toBe('true');
	});

	it('lists the latest updates and the ones left to the owner', async () => {
		const h = harness({ theme: getBuiltinTheme('fluent') });
		const history = [
			{ id: 'pixel-for-2fa', name: 'Pixel', from: '1.0.0', to: '1.2.0', status: 'skipped', reason: 'settings', at: 3 },
			{ id: 'y2k-for-2fa', name: 'Y2K', from: '1.0.0', to: '1.1.0', status: 'applied', at: Date.UTC(2026, 10, 10) },
			{ id: 'codex-for-2fa', name: 'Codex', from: '1.0.0', to: '1.0.1', status: 'failed', reason: 'THEME_DOWNLOAD_FAILED', at: 1 },
			{ id: 'claude-for-2fa', name: 'Claude', from: '1.0.0', to: '1.0.1', status: 'installed', at: 0 },
		];
		setup(h, { autoUpdate: { enabled: true, history } });
		await h.window.showAppearanceEditor();
		await flush();
		const entries = [...block(h).querySelectorAll('.appearance-auto-update-entry')].map((entry) => entry.textContent);
		expect(entries).toHaveLength(3);
		expect(entries[0]).toBe(
			zh.appearanceAutoUpdateSkipped
				.replace('{name}', 'Pixel')
				.replace('{version}', '1.2.0')
				.replace('{reason}', zh.appearanceAutoUpdateSettings),
		);
		expect(entries[1]).toContain('Y2K');
		expect(entries[1]).toContain('1.1.0');
		expect(entries[2]).toBe(zh.appearanceAutoUpdateFailed.replace('{name}', 'Codex').replace('{version}', '1.0.1'));
	});

	it('is hidden when the store cannot report it or the owner cannot write', async () => {
		const unavailable = harness({ theme: getBuiltinTheme('fluent') });
		setup(unavailable, { autoUpdate: () => json({ error: 'THEME_ERROR' }, 503) });
		await unavailable.window.showAppearanceEditor();
		await flush();
		expect(block(unavailable)).toBeNull();
		expect(unavailable.document.getElementById('appearanceCatalog')).not.toBeNull();

		const readOnly = harness({ theme: getBuiltinTheme('fluent') });
		setup(readOnly, { autoUpdate: { enabled: true, history: [] }, write: false });
		await readOnly.window.showAppearanceEditor();
		await flush();
		expect(block(readOnly)).toBeNull();
	});
});
