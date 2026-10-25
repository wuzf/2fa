import { afterEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { createOfficialAccountView } from '../../src/ui/scripts/officialAccountView.js';
import { createAccountRenderer } from '../../src/ui/themes/renderer.js';
import { createRuntimeFixture } from '../helpers/theme-runtime.js';

const fixtures = [];
afterEach(async () => {
	await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()));
});

function snapshot(name = 'Google') {
	return {
		session: { state: 'authenticated' },
		host: { operations: [] },
		library: {
			state: 'ready',
			accounts: [
				{
					ref: { id: 'first', generation: 1 },
					service: { label: name, iconURL: '/api/favicon/example.test' },
					accountLabel: '',
					type: 'TOTP',
					otp: {},
				},
			],
			view: { query: '', mode: 'flat', resultIds: ['first'], groups: [], services: [], total: 1, found: 1 },
		},
	};
}

function fixture({ gated = true } = {}) {
	const window = new Window();
	const { document } = window;
	document.body.innerHTML = '<div id="loading"></div><div id="emptyState"></div><div id="secretsList"><span data-original></span></div>';
	document.documentElement.setAttribute('data-app-theme-startup', 'pending');
	let current = snapshot();
	let listener;
	let tick;
	const sdk = {
		getSnapshot: () => current,
		subscribe: (next) => {
			listener = next;
			next(current);
			return vi.fn();
		},
	};
	const renderer = createAccountRenderer();
	vi.spyOn(renderer, 'card');
	vi.spyOn(renderer, 'bind');
	const ports = {
		document,
		window: {
			getComputedStyle: window.getComputedStyle.bind(window),
			setInterval: (callback) => {
				tick = callback;
				return 1;
			},
			clearInterval: vi.fn(),
		},
		sdk,
		renderer,
		updateControls: vi.fn(),
		renderCommitted: vi.fn(),
		renderProgress: vi.fn(),
		resetPresentation: vi.fn(),
		...(gated ? { shouldRender: () => !document.documentElement.hasAttribute('data-app-theme-startup') } : {}),
	};
	const view = createOfficialAccountView(ports);
	const result = {
		document,
		view,
		ports,
		renderer,
		tick: () => tick(),
		publish: (value) => {
			current = value;
			listener(value);
		},
		dispose: async () => {
			view.dispose();
			await window.happyDOM.abort();
		},
	};
	fixtures.push(result);
	return result;
}

describe('official account presentation gate', () => {
	it('does no hidden DOM, control, card, logo or progress work and renders the latest snapshot when opened', () => {
		const h = fixture();
		const pending = snapshot('New Google');
		pending.host.operations = [{ type: 'hotp', operationId: 'copy', accountId: 'first', clipboard: 'pending', reservation: 'confirmed' }];
		h.publish(pending);
		h.view.render();
		h.tick();
		expect(h.document.querySelector('[data-original]')).not.toBeNull();
		expect(h.document.querySelector('img')).toBeNull();
		expect(h.document.getElementById('officialHotpOperations')).toBeNull();
		expect(h.document.getElementById('secretsList').dataset.part).toBeUndefined();
		for (const call of [
			h.renderer.bind,
			h.renderer.card,
			h.ports.updateControls,
			h.ports.renderCommitted,
			h.ports.renderProgress,
			h.ports.resetPresentation,
		]) {
			expect(call).not.toHaveBeenCalled();
		}
		h.document.documentElement.removeAttribute('data-app-theme-startup');
		h.view.render();
		expect(h.document.querySelector('.secret-name').textContent).toBe('New Google');
		expect(h.document.getElementById('officialHotpOperations')).not.toBeNull();
		expect(h.document.querySelector('img').getAttribute('src')).toBe('/api/favicon/example.test');
		expect(h.renderer.bind).toHaveBeenCalledOnce();
		expect(h.renderer.card).toHaveBeenCalledOnce();
		expect(h.ports.updateControls).toHaveBeenCalledOnce();
		expect(h.ports.renderCommitted).toHaveBeenCalledOnce();
		expect(h.ports.renderProgress).toHaveBeenCalledOnce();
		h.view.render();
		expect(h.renderer.card).toHaveBeenCalledOnce();
	});

	it('does not advance the last rendered shape or timer work while the same view is concealed again', () => {
		const h = fixture();
		h.document.documentElement.removeAttribute('data-app-theme-startup');
		h.view.render();
		h.document.documentElement.setAttribute('data-app-theme-startup', 'managed');
		const progress = h.ports.renderProgress.mock.calls.length;
		h.publish(snapshot('Later Google'));
		h.tick();
		expect(h.renderer.card).toHaveBeenCalledOnce();
		expect(h.document.querySelector('.secret-name').textContent).toBe('Google');
		expect(h.ports.renderProgress).toHaveBeenCalledTimes(progress);
		h.document.documentElement.removeAttribute('data-app-theme-startup');
		h.view.render();
		expect(h.renderer.card).toHaveBeenCalledTimes(2);
		expect(h.document.querySelector('.secret-name').textContent).toBe('Later Google');
		h.view.dispose();
		const stopped = h.ports.renderProgress.mock.calls.length;
		h.tick();
		expect(h.ports.renderProgress).toHaveBeenCalledTimes(stopped);
	});

	it('preserves normal rendering when the optional presentation gate is omitted', () => {
		const h = fixture({ gated: false });
		expect(h.document.querySelector('.secret-name').textContent).toBe('Google');
		const progress = h.ports.renderProgress.mock.calls.length;
		h.tick();
		expect(h.ports.renderProgress).toHaveBeenCalledTimes(progress + 1);
	});

	it('wires the actual emitted page adapter to its startup marker without stopping the account model', async () => {
		const h = await createRuntimeFixture();
		fixtures.push(h);
		h.document.documentElement.setAttribute('data-app-theme-startup', 'pending');
		const runtime = h.getThemeRuntime();
		const view = h.getOfficialAccountView();
		h.replaceSecretRecords([{ id: 'a', name: 'Google', secret: 'JBSWY3DPEHPK3PXP', type: 'TOTP' }], {
			source: 'local',
			accessVerified: true,
		});
		expect(runtime.sdk.getSnapshot().library.accounts).toHaveLength(1);
		expect(h.document.querySelector('.secret-card')).toBeNull();
		h.document.documentElement.removeAttribute('data-app-theme-startup');
		view.render();
		expect(h.document.querySelector('.secret-name').textContent).toBe('Google');
	});
});
