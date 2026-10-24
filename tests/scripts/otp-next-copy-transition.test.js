import { describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { createAccountStore } from '../../src/ui/runtime/accountStore.js';
import { createAccountCommands } from '../../src/ui/runtime/accountCommands.js';
import { createAccountViewState } from '../../src/ui/runtime/accountViewState.js';
import { createThemeSdk } from '../../src/ui/runtime/themeSdk.js';
import { createOtpCalculator, createOtpEngine } from '../../src/ui/runtime/otpEngine.js';
import { getOTPPresentationCode } from '../../src/ui/scripts/otpPresentation.js';
import { createOfficialAccountView } from '../../src/ui/scripts/officialAccountView.js';
import { createBrowserClipboardPort } from '../../src/ui/scripts/browserClipboard.js';
import { createAccountRenderer } from '../../src/ui/themes/renderer.js';
import { filterAccountsByQuery } from '../../src/shared/search-filter.js';
import { groupSecretsByServiceFamily } from '../../src/shared/service-aggregation.js';

async function fixture() {
	const window = new Window();
	const document = window.document;
	document.body.innerHTML = '<div id="loading"></div><div id="secretsList"></div><div id="emptyState"></div>';
	const accounts = createAccountStore({
		records: [{ id: 'test', name: 'Test service', secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', type: 'TOTP', digits: 6, period: 30 }],
	});
	accounts.markAccessVerified();
	const clock = { now: () => 59000, getGeneration: () => 0, monotonicNow: () => 0 };
	const calculator = createOtpCalculator({ clock, crypto: window.crypto });
	const engine = createOtpEngine({ accounts, clock, calculator, timers: { setInterval: () => 0, clearInterval: () => {} } });
	await engine.refresh();
	// Exercise the actual presentation facade, including its engine-ticket validation.
	// eslint-disable-next-line no-new-func
	const presentation = new Function(
		'document',
		'window',
		'getOtpEngine',
		'getOTPAccountPort',
		'getCorrectedNowMs',
		'otpCalculator',
		't',
		getOTPPresentationCode() + ';return otpPresentation;',
	)(
		document,
		window,
		() => engine,
		() => accounts,
		clock.now,
		calculator,
		(key) => key,
	);
	const clipboard = { writeText: vi.fn(async () => {}) };
	const commands = createAccountCommands({
		accounts,
		otp: engine,
		clipboard: createBrowserClipboardPort({ navigator: { clipboard }, document }),
	});
	const view = createAccountViewState({ filterAccountsByQuery, groupSecretsByServiceFamily });
	view.setMode('flat');
	const runtime = createThemeSdk({
		accounts,
		otp: engine,
		commands,
		view,
		environment: { getSnapshot: () => ({ library: { state: 'ready' } }) },
		finishTransitionForCopy: (...args) => presentation.finishTransitionForCopy(...args),
	});
	const prepareCopy = vi.fn((target) => runtime.prepareCopy(target));
	const official = createOfficialAccountView({
		document,
		window,
		sdk: runtime.sdk,
		renderer: createAccountRenderer(),
		prepareCopy,
		resetPresentation: () => presentation.reset(),
		renderCommitted: (id) => presentation.renderCommitted(id, engine.readCommitted(id)),
	});
	return {
		window,
		document,
		engine,
		accounts,
		clipboard,
		runtime,
		prepareCopy,
		official,
		dispose() {
			official.dispose();
			presentation.dispose();
			runtime.dispose();
			engine.dispose();
			window.happyDOM.abort();
		},
	};
}

describe('official view on the shared runtime', () => {
	it('ends the visible transition and copies the committed next token in one click', async () => {
		const h = await fixture();
		const next = h.engine.readCommitted('test').next;
		h.document.getElementById('next-otp-test').textContent = '999999';
		const result = h.official.copy('test', 'next');
		expect(h.prepareCopy).toHaveBeenCalledTimes(1);
		expect(h.document.getElementById('next-otp-test').textContent).toBe(next);
		expect(h.clipboard.writeText).toHaveBeenCalledTimes(1);
		expect(h.clipboard.writeText).toHaveBeenCalledWith(next);
		expect(await result).toMatchObject({ clipboard: 'copied' });
		h.dispose();
	});
	it('keeps the grid marker and menus while OTP-only snapshots change', async () => {
		const h = await fixture();
		const container = h.document.getElementById('secretsList');
		expect(container.dataset.part).toBe('account-grid');
		h.official.toggleCardMenu('test');
		const card = container.firstElementChild;
		h.runtime.publish();
		expect(container.firstElementChild).toBe(card);
		expect(h.document.getElementById('menu-test').classList.contains('show')).toBe(true);
		h.runtime.sdk.view.setQuery('missing');
		expect(container.children.length).toBe(0);
		expect(container.dataset.part).toBe('account-grid');
		h.dispose();
	});
	it('does not depend on the official account DOM to copy through the same SDK', async () => {
		const h = await fixture();
		h.official.dispose();
		h.document.body.replaceChildren();
		expect(await h.official.copy('test')).toMatchObject({ reason: 'mount-invalidated' });
		expect(h.clipboard.writeText).not.toHaveBeenCalled();
		const target = h.runtime.sdk.otp.readCopyTarget('test', 'current').target;
		expect(await h.runtime.sdk.otp.copy(target)).toMatchObject({ clipboard: 'copied' });
		expect(h.clipboard.writeText).toHaveBeenCalledWith(h.engine.readCommitted('test').current);
		expect(h.document.querySelector('[id^="otp-"]')).toBeNull();
		h.dispose();
	});
});
