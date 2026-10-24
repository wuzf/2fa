/** OTP runtime assembly: one algorithm, one authoritative engine, one optional DOM adapter. */
import { createOtpCalculator, createOtpEngine } from '../runtime/otpEngine.js';
import { serializeBrowserFunction } from './browserSource.js';
import { getOTPPresentationCode } from './otpPresentation.js';

export function getOTPCode() {
	return `
    const otpCalculator = (${serializeBrowserFunction(createOtpCalculator)})({
      clock: { now: () => getCorrectedNowMs() },
      crypto: typeof window === 'undefined' ? globalThis.crypto : window.crypto,
      cacheNow: () => Date.now(), diagnostics: console
    });
    let otpEngineInstance = null;
    function getOTPAccountPort() { return accountStore; }
    function getOtpEngine() {
      if (!otpEngineInstance) {
        otpEngineInstance = (${serializeBrowserFunction(createOtpEngine)})({
          accounts: getOTPAccountPort(),
          clock: { now: () => getCorrectedNowMs(), getGeneration: () => getTrustedClockGeneration(),
            monotonicNow: () => getTrustedMonotonicNowMs() },
          calculator: otpCalculator,
          timers: { setInterval: (callback, delay) => setInterval(callback, delay), clearInterval: id => clearInterval(id) },
          diagnostics: console
        });
        otpEngineInstance.subscribeCommits(frame => otpPresentation.present(frame));
      }
      return otpEngineInstance;
    }
    function getCommittedHOTPToken(secretId, expected = null) {
      const current = getOTPAccountPort().getRecord(secretId);
      if (expected && (!current || expected.secret !== current.secret ||
        (expected.counter ?? 0) !== (current.counter ?? 0) ||
        (expected.hotpCounterNamespace || null) !== (current.hotpCounterNamespace || null) ||
        (Number(expected.digits) || 6) !== (Number(current.digits) || 6) ||
        String(expected.algorithm || 'SHA1').toUpperCase() !== String(current.algorithm || 'SHA1').toUpperCase())) return null;
      const record = getOtpEngine().readCommitted(secretId);
      return record && record.kind === 'HOTP' ? record.current : null;
    }
    function getCommittedOTPWindow(secretId, period, clockGeneration = getTrustedClockGeneration(), digits = 6) {
      const record = getOtpEngine().readCommitted(secretId);
      return record && record.kind === 'TOTP' && record.period === period &&
        record.clockGeneration === clockGeneration && record.digits === (Number(digits) || 6) ? record.window : null;
    }
    function updateOTP(secretId, batch = null) {
      const engine = getOtpEngine();
      otpPresentation.renderCommitted(secretId, engine.readCommitted(secretId));
      return engine.refreshOne(secretId, { batch });
    }
    function updateOTPSecretsInBatch(secretList, { includeHOTP = false } = {}) {
      const ids = (Array.isArray(secretList) ? secretList : []).filter(secret =>
        includeHOTP || String(secret.type || 'TOTP').toUpperCase() !== 'HOTP').map(secret => secret.id);
      return getOtpEngine().refresh(ids);
    }
    function createOTPAnimationBatch() { return getOtpEngine().createBatch(); }
    function sealOTPAnimationBatch(batch) { getOtpEngine().sealBatch(batch); }
    function clearOTPWindowScheduler() { if (otpEngineInstance) otpEngineInstance.suspend(); }
    function stopOTPWindowScheduler() { clearOTPWindowScheduler(); }
    function isOTPWindowScheduled(secretId) { return getOtpEngine().isScheduled(secretId); }
    function invalidateOTPWindowSchedulerForClockChange() { return getOtpEngine().clockChanged(); }
    function calculateNextOTP(secret) { return otpCalculator.calculateNextOTP(secret); }
    ${getOTPPresentationCode()}
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      // beforeunload is cancellable. A BFCache page keeps the same engine and
      // observers, but pauses its scheduler and clears transient presentation.
      window.addEventListener('pagehide', event => {
        if (event.persisted) {
          if (otpEngineInstance) otpEngineInstance.suspend();
          otpPresentation.reset('pagehide');
        } else {
          if (otpEngineInstance) otpEngineInstance.dispose();
          otpPresentation.dispose();
        }
      });
      window.addEventListener('pageshow', event => {
        if (!event.persisted) return;
        if (otpEngineInstance) otpEngineInstance.resume('pageshow');
        if (typeof notifyThemeRuntimeEnvironment === 'function') notifyThemeRuntimeEnvironment('pageshow');
      });
    }
`;
}
