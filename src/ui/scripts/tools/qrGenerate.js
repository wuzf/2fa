/**
 * 二维码生成工具模块
 */

/**
 * 获取二维码生成工具代码
 * @returns {string} 二维码生成工具 JavaScript 代码
 */
export function getQRGenerateToolCode() {
	return `    // ==================== 二维码生成工具 ====================

    function showQRGenerateModal() {
      showModal('qrGenerateModal', () => {
        document.getElementById('qrContentInput').value = '';
        document.getElementById('qrResultSection').style.display = 'none';
      });
    }

    function hideQRGenerateModal() {
      hideModal('qrGenerateModal');
    }

    async function generateQRCode() {
      const content = document.getElementById('qrContentInput').value.trim();
      if (!content) {
        showCenterToast('❌', '请输入要生成二维码的内容');
        return;
      }

      const qrImage = document.getElementById('generatedQRCode');
      const resultSection = document.getElementById('qrResultSection');

      try {
        let qrDataURL = null;
        let generationMethod = 'unknown';

        // 使用客户端本地生成二维码（隐私安全）
        qrDataURL = await generateQRCodeDataURL(content, {
          width: 300,
          height: 300
        });
        generationMethod = 'client_local';

        qrImage.src = qrDataURL;
        qrImage.onload = function() {
          resultSection.style.display = 'block';
        };
        qrImage.onerror = function() {
          showCenterToast('❌', '二维码生成失败，请重试');
        };

      } catch (error) {
        console.error('二维码生成过程发生错误:', error);
        showCenterToast('❌', '二维码生成失败: ' + error.message);
      }
    }

`;
}
