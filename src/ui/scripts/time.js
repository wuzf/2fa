/**
 * Browser clock synchronization module.
 * Keeps TOTP generation aligned with the Worker clock without sending secrets.
 */

/**
 * Get the browser clock synchronization code.
 * @returns {string} Clock synchronization JavaScript code
 */
export function getTimeCode() {
	return `    // ========== Trusted clock synchronization ==========
    const CLOCK_SYNC_STORAGE_KEY = '2fa-clock-sync-v1';
    const CLOCK_SYNC_CACHE_VERSION = 2;
    const CLOCK_SYNC_SAMPLE_COUNT = 3;
    const CLOCK_SYNC_TIMEOUT_MS = 2500;
    const CLOCK_SYNC_MAX_RTT_MS = 2000;
    const CLOCK_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
    const CLOCK_SYNC_STALE_MS = 24 * 60 * 60 * 1000;
    const CLOCK_SYNC_SAMPLE_WALL_DRIFT_TOLERANCE_MS = 1000;
    const CLOCK_SYNC_CACHE_WALL_DRIFT_TOLERANCE_MS = 60 * 1000;
    const CLOCK_SYNC_MIN_SERVER_TIME_MS = Date.UTC(2000, 0, 1);
    const CLOCK_SYNC_MAX_SERVER_TIME_MS = Date.UTC(2100, 0, 1);

    class TrustedClock {
      constructor() {
        this.status = 'local';
        this.offsetMs = null;
        this.syncedAtServerMs = null;
        this.rttMs = null;
        this.anchorServerMs = null;
        this.anchorMonotonicMs = null;
        this.anchorLocalWallMs = null;
        this.localWallAtSyncMs = null;
        this.monotonicEpochAtSyncMs = null;
        this.generation = 0;
        this.syncPromise = null;
        this.syncAttemptId = 0;
        this.activeSampleControllers = new Set();
        this.started = false;
        this.hasSettledSync = false;
        this.loadCachedOffset();
      }

      monotonicNow() {
        return performance.now();
      }

      monotonicEpochNow() {
        if (!Number.isFinite(performance.timeOrigin)) return null;
        return performance.timeOrigin + this.monotonicNow();
      }

      now() {
        if (Number.isFinite(this.anchorServerMs) && Number.isFinite(this.anchorMonotonicMs)) {
          return this.anchorServerMs + (this.monotonicNow() - this.anchorMonotonicMs);
        }
        return Date.now();
      }

      establishAnchor(serverTimeMs, monotonicTimeMs = this.monotonicNow(), localWallTimeMs = Date.now()) {
        this.anchorServerMs = serverTimeMs;
        this.anchorMonotonicMs = monotonicTimeMs;
        this.anchorLocalWallMs = localWallTimeMs;
      }

      isValidServerTime(value) {
        return Number.isFinite(value) && value >= CLOCK_SYNC_MIN_SERVER_TIME_MS && value < CLOCK_SYNC_MAX_SERVER_TIME_MS;
      }

      loadCachedOffset() {
        if (typeof localStorage === 'undefined') return;

        try {
          const raw = localStorage.getItem(CLOCK_SYNC_STORAGE_KEY);
          if (!raw) return;

          const cached = JSON.parse(raw);
          if (
            cached.version !== CLOCK_SYNC_CACHE_VERSION ||
            !Number.isFinite(cached.offsetMs) ||
            !this.isValidServerTime(cached.syncedAtServerMs) ||
            !this.isValidServerTime(cached.localWallAtSyncMs) ||
            !this.isValidServerTime(cached.monotonicEpochAtSyncMs)
          ) {
            localStorage.removeItem(CLOCK_SYNC_STORAGE_KEY);
            return;
          }

          const monotonicEpochNow = this.monotonicEpochNow();
          const wallElapsedMs = Date.now() - cached.localWallAtSyncMs;
          const monotonicElapsedMs = Number.isFinite(monotonicEpochNow)
            ? monotonicEpochNow - cached.monotonicEpochAtSyncMs
            : null;
          if (
            !Number.isFinite(monotonicElapsedMs) ||
            Math.abs(wallElapsedMs - monotonicElapsedMs) > CLOCK_SYNC_CACHE_WALL_DRIFT_TOLERANCE_MS
          ) {
            localStorage.removeItem(CLOCK_SYNC_STORAGE_KEY);
            return;
          }

          const estimatedServerNow = Date.now() + cached.offsetMs;
          if (!this.isValidServerTime(estimatedServerNow) || estimatedServerNow - cached.syncedAtServerMs < -5 * 60 * 1000) {
            localStorage.removeItem(CLOCK_SYNC_STORAGE_KEY);
            return;
          }

          this.offsetMs = cached.offsetMs;
          this.syncedAtServerMs = cached.syncedAtServerMs;
          this.rttMs = Number.isFinite(cached.rttMs) ? cached.rttMs : null;
          this.localWallAtSyncMs = cached.localWallAtSyncMs;
          this.monotonicEpochAtSyncMs = cached.monotonicEpochAtSyncMs;
          this.establishAnchor(estimatedServerNow);
          this.status = 'cached';
          this.generation += 1;
        } catch (error) {
          console.warn('读取时间校准缓存失败:', error);
          try {
            localStorage.removeItem(CLOCK_SYNC_STORAGE_KEY);
          } catch {
            // Storage may be unavailable in restricted browsing modes.
          }
        }
      }

      persistOffset() {
        if (
          typeof localStorage === 'undefined' ||
          !Number.isFinite(this.offsetMs) ||
          !this.isValidServerTime(this.syncedAtServerMs) ||
          !this.isValidServerTime(this.localWallAtSyncMs) ||
          !this.isValidServerTime(this.monotonicEpochAtSyncMs)
        ) {
          return;
        }

        try {
          localStorage.setItem(CLOCK_SYNC_STORAGE_KEY, JSON.stringify({
            version: CLOCK_SYNC_CACHE_VERSION,
            offsetMs: this.offsetMs,
            syncedAtServerMs: this.syncedAtServerMs,
            rttMs: this.rttMs,
            localWallAtSyncMs: this.localWallAtSyncMs,
            monotonicEpochAtSyncMs: this.monotonicEpochAtSyncMs
          }));
        } catch (error) {
          console.warn('保存时间校准缓存失败:', error);
        }
      }

      async takeSample() {
        const controller = new AbortController();
        this.activeSampleControllers.add(controller);
        const timeoutId = setTimeout(() => controller.abort(), CLOCK_SYNC_TIMEOUT_MS);
        const wallStartMs = Date.now();
        const monotonicStartMs = this.monotonicNow();

        try {
          const response = await fetch('/api/time', {
            method: 'GET',
            cache: 'no-store',
            credentials: 'same-origin',
            signal: controller.signal
          });

          if (!response.ok) {
            throw new Error('时间接口返回状态 ' + response.status);
          }
          const data = await response.json();
          const monotonicEndMs = this.monotonicNow();
          const wallEndMs = Date.now();
          const rttMs = monotonicEndMs - monotonicStartMs;
          const wallElapsedMs = wallEndMs - wallStartMs;

          if (!Number.isFinite(rttMs) || rttMs < 0 || rttMs > CLOCK_SYNC_MAX_RTT_MS) {
            throw new Error('时间同步网络延迟过高');
          }
          if (
            !Number.isFinite(wallElapsedMs) ||
            wallElapsedMs < 0 ||
            Math.abs(wallElapsedMs - rttMs) > CLOCK_SYNC_SAMPLE_WALL_DRIFT_TOLERANCE_MS
          ) {
            throw new Error('时间同步期间设备时钟发生跳变');
          }

          if (!data || !this.isValidServerTime(data.serverTimeMs)) {
            throw new Error('时间接口返回了无效时间');
          }

          const localMidpointMs = wallStartMs + rttMs / 2;
          return {
            rttMs,
            offsetMs: data.serverTimeMs - localMidpointMs,
            serverAtReceiveMs: data.serverTimeMs + rttMs / 2,
            monotonicAtReceiveMs: monotonicEndMs,
            localWallAtReceiveMs: wallEndMs
          };
        } finally {
          clearTimeout(timeoutId);
          this.activeSampleControllers.delete(controller);
        }
      }

      abortActiveSamples() {
        this.activeSampleControllers.forEach(controller => controller.abort());
      }

      isSampleCurrent(sample, wallNowMs, monotonicNowMs) {
        const wallElapsedMs = wallNowMs - sample.localWallAtReceiveMs;
        const monotonicElapsedMs = monotonicNowMs - sample.monotonicAtReceiveMs;
        return (
          Number.isFinite(wallElapsedMs) &&
          Number.isFinite(monotonicElapsedMs) &&
          monotonicElapsedMs >= 0 &&
          Math.abs(wallElapsedMs - monotonicElapsedMs) <= CLOCK_SYNC_SAMPLE_WALL_DRIFT_TOLERANCE_MS
        );
      }

      async performSync(attemptId) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          this.markSyncFailure();
          return false;
        }

        const results = await Promise.allSettled(
          Array.from({ length: CLOCK_SYNC_SAMPLE_COUNT }, () => this.takeSample())
        );

        if (attemptId !== this.syncAttemptId) return false;

        const wallNowMs = Date.now();
        const monotonicNowMs = this.monotonicNow();
        const samples = results
          .filter(result => result.status === 'fulfilled')
          .map(result => result.value)
          .filter(sample => this.isSampleCurrent(sample, wallNowMs, monotonicNowMs))
          .sort((a, b) => a.rttMs - b.rttMs);

        if (samples.length === 0) {
          this.markSyncFailure();
          return false;
        }

        const best = samples[0];
        this.offsetMs = best.offsetMs;
        this.rttMs = best.rttMs;
        this.establishAnchor(best.serverAtReceiveMs, best.monotonicAtReceiveMs, best.localWallAtReceiveMs);
        this.syncedAtServerMs = this.now();
        this.localWallAtSyncMs = Date.now();
        this.monotonicEpochAtSyncMs = this.monotonicEpochNow();
        this.status = 'synced';
        this.hasSettledSync = true;
        this.generation += 1;
        this.persistOffset();
        this.renderStatus();
        refreshTOTPsAfterClockChange();
        return true;
      }

      markSyncFailure() {
        this.hasSettledSync = true;
        this.status = Number.isFinite(this.offsetMs) ? 'cached' : 'local';
        this.renderStatus();
      }

      hasClockDiscontinuity() {
        if (!Number.isFinite(this.anchorLocalWallMs) || !Number.isFinite(this.anchorMonotonicMs)) return false;
        const wallElapsedMs = Date.now() - this.anchorLocalWallMs;
        const monotonicElapsedMs = this.monotonicNow() - this.anchorMonotonicMs;
        return Math.abs(wallElapsedMs - monotonicElapsedMs) > CLOCK_SYNC_SAMPLE_WALL_DRIFT_TOLERANCE_MS;
      }

      recoverFromClockDiscontinuity() {
        if (!this.hasClockDiscontinuity()) return false;

        if (Number.isFinite(this.offsetMs)) {
          this.establishAnchor(Date.now() + this.offsetMs);
          this.status = 'cached';
        } else {
          this.anchorServerMs = null;
          this.anchorMonotonicMs = null;
          this.anchorLocalWallMs = null;
          this.status = 'local';
        }
        this.generation += 1;
        this.renderStatus();
        refreshTOTPsAfterClockChange();
        return true;
      }

      sync() {
        if (this.syncPromise) return this.syncPromise;

        const attemptId = ++this.syncAttemptId;
        const task = this.performSync(attemptId).catch(error => {
          if (attemptId !== this.syncAttemptId) return false;
          console.warn('时间校准失败:', error);
          this.markSyncFailure();
          return false;
        });

        this.syncPromise = task.finally(() => {
          this.syncPromise = null;
          this.renderStatus();
        });
        this.renderStatus();
        return this.syncPromise;
      }

      async ensureReady() {
        if (this.status === 'cached') {
          this.sync();
          return true;
        }
        if (this.status === 'synced') return true;
        return this.sync();
      }

      async handleResume() {
        const interruptedSync = this.syncPromise;
        this.recoverFromClockDiscontinuity();
        if (interruptedSync) {
          this.syncAttemptId += 1;
          this.abortActiveSamples();
          await interruptedSync;
        }

        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          this.markSyncFailure();
          return false;
        }
        return this.sync();
      }

      getCacheAgeMs() {
        if (!this.isValidServerTime(this.syncedAtServerMs)) return null;
        return Math.max(0, this.now() - this.syncedAtServerMs);
      }

      formatAge(ageMs) {
        if (!Number.isFinite(ageMs) || ageMs < 60 * 1000) return '刚刚';
        if (ageMs < 60 * 60 * 1000) return Math.floor(ageMs / (60 * 1000)) + ' 分钟前';
        if (ageMs < 24 * 60 * 60 * 1000) return Math.floor(ageMs / (60 * 60 * 1000)) + ' 小时前';
        return Math.floor(ageMs / (24 * 60 * 60 * 1000)) + ' 天前';
      }

      renderStatus() {
        if (typeof document === 'undefined') return;
        const warning = document.getElementById('clockWarning');
        const text = document.getElementById('clockWarningText');
        const retryButton = document.getElementById('clockSyncRetryButton');
        if (!warning || !text) return;

        const ageMs = this.getCacheAgeMs();
        const isStale = Number.isFinite(ageMs) && ageMs > CLOCK_SYNC_STALE_MS;
        let message = '';

        // 首次校准落地前不提示：页面刚加载时缓存偏移已生效但校准仍在进行，
        // 此时提示会在校准成功后立即消失，表现为刷新时的一次闪烁。
        if (!this.hasSettledSync) {
          message = '';
        } else if (this.status === 'local') {
          message = '无法校准服务器时间，OTP 正在使用设备时间，可能不正确。';
        } else if (this.status === 'cached') {
          const ageText = this.formatAge(ageMs);
          message = isStale
            ? '正在使用 ' + ageText + ' 的时间校准缓存，OTP 可能不准确。'
            : '正在使用上次时间校准（' + ageText + '）。如设备时间已调整，OTP 可能不准确；联网后将自动更新。';
        } else if (isStale) {
          message = '服务器时间已超过 24 小时未校准，OTP 可能不准确。';
        }

        warning.hidden = !message;
        warning.classList.toggle('show', Boolean(message));
        text.textContent = message;
        if (retryButton) retryButton.disabled = Boolean(this.syncPromise);
      }

      start() {
        if (this.started) return;
        this.started = true;
        this.renderStatus();

        if (typeof window !== 'undefined') {
          window.addEventListener('online', () => this.handleResume());
          window.addEventListener('offline', () => this.markSyncFailure());
          window.addEventListener('pageshow', event => {
            if (event.persisted) this.handleResume();
          });
          window.setInterval(() => {
            this.renderStatus();
            const isVisible = typeof document === 'undefined' || !document.hidden;
            const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
            if (isVisible && isOnline) this.sync();
          }, CLOCK_SYNC_INTERVAL_MS);
        }

        if (typeof document !== 'undefined') {
          document.addEventListener('visibilitychange', () => {
            if (!document.hidden) this.handleResume();
          });
        }

        this.sync();
      }
    }

    const trustedClock = new TrustedClock();

    function getCorrectedNowMs() {
      return trustedClock.now();
    }

    function getTrustedClockGeneration() {
      return trustedClock.generation;
    }

    function initializeTrustedClock() {
      trustedClock.start();
    }

    function ensureServerTimeSynchronized() {
      return trustedClock.ensureReady();
    }

    function syncServerTime() {
      return trustedClock.sync();
    }

    async function retryClockSync() {
      const success = await trustedClock.sync();
      if (typeof showCenterToast === 'function') {
        showCenterToast(success ? '✓' : '!', success ? '时间校准成功' : '时间校准失败，请检查网络连接');
      }
      return success;
    }

    function refreshTOTPsAfterClockChange() {
      if (typeof otpCalculator !== 'undefined' && typeof otpCalculator.clearCache === 'function') {
        otpCalculator.clearCache();
      }
      if (typeof secrets === 'undefined' || !Array.isArray(secrets) || typeof updateOTP !== 'function') return;

      secrets.forEach(secret => {
        if (secret.type && secret.type.toUpperCase() === 'HOTP') return;
        updateOTP(secret.id);
        if (typeof updateCountdown === 'function') updateCountdown(secret.id);
      });
    }

`;
}
