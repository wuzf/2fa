/**
 * 导入加密解密模块
 * 包含 TOTP Authenticator、FreeOTP 等加密备份的解密功能
 */

/**
 * 获取 TOTP Authenticator 解密代码
 * @returns {string} JavaScript 代码
 */
export function getTOTPAuthDecryptCode() {
	return `
    // ========== TOTP Authenticator 解密 ==========

    // TOTP Authenticator 备份数据（临时存储）
    let totpAuthBackupData = null;

    /**
     * 检测是否是 TOTP Authenticator 加密备份格式
     * @param {string} content - 文件内容
     * @returns {boolean} 是否是 TOTP Authenticator 格式
     */
    function isTOTPAuthenticatorBackup(content) {
      // TOTP Authenticator 加密备份是纯 Base64 编码
      // 检测：只包含 Base64 字符，没有其他结构
      const trimmed = content.trim();
      // Base64 字符集: A-Z, a-z, 0-9, +, /, =
      const base64Regex = /^[A-Za-z0-9+/=]+$/;
      // 不是 JSON, 不是 XML, 不是 HTML, 只是纯 Base64
      if (base64Regex.test(trimmed) &&
          !trimmed.startsWith('{') &&
          !trimmed.startsWith('[') &&
          !trimmed.startsWith('<') &&
          trimmed.length > 100) {
        // 尝试 Base64 解码检查长度是否合理（AES 块大小的倍数）
        try {
          const decoded = atob(trimmed);
          return decoded.length > 0 && decoded.length % 16 === 0;
        } catch (e) {
          return false;
        }
      }
      return false;
    }

    /**
     * 解密 TOTP Authenticator 加密备份
     * 加密方式: AES-256-CBC, 密钥 = SHA256(password), IV = 16 字节 0x00
     * @param {string} content - Base64 编码的加密内容
     * @param {string} password - 解密密码
     * @returns {Array<string>} otpauth:// URL 数组
     */
    async function decryptTOTPAuthenticatorBackup(content, password) {
      const trimmed = content.trim();

      // 生成密钥: SHA256(password)
      const encoder = new TextEncoder();
      const passwordData = encoder.encode(password);
      const keyHash = await crypto.subtle.digest('SHA-256', passwordData);

      // 导入 AES 密钥
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyHash,
        { name: 'AES-CBC' },
        false,
        ['decrypt']
      );

      // IV = 16 字节 0x00
      const iv = new Uint8Array(16);

      // Base64 解码
      const encryptedData = Uint8Array.from(atob(trimmed), c => c.charCodeAt(0));

      // AES-CBC 解密
      const decryptedBuffer = await crypto.subtle.decrypt(
        { name: 'AES-CBC', iv: iv },
        cryptoKey,
        encryptedData
      );

      const decryptedText = new TextDecoder().decode(decryptedBuffer);
      console.log('TOTP Authenticator 解密成功');

      // 解析 JSON
      // 格式: {"[json array string]": "timestamp"}
      const jsonData = JSON.parse(decryptedText);

      // 获取第一个 key（它是一个嵌套的 JSON 数组字符串）
      const keys = Object.keys(jsonData);
      if (keys.length === 0) {
        throw new Error('解密后数据为空');
      }

      const entriesJson = keys[0];
      const entries = JSON.parse(entriesJson);

      const otpauthUrls = [];

      entries.forEach((entry, index) => {
        try {
          const issuer = entry.issuer || '';
          const name = entry.name || '';  // 这是账户名
          let secret = entry.key || '';
          const base = entry.base || 16;  // 默认是十六进制

          // 如果是十六进制格式，转换为 Base32
          if (base === 16 && secret) {
            secret = hexToBase32(secret);
          }

          if (!secret) {
            console.warn('跳过无密钥的 TOTP Authenticator 条目 (索引 ' + index + ')');
            return;
          }

          // 获取其他参数（可能为空字符串）
          const digits = entry.digits ? parseInt(entry.digits) : 6;
          const period = entry.period ? parseInt(entry.period) : 30;

          // 构建 otpauth:// URL
          let label = '';
          if (issuer && name) {
            label = encodeURIComponent(issuer) + ':' + encodeURIComponent(name);
          } else if (issuer) {
            label = encodeURIComponent(issuer);
          } else if (name) {
            label = encodeURIComponent(name);
          } else {
            label = 'Unknown';
          }

          const params = new URLSearchParams();
          params.set('secret', secret);
          if (issuer) params.set('issuer', issuer);
          if (digits !== 6) params.set('digits', digits);
          if (period !== 30) params.set('period', period);

          const otpauthUrl = 'otpauth://totp/' + label + '?' + params.toString();
          otpauthUrls.push(otpauthUrl);

          console.log('TOTP Authenticator 条目 ' + (index + 1) + ':', issuer, name);
        } catch (err) {
          console.error('解析 TOTP Authenticator 条目失败 (索引 ' + index + '):', err);
        }
      });

      console.log('成功解析 TOTP Authenticator 格式,共 ' + otpauthUrls.length + ' 条');
      return otpauthUrls;
    }

    /**
     * 解密并预览 TOTP Authenticator 备份
     */
    async function decryptAndPreviewTOTPAuth() {
      const passwordInput = document.getElementById('totpAuthPassword');
      const password = passwordInput ? passwordInput.value : '';

      if (!password) {
        showCenterToast('❌', '请输入解密密码');
        return;
      }

      try {
        showCenterToast('⏳', '正在解密...');

        const otpauthUrls = await decryptTOTPAuthenticatorBackup(totpAuthBackupData, password);

        if (otpauthUrls.length === 0) {
          showCenterToast('⚠️', '解密成功但未找到有效密钥');
          return;
        }

        // 将解密后的 URL 填入输入框并触发预览
        document.getElementById('importText').value = otpauthUrls.join('\\n');

        // 隐藏密码输入区
        document.getElementById('totpAuthPasswordSection').style.display = 'none';

        // 触发预览
        previewImport();

        showCenterToast('✅', '解密成功，共 ' + otpauthUrls.length + ' 条');
      } catch (error) {
        console.error('TOTP Authenticator 解密失败:', error);
        if (error.message && error.message.includes('decrypt')) {
          showCenterToast('❌', '解密失败：密码错误');
        } else {
          showCenterToast('❌', '解密失败：' + (error.message || '未知错误'));
        }
      }
    }
`;
}

/**
 * 获取 FreeOTP 解密代码
 * @returns {string} JavaScript 代码
 */
export function getFreeOTPDecryptCode() {
	return `
    // ========== FreeOTP 解密 ==========

    // FreeOTP 备份数据（临时存储）
    let freeotpBackupData = null;

    /**
     * 解析 FreeOTP 加密备份格式（Java 序列化的 HashMap）
     * @param {string} content - 文件内容
     * @returns {Object|null} 解析结果，包含 tokens 和 masterKey
     */
    function parseFreeOTPBackup(content) {
      // 检测是否是 FreeOTP 备份格式（Java 序列化头）
      if (!content.includes('java.util.HashMap') && !content.includes('masterKey')) {
        return null;
      }

      const result = {
        tokens: {},      // uuid -> { encrypted key data }
        tokenMeta: {},   // uuid -> { algo, digits, issuerExt, label, period, type }
        masterKey: null  // masterKey data
      };

      try {
        // 使用正则表达式提取 token 元数据（明文 JSON）
        const tokenMetaRegex = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-token[^{]*({[^}]+})/gi;
        let match;
        while ((match = tokenMetaRegex.exec(content)) !== null) {
          const uuid = match[1];
          try {
            const meta = JSON.parse(match[2]);
            result.tokenMeta[uuid] = meta;
          } catch (e) {
            // 解析失败时静默跳过
          }
        }

        // 提取 masterKey
        const masterKeyStart = content.indexOf('"mAlgorithm"');
        if (masterKeyStart !== -1) {
          let jsonStart = masterKeyStart;
          while (jsonStart > 0 && content[jsonStart] !== '{') {
            jsonStart--;
          }

          let braceCount = 0;
          let jsonEnd = jsonStart;
          for (let i = jsonStart; i < content.length; i++) {
            if (content[i] === '{') braceCount++;
            if (content[i] === '}') {
              braceCount--;
              if (braceCount === 0) {
                jsonEnd = i + 1;
                break;
              }
            }
          }

          if (jsonEnd > jsonStart) {
            try {
              const masterKeyJson = content.substring(jsonStart, jsonEnd);
              result.masterKey = JSON.parse(masterKeyJson);
            } catch (e) {
              // masterKey 解析失败时静默跳过
            }
          }
        }

        // 检查是否成功解析
        if (Object.keys(result.tokenMeta).length > 0) {
          return result;
        }
      } catch (error) {
        // 解析失败时静默返回 null
      }

      return null;
    }

    /**
     * 解密并预览 FreeOTP 备份
     */
    async function decryptAndPreviewFreeOTP() {
      const passwordInput = document.getElementById('freeotpPassword');
      const password = passwordInput ? passwordInput.value : '';

      if (!password) {
        showCenterToast('❌', '请输入解密密码');
        return;
      }

      try {
        showCenterToast('⏳', '正在解密...');

        const otpauthUrls = await decryptFreeOTPBackup(freeotpBackupData, password);

        if (otpauthUrls.length === 0) {
          showCenterToast('⚠️', '解密成功但未找到有效密钥');
          return;
        }

        // 将解密后的 URL 填入输入框并触发预览
        document.getElementById('importText').value = otpauthUrls.join('\\n');

        // 隐藏密码输入区
        document.getElementById('freeotpPasswordSection').style.display = 'none';

        // 触发预览
        previewImport();

        showCenterToast('✅', '解密成功，共 ' + otpauthUrls.length + ' 条');
      } catch (error) {
        console.error('FreeOTP 解密失败:', error);
        if (error.message && error.message.includes('decrypt')) {
          showCenterToast('❌', '解密失败：密码错误');
        } else {
          showCenterToast('❌', '解密失败：' + (error.message || '未知错误'));
        }
      }
    }
`;
}
