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
    let timestampFrame = null;
    let timestampActive = false;
    let lastTimestampSecond = null;
    let lastTimestampPeriod = null;

    function stopTimestampAnimation() {
      if (timestampFrame !== null) {
        cancelAnimationFrame(timestampFrame);
        timestampFrame = null;
      }
    }

    function animateTimestamp() {
      timestampFrame = null;
      if (!timestampActive || document.hidden) return;
      updateTimestamp();
      timestampFrame = requestAnimationFrame(animateTimestamp);
    }

    function startTimestampAnimation() {
      stopTimestampAnimation();
      if (timestampActive && !document.hidden) animateTimestamp();
    }

    document.addEventListener('visibilitychange', function() {
      if (document.hidden) {
        stopTimestampAnimation();
      } else {
        startTimestampAnimation();
      }
    });

    function showTimestampModal() {
      showModal('timestampModal', () => {
        timestampActive = true;
        // 设置默认周期
        setPeriod(30);
        startTimestampAnimation();
      });
    }

    function hideTimestampModal() {
      timestampActive = false;
      stopTimestampAnimation();
      hideModal('timestampModal');
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
      const nowMs = Date.now();
      const now = Math.floor(nowMs / 1000);
      const periodMs = currentPeriod * 1000;
      const remainingMs = periodMs - (nowMs % periodMs);
      const fraction = remainingMs / periodMs;
      const progressBar = document.getElementById('progressBar');
      // Continuous time, with an immediate reset at the next cycle. Transform
      // avoids a layout pass on every frame and does not interpolate backwards.
      progressBar.style.transform = 'scaleX(' + fraction + ')';

      // Text and accessibility values only change on second/period boundaries.
      if (now !== lastTimestampSecond || currentPeriod !== lastTimestampPeriod) {
        const remaining = Math.ceil(remainingMs / 1000);
        document.getElementById('currentTimestamp').textContent = now;
        document.getElementById('totpPeriod').textContent = currentPeriod + ' 秒';
        document.getElementById('totpCounter').textContent = Math.floor(nowMs / periodMs);
        document.getElementById('remainingTime').textContent = remaining + ' 秒';
        progressBar.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
        progressBar.setAttribute('aria-valuetext', remaining + ' 秒');
        lastTimestampSecond = now;
        lastTimestampPeriod = currentPeriod;
      }
    }

`;
}
