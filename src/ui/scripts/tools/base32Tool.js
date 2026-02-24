/**
 * Base32 编解码工具模块
 */

/**
 * 获取 Base32 工具代码
 * @returns {string} Base32 工具 JavaScript 代码
 */
export function getBase32ToolCode() {
	return `
    // ==================== Base32编解码工具 ====================

    function showBase32Modal() {
      showModal('base32Modal', () => {
        document.getElementById('plainTextInput').value = '';
        document.getElementById('base32TextInput').value = '';
        document.getElementById('encodedResult').textContent = '';
        document.getElementById('decodedResult').textContent = '';
      });
    }

    function hideBase32Modal() {
      hideModal('base32Modal');
    }

    // Base32字符集
    const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

    // UTF-8编码函数
    function utf8Encode(str) {
      const bytes = [];
      for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        if (code < 0x80) {
          bytes.push(code);
        } else if (code < 0x800) {
          bytes.push(0xc0 | (code >> 6));
          bytes.push(0x80 | (code & 0x3f));
        } else if (code < 0xd800 || code >= 0xe000) {
          bytes.push(0xe0 | (code >> 12));
          bytes.push(0x80 | ((code >> 6) & 0x3f));
          bytes.push(0x80 | (code & 0x3f));
        } else {
          // 处理UTF-16代理对
          i++;
          const c2 = str.charCodeAt(i);
          const cp = 0x10000 + ((code & 0x3ff) << 10) + (c2 & 0x3ff);
          bytes.push(0xf0 | (cp >> 18));
          bytes.push(0x80 | ((cp >> 12) & 0x3f));
          bytes.push(0x80 | ((cp >> 6) & 0x3f));
          bytes.push(0x80 | (cp & 0x3f));
        }
      }
      return bytes;
    }

    // UTF-8解码函数
    function utf8Decode(bytes) {
      let str = '';
      for (let i = 0; i < bytes.length;) {
        const b1 = bytes[i++];
        if (b1 < 0x80) {
          str += String.fromCharCode(b1);
        } else if (b1 < 0xe0) {
          const b2 = bytes[i++];
          str += String.fromCharCode(((b1 & 0x1f) << 6) | (b2 & 0x3f));
        } else if (b1 < 0xf0) {
          const b2 = bytes[i++];
          const b3 = bytes[i++];
          str += String.fromCharCode(((b1 & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f));
        } else {
          const b2 = bytes[i++];
          const b3 = bytes[i++];
          const b4 = bytes[i++];
          const cp = ((b1 & 0x07) << 18) | ((b2 & 0x3f) << 12) | ((b3 & 0x3f) << 6) | (b4 & 0x3f);
          if (cp > 0xffff) {
            const ch = cp - 0x10000;
            str += String.fromCharCode(0xd800 + (ch >> 10));
            str += String.fromCharCode(0xdc00 + (ch & 0x3ff));
          } else {
            str += String.fromCharCode(cp);
          }
        }
      }
      return str;
    }

    function encodeBase32() {
      const text = document.getElementById('plainTextInput').value.trim();
      if (!text) {
        showCenterToast('❌', '请输入要编码的文本');
        return;
      }

      try {
        // 先将文本转换为UTF-8字节数组
        const bytes = utf8Encode(text);
        let bits = 0;
        let bitsLength = 0;
        let result = '';

        // 处理每个字节
        for (let i = 0; i < bytes.length; i++) {
          bits = (bits << 8) | bytes[i];
          bitsLength += 8;

          // 每5位生成一个Base32字符
          while (bitsLength >= 5) {
            bitsLength -= 5;
            result += base32Chars[(bits >>> bitsLength) & 31];
          }
        }

        // 处理剩余的位
        if (bitsLength > 0) {
          bits = bits << (5 - bitsLength);
          result += base32Chars[bits & 31];
        }

        // 添加填充
        while (result.length % 8 !== 0) {
          result += '=';
        }

        const resultElement = document.getElementById('encodedResult');
        resultElement.textContent = result;
        resultElement.style.display = 'block';
        showCenterToast('✅', 'Base32编码成功');
      } catch (error) {
        showCenterToast('❌', '编码失败：' + error.message);
      }
    }

    function decodeBase32() {
      const base32Text = document.getElementById('base32TextInput').value.trim().toUpperCase();
      if (!base32Text) {
        showCenterToast('❌', '请输入要解码的Base32文本');
        return;
      }

      try {
        // 移除填充
        const cleaned = base32Text.replace(/=/g, '');

        // 验证字符集
        if (!/^[A-Z2-7]+$/.test(cleaned)) {
          throw new Error('包含无效的Base32字符');
        }

        let bits = 0;
        let bitsLength = 0;
        let bytes = [];

        // 处理每个Base32字符
        for (let i = 0; i < cleaned.length; i++) {
          const char = cleaned[i];
          const value = base32Chars.indexOf(char);

          if (value === -1) {
            throw new Error('无效的Base32字符：' + char);
          }

          bits = (bits << 5) | value;
          bitsLength += 5;

          // 每8位生成一个字节
          while (bitsLength >= 8) {
            bitsLength -= 8;
            bytes.push((bits >>> bitsLength) & 255);
          }
        }

        // 解码UTF-8字节数组
        const result = utf8Decode(bytes);
        const resultElement = document.getElementById('decodedResult');
        resultElement.textContent = result;
        resultElement.style.display = 'block';
        showCenterToast('✅', 'Base32解码成功');
      } catch (error) {
        showCenterToast('❌', '解码失败：' + error.message);
      }
    }

    async function copyEncodedText() {
      const text = document.getElementById('encodedResult').textContent;
      if (!text) {
        showCenterToast('❌', '没有可复制的内容');
        return;
      }

      try {
        await navigator.clipboard.writeText(text);
        showCenterToast('✅', '已复制编码结果');
      } catch (error) {
        showCenterToast('❌', '复制失败');
      }
    }

    async function copyDecodedText() {
      const text = document.getElementById('decodedResult').textContent;
      if (!text) {
        showCenterToast('❌', '没有可复制的内容');
        return;
      }

      try {
        await navigator.clipboard.writeText(text);
        showCenterToast('✅', '已复制解码结果');
      } catch (error) {
        showCenterToast('❌', '复制失败');
      }
    }


`;
}
