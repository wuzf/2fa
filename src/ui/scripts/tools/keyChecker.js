/**
 * 密钥检查器工具模块
 */

/**
 * 获取密钥检查器工具代码
 * @returns {string} 密钥检查器工具 JavaScript 代码
 */
export function getKeyCheckerToolCode() {
	return `
    // ==================== 密钥检查器 ====================

    function showKeyCheckModal() {
      showModal('keyCheckModal', () => {
        document.getElementById('keyCheckInput').value = '';
        document.getElementById('keyCheckResult').style.display = 'none';
      });
    }

    function hideKeyCheckModal() {
      hideModal('keyCheckModal');
    }

    function checkSecret() {
      const secret = document.getElementById('keyCheckInput').value.trim().toUpperCase();
      if (!secret) {
        showCenterToast('❌', '请输入要检查的密钥');
        return;
      }

      const result = validateSecretFormat(secret);
      displayCheckResult(result);
    }

    function validateSecretFormat(secret) {
      const result = {
        isValid: false,
        length: secret.length,
        lengthValid: false,
        charsetValid: false,
        paddingValid: false,
        suggestions: []
      };

      // 检查长度
      result.lengthValid = secret.length >= 8;
      if (!result.lengthValid) {
        result.suggestions.push('密钥长度至少需要8个字符');
      }

      // 检查字符集
      const base32Regex = /^[A-Z2-7]+=*$/;
      result.charsetValid = base32Regex.test(secret);
      if (!result.charsetValid) {
        result.suggestions.push('只能包含A-Z和2-7的字符');
      }

      // 检查填充
      const withoutPadding = secret.replace(/=+$/, '');
      const paddingLength = secret.length - withoutPadding.length;
      result.paddingValid = paddingLength === 0 || paddingLength <= 6;
      if (!result.paddingValid) {
        result.suggestions.push('填充字符(=)不能超过6个');
      }

      // 检查长度是否为8的倍数（考虑填充）
      const totalLength = withoutPadding.length + paddingLength;
      if (totalLength % 8 !== 0) {
        result.suggestions.push('填充后的总长度必须是8的倍数');
      }

      // 整体有效性
      result.isValid = result.lengthValid && result.charsetValid && result.paddingValid;

      return result;
    }

    function displayCheckResult(result) {
      const resultDiv = document.getElementById('checkResultContent');
      const resultSection = document.getElementById('keyCheckResult');

      let html = '<div style="display: flex; align-items: center; margin-bottom: 15px;">' +
        '<span style="font-size: 24px; margin-right: 10px;">' + (result.isValid ? '✅' : '❌') + '</span>' +
        '<span style="font-size: 18px; font-weight: 600; color: ' + (result.isValid ? '#28a745' : '#e74c3c') + ';">' + (result.isValid ? '密钥有效' : '密钥无效') + '</span>' +
        '</div>' +
        '<div style="margin-bottom: 15px;">' +
        '<div style="display: flex; justify-content: space-between; margin-bottom: 8px;">' +
        '<span style="font-weight: 600;">长度:</span>' +
        '<span style="color: ' + (result.lengthValid ? '#28a745' : '#e74c3c') + ';">' + result.length + ' 字符 ' + (result.lengthValid ? '(符合要求)' : '(不符合要求)') + '</span>' +
        '</div>' +
        '<div style="display: flex; justify-content: space-between; margin-bottom: 8px;">' +
        '<span style="font-weight: 600;">字符集:</span>' +
        '<span style="color: ' + (result.charsetValid ? '#28a745' : '#e74c3c') + ';">' + (result.charsetValid ? '符合Base32规范' : '包含非法字符') + '</span>' +
        '</div>' +
        '<div style="display: flex; justify-content: space-between;">' +
        '<span style="font-weight: 600;">填充:</span>' +
        '<span style="color: ' + (result.paddingValid ? '#28a745' : '#e74c3c') + ';">' + (result.paddingValid ? '填充正确' : '填充错误') + '</span>' +
        '</div>' +
        '</div>';

      if (!result.isValid && result.suggestions.length > 0) {
        html += '<div style="margin-top: 15px; padding: 10px; background: #fff3cd; border-radius: 6px;">' +
          '<div style="font-weight: 600; margin-bottom: 8px; color: #856404;">改进建议:</div>' +
          '<div style="font-size: 13px; color: #856404;">' +
          result.suggestions.map(suggestion => '• ' + suggestion).join('<br>') +
          '</div>' +
          '</div>';
      }

      resultDiv.innerHTML = html;
      resultSection.style.display = 'block';
    }


`;
}
