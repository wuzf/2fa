/**
 * Google Authenticator 迁移模块
 * 支持 Google Authenticator 的导入导出功能
 *
 * 功能：
 * - 解析 otpauth-migration:// 格式的迁移二维码（导入）
 * - 生成 otpauth-migration:// 格式的迁移二维码（导出）
 * - Protobuf 编解码
 */

/**
 * 获取 Google 迁移相关代码
 * @returns {string} JavaScript 代码
 */
export function getGoogleMigrationCode() {
	return `
    // ========== Google Authenticator 迁移模块 ==========
    // 支持 otpauth-migration:// 格式的导入导出

    // ==================== Protobuf 解码（导入）====================

    /**
     * 处理 Google Authenticator 迁移二维码
     * 格式: otpauth-migration://offline?data=<base64-encoded-protobuf>
     */
    function processGoogleMigration(qrCodeData) {
      try {
        console.log('检测到 Google Authenticator 迁移格式');

        // 提取 data 参数
        const url = new URL(qrCodeData);
        const dataParam = url.searchParams.get('data');

        if (!dataParam) {
          showScannerError('迁移二维码中缺少数据');
          return;
        }

        // URL 解码然后 Base64 解码
        const base64Data = decodeURIComponent(dataParam);
        const binaryData = atob(base64Data);
        const bytes = new Uint8Array(binaryData.length);
        for (let i = 0; i < binaryData.length; i++) {
          bytes[i] = binaryData.charCodeAt(i);
        }

        // 解析 Protobuf 数据
        const secrets = parseGoogleMigrationPayload(bytes);

        if (secrets.length === 0) {
          showScannerError('未能从迁移二维码中解析出任何密钥');
          return;
        }

        console.log('成功解析 ' + secrets.length + ' 个密钥:', secrets);

        // 关闭扫描器
        hideQRScanner();

        // 显示导入预览
        showGoogleMigrationPreview(secrets);

      } catch (error) {
        console.error('解析 Google 迁移二维码失败:', error);
        showScannerError('解析 Google 迁移二维码失败: ' + error.message);
      }
    }

    /**
     * 解析 Google Migration Payload (Protobuf 格式)
     * 简化的 Protobuf 解码器，专门用于解析 Google Authenticator 迁移格式
     */
    function parseGoogleMigrationPayload(bytes) {
      const secrets = [];
      let pos = 0;

      // 读取 varint
      function readVarint() {
        let result = 0;
        let shift = 0;
        while (pos < bytes.length) {
          const byte = bytes[pos++];
          result |= (byte & 0x7F) << shift;
          if ((byte & 0x80) === 0) break;
          shift += 7;
        }
        return result;
      }

      // 读取指定长度的字节
      function readBytes(length) {
        const result = bytes.slice(pos, pos + length);
        pos += length;
        return result;
      }

      // 解析单个 OTP 参数
      function parseOtpParameters(data) {
        const otp = {
          secret: '',
          name: '',
          issuer: '',
          algorithm: 'SHA1',
          digits: 6,
          type: 'TOTP',
          counter: 0
        };

        let p = 0;

        while (p < data.length) {
          const tag = data[p++];
          const fieldNumber = tag >> 3;
          const wireType = tag & 0x07;

          if (wireType === 0) {
            // Varint
            let value = 0;
            let shift = 0;
            while (p < data.length) {
              const byte = data[p++];
              value |= (byte & 0x7F) << shift;
              if ((byte & 0x80) === 0) break;
              shift += 7;
            }

            switch (fieldNumber) {
              case 4: // algorithm
                otp.algorithm = ['SHA1', 'SHA1', 'SHA256', 'SHA512', 'MD5'][value] || 'SHA1';
                break;
              case 5: // digits
                otp.digits = value === 2 ? 8 : 6;
                break;
              case 6: // type
                otp.type = value === 1 ? 'HOTP' : 'TOTP';
                break;
              case 7: // counter
                otp.counter = value;
                break;
            }
          } else if (wireType === 2) {
            // Length-delimited (string/bytes)
            let length = 0;
            let shift = 0;
            while (p < data.length) {
              const byte = data[p++];
              length |= (byte & 0x7F) << shift;
              if ((byte & 0x80) === 0) break;
              shift += 7;
            }

            const fieldData = data.slice(p, p + length);
            p += length;

            switch (fieldNumber) {
              case 1: // secret (bytes)
                // 将字节转换为 Base32
                otp.secret = bytesToBase32(fieldData);
                break;
              case 2: // name (string)
                otp.name = new TextDecoder().decode(fieldData);
                break;
              case 3: // issuer (string)
                otp.issuer = new TextDecoder().decode(fieldData);
                break;
            }
          }
        }

        return otp;
      }

      // 解析主 payload
      while (pos < bytes.length) {
        const tag = bytes[pos++];
        const fieldNumber = tag >> 3;
        const wireType = tag & 0x07;

        if (wireType === 0) {
          // Varint - 跳过 version, batch_size 等字段
          readVarint();
        } else if (wireType === 2) {
          // Length-delimited
          const length = readVarint();

          if (fieldNumber === 1) {
            // otp_parameters
            const otpData = readBytes(length);
            const otp = parseOtpParameters(otpData);
            if (otp.secret) {
              secrets.push(otp);
            }
          } else {
            // 跳过其他字段
            pos += length;
          }
        }
      }

      return secrets;
    }

    /**
     * 将字节数组转换为 Base32 字符串
     */
    function bytesToBase32(bytes) {
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
      let result = '';
      let bits = 0;
      let value = 0;

      for (let i = 0; i < bytes.length; i++) {
        value = (value << 8) | bytes[i];
        bits += 8;

        while (bits >= 5) {
          bits -= 5;
          result += alphabet[(value >> bits) & 0x1F];
        }
      }

      if (bits > 0) {
        result += alphabet[(value << (5 - bits)) & 0x1F];
      }

      return result;
    }

    // ==================== Protobuf 编码（导出）====================

    /**
     * 将 Base32 字符串转换为字节数组（bytesToBase32 的逆操作）
     */
    function base32ToBytes(base32String) {
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
      const cleanedInput = base32String.replace(/[\\s=]/g, '').toUpperCase();
      const bytes = [];
      let bits = 0;
      let value = 0;

      for (let i = 0; i < cleanedInput.length; i++) {
        const char = cleanedInput[i];
        const index = alphabet.indexOf(char);
        if (index === -1) continue; // 跳过无效字符

        value = (value << 5) | index;
        bits += 5;

        if (bits >= 8) {
          bits -= 8;
          bytes.push((value >> bits) & 0xFF);
        }
      }

      return new Uint8Array(bytes);
    }

    /**
     * 编码 Protobuf Varint
     */
    function encodeVarint(value) {
      const bytes = [];
      while (value > 0x7F) {
        bytes.push((value & 0x7F) | 0x80);
        value >>>= 7;
      }
      bytes.push(value & 0x7F);
      return bytes;
    }

    /**
     * 编码 Protobuf 长度前缀字段
     */
    function encodeLengthDelimited(fieldNumber, data) {
      const tag = (fieldNumber << 3) | 2; // wire type 2 = length-delimited
      const result = [];
      result.push(...encodeVarint(tag));
      result.push(...encodeVarint(data.length));
      for (let i = 0; i < data.length; i++) {
        result.push(data[i]);
      }
      return result;
    }

    /**
     * 编码 Protobuf Varint 字段
     */
    function encodeVarintField(fieldNumber, value) {
      const tag = (fieldNumber << 3) | 0; // wire type 0 = varint
      const result = [];
      result.push(...encodeVarint(tag));
      result.push(...encodeVarint(value));
      return result;
    }

    /**
     * 编码单个 OTP 参数为 Protobuf 格式
     */
    function encodeOtpParameters(secret) {
      const result = [];

      // Field 1: secret (bytes) - Base32 解码后的二进制
      const secretBytes = base32ToBytes(secret.secret || '');
      result.push(...encodeLengthDelimited(1, secretBytes));

      // Field 2: name (string) - 账户名
      const name = secret.account || secret.name || '';
      const nameBytes = new TextEncoder().encode(name);
      result.push(...encodeLengthDelimited(2, nameBytes));

      // Field 3: issuer (string) - 服务名
      const issuer = secret.name || '';
      const issuerBytes = new TextEncoder().encode(issuer);
      result.push(...encodeLengthDelimited(3, issuerBytes));

      // Field 4: algorithm (varint)
      // Google: 0=UNSPECIFIED, 1=SHA1, 2=SHA256, 3=SHA512, 4=MD5
      const algorithmMap = { 'SHA1': 1, 'SHA256': 2, 'SHA512': 3, 'MD5': 4 };
      const algorithm = algorithmMap[(secret.algorithm || 'SHA1').toUpperCase()] || 1;
      result.push(...encodeVarintField(4, algorithm));

      // Field 5: digits (varint)
      // Google: 0=UNSPECIFIED, 1=SIX, 2=EIGHT
      const digitsValue = (secret.digits || 6) === 8 ? 2 : 1;
      result.push(...encodeVarintField(5, digitsValue));

      // Field 6: type (varint)
      // Google: 0=UNSPECIFIED, 1=HOTP, 2=TOTP
      const typeValue = (secret.type || 'TOTP').toUpperCase() === 'HOTP' ? 1 : 2;
      result.push(...encodeVarintField(6, typeValue));

      // Field 7: counter (varint) - 仅 HOTP 需要
      if ((secret.type || 'TOTP').toUpperCase() === 'HOTP') {
        result.push(...encodeVarintField(7, secret.counter || 0));
      }

      return new Uint8Array(result);
    }

    /**
     * 生成 Google Migration Payload
     * @param {Array} secrets - 密钥数组
     * @param {Object} batchInfo - 批次信息
     * @param {number} batchInfo.totalBatches - 总二维码数量
     * @param {number} batchInfo.batchIndex - 当前二维码索引 (0-based)
     * @param {number} batchInfo.batchId - 批次ID (所有二维码使用相同ID)
     * @returns {Uint8Array} Protobuf 编码的 payload
     */
    function generateGoogleMigrationPayload(secrets, batchInfo = {}) {
      const result = [];

      // 每个密钥作为 Field 1 (repeated otp_parameters)
      for (const secret of secrets) {
        const otpData = encodeOtpParameters(secret);
        result.push(...encodeLengthDelimited(1, otpData));
      }

      // Field 2: version (int32) = 1
      result.push(...encodeVarintField(2, 1));

      // Field 3: batch_size (int32) = 总二维码数量
      const totalBatches = batchInfo.totalBatches || 1;
      result.push(...encodeVarintField(3, totalBatches));

      // Field 4: batch_index (int32) = 当前二维码索引
      const batchIndex = batchInfo.batchIndex || 0;
      result.push(...encodeVarintField(4, batchIndex));

      // Field 5: batch_id (int32) - 批次ID (所有二维码使用相同ID)
      const batchId = batchInfo.batchId || Math.floor(Math.random() * 1000000);
      result.push(...encodeVarintField(5, batchId));

      return new Uint8Array(result);
    }

    /**
     * 生成 Google Migration URL
     * @param {Array} secrets - 密钥数组
     * @param {Object} batchInfo - 批次信息
     * @returns {string} otpauth-migration:// URL
     */
    function generateGoogleMigrationURL(secrets, batchInfo = {}) {
      const payload = generateGoogleMigrationPayload(secrets, batchInfo);

      // 转换为 Base64
      let binary = '';
      for (let i = 0; i < payload.length; i++) {
        binary += String.fromCharCode(payload[i]);
      }
      const base64Data = btoa(binary);

      // URL 编码
      const encodedData = encodeURIComponent(base64Data);

      return 'otpauth-migration://offline?data=' + encodedData;
    }

    // ==================== 导出 UI ====================

    /**
     * 显示导出到 Google Authenticator 的模态框
     */
    function showExportToGoogleModal() {
      if (!secrets || secrets.length === 0) {
        showCenterToast('⚠️', '没有可导出的密钥');
        return;
      }

      // 创建导出选择模态框
      const modal = document.createElement('div');
      modal.id = 'exportToGoogleModal';
      modal.className = 'modal fab-modal';
      modal.style.display = 'flex';

      const content = document.createElement('div');
      content.className = 'modal-content fab-modal-content';
      content.style.maxHeight = '80vh';
      content.style.overflow = 'auto';

      content.innerHTML =
        '<div class="modal-header">' +
          '<h2>📤 导出到 Google Authenticator</h2>' +
          '<button class="close-btn" onclick="closeExportToGoogleModal()">&times;</button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<p style="margin-bottom: 15px; color: var(--text-secondary);">选择要导出的密钥（共 <strong>' + secrets.length + '</strong> 个）</p>' +
          '<div style="margin-bottom: 15px; display: flex; gap: 10px;">' +
            '<button class="btn btn-secondary btn-sm" onclick="selectAllExportSecrets(true)">全选</button>' +
            '<button class="btn btn-secondary btn-sm" onclick="selectAllExportSecrets(false)">取消全选</button>' +
          '</div>' +
          '<div class="export-secret-list" style="max-height: 300px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 8px; margin-bottom: 15px;">' +
            secrets.map(function(s, i) {
              return '<div class="export-secret-item" style="padding: 12px; border-bottom: 1px solid var(--border-color); display: flex; align-items: center; gap: 10px;">' +
                '<input type="checkbox" id="export-' + i + '" checked style="width: 18px; height: 18px;">' +
                '<div style="flex: 1; min-width: 0;">' +
                  '<div style="font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">' + (s.name || '未知服务') + '</div>' +
                  '<div style="font-size: 12px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">' + (s.account || '') + '</div>' +
                '</div>' +
                '<span style="font-size: 11px; padding: 2px 6px; background: var(--bg-tertiary); border-radius: 4px; color: var(--text-tertiary);">' + (s.type || 'TOTP') + '</span>' +
              '</div>';
            }).join('') +
          '</div>' +
          '<div style="display: flex; gap: 10px;">' +
            '<button class="btn btn-secondary" style="flex: 1;" onclick="closeExportToGoogleModal()">取消</button>' +
            '<button class="btn btn-primary" style="flex: 1;" onclick="generateExportQRCodes()">生成二维码</button>' +
          '</div>' +
        '</div>';

      modal.appendChild(content);
      document.body.appendChild(modal);

      setTimeout(function() { modal.classList.add('show'); }, 10);
      disableBodyScroll();
    }

    /**
     * 关闭导出到 Google 模态框
     */
    function closeExportToGoogleModal() {
      const modal = document.getElementById('exportToGoogleModal');
      if (modal) {
        modal.classList.remove('show');
        setTimeout(function() { modal.remove(); }, 300);
      }
      enableBodyScroll();
    }

    /**
     * 全选/取消全选导出密钥
     */
    function selectAllExportSecrets(selectAll) {
      const checkboxes = document.querySelectorAll('[id^="export-"]');
      checkboxes.forEach(function(cb) {
        cb.checked = selectAll;
      });
    }

    /**
     * 生成导出二维码
     */
    async function generateExportQRCodes() {
      // 获取选中的密钥
      const selectedSecrets = secrets.filter(function(s, i) {
        const checkbox = document.getElementById('export-' + i);
        return checkbox && checkbox.checked;
      });

      if (selectedSecrets.length === 0) {
        showCenterToast('⚠️', '请至少选择一个密钥');
        return;
      }

      // 关闭选择模态框
      closeExportToGoogleModal();

      // 分批处理（每批最多 10 个）
      const batchSize = 10;
      const batches = [];
      for (let i = 0; i < selectedSecrets.length; i += batchSize) {
        batches.push(selectedSecrets.slice(i, i + batchSize));
      }

      // 生成一个批次ID，所有二维码使用同一个ID
      const batchId = Math.floor(Math.random() * 1000000);

      // 显示二维码
      showExportQRCodeModal(batches, 0, batchId);
    }

    /**
     * 显示导出二维码模态框
     * @param {Array} batches - 分批后的密钥数组
     * @param {number} currentPage - 当前页码
     * @param {number} batchId - 批次ID (所有二维码使用相同ID)
     */
    async function showExportQRCodeModal(batches, currentPage, batchId) {
      const totalPages = batches.length;
      const currentBatch = batches[currentPage];

      // 生成当前批次的迁移 URL，传入批次信息
      const batchInfo = {
        totalBatches: totalPages,
        batchIndex: currentPage,
        batchId: batchId
      };
      const migrationURL = generateGoogleMigrationURL(currentBatch, batchInfo);

      // 创建或更新模态框
      let modal = document.getElementById('exportQRCodeModal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'exportQRCodeModal';
        modal.className = 'modal fab-modal-sm';
        modal.style.display = 'flex';
        document.body.appendChild(modal);
      }

      const startIndex = currentPage * 10 + 1;
      const endIndex = Math.min((currentPage + 1) * 10, (currentPage * 10) + currentBatch.length);
      const totalSecrets = batches.reduce(function(sum, b) { return sum + b.length; }, 0);

      modal.innerHTML =
        '<div class="modal-content fab-modal-sm-content" style="text-align: center;">' +
          '<div class="modal-header">' +
            '<h2>📱 扫描导入到 Google Authenticator</h2>' +
            '<button class="close-btn" onclick="closeExportQRCodeModal()">&times;</button>' +
          '</div>' +
          '<div class="modal-body">' +
            (totalPages > 1 ?
              '<p style="margin-bottom: 10px; color: var(--text-secondary);">第 ' + (currentPage + 1) + '/' + totalPages + ' 个二维码（密钥 ' + startIndex + '-' + endIndex + '/' + totalSecrets + '）</p>' :
              '<p style="margin-bottom: 10px; color: var(--text-secondary);">共 ' + totalSecrets + ' 个密钥</p>'
            ) +
            '<div class="qr-code-container" style="display: flex; justify-content: center; align-items: center; min-height: 250px; background: white; border-radius: 12px; padding: 20px; margin-bottom: 15px;">' +
              '<div style="color: #666;">🔄 生成中...</div>' +
            '</div>' +
            '<div style="margin-bottom: 15px; font-size: 12px; color: var(--text-tertiary);">' +
              '用 Google Authenticator 扫描此二维码' +
              (totalPages > 1 ? '<br>（需要依次扫描所有 ' + totalPages + ' 个二维码）' : '') +
            '</div>' +
            (totalPages > 1 ?
              '<div style="display: flex; gap: 10px; margin-bottom: 15px;">' +
                '<button class="btn btn-secondary" style="flex: 1;" onclick="showExportQRCodePage(' + (currentPage - 1) + ')" ' + (currentPage === 0 ? 'disabled' : '') + '>上一个</button>' +
                '<button class="btn btn-secondary" style="flex: 1;" onclick="showExportQRCodePage(' + (currentPage + 1) + ')" ' + (currentPage === totalPages - 1 ? 'disabled' : '') + '>下一个</button>' +
              '</div>' : ''
            ) +
            '<button class="btn btn-primary" style="width: 100%;" onclick="closeExportQRCodeModal()">完成</button>' +
          '</div>' +
        '</div>';

      // 保存批次数据和batchId供翻页使用
      window.exportQRCodeBatches = batches;
      window.exportQRCodeBatchId = batchId;

      setTimeout(function() { modal.classList.add('show'); }, 10);
      disableBodyScroll();

      // 生成二维码
      try {
        const qrDataURL = await generateQRCodeDataURL(migrationURL, { width: 250, height: 250 });
        const container = modal.querySelector('.qr-code-container');
        container.innerHTML = '<img src="' + qrDataURL + '" alt="Migration QR Code" style="width: 250px; height: 250px; border-radius: 8px;">';
      } catch (error) {
        console.error('生成二维码失败:', error);
        const container = modal.querySelector('.qr-code-container');
        container.innerHTML = '<div style="color: #e74c3c;">❌ 生成失败: ' + error.message + '</div>';
      }
    }

    /**
     * 切换导出二维码页面
     */
    function showExportQRCodePage(page) {
      if (window.exportQRCodeBatches && page >= 0 && page < window.exportQRCodeBatches.length) {
        showExportQRCodeModal(window.exportQRCodeBatches, page, window.exportQRCodeBatchId);
      }
    }

    /**
     * 关闭导出二维码模态框
     */
    function closeExportQRCodeModal() {
      const modal = document.getElementById('exportQRCodeModal');
      if (modal) {
        modal.classList.remove('show');
        setTimeout(function() { modal.remove(); }, 300);
      }
      window.exportQRCodeBatches = null;
      window.exportQRCodeBatchId = null;
      enableBodyScroll();
    }

    // ==================== 导入 UI ====================

    /**
     * 显示 Google 迁移导入预览
     */
    function showGoogleMigrationPreview(parsedSecrets) {
      // 创建预览模态框
      const modal = document.createElement('div');
      modal.id = 'migrationPreviewModal';
      modal.className = 'modal fab-modal';
      modal.style.display = 'flex';

      const content = document.createElement('div');
      content.className = 'modal-content fab-modal-content';
      content.style.maxHeight = '80vh';
      content.style.overflow = 'auto';

      content.innerHTML =
        '<div class="modal-header">' +
          '<h2>📱 Google Authenticator 导入</h2>' +
          '<button class="close-btn" onclick="closeMigrationPreview()">&times;</button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<p style="margin-bottom: 15px; color: var(--text-secondary);">检测到 <strong>' + parsedSecrets.length + '</strong> 个密钥，确认导入？</p>' +
          '<div class="migration-preview-list" style="max-height: 300px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 8px; margin-bottom: 15px;">' +
            parsedSecrets.map(function(s, i) {
              return '<div class="migration-preview-item" style="padding: 12px; border-bottom: 1px solid var(--border-color); display: flex; align-items: center; gap: 10px;">' +
                '<input type="checkbox" id="migrate-' + i + '" checked style="width: 18px; height: 18px;">' +
                '<div style="flex: 1; min-width: 0;">' +
                  '<div style="font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">' + (s.issuer || s.name || '未知服务') + '</div>' +
                  '<div style="font-size: 12px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">' + (s.name || '') + '</div>' +
                '</div>' +
                '<span style="font-size: 11px; padding: 2px 6px; background: var(--bg-tertiary); border-radius: 4px; color: var(--text-tertiary);">' + s.type + '</span>' +
              '</div>';
            }).join('') +
          '</div>' +
          '<div style="display: flex; gap: 10px;">' +
            '<button class="btn btn-secondary" style="flex: 1;" onclick="closeMigrationPreview()">取消</button>' +
            '<button class="btn btn-primary" style="flex: 1;" onclick="confirmGoogleMigration()">导入选中</button>' +
          '</div>' +
        '</div>';

      modal.appendChild(content);
      document.body.appendChild(modal);

      // 保存密钥数据供导入使用
      window.pendingMigrationSecrets = parsedSecrets;

      setTimeout(function() { modal.classList.add('show'); }, 10);
      disableBodyScroll();
    }

    /**
     * 关闭迁移预览模态框
     */
    function closeMigrationPreview() {
      const modal = document.getElementById('migrationPreviewModal');
      if (modal) {
        modal.classList.remove('show');
        setTimeout(function() { modal.remove(); }, 300);
      }
      window.pendingMigrationSecrets = null;
      enableBodyScroll();
    }

    /**
     * 显示导入结果模态框（包含失败详情）
     */
    function showImportResultModal(successCount, failCount, failedDetails) {
      // 创建结果模态框
      const modal = document.createElement('div');
      modal.id = 'importResultModal';
      modal.className = 'modal fab-modal-sm';
      modal.style.display = 'flex';

      const content = document.createElement('div');
      content.className = 'modal-content fab-modal-sm-content';
      content.style.maxHeight = '80vh';
      content.style.overflow = 'auto';

      content.innerHTML =
        '<div class="modal-header">' +
          '<h2>📊 导入结果</h2>' +
          '<button class="close-btn" onclick="closeImportResultModal()">&times;</button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<div style="text-align: center; margin-bottom: 20px;">' +
            '<div style="font-size: 48px; margin-bottom: 10px;">⚠️</div>' +
            '<div style="font-size: 16px; color: var(--text-primary);">' +
              '成功 <span style="color: #4CAF50; font-weight: bold;">' + successCount + '</span> 个，' +
              '失败 <span style="color: #f44336; font-weight: bold;">' + failCount + '</span> 个' +
            '</div>' +
          '</div>' +
          '<div style="background: var(--bg-secondary); border-radius: 8px; padding: 15px; margin-bottom: 15px;">' +
            '<div style="font-weight: 600; margin-bottom: 10px; color: #f44336;">❌ 失败详情：</div>' +
            '<div style="font-size: 13px; color: var(--text-secondary); white-space: pre-wrap; line-height: 1.6;">' + failedDetails + '</div>' +
          '</div>' +
          '<div style="text-align: center;">' +
            '<button class="btn btn-primary" onclick="closeImportResultModal()">确定</button>' +
          '</div>' +
        '</div>';

      modal.appendChild(content);
      document.body.appendChild(modal);

      setTimeout(function() { modal.classList.add('show'); }, 10);
      disableBodyScroll();
    }

    /**
     * 关闭导入结果模态框
     */
    function closeImportResultModal() {
      const modal = document.getElementById('importResultModal');
      if (modal) {
        modal.classList.remove('show');
        setTimeout(function() { modal.remove(); }, 300);
      }
      enableBodyScroll();
    }

    /**
     * 确认导入 Google 迁移的密钥
     */
    async function confirmGoogleMigration() {
      const pendingSecrets = window.pendingMigrationSecrets;
      if (!pendingSecrets || pendingSecrets.length === 0) {
        showCenterToast('❌', '没有可导入的密钥');
        closeMigrationPreview();
        return;
      }

      // 获取选中的密钥
      const selectedSecrets = pendingSecrets.filter(function(s, i) {
        const checkbox = document.getElementById('migrate-' + i);
        return checkbox && checkbox.checked;
      });

      if (selectedSecrets.length === 0) {
        showCenterToast('⚠️', '请至少选择一个密钥');
        return;
      }

      // 关闭预览
      closeMigrationPreview();

      // 显示导入进度
      showCenterToast('⏳', '正在导入 ' + selectedSecrets.length + ' 个密钥...');

      // 准备批量导入的数据
      const secretsToImport = selectedSecrets.map(function(secret) {
        // 解析 name 字段，可能包含 issuer:account 格式
        let serviceName = secret.issuer || '';
        let accountName = secret.name || '';

        // 如果 name 包含冒号，可能是 issuer:account 格式
        if (!serviceName && accountName.includes(':')) {
          const parts = accountName.split(':');
          serviceName = parts[0];
          accountName = parts.slice(1).join(':');
        }

        // 如果还是没有服务名，使用账户名或默认值
        if (!serviceName) {
          serviceName = accountName || '导入的密钥';
        }

        return {
          name: serviceName,
          account: accountName,
          secret: secret.secret,
          type: secret.type,
          digits: secret.digits,
          algorithm: secret.algorithm,
          counter: secret.counter || 0
        };
      });

      try {
        // 使用批量导入 API，一次性导入所有密钥
        const response = await authenticatedFetch('/api/secrets/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secrets: secretsToImport })
        });

        if (response.ok) {
          const result = await response.json();
          const successCount = result.successCount || 0;
          const failCount = result.failCount || 0;
          const results = result.results || [];

          // 刷新列表
          await loadSecrets();

          // 显示结果
          if (failCount === 0) {
            showCenterToast('✅', '成功导入 ' + successCount + ' 个密钥');
          } else {
            // 收集失败的密钥信息
            const failedItems = results.filter(function(r) { return !r.success; });
            const failedDetails = failedItems.map(function(r) {
              const originalSecret = selectedSecrets[r.index];
              const name = originalSecret ? (originalSecret.issuer || originalSecret.name || '未知') : '未知';
              return '• ' + name + ': ' + r.error;
            }).join('\\n');

            // 显示详细的失败信息
            showImportResultModal(successCount, failCount, failedDetails);
          }
        } else {
          const error = await response.json();
          showCenterToast('❌', '导入失败: ' + (error.message || error.error || '未知错误'));
        }
      } catch (error) {
        console.error('批量导入出错:', error);
        showCenterToast('❌', '导入失败: ' + error.message);
      }
    }
`;
}
