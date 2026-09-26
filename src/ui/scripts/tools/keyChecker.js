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

    let _lastCheckedSecret = null;

    function showKeyCheckModal() {
      showModal('keyCheckModal', () => {
        _lastCheckedSecret = null;
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
        showCenterToast('❌', t('toolKeyCheckInput'));
        return;
      }

      _lastCheckedSecret = secret;
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
        result.suggestions.push(t('toolKeyMinLength'));
      }

      // 检查字符集
      const base32Regex = /^[A-Z2-7]+=*$/;
      result.charsetValid = base32Regex.test(secret);
      if (!result.charsetValid) {
        result.suggestions.push(t('toolKeyCharsetHint'));
      }

      // 检查填充
      const withoutPadding = secret.replace(/=+$/, '');
      const paddingLength = secret.length - withoutPadding.length;
      result.paddingValid = paddingLength === 0 || paddingLength <= 6;
      if (!result.paddingValid) {
        result.suggestions.push(t('toolKeyPaddingHint'));
      }

      // 检查长度是否为8的倍数（考虑填充）
      const totalLength = withoutPadding.length + paddingLength;
      if (totalLength % 8 !== 0) {
        result.suggestions.push(t('toolKeyLengthHint'));
      }

      // 整体有效性
      result.isValid = result.lengthValid && result.charsetValid && result.paddingValid;

      return result;
    }

    function displayCheckResult(result) {
      const resultDiv = document.getElementById('checkResultContent');
      const resultSection = document.getElementById('keyCheckResult');

      let html = '<div style="display: flex; align-items: center; margin-bottom: 15px;">' +
        '<span style="font-size: var(--dialog-section-size); margin-right: 10px;">' + dialogIcon(result.isValid ? 'check' : 'error') + '</span>' +
        '<span style="font-size: var(--dialog-section-size); font-weight: 600; color: ' + (result.isValid ? 'var(--dialog-success)' : 'var(--dialog-danger)') + ';">' + (result.isValid ? t('toolKeyValid') : t('toolKeyInvalid')) + '</span>' +
        '</div>' +
        '<div style="margin-bottom: 15px;">' +
        '<div style="display: flex; justify-content: space-between; margin-bottom: 8px;">' +
        '<span style="font-weight: 600;">' + t('toolKeyLengthLabel') + '</span>' +
        '<span style="color: ' + (result.lengthValid ? 'var(--dialog-success)' : 'var(--dialog-danger)') + ';">' + t('toolKeyLengthValue', { count: result.length, status: t(result.lengthValid ? 'toolKeyLengthPass' : 'toolKeyLengthFail') }) + '</span>' +
        '</div>' +
        '<div style="display: flex; justify-content: space-between; margin-bottom: 8px;">' +
        '<span style="font-weight: 600;">' + t('toolKeyCharsetLabel') + '</span>' +
        '<span style="color: ' + (result.charsetValid ? 'var(--dialog-success)' : 'var(--dialog-danger)') + ';">' + (result.charsetValid ? t('toolKeyCharsetPass') : t('toolKeyCharsetFail')) + '</span>' +
        '</div>' +
        '<div style="display: flex; justify-content: space-between;">' +
        '<span style="font-weight: 600;">' + t('toolKeyPaddingLabel') + '</span>' +
        '<span style="color: ' + (result.paddingValid ? 'var(--dialog-success)' : 'var(--dialog-danger)') + ';">' + (result.paddingValid ? t('toolKeyPaddingPass') : t('toolKeyPaddingFail')) + '</span>' +
        '</div>' +
        '</div>';

      if (!result.isValid && result.suggestions.length > 0) {
        html += '<div style="margin-top: 15px; padding: 10px; background: var(--dialog-warning-bg); border-radius: 6px;">' +
          '<div style="font-weight: 600; margin-bottom: 8px; color: var(--dialog-warning);">' + t('toolKeySuggestions') + '</div>' +
          '<div style="font-size: var(--dialog-caption-size); color: var(--dialog-warning);">' +
          result.suggestions.map(suggestion => '• ' + suggestion).join('<br>') +
          '</div>' +
          '</div>';
      }

      resultDiv.innerHTML = html;
      resultSection.style.display = 'block';
    }


`;
}
