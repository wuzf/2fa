/** Official DOM presentation; never the authority for copy or OTP validity. */
export function getOTPPresentationCode() {
	return `
    // 保存每个验证码节点最近一次成功提交的窗口，避免首次加载或重复刷新时误触发动效
    const otpTransitionStates = new WeakMap();
    const otpAnimationTimers = new WeakMap();
    const activeOTPAnimationRecords = new Set();
    // 动画会暂时让 flyer 展示旧的“下一个”验证码，而 DOM 已提交新值。
    // 明确记录这一过渡期，供复制逻辑阻止复制与画面不一致的隐藏值。
    const activeOTPNextTransitions = new WeakMap();
    // 同一帧内完成的多个交接统一读取布局、再一起写入 class，避免卡片之间出现明显时差
    const queuedOTPAnimationJobs = new Set();
    const otpQueuedAnimationJobs = new WeakMap();
    const OTP_ANIMATION_STORAGE_KEY = '2fa-otp-animation';
    const OTP_ANIMATION_DEFAULT = 'none';
    const OTP_ANIMATION_STYLE_PROPERTIES = Object.freeze([
      'fontFamily',
      'fontSize',
      'fontWeight',
      'fontVariantNumeric',
      'letterSpacing',
      'lineHeight',
      'color'
    ]);
    const OTP_ANIMATION_CONFIG = Object.freeze({
      flow: Object.freeze({
        currentClass: 'otp-promote-current',
        nextClass: 'otp-promote-next',
        duration: 420,
        flyerClass: 'otp-promotion-flyer-active',
        flyerStyle: 'target',
        needsTargetGeometry: true,
        usesTravelPath: true
      }),
      flip: Object.freeze({
        currentClass: 'otp-promote-flip-current',
        nextClass: 'otp-promote-flip-next',
        duration: 520,
        flyerClass: 'otp-promotion-flyer-flip',
        flyerStyle: 'source',
        needsTargetGeometry: false,
        usesTravelPath: false
      }),
      spotlight: Object.freeze({
        currentClass: 'otp-promote-spotlight-current',
        nextClass: 'otp-promote-spotlight-next',
        duration: 460,
        flyerClass: 'otp-promotion-flyer-spotlight',
        flyerStyle: 'source',
        needsTargetGeometry: false,
        usesTravelPath: false
      }),
      none: null
    });
    const OTP_ANIMATION_ALIASES = Object.freeze({ fade: 'spotlight' });
    let otpAnimationMode = OTP_ANIMATION_DEFAULT;
    let otpAnimationReadFrameId = null;
    let otpAnimationReadFrameScheduled = false;

    function normalizeOTPAnimationMode(mode) {
      const normalizedMode = typeof mode === 'string' ? mode.trim().toLowerCase() : '';
      const canonicalMode = OTP_ANIMATION_ALIASES[normalizedMode] || normalizedMode;
      return Object.prototype.hasOwnProperty.call(OTP_ANIMATION_CONFIG, canonicalMode)
        ? canonicalMode
        : OTP_ANIMATION_DEFAULT;
    }

    try {
      otpAnimationMode = normalizeOTPAnimationMode(localStorage.getItem(OTP_ANIMATION_STORAGE_KEY));
    } catch {
      // localStorage 不可用时保留本次会话内的默认动效
    }

    function getOTPAnimationMode() {
      return otpAnimationMode;
    }

    function setOTPAnimationMode(mode) {
      const nextMode = normalizeOTPAnimationMode(mode);
      otpAnimationMode = nextMode;

      try {
        localStorage.setItem(OTP_ANIMATION_STORAGE_KEY, nextMode);
      } catch {
        // localStorage 不可用时仍让选择在本次会话生效
      }

      // 用户切换设置时立即停止排队中或仍在播放的旧动效
      clearAllOTPAnimations();
      return nextMode;
    }

    function prefersReducedOTPMotion() {
      try {
        return !!(
          typeof window !== 'undefined' &&
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches
        );
      } catch {
        return false;
      }
    }

    function canAnimateOTPElement(element) {
      const hasAnimationAPI = !!(
        element &&
        element.parentElement &&
        element.classList &&
        typeof element.classList.add === 'function' &&
        typeof element.classList.remove === 'function'
      );
      if (!hasAnimationAPI) return false;
      // DOM 重绘后旧节点可能仍被异步结果引用；不要给脱离文档的节点加动画
      return !('isConnected' in element) || element.isConnected;
    }

    function isValidOTPAnimationToken(token, digits) {
      const expectedLength = Number(digits) || 6;
      return !!(
        typeof token === 'string' &&
        token.length === expectedLength &&
        /^[0-9]+$/.test(token)
      );
    }

    function isOTPAnimationDocumentVisible() {
      return typeof document === 'undefined' || document.hidden !== true;
    }

    function isOTPElementInViewport(element) {
      if (!isOTPAnimationDocumentVisible() || !element || typeof element.getBoundingClientRect !== 'function') {
        return false;
      }

      try {
        const rect = element.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return false;

        const documentElement = typeof document !== 'undefined' ? document.documentElement : null;
        const viewportWidth = typeof window !== 'undefined' && Number.isFinite(window.innerWidth)
          ? window.innerWidth
          : (documentElement && documentElement.clientWidth) || 0;
        const viewportHeight = typeof window !== 'undefined' && Number.isFinite(window.innerHeight)
          ? window.innerHeight
          : (documentElement && documentElement.clientHeight) || 0;
        if (viewportWidth <= 0 || viewportHeight <= 0) return true;

        const right = Number.isFinite(rect.right) ? rect.right : rect.left + rect.width;
        const bottom = Number.isFinite(rect.bottom) ? rect.bottom : rect.top + rect.height;
        return right > 0 && bottom > 0 && rect.left < viewportWidth && rect.top < viewportHeight;
      } catch {
        return false;
      }
    }

    function requestOTPAnimationFrame(callback) {
      if (
        typeof window !== 'undefined' &&
        typeof window.requestAnimationFrame === 'function'
      ) {
        return window.requestAnimationFrame(callback);
      }

      // 非浏览器或测试环境没有布局帧，直接执行以保持功能可用
      callback();
      return null;
    }

    function cancelOTPAnimationFrame(frameId) {
      if (
        frameId !== null &&
        typeof window !== 'undefined' &&
        typeof window.cancelAnimationFrame === 'function'
      ) {
        window.cancelAnimationFrame(frameId);
      }
    }

    function detachQueuedOTPAnimationJob(animationJob) {
      if (!animationJob) return;
      queuedOTPAnimationJobs.delete(animationJob);
      (animationJob.elements || []).forEach(element => {
        if (otpQueuedAnimationJobs.get(element) === animationJob) {
          otpQueuedAnimationJobs.delete(element);
        }
      });
    }

    function markOTPNextTransitionActive(animationJob) {
      if (animationJob && animationJob.nextOtpElement) {
        activeOTPNextTransitions.set(animationJob.nextOtpElement, animationJob);
      }
    }

    function clearOTPNextTransition(animationJob) {
      if (
        animationJob &&
        animationJob.nextOtpElement &&
        activeOTPNextTransitions.get(animationJob.nextOtpElement) === animationJob
      ) {
        activeOTPNextTransitions.delete(animationJob.nextOtpElement);
      }
    }

    function isNextOTPTransitionActive(secretId) {
      if (typeof document === 'undefined') return false;
      const nextOtpElement = document.getElementById('next-otp-' + secretId);
      return !!(nextOtpElement && activeOTPNextTransitions.has(nextOtpElement));
    }

    function removeQueuedOTPAnimationJob(animationJob) {
      if (!animationJob || animationJob.cancelled) return;
      animationJob.cancelled = true;
      detachQueuedOTPAnimationJob(animationJob);
      clearOTPNextTransition(animationJob);
      if (queuedOTPAnimationJobs.size === 0 && otpAnimationReadFrameScheduled) {
        cancelOTPAnimationFrame(otpAnimationReadFrameId);
        otpAnimationReadFrameId = null;
        otpAnimationReadFrameScheduled = false;
      }
    }

    function clearOTPAnimationTimer(element) {
      if (!element) return;

      const queuedJob = otpQueuedAnimationJobs.get(element);
      if (queuedJob) removeQueuedOTPAnimationJob(queuedJob);

      const animationRecord = otpAnimationTimers.get(element);
      if (animationRecord) clearOTPAnimationRecord(animationRecord);
    }

    function clearAllOTPAnimations() {
      cancelOTPAnimationFrame(otpAnimationReadFrameId);
      otpAnimationReadFrameId = null;
      otpAnimationReadFrameScheduled = false;

      [...queuedOTPAnimationJobs].forEach(job => removeQueuedOTPAnimationJob(job));
      [...activeOTPAnimationRecords].forEach(record => clearOTPAnimationRecord(record));
    }

    function handleOTPVisibilityChange() {
      if (document.hidden) clearAllOTPAnimations();
    }
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', handleOTPVisibilityChange);
    }

    function clearOTPAnimationRecord(animationRecord) {
      if (!animationRecord || animationRecord.cleared) return;
      animationRecord.cleared = true;

      if (
        animationRecord.timerId !== null &&
        typeof animationRecord.timerId !== 'undefined' &&
        typeof clearTimeout === 'function'
      ) {
        clearTimeout(animationRecord.timerId);
      }

      animationRecord.entries.forEach(({ element, className }) => {
        removeOTPAnimationClass(element, className);
        if (otpAnimationTimers.get(element) === animationRecord) {
          otpAnimationTimers.delete(element);
        }
      });
      clearOTPNextTransition(animationRecord.animationJob);
      removeOTPPromotionFlyer(animationRecord.flyer);
      activeOTPAnimationRecords.delete(animationRecord);
    }

    function removeOTPAnimationClass(element, className) {
      if (!element || !element.classList || typeof element.classList.remove !== 'function') return;

      try {
        element.classList.remove(className);
      } catch {
        // 某些测试或嵌入环境可能提供不完整的 classList，实现上忽略清理失败
      }
    }

    function removeOTPPromotionFlyer(flyer) {
      if (!flyer) return;

      try {
        if (typeof flyer.remove === 'function') {
          flyer.remove();
        } else if (flyer.parentNode && typeof flyer.parentNode.removeChild === 'function') {
          flyer.parentNode.removeChild(flyer);
        }
      } catch {
        // 动画层已脱离文档时忽略清理异常
      }
    }

    function getOTPTextRect(element) {
      if (!element || typeof element.getBoundingClientRect !== 'function') return null;

      try {
        if (typeof document !== 'undefined' && typeof document.createRange === 'function' && element.firstChild) {
          const range = document.createRange();
          range.selectNodeContents(element);
          const textRect = range.getBoundingClientRect();
          if (textRect && textRect.width > 0 && textRect.height > 0) {
            return textRect;
          }
        }
      } catch {
        // 非浏览器 DOM 或文本节点不可测量时回退到元素盒模型
      }

      try {
        const elementRect = element.getBoundingClientRect();
        if (elementRect && elementRect.width > 0 && elementRect.height > 0) {
          return elementRect;
        }
      } catch {
        // 某些嵌入环境不提供布局信息
      }

      return null;
    }

    function getOTPAnimationStyleSnapshot(element) {
      if (typeof getComputedStyle !== 'function') return null;

      try {
        const computedStyle = getComputedStyle(element);
        const styleSnapshot = {};
        OTP_ANIMATION_STYLE_PROPERTIES.forEach(property => {
          if (computedStyle[property]) {
            styleSnapshot[property] = computedStyle[property];
          }
        });
        return styleSnapshot;
      } catch {
        return null;
      }
    }

    function captureOTPPromotionGeometry(otpElement, nextOtpElement, animationConfig) {
      const sourceRect = getOTPTextRect(nextOtpElement);
      const targetRect = animationConfig.needsTargetGeometry ? getOTPTextRect(otpElement) : null;
      if (!sourceRect || (animationConfig.needsTargetGeometry && !targetRect)) return null;

      const sourceCenterX = sourceRect.left + sourceRect.width / 2;
      const sourceCenterY = sourceRect.top + sourceRect.height / 2;
      const targetCenterX = targetRect ? targetRect.left + targetRect.width / 2 : sourceCenterX;
      const targetCenterY = targetRect ? targetRect.top + targetRect.height / 2 : sourceCenterY;
      const startScale = targetRect && targetRect.width > 0
        ? Math.min(1, Math.max(0.35, sourceRect.width / targetRect.width))
        : 1;

      const currentStyle = animationConfig.flyerStyle === 'target'
        ? getOTPAnimationStyleSnapshot(otpElement)
        : null;
      const sourceStyle = animationConfig.flyerStyle === 'source'
        ? getOTPAnimationStyleSnapshot(nextOtpElement)
        : null;

      return {
        sourceCenterX,
        sourceCenterY,
        deltaX: targetCenterX - sourceCenterX,
        deltaY: targetCenterY - sourceCenterY,
        startScale,
        currentStyle,
        sourceStyle
      };
    }

    function createOTPPromotionFlyer(
      token,
      geometry,
      styleType = 'target',
      usesTravelPath = true
    ) {
      if (
        !geometry ||
        typeof document === 'undefined' ||
        !document.body ||
        typeof document.createElement !== 'function'
      ) {
        return null;
      }

      let flyer = null;
      try {
        flyer = document.createElement('span');
        flyer.className = 'otp-promotion-flyer';
        flyer.textContent = token;
        if (typeof flyer.setAttribute === 'function') {
          flyer.setAttribute('aria-hidden', 'true');
        }

        if (flyer.style) {
          flyer.style.left = geometry.sourceCenterX + 'px';
          flyer.style.top = geometry.sourceCenterY + 'px';
          flyer.style.position = 'fixed';
          flyer.style.pointerEvents = 'none';
          flyer.style.userSelect = 'none';
          if (usesTravelPath) {
            flyer.style.setProperty('--otp-fly-x', geometry.deltaX + 'px');
            flyer.style.setProperty('--otp-fly-y', geometry.deltaY + 'px');
            flyer.style.setProperty('--otp-fly-start-scale', String(geometry.startScale));
          }

          const animationStyle = styleType === 'source' ? geometry.sourceStyle : geometry.currentStyle;
          if (animationStyle) {
            OTP_ANIMATION_STYLE_PROPERTIES.forEach(property => {
              if (animationStyle[property]) {
                flyer.style[property] = animationStyle[property];
              }
            });
          }
        }

        document.body.appendChild(flyer);
        if (!flyer.classList || typeof flyer.classList.add !== 'function') {
          removeOTPPromotionFlyer(flyer);
          return null;
        }
        return flyer;
      } catch {
        removeOTPPromotionFlyer(flyer);
        return null;
      }
    }

    function isOTPAnimationJobCurrent(animationJob) {
      if (
        !animationJob ||
        animationJob.cancelled ||
        getOTPAnimationMode() !== animationJob.animationMode ||
        (!animationJob.isHOTP && getTrustedClockGeneration() !== animationJob.clockGeneration) ||
        !canAnimateOTPElement(animationJob.otpElement) ||
        !canAnimateOTPElement(animationJob.nextOtpElement) ||
        animationJob.otpElement.textContent !== animationJob.currentToken ||
        animationJob.nextOtpElement.textContent !== animationJob.nextToken ||
        otpCalculator.getCurrentTimeWindow(animationJob.period) !== animationJob.window
      ) {
        return false;
      }

      const transitionState = otpTransitionStates.get(animationJob.otpElement);
      return !!(
        transitionState &&
        transitionState.window === animationJob.window &&
        transitionState.period === animationJob.period &&
        transitionState.nextToken === animationJob.nextToken
      );
    }

    // 在同一个布局帧中先读取所有卡片几何，再统一添加 class，保证交接起始时间一致
    function startOTPPromotionAnimation(animationJob, geometry) {
      const animationConfig = OTP_ANIMATION_CONFIG[animationJob.animationMode];
      if (!animationConfig || !geometry || !isOTPAnimationJobCurrent(animationJob)) {
        clearOTPNextTransition(animationJob);
        return;
      }

      const entries = [
        { element: animationJob.otpElement, className: animationConfig.currentClass },
        { element: animationJob.nextOtpElement, className: animationConfig.nextClass }
      ];

      const flyer = createOTPPromotionFlyer(
        animationJob.previousNextToken,
        geometry,
        animationConfig.flyerStyle,
        animationConfig.usesTravelPath
      );
      if (!flyer) {
        clearOTPNextTransition(animationJob);
        return;
      }

      try {
        entries.forEach(({ element, className }) => element.classList.add(className));
        flyer.classList.add(animationConfig.flyerClass);
        markOTPNextTransitionActive(animationJob);
      } catch {
        entries.forEach(({ element, className }) => removeOTPAnimationClass(element, className));
        removeOTPPromotionFlyer(flyer);
        clearOTPNextTransition(animationJob);
        return;
      }

      if (typeof setTimeout !== 'function') {
        entries.forEach(({ element, className }) => removeOTPAnimationClass(element, className));
        removeOTPPromotionFlyer(flyer);
        clearOTPNextTransition(animationJob);
        return;
      }

      const animationRecord = { timerId: null, flyer, entries, animationJob, cleared: false };
      entries.forEach(({ element }) => otpAnimationTimers.set(element, animationRecord));
      activeOTPAnimationRecords.add(animationRecord);
      try {
        animationRecord.timerId = setTimeout(
          () => clearOTPAnimationRecord(animationRecord),
          animationConfig.duration
        );
      } catch {
        clearOTPAnimationRecord(animationRecord);
      }
    }

    function flushQueuedOTPAnimations() {
      otpAnimationReadFrameId = null;
      otpAnimationReadFrameScheduled = false;
      const animationJobs = [...queuedOTPAnimationJobs].filter(
        job => !job.animationBatch || job.animationBatch.released
      );
      animationJobs.forEach(job => detachQueuedOTPAnimationJob(job));

      if (!isOTPAnimationDocumentVisible() || prefersReducedOTPMotion()) {
        animationJobs.forEach(job => {
          job.cancelled = true;
          clearOTPNextTransition(job);
        });
        return;
      }

      const preparedJobs = [];
      const visibleJobs = [];
      animationJobs.forEach(animationJob => {
        if (!isOTPAnimationJobCurrent(animationJob)) {
          animationJob.cancelled = true;
          clearOTPNextTransition(animationJob);
          return;
        }

        if (!isOTPElementInViewport(animationJob.otpElement) &&
            !isOTPElementInViewport(animationJob.nextOtpElement)) {
          animationJob.cancelled = true;
          clearOTPNextTransition(animationJob);
          return;
        }

        visibleJobs.push(animationJob);
      });

      // 先统一移除旧状态，再集中读取几何，最后统一写入动画 class，避免交替触发布局刷新。
      visibleJobs.forEach(animationJob => {
        const animationConfig = OTP_ANIMATION_CONFIG[animationJob.animationMode];
        clearOTPAnimationTimer(animationJob.otpElement);
        clearOTPAnimationTimer(animationJob.nextOtpElement);
        removeOTPAnimationClass(animationJob.otpElement, animationConfig.currentClass);
        removeOTPAnimationClass(animationJob.nextOtpElement, animationConfig.nextClass);
      });

      visibleJobs.forEach(animationJob => {

        const animationConfig = OTP_ANIMATION_CONFIG[animationJob.animationMode];
        const geometry = captureOTPPromotionGeometry(
          animationJob.otpElement,
          animationJob.nextOtpElement,
          animationConfig
        );
        if (geometry) {
          preparedJobs.push({ animationJob, geometry });
        } else {
          animationJob.cancelled = true;
          clearOTPNextTransition(animationJob);
        }
      });

      // 所有几何读取完成后再统一写入 DOM，避免多卡片之间交替触发布局刷新
      preparedJobs.forEach(({ animationJob, geometry }) => {
        startOTPPromotionAnimation(animationJob, geometry);
      });
    }

    function scheduleQueuedOTPAnimationFlush() {
      if (otpAnimationReadFrameScheduled) return;
      otpAnimationReadFrameScheduled = true;
      const frameId = requestOTPAnimationFrame(flushQueuedOTPAnimations);
      if (otpAnimationReadFrameScheduled) {
        otpAnimationReadFrameId = frameId;
      }
    }

    function queueOTPPromotionAnimation(animationJob, animationBatch = null) {
      clearOTPAnimationTimer(animationJob.otpElement);
      clearOTPAnimationTimer(animationJob.nextOtpElement);
      animationJob.cancelled = false;
      animationJob.animationBatch = animationBatch;
      animationJob.elements = [animationJob.otpElement, animationJob.nextOtpElement];
      animationJob.elements.forEach(element => otpQueuedAnimationJobs.set(element, animationJob));
      queuedOTPAnimationJobs.add(animationJob);
      if (!animationBatch || animationBatch.released) {
        scheduleQueuedOTPAnimationFlush();
      }
    }


    function renderCommittedOTP(secretId, record, { animate = false, animationBatch = null } = {}) {
      if (!record || typeof document === 'undefined') return;
      const otpElement = document.getElementById('otp-' + secretId);
      const nextOtpElement = document.getElementById('next-otp-' + secretId);
      const previous = otpElement ? otpTransitionStates.get(otpElement) : null;
      const previousCurrentToken = otpElement ? otpElement.textContent : null;
      const previousNextToken = nextOtpElement ? nextOtpElement.textContent : null;
      const isHOTP = record.kind === 'HOTP';
      const preserves = previous && previous.window === record.window &&
        previous.period === record.period && previous.clockGeneration === record.clockGeneration &&
        previousCurrentToken === record.current && previousNextToken === record.next;
      const promotion = animate && !isHOTP && previous &&
        previous.window === record.window - 1 && previous.period === record.period &&
        previous.nextToken === previousNextToken && previousNextToken === record.current &&
        isValidOTPAnimationToken(previousNextToken, record.digits) &&
        isValidOTPAnimationToken(record.current, record.digits) &&
        isValidOTPAnimationToken(record.next, record.digits);
      if (!preserves) {
        clearOTPAnimationTimer(otpElement);
        clearOTPAnimationTimer(nextOtpElement);
      }
      if (otpElement) otpElement.textContent = record.current;
      if (nextOtpElement) nextOtpElement.textContent = record.next;
      if (!isHOTP && otpElement && nextOtpElement) {
        otpTransitionStates.set(otpElement, { window: record.window, period: record.period,
          clockGeneration: record.clockGeneration, nextToken: record.next });
        const animationMode = getOTPAnimationMode();
        if (promotion && animationMode !== 'none' && isOTPAnimationDocumentVisible() && !prefersReducedOTPMotion()) {
          queueOTPPromotionAnimation({ otpElement, nextOtpElement, previousNextToken, animationMode,
            currentToken: record.current, nextToken: record.next, window: record.window,
            period: record.period, clockGeneration: record.clockGeneration, isHOTP: false }, animationBatch);
        }
      }
      const counterElement = document.getElementById('counter-' + secretId);
      if (isHOTP && counterElement) counterElement.textContent =
        (typeof t === 'function' ? t('counterLabel') : 'Counter: ') + record.counter;
      updateCountdown(secretId);
    }

    function presentOTPFrame(frame) {
      const animationBatch = { released: false };
      frame.changes.forEach(change => {
        if (change.after) {
          renderCommittedOTP(change.id, change.after, { animate: true, animationBatch });
        } else if (!change.invalidateOnly && typeof document !== 'undefined') {
          ['otp-', 'next-otp-'].forEach(prefix => {
            const element = document.getElementById(prefix + change.id);
            clearOTPAnimationTimer(element);
            if (element) element.textContent = '-'.repeat(change.digits || change.before?.digits || 6);
          });
        }
      });
      animationBatch.released = true;
      if ([...queuedOTPAnimationJobs].some(job => job.animationBatch === animationBatch)) scheduleQueuedOTPAnimationFlush();
    }

    // End the visible handoff synchronously. The caller can initiate native
    // clipboard I/O in the same user-activation stack using this exact ticket.
    function finishOTPTransitionForCopy(secretId, slot, target) {
      const engine = getOtpEngine();
      if (engine.validateCopyTarget(target).status !== 'ready' || String(target.accountId) !== String(secretId) || target.slot !== slot) return false;
      if (typeof document !== 'undefined') {
        clearOTPAnimationTimer(document.getElementById('otp-' + secretId));
        clearOTPAnimationTimer(document.getElementById('next-otp-' + secretId));
        renderCommittedOTP(secretId, engine.readCommitted(secretId));
      }
      return engine.validateCopyTarget(target).status === 'ready';
    }

    function startOTPInterval(secretId) {
      getOtpEngine().activate(secretId);
      const secret = getOTPAccountPort().getRecord(secretId);
      if (Object.prototype.hasOwnProperty.call(otpIntervals, String(secretId))) {
        clearInterval(otpIntervals[secretId]);
        delete otpIntervals[secretId];
      }
      if (!secret || String(secret.type || 'TOTP').toUpperCase() === 'HOTP') return;
      otpIntervals[secretId] = setInterval(() => updateCountdown(secretId), 1000);
      updateCountdown(secretId);
    }

    function updateCountdown(secretId) {
      if (typeof document === 'undefined' || document.hidden) return;
      const secret = getOTPAccountPort().getRecord(secretId);
      if (!secret || String(secret.type || 'TOTP').toUpperCase() === 'HOTP') return;
      const timeStep = secret.period || 30;
      const element = document.getElementById('progress-' + secretId);
      if (element) element.style.width = (otpCalculator.getRemainingTime(timeStep) / timeStep * 100) + '%';
    }

    function disposeOTPPresentation() {
      clearAllOTPAnimations();
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', handleOTPVisibilityChange);
      }
      if (typeof otpIntervals !== 'undefined') Object.keys(otpIntervals).forEach(id => {
        clearInterval(otpIntervals[id]);
        delete otpIntervals[id];
      });
    }

    const otpPresentation = Object.freeze({
      present: presentOTPFrame,
      renderCommitted: renderCommittedOTP,
      finishTransitionForCopy: finishOTPTransitionForCopy,
      reset: clearAllOTPAnimations,
      dispose: disposeOTPPresentation
    });

`;
}
