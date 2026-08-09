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

        // 更新当前OTP显示
        const otpElement = document.getElementById('otp-' + secretId);
        if (otpElement) {
          otpElement.textContent = currentToken;
          console.log('当前OTP更新:', currentToken, '时间窗口:', currentWindow);
        }

        // 更新下一个OTP显示
        const nextOtpElement = document.getElementById('next-otp-' + secretId);
        if (nextOtpElement) {
          nextOtpElement.textContent = nextToken;
          console.log('下一个OTP更新:', nextToken, '时间窗口:', nextWindow);
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
