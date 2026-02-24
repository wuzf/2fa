/**
 * 基础样式模块 - 使用 CSS 变量
 */
export function getBaseStyles() {
	return `    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-primary);
      min-height: 100vh;
      padding: 0;
      color: var(--text-primary);
      overflow-x: hidden;
    }

    .container {
      max-width: 420px;
      margin: 0 auto;
      background: transparent;
      padding: 0;
      min-height: 100vh;
    }

    .header {
      background: transparent;
      color: var(--text-primary);
      padding: 60px 20px 40px 20px;
      text-align: center;
      position: relative;
    }

    /* ========== 固定悬浮按钮组 ========== */
    /* 回到顶部按钮 */
    .back-to-top {
      position: fixed;
      bottom: 24px; /* 最底部 */
      right: 24px;
      width: 48px;
      height: 48px;
      background: var(--back-to-top-bg);
      border: 2px solid var(--back-to-top-border);
      border-radius: 50%;
      cursor: pointer;
      transition: all 0.3s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      user-select: none;
      box-shadow: var(--shadow-md);
      z-index: 1000;
      opacity: 0;
      visibility: hidden;
      -webkit-tap-highlight-color: transparent;
      -webkit-touch-callout: none;
      -webkit-user-select: none;
      -moz-user-select: none;
      -ms-user-select: none;
      outline: none;
      padding: 0;
      font-family: inherit;
    }

    .back-to-top:focus-visible {
      outline: 2px solid var(--border-focus);
      outline-offset: 2px;
    }

    .back-to-top.show {
      opacity: 1;
      visibility: visible;
    }

    .back-to-top:hover {
      transform: translateY(-2px) scale(1.05);
      box-shadow: var(--shadow-lg);
      background: var(--back-to-top-hover);
    }

    .back-to-top:active {
      transform: translateY(0) scale(0.98);
    }

    .back-to-top-icon {
      font-size: 22px;
      font-weight: bold;
      line-height: 1;
      transition: transform 0.3s ease;
      color: var(--back-to-top-text);
    }

    .back-to-top:hover .back-to-top-icon {
      transform: translateY(-2px);
    }

    /* 主题切换按钮 */
    .theme-toggle-float {
      position: fixed;
      bottom: 24px; /* 默认在最底部（返回顶部不显示时）*/
      right: 24px;
      width: 48px;
      height: 48px;
      background: var(--theme-toggle-bg);
      border: 2px solid var(--theme-toggle-border);
      border-radius: 50%;
      cursor: pointer;
      transition: all 0.3s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      user-select: none;
      box-shadow: var(--shadow-md);
      z-index: 1000;
      -webkit-tap-highlight-color: transparent;
      -webkit-touch-callout: none;
      -webkit-user-select: none;
      -moz-user-select: none;
      -ms-user-select: none;
      outline: none;
      padding: 0;
      font-family: inherit;
    }

    .theme-toggle-float:focus-visible {
      outline: 2px solid var(--border-focus);
      outline-offset: 2px;
    }

    /* 当返回顶部按钮显示时，主题按钮上移 */
    .back-to-top.show ~ .theme-toggle-float {
      bottom: 72px !important; /* 缩小间距到48px */
    }

    .theme-toggle-float:hover {
      transform: translateY(-2px) scale(1.05);
      box-shadow: var(--shadow-lg);
      background: var(--theme-toggle-hover);
    }

    .theme-toggle-float:active {
      transform: translateY(0) scale(0.98);
    }

    .theme-toggle-float .theme-icon {
      font-size: 20px;
      transition: transform 0.3s ease;
    }

    .theme-toggle-float:hover .theme-icon {
      transform: rotate(20deg);
    }

    .header h1 {
      font-size: 28px;
      font-weight: 600;
      margin-bottom: 8px;
      letter-spacing: -0.5px;
    }

    .header p {
      color: var(--text-secondary);
      font-size: 14px;
      font-weight: 400;
    }

    .content {
      padding: 30px 20px 20px 20px;
    }

    /* 搜索功能样式 */
    .search-section {
      margin-bottom: 20px;
    }

    .search-container {
      max-width: 100%;
    }

    .search-input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
      background: var(--search-bg);
      border: 2px solid var(--search-border);
      border-radius: 4px;
      padding: 0;
      transition: border-color 0.2s ease;
      box-shadow: none;
      overflow: hidden;
    }

    .search-input-wrapper:focus-within {
      border-color: var(--search-border-focus);
      box-shadow: none;
    }

    .search-icon {
      padding: 11px 16px;
      color: var(--search-icon);
      font-size: 16px;
      user-select: none;
      height: 46px;
      box-sizing: border-box;
      display: flex;
      align-items: center;
    }

    .search-input {
      flex: 1;
      border: none;
      outline: none;
      padding: 11px 40px 11px 0;
      font-size: 16px;
      background: transparent;
      color: var(--input-text);
      height: 46px;
      box-sizing: border-box;
    }

    .search-input::placeholder {
      color: var(--input-placeholder);
      font-weight: 400;
    }

    /* 隐藏浏览器原生的搜索清除按钮（type="search" 自带的"x"号） */
    .search-input::-webkit-search-cancel-button {
      display: none;
      -webkit-appearance: none;
    }

    .search-clear {
      position: absolute;
      right: 0;
      top: 0;
      background: none;
      border: none;
      padding: 11px 12px;
      color: var(--text-tertiary);
      cursor: pointer;
      font-size: 16px;
      transition: color 0.2s ease;
      user-select: none;
      height: 46px;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1;
    }

    .search-clear:hover {
      color: var(--danger);
    }

    .search-stats {
      margin-top: 8px;
      padding: 0 4px;
      font-size: 12px;
      color: var(--text-secondary);
      text-align: left;
    }

    /* 平板和中等屏幕优化 */
    @media (min-width: 481px) and (max-width: 768px) {
      .search-action-row {
        gap: 12px;
      }

      .sort-select {
        min-width: 160px;
      }
    }

    /* 搜索框和操作按钮的水平布局 */
    .search-action-row {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .search-input-wrapper {
      flex: 1;
    }

    .sort-controls {
      flex-shrink: 0;
    }

    .sort-select {
      padding: 10px 12px;
      border: 2px solid var(--border-primary);
      border-radius: 8px;
      background: var(--input-bg-focus);
      color: var(--text-primary);
      font-size: 14px;
      cursor: pointer;
      outline: none;
      transition: all 0.2s ease;
      min-width: 140px;
      height: 46px;
      box-sizing: border-box;
    }

    .sort-select:hover {
      border-color: var(--border-focus);
    }

    .sort-select:focus {
      border-color: var(--border-focus);
      box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.2);
    }

    /* 独立的操作菜单容器 - 固定在右上角 */
    .action-menu-float {
      position: fixed;
      top: 24px;
      right: 24px;
      z-index: 1001;
    }

    .main-action-button {
      background: #8e44ad;  /* 品牌紫色 - 保持不变 */
      color: white;
      border: none;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      font-size: 20px;
      cursor: pointer;
      transition: all 0.3s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(142, 68, 173, 0.3);
      -webkit-tap-highlight-color: transparent;
      -webkit-touch-callout: none;
      -webkit-user-select: none;
      -moz-user-select: none;
      -ms-user-select: none;
      user-select: none;
      outline: none;
    }

    .main-action-button:hover {
      background: #7d3c98;  /* 品牌紫色hover - 保持不变 */
      transform: translateY(-2px) scale(1.05);
      box-shadow: 0 6px 20px rgba(142, 68, 173, 0.4);
    }

    .main-action-button:active {
      transform: translateY(0) scale(0.98);
    }

    .main-action-button.active {
      transform: rotate(45deg);
      background: var(--danger);
    }

    .main-action-button.active:hover {
      background: var(--danger-dark);
    }

    /* 优化后的子菜单设计 */
    .action-submenu {
      position: absolute;
      top: 70px;
      right: 0;
      background: var(--menu-bg);
      border-radius: 12px;
      box-shadow: var(--menu-shadow);
      border: 1px solid var(--menu-border);
      opacity: 0;
      visibility: hidden;
      transform: translateY(-10px) scale(0.95);
      transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      z-index: 1000;
      min-width: 180px;
      overflow: hidden;
      backdrop-filter: blur(10px);
    }

    .action-submenu.show {
      opacity: 1;
      visibility: visible;
      transform: translateY(0) scale(1);
    }

    .submenu-item {
      display: flex;
      align-items: center;
      padding: 12px 16px;
      color: var(--text-primary);
      cursor: pointer;
      transition: all 0.2s ease;
      border-bottom: 1px solid var(--border-primary);
      position: relative;
      background: transparent;
    }

    .submenu-item:last-child {
      border-bottom: none;
    }

    .action-submenu.show .submenu-item:hover {
      background: var(--menu-item-hover);
      transform: translateX(4px);
    }

    .action-submenu.show .submenu-item:active {
      transform: translateX(2px) scale(0.98);
    }

    .item-icon {
      font-size: 16px;
      margin-right: 12px;
      width: 20px;
      text-align: center;
      opacity: 0.8;
    }

    .item-text {
      font-size: 14px;
      font-weight: 500;
      flex: 1;
    }

    /* 为每个菜单项添加特色颜色 - 根据新顺序调整 */
    .action-submenu.show .submenu-item:nth-child(1):hover {
      background: linear-gradient(135deg, var(--primary-50) 0%, var(--primary-100) 100%);
      color: var(--primary-500);
    }

    .action-submenu.show .submenu-item:nth-child(2):hover {
      background: linear-gradient(135deg, var(--success-light) 0%, #d4f1d4 100%);
      color: var(--success);
    }

    .action-submenu.show .submenu-item:nth-child(3):hover {
      background: linear-gradient(135deg, #f3e5f5 0%, #e1bee7 100%);
      color: #9c27b0;
    }

    .action-submenu.show .submenu-item:nth-child(4):hover {
      background: linear-gradient(135deg, var(--warning-light) 0%, #ffe0b2 100%);
      color: var(--warning);
    }

    .action-submenu.show .submenu-item:nth-child(5):hover {
      background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%);
      color: #1976d2;
    }

    .action-submenu.show .submenu-item:nth-child(6):hover {
      background: linear-gradient(135deg, #fce4ec 0%, #f8bbd9 100%);
      color: #c2185b;
    }

    /* 子菜单项的入场动画 */
    .action-submenu .submenu-item {
      transform: translateX(-20px);
      opacity: 0;
      transition: all 0.3s ease;
    }

    .action-submenu.show .submenu-item {
      transform: translateX(0);
      opacity: 1;
    }

    .action-submenu.show .submenu-item:nth-child(1) {
      transition-delay: 0.05s;
    }

    .action-submenu.show .submenu-item:nth-child(2) {
      transition-delay: 0.1s;
    }

    .action-submenu.show .submenu-item:nth-child(3) {
      transition-delay: 0.15s;
    }

    .action-submenu.show .submenu-item:nth-child(4) {
      transition-delay: 0.2s;
    }

    .action-submenu.show .submenu-item:nth-child(5) {
      transition-delay: 0.25s;
    }

    .action-submenu.show .submenu-item:nth-child(6) {
      transition-delay: 0.3s;
    }

    /* 背景遮罩 */
    .menu-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.3);
      opacity: 0;
      visibility: hidden;
      transition: all 0.3s ease;
      z-index: 1;
    }

    .menu-overlay.show {
      opacity: 1;
      visibility: visible;
    }

    /* 响应式调整 */
    @media (max-width: 768px) {
      .search-action-row {
        flex-direction: column;
        gap: 12px;
        align-items: stretch;
      }

      .search-input-wrapper {
        width: 100%;
      }

      .sort-controls {
        width: 100%;
      }

      .sort-select {
        width: 100%;
        padding: 10px 12px;
        font-size: 14px;
        height: 44px;
      }
    }

    @media (max-width: 480px) {
      .search-input-wrapper {
        border-radius: 8px;
      }

      .search-icon {
        padding: 9px 12px;
        font-size: 15px;
        height: 42px;
      }

      .search-input {
        padding: 9px 40px 9px 0;
        font-size: 15px;
        height: 42px;
      }

      .search-input::placeholder {
        font-size: 14px;
      }

      .search-clear {
        padding: 9px 10px;
        font-size: 15px;
        height: 42px;
      }

      .sort-select {
        padding: 9px 12px;
        font-size: 14px;
        height: 42px;
        border-radius: 8px;
      }

      .action-menu-float {
        top: 16px;
        right: 16px;
      }

      .back-to-top {
        width: 40px;
        height: 40px;
        right: 16px;
        bottom: 16px;
      }

      .back-to-top-icon {
        font-size: 18px;
      }

      /* 当返回顶部按钮显示时，主题按钮上移 */
      .back-to-top.show ~ .theme-toggle-float {
        bottom: 64px !important;
      }

      .theme-toggle-float {
        width: 40px;
        height: 40px;
        right: 16px;
        bottom: 16px;
      }

      .theme-toggle-icon {
        font-size: 18px;
      }

      .main-action-button {
        width: 40px;
        height: 40px;
        font-size: 18px;
        -webkit-tap-highlight-color: transparent;
        -webkit-touch-callout: none;
        -webkit-user-select: none;
        -moz-user-select: none;
        -ms-user-select: none;
        user-select: none;
        outline: none;
      }

      .action-submenu {
        min-width: 160px;
        top: 52px;
      }

      .submenu-item {
        padding: 10px 12px;
      }

      .item-text {
        font-size: 13px;
      }

      .item-icon {
        font-size: 14px;
        margin-right: 10px;
      }
    }

    @media (max-width: 360px) {
      .search-icon {
        padding: 8px 10px;
        font-size: 14px;
        height: 40px;
      }

      .search-input {
        padding: 8px 36px 8px 0;
        font-size: 14px;
        height: 40px;
      }

      .search-input::placeholder {
        font-size: 13px;
      }

      .search-clear {
        padding: 8px 8px;
        font-size: 14px;
        height: 40px;
      }

      .sort-select {
        padding: 8px 10px;
        font-size: 13px;
        height: 40px;
      }

      .action-menu-float {
        top: 12px;
        right: 12px;
      }

      .back-to-top {
        width: 36px;
        height: 36px;
        right: 12px;
        bottom: 12px;
      }

      .back-to-top-icon {
        font-size: 16px;
      }

      /* 当返回顶部按钮显示时，主题按钮上移 */
      .back-to-top.show ~ .theme-toggle-float {
        bottom: 56px !important;
      }

      .theme-toggle-float {
        width: 36px;
        height: 36px;
        right: 12px;
        bottom: 12px;
      }

      .theme-toggle-icon {
        font-size: 16px;
      }

      .main-action-button {
        width: 36px;
        height: 36px;
        font-size: 16px;
        -webkit-tap-highlight-color: transparent;
        -webkit-touch-callout: none;
        -webkit-user-select: none;
        -moz-user-select: none;
        -ms-user-select: none;
        user-select: none;
        outline: none;
      }

      .action-submenu {
        min-width: 140px;
        top: 48px;
      }
    }

`;
}
