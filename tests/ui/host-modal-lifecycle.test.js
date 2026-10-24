import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeFixture } from '../helpers/theme-runtime.js';

const fixtures = [];
const suspensionAttribute = 'data-theme-host-suspended';
afterEach(async () => {
	for (const fixture of fixtures.splice(0)) {
		fixture.scope.dispose();
		await fixture.dispose();
	}
});
function deferred() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
async function setup() {
	const h = await createRuntimeFixture({
		full: true,
		accountDOM: false,
		fetch: async () => Response.json({ success: true, destinations: [], count: 0, settings: {} }),
		extraSource:
			'window.__runtimeFixture.createScope=createAppThemeSdkScope; window.__runtimeFixture.cancelThemeChild=id=>themeHostChildren.get(id)?.cancel(); initModalDismissal();',
	});
	h.replaceSecretRecords([], { source: 'server', accessVerified: true });
	const scope = h.createScope({ isCurrent: () => true, identity: { packageId: 'b'.repeat(64) } });
	const trigger = h.document.createElement('button');
	trigger.textContent = 'Manage';
	h.document.body.append(trigger);
	trigger.focus();
	const fixture = { ...h, scope, trigger };
	fixtures.push(fixture);
	return fixture;
}
const providers = [
	['Webdav', 'webdavModal', 'hideWebdavModal'],
	['S3', 's3Modal', 'hideS3Modal'],
	['OneDrive', 'oneDriveModal', 'hideOneDriveModal'],
	['GoogleDrive', 'googleDriveModal', 'hideGoogleDriveModal'],
];
describe('host parent and child modal lifetime', () => {
	it('revokes an ordinary settings observer without cancelling or hiding the host form', async () => {
		const h = await setup();
		const flow = h.scope.sdk.host.open({ kind: 'settings', section: 'security' }, { returnFocus: h.trigger });
		const parent = h.document.getElementById('settingsModal');
		const draft = h.document.getElementById('settingsCurrentPassword');
		draft.value = 'synthetic-unsaved-input';
		h.scope.dispose();
		expect(await flow.closed).toMatchObject({ status: 'rejected', reason: 'mount-invalidated' });
		expect(parent.style.display).toBe('flex');
		expect(parent.inert).toBe(false);
		expect(draft.value).toBe('synthetic-unsaved-input');
	});
	it('releases child ownership after returning so later disposal does not close the restored parent', async () => {
		const h = await setup();
		const flow = h.scope.sdk.host.open({ kind: 'settings', section: 'sync' }, { returnFocus: h.trigger });
		const parent = h.document.getElementById('settingsModal');
		await h.window.eval('openWebdavFromSettings()');
		h.window.eval('hideWebdavModal()');
		await vi.waitFor(() => expect(parent.style.visibility).toBe(''));
		h.scope.dispose();
		expect(await flow.closed).toMatchObject({ reason: 'mount-invalidated' });
		expect(parent.style.display).toBe('flex');
		expect(parent.inert).toBe(false);
	});
	it('releases a failed child load without converting subsequent observer disposal into a form dismissal', async () => {
		const h = await setup();
		h.window.loadModule = () => Promise.reject(new Error('synthetic module unavailable'));
		const flow = h.scope.sdk.host.open({ kind: 'settings', section: 'sync' }, { returnFocus: h.trigger });
		expect(await h.window.eval('openWebdavFromSettings()')).toMatchObject({ reason: 'module-unavailable' });
		h.scope.dispose();
		expect(await flow.closed).toMatchObject({ reason: 'mount-invalidated' });
		expect(h.document.getElementById('settingsModal').style.display).toBe('flex');
	});
	it.each(providers)(
		'keeps the sync flow through %s and returns to the same visible section without scrolling',
		async (name, id, close) => {
			const h = await setup();
			const closed = vi.fn();
			const flow = h.scope.sdk.host.open({ kind: 'settings', section: 'sync' }, { returnFocus: h.trigger });
			flow.closed.then(closed);
			const parent = h.document.getElementById('settingsModal');
			const button = parent.querySelector('[onclick="open' + name + 'FromSettings()"]');
			button.focus();
			const originalFocus = button.focus.bind(button);
			const restoration = [];
			const focus = vi.spyOn(button, 'focus').mockImplementation((options) => {
				restoration.push({ suspended: parent.hasAttribute(suspensionAttribute), visibility: parent.style.visibility });
				originalFocus(options);
			});
			expect(await h.window.eval('open' + name + 'FromSettings()')).toMatchObject({ status: 'opening' });
			expect(parent.style.visibility).toBe('hidden');
			expect(parent.hasAttribute(suspensionAttribute)).toBe(true);
			expect(h.document.getElementById(id).style.display).toBe('flex');
			await Promise.resolve();
			expect(closed).not.toHaveBeenCalled();
			h.window.eval(close + '()');
			await vi.waitFor(() => expect(parent.style.visibility).toBe(''));
			expect(parent.style.display).toBe('flex');
			expect(parent.querySelector('.settings-panel.active')?.dataset.panel).toBe('sync');
			expect(h.document.activeElement).toBe(button);
			expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
			expect(restoration.at(-1)).toEqual({ suspended: true, visibility: '' });
			expect(parent.hasAttribute(suspensionAttribute)).toBe(false);
			expect(closed).not.toHaveBeenCalled();
			h.window.eval('hideSettingsModal()');
			expect(await flow.closed).toMatchObject({ status: 'closed' });
			expect(h.document.activeElement).toBe(h.trigger);
		},
	);
	it.each(providers)('cannot open %s after the parent or app scope is replaced during module loading', async (name, id) => {
		const h = await setup();
		const loading = deferred();
		h.window.loadModule = vi.fn(() => loading.promise);
		h.scope.sdk.host.open({ kind: 'settings', section: 'sync' }, { returnFocus: h.trigger });
		const opening = h.window.eval('open' + name + 'FromSettings()');
		h.scope.dispose();
		const fresh = h.createScope({ isCurrent: () => true, identity: { packageId: 'c'.repeat(64) } });
		fresh.sdk.host.open({ kind: 'settings', section: 'preferences' }, { returnFocus: h.trigger });
		loading.resolve();
		expect(await opening).toMatchObject({ reason: 'mount-invalidated' });
		expect(h.document.getElementById(id).style.display).not.toBe('flex');
		expect(h.document.querySelector('#settingsModal .settings-panel.active')?.dataset.panel).toBe('preferences');
		fresh.dispose();
	});
	it.each(providers)('rejects %s when the session changes while loading and never reopens a dismissed parent', async (name, id) => {
		const h = await setup();
		const loading = deferred();
		h.window.loadModule = () => loading.promise;
		h.scope.sdk.host.open({ kind: 'settings', section: 'sync' }, { returnFocus: h.trigger });
		const opening = h.window.eval('open' + name + 'FromSettings()');
		h.invalidateSecretSession();
		h.scope.dispose();
		loading.resolve();
		expect(await opening).toMatchObject({ reason: 'mount-invalidated' });
		await vi.waitFor(() => expect(h.document.getElementById('settingsModal').style.display).toBe('none'));
		expect(h.document.getElementById(id).style.display).not.toBe('flex');
	});
	it.each(providers)('closes an owned %s child on scope disposal without an onClose resurrection', async (name, id, close) => {
		const h = await setup();
		h.scope.sdk.host.open({ kind: 'settings', section: 'sync' }, { returnFocus: h.trigger });
		await h.window.eval('open' + name + 'FromSettings()');
		h.scope.dispose();
		h.window.eval(close + '()');
		await vi.waitFor(() => expect(h.document.getElementById(id).style.display).toBe('none'));
		await vi.waitFor(() => expect(h.document.getElementById('settingsModal').style.display).toBe('none'));
	});
	it.each([
		['qr-decode', 'qrDecodeModal', 'hideQRDecodeModal'],
		['qr-generate', 'qrGenerateModal', 'hideQRGenerateModal'],
		['base32', 'base32Modal', 'hideBase32Modal'],
		['timestamp', 'timestampModal', 'hideTimestampModal'],
		['key-check', 'keyCheckModal', 'hideKeyCheckModal'],
		['key-generate', 'keyGeneratorModal', 'hideKeyGeneratorModal'],
	])('keeps the tools flow and returns the %s child to its visible trigger', async (kind, id, close) => {
		const h = await setup();
		const closed = vi.fn();
		const flow = h.scope.sdk.host.open({ kind: 'tools' }, { returnFocus: h.trigger });
		flow.closed.then(closed);
		const parent = h.document.getElementById('toolsModal');
		const button = [...parent.querySelectorAll('button')].find((node) => node.getAttribute('onclick') === `openToolsFromMenu('${kind}')`);
		button.focus();
		const originalFocus = button.focus.bind(button);
		const restoration = [];
		const focus = vi.spyOn(button, 'focus').mockImplementation((options) => {
			restoration.push({ suspended: parent.hasAttribute(suspensionAttribute), visibility: parent.style.visibility });
			originalFocus(options);
		});
		expect(await h.window.eval(`openToolsFromMenu('${kind}')`)).toMatchObject({ status: 'opening' });
		expect(h.document.getElementById(id).style.display).toBe('flex');
		expect(parent.style.visibility).toBe('hidden');
		expect(parent.hasAttribute(suspensionAttribute)).toBe(true);
		h.window.eval(close + '()');
		await vi.waitFor(() => expect(h.document.activeElement).toBe(button));
		expect(parent.style.visibility).toBe('');
		expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
		expect(restoration.at(-1)).toEqual({ suspended: true, visibility: '' });
		expect(parent.hasAttribute(suspensionAttribute)).toBe(false);
		expect(closed).not.toHaveBeenCalled();
	});
	it.each(['parent-close', 'scope-dispose', 'session-change'])('cleans its suspension on %s without reclaiming focus', async (action) => {
		const h = await setup();
		h.scope.sdk.host.open({ kind: 'tools' }, { returnFocus: h.trigger });
		const parent = h.document.getElementById('toolsModal');
		const button = parent.querySelector('.tool-item');
		button.focus();
		const focus = vi.spyOn(h.window, 'focusThemeHostControl');
		await h.window.eval("openToolsFromMenu('base32')");
		expect(parent.hasAttribute(suspensionAttribute)).toBe(true);
		if (action === 'parent-close') {
			h.window.eval('hideToolsModal()');
		}
		if (action === 'scope-dispose') {
			h.scope.dispose();
		}
		if (action === 'session-change') {
			h.invalidateSecretSession();
		}
		await vi.waitFor(() => expect(parent.hasAttribute(suspensionAttribute)).toBe(false));
		expect(focus.mock.calls.some(([target]) => target === button)).toBe(false);
		await vi.waitFor(() => expect(h.document.getElementById('base32Modal').style.display).toBe('none'));
	});
	it('clears suspension in finally when cancelling a child throws', async () => {
		const h = await setup();
		h.scope.sdk.host.open({ kind: 'tools' }, { returnFocus: h.trigger });
		const parent = h.document.getElementById('toolsModal');
		h.window.eval(
			"openThemeHostChild('toolsModal','base32Modal',()=>showBase32Modal(),()=>{throw new Error('synthetic close failure');},null)",
		);
		expect(parent.hasAttribute(suspensionAttribute)).toBe(true);
		expect(() => h.cancelThemeChild('base32Modal')).toThrow('synthetic close failure');
		expect(parent.hasAttribute(suspensionAttribute)).toBe(false);
		expect(parent.style.visibility).toBe('');
	});
	it('does not remove the marker of a new parent session opened synchronously during focus restoration', async () => {
		const h = await setup();
		h.scope.sdk.host.open({ kind: 'tools' }, { returnFocus: h.trigger });
		const parent = h.document.getElementById('toolsModal');
		const button = parent.querySelector('.tool-item');
		button.focus();
		const originalFocus = button.focus.bind(button);
		let reopened = false;
		vi.spyOn(button, 'focus').mockImplementation((options) => {
			originalFocus(options);
			if (!reopened && parent.style.visibility === '' && parent.hasAttribute(suspensionAttribute)) {
				reopened = true;
				h.window.eval(
					"hideToolsModal();showToolsModal();openThemeHostChild('toolsModal','timestampModal',()=>showTimestampModal(),()=>hideTimestampModal(),null)",
				);
			}
		});
		await h.window.eval("openToolsFromMenu('base32')");
		h.window.eval('hideBase32Modal()');
		await vi.waitFor(() => expect(h.document.getElementById('timestampModal').style.display).toBe('flex'));
		expect(parent.style.visibility).toBe('hidden');
		expect(parent.hasAttribute(suspensionAttribute)).toBe(true);
		h.window.eval('hideTimestampModal()');
		await vi.waitFor(() => expect(parent.hasAttribute(suspensionAttribute)).toBe(false));
		expect(parent.style.visibility).toBe('');
	});
	it('never leaves a suspension when opening a child fails before ownership', async () => {
		const h = await setup();
		h.scope.sdk.host.open({ kind: 'tools' }, { returnFocus: h.trigger });
		const parent = h.document.getElementById('toolsModal');
		expect(() =>
			h.window.eval("openThemeHostChild('toolsModal','base32Modal',()=>{throw new Error('synthetic open failure');},()=>{},null)"),
		).toThrow('synthetic open failure');
		expect(parent.hasAttribute(suspensionAttribute)).toBe(false);
		expect(parent.style.visibility).toBe('');
	});
	it('captures tool ownership before the lazy wrapper resolves', async () => {
		const h = await setup();
		const loading = deferred();
		h.window.loadModule = () => loading.promise;
		h.scope.sdk.host.open({ kind: 'tools' }, { returnFocus: h.trigger });
		const opening = h.window.eval("openToolsFromMenu('base32')");
		h.scope.dispose();
		loading.resolve();
		expect(await opening).toMatchObject({ reason: 'mount-invalidated' });
		expect(h.document.getElementById('base32Modal').style.display).not.toBe('flex');
	});
});
