/**
 * 导入解析器模块
 * 包含各种格式的解析函数（CSV、HTML、JSON等）
 */

/**
 * 获取CSV解析器代码
 * @returns {string} JavaScript 代码
 */
export function getCSVParserCode() {
	return `
    // ========== CSV 解析器 ==========

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

        // 检测 Bitwarden Authenticator CSV 格式: folder,favorite,type,name,login_uri,login_totp
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
            const cleanSecret = secret.replace(/\\s+/g, '').toUpperCase();

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
`;
}

/**
 * 获取JSON解析器代码（LastPass等格式）
 * @returns {string} JavaScript 代码
 */
export function getJSONParserCode() {
	return `
    // ========== JSON 解析器 ==========

    /**
     * 解析 LastPass JSON 格式
     * @param {Object} jsonData - JSON 数据
     * @returns {Array<string>} otpauth:// URL 数组
     */
    function parseLastPassJSON(jsonData) {
      const otpauthUrls = [];

      try {
        // LastPass JSON 结构: { accounts: [...] }
        const accounts = jsonData.accounts || [];

        accounts.forEach((account, index) => {
          try {
            // LastPass 账户结构
            const issuer = account.issuerName || account.issuer || '';
            const name = account.userName || account.name || '';
            const secret = account.secret || '';
            const digits = account.digits || 6;
            const period = account.timeStep || account.period || 30;
            const algo = account.algorithm || 'SHA1';

            if (!secret) {
              console.warn('跳过无密钥的 LastPass 条目 (索引 ' + index + ')');
              return;
            }

            // 清理密钥
            const cleanSecret = secret.replace(/\\s+/g, '').toUpperCase();

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
            params.set('secret', cleanSecret);
            if (issuer) params.set('issuer', issuer);
            if (digits !== 6) params.set('digits', digits);
            if (period !== 30) params.set('period', period);
            if (algo !== 'SHA1') params.set('algorithm', algo);

            const otpauthUrl = 'otpauth://totp/' + label + '?' + params.toString();
            otpauthUrls.push(otpauthUrl);

            console.log('LastPass 条目 ' + (index + 1) + ':', issuer, name);
          } catch (err) {
            console.error('解析 LastPass 条目失败 (索引 ' + index + '):', err);
          }
        });

        console.log('成功解析 LastPass 格式，共 ' + otpauthUrls.length + ' 条');
      } catch (error) {
        console.error('解析 LastPass JSON 失败:', error);
      }

      return otpauthUrls;
    }
`;
}
