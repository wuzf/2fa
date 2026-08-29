/**
 * OTP 计算模块
 * 包含 TOTP/HOTP 算法实现和相关辅助函数
 */

/**
 * 获取 OTP 计算相关代码
 * @returns {string} OTP JavaScript 代码
 */
export function getOTPCode() {
	return `    // ========== OTP 计算模块 ==========

    // OTP计算核心类
    class OTPCalculator {
      constructor() {
        this.cache = new Map(); // 缓存计算结果
        this.cacheTimeout = 1000; // 缓存1秒
      }

      // 获取当前时间窗口
      getCurrentTimeWindow(period = 30) {
        const currentTime = Math.floor(getCorrectedNowMs() / 1000);
        return Math.floor(currentTime / period);
      }

      // 获取下一个时间窗口
      getNextTimeWindow(period = 30) {
        return this.getCurrentTimeWindow(period) + 1;
      }

      // 获取剩余时间
      getRemainingTime(period = 30) {
        const currentTime = Math.floor(getCorrectedNowMs() / 1000);
        const currentWindow = this.getCurrentTimeWindow(period);
        const nextRefresh = (currentWindow + 1) * period;
        return Math.max(0, nextRefresh - currentTime);
      }

      // 生成缓存键
      getCacheKey(secret, counter, options) {
        return secret + '_' + counter + '_' + options.digits + '_' + options.algorithm;
      }

      // 检查缓存
      getCachedResult(cacheKey) {
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
          return cached.value;
        }
        return null;
      }

      // 设置缓存
      setCachedResult(cacheKey, value) {
        this.cache.set(cacheKey, {
          value,
          timestamp: Date.now()
        });
      }

      clearCache() {
        this.cache.clear();
      }

      // 计算当前OTP
      async calculateCurrentOTP(secret) {
        const timeWindow = this.getCurrentTimeWindow(secret.period || 30);
        const options = {
          digits: secret.digits || 6,
          algorithm: secret.algorithm || 'SHA1'
        };

        const cacheKey = this.getCacheKey(secret.secret, timeWindow, options);
        const cached = this.getCachedResult(cacheKey);
        if (cached) {
          return cached;
        }

        try {
          const token = await this.generateTOTP(secret.secret, timeWindow, options);
          this.setCachedResult(cacheKey, token);
          return token;
        } catch (error) {
          console.error('计算当前OTP失败:', error);
          return '------';
        }
      }

      // 计算下一个OTP
      async calculateNextOTP(secret) {
        const timeWindow = this.getNextTimeWindow(secret.period || 30);
        const options = {
          digits: secret.digits || 6,
          algorithm: secret.algorithm || 'SHA1'
        };

        const cacheKey = this.getCacheKey(secret.secret, timeWindow, options);
        const cached = this.getCachedResult(cacheKey);
        if (cached) {
          return cached;
        }

        try {
          const token = await this.generateTOTP(secret.secret, timeWindow, options);
          this.setCachedResult(cacheKey, token);
          return token;
        } catch (error) {
          console.error('计算下一个OTP失败:', error);
          return '------';
        }
      }

      // 生成TOTP（统一入口）
      async generateTOTP(secret, counter, options = {}) {
        try {
          // 检查crypto.subtle支持
          if (!window.crypto || !window.crypto.subtle) {
            console.warn('crypto.subtle not supported, using fallback');
            return this.generateTOTPFallback(secret, counter, options);
          }

          // 映射算法名称
          const hashAlgMap = {
            'SHA1': 'SHA-1',
            'SHA-1': 'SHA-1',
            'SHA256': 'SHA-256',
            'SHA-256': 'SHA-256',
            'SHA512': 'SHA-512',
            'SHA-512': 'SHA-512'
          };

          const hashAlg = hashAlgMap[options.algorithm?.toUpperCase()] || 'SHA-1';
          const key = this.base32Decode(secret);
          const counterBytes = new ArrayBuffer(8);
          const counterView = new DataView(counterBytes);
          counterView.setUint32(4, counter, false);

          return crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: hashAlg }, false, ['sign'])
            .then(cryptoKey => crypto.subtle.sign('HMAC', cryptoKey, counterBytes))
            .then(signature => {
              const hmac = new Uint8Array(signature);
              const offset = hmac[hmac.length - 1] & 0x0f;
              const binary = ((hmac[offset] & 0x7f) << 24) |
                            ((hmac[offset + 1] & 0xff) << 16) |
                            ((hmac[offset + 2] & 0xff) << 8) |
                            (hmac[offset + 3] & 0xff);
              const modulus = Math.pow(10, options.digits || 6);
              const otp = binary % modulus;
              return otp.toString().padStart(options.digits || 6, '0');
            }).catch(error => {
              console.warn('crypto.subtle failed, using fallback:', error);
              return this.generateTOTPFallback(secret, counter, options);
            });
        } catch (error) {
          console.warn('TOTP generation error, using fallback:', error);
          return this.generateTOTPFallback(secret, counter, options);
        }
      }

      // 备用TOTP生成函数（纯JavaScript实现）
      generateTOTPFallback(secret, counter, options = {}) {
        try {
          const digits = options.digits || 6;
          const algorithm = options.algorithm || 'SHA1';

          // 使用纯JavaScript的HMAC实现
          const key = this.base32Decode(secret);
          const counterBytes = new ArrayBuffer(8);
          const counterView = new DataView(counterBytes);
          counterView.setUint32(4, counter, false);

          // 简化的HMAC-SHA1实现
          const hmac = this.simpleHMAC(key, new Uint8Array(counterBytes), algorithm);
          const offset = hmac[hmac.length - 1] & 0x0f;
          const binary = ((hmac[offset] & 0x7f) << 24) |
                        ((hmac[offset + 1] & 0xff) << 16) |
                        ((hmac[offset + 2] & 0xff) << 8) |
                        (hmac[offset + 3] & 0xff);
          const modulus = Math.pow(10, digits);
          const otp = binary % modulus;
          return otp.toString().padStart(digits, '0');
        } catch (error) {
          console.error('Fallback TOTP generation error:', error);
          return '-'.repeat(options.digits || 6);
        }
      }

      // 简化的HMAC实现
      simpleHMAC(key, message, algorithm) {
        // 这是一个简化的实现，仅用于SHA1
        const blockSize = 64;
        const keyBytes = new Uint8Array(key);
        let keyArray = new Uint8Array(blockSize);

        if (keyBytes.length > blockSize) {
          // 简化处理：直接截断
          keyArray.set(keyBytes.slice(0, blockSize));
        } else {
          keyArray.set(keyBytes);
        }

        // 创建ipad和opad
        const ipad = new Uint8Array(blockSize);
        const opad = new Uint8Array(blockSize);

        for (let i = 0; i < blockSize; i++) {
          ipad[i] = keyArray[i] ^ 0x36;
          opad[i] = keyArray[i] ^ 0x5c;
        }

        // 创建消息
        const innerMessage = new Uint8Array(blockSize + message.length);
        innerMessage.set(ipad);
        innerMessage.set(message, blockSize);

        // 使用简化的SHA1实现
        const hash1 = this.simpleSHA1(innerMessage);
        const outerMessage = new Uint8Array(blockSize + 20);
        outerMessage.set(opad);
        outerMessage.set(hash1, blockSize);
        return this.simpleSHA1(outerMessage);
      }

      // 简化的SHA1实现
      simpleSHA1(message) {
        const msg = new Uint8Array(message);
        const msgLength = msg.length;
        const bitLength = msgLength * 8;

        // 添加填充
        const paddedLength = Math.ceil((msgLength + 9) / 64) * 64;
        const padded = new Uint8Array(paddedLength);
        padded.set(msg);
        padded[msgLength] = 0x80;

        // 添加长度（64位）
        const lengthBytes = new ArrayBuffer(8);
        const lengthView = new DataView(lengthBytes);
        lengthView.setUint32(0, Math.floor(bitLength / 0x100000000), false);
        lengthView.setUint32(4, bitLength & 0xffffffff, false);
        padded.set(new Uint8Array(lengthBytes), paddedLength - 8);

        // 初始化哈希值
        let h0 = 0x67452301;
        let h1 = 0xEFCDAB89;
        let h2 = 0x98BADCFE;
        let h3 = 0x10325476;
        let h4 = 0xC3D2E1F0;

        // 处理每个512位块
        for (let i = 0; i < paddedLength; i += 64) {
          const chunk = padded.slice(i, i + 64);
          const words = new Array(80);

          // 将块转换为16个32位字
          for (let j = 0; j < 16; j++) {
            words[j] = (chunk[j * 4] << 24) |
                      (chunk[j * 4 + 1] << 16) |
                      (chunk[j * 4 + 2] << 8) |
                      chunk[j * 4 + 3];
          }

          // 扩展16个字到80个字
          for (let j = 16; j < 80; j++) {
            words[j] = this.rotateLeft(words[j - 3] ^ words[j - 8] ^ words[j - 14] ^ words[j - 16], 1);
          }

          // 初始化哈希值
          let a = h0, b = h1, c = h2, d = h3, e = h4;

          // 主循环
          for (let j = 0; j < 80; j++) {
            let f, k;
            if (j < 20) {
              f = (b & c) | ((~b) & d);
              k = 0x5A827999;
            } else if (j < 40) {
              f = b ^ c ^ d;
              k = 0x6ED9EBA1;
            } else if (j < 60) {
              f = (b & c) | (b & d) | (c & d);
              k = 0x8F1BBCDC;
            } else {
              f = b ^ c ^ d;
              k = 0xCA62C1D6;
            }

            const temp = (this.rotateLeft(a, 5) + f + e + k + words[j]) >>> 0;
            e = d;
            d = c;
            c = this.rotateLeft(b, 30);
            b = a;
            a = temp;
          }

          // 添加到哈希值
          h0 = (h0 + a) >>> 0;
          h1 = (h1 + b) >>> 0;
          h2 = (h2 + c) >>> 0;
          h3 = (h3 + d) >>> 0;
          h4 = (h4 + e) >>> 0;
        }

        // 返回哈希值
        const result = new Uint8Array(20);
        const view = new DataView(result.buffer);
        view.setUint32(0, h0, false);
        view.setUint32(4, h1, false);
        view.setUint32(8, h2, false);
        view.setUint32(12, h3, false);
        view.setUint32(16, h4, false);
        return result;
      }

      // 左旋转函数
      rotateLeft(value, amount) {
        return ((value << amount) | (value >>> (32 - amount))) >>> 0;
      }

      // Base32解码函数
      base32Decode(encoded) {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        const cleanInput = encoded.toUpperCase().replace(/=+$/, '');

        let bits = '';
        for (let i = 0; i < cleanInput.length; i++) {
          const char = cleanInput[i];
          const index = alphabet.indexOf(char);
          if (index === -1) continue;
          bits += index.toString(2).padStart(5, '0');
        }

        // 移除填充位
        const padding = bits.length % 8;
        if (padding > 0) {
          bits = bits.slice(0, -padding);
        }

        const bytes = [];
        for (let i = 0; i < bits.length; i += 8) {
          const byte = bits.slice(i, i + 8);
          if (byte.length === 8) {
            bytes.push(parseInt(byte, 2));
          }
        }

        return new Uint8Array(bytes);
      }
    }

    // 创建全局OTP计算器实例
    const otpCalculator = new OTPCalculator();

    // 保存每个验证码节点最近一次成功提交的窗口，避免首次加载或重复刷新时误触发动效
    const otpTransitionStates = new WeakMap();
    const queuedOTPAnimationJobs = new Set();
    const otpQueuedAnimationJobs = new WeakMap();
    const otpAnimationTimers = new WeakMap();
    const activeOTPAnimationRecords = new Set();
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

        const viewportWidth = typeof window !== 'undefined' && Number.isFinite(window.innerWidth)
          ? window.innerWidth
          : (document.documentElement && document.documentElement.clientWidth) || 0;
        const viewportHeight = typeof window !== 'undefined' && Number.isFinite(window.innerHeight)
          ? window.innerHeight
          : (document.documentElement && document.documentElement.clientHeight) || 0;
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
      animationJob.elements.forEach(element => {
        if (otpQueuedAnimationJobs.get(element) === animationJob) {
          otpQueuedAnimationJobs.delete(element);
        }
      });
    }

    function removeQueuedOTPAnimationJob(animationJob) {
      if (!animationJob || animationJob.cancelled) return;
      animationJob.cancelled = true;
      detachQueuedOTPAnimationJob(animationJob);
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

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) clearAllOTPAnimations();
      });
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
        getTrustedClockGeneration() !== animationJob.clockGeneration ||
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

    function startOTPPromotionAnimation(animationJob, geometry) {
      const animationConfig = OTP_ANIMATION_CONFIG[animationJob.animationMode];
      if (!animationConfig || !geometry || !isOTPAnimationJobCurrent(animationJob)) return;

      const entries = [
        { element: animationJob.otpElement, className: animationConfig.currentClass },
        { element: animationJob.nextOtpElement, className: animationConfig.nextClass }
      ];
      entries.forEach(({ element, className }) => {
        clearOTPAnimationTimer(element);
        removeOTPAnimationClass(element, className);
      });

      const flyer = createOTPPromotionFlyer(
        animationJob.previousNextToken,
        geometry,
        animationConfig.flyerStyle,
        animationConfig.usesTravelPath
      );
      if (!flyer) return;

      try {
        entries.forEach(({ element, className }) => element.classList.add(className));
        flyer.classList.add(animationConfig.flyerClass);
      } catch {
        entries.forEach(({ element, className }) => removeOTPAnimationClass(element, className));
        removeOTPPromotionFlyer(flyer);
        return;
      }

      if (typeof setTimeout !== 'function') {
        entries.forEach(({ element, className }) => removeOTPAnimationClass(element, className));
        removeOTPPromotionFlyer(flyer);
        return;
      }

      const animationRecord = { timerId: null, flyer, entries, cleared: false };
      entries.forEach(({ element }) => otpAnimationTimers.set(element, animationRecord));
      activeOTPAnimationRecords.add(animationRecord);
      animationRecord.timerId = setTimeout(
        () => clearOTPAnimationRecord(animationRecord),
        animationConfig.duration
      );
    }

    function flushQueuedOTPAnimations() {
      otpAnimationReadFrameId = null;
      otpAnimationReadFrameScheduled = false;
      const animationJobs = [...queuedOTPAnimationJobs];
      animationJobs.forEach(job => detachQueuedOTPAnimationJob(job));

      if (!isOTPAnimationDocumentVisible() || prefersReducedOTPMotion()) {
        animationJobs.forEach(job => { job.cancelled = true; });
        return;
      }

      const preparedJobs = [];
      animationJobs.forEach(animationJob => {
        if (!isOTPAnimationJobCurrent(animationJob)) {
          animationJob.cancelled = true;
          return;
        }
        const isAnimationVisible = isOTPElementInViewport(animationJob.otpElement) ||
          isOTPElementInViewport(animationJob.nextOtpElement);
        if (!isAnimationVisible) {
          animationJob.cancelled = true;
          return;
        }

        const animationConfig = OTP_ANIMATION_CONFIG[animationJob.animationMode];
        const geometry = captureOTPPromotionGeometry(
          animationJob.otpElement,
          animationJob.nextOtpElement,
          animationConfig
        );
        if (geometry) preparedJobs.push({ animationJob, geometry });
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

    function queueOTPPromotionAnimation(animationJob) {
      clearOTPAnimationTimer(animationJob.otpElement);
      clearOTPAnimationTimer(animationJob.nextOtpElement);
      animationJob.cancelled = false;
      animationJob.elements = [animationJob.otpElement, animationJob.nextOtpElement];
      animationJob.elements.forEach(element => otpQueuedAnimationJobs.set(element, animationJob));
      queuedOTPAnimationJobs.add(animationJob);
      scheduleQueuedOTPAnimationFlush();
    }

    // 更新OTP显示
    async function updateOTP(secretId) {
      const secret = secrets.find(s => s.id === secretId);
      if (!secret) return;

      try {
        const currentTime = Math.floor(getCorrectedNowMs() / 1000);
        const timeStep = secret.period || 30;
        const isHOTP = secret.type && secret.type.toUpperCase() === 'HOTP';
        const clockGeneration = isHOTP ? null : getTrustedClockGeneration();
        const currentWindow = otpCalculator.getCurrentTimeWindow(timeStep);
        const nextWindow = otpCalculator.getNextTimeWindow(timeStep);

        console.log('更新OTP:', secret.name, '当前时间窗口:', currentWindow, '下一个时间窗口:', nextWindow, '时间:', new Date(currentTime * 1000).toLocaleTimeString());

        // 并行计算当前和下一个OTP
        const [currentToken, nextToken] = await Promise.all([
          otpCalculator.calculateCurrentOTP(secret),
          otpCalculator.calculateNextOTP(secret)
        ]);

        if (!isHOTP) {
          if (clockGeneration !== getTrustedClockGeneration()) return;
          if (currentWindow !== otpCalculator.getCurrentTimeWindow(timeStep)) {
            return updateOTP(secretId);
          }
        }

        // 在提交前读取旧的下一个验证码，用于确认它是否正好晋升为当前验证码
        const otpElement = document.getElementById('otp-' + secretId);
        const nextOtpElement = document.getElementById('next-otp-' + secretId);
        const previousCurrentToken = otpElement ? otpElement.textContent : null;
        const previousNextToken = nextOtpElement ? nextOtpElement.textContent : null;
        const previousTransitionState = !isHOTP && otpElement ? otpTransitionStates.get(otpElement) : null;
        const animationMode = getOTPAnimationMode();
        const tokenDigits = secret.digits || 6;

        const isOTPWindowPromotion = !!(
          !isHOTP &&
          otpElement &&
          nextOtpElement &&
          previousTransitionState &&
          previousTransitionState.window === currentWindow - 1 &&
          previousTransitionState.period === timeStep &&
          previousTransitionState.nextToken === previousNextToken &&
          isValidOTPAnimationToken(previousNextToken, tokenDigits) &&
          isValidOTPAnimationToken(currentToken, tokenDigits) &&
          isValidOTPAnimationToken(nextToken, tokenDigits) &&
          previousNextToken === currentToken
        );
        const shouldQueuePromotion = !!(
          isOTPWindowPromotion &&
          animationMode !== 'none' &&
          isOTPAnimationDocumentVisible()
        );
        const preservesCurrentAnimation = !!(
          !isHOTP &&
          previousTransitionState &&
          previousTransitionState.window === currentWindow &&
          previousTransitionState.period === timeStep &&
          previousTransitionState.nextToken === nextToken &&
          previousCurrentToken === currentToken &&
          previousNextToken === nextToken
        );

        // 同窗同值刷新保留正在播放的动画；任何新状态提交都先撤销旧 flyer/class
        if (!preservesCurrentAnimation) {
          clearOTPAnimationTimer(otpElement);
          clearOTPAnimationTimer(nextOtpElement);
        }

        // 更新当前OTP显示
        if (otpElement) {
          otpElement.textContent = currentToken;
          console.log('当前OTP更新:', currentToken, '时间窗口:', currentWindow);
        }

        // 更新下一个OTP显示
        if (nextOtpElement) {
          nextOtpElement.textContent = nextToken;
          console.log('下一个OTP更新:', nextToken, '时间窗口:', nextWindow);
        }

        if (!isHOTP && otpElement && nextOtpElement) {
          otpTransitionStates.set(otpElement, {
            window: currentWindow,
            period: timeStep,
            nextToken
          });

          if (shouldQueuePromotion) {
            queueOTPPromotionAnimation({
              otpElement,
              nextOtpElement,
              previousNextToken,
              animationMode,
              currentToken,
              nextToken,
              window: currentWindow,
              period: timeStep,
              clockGeneration
            });
          }
        }
      } catch (error) {
        console.error('更新OTP失败:', error);
      }
    }

    // 计算下一个OTP（保持向后兼容）
    async function calculateNextOTP(secretObj) {
      return await otpCalculator.calculateNextOTP(secretObj);
    }

    // 启动OTP倒计时（仅对TOTP有效，HOTP不需要倒计时）
    function startOTPInterval(secretId) {
      const secret = secrets.find(s => s.id === secretId);
      if (!secret) return;

      // HOTP 不需要倒计时，直接返回
      if (secret.type && secret.type.toUpperCase() === 'HOTP') {
        return;
      }

      if (otpIntervals[secretId]) {
        clearInterval(otpIntervals[secretId]);
      }

      otpIntervals[secretId] = setInterval(() => {
        updateCountdown(secretId);
      }, 1000);

      updateCountdown(secretId);
    }

    // 更新倒计时（仅对TOTP有效）
    function updateCountdown(secretId) {
      const secret = secrets.find(s => s.id === secretId);
      if (!secret) return;

      // HOTP 不需要倒计时，直接返回
      if (secret.type && secret.type.toUpperCase() === 'HOTP') {
        return;
      }

      const timeStep = secret.period || 30;
      const remaining = otpCalculator.getRemainingTime(timeStep);

      const progressElement = document.getElementById('progress-' + secretId);
      if (progressElement) {
        const progress = (remaining / timeStep) * 100;
        progressElement.style.width = progress + '%';

        const ratio = remaining / timeStep;
        let color;
        if (ratio > 0.6) {
          color = '#4CAF50';
        } else if (ratio > 0.3) {
          color = '#FF9800';
        } else {
          color = '#F44336';
        }
        progressElement.style.backgroundColor = color;
      }

      // 🔄 防御性检查：如果验证码显示为默认值，立即刷新
      const otpElement = document.getElementById('otp-' + secretId);
      if (otpElement && otpElement.textContent === '------') {
        console.warn('⚠️  检测到验证码未初始化，立即刷新:', secret.name);
        updateOTP(secretId);
      }

      if (remaining === 0) {
        // 倒计时结束时，立即更新OTP
        updateOTP(secretId);
        // 重新启动倒计时
        if (otpIntervals[secretId]) {
          updateCountdown(secretId);
        }
      } else if (remaining === 1) {
        // 倒计时即将结束时，提前准备刷新
        setTimeout(() => {
          if (otpIntervals[secretId]) {
            updateOTP(secretId);
            updateCountdown(secretId);
          }
        }, 1000);
      }
    }
`;
}
