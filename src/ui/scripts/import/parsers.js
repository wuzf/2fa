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

    function normalizeJsonImportType(type) {
      return String(type || 'TOTP').toLowerCase() === 'hotp' ? 'hotp' : 'totp';
    }

    function normalizeJsonImportAlgorithm(algorithm) {
      return String(algorithm || 'SHA1').toUpperCase();
    }

    function normalizeJsonImportSecret(secret) {
      if (Array.isArray(secret)) {
        return bytesToBase32(secret);
      }

      return String(secret || '').replace(/[\\s\\-+]/g, '').toUpperCase();
    }

    function buildJsonImportLabel(issuer, account, fallbackLabel) {
      if (issuer && account) {
        return encodeURIComponent(issuer) + ':' + encodeURIComponent(account);
      }

      if (fallbackLabel) {
        return encodeURIComponent(fallbackLabel);
      }

      if (issuer) {
        return encodeURIComponent(issuer);
      }

      if (account) {
        return encodeURIComponent(account);
      }

      return 'Unknown';
    }

    function buildJsonImportOTPAuthUrl({
      issuer = '',
      account = '',
      secret = '',
      type = 'TOTP',
      digits = 6,
      period = 30,
      algorithm = 'SHA1',
      counter = 0,
      label = ''
    }) {
      const cleanSecret = normalizeJsonImportSecret(secret);
      if (!cleanSecret) {
        return null;
      }

      const normalizedType = normalizeJsonImportType(type);
      const normalizedAlgorithm = normalizeJsonImportAlgorithm(algorithm);
      const parsedDigits = parseInt(digits, 10) || 6;
      const parsedPeriod = parseInt(period, 10) || 30;
      const parsedCounter = parseInt(counter, 10) || 0;
      const finalLabel = buildJsonImportLabel(issuer, account, label);
      const params = new URLSearchParams();

      params.set('secret', cleanSecret);
      if (issuer) params.set('issuer', issuer);
      if (parsedDigits !== 6) params.set('digits', parsedDigits);
      if (normalizedType === 'totp' && parsedPeriod !== 30) params.set('period', parsedPeriod);
      if (normalizedType === 'hotp') params.set('counter', parsedCounter);
      if (normalizedAlgorithm !== 'SHA1') params.set('algorithm', normalizedAlgorithm);

      return 'otpauth://' + normalizedType + '/' + finalLabel + '?' + params.toString();
    }

    function parseStandardJsonEntries(entries, mapper, formatName) {
      const otpauthUrls = [];

      entries.forEach((entry, index) => {
        try {
          const fields = mapper(entry, index);
          if (!fields) {
            return;
          }

          const otpauthUrl = buildJsonImportOTPAuthUrl(fields);
          if (otpauthUrl) {
            otpauthUrls.push(otpauthUrl);
          } else {
            console.warn('跳过无密钥的 ' + formatName + ' 条目 (索引 ' + index + ')');
          }
        } catch (err) {
          console.error('解析 ' + formatName + ' 条目失败 (索引 ' + index + '):', err);
        }
      });

      console.log('成功解析 ' + formatName + ' 格式，共 ' + otpauthUrls.length + ' 条');
      return otpauthUrls;
    }

    function parseUriEntries(entries, selector, formatName) {
      const otpauthUrls = [];

      entries.forEach((entry, index) => {
        try {
          const uri = selector(entry, index);
          if (typeof uri !== 'string' || !uri.trim()) {
            console.warn('跳过无 otpauth URI 的 ' + formatName + ' 条目 (索引 ' + index + ')');
            return;
          }

          const trimmedUri = uri.trim().replace(/&amp;/g, '&');
          if (!trimmedUri.startsWith('otpauth://')) {
            console.warn('跳过非 otpauth URI 的 ' + formatName + ' 条目 (索引 ' + index + ')');
            return;
          }

          otpauthUrls.push(trimmedUri);
        } catch (err) {
          console.error('解析 ' + formatName + ' 条目失败 (索引 ' + index + '):', err);
        }
      });

      console.log('成功解析 ' + formatName + ' 格式，共 ' + otpauthUrls.length + ' 条');
      return otpauthUrls;
    }

    function parseAppJSON(jsonData) {
      return parseStandardJsonEntries(
        jsonData.secrets || [],
        secret => ({
          issuer: secret.name || '',
          account: secret.account || '',
          secret: secret.secret || '',
          type: secret.type || 'TOTP',
          digits: secret.digits || 6,
          period: secret.period || 30,
          algorithm: secret.algorithm || 'SHA1',
          counter: secret.counter || 0
        }),
        '本应用 JSON'
      );
    }

    function parseFreeOTPPlusJSON(jsonData) {
      return parseStandardJsonEntries(
        jsonData.tokens || [],
        token => ({
          issuer: token.issuerExt || token.issuerInt || '',
          account: token.label || '',
          secret: token.secret || '',
          type: token.type || 'TOTP',
          digits: token.digits || 6,
          period: token.period || 30,
          algorithm: token.algo || token.algorithm || 'SHA1',
          counter: token.counter || 0
        }),
        'FreeOTP+ JSON'
      );
    }

    function parseAegisJSON(jsonData) {
      const entries = jsonData?.db?.entries || [];

      return parseStandardJsonEntries(
        entries,
        entry => ({
          issuer: entry.issuer || '',
          account: entry.name || '',
          secret: entry.info?.secret || '',
          type: entry.type || 'totp',
          digits: entry.info?.digits || 6,
          period: entry.info?.period || 30,
          algorithm: entry.info?.algo || 'SHA1',
          counter: entry.info?.counter || 0
        }),
        'Aegis JSON'
      );
    }

    function parseBitwardenJSON(jsonData) {
      const items = Array.isArray(jsonData) ? jsonData : (jsonData.items || []);
      const otpauthUrls = [];

      items.forEach((item, index) => {
        try {
          const totpValue = String(item?.login?.totp || '').trim();
          if (!totpValue) {
            console.warn('跳过无 totp 字段的 Bitwarden Authenticator 条目 (索引 ' + index + ')');
            return;
          }

          if (totpValue.startsWith('otpauth://')) {
            otpauthUrls.push(totpValue.replace(/&amp;/g, '&'));
            return;
          }

          const issuer = item?.name || '';
          const account = item?.login?.username || '';
          const otpauthUrl = buildJsonImportOTPAuthUrl({
            issuer: issuer,
            account: account,
            label: issuer || account || 'Unknown',
            secret: totpValue,
            type: 'TOTP'
          });

          if (!otpauthUrl) {
            console.warn('跳过无密钥的 Bitwarden Authenticator 条目 (索引 ' + index + ')');
            return;
          }

          otpauthUrls.push(otpauthUrl);
        } catch (err) {
          console.error('解析 Bitwarden Authenticator 条目失败 (索引 ' + index + '):', err);
        }
      });

      console.log('成功解析 Bitwarden Authenticator JSON 格式，共 ' + otpauthUrls.length + ' 条');
      return otpauthUrls;
    }

    function parseProtonJSON(jsonData) {
      const entries = Array.isArray(jsonData) ? jsonData : (jsonData.entries || []);
      return parseUriEntries(entries, entry => entry?.content?.uri, 'Proton Authenticator JSON');
    }

    function parseAndOTPJSON(jsonData) {
      const entries = Array.isArray(jsonData) ? jsonData : (jsonData.accounts || []);

      return parseStandardJsonEntries(
        entries,
        entry => ({
          issuer: entry.issuer || '',
          account: entry.label || entry.account || '',
          secret: entry.secret || '',
          type: entry.type || 'TOTP',
          digits: entry.digits || 6,
          period: entry.period || 30,
          algorithm: entry.algorithm || 'SHA1',
          counter: entry.counter || 0
        }),
        'andOTP JSON'
      );
    }

    function isLastPassAccountsJSON(accounts) {
      return accounts.some(item => item && typeof item === 'object' && (
        'issuerName' in item ||
        'userName' in item ||
        'originalIssuerName' in item ||
        'originalUserName' in item ||
        'name' in item ||
        'timeStep' in item ||
        'folderData' in item ||
        'pushNotification' in item
      ));
    }

    function isAndOTPWrappedAccountsJSON(accounts) {
      return accounts.some(item => item && typeof item === 'object' && (
        'label' in item ||
        'account' in item
      ) && ('secret' in item));
    }

    function parseAuthProType(type) {
      if (type === 1 || String(type) === '1') {
        return 'hotp';
      }

      return 'totp';
    }

    function parseAuthProAlgorithm(algorithm) {
      if (algorithm === 1 || String(algorithm) === '1') {
        return 'SHA256';
      }

      if (algorithm === 2 || String(algorithm) === '2') {
        return 'SHA512';
      }

      if (typeof algorithm === 'string' && algorithm.toUpperCase().startsWith('SHA')) {
        return algorithm.toUpperCase();
      }

      return 'SHA1';
    }

    function parseAuthProJSON(jsonData) {
      return parseStandardJsonEntries(
        jsonData.Authenticators || [],
        authenticator => ({
          issuer: authenticator.Issuer || '',
          account: authenticator.Username || '',
          label: authenticator.Issuer || authenticator.Username || 'Unknown',
          secret: authenticator.Secret || '',
          type: parseAuthProType(authenticator.Type),
          digits: authenticator.Digits || 6,
          period: authenticator.Period || 30,
          algorithm: parseAuthProAlgorithm(authenticator.Algorithm),
          counter: authenticator.Counter || 0
        }),
        'Authenticator Pro JSON'
      );
    }

    function parse2FASJSON(jsonData) {
      return parseStandardJsonEntries(
        jsonData.services || [],
        service => ({
          issuer: service.otp?.issuer || service.name || '',
          account: service.otp?.account || service.otp?.label || '',
          secret: service.secret || '',
          type: service.otp?.tokenType || 'TOTP',
          digits: service.otp?.digits || 6,
          period: service.otp?.period || 30,
          algorithm: service.otp?.algorithm || 'SHA1',
          counter: service.otp?.counter || 0
        }),
        '2FAS JSON'
      );
    }

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

            const otpauthUrl = buildJsonImportOTPAuthUrl({
              issuer: issuer,
              account: name,
              secret: secret,
              type: 'TOTP',
              digits: digits,
              period: period,
              algorithm: algo
            });

            if (!otpauthUrl) {
              console.warn('跳过无密钥的 LastPass 条目 (索引 ' + index + ')');
              return;
            }

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

    /**
     * 统一解析支持的 JSON 导入格式
     * @param {Object|Array} jsonData - JSON 数据
     * @returns {Array<string>} otpauth:// URL 数组
     */
    function parseJsonImport(jsonData) {
      if (Array.isArray(jsonData)) {
        if (jsonData.every(item => typeof item === 'string')) {
          const otpauthUrls = jsonData
            .map(item => String(item || '').trim())
            .filter(item => item.startsWith('otpauth://'));

          if (otpauthUrls.length > 0) {
            return otpauthUrls;
          }
        }

        if (jsonData.some(item => item && typeof item === 'object' && ('secret' in item) && ('label' in item || 'issuer' in item))) {
          return parseAndOTPJSON(jsonData);
        }

        if (jsonData.some(item => item?.login?.totp)) {
          return parseBitwardenJSON(jsonData);
        }

        if (jsonData.some(item => item?.content?.uri)) {
          return parseProtonJSON(jsonData);
        }

        throw new Error('未识别的 JSON 导入格式');
      }

      if (!jsonData || typeof jsonData !== 'object') {
        throw new Error('未识别的 JSON 导入格式');
      }

      if (Array.isArray(jsonData.secrets)) {
        return parseAppJSON(jsonData);
      }

      if (Array.isArray(jsonData.tokens)) {
        return parseFreeOTPPlusJSON(jsonData);
      }

      if (Array.isArray(jsonData.Authenticators)) {
        return parseAuthProJSON(jsonData);
      }

      if (jsonData.db && Array.isArray(jsonData.db.entries)) {
        return parseAegisJSON(jsonData);
      }

      if (Array.isArray(jsonData.items)) {
        return parseBitwardenJSON(jsonData);
      }

      if (Array.isArray(jsonData.accounts)) {
        if (isLastPassAccountsJSON(jsonData.accounts)) {
          return parseLastPassJSON(jsonData);
        }

        if (isAndOTPWrappedAccountsJSON(jsonData.accounts)) {
          return parseAndOTPJSON(jsonData);
        }

        return parseLastPassJSON(jsonData);
      }

      if (Array.isArray(jsonData.entries)) {
        return parseProtonJSON(jsonData);
      }

      if (Array.isArray(jsonData.services)) {
        return parse2FASJSON(jsonData);
      }

      throw new Error('未识别的 JSON 导入格式');
    }
`;
}
