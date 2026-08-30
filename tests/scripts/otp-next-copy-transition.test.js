import { describe, expect, it, vi } from 'vitest';

import { getCoreCode } from '../../src/ui/scripts/core.js';

function createHarness() {
	const nextOtpElement = { textContent: '370714' };
	const document = {
		addEventListener: vi.fn(),
		getElementById: vi.fn((id) => (id === 'next-otp-test' ? nextOtpElement : null)),
		querySelectorAll: vi.fn(() => []),
	};
	const window = { addEventListener: vi.fn() };
	const navigator = {
		clipboard: {
			writeText: vi.fn(async () => {}),
		},
	};
	const quietConsole = { error: vi.fn(), log: vi.fn(), warn: vi.fn() };

	// eslint-disable-next-line no-new-func
	const api = new Function(
		'document',
		'window',
		'navigator',
		'console',
		`
      let secrets = [{ id: 'test', name: 'Test service', digits: 6 }];
      let transitionActive = true;
      let transitionClearCount = 0;
      function isNextOTPTransitionActive() { return transitionActive; }
      function clearOTPAnimationTimer() {
        transitionActive = false;
        transitionClearCount += 1;
      }
      function showCenterToast() {}
      ${getCoreCode()}
      return {
        copyNextOTP,
        getTransitionClearCount() { return transitionClearCount; },
        setTransitionActive(value) { transitionActive = value; }
      };
    `,
	)(document, window, navigator, quietConsole);

	return { api, navigator };
}

describe('next OTP copy during promotion', () => {
	it('ends the visible transition and copies the committed next token in one click', async () => {
		const harness = createHarness();

		await harness.api.copyNextOTP('test');
		expect(harness.api.getTransitionClearCount()).toBe(1);
		expect(harness.navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
		expect(harness.navigator.clipboard.writeText).toHaveBeenCalledWith('370714');
	});
});
