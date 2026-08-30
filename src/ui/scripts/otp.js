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

      // HOTP 计数器必须能被 JavaScript 精确表示；offset 用于预计算下一个验证码。
      getHOTPCounter(secret, offset = 0) {
        const counter = secret && secret.counter !== undefined ? secret.counter : 0;
        if (!Number.isSafeInteger(counter) || counter < 0) {
          throw new RangeError('HOTP counter must be a non-negative safe integer');
        }

        const resolvedCounter = counter + offset;
        if (!Number.isSafeInteger(resolvedCounter) || resolvedCounter < 0) {
          throw new RangeError('HOTP counter increment exceeds the safe integer range');
        }
        return resolvedCounter;
      }

      // RFC 4226 使用 8 字节大端计数器，不能只写低 32 位。
      getCounterBytes(counter) {
        if (!Number.isSafeInteger(counter) || counter < 0) {
          throw new RangeError('OTP counter must be a non-negative safe integer');
        }

        const counterBytes = new ArrayBuffer(8);
        const counterView = new DataView(counterBytes);
        const high = Math.floor(counter / 0x100000000);
        const low = counter % 0x100000000;
        counterView.setUint32(0, high, false);
        counterView.setUint32(4, low, false);
        return counterBytes;
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
        const options = {
          digits: secret.digits || 6,
          algorithm: secret.algorithm || 'SHA1'
        };

        try {
          const isHOTP = String(secret.type || 'TOTP').toUpperCase() === 'HOTP';
          const counter = isHOTP
            ? this.getHOTPCounter(secret)
            : this.getCurrentTimeWindow(secret.period || 30);
          const cacheKey = this.getCacheKey(secret.secret, counter, options);
          const cached = this.getCachedResult(cacheKey);
          if (cached) {
            return cached;
          }

          const token = await this.generateTOTP(secret.secret, counter, options);
          this.setCachedResult(cacheKey, token);
          return token;
        } catch (error) {
          console.error('计算当前OTP失败:', error);
          return '-'.repeat(options.digits);
        }
      }

      // 计算下一个OTP
      async calculateNextOTP(secret) {
        const options = {
          digits: secret.digits || 6,
          algorithm: secret.algorithm || 'SHA1'
        };

        try {
          const isHOTP = String(secret.type || 'TOTP').toUpperCase() === 'HOTP';
          const counter = isHOTP
            ? this.getHOTPCounter(secret, 1)
            : this.getNextTimeWindow(secret.period || 30);
          const cacheKey = this.getCacheKey(secret.secret, counter, options);
          const cached = this.getCachedResult(cacheKey);
          if (cached) {
            return cached;
          }

          const token = await this.generateTOTP(secret.secret, counter, options);
          this.setCachedResult(cacheKey, token);
          return token;
        } catch (error) {
          console.error('计算下一个OTP失败:', error);
          return '-'.repeat(options.digits);
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
          const counterBytes = this.getCounterBytes(counter);

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
          const counterBytes = this.getCounterBytes(counter);

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
    // HOTP 文本只有与生成它的参数、counter 和实际 DOM 节点绑定后才允许复制。
    const committedHOTPTokenStates = new WeakMap();
    const otpAnimationTimers = new WeakMap();
    const activeOTPAnimationRecords = new Set();
    // 动画会暂时让 flyer 展示旧的“下一个”验证码，而 DOM 已提交新值。
    // 明确记录这一过渡期，供复制逻辑阻止复制与画面不一致的隐藏值。
    const activeOTPNextTransitions = new WeakMap();
    // 同一帧内完成的多个交接统一读取布局、再一起写入 class，避免卡片之间出现明显时差
    const queuedOTPAnimationJobs = new Set();
    const otpQueuedAnimationJobs = new WeakMap();
    // updateOTP 可能同时被倒计时、安全检查和焦点恢复触发；相同窗口只保留一个计算请求
    const otpUpdateInFlight = new Map();
    let otpUpdateRequestGeneration = 0;
    // 每张卡仍保留自己的进度条定时器，但验证码窗口切换由一个共享调度器触发
    const otpWindowSchedulerEntries = new Map();
    let otpWindowSchedulerTimer = null;
    let otpWindowSchedulerRunning = false;
    const OTP_WINDOW_SCHEDULER_TICK_MS = 250;
    const OTP_WINDOW_RETRY_BASE_MS = 1000;
    const OTP_WINDOW_RETRY_MAX_MS = 8000;
    const OTP_WINDOW_RETRY_MAX_ATTEMPTS = 5;
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

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          clearAllOTPAnimations();
          stopOTPWindowScheduler();
        } else if (otpWindowSchedulerEntries.size > 0) {
          startOTPWindowScheduler();
        }
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

    function createOTPAnimationBatch() {
      return {
        tasks: [],
        pending: 0,
        sealed: false,
        flushed: false,
        released: false
      };
    }

    function flushOTPAnimationBatch(animationBatch) {
      if (
        !animationBatch ||
        animationBatch.flushed ||
        !animationBatch.sealed ||
        animationBatch.pending > 0
      ) return;

      animationBatch.flushed = true;
      animationBatch.tasks.forEach(task => {
        if (task.cancelled || typeof task.commitAction !== 'function') return;
        try {
          task.commitAction();
        } catch (error) {
          console.error('批量提交OTP失败:', error);
        }
      });

      animationBatch.released = true;
      if ([...queuedOTPAnimationJobs].some(job => job.animationBatch === animationBatch)) {
        scheduleQueuedOTPAnimationFlush();
      }
      animationBatch.tasks.forEach(task => task.resolve());
    }

    function registerOTPAnimationBatchTask(animationBatch) {
      if (!animationBatch || animationBatch.sealed || animationBatch.flushed) return null;

      let resolveTask;
      const task = {
        animationBatch,
        cancelled: false,
        commitAction: null,
        settled: false,
        promise: new Promise(resolve => { resolveTask = resolve; }),
        resolve: () => resolveTask()
      };
      animationBatch.tasks.push(task);
      animationBatch.pending += 1;
      return task;
    }

    function settleOTPAnimationBatchTask(task, commitAction = null) {
      if (!task) return Promise.resolve();
      if (task.settled) {
        if (task.cancelled) task.commitAction = null;
        return task.promise;
      }

      task.settled = true;
      task.commitAction = task.cancelled ? null : commitAction;
      task.animationBatch.pending = Math.max(0, task.animationBatch.pending - 1);
      flushOTPAnimationBatch(task.animationBatch);
      return task.promise;
    }

    function cancelOTPAnimationBatchTask(request) {
      const task = request ? request.animationBatchTask : null;
      if (!task) return;
      task.cancelled = true;
      task.commitAction = null;
      settleOTPAnimationBatchTask(task);
    }

    function sealOTPAnimationBatch(animationBatch) {
      if (!animationBatch || animationBatch.sealed) return;
      animationBatch.sealed = true;
      flushOTPAnimationBatch(animationBatch);
    }

    function completeOTPUpdateRequest(request, commitAction = null) {
      if (request && request.animationBatchTask) {
        return settleOTPAnimationBatchTask(request.animationBatchTask, commitAction);
      }

      if (typeof commitAction === 'function') {
        try {
          commitAction();
        } catch (error) {
          console.error('提交OTP失败:', error);
        }
      }
      return Promise.resolve();
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

    // 执行一次稳定窗口更新。计算期间跨过窗口或时钟重新同步时，丢弃结果并重试，
    // 避免旧结果触发错误的交接动画。
    function isCurrentOTPUpdateRequest(secretId, request) {
      return !request || otpUpdateInFlight.get(secretId) === request;
    }

    function getHOTPTokenFingerprint(secret) {
      if (!secret || String(secret.type || '').toUpperCase() !== 'HOTP') return null;
      return JSON.stringify([
        String(secret.id),
        secret.secret,
        Number(secret.digits) || 6,
        String(secret.algorithm || 'SHA1').toUpperCase(),
        secret.counter === undefined ? 0 : secret.counter,
        secret.hotpCounterNamespace || null
      ]);
    }

    function getCommittedHOTPToken(secretId, secret) {
      const element = document.getElementById('otp-' + secretId);
      const committed = element ? committedHOTPTokenStates.get(element) : null;
      if (
        !committed ||
        committed.fingerprint !== getHOTPTokenFingerprint(secret) ||
        committed.token !== element.textContent ||
        !isValidOTPAnimationToken(committed.token, secret.digits)
      ) return null;
      return committed.token;
    }

    function commitOTPUpdateResult(secretId, request, result) {
      const {
        animationMode,
        clockGeneration,
        currentToken,
        currentWindow,
        hotpFingerprint,
        isHOTP,
        nextToken,
        nextWindow,
        secret,
        timeStep,
        tokenDigits
      } = result;

      // 批处理中较快的计算会等待慢卡；真正写 DOM 前必须再次确认请求、窗口和时钟代次。
      if (!isCurrentOTPUpdateRequest(secretId, request)) return;
      if (isHOTP && hotpFingerprint !== getHOTPTokenFingerprint(secret)) return;
      if (!isHOTP) {
        if (clockGeneration !== getTrustedClockGeneration()) return;
        if (currentWindow !== otpCalculator.getCurrentTimeWindow(timeStep)) return;
      }

      // 在提交前读取旧的下一个验证码，用于确认它是否正好晋升为当前验证码。
      const otpElement = document.getElementById('otp-' + secretId);
      const nextOtpElement = document.getElementById('next-otp-' + secretId);
      const previousCurrentToken = otpElement ? otpElement.textContent : null;
      const previousNextToken = nextOtpElement ? nextOtpElement.textContent : null;
      const previousTransitionState = !isHOTP && otpElement ? otpTransitionStates.get(otpElement) : null;

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
        isOTPAnimationDocumentVisible() &&
        !prefersReducedOTPMotion()
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

      // 同窗同值刷新保留正在播放的动画；任何新状态提交都先撤销旧 flyer/class。
      if (!preservesCurrentAnimation) {
        clearOTPAnimationTimer(otpElement);
        clearOTPAnimationTimer(nextOtpElement);
      }

      if (otpElement) {
        otpElement.textContent = currentToken;
        if (isHOTP && isValidOTPAnimationToken(currentToken, tokenDigits)) {
          committedHOTPTokenStates.set(otpElement, {
            fingerprint: hotpFingerprint,
            token: currentToken
          });
        } else {
          committedHOTPTokenStates.delete(otpElement);
        }
        console.log('当前OTP更新:', currentToken, '时间窗口:', currentWindow);
      }
      if (nextOtpElement) {
        nextOtpElement.textContent = nextToken;
        console.log('下一个OTP更新:', nextToken, '时间窗口:', nextWindow);
      }

      if (!isHOTP && otpElement && nextOtpElement) {
        otpTransitionStates.set(otpElement, {
          window: currentWindow,
          period: timeStep,
          clockGeneration,
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
            clockGeneration,
            isHOTP: false
          }, request ? request.animationBatch : null);
        }
      }
    }

    async function performOTPUpdate(secretId, request = null, secretHint = null) {
      const secret = secretHint || secrets.find(s => s.id === secretId);
      if (!secret) return completeOTPUpdateRequest(request);

      const timeStep = secret.period || 30;
      const isHOTP = secret.type && secret.type.toUpperCase() === 'HOTP';
      const hotpFingerprint = isHOTP ? getHOTPTokenFingerprint(secret) : null;
      const maxAttempts = isHOTP ? 1 : 3;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
          const currentTime = Math.floor(getCorrectedNowMs() / 1000);
          const clockGeneration = isHOTP ? null : getTrustedClockGeneration();
          const currentWindow = otpCalculator.getCurrentTimeWindow(timeStep);
          const nextWindow = otpCalculator.getNextTimeWindow(timeStep);

          console.log('更新OTP:', secret.name, '当前时间窗口:', currentWindow, '下一个时间窗口:', nextWindow, '时间:', new Date(currentTime * 1000).toLocaleTimeString());

          // 并行计算当前和下一个OTP
          const [currentToken, nextToken] = await Promise.all([
            otpCalculator.calculateCurrentOTP(secret),
            otpCalculator.calculateNextOTP(secret)
          ]);

          // 如果同一张卡随后以新的窗口/时钟代次发起了请求，旧结果只能丢弃。
          if (!isCurrentOTPUpdateRequest(secretId, request)) {
            return completeOTPUpdateRequest(request);
          }

          if (!isHOTP) {
            if (clockGeneration !== getTrustedClockGeneration()) continue;
            if (currentWindow !== otpCalculator.getCurrentTimeWindow(timeStep)) continue;
          }

          return completeOTPUpdateRequest(request, () => commitOTPUpdateResult(
            secretId,
            request,
            {
              animationMode: getOTPAnimationMode(),
              clockGeneration,
              currentToken,
              currentWindow,
              hotpFingerprint,
              isHOTP,
              nextToken,
              nextWindow,
              secret,
              timeStep,
              tokenDigits: secret.digits || 6
            }
          ));
        } catch (error) {
          console.error('更新OTP失败:', error);
          return completeOTPUpdateRequest(request);
        }
      }
      return completeOTPUpdateRequest(request);
    }

    function getOTPUpdateContext(secretId, secretHint = null) {
      const secret = secretHint || secrets.find(s => s.id === secretId);
      if (!secret) return null;

      const period = secret.period || 30;
      const isHOTP = secret.type && secret.type.toUpperCase() === 'HOTP';
      return {
        secretFingerprint: JSON.stringify([
          secret.secret,
          secret.type,
          secret.digits,
          secret.algorithm,
          secret.counter,
          secret.period,
          secret.hotpCounterNamespace
        ]),
        period,
        window: isHOTP ? null : otpCalculator.getCurrentTimeWindow(period),
        clockGeneration: isHOTP ? null : getTrustedClockGeneration(),
        requestGeneration: otpUpdateRequestGeneration
      };
    }

    function isSameOTPUpdateContext(left, right) {
      return !!(
        left &&
        right &&
        left.secretFingerprint === right.secretFingerprint &&
        left.period === right.period &&
        left.window === right.window &&
        left.clockGeneration === right.clockGeneration &&
        left.requestGeneration === right.requestGeneration
      );
    }

    // 倒计时、安全检查、焦点恢复可能在同一时刻请求同一张卡；相同窗口复用同一个 Promise。
    // 如果窗口或时钟代次已经改变，则允许新请求取代旧请求，旧结果会在提交前被丢弃。
    function updateOTP(secretId, animationBatch = null, secretHint = null) {
      const context = getOTPUpdateContext(secretId, secretHint);
      if (!context) return Promise.resolve();

      const existing = otpUpdateInFlight.get(secretId);
      if (existing && isSameOTPUpdateContext(existing, context)) {
        if (!animationBatch || existing.animationBatch) {
          return existing.promise;
        }
      }

      // 新 batch 不能接管已启动的非 batch 请求，否则旧请求会在整批 seal 前提前写 DOM。
      // 取代任何旧请求时也立即取消其 batch task，避免过期 WebCrypto 阻塞旧批次。
      if (existing) cancelOTPAnimationBatchTask(existing);

      const animationBatchTask = registerOTPAnimationBatchTask(animationBatch);
      const effectiveAnimationBatch = animationBatchTask ? animationBatch : null;

      const request = {
        ...context,
        animationBatch: effectiveAnimationBatch,
        animationBatchTask,
        promise: null
      };
      request.promise = performOTPUpdate(secretId, request, secretHint);
      otpUpdateInFlight.set(secretId, request);
      request.promise.then(
        () => {
          if (otpUpdateInFlight.get(secretId) === request) {
            otpUpdateInFlight.delete(secretId);
          }
        },
        () => {
          if (otpUpdateInFlight.get(secretId) === request) {
            otpUpdateInFlight.delete(secretId);
          }
        }
      );
      return request.promise;
    }

    function updateOTPSecretsInBatch(secretList, { includeHOTP = false } = {}) {
      const candidates = Array.isArray(secretList)
        ? secretList.filter(secret => includeHOTP || !(secret.type && secret.type.toUpperCase() === 'HOTP'))
        : [];
      const animationBatch = createOTPAnimationBatch();
      const updateTasks = candidates.map(secret => {
        try {
          return Promise.resolve(updateOTP(secret.id, animationBatch, secret));
        } catch (error) {
          console.warn('批量刷新OTP失败:', error);
          return Promise.resolve();
        }
      });
      sealOTPAnimationBatch(animationBatch);
      return Promise.allSettled(updateTasks);
    }

    function hasOTPInterval(secretId) {
      return !!(
        otpIntervals &&
        Object.prototype.hasOwnProperty.call(otpIntervals, String(secretId))
      );
    }

    function isCommittedOTPValue(element, digits) {
      const value = element ? String(element.textContent || '') : '';
      return isValidOTPAnimationToken(value, digits);
    }

    function getCommittedOTPWindow(
      secretId,
      period,
      clockGeneration = getTrustedClockGeneration(),
      digits = 6
    ) {
      const otpElement = document.getElementById('otp-' + secretId);
      const nextOtpElement = document.getElementById('next-otp-' + secretId);
      const transitionState = otpElement ? otpTransitionStates.get(otpElement) : null;
      const tokenDigits = Number(digits) || 6;
      if (
        !transitionState ||
        transitionState.period !== period ||
        transitionState.clockGeneration !== clockGeneration ||
        !isCommittedOTPValue(otpElement, tokenDigits) ||
        !isCommittedOTPValue(nextOtpElement, tokenDigits)
      ) {
        return null;
      }
      return transitionState.window;
    }

    function hasCommittedOTPWindow(secretId, period, currentWindow, clockGeneration, digits = 6) {
      return getCommittedOTPWindow(secretId, period, clockGeneration, digits) === currentWindow;
    }

    function resetOTPWindowRetry(entry, window = null, clockGeneration = null) {
      entry.retryWindow = window;
      entry.retryClockGeneration = clockGeneration;
      entry.retryCount = 0;
      entry.retryNotBeforeMs = 0;
    }

    function prepareOTPWindowRetry(entry, window, clockGeneration) {
      if (entry.retryWindow !== window || entry.retryClockGeneration !== clockGeneration) {
        resetOTPWindowRetry(entry, window, clockGeneration);
      }
    }

    function recordOTPWindowRetryFailure(entry, window, clockGeneration) {
      prepareOTPWindowRetry(entry, window, clockGeneration);
      entry.retryCount += 1;
      const delayMs = Math.min(
        OTP_WINDOW_RETRY_BASE_MS * Math.pow(2, Math.max(0, entry.retryCount - 1)),
        OTP_WINDOW_RETRY_MAX_MS
      );
      entry.retryNotBeforeMs = getTrustedMonotonicNowMs() + delayMs;
    }

    function invalidateOTPWindowSchedulerForClockChange() {
      otpUpdateRequestGeneration += 1;
      // Keep HOTP requests alive: they do not depend on wall-clock time and
      // have no interval-based recovery if their initial result is discarded.
      // TOTP requests are still superseded by the refreshed clock context.
      otpUpdateInFlight.forEach(request => {
        if (request.window !== null) cancelOTPAnimationBatchTask(request);
      });
      otpWindowSchedulerEntries.forEach(entry => {
        entry.pendingAttempt = null;
        resetOTPWindowRetry(entry);
      });
    }

    function stopOTPWindowScheduler() {
      if (!otpWindowSchedulerRunning) return;

      if (
        otpWindowSchedulerTimer !== null &&
        otpWindowSchedulerTimer !== true &&
        typeof clearInterval === 'function'
      ) {
        clearInterval(otpWindowSchedulerTimer);
      }
      otpWindowSchedulerTimer = null;
      otpWindowSchedulerRunning = false;
    }

    function clearOTPWindowScheduler() {
      stopOTPWindowScheduler();
      otpWindowSchedulerEntries.clear();
      otpUpdateRequestGeneration += 1;
      otpUpdateInFlight.forEach(cancelOTPAnimationBatchTask);
      otpUpdateInFlight.clear();
    }

    function settleOTPWindowSchedulerAttempt(refreshEntry, committed) {
      const { entry, secret, secretId, period, window, clockGeneration, attempt } = refreshEntry;
      if (
        otpWindowSchedulerEntries.get(String(secretId)) !== entry ||
        entry.pendingAttempt !== attempt
      ) {
        return;
      }

      entry.pendingAttempt = null;
      if (!committed) {
        recordOTPWindowRetryFailure(entry, window, clockGeneration);
        return;
      }

      entry.lastWindow = window;
      resetOTPWindowRetry(entry, window, clockGeneration);
      // OTP 文本提交后立刻把进度条推进到同一个校准时间点，不等待下一次 1 秒 interval。
      updateCountdown(secretId, secret);
    }

    function runOTPWindowSchedulerBatch(refreshEntries) {
      const animationBatch = createOTPAnimationBatch();
      refreshEntries.forEach(refreshEntry => {
        const { secret, secretId, period, window, clockGeneration } = refreshEntry;
        let updatePromise;
        try {
          updatePromise = updateOTP(secretId, animationBatch, secret);
        } catch (error) {
          settleOTPWindowSchedulerAttempt(refreshEntry, false);
          console.warn('调度OTP窗口更新失败:', error);
          return;
        }

        Promise.resolve(updatePromise).then(() => {
          settleOTPWindowSchedulerAttempt(
            refreshEntry,
            hasCommittedOTPWindow(secretId, period, window, clockGeneration, secret.digits)
          );
        }, () => {
          settleOTPWindowSchedulerAttempt(refreshEntry, false);
        });
      });
      // 所有请求已同步注册；最后一个计算 settle 时统一写 DOM 并只排一个 RAF。
      sealOTPAnimationBatch(animationBatch);
    }

    function runOTPWindowScheduler() {
      if (typeof document !== 'undefined' && document.hidden) {
        stopOTPWindowScheduler();
        return;
      }

      const refreshEntries = [];
      const currentWindowsByPeriod = new Map();
      const clockGeneration = getTrustedClockGeneration();
      for (const [entryKey, entry] of otpWindowSchedulerEntries) {
        if (!hasOTPInterval(entry.secretId)) {
          otpWindowSchedulerEntries.delete(entryKey);
          continue;
        }

        const secret = entry.secret;
        if (!secret || (secret.type && secret.type.toUpperCase() === 'HOTP')) {
          otpWindowSchedulerEntries.delete(entryKey);
          continue;
        }

        const period = secret.period || 30;
        let currentWindow = currentWindowsByPeriod.get(period);
        if (typeof currentWindow === 'undefined') {
          currentWindow = otpCalculator.getCurrentTimeWindow(period);
          currentWindowsByPeriod.set(period, currentWindow);
        }
        entry.period = period;
        prepareOTPWindowRetry(entry, currentWindow, clockGeneration);
        if (entry.lastWindow === null) {
          entry.lastWindow = currentWindow;
          entry.pendingAttempt = null;
          continue;
        }
        if (entry.pendingAttempt) {
          if (
            entry.pendingAttempt.window === currentWindow &&
            entry.pendingAttempt.clockGeneration === clockGeneration
          ) {
            continue;
          }
          entry.pendingAttempt = null;
        }
        // 安全检查或焦点恢复可能已经提交了这一窗口，避免再次启动计算/动画。
        if (hasCommittedOTPWindow(entry.secretId, period, currentWindow, clockGeneration, secret.digits)) {
          entry.lastWindow = currentWindow;
          resetOTPWindowRetry(entry, currentWindow, clockGeneration);
          continue;
        }
        if (
          entry.retryCount >= OTP_WINDOW_RETRY_MAX_ATTEMPTS ||
          getTrustedMonotonicNowMs() < entry.retryNotBeforeMs
        ) {
          continue;
        }

        const attempt = { window: currentWindow, clockGeneration };
        entry.pendingAttempt = attempt;
        refreshEntries.push({
          entry,
          secret,
          secretId: entry.secretId,
          period,
          window: currentWindow,
          clockGeneration,
          attempt
        });
      }

      if (refreshEntries.length > 0) {
        runOTPWindowSchedulerBatch(refreshEntries);
      }

      if (otpWindowSchedulerEntries.size === 0) stopOTPWindowScheduler();
    }

    function startOTPWindowScheduler() {
      if (
        otpWindowSchedulerRunning ||
        typeof setInterval !== 'function' ||
        (typeof document !== 'undefined' && document.hidden)
      ) return;

      try {
        const timer = setInterval(runOTPWindowScheduler, OTP_WINDOW_SCHEDULER_TICK_MS);
        // 测试或嵌入环境的 setInterval 可能不返回句柄；running 标记仍需生效，避免重复注册。
        otpWindowSchedulerTimer = typeof timer === 'undefined' ? true : timer;
        otpWindowSchedulerRunning = true;
      } catch (error) {
        console.warn('启动OTP窗口调度器失败:', error);
      }
    }

    function isOTPWindowScheduled(secretId) {
      return otpWindowSchedulerRunning && otpWindowSchedulerEntries.has(String(secretId));
    }

    function registerOTPWindow(secretId, secretHint = null) {
      const secret = secretHint || secrets.find(s => s.id === secretId);
      if (!secret || (secret.type && secret.type.toUpperCase() === 'HOTP')) return;

      const entryKey = String(secretId);
      const period = secret.period || 30;
      const currentWindow = otpCalculator.getCurrentTimeWindow(period);
      const committedWindow = getCommittedOTPWindow(
        secretId,
        period,
        getTrustedClockGeneration(),
        secret.digits
      );
      const initialWindow = committedWindow === null ? currentWindow : committedWindow;
      const existing = otpWindowSchedulerEntries.get(entryKey);
      if (existing) {
        existing.secretId = secretId;
        existing.secret = secret;
        existing.lastWindow = initialWindow;
        existing.period = period;
        existing.pendingAttempt = null;
        resetOTPWindowRetry(existing);
      } else {
        const entry = {
          secretId,
          secret,
          period,
          lastWindow: initialWindow,
          pendingAttempt: null
        };
        resetOTPWindowRetry(entry);
        otpWindowSchedulerEntries.set(entryKey, entry);
      }
      startOTPWindowScheduler();
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('beforeunload', stopOTPWindowScheduler);
    }

    // 计算下一个OTP（保持向后兼容）
    async function calculateNextOTP(secretObj) {
      return await otpCalculator.calculateNextOTP(secretObj);
    }

    // 启动OTP倒计时（仅对TOTP有效，HOTP不需要倒计时）
    function startOTPInterval(secretId, secretHint = null) {
      const secret = secretHint || secrets.find(s => s.id === secretId);
      if (!secret) return;

      // HOTP 不需要倒计时，直接返回
      if (secret.type && secret.type.toUpperCase() === 'HOTP') {
        if (otpIntervals && Object.prototype.hasOwnProperty.call(otpIntervals, String(secretId))) {
          clearInterval(otpIntervals[secretId]);
          delete otpIntervals[secretId];
        }
        otpWindowSchedulerEntries.delete(String(secretId));
        if (otpWindowSchedulerEntries.size === 0) stopOTPWindowScheduler();
        return;
      }

      if (otpIntervals && Object.prototype.hasOwnProperty.call(otpIntervals, String(secretId))) {
        clearInterval(otpIntervals[secretId]);
      }

      otpIntervals[secretId] = setInterval(() => {
        updateCountdown(secretId, secret);
      }, 1000);

      registerOTPWindow(secretId, secret);
      updateCountdown(secretId, secret);
    }

    // 更新倒计时（仅对TOTP有效）
    function updateCountdown(secretId, secretHint = null) {
      const secret = secretHint || secrets.find(s => s.id === secretId);
      if (!secret) return;
      if (document.hidden) return;

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
      if (
        otpElement &&
        /^-+$/.test(String(otpElement.textContent || '')) &&
        !isOTPWindowScheduled(secretId)
      ) {
        console.warn('⚠️  检测到验证码未初始化，立即刷新:', secret.name);
        updateOTP(secretId, null, secret);
      }

      const currentWindow = otpCalculator.getCurrentTimeWindow(timeStep);
      if (
        !isOTPWindowScheduled(secretId) &&
        getCommittedOTPWindow(
          secretId,
          timeStep,
          getTrustedClockGeneration(),
          secret.digits
        ) !== currentWindow
      ) {
        // 只有共享调度器不可用时才由单卡兜底，避免抢先触发交接动画。
        updateOTP(secretId, null, secret);
      }
    }
`;
}
