/**
 * 密钥生成器工具模块
 */

/**
 * 获取密钥生成器工具代码
 * @returns {string} 密钥生成器工具 JavaScript 代码
 */
export function getKeyGeneratorToolCode() {
	return `
    // ==================== 密钥生成器 ====================

    let currentKeyLength = 16;

    function showKeyGeneratorModal() {
      showModal('keyGeneratorModal', () => {
        // 设置默认长度
        setKeyLength(16);

        // 隐藏结果区域
        document.getElementById('keyResultSection').style.display = 'none';
      });
    }

    function hideKeyGeneratorModal() {
      hideModal('keyGeneratorModal');
    }

    function setKeyLength(length) {
      currentKeyLength = length;

      // 更新按钮状态 - 使用CSS类而不是内联样式
      const buttons = ['length16Btn', 'length26Btn', 'length32Btn'];
      const lengths = [16, 26, 32];

      buttons.forEach((btnId, index) => {
        const btn = document.getElementById(btnId);
        if (length === lengths[index]) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
    }

    function generateKey() {
      const key = generateRandomBase32Key(currentKeyLength);
      document.getElementById('generatedKeyText').textContent = key;
      document.getElementById('keyResultSection').style.display = 'block';
      showCenterToast('✅', '密钥生成成功');
    }

    function generateRandomBase32Key(length) {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
      let result = '';
      for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    }

    async function copyGeneratedKey() {
      const key = document.getElementById('generatedKeyText').textContent;
      if (!key) {
        showCenterToast('❌', '没有可复制的密钥');
        return;
      }

      try {
        await navigator.clipboard.writeText(key);
        showCenterToast('✅', '密钥已复制到剪贴板');
      } catch (error) {
        showCenterToast('❌', '复制失败');
      }
    }

`;
}
