/**
 * 导入工具函数模块
 * 包含编码转换、格式检测等通用工具函数
 */

/**
 * 获取导入工具函数代码
 * @returns {string} JavaScript 代码
 */
export function getImportUtilsCode() {
	return String.raw`
    // ========== 导入工具函数 ==========

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
     * 将 Uint8Array 转成二进制字符串
     * 保留 Java 序列化等二进制格式中的原始字节值
     * @param {Uint8Array} bytes - 原始字节数组
     * @returns {string} 二进制字符串
     */
    function bytesToBinaryString(bytes) {
      let result = '';
      const chunkSize = 0x8000;

      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.slice(i, i + chunkSize);
        result += String.fromCharCode.apply(null, Array.from(chunk));
      }

      return result;
    }

    /**
     * 解码导入文件内容
     * 兼容普通 UTF-8/UTF-16 文本以及 FreeOTP 的 Java 序列化二进制备份
     * @param {string} fileName - 文件名
     * @param {ArrayBuffer|Uint8Array} arrayBuffer - 文件二进制内容
     * @returns {string} 解码后的文本内容
     */
    function decodeImportFileContent(fileName, arrayBuffer) {
      const bytes = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
      const lowerFileName = String(fileName || '').toLowerCase();

      if (bytes.length >= 2) {
        if (bytes[0] === 0xff && bytes[1] === 0xfe) {
          return new TextDecoder('utf-16le').decode(bytes);
        }

        if (bytes[0] === 0xfe && bytes[1] === 0xff) {
          return new TextDecoder('utf-16be').decode(bytes);
        }

        // Java Object Serialization Stream Magic: 0xACED
        if (bytes[0] === 0xac && bytes[1] === 0xed) {
          return bytesToBinaryString(bytes);
        }
      }

      const utf8Text = new TextDecoder('utf-8').decode(bytes);
      if (!utf8Text.includes('\uFFFD')) {
        return utf8Text;
      }

      if (lowerFileName.endsWith('.xml') || lowerFileName.endsWith('.authpro') || lowerFileName.endsWith('.encrypt')) {
        return bytesToBinaryString(bytes);
      }

      return utf8Text;
    }
`;
}
