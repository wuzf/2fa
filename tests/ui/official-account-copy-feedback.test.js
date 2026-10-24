import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeFixture } from '../helpers/theme-runtime.js';

const fixtures = [];
afterEach(async () => {
	await Promise.all(fixtures.splice(0).map((item) => item.dispose()));
});
const settle = async () => {
	for (let i = 0; i < 20; i += 1) {
		await Promise.resolve();
	}
};
async function fixture(writeText = async () => {}) {
	const clipboard = { writeText: vi.fn(writeText) };
	const h = await createRuntimeFixture({ clipboard });
	fixtures.push(h);
	h.setClock(59000);
	h.getThemeRuntime();
	h.replaceSecretRecords([{ id: 'a', name: 'Google', account: 'person@example.test', secret: 'JBSWY3DPEHPK3PXP', type: 'TOTP' }], {
		source: 'server',
		accessVerified: true,
	});
	h.getOfficialAccountView();
	const toast = vi.fn();
	h.window.showCenterToast = toast;
	return { ...h, clipboard, toast };
}

describe('official account menu copy feedback', () => {
	it.each([
		['uri', 'otpauth://totp/', 'authenticator URI'],
		['link', 'https://vault.test/otp/', 'code link'],
	])('copies %s once from an actual menu click and shows the original success message', async (action, prefix, label) => {
		const h = await fixture();
		h.document.querySelector('[data-account-action="' + action + '"]').click();
		expect(h.clipboard.writeText).toHaveBeenCalledTimes(1);
		expect(h.clipboard.writeText.mock.calls[0][0]).toContain(prefix);
		await settle();
		expect(h.toast).toHaveBeenCalledTimes(1);
		expect(h.toast.mock.calls[0][1]).toContain('Google ' + label + ' copied');
	});
	it('reports clipboard failure instead of successful URI copying', async () => {
		const h = await fixture(async () => {
			throw new Error('denied');
		});
		h.document.execCommand = () => false;
		h.document.querySelector('[data-account-action="uri"]').click();
		await settle();
		expect(h.toast).toHaveBeenCalledWith('❌', expect.stringContaining('Could not copy authenticator URI'));
	});
	it('suppresses late copy feedback after logout', async () => {
		let copied;
		const h = await fixture(
			() =>
				new Promise((resolve) => {
					copied = resolve;
				}),
		);
		h.document.querySelector('[data-account-action="link"]').click();
		h.invalidateSecretSession();
		copied();
		await settle();
		expect(h.toast).not.toHaveBeenCalled();
	});
});
