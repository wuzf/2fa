/**
 * 加密/解密功能测试
 * 测试 AES-GCM 256位加密
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  encryptData,
  decryptData,
  encryptSecrets,
  decryptSecrets,
  isEncrypted
} from '../../src/utils/encryption.js';

describe('Encryption Utils', () => {
  // 模拟环境对象
  const createMockEnv = (encryptionKey) => ({
    ENCRYPTION_KEY: encryptionKey,
    LOG_LEVEL: 'ERROR'  // 减少测试输出
  });

  // 测试用的加密密钥（32 字节 base64）
  const testEncryptionKey = Buffer.from('12345678901234567890123456789012').toString('base64');
  const wrongEncryptionKey = Buffer.from('wrongkeywrongkeywrongkeywrongke').toString('base64');

  describe('isEncrypted', () => {
    it('应该识别加密的数据', () => {
      expect(isEncrypted('v1:eyJpdiI6...')).toBe(true);
      expect(isEncrypted('v1:randomdata')).toBe(true);
    });

    it('应该识别未加密的数据', () => {
      expect(isEncrypted('[]')).toBe(false);
      expect(isEncrypted('{"key": "value"}')).toBe(false);
      expect(isEncrypted('plain text')).toBe(false);
      expect(isEncrypted(null)).toBe(false);
      expect(isEncrypted(undefined)).toBe(false);
      expect(isEncrypted('')).toBe(false);
    });
  });

  describe('encryptData / decryptData', () => {
    it('应该成功加密和解密简单对象', async () => {
      const env = createMockEnv(testEncryptionKey);
      const originalData = { name: 'Test', value: 123 };

      const encrypted = await encryptData(originalData, env);
      expect(encrypted).toBeDefined();
      expect(encrypted.startsWith('v1:')).toBe(true);

      const decrypted = await decryptData(encrypted, env);
      expect(decrypted).toEqual(originalData);
    });

    it('应该成功加密和解密复杂对象', async () => {
      const env = createMockEnv(testEncryptionKey);
      const originalData = {
        name: 'Complex Test',
        nested: {
          array: [1, 2, 3],
          bool: true,
          null: null
        },
        timestamp: new Date().toISOString()
      };

      const encrypted = await encryptData(originalData, env);
      const decrypted = await decryptData(encrypted, env);

      expect(decrypted).toEqual(originalData);
    });

    it('应该成功加密和解密中文字符', async () => {
      const env = createMockEnv(testEncryptionKey);
      const originalData = {
        name: '测试密钥',
        description: '这是一个包含中文的测试数据',
        emoji: '🔐🔑✅'
      };

      const encrypted = await encryptData(originalData, env);
      const decrypted = await decryptData(encrypted, env);

      expect(decrypted).toEqual(originalData);
    });

    it('应该成功加密和解密大型数据', async () => {
      const env = createMockEnv(testEncryptionKey);
      const largeArray = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        name: `Item ${i}`,
        data: `Data for item ${i}`
      }));

      const encrypted = await encryptData(largeArray, env);
      const decrypted = await decryptData(encrypted, env);

      expect(decrypted).toEqual(largeArray);
      expect(decrypted.length).toBe(1000);
    });

    it('使用错误的密钥应该解密失败', async () => {
      const env1 = createMockEnv(testEncryptionKey);
      const env2 = createMockEnv(wrongEncryptionKey);
      const originalData = { secret: 'sensitive' };

      const encrypted = await encryptData(originalData, env1);

      await expect(decryptData(encrypted, env2)).rejects.toThrow();
    });

    it('应该拒绝无效的加密数据格式', async () => {
      const env = createMockEnv(testEncryptionKey);

      await expect(decryptData('v1:invalid-base64', env)).rejects.toThrow();
      await expect(decryptData('v1:', env)).rejects.toThrow();
      await expect(decryptData('invalid-format', env)).rejects.toThrow();
    });

    it('应该拒绝篡改的数据（完整性检查）', async () => {
      const env = createMockEnv(testEncryptionKey);
      const originalData = { secret: 'sensitive' };

      const encrypted = await encryptData(originalData, env);

      // 尝试篡改密文（改变几个字符）
      // v1:ivBase64:encryptedBase64 格式
      const parts = encrypted.split(':');
      // 篡改加密数据部分（改变 base64 中的字符）
      const tamperedEncryptedPart = parts[2].substring(0, parts[2].length - 5) + 'XXXXX';
      const tamperedData = `${parts[0]}:${parts[1]}:${tamperedEncryptedPart}`;

      await expect(decryptData(tamperedData, env)).rejects.toThrow();
    });

    it('encryptData 要求必须配置加密密钥', async () => {
      const envWithoutKey = createMockEnv(null);
      const originalData = { name: 'Test' };

      // encryptData 必须有密钥，否则抛出错误
      await expect(encryptData(originalData, envWithoutKey)).rejects.toThrow('ENCRYPTION_KEY');
    });

    it('每次加密应该产生不同的密文（IV 随机性）', async () => {
      const env = createMockEnv(testEncryptionKey);
      const originalData = { name: 'Test' };

      const encrypted1 = await encryptData(originalData, env);
      const encrypted2 = await encryptData(originalData, env);

      // 相同数据的两次加密应该产生不同的密文（因为 IV 随机）
      expect(encrypted1).not.toBe(encrypted2);

      // 但解密后应该得到相同的数据
      const decrypted1 = await decryptData(encrypted1, env);
      const decrypted2 = await decryptData(encrypted2, env);
      expect(decrypted1).toEqual(originalData);
      expect(decrypted2).toEqual(originalData);
    });
  });

  describe('encryptSecrets / decryptSecrets', () => {
    const testSecrets = [
      {
        id: '1',
        name: 'GitHub',
        account: 'user@example.com',
        secret: 'JBSWY3DPEHPK3PXP',
        type: 'TOTP',
        digits: 6,
        period: 30,
        algorithm: 'SHA1'
      },
      {
        id: '2',
        name: 'Google',
        account: 'test@gmail.com',
        secret: 'MFRGGZDFMZTWQ2LK',
        type: 'TOTP',
        digits: 6,
        period: 30,
        algorithm: 'SHA1'
      }
    ];

    it('应该成功加密和解密密钥数组', async () => {
      const env = createMockEnv(testEncryptionKey);

      const encrypted = await encryptSecrets(testSecrets, env);
      expect(encrypted).toBeDefined();
      expect(isEncrypted(encrypted)).toBe(true);

      const decrypted = await decryptSecrets(encrypted, env);
      expect(decrypted).toEqual(testSecrets);
    });

    it('应该处理空数组', async () => {
      const env = createMockEnv(testEncryptionKey);

      const encrypted = await encryptSecrets([], env);
      const decrypted = await decryptSecrets(encrypted, env);

      expect(decrypted).toEqual([]);
    });

    it('应该处理 null 输入', async () => {
      const env = createMockEnv(testEncryptionKey);

      const decrypted = await decryptSecrets(null, env);
      expect(decrypted).toEqual([]);
    });

    it('应该处理明文 JSON 格式（向后兼容）', async () => {
      const env = createMockEnv(testEncryptionKey);
      const plainJson = JSON.stringify(testSecrets);

      const decrypted = await decryptSecrets(plainJson, env);
      expect(decrypted).toEqual(testSecrets);
    });

    it('没有加密密钥时应该以明文存储', async () => {
      const envWithoutKey = createMockEnv(null);

      const result = await encryptSecrets(testSecrets, envWithoutKey);

      // 没有密钥时，应该返回 JSON 字符串
      expect(isEncrypted(result)).toBe(false);
      expect(JSON.parse(result)).toEqual(testSecrets);

      // 应该能够直接解析
      const decrypted = await decryptSecrets(result, envWithoutKey);
      expect(decrypted).toEqual(testSecrets);
    });
  });

  describe('性能测试', () => {
    it('加密应该在合理时间内完成', async () => {
      const env = createMockEnv(testEncryptionKey);
      const data = { test: 'data', value: 123 };

      const start = performance.now();
      await encryptData(data, env);
      const end = performance.now();

      expect(end - start).toBeLessThan(100); // 应该在 100ms 内完成
    });

    it('解密应该在合理时间内完成', async () => {
      const env = createMockEnv(testEncryptionKey);
      const data = { test: 'data', value: 123 };

      const encrypted = await encryptData(data, env);

      const start = performance.now();
      await decryptData(encrypted, env);
      const end = performance.now();

      expect(end - start).toBeLessThan(100); // 应该在 100ms 内完成
    });

    it('应该能够快速处理多个加密操作', async () => {
      const env = createMockEnv(testEncryptionKey);

      const start = performance.now();

      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(encryptData({ id: i, data: `test-${i}` }, env));
      }

      await Promise.all(promises);

      const end = performance.now();

      expect(end - start).toBeLessThan(2000); // 100 次加密应该在 2 秒内完成
    });
  });

  describe('边界条件', () => {
    it('应该处理空对象', async () => {
      const env = createMockEnv(testEncryptionKey);

      const encrypted = await encryptData({}, env);
      const decrypted = await decryptData(encrypted, env);

      expect(decrypted).toEqual({});
    });

    it('应该处理特殊字符', async () => {
      const env = createMockEnv(testEncryptionKey);
      const specialData = {
        symbols: '!@#$%^&*()_+-=[]{}|;:",.<>?/',
        unicode: '你好世界🌍',
        newlines: 'line1\nline2\rline3\r\nline4',
        tabs: 'col1\tcol2\tcol3'
      };

      const encrypted = await encryptData(specialData, env);
      const decrypted = await decryptData(encrypted, env);

      expect(decrypted).toEqual(specialData);
    });

    it('应该处理嵌套深度很大的对象', async () => {
      const env = createMockEnv(testEncryptionKey);

      // 创建深度嵌套的对象
      let deepObj = { value: 'deep' };
      for (let i = 0; i < 50; i++) {
        deepObj = { nested: deepObj };
      }

      const encrypted = await encryptData(deepObj, env);
      const decrypted = await decryptData(encrypted, env);

      expect(decrypted).toEqual(deepObj);
    });

    it('应该处理包含 undefined 的数据（JSON 序列化特性）', async () => {
      const env = createMockEnv(testEncryptionKey);
      const dataWithUndefined = {
        defined: 'value',
        undefined: undefined
      };

      const encrypted = await encryptData(dataWithUndefined, env);
      const decrypted = await decryptData(encrypted, env);

      // JSON.stringify 会移除 undefined 字段
      expect(decrypted).toEqual({ defined: 'value' });
    });
  });

  describe('密钥格式验证', () => {
    it('应该拒绝过短的密钥', async () => {
      const shortKey = Buffer.from('shortkey').toString('base64');
      const env = createMockEnv(shortKey);
      const data = { test: 'data' };

      await expect(encryptData(data, env)).rejects.toThrow();
    });

    it('应该拒绝无效的 base64 密钥', async () => {
      const invalidKey = 'not-valid-base64!!!';
      const env = createMockEnv(invalidKey);
      const data = { test: 'data' };

      await expect(encryptData(data, env)).rejects.toThrow();
    });
  });
});
