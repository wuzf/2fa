/** Small standalone controller; no account store or secret is embedded in the page. */
export function getQuickOtpScript({ isHOTP, period, remainingTime, validUntil, followingToken }) {
	return `
    const tokenEl = document.getElementById('token');
    const tokenValue = document.getElementById('tokenValue');
    const nextEl = document.getElementById('nextToken');
    const nextValue = document.getElementById('nextTokenValue');
    const copiedEl = document.getElementById('copied');
    let copyMessageTimer = null;
    let copyRequest = 0;

    async function copyCode(next = false) {
      ${isHOTP ? '' : 'updateCountdown();'}
      const button = next ? nextEl : tokenEl;
      const value = next ? nextValue : tokenValue;
      if (!button || button.disabled || !/^([0-9]{6}|[0-9]{8})$/.test(value.textContent)) return;
      const request = ++copyRequest;
      if (copyMessageTimer !== null) clearTimeout(copyMessageTimer);
      try {
        await navigator.clipboard.writeText(value.textContent);
        if (request !== copyRequest) return;
        copiedEl.classList.remove('error');
        copiedEl.textContent = next ? '下一个验证码已复制' : '验证码已复制';
      } catch {
        if (request !== copyRequest) return;
        copiedEl.classList.add('error');
        copiedEl.textContent = '复制失败，请检查剪贴板权限';
      }
      copyMessageTimer = setTimeout(function () {
        copiedEl.classList.remove('error');
        copiedEl.textContent = '点击验证码即可复制';
        copyMessageTimer = null;
      }, 2000);
    }
    tokenEl.addEventListener('click', () => copyCode());
    if (nextEl) nextEl.addEventListener('click', () => copyCode(true));
    ${
			isHOTP
				? ''
				: `
    const period = ${period};
    const duration = period * 1000;
    const digits = tokenValue.textContent.length;
    const progress = document.getElementById('progress');
    const countdown = document.getElementById('countdown');
    const refreshMessage = document.getElementById('refreshMessage');
    const retry = document.getElementById('retry');
    let current = tokenValue.textContent;
    let upcoming = nextValue.textContent;
    let following = ${JSON.stringify(followingToken || '')};
    let windowEnd = ${validUntil};
    // A response's server timestamp falls between request start and receipt.
    // Disable copying at the earliest possible expiry, and promote both buffered
    // codes at the latest possible boundary. Keep the display stable in between;
    // network uncertainty must not clear the digits during a normal handoff.
    const navigationStart = performance.getEntriesByType?.('navigation')?.[0]?.requestStart || 0;
    let safeUntil = navigationStart + ${remainingTime} * 1000;
    let rolloverAt = performance.now() + ${remainingTime} * 1000;
    let inFlight = false;
    let retryAt = 0;
    let failed = false;
    let clockGeneration = 0;
    let activeController = null;
    let lastWallTime = Date.now();
    let lastMonotonicTime = performance.now();

    function invalidateTime() {
      current = '';
      upcoming = '';
      following = '';
      windowEnd = 0;
      clockGeneration++;
      retryAt = 0;
      if (activeController) activeController.abort();
    }

    function setCode(button, value, code, label, canCopy = !!code) {
      const display = code || '------';
      if (value.textContent !== display) value.textContent = display;
      button.disabled = !canCopy;
      button.setAttribute('aria-busy', String(!canCopy));
      button.setAttribute('aria-label', canCopy ? label : '正在更新验证码');
    }

    function updateCountdown() {
      const now = performance.now();
      const wallNow = Date.now();
      // Some platforms pause performance.now() during system sleep. A wall
      // clock jump also invalidates our estimate; fetch server time again.
      if (Math.abs((wallNow - lastWallTime) - (now - lastMonotonicTime)) > 1000) {
        invalidateTime();
      }
      lastWallTime = wallNow;
      lastMonotonicTime = now;
      if (now >= rolloverAt) {
        if (upcoming && now < safeUntil + duration) {
          current = upcoming;
          upcoming = following;
          following = '';
          safeUntil += duration;
          rolloverAt += duration;
          windowEnd += duration;
        } else {
          current = '';
          upcoming = '';
          following = '';
        }
      }
      const valid = now >= rolloverAt - duration && now < safeUntil && !!current;
      const handoff = now >= safeUntil && now < rolloverAt && !!current && !!upcoming;
      const remaining = valid ? Math.max(0, safeUntil - now) : 0;
      setCode(tokenEl, tokenValue, valid || handoff ? current : '', '复制当前验证码', valid);
      setCode(nextEl, nextValue, valid || handoff ? upcoming : '', '复制下一个验证码', valid && !!upcoming);
      progress.style.transform = 'scaleX(' + Math.min(1, remaining / duration) + ')';
      progress.setAttribute('aria-valuenow', String(Math.round(Math.min(1, remaining / duration) * 100)));
      countdown.textContent = valid ? Math.ceil(remaining / 1000) + ' 秒后更新' : handoff ? '正在切换' : '正在更新';
      if ((!current || !upcoming || !following || (failed && !valid)) && !document.hidden && !inFlight && now >= retryAt) void refreshCodes();
    }

    async function refreshCodes() {
      if (inFlight) return;
      inFlight = true;
      retry.disabled = true;
      const start = performance.now();
      const wallStart = Date.now();
      const generation = clockGeneration;
      const controller = new AbortController();
      activeController = controller;
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const url = new URL(location.href);
        url.searchParams.set('format', 'json');
        url.searchParams.set('preview', '1');
        const response = await fetch(url.href, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Refresh failed');
        const data = await response.json();
        const received = performance.now();
        const codeValid = (code) => typeof code === 'string' && code.length === digits && /^[0-9]+$/.test(code);
        if (controller.signal.aborted || generation !== clockGeneration ||
            Math.abs((Date.now() - wallStart) - (received - start)) > 1000 ||
            !codeValid(data.token) || !codeValid(data.nextToken) || !codeValid(data.followingToken) ||
            data.period !== period || !Number.isFinite(data.validUntil) || !Number.isFinite(data.serverTime) ||
            data.validUntil < windowEnd || data.validUntil - data.serverTime > duration) {
          throw new Error('Invalid preview response');
        }
        const delta = data.validUntil - data.serverTime;
        if (start + delta <= received) throw new Error('Expired preview response');
        current = data.token;
        upcoming = data.nextToken;
        following = data.followingToken;
        windowEnd = data.validUntil;
        safeUntil = start + delta;
        rolloverAt = received + delta;
        failed = false;
        refreshMessage.textContent = '';
        retry.hidden = true;
      } catch {
        if (generation === clockGeneration) {
          failed = true;
          refreshMessage.textContent = '暂时无法更新，请检查网络后重试';
          retry.hidden = false;
        }
      } finally {
        clearTimeout(timeout);
        inFlight = false;
        activeController = null;
        retry.disabled = false;
        retryAt = generation !== clockGeneration ? 0 : performance.now() + (failed ? 3000 : 250);
        updateCountdown();
      }
    }

    retry.addEventListener('click', () => { retryAt = 0; void refreshCodes(); });
    setInterval(() => { if (!document.hidden) updateCountdown(); }, 250);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { invalidateTime(); updateCountdown(); }
    });
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) { invalidateTime(); updateCountdown(); }
    });
    window.addEventListener('online', () => { retryAt = 0; updateCountdown(); });
    updateCountdown();
    // A slow navigation can deliver a complete buffer after its safe window.
    // Recalibrate immediately instead of waiting for the initial upper bound.
    if (!inFlight && performance.now() >= safeUntil) void refreshCodes();`
		}
  `;
}
