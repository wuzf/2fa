/**
 * 导入模块
 * 包含所有导入功能，支持多种格式导入（CSV、JSON、HTML、OTPAuth）
 */

/**
 * 获取导入相关代码
 * @returns {string} 导入 JavaScript 代码
 */
export function getImportCode() {
	return `    // ========== 导入功能模块 ==========

    // 导入预览数据
    let importPreviewData = [];

    // 自动预览防抖计时器
    let autoPreviewTimer = null;

    /**
     * 字节数组转 Base32 编码
     * 用于处理 FreeOTP+ 旧版本的字节数组格式密钥
     * @param {Array<number>} bytes - 字节数组
     * @returns {string} Base32 编码字符串
     */
    function bytesToBase32(bytes) {
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
      let result = '';
      let bits = 0;
      let value = 0;

      for (let i = 0; i < bytes.length; i++) {
        // 处理有符号字节（Java 导出可能是 -128 到 127）
        let byte = bytes[i];
        if (byte < 0) byte += 256;

        value = (value << 8) | byte;
        bits += 8;

        while (bits >= 5) {
          bits -= 5;
          result += alphabet[(value >> bits) & 0x1f];
        }
      }

      // 处理剩余位
      if (bits > 0) {
        result += alphabet[(value << (5 - bits)) & 0x1f];
      }

      return result;
    }

    /**
     * 十六进制字符串转 Base32 编码
     * 用于处理 TOTP Authenticator 的十六进制格式密钥
     * @param {string} hex - 十六进制字符串
     * @returns {string} Base32 编码字符串
     */
    function hexToBase32(hex) {
      // 十六进制转字节数组
      const bytes = [];
      for (let i = 0; i < hex.length; i += 2) {
        bytes.push(parseInt(hex.substr(i, 2), 16));
      }
      // 使用现有的 bytesToBase32 函数
      return bytesToBase32(bytes);
    }

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
        // 格式: {uuid}-tokent {json}
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

        // 提取加密的密钥数据
        // 格式: {uuid}t {"key":"{...}"}
        // 注意：key 的值是双层转义的 JSON 字符串，需要特殊处理
        const uuidRegex = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?!-token)/gi;
        while ((match = uuidRegex.exec(content)) !== null) {
          const uuid = match[1];
          // 已经在 tokenMeta 中的 UUID 跳过（那些是 xxx-token 格式）
          if (result.tokenMeta[uuid]) {
            // 查找这个 UUID 后面的 {"key":"..."} 结构
            const startPos = match.index + uuid.length;
            const keyMarker = '{"key":"';
            const keyStart = content.indexOf(keyMarker, startPos);
            if (keyStart !== -1 && keyStart < startPos + 50) {
              // 找到完整的 JSON 对象（处理嵌套的转义）
              let depth = 0;
              let inString = false;
              let escape = false;
              let jsonEnd = -1;

              for (let i = keyStart; i < content.length; i++) {
                const char = content[i];
                if (escape) {
                  escape = false;
                  continue;
                }
                if (char === '\\\\') {
                  escape = true;
                  continue;
                }
                if (char === '"' && !escape) {
                  inString = !inString;
                }
                if (!inString) {
                  if (char === '{') depth++;
                  if (char === '}') {
                    depth--;
                    if (depth === 0) {
                      jsonEnd = i + 1;
                      break;
                    }
                  }
                }
              }

              if (jsonEnd > keyStart) {
                try {
                  const keyJson = content.substring(keyStart, jsonEnd);
                  const keyData = JSON.parse(keyJson);
                  if (keyData.key) {
                    result.tokens[uuid] = JSON.parse(keyData.key);
                  }
                } catch (e) {
                  // 解析失败时静默跳过
                }
              }
            }
          }
        }

        // 提取 masterKey
        // 格式: masterKeyt{"mAlgorithm":...}
        // 查找包含 mAlgorithm 的 JSON 对象
        const masterKeyStart = content.indexOf('"mAlgorithm"');
        if (masterKeyStart !== -1) {
          // 向前找到 { 开始
          let jsonStart = masterKeyStart;
          while (jsonStart > 0 && content[jsonStart] !== '{') {
            jsonStart--;
          }

          // 从 jsonStart 开始找完整的 JSON 对象
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
     * 解密 FreeOTP 备份中的密钥
     * @param {Object} backupData - parseFreeOTPBackup 返回的数据
     * @param {string} password - 用户密码
     * @returns {Promise<Array<string>>} otpauth:// URL 数组
     */
    async function decryptFreeOTPBackup(backupData, password) {
      const otpauthUrls = [];

      try {
        // 1. 使用 PBKDF2 从密码派生密钥
        const masterKeyData = backupData.masterKey;
        if (!masterKeyData) {
          throw new Error('未找到 masterKey 数据');
        }

        const salt = new Uint8Array(masterKeyData.mSalt.map(b => b < 0 ? b + 256 : b));
        const iterations = masterKeyData.mIterations || 100000;

        const passwordBytes = new TextEncoder().encode(password);

        // 导入密码
        const passwordKey = await crypto.subtle.importKey(
          'raw',
          passwordBytes,
          'PBKDF2',
          false,
          ['deriveBits', 'deriveKey']
        );

        // 派生解密 masterKey 的密钥
        const derivedKey = await crypto.subtle.deriveKey(
          {
            name: 'PBKDF2',
            salt: salt,
            iterations: iterations,
            hash: 'SHA-512'
          },
          passwordKey,
          { name: 'AES-GCM', length: 256 },
          false,
          ['decrypt']
        );

        // 2. 解密 masterKey
        const encryptedMasterKey = masterKeyData.mEncryptedKey;
        const masterKeyCipherText = new Uint8Array(
          encryptedMasterKey.mCipherText.map(b => b < 0 ? b + 256 : b)
        );

        // 解析 GCM 参数（ASN.1 格式）
        const masterKeyParams = new Uint8Array(
          encryptedMasterKey.mParameters.map(b => b < 0 ? b + 256 : b)
        );

        // 解析 ASN.1 结构: 30 11 04 0c [12 bytes IV] 02 01 10
        let ivOffset = 4;
        let ivLength = 12;
        if (masterKeyParams[0] === 0x30 && masterKeyParams[2] === 0x04) {
          ivLength = masterKeyParams[3];
        }

        const masterKeyIv = masterKeyParams.slice(ivOffset, ivOffset + ivLength);

        let decryptedMasterKeyBuffer;
        try {
          // 🔑 关键：使用 mToken 作为 AAD (附加认证数据)
          const aad = new TextEncoder().encode(encryptedMasterKey.mToken || 'AES');

          decryptedMasterKeyBuffer = await crypto.subtle.decrypt(
            {
              name: 'AES-GCM',
              iv: masterKeyIv,
              additionalData: aad
            },
            derivedKey,
            masterKeyCipherText
          );
        } catch (decryptError) {
          throw decryptError;
        }

        // 3. 导入解密后的 masterKey
        const masterKey = await crypto.subtle.importKey(
          'raw',
          decryptedMasterKeyBuffer,
          { name: 'AES-GCM' },
          false,
          ['decrypt']
        );

        // 4. 解密每个 token 的密钥
        for (const [uuid, encryptedToken] of Object.entries(backupData.tokens)) {
          const meta = backupData.tokenMeta[uuid];
          if (!meta) {
            continue;
          }

          try {
            const cipherText = new Uint8Array(
              encryptedToken.mCipherText.map(b => b < 0 ? b + 256 : b)
            );
            const params = new Uint8Array(
              encryptedToken.mParameters.map(b => b < 0 ? b + 256 : b)
            );
            // 提取 IV
            const iv = params.slice(4, 16);

            // 🔑 使用 mToken 作为 AAD
            const tokenAad = new TextEncoder().encode(encryptedToken.mToken || 'HmacSHA1');

            const decryptedSecretBuffer = await crypto.subtle.decrypt(
              {
                name: 'AES-GCM',
                iv: iv,
                additionalData: tokenAad
              },
              masterKey,
              cipherText
            );

            // 转换为 Base32
            const secretBytes = new Uint8Array(decryptedSecretBuffer);
            const secret = bytesToBase32(Array.from(secretBytes));

            // 构建 otpauth:// URL
            const issuer = meta.issuerExt || meta.issuerInt || '';
            const account = meta.label || '';
            const type = (meta.type || 'TOTP').toLowerCase();

            let label = '';
            if (issuer && account) {
              label = encodeURIComponent(issuer) + ':' + encodeURIComponent(account);
            } else if (issuer) {
              label = encodeURIComponent(issuer);
            } else if (account) {
              label = encodeURIComponent(account);
            } else {
              label = 'Unknown';
            }

            const params2 = new URLSearchParams();
            params2.set('secret', secret);
            if (issuer) params2.set('issuer', issuer);
            if (meta.digits && meta.digits !== 6) params2.set('digits', meta.digits);
            if (meta.period && meta.period !== 30) params2.set('period', meta.period);
            if (meta.algo && meta.algo !== 'SHA1') params2.set('algorithm', meta.algo);

            const protocol = type === 'hotp' ? 'hotp' : 'totp';
            const otpauthUrl = 'otpauth://' + protocol + '/' + label + '?' + params2.toString();
            otpauthUrls.push(otpauthUrl);
          } catch (tokenError) {
            // 跳过解密失败的 token
          }
        }
      } catch (error) {
        throw error;
      }

      return otpauthUrls;
    }

    // FreeOTP 备份数据（临时存储）
    let freeotpBackupData = null;

    // 自动预览导入（带防抖）
    function autoPreviewImport() {
      // 清除之前的计时器
      if (autoPreviewTimer) {
        clearTimeout(autoPreviewTimer);
      }

      // 设置新的计时器，500ms 后触发预览
      autoPreviewTimer = setTimeout(() => {
        const text = document.getElementById('importText').value.trim();
        if (text) {
          previewImport();
        } else {
          // 如果文本为空，隐藏预览区域并重置按钮
          document.getElementById('importPreview').style.display = 'none';
          document.getElementById('executeImportBtn').disabled = true;
          importPreviewData = [];
        }
      }, 500);
    }

    // ========== 智能输入区拖拽功能 ==========

    // 处理拖拽悬停
    function handleDragOver(event) {
      event.preventDefault();
      event.stopPropagation();
      const textarea = document.getElementById('importText');
      if (textarea) {
        textarea.classList.add('drag-over');
      }
    }

    // 处理拖拽离开
    function handleDragLeave(event) {
      event.preventDefault();
      event.stopPropagation();
      const textarea = document.getElementById('importText');
      if (textarea) {
        textarea.classList.remove('drag-over');
      }
    }

    // 处理文件拖放
    function handleFileDrop(event) {
      event.preventDefault();
      event.stopPropagation();

      const textarea = document.getElementById('importText');
      if (textarea) {
        textarea.classList.remove('drag-over');
      }

      const files = event.dataTransfer.files;
      if (files.length > 0) {
        processImportFile(files[0]);
      }
    }

    // 清除已选文件
    function clearSelectedFile(event) {
      event.stopPropagation();

      // 重置文件输入
      const fileInput = document.getElementById('importFileInput');
      if (fileInput) fileInput.value = '';

      // 隐藏文件信息徽章
      const badge = document.getElementById('fileInfoBadge');
      if (badge) badge.style.display = 'none';

      // 重置文本区域状态
      const textarea = document.getElementById('importText');
      if (textarea) {
        textarea.value = '';
        textarea.classList.remove('has-content');
      }

      // 隐藏预览并禁用导入按钮
      document.getElementById('importPreview').style.display = 'none';
      document.getElementById('executeImportBtn').disabled = true;
      importPreviewData = [];
    }

    // 更新文件信息徽章显示
    function updateFileInfo(file) {
      const badge = document.getElementById('fileInfoBadge');
      const nameEl = document.getElementById('selectedFileName');
      const sizeEl = document.getElementById('selectedFileSize');
      const textarea = document.getElementById('importText');

      if (nameEl) nameEl.textContent = file.name;
      if (sizeEl) sizeEl.textContent = '(' + (file.size / 1024).toFixed(1) + 'KB)';
      if (badge) badge.style.display = 'flex';
      if (textarea) textarea.classList.add('has-content');
    }

    // 处理导入文件（统一处理拖拽和选择）
    function processImportFile(file) {
      if (!file) return;

      // 检查文件类型
      // 支持 .html.txt (Ente Auth 导出格式)
      const validExtensions = ['.txt', '.csv', '.json', '.html', '.htm', '.2fas', '.xml', '.html.txt', '.authpro', '.encrypt'];
      const fileName = file.name.toLowerCase();
      const isValidType = validExtensions.some(ext => fileName.endsWith(ext));

      if (!isValidType) {
        showCenterToast('❌', '不支持的文件格式');
        return;
      }

      // 更新文件信息徽章
      updateFileInfo(file);

      const reader = new FileReader();
      reader.onload = function(e) {
        const content = e.target.result;
        document.getElementById('importText').value = content;

        // 自动预览
        setTimeout(() => {
          previewImport();
        }, 100);
      };
      reader.onerror = function() {
        showCenterToast('❌', '读取文件失败');
      };
      reader.readAsText(file);
    }

    // 更新导入统计信息（新的内联统计）
    function updateImportStats(validCount, invalidCount, skippedCount) {
      const statValid = document.getElementById('statValid');
      const statInvalid = document.getElementById('statInvalid');
      const statTotal = document.getElementById('statTotal');

      if (statValid) statValid.textContent = validCount + ' 有效';
      if (statInvalid) statInvalid.textContent = invalidCount + ' 无效';
      if (statTotal) {
        const total = validCount + invalidCount + (skippedCount || 0);
        statTotal.textContent = '共 ' + total + ' 条';
      }
    }

    // 显示导入模态框
    function showImportModal() {
      showModal('importModal', () => {
        // 清空文本输入框
        const textarea = document.getElementById('importText');
        if (textarea) {
          textarea.value = '';
          textarea.classList.remove('has-content', 'drag-over');
        }
        // 隐藏预览区域
        document.getElementById('importPreview').style.display = 'none';
        // 重置导入按钮
        const executeBtn = document.getElementById('executeImportBtn');
        executeBtn.disabled = true;
        executeBtn.textContent = '📥 导入';
        // 隐藏文件信息徽章
        const badge = document.getElementById('fileInfoBadge');
        if (badge) badge.style.display = 'none';
        // 重置文件输入框
        const fileInput = document.getElementById('importFileInput');
        if (fileInput) fileInput.value = '';
        // 重置统计信息
        updateImportStats(0, 0, 0);
        // 清空预览数据
        importPreviewData = [];
      });
    }

    // 隐藏导入模态框
    function hideImportModal() {
      // 清除自动预览计时器
      if (autoPreviewTimer) {
        clearTimeout(autoPreviewTimer);
        autoPreviewTimer = null;
      }

      hideModal('importModal', () => {
        // 清空文本输入框并重置状态
        const textarea = document.getElementById('importText');
        if (textarea) {
          textarea.value = '';
          textarea.classList.remove('has-content', 'drag-over');
        }
        // 隐藏预览区域
        document.getElementById('importPreview').style.display = 'none';
        // 清空预览列表内容
        const previewList = document.getElementById('importPreviewList');
        if (previewList) {
          previewList.innerHTML = '';
        }
        // 重置导入按钮
        const executeBtn = document.getElementById('executeImportBtn');
        executeBtn.disabled = true;
        executeBtn.textContent = '📥 导入';
        // 清空预览数据数组
        importPreviewData = [];
        // 重置文件输入框，确保下次可以选择同一个文件
        const fileInput = document.getElementById('importFileInput');
        if (fileInput) {
          fileInput.value = '';
        }
        // 隐藏文件信息徽章
        const badge = document.getElementById('fileInfoBadge');
        if (badge) {
          badge.style.display = 'none';
        }
      });
    }

    // 处理导入文件（选择文件）
    function handleImportFile(event) {
      const file = event.target.files[0];
      processImportFile(file);
    }

    /**
     * 解析CSV格式的导入数据
     * 支持2FA导出的CSV格式和Bitwarden Authenticator CSV格式
     * @param {string} csvContent - CSV内容
     * @returns {Array<string>} - 转换为 otpauth:// URL 格式的数组
     */
    function parseCSVImport(csvContent) {
      const otpauthUrls = [];

      try {
        // 按行分割
        const lines = csvContent.split('\\n').filter(line => line.trim());

        if (lines.length < 2) {
          console.warn('CSV文件内容太少');
          return otpauthUrls;
        }

        // 检查第一行是否是标题行
        const header = lines[0];

        // 🆕 检测 Bitwarden Authenticator CSV 格式: folder,favorite,type,name,login_uri,login_totp
        if (header.includes('login_totp') && header.includes('folder')) {
          console.log('检测到 Bitwarden Authenticator CSV 格式');

          for (let i = 1; i < lines.length; i++) {
            try {
              const line = lines[i].trim();
              if (!line) continue;

              // 查找 otpauth:// URL
              const otpauthMatch = line.match(/otpauth:\\/\\/[^,\\s]+/);
              if (otpauthMatch) {
                otpauthUrls.push(decodeURIComponent(otpauthMatch[0]));
                console.log('Bitwarden Auth CSV 第', i + 1, '行解析成功');
              }
            } catch (err) {
              console.error('解析 Bitwarden Auth CSV 第', i + 1, '行失败:', err);
            }
          }

          console.log('成功从 Bitwarden Authenticator CSV 解析', otpauthUrls.length, '条密钥');
          return otpauthUrls;
        }

        // 原有的 2FA CSV 格式检测
        const isCSVFormat = header.includes('服务名称') || header.includes('密钥') ||
                           header.toLowerCase().includes('service') || header.toLowerCase().includes('secret');

        if (!isCSVFormat) {
          console.warn('不是有效的CSV格式');
          return otpauthUrls;
        }

        // 解析标题行，确定列的索引
        const headers = parseCSVLine(header);
        const serviceIndex = headers.findIndex(h => h === '服务名称' || h.toLowerCase() === 'service');
        const accountIndex = headers.findIndex(h => h === '账户信息' || h === '账户' || h.toLowerCase() === 'account');
        const secretIndex = headers.findIndex(h => h === '密钥' || h.toLowerCase() === 'secret');
        const typeIndex = headers.findIndex(h => h === '类型' || h.toLowerCase() === 'type');
        const digitsIndex = headers.findIndex(h => h === '位数' || h.toLowerCase() === 'digits');
        const periodIndex = headers.findIndex(h => h.includes('周期') || h.toLowerCase().includes('period'));
        const algoIndex = headers.findIndex(h => h === '算法' || h.toLowerCase() === 'algorithm');

        console.log('CSV列索引:', { serviceIndex, accountIndex, secretIndex, typeIndex, digitsIndex, periodIndex, algoIndex });

        // 解析数据行（跳过标题行）
        for (let i = 1; i < lines.length; i++) {
          try {
            const line = lines[i].trim();
            if (!line) continue;

            const fields = parseCSVLine(line);

            const service = serviceIndex >= 0 ? fields[serviceIndex] : '';
            const account = accountIndex >= 0 ? fields[accountIndex] : '';
            const secret = secretIndex >= 0 ? fields[secretIndex] : '';
            const type = typeIndex >= 0 ? fields[typeIndex] : 'TOTP';
            const digits = digitsIndex >= 0 ? parseInt(fields[digitsIndex]) || 6 : 6;
            const period = periodIndex >= 0 ? parseInt(fields[periodIndex]) || 30 : 30;
            const algo = algoIndex >= 0 ? fields[algoIndex] : 'SHA1';

            // 验证必要数据
            if (!secret || !secret.trim()) {
              console.warn('第', i + 1, '行：跳过空密钥');
              continue;
            }

            // 清理密钥
            const cleanSecret = secret.replace(/\\\\s+/g, '').toUpperCase();

            // 构建 otpauth:// URL
            let label = '';
            if (service && account) {
              label = encodeURIComponent(service) + ':' + encodeURIComponent(account);
            } else if (service) {
              label = encodeURIComponent(service);
            } else if (account) {
              label = encodeURIComponent(account);
            } else {
              label = 'Unknown';
            }

            const params = new URLSearchParams();
            params.set('secret', cleanSecret);
            if (service) params.set('issuer', service);
            if (digits !== 6) params.set('digits', digits);
            if (period !== 30) params.set('period', period);
            if (algo !== 'SHA1') params.set('algorithm', algo);

            const otpauthUrl = 'otpauth://totp/' + label + '?' + params.toString();
            otpauthUrls.push(otpauthUrl);

            console.log('CSV第', i + 1, '行解析成功:', service, account);

          } catch (err) {
            console.error('解析CSV第', i + 1, '行失败:', err);
          }
        }

        console.log('成功从CSV解析', otpauthUrls.length, '条密钥');

      } catch (error) {
        console.error('解析CSV失败:', error);
      }

      return otpauthUrls;
    }

    /**
     * 解析CSV行（处理逗号、引号等转义）
     * @param {string} line - CSV行
     * @returns {Array<string>} - 字段数组
     */
    function parseCSVLine(line) {
      const fields = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];

        if (char === '"') {
          if (inQuotes && nextChar === '"') {
            // 转义的引号
            current += '"';
            i++; // 跳过下一个引号
          } else {
            // 切换引号状态
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          // 字段分隔符
          fields.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }

      // 添加最后一个字段
      fields.push(current.trim());

      return fields;
    }

    /**
     * 解析HTML格式的导入数据
     * 支持三种格式:
     * 1. Aegis Authenticator HTML 导出格式
     * 2. 2FA HTML 导出格式
     * 3. Ente Auth HTML 导出格式 (.html.txt)
     * @param {string} htmlContent - HTML内容
     * @returns {Array<string>} - 转换为 otpauth:// URL 格式的数组
     */
    function parseHTMLImport(htmlContent) {
      const otpauthUrls = [];

      try {
        // 创建临时DOM来解析HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlContent, 'text/html');

        // 查找所有table元素
        const tables = doc.querySelectorAll('table');

        if (tables.length === 0) {
          console.warn('HTML中未找到table元素');
          return otpauthUrls;
        }

        // 检测 Ente Auth 格式: 带有 class="otp-entry" 的表格
        const enteAuthTables = doc.querySelectorAll('table.otp-entry');
        if (enteAuthTables.length > 0) {
          console.log('检测到 Ente Auth HTML 格式');

          enteAuthTables.forEach((table, index) => {
            try {
              const firstCell = table.querySelector('td');
              if (!firstCell) return;

              // 获取所有 <p> 元素
              const paragraphs = firstCell.querySelectorAll('p');
              if (paragraphs.length < 4) {
                console.warn('Ente Auth 条目字段不足，跳过');
                return;
              }

              // Ente Auth 格式:
              // <p><b>Service</b></p>
              // <p><b>Account</b></p>
              // <p class="group">Type: <b>totp</b></p>
              // <p>Algorithm: <b>sha1</b></p>
              // <p>Digits: <b>6</b></p>
              // <p>Secret: <b>SECRET</b></p>
              // <p>Period: <b>30</b></p> (可选)

              let issuer = '', account = '', secret = '', algo = 'SHA1', digits = 6, period = 30, type = 'totp';

              paragraphs.forEach((p, idx) => {
                const boldText = p.querySelector('b');
                if (!boldText) return;

                const text = p.textContent.trim();
                const value = boldText.textContent.trim();

                if (idx === 0) {
                  // 第一个 <p><b> 是服务名
                  issuer = value;
                } else if (idx === 1) {
                  // 第二个 <p><b> 是账户名
                  account = value;
                } else if (text.startsWith('Type:')) {
                  type = value.toLowerCase();
                } else if (text.startsWith('Algorithm:')) {
                  algo = value.toUpperCase();
                } else if (text.startsWith('Digits:')) {
                  digits = parseInt(value) || 6;
                } else if (text.startsWith('Secret:')) {
                  secret = value;
                } else if (text.startsWith('Period:')) {
                  period = parseInt(value) || 30;
                }
              });

              // 验证必要数据
              if (!secret) {
                console.warn('跳过无密钥的 Ente Auth 条目 (索引 ' + index + ')');
                return;
              }

              // 清理密钥
              secret = secret.replace(/\\s+/g, '').toUpperCase();

              // 构建 otpauth:// URL
              let label = '';
              if (issuer && account) {
                label = encodeURIComponent(issuer) + ':' + encodeURIComponent(account);
              } else if (issuer) {
                label = encodeURIComponent(issuer);
              } else if (account) {
                label = encodeURIComponent(account);
              } else {
                label = 'Unknown';
              }

              const params = new URLSearchParams();
              params.set('secret', secret);
              if (issuer) params.set('issuer', issuer);
              if (digits !== 6) params.set('digits', digits);
              if (period !== 30) params.set('period', period);
              if (algo !== 'SHA1') params.set('algorithm', algo);

              const protocol = type === 'hotp' ? 'hotp' : 'totp';
              const otpauthUrl = 'otpauth://' + protocol + '/' + label + '?' + params.toString();
              otpauthUrls.push(otpauthUrl);

              console.log('Ente Auth 条目 ' + (index + 1) + ':', issuer, account);

            } catch (err) {
              console.error('解析 Ente Auth 条目失败 (索引 ' + index + '):', err);
            }
          });

          console.log('成功从 Ente Auth HTML 解析', otpauthUrls.length, '条密钥');
          return otpauthUrls;
        }

        // 检测 Authenticator Pro HTML 格式: 标题包含 "Authenticator Pro Backup" 或表头包含 "OTP Auth URI"
        const title = doc.querySelector('title');
        const isAuthProByTitle = title && title.textContent.includes('Authenticator Pro');
        const headers = doc.querySelectorAll('th');
        const isAuthProByHeader = Array.from(headers).some(th => th.textContent.includes('OTP Auth URI'));

        if (isAuthProByTitle || isAuthProByHeader) {
          console.log('检测到 Authenticator Pro HTML 格式');

          // Authenticator Pro HTML 格式: otpauth:// URLs 在 <code> 标签中
          const codeElements = doc.querySelectorAll('td code');
          codeElements.forEach((codeEl, index) => {
            try {
              const content = codeEl.textContent.trim();
              if (content.startsWith('otpauth://')) {
                otpauthUrls.push(content);
                console.log('Authenticator Pro 条目 ' + (index + 1) + ':', content.substring(0, 50) + '...');
              }
            } catch (err) {
              console.error('解析 Authenticator Pro 条目失败 (索引 ' + index + '):', err);
            }
          });

          console.log('成功从 Authenticator Pro HTML 解析', otpauthUrls.length, '条密钥');
          return otpauthUrls;
        }

        // 遍历所有表格 (Aegis/2FA 格式)
        tables.forEach(table => {
          const tbody = table.querySelector('tbody');
          if (!tbody) return;

          const rows = tbody.querySelectorAll('tr');

          rows.forEach(row => {
            try {
              const cells = row.querySelectorAll('td');
              if (cells.length === 0) return;

              let issuer = '', account = '', secret = '', algo = 'SHA1', digits = 6, period = 30;

              // 检测表格格式
              // Aegis格式: Issuer, Name, Type, QR Code, UUID, Note, Favorite, Algo, Digits, Secret, Counter, PIN (12列)
              // 2FA格式: 服务名称, 账户, 密钥, 类型, 位数, 周期, 算法, 二维码 (8列)

              if (cells.length >= 11) {
                // Aegis 格式 (12列)
                issuer = cells[0].textContent.trim();
                account = cells[1].textContent.trim();
                algo = cells[7].textContent.trim() || 'SHA1';
                digits = parseInt(cells[8].textContent.trim()) || 6;
                secret = cells[9].textContent.trim();
                // Aegis TOTP period 默认30秒
                period = 30;

                console.log('检测到 Aegis HTML 格式:', issuer, account);
              } else if (cells.length >= 7) {
                // 2FA 格式 (8列)
                issuer = cells[0].textContent.trim();
                account = cells[1].textContent.trim();
                secret = cells[2].textContent.trim();
                // type = cells[3]
                digits = parseInt(cells[4].textContent.trim()) || 6;
                period = parseInt(cells[5].textContent.trim()) || 30;
                algo = cells[6].textContent.trim() || 'SHA1';

                console.log('检测到 2FA HTML 格式:', issuer, account);
              } else {
                console.warn('未知的表格格式,列数:', cells.length);
                return;
              }

              // 验证必要数据
              if (!secret || secret === '-') {
                console.warn('跳过空密钥行');
                return;
              }

              // 清理密钥(移除空格和换行)
              secret = secret.replace(/\\\\s+/g, '').toUpperCase();

              // 构建 otpauth:// URL
              let label = '';
              if (issuer && account && account !== '-') {
                label = encodeURIComponent(issuer) + ':' + encodeURIComponent(account);
              } else if (issuer) {
                label = encodeURIComponent(issuer);
              } else if (account && account !== '-') {
                label = encodeURIComponent(account);
              } else {
                label = 'Unknown';
              }

              const params = new URLSearchParams();
              params.set('secret', secret);
              if (issuer) params.set('issuer', issuer);
              if (digits !== 6) params.set('digits', digits);
              if (period !== 30) params.set('period', period);
              if (algo !== 'SHA1') params.set('algorithm', algo);

              const otpauthUrl = 'otpauth://totp/' + label + '?' + params.toString();
              otpauthUrls.push(otpauthUrl);

            } catch (err) {
              console.error('解析HTML行失败:', err);
            }
          });
        });

        console.log('成功从HTML解析', otpauthUrls.length, '条密钥');

      } catch (error) {
        console.error('解析HTML失败:', error);
      }

      return otpauthUrls;
    }

    /**
     * 解析 LastPass Authenticator JSON 格式
     * @param {Object} jsonData - LastPass JSON 数据
     * @returns {Array<string>|null} otpauth:// URL 数组，解析失败返回 null
     */
    function parseLastPassJSON(jsonData) {
      if (!jsonData.accounts || !Array.isArray(jsonData.accounts)) {
        console.error('LastPass JSON 格式错误：缺少 accounts 数组');
        return null;
      }

      const otpauthUrls = [];
      let skippedCount = 0;

      for (const account of jsonData.accounts) {
        // 跳过推送通知账户（无 TOTP secret）
        if (account.pushNotification || !account.secret) {
          skippedCount++;
          continue;
        }

        try {
          // 提取并清理字段
          const issuer = (account.issuerName || account.originalIssuerName || 'Unknown').trim();
          const username = (account.userName || account.originalUserName || '').trim();
          const secret = account.secret.replace(/\\s+/g, '').toUpperCase();

          // 验证密钥格式（Base32）
          if (!/^[A-Z2-7]+=*$/.test(secret)) {
            console.warn('LastPass: 跳过无效密钥 (' + issuer + ':' + username + ')');
            skippedCount++;
            continue;
          }

          const digits = account.digits || 6;
          const period = account.timeStep || 30;
          const algorithm = (account.algorithm || 'SHA1').toUpperCase();

          // 验证参数范围
          if (![6, 7, 8].includes(digits)) {
            console.warn('LastPass: 无效的 digits 值 ' + digits + '，使用默认值 6');
            digits = 6;
          }

          // URL 编码
          const issuerEncoded = encodeURIComponent(issuer);
          const usernameEncoded = username ? encodeURIComponent(username) : '';

          // 构建 label（格式：issuer:account）
          const label = username
            ? issuerEncoded + ':' + usernameEncoded
            : issuerEncoded;

          // 构建 otpauth:// URL
          const url = 'otpauth://totp/' + label + '?secret=' + secret + '&digits=' + digits + '&period=' + period + '&algorithm=' + algorithm + '&issuer=' + issuerEncoded;

          otpauthUrls.push(url);
        } catch (error) {
          console.error('LastPass: 解析账户失败', account, error);
          skippedCount++;
        }
      }

      if (skippedCount > 0) {
        console.log('LastPass: 跳过了 ' + skippedCount + ' 个无效账户');
      }

      console.log('LastPass: 成功解析 ' + otpauthUrls.length + ' 个账户');
      return otpauthUrls.length > 0 ? otpauthUrls : null;
    }

    /**
     * 解析JSON格式的导入数据
     * 支持多种格式:
     * 1. Aegis Authenticator 格式: { db: { entries: [...] } }
     * 2. 2FAS 格式: { services: [...], schemaVersion: ... }
     * 3. Bitwarden 格式: { items: [...] }
     * 4. LastPass Authenticator 格式: { version: ..., accounts: [...] }
     * 5. andOTP 格式: [{ secret, issuer, label, thumbnail, ... }]
     * 6. 2FA 导出格式: { secrets: [...] }
     * @param {Object|Array} jsonData - JSON数据
     * @returns {Array<string>} - 转换为 otpauth:// URL 格式的数组
     */
    function parseJsonImport(jsonData) {
      const otpauthUrls = [];

      try {
        // 检测 Aegis Authenticator 格式
        if (jsonData.db && jsonData.db.entries && Array.isArray(jsonData.db.entries)) {
          console.log('检测到 Aegis Authenticator 格式');

          jsonData.db.entries.forEach((entry, index) => {
            try {
              if (entry.type !== 'totp') {
                console.warn('跳过非TOTP条目:', entry.type);
                return;
              }

              const secret = entry.info.secret;
              const issuer = entry.issuer || '';
              const name = entry.name || '';
              const digits = entry.info.digits || 6;
              const period = entry.info.period || 30;
              const algorithm = (entry.info.algo || 'SHA1').toUpperCase();

              // 构建 otpauth:// URL
              // 格式: otpauth://totp/{issuer}:{name}?secret={secret}&issuer={issuer}&digits={digits}&period={period}&algorithm={algorithm}
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
              if (algorithm !== 'SHA1') params.set('algorithm', algorithm);

              const otpauthUrl = 'otpauth://totp/' + label + '?' + params.toString();
              otpauthUrls.push(otpauthUrl);

            } catch (err) {
              console.error('解析 Aegis 条目失败 (索引 ' + index + '):', err);
            }
          });

          console.log('成功解析 Aegis 格式,共 ' + otpauthUrls.length + ' 条');
        }
        // 检测 2FAS 格式: { services: [...], schemaVersion: ... }
        else if (jsonData.services && Array.isArray(jsonData.services) && jsonData.schemaVersion !== undefined) {
          console.log('检测到 2FAS 格式 (schemaVersion: ' + jsonData.schemaVersion + ')');

          jsonData.services.forEach((service, index) => {
            try {
              // 2FAS 格式: secret 在外层，otp 配置在 otp 对象内
              const secret = service.secret;
              const issuer = service.name || '';
              const otp = service.otp || {};
              const account = otp.account || '';
              const digits = otp.digits || 6;
              const period = otp.period || 30;
              const algorithm = (otp.algorithm || 'SHA1').toUpperCase();
              const tokenType = (otp.tokenType || 'TOTP').toUpperCase();

              if (!secret) {
                console.warn('跳过无密钥的 2FAS 条目 (索引 ' + index + ')');
                return;
              }

              // 构建 otpauth:// URL
              let label = '';
              if (issuer && account) {
                label = encodeURIComponent(issuer) + ':' + encodeURIComponent(account);
              } else if (issuer) {
                label = encodeURIComponent(issuer);
              } else if (account) {
                label = encodeURIComponent(account);
              } else {
                label = 'Unknown';
              }

              const params = new URLSearchParams();
              params.set('secret', secret);
              if (issuer) params.set('issuer', issuer);
              if (digits !== 6) params.set('digits', digits);
              if (period !== 30) params.set('period', period);
              if (algorithm !== 'SHA1') params.set('algorithm', algorithm);

              // 根据类型选择协议
              const protocol = tokenType === 'HOTP' ? 'hotp' : 'totp';
              const otpauthUrl = 'otpauth://' + protocol + '/' + label + '?' + params.toString();
              otpauthUrls.push(otpauthUrl);

            } catch (err) {
              console.error('解析 2FAS 条目失败 (索引 ' + index + '):', err);
            }
          });

          console.log('成功解析 2FAS 格式,共 ' + otpauthUrls.length + ' 条');
        }
        // 检测 Bitwarden 格式: { items: [...] }
        else if (jsonData.items && Array.isArray(jsonData.items)) {
          console.log('检测到 Bitwarden 格式');

          jsonData.items.forEach((item, index) => {
            try {
              // Bitwarden: TOTP 存储在 login.totp 字段，格式为完整 otpauth:// URL 或纯密钥
              const login = item.login;
              if (!login || !login.totp) {
                return; // 跳过没有 TOTP 的条目
              }

              const totpValue = login.totp;
              const itemName = item.name || '';
              const username = login.username || '';

              // 如果是完整的 otpauth:// URL，直接使用
              if (totpValue.startsWith('otpauth://')) {
                otpauthUrls.push(totpValue);
                console.log('Bitwarden 条目 ' + (index + 1) + ': 使用完整 otpauth URL');
              } else {
                // 如果只是密钥，构建 otpauth:// URL
                let label = '';
                if (itemName && username) {
                  label = encodeURIComponent(itemName) + ':' + encodeURIComponent(username);
                } else if (itemName) {
                  label = encodeURIComponent(itemName);
                } else if (username) {
                  label = encodeURIComponent(username);
                } else {
                  label = 'Unknown';
                }

                const params = new URLSearchParams();
                params.set('secret', totpValue);
                if (itemName) params.set('issuer', itemName);

                const otpauthUrl = 'otpauth://totp/' + label + '?' + params.toString();
                otpauthUrls.push(otpauthUrl);
                console.log('Bitwarden 条目 ' + (index + 1) + ': 构建 otpauth URL for', itemName);
              }

            } catch (err) {
              console.error('解析 Bitwarden 条目失败 (索引 ' + index + '):', err);
            }
          });

          console.log('成功解析 Bitwarden 格式,共 ' + otpauthUrls.length + ' 条');
        }
        // 检测 LastPass Authenticator 格式 (version + accounts 数组)
        else if (jsonData.version !== undefined &&
                 jsonData.accounts &&
                 Array.isArray(jsonData.accounts) &&
                 jsonData.accounts.length > 0) {

          // 进一步验证是否为 LastPass 格式
          const firstAccount = jsonData.accounts[0];
          if (firstAccount.issuerName !== undefined &&
              firstAccount.timeStep !== undefined &&
              (firstAccount.secret !== undefined || firstAccount.pushNotification !== undefined)) {
            console.log('检测到 LastPass Authenticator 格式');
            const lastPassUrls = parseLastPassJSON(jsonData);
            if (lastPassUrls && lastPassUrls.length > 0) {
              return lastPassUrls;
            }
          }
        }
        // 检测 2FA 导出格式
        else if (jsonData.secrets && Array.isArray(jsonData.secrets)) {
          console.log('检测到 2FA 导出格式');

          jsonData.secrets.forEach((secret, index) => {
            try {
              const secretKey = secret.secret;
              const issuer = secret.issuer || secret.name || '';  // 优先使用 issuer，兼容 name
              const account = secret.account || '';
              const type = (secret.type || 'TOTP').toLowerCase();
              const digits = secret.digits || 6;
              const period = secret.period || 30;
              const algorithm = (secret.algorithm || 'SHA1').toUpperCase();
              const counter = secret.counter || 0;

              // 构建 otpauth:// URL
              let label = '';
              if (issuer && account) {
                label = encodeURIComponent(issuer) + ':' + encodeURIComponent(account);
              } else if (issuer) {
                label = encodeURIComponent(issuer);
              } else if (account) {
                label = encodeURIComponent(account);
              } else {
                label = 'Unknown';
              }

              const params = new URLSearchParams();
              params.set('secret', secretKey);
              if (issuer) params.set('issuer', issuer);
              if (digits !== 6) params.set('digits', digits);
              if (period !== 30) params.set('period', period);
              if (algorithm !== 'SHA1') params.set('algorithm', algorithm);
              if (type === 'hotp') params.set('counter', counter);

              const otpauthUrl = 'otpauth://' + type + '/' + label + '?' + params.toString();
              otpauthUrls.push(otpauthUrl);

            } catch (err) {
              console.error('解析 2FA 条目失败 (索引 ' + index + '):', err);
            }
          });

          console.log('成功解析 2FA 格式,共 ' + otpauthUrls.length + ' 条');
        }
        // 检测 Proton Authenticator 格式: { version: 1, entries: [{ content: { uri: "otpauth://..." } }] }
        else if (jsonData.version !== undefined && jsonData.entries && Array.isArray(jsonData.entries)) {
          console.log('检测到 Proton Authenticator 格式 (version: ' + jsonData.version + ')');

          jsonData.entries.forEach((entry, index) => {
            try {
              // Proton 格式: otpauth:// URL 存储在 content.uri 字段
              const content = entry.content;
              if (!content || !content.uri) {
                console.warn('跳过无效的 Proton 条目 (索引 ' + index + ')');
                return;
              }

              const uri = content.uri;
              if (uri.startsWith('otpauth://')) {
                otpauthUrls.push(uri);
                console.log('Proton 条目 ' + (index + 1) + ':', content.name || 'Unknown');
              } else {
                console.warn('跳过非 otpauth URI 的 Proton 条目 (索引 ' + index + ')');
              }

            } catch (err) {
              console.error('解析 Proton 条目失败 (索引 ' + index + '):', err);
            }
          });

          console.log('成功解析 Proton Authenticator 格式,共 ' + otpauthUrls.length + ' 条');
        }
        // 检测 Authenticator Pro (Stratum) 格式: { Authenticators: [...], Categories: [...] }
        else if (jsonData.Authenticators && Array.isArray(jsonData.Authenticators)) {
          console.log('检测到 Authenticator Pro (Stratum) 格式');

          // Algorithm 映射: 0=SHA1, 1=SHA256, 2=SHA512
          const algoMap = { 0: 'SHA1', 1: 'SHA256', 2: 'SHA512' };
          // Type 映射: 1=HOTP, 2=TOTP
          const typeMap = { 1: 'hotp', 2: 'totp' };

          jsonData.Authenticators.forEach((auth, index) => {
            try {
              const secret = auth.Secret;
              if (!secret) {
                console.warn('跳过无密钥的 Authenticator Pro 条目 (索引 ' + index + ')');
                return;
              }

              const issuer = auth.Issuer || '';
              const account = auth.Username || '';
              const digits = auth.Digits || 6;
              const period = auth.Period || 30;
              const algorithm = algoMap[auth.Algorithm] || 'SHA1';
              const type = typeMap[auth.Type] || 'totp';
              const counter = auth.Counter || 0;

              // 构建 otpauth:// URL
              let label = '';
              if (issuer && account) {
                label = encodeURIComponent(issuer) + ':' + encodeURIComponent(account);
              } else if (issuer) {
                label = encodeURIComponent(issuer);
              } else if (account) {
                label = encodeURIComponent(account);
              } else {
                label = 'Unknown';
              }

              const params = new URLSearchParams();
              params.set('secret', secret);
              if (issuer) params.set('issuer', issuer);
              if (digits !== 6) params.set('digits', digits.toString());
              if (period !== 30) params.set('period', period.toString());
              if (algorithm !== 'SHA1') params.set('algorithm', algorithm);
              if (type === 'hotp') params.set('counter', counter.toString());

              const otpauthUrl = 'otpauth://' + type + '/' + label + '?' + params.toString();
              otpauthUrls.push(otpauthUrl);

            } catch (err) {
              console.error('解析 Authenticator Pro 条目失败 (索引 ' + index + '):', err);
            }
          });

          console.log('成功解析 Authenticator Pro 格式,共 ' + otpauthUrls.length + ' 条');
        }
        // 检测 FreeOTP+ 格式: { tokens: [...] }
        else if (jsonData.tokens && Array.isArray(jsonData.tokens)) {
          console.log('检测到 FreeOTP+ 格式');

          jsonData.tokens.forEach((token, index) => {
            try {
              // FreeOTP+ 格式字段
              let secret = token.secret;
              const issuer = token.issuerExt || token.issuerInt || '';
              const account = token.label || '';
              const digits = token.digits || 6;
              const period = token.period || 30;
              const algorithm = (token.algo || 'SHA1').toUpperCase();
              const type = (token.type || 'TOTP').toLowerCase();
              const counter = token.counter || 0;

              if (!secret) {
                console.warn('跳过无密钥的 FreeOTP+ 条目 (索引 ' + index + ')');
                return;
              }

              // FreeOTP+ 的 secret 可能是:
              // 1. Base32 编码的字符串 (新版本)
              // 2. 字节数组 (旧版本) - 需要转换为 Base32
              if (Array.isArray(secret)) {
                // 字节数组转 Base32
                secret = bytesToBase32(secret);
              }

              // 确保是大写
              secret = secret.toUpperCase().replace(/\\s+/g, '');

              // 构建 otpauth:// URL
              let label = '';
              if (issuer && account) {
                label = encodeURIComponent(issuer) + ':' + encodeURIComponent(account);
              } else if (issuer) {
                label = encodeURIComponent(issuer);
              } else if (account) {
                label = encodeURIComponent(account);
              } else {
                label = 'Unknown';
              }

              const params = new URLSearchParams();
              params.set('secret', secret);
              if (issuer) params.set('issuer', issuer);
              if (digits !== 6) params.set('digits', digits);
              if (period !== 30) params.set('period', period);
              if (algorithm !== 'SHA1') params.set('algorithm', algorithm);
              if (type === 'hotp') params.set('counter', counter);

              // 根据类型选择协议
              const protocol = type === 'hotp' ? 'hotp' : 'totp';
              const otpauthUrl = 'otpauth://' + protocol + '/' + label + '?' + params.toString();
              otpauthUrls.push(otpauthUrl);

            } catch (err) {
              console.error('解析 FreeOTP+ 条目失败 (索引 ' + index + '):', err);
            }
          });

          console.log('成功解析 FreeOTP+ 格式,共 ' + otpauthUrls.length + ' 条');
        }
        // 检测 FreeOTP 原版格式: { tokenOrder: [...], "key1": {...}, "key2": {...} }
        else if (jsonData.tokenOrder && Array.isArray(jsonData.tokenOrder)) {
          console.log('检测到 FreeOTP 原版格式');

          // tokenOrder 包含 token 的键名列表
          jsonData.tokenOrder.forEach((tokenKey, index) => {
            try {
              const token = jsonData[tokenKey];
              if (!token) {
                console.warn('跳过不存在的 FreeOTP 条目: ' + tokenKey);
                return;
              }

              // FreeOTP 格式字段
              let secret = token.secret;
              const issuer = token.issuerExt || token.issuerInt || token.issuerAlt || '';
              const account = token.label || '';
              const digits = token.digits || 6;
              const period = token.period || 30;
              const algorithm = (token.algo || 'SHA1').toUpperCase();
              const type = (token.type || 'TOTP').toLowerCase();
              const counter = token.counter || 0;

              if (!secret) {
                console.warn('跳过无密钥的 FreeOTP 条目 (索引 ' + index + ')');
                return;
              }

              // FreeOTP 的 secret 是字节数组，需要转换为 Base32
              if (Array.isArray(secret)) {
                secret = bytesToBase32(secret);
              }

              // 确保是大写
              secret = secret.toUpperCase().replace(/\\s+/g, '');

              // 构建 otpauth:// URL
              let label = '';
              if (issuer && account) {
                label = encodeURIComponent(issuer) + ':' + encodeURIComponent(account);
              } else if (issuer) {
                label = encodeURIComponent(issuer);
              } else if (account) {
                label = encodeURIComponent(account);
              } else {
                label = 'Unknown';
              }

              const params = new URLSearchParams();
              params.set('secret', secret);
              if (issuer) params.set('issuer', issuer);
              if (digits !== 6) params.set('digits', digits);
              if (period !== 30) params.set('period', period);
              if (algorithm !== 'SHA1') params.set('algorithm', algorithm);
              if (type === 'hotp') params.set('counter', counter);

              // 根据类型选择协议
              const protocol = type === 'hotp' ? 'hotp' : 'totp';
              const otpauthUrl = 'otpauth://' + protocol + '/' + label + '?' + params.toString();
              otpauthUrls.push(otpauthUrl);

            } catch (err) {
              console.error('解析 FreeOTP 条目失败 (' + tokenKey + '):', err);
            }
          });

          console.log('成功解析 FreeOTP 格式,共 ' + otpauthUrls.length + ' 条');
        }
        // 检测纯数组格式 (可能是 andOTP 或直接的 secrets 数组)
        else if (Array.isArray(jsonData)) {
          console.log('检测到数组格式,尝试解析...');

          // 检测 andOTP 格式: [{ secret, issuer, label, thumbnail, ... }]
          if (jsonData.length > 0 && jsonData[0].thumbnail !== undefined) {
            console.log('检测到 andOTP 格式');

            jsonData.forEach((entry, index) => {
              try {
                const secret = entry.secret;
                const issuer = entry.issuer || '';
                const account = entry.label || '';
                const digits = entry.digits || 6;
                const period = entry.period || 30;
                const algorithm = (entry.algorithm || 'SHA1').toUpperCase();
                const type = (entry.type || 'totp').toLowerCase();

                if (!secret) {
                  console.warn('跳过无密钥的 andOTP 条目 (索引 ' + index + ')');
                  return;
                }

                // 构建 otpauth:// URL
                let label = '';
                if (issuer && account) {
                  label = encodeURIComponent(issuer) + ':' + encodeURIComponent(account);
                } else if (issuer) {
                  label = encodeURIComponent(issuer);
                } else if (account) {
                  label = encodeURIComponent(account);
                } else {
                  label = 'Unknown';
                }

                const params = new URLSearchParams();
                params.set('secret', secret);
                if (issuer) params.set('issuer', issuer);
                if (digits !== 6) params.set('digits', digits);
                if (period !== 30) params.set('period', period);
                if (algorithm !== 'SHA1') params.set('algorithm', algorithm);

                // 根据类型选择协议
                const protocol = type === 'hotp' ? 'hotp' : 'totp';
                const otpauthUrl = 'otpauth://' + protocol + '/' + label + '?' + params.toString();
                otpauthUrls.push(otpauthUrl);

              } catch (err) {
                console.error('解析 andOTP 条目失败 (索引 ' + index + '):', err);
              }
            });

            console.log('成功解析 andOTP 格式,共 ' + otpauthUrls.length + ' 条');
          }
          // 尝试检测是否是 secrets 数组
          else if (jsonData.length > 0 && jsonData[0].secret) {
            jsonData.forEach((secret, index) => {
              try {
                const secretKey = secret.secret;
                const issuer = secret.name || secret.issuer || '';
                const account = secret.account || secret.name || '';
                const digits = secret.digits || 6;
                const period = secret.period || 30;
                const algorithm = (secret.algorithm || secret.algo || 'SHA1').toUpperCase();

                let label = '';
                if (issuer && account) {
                  label = encodeURIComponent(issuer) + ':' + encodeURIComponent(account);
                } else if (issuer) {
                  label = encodeURIComponent(issuer);
                } else if (account) {
                  label = encodeURIComponent(account);
                } else {
                  label = 'Unknown';
                }

                const params = new URLSearchParams();
                params.set('secret', secretKey);
                if (issuer) params.set('issuer', issuer);
                if (digits !== 6) params.set('digits', digits);
                if (period !== 30) params.set('period', period);
                if (algorithm !== 'SHA1') params.set('algorithm', algorithm);

                const otpauthUrl = 'otpauth://totp/' + label + '?' + params.toString();
                otpauthUrls.push(otpauthUrl);

              } catch (err) {
                console.error('解析数组条目失败 (索引 ' + index + '):', err);
              }
            });
          }
        }
        else {
          console.warn('未识别的JSON格式');
        }

      } catch (error) {
        console.error('解析JSON导入数据失败:', error);
      }

      return otpauthUrls;
    }

    // 预览导入
    function previewImport() {
      const text = document.getElementById('importText').value.trim();
      if (!text) {
        showCenterToast('❌', '请先输入或选择要导入的内容');
        return;
      }

      let lines = text.split('\\n').filter(line => line.trim());
      const previewList = document.getElementById('importPreviewList');
      const previewDiv = document.getElementById('importPreview');
      const executeBtn = document.getElementById('executeImportBtn');

      previewList.innerHTML = '';
      importPreviewData = [];

      let validCount = 0;
      let invalidCount = 0;
      let skippedCount = 0; // 跳过的已删除条目

      // 🆕 检测 FreeOTP 加密备份格式（Java 序列化）
      const freeotpData = parseFreeOTPBackup(text);
      if (freeotpData) {
        freeotpBackupData = freeotpData;

        // 显示需要密码的提示
        const tokenCount = Object.keys(freeotpData.tokenMeta).length;

        // 显示预览（token 元数据）
        Object.entries(freeotpData.tokenMeta).forEach(([uuid, meta]) => {
          const item = document.createElement('div');
          item.className = 'import-preview-item valid';

          const issuer = meta.issuerExt || meta.issuerInt || '';
          const account = meta.label || '';
          let displayInfo = issuer || '未知服务';
          if (meta.type && meta.type !== 'TOTP') displayInfo += ' [' + meta.type + ']';
          if (meta.digits && meta.digits !== 6) displayInfo += ' [' + meta.digits + '位]';

          item.innerHTML =
            '<div class="service-name">🔒 ' + displayInfo + '</div>' +
            '<div class="account-name">' + (account || '(需要密码解密)') + '</div>';

          previewList.appendChild(item);

          importPreviewData.push({
            serviceName: issuer,
            account: account,
            uuid: uuid,
            encrypted: true,
            valid: true
          });
          validCount++;
        });

        // 显示统计和密码输入提示
        const statsDiv = document.createElement('div');
        statsDiv.style.cssText = 'margin: 15px 0; padding: 15px; background: var(--bg-secondary); border-radius: 6px; font-size: 14px; color: var(--text-primary);';
        statsDiv.innerHTML =
          '<strong>🔐 FreeOTP 加密备份</strong><br>' +
          '<span style="color: var(--text-secondary);">检测到 ' + tokenCount + ' 个加密密钥</span><br><br>' +
          '<div style="display: flex; gap: 10px; align-items: center;">' +
          '<input type="password" id="freeotpPassword" placeholder="输入备份密码" ' +
          'style="flex: 1; padding: 8px 12px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-primary); color: var(--text-primary);">' +
          '<button onclick="decryptAndPreviewFreeOTP()" class="btn btn-primary" style="padding: 8px 16px;">解密</button>' +
          '</div>';

        previewList.insertBefore(statsDiv, previewList.firstChild);

        // 更新统计信息
        updateImportStats(validCount, 0, 0);

        previewDiv.style.display = 'block';
        executeBtn.disabled = true; // 需要先解密
        executeBtn.textContent = '🔒 需要先解密';
        return;
      }

      // 🆕 检测 TOTP Authenticator 加密备份格式（.encrypt）
      if (isTOTPAuthenticatorBackup(text)) {
        totpAuthBackupData = text;

        // 显示需要密码的提示
        const statsDiv = document.createElement('div');
        statsDiv.className = 'import-stats-header';
        statsDiv.innerHTML =
          '<strong>🔐 TOTP Authenticator 加密备份</strong><br>' +
          '<span style="color: var(--text-secondary);">检测到加密的 TOTP Authenticator 备份</span><br><br>' +
          '<div style="display: flex; gap: 10px; align-items: center;">' +
          '<input type="password" id="totpAuthPassword" placeholder="输入备份密码" ' +
          'style="flex: 1; padding: 8px 12px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-primary); color: var(--text-primary);">' +
          '<button onclick="decryptAndPreviewTOTPAuth()" class="btn btn-primary" style="padding: 8px 16px;">解密</button>' +
          '</div>';

        previewList.appendChild(statsDiv);

        previewDiv.style.display = 'block';
        executeBtn.disabled = true;
        executeBtn.textContent = '🔒 需要先解密';
        return;
      }

      // 🆕 检测并解析HTML格式 (包括 Ente Auth .html.txt 格式)
      // Ente Auth 文件开头可能有空格，所以需要更灵活的检测
      const trimmedText = text.trim().toLowerCase();
      const isHtmlFormat = trimmedText.startsWith('<!doctype html') ||
                          trimmedText.startsWith('<html') ||
                          text.includes('class="otp-entry"') ||  // Ente Auth 特征
                          text.includes('Ente Auth');            // Ente Auth 标题
      if (isHtmlFormat) {
        const htmlLines = parseHTMLImport(text);

        if (htmlLines.length === 0) {
          showCenterToast('❌', '未从HTML文件中提取到有效密钥');
          return;
        }

        lines = htmlLines;
      }
      // 🆕 检测并解析JSON格式（支持多种格式）- 必须在CSV之前检测，避免JSON被误识别为CSV
      else if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
        try {
          const jsonData = JSON.parse(text);
          lines = parseJsonImport(jsonData);

          if (lines.length === 0) {
            showCenterToast('❌', '未找到有效的密钥数据');
            return;
          }
        } catch (jsonError) {
          // 不是有效JSON格式,继续按行解析
          console.log('JSON解析失败,按OTPAuth URL格式解析:', jsonError.message);
        }
      }
      // 🆕 检测并解析CSV格式
      else if (text.includes('服务名称,账户信息,密钥') ||
               (text.toLowerCase().includes('service') && text.toLowerCase().includes('secret') && text.includes(','))) {
        const csvLines = parseCSVImport(text);

        if (csvLines.length === 0) {
          showCenterToast('❌', '未从CSV文件中提取到有效密钥');
          return;
        }

        lines = csvLines;
      }

      lines.forEach((line, index) => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return;

        const item = document.createElement('div');
        item.className = 'import-preview-item';

        try {
          // 尝试解析 otpauth:// URL (支持 totp 和 hotp)
          if (trimmedLine.startsWith('otpauth://totp/') || trimmedLine.startsWith('otpauth://hotp/')) {
            // 修复常见的 URL 编码问题
            const fixedLine = trimmedLine.replace(/&amp%3B/g, '&');
            const url = new URL(fixedLine);

            // 解析类型 (totp 或 hotp)
            const type = url.protocol === 'otpauth:' ? url.hostname : 'totp';

            // 解析基础参数
            const secret = url.searchParams.get('secret');
            const issuer = url.searchParams.get('issuer') || '';

            // 解析 OTP 配置参数
            const digits = parseInt(url.searchParams.get('digits')) || 6;
            const algorithm = (url.searchParams.get('algorithm') || 'SHA1').toUpperCase();

            // TOTP 特有参数
            const period = parseInt(url.searchParams.get('period')) || 30;

            // HOTP 特有参数
            const counter = parseInt(url.searchParams.get('counter')) || 0;

            // 检查是否为 Ente Auth 格式（包含 codeDisplay 参数）
            const codeDisplayParam = url.searchParams.get('codeDisplay');
            let isDeleted = false;

            if (codeDisplayParam) {
              try {
                const codeDisplay = JSON.parse(decodeURIComponent(codeDisplayParam));
                isDeleted = codeDisplay.trashed === true;
              } catch (e) {
                // 如果解析 codeDisplay 失败，继续正常处理
                console.warn('解析 codeDisplay 失败:', e.message);
              }
            }

            // 如果条目已删除，跳过导入
            if (isDeleted) {
              item.className += ' skipped';
              item.innerHTML =
                '<div class="service-name">⏭️ ' + (issuer || '未知服务') + '</div>' +
                '<div class="account-name">已删除条目，跳过导入</div>';
              previewList.appendChild(item);
              skippedCount++;
              return;
            }

            // 从路径中提取服务名和账户
            const pathParts = decodeURIComponent(url.pathname.substring(1)).split(':');
            let serviceName = issuer;
            let account = '';

            if (pathParts.length >= 2) {
              // 有2个或更多部分：第一部分是服务名，其余部分用冒号连接作为账户
              serviceName = pathParts[0] || issuer;
              account = pathParts.slice(1).join(':');
            } else if (pathParts.length === 1) {
              if (issuer) {
                serviceName = issuer;
                account = pathParts[0];
              } else {
                serviceName = pathParts[0];
              }
            }

            // 清理密钥中的空格和分隔符
            const cleanedSecret = secret ? secret.replace(/[\\s\\-+]/g, '') : secret;

            if (cleanedSecret && serviceName) {
              // 验证Base32格式
              if (validateBase32(cleanedSecret)) {
                item.className += ' valid';

                // 构建显示文本（包含参数信息）
                let displayInfo = serviceName;
                if (type === 'hotp') displayInfo += ' [HOTP]';
                if (digits !== 6) displayInfo += ' [' + digits + '位]';
                if (period !== 30 && type === 'totp') displayInfo += ' [' + period + 's]';
                if (algorithm !== 'SHA1') displayInfo += ' [' + algorithm + ']';

                item.innerHTML =
                  '<div class="service-name">✅ ' + displayInfo + '</div>' +
                  '<div class="account-name">' + (account || '(无账户)') + '</div>';

                // 保存完整的参数信息
                importPreviewData.push({
                  serviceName: serviceName,
                  account: account,
                  secret: cleanedSecret.toUpperCase(),
                  type: type,
                  digits: digits,
                  period: period,
                  algorithm: algorithm,
                  counter: counter,
                  valid: true,
                  line: index + 1
                });

                validCount++;
              } else {
                throw new Error('无效的Base32密钥格式');
              }
            } else {
              throw new Error('缺少必要信息（密钥或服务名）');
            }
          } else {
            throw new Error('不是有效的otpauth://格式');
          }
        } catch (error) {
          item.className += ' invalid';
          item.innerHTML =
            '<div class="service-name">❌ 第' + (index + 1) + '行</div>' +
            '<div class="error-msg">' + error.message + '</div>';

          importPreviewData.push({
            line: index + 1,
            error: error.message,
            valid: false
          });

          invalidCount++;
        }

        previewList.appendChild(item);
      });

      // 更新头部内联统计信息
      updateImportStats(validCount, invalidCount, skippedCount);

      previewDiv.style.display = 'block';
      // 按钮文本保持不变，只控制启用/禁用状态
      executeBtn.disabled = validCount === 0;
    }

    // 执行导入
    async function executeImport() {
      const validItems = importPreviewData.filter(item => item.valid);

      if (validItems.length === 0) {
        showCenterToast('❌', '没有有效的密钥可以导入');
        return;
      }

      const executeBtn = document.getElementById('executeImportBtn');
      executeBtn.disabled = true;

      let successCount = 0;
      let failCount = 0;

      // 使用批量导入避免竞态条件
      try {
        console.log('开始批量导入', validItems.length, '个密钥');

        // 准备批量导入的数据（包含完整的OTP配置参数）
        const secretsToImport = validItems.map(item => ({
          name: item.serviceName,
          account: item.account || '',
          secret: item.secret,
          type: item.type || 'totp',
          digits: item.digits || 6,
          period: item.period || 30,
          algorithm: item.algorithm || 'SHA1',
          counter: item.counter || 0
        }));

        // 调用批量导入 API
        const response = await authenticatedFetch('/api/secrets/batch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ secrets: secretsToImport })
        });

        if (response.ok) {
          const result = await response.json();
          console.log('批量导入成功:', result);
          successCount = result.successCount || validItems.length;
          failCount = result.failCount || 0;

          // 显示详细的导入结果
          if (result.results) {
            result.results.forEach((itemResult, index) => {
              if (itemResult.success) {
                console.log('✅ 第 ' + (index + 1) + ' 行导入成功:', itemResult.secret.name);
              } else {
                console.error('❌ 第 ' + (index + 1) + ' 行导入失败:', itemResult.error);
              }
            });
          }
        } else {
          // 如果批量导入失败，回退到逐个导入
          console.warn('批量导入失败，回退到逐个导入');
          await importSecretsIndividually(validItems, successCount, failCount);
        }
      } catch (error) {
        console.error('批量导入出错，回退到逐个导入:', error);
        await importSecretsIndividually(validItems, successCount, failCount);
      }

      // 逐个导入的备用方法
      async function importSecretsIndividually(items, successCount, failCount) {
        for (const item of items) {
          try {
            const newSecret = {
              name: item.serviceName,
              account: item.account || '',
              secret: item.secret,
              type: item.type || 'totp',
              digits: item.digits || 6,
              period: item.period || 30,
              algorithm: item.algorithm || 'SHA1',
              counter: item.counter || 0
            };

            console.log('正在导入密钥:', newSecret);

            const response = await authenticatedFetch('/api/secrets', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(newSecret)
            });

            if (response.ok) {
              const result = await response.json();
              console.log('成功导入:', result);
              successCount++;
            } else {
              const errorText = await response.text();
              console.error('导入失败 (第' + item.line + '行):', response.status, errorText);

              // 特别记录 Tencent 相关的失败
              if (item.serviceName.includes('Tencent')) {
                console.error('🚨 Tencent Cloud Services 导入失败详情:', {
                  serviceName: item.serviceName,
                  account: item.account,
                  secret: item.secret.substring(0, 8) + '...',
                  status: response.status,
                  error: errorText
                });
              }

              failCount++;
            }
          } catch (error) {
            console.error('导入出错 (第' + item.line + '行):', error);

            // 特别记录 Tencent 相关的错误
            if (item.serviceName.includes('Tencent')) {
              console.error('🚨 Tencent Cloud Services 导入出错详情:', {
                serviceName: item.serviceName,
                account: item.account,
                secret: item.secret.substring(0, 8) + '...',
                error: error.message
              });
            }

            failCount++;
          }
        }
      }

      executeBtn.disabled = false;

      // 显示结果
      if (successCount > 0) {
        showCenterToast('✅', '成功导入 ' + successCount + ' 个密钥' + (failCount > 0 ? '，' + failCount + ' 个失败' : '') + '！');

        // 刷新密钥列表
        setTimeout(() => {
          loadSecrets();
          hideImportModal();
        }, 1000);
      } else {
        showCenterToast('❌', '导入失败：所有 ' + failCount + ' 个密钥都导入失败');
      }
    }

    /**
     * 解密 FreeOTP 备份并更新预览
     */
    async function decryptAndPreviewFreeOTP() {
      const password = document.getElementById('freeotpPassword').value;

      if (!password) {
        showCenterToast('❌', '请输入备份密码');
        return;
      }

      if (!freeotpBackupData) {
        showCenterToast('❌', '未找到 FreeOTP 备份数据');
        return;
      }

      if (!freeotpBackupData.masterKey) {
        showCenterToast('❌', '备份数据中没有 masterKey');
        return;
      }

      try {
        showCenterToast('⏳', '正在解密...');

        const otpauthUrls = await decryptFreeOTPBackup(freeotpBackupData, password);

        if (otpauthUrls.length === 0) {
          showCenterToast('❌', '解密失败，请检查密码是否正确');
          return;
        }

        // 清空预览并重新填充
        const previewList = document.getElementById('importPreviewList');
        const executeBtn = document.getElementById('executeImportBtn');
        previewList.innerHTML = '';
        importPreviewData = [];

        let validCount = 0;
        let invalidCount = 0;

        otpauthUrls.forEach((line, index) => {
          const item = document.createElement('div');
          item.className = 'import-preview-item';

          try {
            const url = new URL(line);
            const type = url.hostname;
            const secret = url.searchParams.get('secret');
            const issuer = url.searchParams.get('issuer') || '';
            const digits = parseInt(url.searchParams.get('digits')) || 6;
            const period = parseInt(url.searchParams.get('period')) || 30;
            const algorithm = (url.searchParams.get('algorithm') || 'SHA1').toUpperCase();

            const pathParts = decodeURIComponent(url.pathname.substring(1)).split(':');
            let serviceName = issuer;
            let account = '';

            if (pathParts.length >= 2) {
              serviceName = pathParts[0] || issuer;
              account = pathParts.slice(1).join(':');
            } else if (pathParts.length === 1) {
              if (issuer) {
                serviceName = issuer;
                account = pathParts[0];
              } else {
                serviceName = pathParts[0];
              }
            }

            if (secret && serviceName) {
              item.className += ' valid';

              let displayInfo = serviceName;
              if (type === 'hotp') displayInfo += ' [HOTP]';
              if (digits !== 6) displayInfo += ' [' + digits + '位]';
              if (period !== 30 && type === 'totp') displayInfo += ' [' + period + 's]';
              if (algorithm !== 'SHA1') displayInfo += ' [' + algorithm + ']';

              item.innerHTML =
                '<div class="service-name">✅ ' + displayInfo + '</div>' +
                '<div class="account-name">' + (account || '(无账户)') + '</div>';

              importPreviewData.push({
                serviceName: serviceName,
                account: account,
                secret: secret.toUpperCase(),
                type: type,
                digits: digits,
                period: period,
                algorithm: algorithm,
                valid: true,
                line: index + 1
              });

              validCount++;
            }
          } catch (error) {
            item.className += ' invalid';
            item.innerHTML =
              '<div class="service-name">❌ 第' + (index + 1) + '行</div>' +
              '<div class="error-msg">' + error.message + '</div>';
            invalidCount++;
          }

          previewList.appendChild(item);
        });

        // 显示统计 - 更新顶部统计信息
        updateImportStats(validCount, invalidCount, 0);

        // 在预览列表顶部显示简短的成功提示
        const statsDiv = document.createElement('div');
        statsDiv.style.cssText = 'margin: 15px 0; padding: 10px; background: var(--bg-secondary); border-radius: 6px; font-size: 14px; color: var(--text-primary);';
        statsDiv.innerHTML = '<strong>🔓 FreeOTP 备份解密成功！</strong>';

        previewList.insertBefore(statsDiv, previewList.firstChild);

        // 启用导入按钮
        executeBtn.disabled = validCount === 0;
        executeBtn.textContent = '📥 导入';

        showCenterToast('✅', '成功解密 ' + validCount + ' 个密钥');
        freeotpBackupData = null; // 清理

      } catch (error) {
        if (error.name === 'OperationError') {
          showCenterToast('❌', '解密失败：密码错误或备份格式不正确');
        } else {
          showCenterToast('❌', '解密失败：' + (error.message || '未知错误'));
        }
      }
    }

    /**
     * 解密 TOTP Authenticator 备份并更新预览
     */
    async function decryptAndPreviewTOTPAuth() {
      const password = document.getElementById('totpAuthPassword').value;

      if (!password) {
        showCenterToast('❌', '请输入备份密码');
        return;
      }

      if (!totpAuthBackupData) {
        showCenterToast('❌', '未找到 TOTP Authenticator 备份数据');
        return;
      }

      try {
        showCenterToast('⏳', '正在解密...');

        const otpauthUrls = await decryptTOTPAuthenticatorBackup(totpAuthBackupData, password);

        if (otpauthUrls.length === 0) {
          showCenterToast('❌', '解密失败，请检查密码是否正确');
          return;
        }

        // 清空预览并重新填充
        const previewList = document.getElementById('importPreviewList');
        const executeBtn = document.getElementById('executeImportBtn');
        previewList.innerHTML = '';
        importPreviewData = [];

        let validCount = 0;
        let invalidCount = 0;

        otpauthUrls.forEach((line, index) => {
          const item = document.createElement('div');
          item.className = 'import-preview-item';

          try {
            const url = new URL(line);
            const type = url.hostname;
            const secret = url.searchParams.get('secret');
            const issuer = url.searchParams.get('issuer') || '';
            const digits = parseInt(url.searchParams.get('digits')) || 6;
            const period = parseInt(url.searchParams.get('period')) || 30;
            const algorithm = (url.searchParams.get('algorithm') || 'SHA1').toUpperCase();

            const pathParts = decodeURIComponent(url.pathname.substring(1)).split(':');
            let serviceName = issuer;
            let account = '';

            if (pathParts.length >= 2) {
              serviceName = pathParts[0] || issuer;
              account = pathParts.slice(1).join(':');
            } else if (pathParts.length === 1) {
              if (issuer) {
                serviceName = issuer;
                account = pathParts[0];
              } else {
                serviceName = pathParts[0];
              }
            }

            if (secret && serviceName) {
              item.className += ' valid';

              let displayInfo = serviceName;
              if (type === 'hotp') displayInfo += ' [HOTP]';
              if (digits !== 6) displayInfo += ' [' + digits + '位]';
              if (period !== 30 && type === 'totp') displayInfo += ' [' + period + 's]';
              if (algorithm !== 'SHA1') displayInfo += ' [' + algorithm + ']';

              item.innerHTML =
                '<div class="service-name">✅ ' + displayInfo + '</div>' +
                '<div class="account-name">' + (account || '(无账户)') + '</div>';

              importPreviewData.push({
                serviceName: serviceName,
                account: account,
                secret: secret.toUpperCase(),
                type: type,
                digits: digits,
                period: period,
                algorithm: algorithm,
                valid: true,
                line: index + 1
              });

              validCount++;
            }
          } catch (error) {
            item.className += ' invalid';
            item.innerHTML =
              '<div class="service-name">❌ 第' + (index + 1) + '行</div>' +
              '<div class="error-msg">' + error.message + '</div>';
            invalidCount++;
          }

          previewList.appendChild(item);
        });

        // 显示统计 - 更新顶部统计信息
        updateImportStats(validCount, invalidCount, 0);

        // 在预览列表顶部显示简短的成功提示
        const statsDiv = document.createElement('div');
        statsDiv.style.cssText = 'margin: 15px 0; padding: 10px; background: var(--bg-secondary); border-radius: 6px; font-size: 14px; color: var(--text-primary);';
        statsDiv.innerHTML = '<strong>🔓 TOTP Authenticator 备份解密成功！</strong>';

        previewList.insertBefore(statsDiv, previewList.firstChild);

        // 启用导入按钮
        executeBtn.disabled = validCount === 0;
        executeBtn.textContent = '📥 导入';

        showCenterToast('✅', '成功解密 ' + validCount + ' 个密钥');
        totpAuthBackupData = null; // 清理

      } catch (error) {
        if (error.name === 'OperationError') {
          showCenterToast('❌', '解密失败：密码错误');
        } else {
          showCenterToast('❌', '解密失败：' + (error.message || '未知错误'));
        }
      }
    }
`;
}
