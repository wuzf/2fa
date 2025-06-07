/**
 * CSS 变量定义模块
 * 实现浅色模式和深色模式的主题变量
 */
export function getVariables() {
	return `
    /* ========== CSS 变量系统 ========== */

    /* 浅色模式变量定义 */
    :root {
      /* === 主题过渡动画 === */
      --theme-transition-duration: 0.3s;
      --theme-transition:
        background-color var(--theme-transition-duration) ease,
        color var(--theme-transition-duration) ease,
        border-color var(--theme-transition-duration) ease,
        box-shadow var(--theme-transition-duration) ease;

      /* === 基础颜色 === */
      /* 纯色 */
      --color-white: #ffffff;
      --color-black: #000000;

      /* 灰度色阶 */
      --gray-50: #f8f9fa;
      --gray-100: #f1f3f5;
      --gray-200: #e9ecef;
      --gray-300: #dee2e6;
      --gray-400: #ced4da;
      --gray-500: #adb5bd;
      --gray-600: #6c757d;
      --gray-700: #495057;
      --gray-800: #343a40;
      --gray-900: #212529;

      /* 品牌主色 */
      --primary-50: #e3f2fd;
      --primary-100: #bbdefb;
      --primary-200: #90caf9;
      --primary-300: #64b5f6;
      --primary-400: #42a5f5;
      --primary-500: #2196f3;
      --primary-600: #1e88e5;
      --primary-700: #1976d2;
      --primary-800: #1565c0;
      --primary-900: #0d47a1;

      /* 功能色 */
      --success-light: #e8f5e8;
      --success: #4caf50;
      --success-dark: #388e3c;
      --success-darker: #2e7d32;

      --warning-light: #fff3e0;
      --warning: #ffc107;
      --warning-dark: #ffa000;

      --danger-light: #ffebee;
      --danger: #f44336;
      --danger-dark: #e74c3c;
      --danger-darker: #dc3545;

      --info-light: #e3f2fd;
      --info: #17a2b8;
      --info-dark: #138496;

      /* === 语义化变量（浅色模式） === */

      /* 背景色 */
      --bg-primary: #ffffff;
      --bg-secondary: #f8f9fa;
      --bg-tertiary: #e9ecef;
      --bg-elevated: #ffffff;
      --bg-overlay: rgba(0, 0, 0, 0.8);
      --bg-hover: #f1f3f5;
      --bg-active: #e9ecef;
      --bg-disabled: #f8f9fa;

      /* 文字色 */
      --text-primary: #2c3e50;
      --text-secondary: #6c757d;
      --text-tertiary: #95a5a6;
      --text-disabled: #adb5bd;
      --text-inverse: #ffffff;
      --text-link: #3498db;
      --text-link-hover: #2980b9;

      /* 边框色 */
      --border-primary: #e9ecef;
      --border-secondary: #dee2e6;
      --border-tertiary: #ced4da;
      --border-focus: #3498db;
      --border-error: #dc3545;
      --border-success: #4caf50;

      /* 阴影 */
      --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.05);
      --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.1);
      --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.15);
      --shadow-xl: 0 20px 60px rgba(0, 0, 0, 0.3);

      /* 按钮颜色 */
      --btn-primary-bg: #3498db;
      --btn-primary-hover: #2980b9;
      --btn-primary-text: #ffffff;

      --btn-secondary-bg: #95a5a6;
      --btn-secondary-hover: #7f8c8d;
      --btn-secondary-text: #ffffff;

      --btn-danger-bg: #e74c3c;
      --btn-danger-hover: #c0392b;
      --btn-danger-text: #ffffff;

      --btn-info-bg: #17a2b8;
      --btn-info-hover: #138496;
      --btn-info-text: #ffffff;

      /* 表单元素 */
      --input-bg: #f8f9fa;
      --input-bg-focus: #ffffff;
      --input-border: #e9ecef;
      --input-border-focus: #3498db;
      --input-text: #2c3e50;
      --input-placeholder: #6c757d;

      /* 卡片 */
      --card-bg: #ffffff;
      --card-border: #e9ecef;
      --card-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
      --card-hover-border: #3498db;
      --card-hover-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);

      /* 模态框 */
      --modal-bg: #ffffff;
      --modal-border: #e9ecef;
      --modal-overlay: rgba(0, 0, 0, 0.8);
      --modal-header-border: #e9ecef;

      /* 进度条 */
      --progress-bg: #e9ecef;
      --progress-fill: linear-gradient(90deg, #4CAF50, #2196F3);

      /* 滚动条 */
      --scrollbar-track: transparent;
      --scrollbar-thumb: #cbd5e0;
      --scrollbar-thumb-hover: #a0aec0;

      /* OTP 显示 */
      --otp-text: #2c3e50;
      --otp-next-bg: #f8f9fa;
      --otp-next-bg-hover: #e9ecef;
      --otp-next-text: #6c757d;

      /* 搜索框 */
      --search-bg: #ffffff;
      --search-border: #e9ecef;
      --search-border-focus: #3498db;
      --search-icon: #6c757d;

      /* 菜单 */
      --menu-bg: #ffffff;
      --menu-border: #e9ecef;
      --menu-item-hover: #f8f9fa;
      --menu-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);

      /* 导入相关 */
      --import-instructions-bg: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
      --import-instructions-border: #e9ecef;
      --import-method-bg: #ffffff;
      --import-method-border: #dee2e6;
      --import-method-hover-border: #17a2b8;
      --import-example-bg: #fff3cd;
      --import-example-text: #856404;
      --import-example-border: #ffeaa7;
      --import-file-bg: linear-gradient(135deg, #f8f9fa 0%, #e3f2fd 100%);
      --import-file-border: #17a2b8;

      /* 还原配置 */
      --restore-instructions-bg: linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%);
      --restore-instructions-border: #ff9800;
      --restore-warning-bg: rgba(255, 255, 255, 0.7);
      --restore-warning-text: #d84315;
      --restore-warning-border: rgba(216, 67, 21, 0.2);

      /* 备份列表 */
      --backup-header-bg: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%);
      --backup-header-border: #2196f3;
      --backup-header-text: #1976d2;
      --backup-select-bg: #ffffff;
      --backup-select-border: #e3f2fd;

      /* 备份表格 */
      --table-bg: #ffffff;
      --table-header-bg: linear-gradient(135deg, #4caf50 0%, #66bb6a 100%);
      --table-header-text: #ffffff;
      --table-header-border: #388e3c;
      --table-border: #e0e0e0;
      --table-row-hover: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);

      /* 工具 */
      --tool-bg: #ffffff;
      --tool-border: #e9ecef;
      --tool-hover-bg: #f8f9fa;
      --tool-icon-bg: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
      --tool-icon-border: #dee2e6;

      /* Toast 提示 */
      --toast-bg: rgba(0, 0, 0, 0.9);
      --toast-text: #ffffff;
      --toast-border: rgba(255, 255, 255, 0.1);

      /* Footer */
      --footer-bg: transparent;
      --footer-border: #e9ecef;
      --footer-text: #6c757d;
      --footer-link: #6c757d;
      --footer-link-hover: #3498db;

      /* 悬浮按钮 */
      --float-btn-bg: #3498db;
      --float-btn-hover: #2980b9;
      --float-btn-text: #ffffff;
      --float-btn-shadow: 0 8px 32px rgba(52, 152, 219, 0.3);

      /* 主题切换按钮 */
      --theme-toggle-bg: #f8f9fa;
      --theme-toggle-hover: #e9ecef;
      --theme-toggle-border: #dee2e6;

      /* 返回顶部按钮 */
      --back-to-top-bg: #f8f9fa;
      --back-to-top-hover: #e9ecef;
      --back-to-top-border: #dee2e6;
      --back-to-top-text: #2c3e50;
    }

    /* ========== 深色模式变量覆盖 ========== */
    [data-theme="dark"] {
      /* === 语义化变量（深色模式） === */

      /* 功能色 - 深色模式背景需要较暗，以便与白色文字形成对比 */
      --success-light: rgba(76, 175, 80, 0.15);
      --warning-light: rgba(255, 193, 7, 0.15);
      --danger-light: rgba(244, 67, 54, 0.15);
      --info-light: rgba(23, 162, 184, 0.15);

      /* 背景色 */
      --bg-primary: #1a1a1a;
      --bg-secondary: #2d3748;
      --bg-tertiary: #1a202c;
      --bg-elevated: #2a2a2a;
      --bg-overlay: rgba(0, 0, 0, 0.9);
      --bg-hover: #374151;
      --bg-active: #4a5568;
      --bg-disabled: #2d3748;

      /* 文字色 */
      --text-primary: #ffffff;
      --text-secondary: #a0aec0;
      --text-tertiary: #718096;
      --text-disabled: #4a5568;
      --text-inverse: #2c3e50;
      --text-link: #63b3ed;
      --text-link-hover: #4299e1;

      /* 边框色 */
      --border-primary: #4a5568;
      --border-secondary: #2d3748;
      --border-tertiary: #1a202c;
      --border-focus: #3182ce;
      --border-error: #f56565;
      --border-success: #66bb6a;

      /* 阴影 */
      --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3);
      --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
      --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.5);
      --shadow-xl: 0 20px 60px rgba(255, 255, 255, 0.1);

      /* 按钮颜色 */
      --btn-primary-bg: #3182ce;
      --btn-primary-hover: #2c5282;

      --btn-secondary-bg: #718096;
      --btn-secondary-hover: #4a5568;

      --btn-danger-bg: #f56565;
      --btn-danger-hover: #e53e3e;

      --btn-info-bg: #38b2ac;
      --btn-info-hover: #2c7a7b;

      /* 表单元素 */
      --input-bg: #1a202c;
      --input-bg-focus: #2d3748;
      --input-border: #4a5568;
      --input-border-focus: #3182ce;
      --input-text: #ffffff;
      --input-placeholder: #718096;

      /* 卡片 */
      --card-bg: #1a1a1a;
      --card-border: #404040;
      --card-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
      --card-hover-border: #5dade2;
      --card-hover-shadow: 0 4px 12px rgba(93, 173, 226, 0.2);

      /* 模态框 */
      --modal-bg: #1a1a1a;
      --modal-border: #333333;
      --modal-overlay: rgba(0, 0, 0, 0.9);
      --modal-header-border: #4a5568;

      /* 进度条 */
      --progress-bg: #333333;
      --progress-fill: linear-gradient(90deg, #4CAF50, #2196F3);

      /* 滚动条 */
      --scrollbar-track: transparent;
      --scrollbar-thumb: #4a5568;
      --scrollbar-thumb-hover: #718096;

      /* OTP 显示 */
      --otp-text: #ffffff;
      --otp-next-bg: rgba(255, 255, 255, 0.05);
      --otp-next-bg-hover: rgba(255, 255, 255, 0.1);
      --otp-next-text: #cccccc;

      /* 搜索框 */
      --search-bg: #1a1a1a;
      --search-border: #404040;
      --search-border-focus: #3498db;
      --search-icon: #888888;

      /* 菜单 */
      --menu-bg: #2a2a2a;
      --menu-border: #444444;
      --menu-item-hover: rgba(255, 255, 255, 0.1);
      --menu-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);

      /* 导入相关 */
      --import-instructions-bg: linear-gradient(135deg, #2d3748 0%, #1a202c 100%);
      --import-instructions-border: #4a5568;
      --import-method-bg: #1a202c;
      --import-method-border: #4a5568;
      --import-method-hover-border: #63b3ed;
      --import-example-bg: #744210;
      --import-example-text: #fbd38d;
      --import-example-border: #ed8936;
      --import-file-bg: linear-gradient(135deg, #1e3a5f 0%, #2d4a6f 100%);
      --import-file-border: #2196f3;

      /* 还原配置 */
      --restore-instructions-bg: linear-gradient(135deg, #3a2a1a 0%, #4a3a2a 100%);
      --restore-instructions-border: #ff9800;
      --restore-warning-bg: rgba(0, 0, 0, 0.3);
      --restore-warning-text: #ffab91;
      --restore-warning-border: rgba(255, 87, 34, 0.3);

      /* 备份列表 */
      --backup-header-bg: linear-gradient(135deg, #1e3a5f 0%, #2d4a6f 100%);
      --backup-header-border: #2196f3;
      --backup-header-text: #42a5f5;
      --backup-select-bg: #1a1a1a;
      --backup-select-border: #2d4a6f;

      /* 备份表格 */
      --table-bg: #1a1a1a;
      --table-header-bg: linear-gradient(135deg, #1b5e20 0%, #2e7d32 100%);
      --table-header-text: #ffffff;
      --table-header-border: #2e7d32;
      --table-border: #333333;
      --table-row-hover: linear-gradient(135deg, #2a2a2a 0%, #3a3a3a 100%);

      /* 工具 */
      --tool-bg: #2d3748;
      --tool-border: #4a5568;
      --tool-hover-bg: #4a5568;
      --tool-icon-bg: linear-gradient(135deg, #4a5568 0%, #2d3748 100%);
      --tool-icon-border: #4a5568;

      /* Toast 提示 */
      --toast-bg: rgba(255, 255, 255, 0.95);
      --toast-text: #2c3e50;
      --toast-border: rgba(0, 0, 0, 0.1);

      /* Footer */
      --footer-bg: transparent;
      --footer-border: #2d3748;
      --footer-text: #4a5568;
      --footer-link: #718096;
      --footer-link-hover: #63b3ed;

      /* 悬浮按钮 */
      --float-btn-bg: #3182ce;
      --float-btn-hover: #2c5282;
      --float-btn-shadow: 0 8px 32px rgba(49, 130, 206, 0.4);

      /* 主题切换按钮 */
      --theme-toggle-bg: #2d3748;
      --theme-toggle-hover: #374151;
      --theme-toggle-border: #4a5568;

      /* 返回顶部按钮 */
      --back-to-top-bg: #2d3748;
      --back-to-top-hover: #374151;
      --back-to-top-border: #4a5568;
      --back-to-top-text: #e2e8f0;
    }

    /* ========== 媒体查询回退（JavaScript 禁用时） ========== */
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) {
        /* 背景色 */
        --bg-primary: #1a1a1a;
        --bg-secondary: #2d3748;
        --bg-tertiary: #1a202c;
        --bg-elevated: #2a2a2a;
        --bg-hover: #374151;

        /* 文字色 */
        --text-primary: #ffffff;
        --text-secondary: #a0aec0;
        --text-tertiary: #718096;

        /* 边框色 */
        --border-primary: #4a5568;
        --border-secondary: #2d3748;

        /* 卡片 */
        --card-bg: #1a1a1a;
        --card-border: #404040;

        /* 输入框 */
        --input-bg: #1a202c;
        --input-border: #4a5568;
        --input-text: #ffffff;

        /* 模态框 */
        --modal-bg: #1a1a1a;
        --modal-border: #333333;
      }
    }

    /* ========== 主题过渡动画 ========== */
    html.theme-transition,
    html.theme-transition *,
    html.theme-transition *::before,
    html.theme-transition *::after {
      transition: var(--theme-transition) !important;
      transition-delay: 0s !important;
    }

    /* 应用过渡到主要元素 */
    body,
    .card,
    .secret-card,
    .modal,
    .modal-content,
    input,
    select,
    textarea,
    button,
    .search-container,
    .header,
    .footer {
      transition: var(--theme-transition);
    }

    /* 禁用过渡的情况（减少动画偏好） */
    @media (prefers-reduced-motion: reduce) {
      html.theme-transition,
      html.theme-transition *,
      html.theme-transition *::before,
      html.theme-transition *::after {
        transition: none !important;
      }
    }
  `;
}
