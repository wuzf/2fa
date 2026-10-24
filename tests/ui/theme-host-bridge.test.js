import { describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { getHostFlowsCode } from '../../src/ui/scripts/ui.js';
import { createHostFlows } from '../../src/ui/runtime/hostFlows.js';

function fixture(loadModule) {
	const window = new Window();
	const { document } = window;
	document.body.innerHTML = '<button id="trigger">open</button><div id="settingsModal" class="modal" style="display:none"></div>';
	// eslint-disable-next-line no-new-func
	const bridge = new Function(
		'document',
		'window',
		'MutationObserver',
		'loadModule',
		`${getHostFlowsCode()}; return {openThemeHostDialog,getThemeHostHandlers};`,
	)(document, window, window.MutationObserver, loadModule);
	return { window, document, ...bridge };
}
const settle = async () => {
	for (let i = 0; i < 10; i += 1) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
};

describe('real host dialog lifecycle bridge', () => {
	it('revokes the observer on SDK disposal without pretending the open dialog or operation was cancelled', async () => {
		const h = fixture();
		const modal = h.document.getElementById('settingsModal');
		const host = createHostFlows({
			handlers: {
				settings: (_, context) =>
					h.openThemeHostDialog(
						'settingsModal',
						() => {
							modal.style.display = 'flex';
						},
						context,
					),
			},
		});
		const handle = host.open({ kind: 'settings' });
		await settle();
		host.dispose();
		expect(await handle.closed).toMatchObject({ status: 'rejected', reason: 'mount-invalidated' });
		expect(modal.style.display).toBe('flex');
		h.window.happyDOM.abort();
	});

	it('waits for an actual dialog close, distinguishes closure from save, and returns focus', async () => {
		const h = fixture();
		const trigger = h.document.getElementById('trigger');
		const modal = h.document.getElementById('settingsModal');
		const host = createHostFlows({
			handlers: {
				settings: (_, context) =>
					h.openThemeHostDialog(
						'settingsModal',
						() => {
							modal.style.display = 'flex';
						},
						context,
					),
			},
			getActiveElement: () => trigger,
			restoreFocus: (element) => element.focus(),
		});
		const handle = host.open({ kind: 'settings' });
		const closed = vi.fn();
		handle.closed.then(closed);
		await settle();
		expect(closed).not.toHaveBeenCalled();
		modal.style.display = 'none';
		await settle();
		expect(await handle.closed).toEqual({ status: 'closed' });
		expect(h.document.activeElement).toBe(trigger);
		h.window.happyDOM.abort();
	});
	it('rechecks the request after module loading and never opens a stale account dialog', async () => {
		let loaded;
		const load = vi.fn(
			() =>
				new Promise((resolve) => {
					loaded = resolve;
				}),
		);
		const h = fixture(load);
		let current = true;
		const open = vi.fn();
		const operation = h.openThemeHostDialog('settingsModal', open, { isCurrent: () => current }, 'tools');
		current = false;
		loaded();
		expect(await operation).toEqual({ status: 'session-invalidated' });
		expect(open).not.toHaveBeenCalled();
		h.window.happyDOM.abort();
	});
	it('reports missing dialogs and rejected lazy modules without successful empty handles', async () => {
		const h = fixture();
		const handle = h.openThemeHostDialog('absent', () => {}, { isCurrent: () => true });
		expect(await handle.closed).toMatchObject({ status: 'rejected', reason: 'dialog-unavailable' });
		const failed = fixture(() => Promise.reject(new Error('build mismatch')));
		const host = createHostFlows({
			handlers: { tools: (_, context) => failed.openThemeHostDialog('settingsModal', () => {}, context, 'tools') },
		});
		expect(await host.open({ kind: 'tools' }).closed).toMatchObject({ status: 'rejected', reason: 'flow-failed' });
		h.window.happyDOM.abort();
		failed.window.happyDOM.abort();
	});
});
