/**
 * 时间戳工具模块
 */

/**
 * 获取时间戳工具代码
 * @returns {string} 时间戳工具 JavaScript 代码
 */
export function getTimestampToolCode() {
	return `
    // ==================== 时间戳工具 ====================

    let currentPeriod = 30;
    let timestampInterval = null;

    function showTimestampModal() {
      showModal('timestampModal', () => {
        // 设置默认周期
        setPeriod(30);

        // 开始更新
        updateTimestamp();
        timestampInterval = setInterval(updateTimestamp, 1000);
      });
    }

    function hideTimestampModal() {
      hideModal('timestampModal', () => {
        if (timestampInterval) {
          clearInterval(timestampInterval);
          timestampInterval = null;
        }
      });
    }

    function setPeriod(period) {
      currentPeriod = period;

      // 更新按钮状态 - 使用CSS类而不是内联样式
      const buttons = ['period30Btn', 'period60Btn', 'period120Btn'];
      const periods = [30, 60, 120];

      buttons.forEach((btnId, index) => {
        const btn = document.getElementById(btnId);
        if (period === periods[index]) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });

      updateTimestamp();
    }

    function updateTimestamp() {
      const now = Math.floor(Date.now() / 1000);
      const counter = Math.floor(now / currentPeriod);
      const remaining = currentPeriod - (now % currentPeriod);
      const progress = (remaining / currentPeriod) * 100;

      document.getElementById('currentTimestamp').textContent = now;
      document.getElementById('totpPeriod').textContent = currentPeriod + ' 秒';
      document.getElementById('totpCounter').textContent = counter;
      document.getElementById('remainingTime').textContent = remaining + ' 秒';

      const progressBar = document.getElementById('progressBar');
      progressBar.style.width = progress + '%';

      // 使用与主界面卡片一致的渐变配色（绿色到蓝色）
      // 使用 CSS 变量确保主题一致性
      const style = getComputedStyle(document.documentElement);
      const progressFill = style.getPropertyValue('--progress-fill').trim() || 'linear-gradient(90deg, #4CAF50, #2196F3)';
      progressBar.style.background = progressFill;
    }

`;
}
