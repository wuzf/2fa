/**
 * JWT 认证功能测试
 * 测试密码哈希、JWT 生成/验证、Cookie 处理
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { requiresAuth } from '../../src/utils/auth.js';

/**
 * 由于 auth.js 中的关键函数未导出，我们需要复制它们用于测试
 * 这些是实际生产代码的副本，用于单元测试
 */

// ==================== 密码强度验证 ====================
const PASSWORD_MIN_LENGTH = 8;

function validatePasswordStrength(password) {
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    return {
      valid: false,
      message: `密码长度至少为 ${PASSWORD_MIN_LENGTH} 位`
    };
  }

  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);

  if (!hasUpperCase) {
    return { valid: false, message: '密码必须包含至少一个大写字母' };
  }
  if (!hasLowerCase) {
    return { valid: false, message: '密码必须包含至少一个小写字母' };
  }
  if (!hasNumber) {
    return { valid: false, message: '密码必须包含至少一个数字' };
  }
  if (!hasSymbol) {
    return { valid: false, message: '密码必须包含至少一个特殊字符' };
  }

  return { valid: true, message: '密码强度符合要求' };
}

// ==================== PBKDF2 密码哈希 ====================
const PBKDF2_ITERATIONS = 100000;

async function hashPassword(password) {
  // 🔒 强制验证密码强度（防御性编程）
  const validation = validatePasswordStrength(password);
  if (!validation.valid) {
    throw new Error(`密码强度不足: ${validation.message}`);
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );

  const saltB64 = btoa(String.fromCharCode(...salt));
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));

  return `${saltB64}$${hashB64}`;
}

async function verifyPassword(password, storedHash) {
  try {
    const [saltB64, hashB64] = storedHash.split('$');
    if (!saltB64 || !hashB64) {
      return false;
    }

    const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      passwordBuffer,
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );

    const hashBuffer = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256'
      },
      keyMaterial,
      256
    );

    const calculatedHashB64 = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
    return calculatedHashB64 === hashB64;
  } catch (error) {
    return false;
  }
}

// ==================== JWT 生成和验证 ====================
const JWT_ALGORITHM = 'HS256';
const JWT_EXPIRY_DAYS = 1;

async function generateJWT(payload, secret, expiryDays = JWT_EXPIRY_DAYS) {
  const header = {
    alg: JWT_ALGORITHM,
    typ: 'JWT'
  };

  const now = Math.floor(Date.now() / 1000);
  const jwtPayload = {
    ...payload,
    iat: now,
    exp: now + (expiryDays * 24 * 60 * 60)
  };

  const base64UrlEncode = (str) => {
    return btoa(String.fromCharCode(...new Uint8Array(
      typeof str === 'string' ? new TextEncoder().encode(str) : str
    )))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(jwtPayload));
  const data = `${headerB64}.${payloadB64}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(data)
  );

  const signatureB64 = base64UrlEncode(signature);
  return `${data}.${signatureB64}`;
}

async function verifyJWT(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const [headerB64, payloadB64, signatureB64] = parts;
    const data = `${headerB64}.${payloadB64}`;

    const base64UrlDecode = (str) => {
      str = str.replace(/-/g, '+').replace(/_/g, '/');
      const pad = str.length % 4;
      if (pad) {
        str += '='.repeat(4 - pad);
      }
      const binary = atob(str);
      return new Uint8Array([...binary].map(c => c.charCodeAt(0)));
    };

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const signatureBytes = base64UrlDecode(signatureB64);
    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes,
      encoder.encode(data)
    );

    if (!isValid) {
      return null;
    }

    const payloadBytes = base64UrlDecode(payloadB64);
    const payloadJson = new TextDecoder().decode(payloadBytes);
    const payload = JSON.parse(payloadJson);

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null;
    }

    return payload;
  } catch (error) {
    return null;
  }
}

// ==================== Cookie 处理 ====================
const COOKIE_NAME = 'auth_token';
const COOKIE_MAX_AGE = JWT_EXPIRY_DAYS * 24 * 60 * 60;

function createSetCookieHeader(token, maxAge = COOKIE_MAX_AGE) {
  const cookieAttributes = [
    `${COOKIE_NAME}=${token}`,
    `Max-Age=${maxAge}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Secure'
  ];

  return cookieAttributes.join('; ');
}

function getTokenFromCookie(request) {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
    const [name, value] = cookie.trim().split('=');
    acc[name] = value;
    return acc;
  }, {});

  return cookies[COOKIE_NAME] || null;
}

// ==================== 测试套件 ====================

describe('JWT Authentication Utils', () => {

  describe('validatePasswordStrength', () => {
    it('应该拒绝过短的密码', () => {
      const result = validatePasswordStrength('Short1!');
      expect(result.valid).toBe(false);
      expect(result.message).toContain('至少为 8 位');
    });

    it('应该拒绝缺少大写字母的密码', () => {
      const result = validatePasswordStrength('password123!');
      expect(result.valid).toBe(false);
      expect(result.message).toContain('大写字母');
    });

    it('应该拒绝缺少小写字母的密码', () => {
      const result = validatePasswordStrength('PASSWORD123!');
      expect(result.valid).toBe(false);
      expect(result.message).toContain('小写字母');
    });

    it('应该拒绝缺少数字的密码', () => {
      const result = validatePasswordStrength('Password!@#');
      expect(result.valid).toBe(false);
      expect(result.message).toContain('数字');
    });

    it('应该拒绝缺少特殊字符的密码', () => {
      const result = validatePasswordStrength('Password123');
      expect(result.valid).toBe(false);
      expect(result.message).toContain('特殊字符');
    });

    it('应该接受强密码', () => {
      const result = validatePasswordStrength('StrongPass123!');
      expect(result.valid).toBe(true);
      expect(result.message).toContain('符合要求');
    });

    it('应该接受包含多种特殊字符的密码', () => {
      const passwords = [
        'Valid123!@#',
        'Valid123$%^',
        'Valid123&*()',
        'Valid123-_=+'
      ];

      passwords.forEach(password => {
        const result = validatePasswordStrength(password);
        expect(result.valid).toBe(true);
      });
    });

    it('应该处理 null 和 undefined', () => {
      expect(validatePasswordStrength(null).valid).toBe(false);
      expect(validatePasswordStrength(undefined).valid).toBe(false);
      expect(validatePasswordStrength('').valid).toBe(false);
    });
  });

  describe('hashPassword / verifyPassword', () => {
    it('应该成功哈希密码', async () => {
      const password = 'TestPass123!';
      const hash = await hashPassword(password);

      expect(hash).toBeDefined();
      expect(hash).toContain('$'); // 格式：salt$hash
      expect(hash.split('$').length).toBe(2);
    });

    it('应该验证正确的密码', async () => {
      const password = 'CorrectPass123!';
      const hash = await hashPassword(password);
      const isValid = await verifyPassword(password, hash);

      expect(isValid).toBe(true);
    });

    it('应该拒绝错误的密码', async () => {
      const correctPassword = 'CorrectPass123!';
      const wrongPassword = 'WrongPass456!';
      const hash = await hashPassword(correctPassword);
      const isValid = await verifyPassword(wrongPassword, hash);

      expect(isValid).toBe(false);
    });

    it('每次哈希应该产生不同的结果（盐值随机）', async () => {
      const password = 'SamePass123!';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);

      // 不同的盐值导致不同的哈希
      expect(hash1).not.toBe(hash2);

      // 但都能验证相同的密码
      expect(await verifyPassword(password, hash1)).toBe(true);
      expect(await verifyPassword(password, hash2)).toBe(true);
    });

    it('应该拒绝无效的哈希格式', async () => {
      const password = 'TestPass123!';

      // 无 $ 分隔符
      expect(await verifyPassword(password, 'invalidhash')).toBe(false);

      // 只有盐值没有哈希
      expect(await verifyPassword(password, 'salt$')).toBe(false);

      // 只有哈希没有盐值
      expect(await verifyPassword(password, '$hash')).toBe(false);

      // 空字符串
      expect(await verifyPassword(password, '')).toBe(false);
    });

    it('应该处理中文和特殊字符密码', async () => {
      const passwords = [
        '你好世界123!Aa',
        'Пароль123!Aa',
        'مرحبا123!Aa',
        'Pass🔐🔑123!Aa'
      ];

      for (const password of passwords) {
        const hash = await hashPassword(password);
        const isValid = await verifyPassword(password, hash);
        expect(isValid).toBe(true);
      }
    });

    // ==================== 强制密码验证测试 ====================
    it('应该强制验证密码长度（防御性编程）', async () => {
      const weakPassword = 'short';

      await expect(async () => {
        await hashPassword(weakPassword);
      }).rejects.toThrow('密码强度不足');
    });

    it('应该强制验证密码包含大写字母', async () => {
      const weakPassword = 'noupperca$e123';

      await expect(async () => {
        await hashPassword(weakPassword);
      }).rejects.toThrow('密码必须包含至少一个大写字母');
    });

    it('应该强制验证密码包含小写字母', async () => {
      const weakPassword = 'NOLOWERCASE123!';

      await expect(async () => {
        await hashPassword(weakPassword);
      }).rejects.toThrow('密码必须包含至少一个小写字母');
    });

    it('应该强制验证密码包含数字', async () => {
      const weakPassword = 'NoNumbers!Aa';

      await expect(async () => {
        await hashPassword(weakPassword);
      }).rejects.toThrow('密码必须包含至少一个数字');
    });

    it('应该强制验证密码包含特殊字符', async () => {
      const weakPassword = 'NoSymbols123Aa';

      await expect(async () => {
        await hashPassword(weakPassword);
      }).rejects.toThrow('密码必须包含至少一个特殊字符');
    });

    it('强密码应该通过强制验证', async () => {
      const strongPassword = 'StrongPass123!';

      // 不应该抛出错误
      const hash = await hashPassword(strongPassword);
      expect(hash).toBeDefined();
      expect(hash).toContain('$');
    });

    it('空密码应该被拒绝', async () => {
      await expect(async () => {
        await hashPassword('');
      }).rejects.toThrow('密码强度不足');

      await expect(async () => {
        await hashPassword(null);
      }).rejects.toThrow('密码强度不足');
    });
  });

  describe('generateJWT / verifyJWT', () => {
    const testSecret = 'test-secret-key';
    const testPayload = { userId: 123, auth: true };

    it('应该生成有效的 JWT token', async () => {
      const token = await generateJWT(testPayload, testSecret);

      expect(token).toBeDefined();
      expect(token.split('.').length).toBe(3); // header.payload.signature

      // 验证 Base64URL 格式（不应包含 +, /, =）
      expect(token).not.toMatch(/[+/=]/);
    });

    it('应该在 payload 中包含 iat 和 exp', async () => {
      const token = await generateJWT(testPayload, testSecret);
      const payload = await verifyJWT(token, testSecret);

      expect(payload).toBeDefined();
      expect(payload.iat).toBeDefined();
      expect(payload.exp).toBeDefined();
      expect(payload.exp).toBeGreaterThan(payload.iat);
    });

    it('应该正确设置过期时间', async () => {
      const expiryDays = 2;
      const token = await generateJWT(testPayload, testSecret, expiryDays);
      const payload = await verifyJWT(token, testSecret);

      const expectedExpiry = payload.iat + (expiryDays * 24 * 60 * 60);
      expect(payload.exp).toBe(expectedExpiry);
    });

    it('应该成功验证有效的 token', async () => {
      const token = await generateJWT(testPayload, testSecret);
      const payload = await verifyJWT(token, testSecret);

      expect(payload).toBeDefined();
      expect(payload.userId).toBe(testPayload.userId);
      expect(payload.auth).toBe(testPayload.auth);
    });

    it('应该拒绝错误密钥签名的 token', async () => {
      const token = await generateJWT(testPayload, testSecret);
      const wrongSecret = 'wrong-secret-key';
      const payload = await verifyJWT(token, wrongSecret);

      expect(payload).toBeNull();
    });

    it('应该拒绝篡改的 token', async () => {
      const token = await generateJWT(testPayload, testSecret);

      // 篡改 payload 部分
      const parts = token.split('.');
      const tamperedPayloadB64 = parts[1].substring(0, parts[1].length - 5) + 'XXXXX';
      const tamperedToken = `${parts[0]}.${tamperedPayloadB64}.${parts[2]}`;

      const payload = await verifyJWT(tamperedToken, testSecret);
      expect(payload).toBeNull();
    });

    it('应该拒绝格式错误的 token', async () => {
      const invalidTokens = [
        'invalid.token',           // 只有两部分
        'invalid',                  // 只有一部分
        'a.b.c.d',                 // 四部分
        '',                        // 空字符串
        'header.payload.'          // 缺少签名
      ];

      for (const invalidToken of invalidTokens) {
        const payload = await verifyJWT(invalidToken, testSecret);
        expect(payload).toBeNull();
      }
    });

    it('应该拒绝过期的 token', async () => {
      // 创建一个已过期的 token（过期时间为 -1 天）
      const expiredToken = await generateJWT(testPayload, testSecret, -1);
      const payload = await verifyJWT(expiredToken, testSecret);

      expect(payload).toBeNull();
    });

    it('应该处理包含特殊字符的 payload', async () => {
      const specialPayload = {
        name: '用户名123',
        emoji: '🔐🔑',
        symbols: '!@#$%^&*()',
        nested: {
          array: [1, 2, 3],
          bool: true,
          null: null
        }
      };

      const token = await generateJWT(specialPayload, testSecret);
      const payload = await verifyJWT(token, testSecret);

      expect(payload).toBeDefined();
      expect(payload.name).toBe(specialPayload.name);
      expect(payload.emoji).toBe(specialPayload.emoji);
      expect(payload.symbols).toBe(specialPayload.symbols);
      expect(payload.nested).toEqual(specialPayload.nested);
    });
  });

  describe('createSetCookieHeader', () => {
    it('应该创建包含所有安全属性的 Cookie header', () => {
      const token = 'test-jwt-token';
      const cookieHeader = createSetCookieHeader(token);

      expect(cookieHeader).toContain('auth_token=test-jwt-token');
      expect(cookieHeader).toContain('Max-Age=86400'); // 1天 = 86400秒
      expect(cookieHeader).toContain('Path=/');
      expect(cookieHeader).toContain('HttpOnly');
      expect(cookieHeader).toContain('SameSite=Strict');
      expect(cookieHeader).toContain('Secure');
    });

    it('应该支持自定义 maxAge', () => {
      const token = 'test-jwt-token';
      const customMaxAge = 3600; // 1小时
      const cookieHeader = createSetCookieHeader(token, customMaxAge);

      expect(cookieHeader).toContain('Max-Age=3600');
    });

    it('应该使用分号和空格分隔属性', () => {
      const token = 'test-jwt-token';
      const cookieHeader = createSetCookieHeader(token);

      const attributes = cookieHeader.split('; ');
      expect(attributes.length).toBeGreaterThan(4);
      expect(attributes[0]).toBe('auth_token=test-jwt-token');
    });
  });

  describe('getTokenFromCookie', () => {
    it('应该从 Cookie header 中提取 token', () => {
      const mockRequest = {
        headers: new Headers({
          'Cookie': 'auth_token=my-jwt-token; other_cookie=value'
        })
      };

      const token = getTokenFromCookie(mockRequest);
      expect(token).toBe('my-jwt-token');
    });

    it('应该处理单个 Cookie', () => {
      const mockRequest = {
        headers: new Headers({
          'Cookie': 'auth_token=single-token'
        })
      };

      const token = getTokenFromCookie(mockRequest);
      expect(token).toBe('single-token');
    });

    it('应该处理多个 Cookie', () => {
      const mockRequest = {
        headers: new Headers({
          'Cookie': 'first=value1; auth_token=my-token; last=value2'
        })
      };

      const token = getTokenFromCookie(mockRequest);
      expect(token).toBe('my-token');
    });

    it('应该处理带空格的 Cookie header', () => {
      const mockRequest = {
        headers: new Headers({
          'Cookie': '  auth_token=my-token  ;  other=value  '
        })
      };

      const token = getTokenFromCookie(mockRequest);
      expect(token).toBe('my-token');
    });

    it('应该在缺少 Cookie header 时返回 null', () => {
      const mockRequest = {
        headers: new Headers({})
      };

      const token = getTokenFromCookie(mockRequest);
      expect(token).toBeNull();
    });

    it('应该在找不到目标 Cookie 时返回 null', () => {
      const mockRequest = {
        headers: new Headers({
          'Cookie': 'other_cookie=value; another=value2'
        })
      };

      const token = getTokenFromCookie(mockRequest);
      expect(token).toBeNull();
    });
  });

  describe('requiresAuth', () => {
    it('主页不需要认证', () => {
      expect(requiresAuth('/')).toBe(false);
    });

    it('登录接口不需要认证', () => {
      expect(requiresAuth('/api/login')).toBe(false);
    });

    it('退出登录接口不需要认证', () => {
      expect(requiresAuth('/api/logout')).toBe(false);
    });

    it('刷新 token 接口不需要认证', () => {
      expect(requiresAuth('/api/refresh-token')).toBe(false);
    });

    it('OTP 生成路径不需要认证', () => {
      expect(requiresAuth('/otp/JBSWY3DPEHPK3PXP')).toBe(false);
      expect(requiresAuth('/otp/any-secret-key')).toBe(false);
    });

    it('API 端点需要认证', () => {
      expect(requiresAuth('/api/secrets')).toBe(true);
      expect(requiresAuth('/api/secrets/123')).toBe(true);
      expect(requiresAuth('/api/backup')).toBe(true);
      expect(requiresAuth('/api/import')).toBe(true);
    });

    it('其他路径不需要认证', () => {
      expect(requiresAuth('/manifest.json')).toBe(false);
      expect(requiresAuth('/favicon.ico')).toBe(false);
      expect(requiresAuth('/sw.js')).toBe(false);
    });
  });

  describe('性能测试', () => {
    it('密码哈希应该在合理时间内完成', async () => {
      const password = 'TestPass123!';

      const start = performance.now();
      await hashPassword(password);
      const end = performance.now();

      // PBKDF2 with 100,000 iterations - 应该在 500ms 内完成
      expect(end - start).toBeLessThan(500);
    });

    it('密码验证应该在合理时间内完成', async () => {
      const password = 'TestPass123!';
      const hash = await hashPassword(password);

      const start = performance.now();
      await verifyPassword(password, hash);
      const end = performance.now();

      // 应该在 500ms 内完成
      expect(end - start).toBeLessThan(500);
    });

    it('JWT 生成应该快速', async () => {
      const payload = { userId: 123, auth: true };
      const secret = 'test-secret';

      const start = performance.now();
      await generateJWT(payload, secret);
      const end = performance.now();

      // 应该在 50ms 内完成
      expect(end - start).toBeLessThan(50);
    });

    it('JWT 验证应该快速', async () => {
      const payload = { userId: 123, auth: true };
      const secret = 'test-secret';
      const token = await generateJWT(payload, secret);

      const start = performance.now();
      await verifyJWT(token, secret);
      const end = performance.now();

      // 应该在 50ms 内完成
      expect(end - start).toBeLessThan(50);
    });

    it('应该能够并发处理多个 JWT 操作', async () => {
      const secret = 'test-secret';

      const start = performance.now();

      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(generateJWT({ userId: i }, secret));
      }

      const tokens = await Promise.all(promises);

      const end = performance.now();

      expect(tokens.length).toBe(50);
      expect(end - start).toBeLessThan(1000); // 50 次生成应该在 1 秒内完成
    });
  });

  describe('边界条件', () => {
    it('应该处理空 payload 的 JWT', async () => {
      const secret = 'test-secret';
      const token = await generateJWT({}, secret);
      const payload = await verifyJWT(token, secret);

      expect(payload).toBeDefined();
      expect(payload.iat).toBeDefined();
      expect(payload.exp).toBeDefined();
    });

    it('应该处理极长的密码', async () => {
      const longPassword = 'A1!' + 'a'.repeat(1000);
      const hash = await hashPassword(longPassword);
      const isValid = await verifyPassword(longPassword, hash);

      expect(isValid).toBe(true);
    });

    it('应该处理极长的 JWT payload', async () => {
      const secret = 'test-secret';
      const largePayload = {
        data: 'x'.repeat(10000),
        array: Array.from({ length: 100 }, (_, i) => ({ id: i, value: `item-${i}` }))
      };

      const token = await generateJWT(largePayload, secret);
      const payload = await verifyJWT(token, secret);

      expect(payload).toBeDefined();
      expect(payload.data.length).toBe(10000);
      expect(payload.array.length).toBe(100);
    });

    it('应该处理包含换行符的密码', async () => {
      const passwordWithNewlines = 'Test\nPass\r\n123!Aa';
      const hash = await hashPassword(passwordWithNewlines);
      const isValid = await verifyPassword(passwordWithNewlines, hash);

      expect(isValid).toBe(true);
    });
  });

  describe('安全特性验证', () => {
    it('相同密码的哈希值应该不同（随机盐）', async () => {
      const password = 'SamePass123!';
      const hashes = [];

      for (let i = 0; i < 10; i++) {
        hashes.push(await hashPassword(password));
      }

      // 所有哈希应该不同
      const uniqueHashes = new Set(hashes);
      expect(uniqueHashes.size).toBe(10);

      // 但都能验证相同的密码
      for (const hash of hashes) {
        expect(await verifyPassword(password, hash)).toBe(true);
      }
    });

    it('相同 payload 的 JWT 应该不同（时间戳）', async () => {
      const secret = 'test-secret';
      const payload = { userId: 123 };

      const token1 = await generateJWT(payload, secret);

      // 等待 1100ms 确保时间戳不同（秒级精度）
      await new Promise(resolve => setTimeout(resolve, 1100));

      const token2 = await generateJWT(payload, secret);

      // Token 应该不同（因为 iat 不同）
      expect(token1).not.toBe(token2);

      // 但都能验证
      expect(await verifyJWT(token1, secret)).toBeDefined();
      expect(await verifyJWT(token2, secret)).toBeDefined();
    });

    it('Cookie 应该包含所有安全属性', () => {
      const cookieHeader = createSetCookieHeader('test-token');

      // HttpOnly: 防止 XSS 攻击
      expect(cookieHeader).toContain('HttpOnly');

      // Secure: 仅在 HTTPS 下传输
      expect(cookieHeader).toContain('Secure');

      // SameSite=Strict: 防止 CSRF 攻击
      expect(cookieHeader).toContain('SameSite=Strict');

      // Path=/: Cookie 作用于整个域
      expect(cookieHeader).toContain('Path=/');
    });

    it('JWT 签名应该使用 HMAC-SHA256', async () => {
      const secret = 'test-secret';
      const token = await generateJWT({ test: true }, secret);

      const [headerB64] = token.split('.');
      const headerBytes = Uint8Array.from(
        atob(headerB64.replace(/-/g, '+').replace(/_/g, '/')),
        c => c.charCodeAt(0)
      );
      const header = JSON.parse(new TextDecoder().decode(headerBytes));

      expect(header.alg).toBe('HS256');
      expect(header.typ).toBe('JWT');
    });

    it('密码哈希应该使用 PBKDF2-SHA256', async () => {
      // 这是一个集成测试，验证 PBKDF2 的行为
      const password = 'TestPass123!';
      const hash = await hashPassword(password);

      // 哈希格式正确
      expect(hash).toMatch(/^[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*$/);

      // 盐值应该是 16 字节 base64（24 个字符）
      const [saltB64] = hash.split('$');
      const saltBytes = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
      expect(saltBytes.length).toBe(16);

      // 哈希值应该是 32 字节 base64（256 位 = 32 字节 = 44 个 base64 字符）
      const [, hashB64] = hash.split('$');
      const hashBytes = Uint8Array.from(atob(hashB64), c => c.charCodeAt(0));
      expect(hashBytes.length).toBe(32);
    });
  });
});
