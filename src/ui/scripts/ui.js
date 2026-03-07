/**
 * UI 交互模块
 * 包含 Toast 提示、主题切换、模态框管理、滚动控制等 UI 交互功能
 */

/**
 * 获取 UI 交互相关代码
 * @returns {string} UI JavaScript 代码
 */
export function getUICode() {
	return `    // ========== UI 交互模块 ==========

    // Toast 提示相关变量
    let toastTimeout = null;
    let isToastVisible = false;
    let lastToastTime = 0;

    // 显示中间提示
    function showCenterToast(icon, message) {
      const now = Date.now();

      // 防止过于频繁的toast调用（至少间隔100ms）
      if (now - lastToastTime < 100) {
        return;
      }
      lastToastTime = now;
      const toast = document.getElementById('centerToast');
      const iconElement = toast.querySelector('.toast-icon');
      const messageElement = toast.querySelector('.toast-message');

      // 如果当前有toast正在显示，先清除之前的定时器
      if (toastTimeout) {
        clearTimeout(toastTimeout);
        toastTimeout = null;
      }

      // 更新内容
      iconElement.textContent = icon;
      messageElement.textContent = message;

      // 如果toast已经显示，先隐藏再显示，确保动画效果
      if (isToastVisible) {
        toast.classList.remove('show');
        // 等待隐藏动画完成后再显示新的toast
        setTimeout(() => {
          toast.classList.add('show');
          isToastVisible = true;

          // 设置新的定时器
          toastTimeout = setTimeout(() => {
            toast.classList.remove('show');
            isToastVisible = false;
            toastTimeout = null;
          }, 2000);
        }, 125); // 等待隐藏动画的一半时间 (0.25s / 2)
      } else {
        // 直接显示toast
        toast.classList.add('show');
        isToastVisible = true;

        // 设置定时器
        toastTimeout = setTimeout(() => {
          toast.classList.remove('show');
          isToastVisible = false;
          toastTimeout = null;
        }, 2000);
      }
    }

    // 主题切换功能（支持三种模式：light、dark、auto）
    function toggleTheme() {
      const currentTheme = localStorage.getItem('theme') || 'auto';

      // 三种模式循环切换：light → dark → auto → light
      let nextTheme;
      if (currentTheme === 'light') {
        nextTheme = 'dark';
      } else if (currentTheme === 'dark') {
        nextTheme = 'auto';
      } else {
        nextTheme = 'light';
      }

      localStorage.setItem('theme', nextTheme);
      applyTheme(nextTheme, true); // 带过渡动画
    }

    // 更新主题图标
    function updateThemeIcon(theme) {
      const themeIcon = document.getElementById('theme-icon');
      if (!themeIcon) return;

      // 主题配置（集中管理）
      const THEME_CONFIG = {
        light: { icon: '☀️', title: '当前：浅色模式（点击切换）', label: '切换主题：当前浅色模式' },
        dark: { icon: '🌙', title: '当前：深色模式（点击切换）', label: '切换主题：当前深色模式' },
        auto: { icon: '🌓', title: '当前：跟随系统（点击切换）', label: '切换主题：当前跟随系统' }
      };

      const config = THEME_CONFIG[theme] || THEME_CONFIG.auto;
      themeIcon.textContent = config.icon;

      // 更新按钮的 title 和 aria-label
      const themeButton = themeIcon.closest('button');
      if (themeButton) {
        themeButton.title = config.title;
        themeButton.setAttribute('aria-label', config.label);
      }
    }

    // 应用主题（支持过渡动画）
    function applyTheme(theme, withTransition = false) {
      const root = document.documentElement;

      // 添加过渡类（如果需要动画）
      if (withTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        root.classList.add('theme-transition');

        // 过渡完成后移除类
        setTimeout(() => {
          root.classList.remove('theme-transition');
        }, 300);
      }

      // 设置主题属性
      if (theme === 'dark') {
        root.setAttribute('data-theme', 'dark');
      } else if (theme === 'light') {
        root.setAttribute('data-theme', 'light');
      } else {
        // auto 模式：跟随系统
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
      }

      // 更新图标
      updateThemeIcon(theme);
    }

    function initTheme() {
      const savedTheme = localStorage.getItem('theme') || 'auto';

      // 主题已在 head 内联脚本中应用，这里只需同步图标状态
      updateThemeIcon(savedTheme);

      // 监听系统主题变化（仅在 auto 模式下生效）
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        const currentTheme = localStorage.getItem('theme') || 'auto';
        if (currentTheme === 'auto') {
          applyTheme('auto');
        }
      });
    }

    // 模态框管理
    function hideQRModal() {
      const modal = document.getElementById('qrModal');
      modal.classList.remove('show');
      setTimeout(() => modal.style.display = 'none', 300);
      enableBodyScroll();
    }

    function showAddModal() {
      showModal('secretModal', () => {
        editingId = null;
        document.getElementById('modalTitle').textContent = '添加新密钥';
        document.getElementById('submitBtn').textContent = '保存';
        document.getElementById('secretForm').reset();
        document.getElementById('secretId').value = '';
      });
    }

    // 隐藏添加/编辑密钥模态框
    function hideSecretModal() {
      const modal = document.getElementById('secretModal');
      modal.classList.remove('show');
      setTimeout(() => modal.style.display = 'none', 300);
      enableBodyScroll();
    }

    // 实用工具相关函数
    function showToolsModal() {
      showModal('toolsModal');
    }

    function hideToolsModal() {
      hideModal('toolsModal');
    }

    // 设置模态框相关函数
    function showSettingsModal() {
      showModal('settingsModal', () => {
        // 重置到第一个标签页
        switchSettingsTab('security');
      });
    }

    function hideSettingsModal() {
      hideModal('settingsModal');
    }

    // 折叠式菜单控制函数
    function toggleActionMenu() {
      const mainBtn = document.getElementById('mainActionBtn');
      const submenu = document.getElementById('actionSubmenu');
      const overlay = document.getElementById('menuOverlay');

      const isActive = mainBtn.classList.contains('active');

      if (isActive) {
        closeActionMenu();
      } else {
        openActionMenu();
      }
    }

    function openActionMenu() {
      const mainBtn = document.getElementById('mainActionBtn');
      const submenu = document.getElementById('actionSubmenu');
      const overlay = document.getElementById('menuOverlay');

      mainBtn.classList.add('active');
      submenu.classList.add('show');
      overlay.classList.add('show');

      // 防止点击事件冒泡
      event.stopPropagation();
    }

    function closeActionMenu() {
      const mainBtn = document.getElementById('mainActionBtn');
      const submenu = document.getElementById('actionSubmenu');
      const overlay = document.getElementById('menuOverlay');

      mainBtn.classList.remove('active');
      submenu.classList.remove('show');
      overlay.classList.remove('show');
    }

    // 高级选项切换函数
    function toggleAdvancedOptions() {
      const checkbox = document.getElementById('showAdvanced');
      const options = document.getElementById('advancedOptions');

      if (checkbox.checked) {
        options.style.display = 'block';
        updateAdvancedOptionsForType(); // 根据当前类型调整UI
      } else {
        options.style.display = 'none';
      }
    }

    // 根据OTP类型更新高级选项UI
    function updateAdvancedOptionsForType() {
      const typeSelect = document.getElementById('secretType');
      const digitsGroup = document.getElementById('digitsGroup');
      const periodGroup = document.getElementById('periodGroup');
      const algorithmGroup = document.getElementById('algorithmGroup');
      const counterRow = document.getElementById('counterRow');
      const advancedInfo = document.getElementById('advancedInfo');
      const digitsSelect = document.getElementById('secretDigits');
      const periodSelect = document.getElementById('secretPeriod');
      const algorithmSelect = document.getElementById('secretAlgorithm');

      const selectedType = typeSelect.value;

      switch (selectedType) {
        case 'HOTP':
          // HOTP: 显示位数、算法、计数器，隐藏周期
          digitsGroup.style.display = 'block';
          periodGroup.style.display = 'none';
          algorithmGroup.style.display = 'block';
          counterRow.style.display = 'block';
          advancedInfo.textContent = 'HOTP使用计数器基准，每次生成后计数器自动递增';
          break;

        case 'TOTP':
        default:
          // TOTP: 显示位数、周期、算法，隐藏计数器
          digitsGroup.style.display = 'block';
          periodGroup.style.display = 'block';
          algorithmGroup.style.display = 'block';
          counterRow.style.display = 'none';
          advancedInfo.textContent = '大多数2FA应用使用默认设置：TOTP、6位、30秒、SHA1算法';
          break;
      }
    }

    // ESC键关闭菜单
    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') {
        closeActionMenu();
      }
    });
`;
}
