/**
 * HTML 解析器模块
 * 包含 Aegis、2FA、Ente Auth 等 HTML 格式的解析
 */

/**
 * 获取 HTML 解析器代码
 * @returns {string} JavaScript 代码
 */
export function getHTMLParserCode() {
	return `
    // ========== HTML 解析器 ==========

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

              let issuer = '', account = '', secret = '', algo = 'SHA1', digits = 6, period = 30, type = 'totp';

              paragraphs.forEach((p, idx) => {
                const boldText = p.querySelector('b');
                if (!boldText) return;

                const text = p.textContent.trim();
                const value = boldText.textContent.trim();

                if (idx === 0) {
                  issuer = value;
                } else if (idx === 1) {
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

          console.log('成功解析 Ente Auth 格式，共 ' + otpauthUrls.length + ' 条');
          return otpauthUrls;
        }

        // 检测 Aegis/2FA HTML 格式
        tables.forEach((table, tableIndex) => {
          const rows = table.querySelectorAll('tr');

          rows.forEach((row, rowIndex) => {
            try {
              const cells = row.querySelectorAll('td');
              if (cells.length < 2) return;

              // 尝试提取服务名、账户、密钥
              let issuer = '', account = '', secret = '';

              // Aegis 格式: 服务名 | 账户 | 密钥
              if (cells.length >= 3) {
                issuer = cells[0].textContent.trim();
                account = cells[1].textContent.trim();
                secret = cells[2].textContent.trim();
              } else if (cells.length === 2) {
                issuer = cells[0].textContent.trim();
                secret = cells[1].textContent.trim();
              }

              if (!secret) return;

              // 清理密钥
              secret = secret.replace(/\\s+/g, '').toUpperCase();

              // 构建 otpauth:// URL
              let label = '';
              if (issuer && account) {
                label = encodeURIComponent(issuer) + ':' + encodeURIComponent(account);
              } else if (issuer) {
                label = encodeURIComponent(issuer);
              } else {
                label = 'Unknown';
              }

              const params = new URLSearchParams();
              params.set('secret', secret);
              if (issuer) params.set('issuer', issuer);

              const otpauthUrl = 'otpauth://totp/' + label + '?' + params.toString();
              otpauthUrls.push(otpauthUrl);

            } catch (err) {
              console.error('解析 HTML 行失败 (表 ' + tableIndex + ', 行 ' + rowIndex + '):', err);
            }
          });
        });

        console.log('成功从 HTML 解析 ' + otpauthUrls.length + ' 条密钥');

      } catch (error) {
        console.error('解析HTML失败:', error);
      }

      return otpauthUrls;
    }
`;
}
