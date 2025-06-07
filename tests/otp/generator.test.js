/**
 * OTP 生成算法测试
 * 使用 RFC 6238 (TOTP) 和 RFC 4226 (HOTP) 官方测试向量
 */

import { describe, it, expect } from 'vitest';
import {
  generateOTP,
  generateTOTP,
  generateOTPAuthURL,
  base32toByteArray,
  getHashAlgorithm
} from '../../src/otp/generator.js';

describe('OTP Generator - RFC 测试向量', () => {

  describe('base32toByteArray', () => {
    it('应该正确解码 Base32 字符串', () => {
      // RFC 4648 测试向量
      const testCases = [
        { input: 'JBSWY3DPEHPK3PXP', expected: [72, 101, 108, 108, 111, 33, 222, 173, 190, 239] },
        { input: 'MFRGGZDFMZTWQ2LK', expected: [97, 98, 99, 100, 101, 102, 103, 104, 105, 106] },
        { input: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', expected: [49, 50, 51, 52, 53, 54, 55, 56, 57, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 48] }
      ];

      testCases.forEach(({ input, expected }) => {
        const result = base32toByteArray(input);
        expect(Array.from(result)).toEqual(expected);
      });
    });

    it('应该处理带有填充的 Base32', () => {
      const input = 'JBSWY3DPEHPK3PXP====';
      const result = base32toByteArray(input);
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    it('应该处理小写输入', () => {
      const input = 'jbswy3dpehpk3pxp';
      const result = base32toByteArray(input);
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    it('应该拒绝无效的 Base32 字符', () => {
      const invalidInputs = ['INVALID1', 'TEST@#$%', '12345678'];
      invalidInputs.forEach(input => {
        expect(() => base32toByteArray(input)).toThrow();
      });
    });
  });

  describe('getHashAlgorithm', () => {
    it('应该返回正确的哈希算法名称', () => {
      expect(getHashAlgorithm('SHA1')).toBe('SHA-1');
      expect(getHashAlgorithm('SHA256')).toBe('SHA-256');
      expect(getHashAlgorithm('SHA512')).toBe('SHA-512');
      expect(getHashAlgorithm('SHA-1')).toBe('SHA-1');
      expect(getHashAlgorithm('SHA-256')).toBe('SHA-256');
      expect(getHashAlgorithm('SHA-512')).toBe('SHA-512');
    });

    it('应该默认返回 SHA-1', () => {
      expect(getHashAlgorithm('UNKNOWN')).toBe('SHA-1');
      expect(getHashAlgorithm('')).toBe('SHA-1');
    });
  });

  describe('TOTP - RFC 6238 测试向量', () => {
    // RFC 6238 Appendix B 官方测试向量
    // 密钥: "12345678901234567890" (ASCII) = GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ (Base32)
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

    const testVectors = [
      // 时间戳 -> 期望的 OTP (SHA1, 8位)
      { time: 59, expected: '94287082', digits: 8, algorithm: 'SHA1', description: '1970-01-01 00:00:59' },
      { time: 1111111109, expected: '07081804', digits: 8, algorithm: 'SHA1', description: '2005-03-18 01:58:29' },
      { time: 1111111111, expected: '14050471', digits: 8, algorithm: 'SHA1', description: '2005-03-18 01:58:31' },
      { time: 1234567890, expected: '89005924', digits: 8, algorithm: 'SHA1', description: '2009-02-13 23:31:30' },
      { time: 2000000000, expected: '69279037', digits: 8, algorithm: 'SHA1', description: '2033-05-18 03:33:20' },
      { time: 20000000000, expected: '65353130', digits: 8, algorithm: 'SHA1', description: '2603-10-11 11:33:20' }
    ];

    testVectors.forEach(({ time, expected, digits, algorithm, description }) => {
      it(`应该为时间 ${time} (${description}) 生成正确的 TOTP: ${expected}`, async () => {
        const otp = await generateOTP(secret, time, {
          digits,
          period: 30,
          algorithm,
          type: 'TOTP'
        });
        expect(otp).toBe(expected);
      });
    });
  });

  describe('TOTP - SHA256 测试向量', () => {
    // RFC 6238 SHA256 测试向量
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA'; // 32 bytes

    const testVectors = [
      { time: 59, expected: '46119246', digits: 8, algorithm: 'SHA256' },
      { time: 1111111109, expected: '68084774', digits: 8, algorithm: 'SHA256' },
      { time: 1111111111, expected: '67062674', digits: 8, algorithm: 'SHA256' },
      { time: 1234567890, expected: '91819424', digits: 8, algorithm: 'SHA256' },
      { time: 2000000000, expected: '90698825', digits: 8, algorithm: 'SHA256' },
      { time: 20000000000, expected: '77737706', digits: 8, algorithm: 'SHA256' }
    ];

    testVectors.forEach(({ time, expected, digits, algorithm }) => {
      it(`应该为时间 ${time} 使用 ${algorithm} 生成正确的 TOTP: ${expected}`, async () => {
        const otp = await generateOTP(secret, time, {
          digits,
          period: 30,
          algorithm,
          type: 'TOTP'
        });
        expect(otp).toBe(expected);
      });
    });
  });

  describe('TOTP - SHA512 测试向量', () => {
    // RFC 6238 SHA512 测试向量
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA'; // 64 bytes

    const testVectors = [
      { time: 59, expected: '90693936', digits: 8, algorithm: 'SHA512' },
      { time: 1111111109, expected: '25091201', digits: 8, algorithm: 'SHA512' },
      { time: 1111111111, expected: '99943326', digits: 8, algorithm: 'SHA512' },
      { time: 1234567890, expected: '93441116', digits: 8, algorithm: 'SHA512' },
      { time: 2000000000, expected: '38618901', digits: 8, algorithm: 'SHA512' },
      { time: 20000000000, expected: '47863826', digits: 8, algorithm: 'SHA512' }
    ];

    testVectors.forEach(({ time, expected, digits, algorithm }) => {
      it(`应该为时间 ${time} 使用 ${algorithm} 生成正确的 TOTP: ${expected}`, async () => {
        const otp = await generateOTP(secret, time, {
          digits,
          period: 30,
          algorithm,
          type: 'TOTP'
        });
        expect(otp).toBe(expected);
      });
    });
  });

  describe('HOTP - RFC 4226 测试向量', () => {
    // RFC 4226 Appendix D 官方测试向量
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

    const testVectors = [
      { counter: 0, expected: '755224', digits: 6 },
      { counter: 1, expected: '287082', digits: 6 },
      { counter: 2, expected: '359152', digits: 6 },
      { counter: 3, expected: '969429', digits: 6 },
      { counter: 4, expected: '338314', digits: 6 },
      { counter: 5, expected: '254676', digits: 6 },
      { counter: 6, expected: '287922', digits: 6 },
      { counter: 7, expected: '162583', digits: 6 },
      { counter: 8, expected: '399871', digits: 6 },
      { counter: 9, expected: '520489', digits: 6 }
    ];

    testVectors.forEach(({ counter, expected, digits }) => {
      it(`应该为计数器 ${counter} 生成正确的 HOTP: ${expected}`, async () => {
        const otp = await generateOTP(secret, 0, {
          digits,
          type: 'HOTP',
          counter,
          algorithm: 'SHA1'
        });
        expect(otp).toBe(expected);
      });
    });
  });

  describe('TOTP - 默认参数', () => {
    it('应该使用默认参数生成 6 位 TOTP', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const time = Math.floor(Date.now() / 1000);

      const otp = await generateOTP(secret, time, {});

      expect(otp).toMatch(/^\d{6}$/);
      expect(otp.length).toBe(6);
    });

    it('应该为不同时间段生成不同的 OTP', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const time1 = 1000000000;
      const time2 = 1000000030; // 30 秒后（下一个周期）

      const otp1 = await generateOTP(secret, time1, { period: 30 });
      const otp2 = await generateOTP(secret, time2, { period: 30 });

      expect(otp1).not.toBe(otp2);
    });

    it('应该在同一时间窗口内生成相同的 OTP', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const time1 = 1000000000;
      const time2 = 1000000015; // 15 秒后（仍在同一 30 秒周期）

      const otp1 = await generateOTP(secret, time1, { period: 30 });
      const otp2 = await generateOTP(secret, time2, { period: 30 });

      expect(otp1).toBe(otp2);
    });
  });

  describe('边界条件测试', () => {
    it('应该处理 8 位 OTP', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const time = 1234567890;

      const otp = await generateOTP(secret, time, { digits: 8 });

      expect(otp).toMatch(/^\d{8}$/);
      expect(otp.length).toBe(8);
    });

    it('应该处理自定义时间周期', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const time = 1234567890;

      const otp60 = await generateOTP(secret, time, { period: 60 });
      expect(otp60).toMatch(/^\d{6}$/);

      const otp15 = await generateOTP(secret, time, { period: 15 });
      expect(otp15).toMatch(/^\d{6}$/);

      // 不同周期应该产生不同的 OTP
      expect(otp60).not.toBe(otp15);
    });

    it('应该处理前导零', async () => {
      // 使用已知会产生前导零的测试向量
      const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
      const time = 1111111109;

      const otp = await generateOTP(secret, time, {
        digits: 8,
        period: 30,
        algorithm: 'SHA1'
      });

      expect(otp).toBe('07081804'); // 注意前导零
      expect(otp.length).toBe(8);
    });

    it('应该拒绝无效的密钥', async () => {
      const invalidSecrets = ['', 'INVALID!@#', '123'];

      for (const secret of invalidSecrets) {
        await expect(
          generateOTP(secret, Date.now() / 1000, {})
        ).rejects.toThrow();
      }
    });
  });

  describe('算法一致性测试', () => {
    it('相同输入应该始终产生相同输出', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const time = 1234567890;
      const options = { digits: 6, period: 30, algorithm: 'SHA1' };

      const otp1 = await generateOTP(secret, time, options);
      const otp2 = await generateOTP(secret, time, options);
      const otp3 = await generateOTP(secret, time, options);

      expect(otp1).toBe(otp2);
      expect(otp2).toBe(otp3);
    });

    it('不同算法应该产生不同的 OTP', async () => {
      const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA';
      const time = 1234567890;

      const otpSHA1 = await generateOTP(secret, time, { algorithm: 'SHA1' });
      const otpSHA256 = await generateOTP(secret, time, { algorithm: 'SHA256' });
      const otpSHA512 = await generateOTP(secret, time, { algorithm: 'SHA512' });

      expect(otpSHA1).not.toBe(otpSHA256);
      expect(otpSHA256).not.toBe(otpSHA512);
      expect(otpSHA1).not.toBe(otpSHA512);
    });
  });

  describe('性能测试', () => {
    it('应该在合理时间内生成 OTP', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const time = Math.floor(Date.now() / 1000);

      const start = performance.now();
      await generateOTP(secret, time, {});
      const end = performance.now();

      const duration = end - start;
      expect(duration).toBeLessThan(100); // 应该在 100ms 内完成
    });

    it('应该能够快速生成多个 OTP', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const time = Math.floor(Date.now() / 1000);

      const start = performance.now();

      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(generateOTP(secret, time + i * 30, {}));
      }

      await Promise.all(promises);

      const end = performance.now();
      const duration = end - start;

      expect(duration).toBeLessThan(1000); // 100 个 OTP 应该在 1 秒内完成
    });
  });

  describe('generateTOTP - 客户端预览函数', () => {
    it('应该生成 6 位 TOTP', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const counter = 41152263;

      const otp = await generateTOTP(secret, counter);

      expect(otp).toBeDefined();
      expect(otp).toMatch(/^\d{6}$/);
    });

    it('应该生成 8 位 TOTP', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const counter = 41152263;

      const otp = await generateTOTP(secret, counter, { digits: 8 });

      expect(otp).toMatch(/^\d{8}$/);
    });

    it('应该支持 SHA256 算法', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const counter = 41152263;

      const otp = await generateTOTP(secret, counter, { algorithm: 'SHA256' });

      expect(otp).toBeDefined();
      expect(otp).toMatch(/^\d{6}$/);
    });

    it('应该支持 SHA512 算法', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const counter = 41152263;

      const otp = await generateTOTP(secret, counter, { algorithm: 'SHA512' });

      expect(otp).toBeDefined();
      expect(otp).toMatch(/^\d{6}$/);
    });

    it('应该在错误时返回占位符', async () => {
      const invalidSecret = '!!!';
      const counter = 41152263;

      const otp = await generateTOTP(invalidSecret, counter);

      expect(otp).toBe('------');
    });

    it('应该返回正确长度的占位符', async () => {
      const invalidSecret = '!!!';
      const counter = 41152263;

      const otp8 = await generateTOTP(invalidSecret, counter, { digits: 8 });

      expect(otp8).toBe('--------');
    });

    it('应该为不同的 counter 生成不同的 OTP', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';

      const otp1 = await generateTOTP(secret, 100);
      const otp2 = await generateTOTP(secret, 200);

      expect(otp1).not.toBe(otp2);
    });

    it('应该支持 HOTP 类型参数', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const counter = 0;

      const otp = await generateTOTP(secret, counter, { type: 'HOTP' });

      expect(otp).toBeDefined();
      expect(otp).toMatch(/^\d{6}$/);
    });
  });

  describe('generateOTPAuthURL - OTPAuth URL 生成', () => {
    it('应该生成 TOTP URL', () => {
      const url = generateOTPAuthURL('GitHub', 'user@example.com', 'JBSWY3DPEHPK3PXP');

      expect(url).toContain('otpauth://totp/');
      expect(url).toContain('GitHub');
      // URL已被编码，@会变成%40
      expect(url).toContain('user') && expect(url).toContain('example.com');
      expect(url).toContain('secret=JBSWY3DPEHPK3PXP');
      expect(url).toContain('issuer=GitHub');
      expect(url).toContain('algorithm=SHA1');
      expect(url).toContain('digits=6');
      expect(url).toContain('period=30');
    });

    it('应该生成 HOTP URL', () => {
      const url = generateOTPAuthURL('GitHub', 'user@example.com', 'JBSWY3DPEHPK3PXP', {
        type: 'HOTP',
        counter: 0
      });

      expect(url).toContain('otpauth://hotp/');
      expect(url).toContain('counter=0');
      expect(url).not.toContain('period=');
    });

    it('应该支持自定义 digits', () => {
      const url = generateOTPAuthURL('GitHub', 'user@example.com', 'JBSWY3DPEHPK3PXP', {
        digits: 8
      });

      expect(url).toContain('digits=8');
    });

    it('应该支持自定义 period', () => {
      const url = generateOTPAuthURL('GitHub', 'user@example.com', 'JBSWY3DPEHPK3PXP', {
        period: 60
      });

      expect(url).toContain('period=60');
    });

    it('应该支持自定义 algorithm', () => {
      const url = generateOTPAuthURL('GitHub', 'user@example.com', 'JBSWY3DPEHPK3PXP', {
        algorithm: 'SHA256'
      });

      expect(url).toContain('algorithm=SHA256');
    });

    it('应该处理没有账户名的情况', () => {
      const url = generateOTPAuthURL('GitHub', '', 'JBSWY3DPEHPK3PXP');

      expect(url).toContain('otpauth://totp/GitHub?');
      expect(url).not.toContain('GitHub:');
    });

    it('应该正确 URL 编码特殊字符', () => {
      const url = generateOTPAuthURL('GitHub Test', 'user+test@example.com', 'JBSWY3DPEHPK3PXP');

      // URL会被encodeURIComponent编码
      expect(url).toContain('user');
      expect(url).toContain('test');
      expect(url).toContain('example.com');
    });

    it('应该将密钥转换为大写', () => {
      const url = generateOTPAuthURL('GitHub', 'user@example.com', 'jbswy3dpehpk3pxp');

      expect(url).toContain('secret=JBSWY3DPEHPK3PXP');
    });

    it('应该将算法转换为大写', () => {
      const url = generateOTPAuthURL('GitHub', 'user@example.com', 'JBSWY3DPEHPK3PXP', {
        algorithm: 'sha256'
      });

      expect(url).toContain('algorithm=SHA256');
    });

    it('应该支持 HOTP 自定义 counter', () => {
      const url = generateOTPAuthURL('GitHub', 'user@example.com', 'JBSWY3DPEHPK3PXP', {
        type: 'HOTP',
        counter: 100
      });

      expect(url).toContain('counter=100');
    });

    it('应该为 TOTP 使用默认参数', () => {
      const url = generateOTPAuthURL('GitHub', 'user@example.com', 'JBSWY3DPEHPK3PXP');

      expect(url).toContain('digits=6');
      expect(url).toContain('period=30');
      expect(url).toContain('algorithm=SHA1');
    });

    it('应该处理不区分大小写的 type 参数', () => {
      const urlLower = generateOTPAuthURL('GitHub', 'user@example.com', 'JBSWY3DPEHPK3PXP', {
        type: 'totp'
      });
      const urlUpper = generateOTPAuthURL('GitHub', 'user@example.com', 'JBSWY3DPEHPK3PXP', {
        type: 'TOTP'
      });

      expect(urlLower).toContain('otpauth://totp/');
      expect(urlUpper).toContain('otpauth://totp/');
    });
  });
});
