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
      border-radius: var(--radius-sm);
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
      border-radius: var(--radius-sm);
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

    /* ========== P1.2 排序 popover（搜索右侧 icon-button） ========== */
    .sort-select-hidden {
      display: none !important;
    }

    .sort-dropdown {
      position: relative;
      display: inline-block;
    }

    .sort-trigger {
      list-style: none;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0 14px;
      border: 2px solid var(--border-primary);
      border-radius: var(--radius-sm);
      background: var(--input-bg-focus);
      color: var(--text-primary);
      font-size: 14px;
      height: 46px;
      box-sizing: border-box;
      transition: all 0.2s ease;
      user-select: none;
    }

    .sort-trigger::-webkit-details-marker { display: none; }
    .sort-trigger::marker { content: ''; }

    .sort-trigger:hover {
      border-color: var(--border-focus);
    }

    .sort-dropdown[open] > .sort-trigger {
      border-color: var(--border-focus);
      box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.2);
    }

    .sort-trigger svg {
      flex-shrink: 0;
    }

    .sort-menu {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      min-width: 200px;
      background: var(--menu-bg, var(--card-bg));
      border: 1px solid var(--menu-border, var(--border-primary));
      border-radius: 10px;
      box-shadow: var(--menu-shadow, 0 8px 24px rgba(0,0,0,0.15));
      padding: 6px;
      z-index: 1002;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .sort-option {
      padding: 10px 14px;
      text-align: left;
      background: transparent;
      border: none;
      font-size: 14px;
      color: var(--text-primary);
      cursor: pointer;
      border-radius: 6px;
      white-space: nowrap;
      transition: background 0.15s;
      font-family: inherit;
    }

    .sort-option:hover {
      background: var(--bg-hover);
    }

    .sort-option.active {
      background: var(--bg-hover);
      font-weight: 600;
    }

    .sort-option.active::before {
      content: '✓';
      color: var(--success, #10b981);
      margin-right: 6px;
      font-weight: bold;
    }

    /* 手机端：隐藏 trigger 文字，保留 icon，压缩为 44x44 icon-button */
    @media (max-width: 768px) {
      .sort-trigger-label {
        display: none;
      }
      .sort-trigger {
        padding: 0;
        width: 44px;
        min-width: 44px;
        height: 44px;
        justify-content: center;
      }
    }

    /* 独立的操作菜单容器 - 固定在右下角，兼容 iOS safe area */
    .action-menu-float {
      position: fixed;
      bottom: calc(24px + env(safe-area-inset-bottom, 0px));
      right: calc(24px + env(safe-area-inset-right, 0px));
      z-index: 1001;
    }

    .main-action-button {
      background: #8e44ad;
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
      box-shadow: var(--action-btn-shadow);
      -webkit-tap-highlight-color: transparent;
      -webkit-touch-callout: none;
      -webkit-user-select: none;
      -moz-user-select: none;
      -ms-user-select: none;
      user-select: none;
      outline: none;
    }

    .main-action-button:hover {
      background: #7d3c98;
      box-shadow: var(--shadow-lg);
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

    /* 优化后的子菜单设计 - FAB 在右下角，子菜单向上展开 */
    .action-submenu {
      position: absolute;
      bottom: 70px;
      right: 0;
      background: var(--menu-bg);
      border-radius: 12px;
      box-shadow: var(--menu-shadow);
      border: 1px solid var(--menu-border);
      opacity: 0;
      visibility: hidden;
      transform: translateY(8px);
      transition:
        opacity 0.2s ease,
        visibility 0.2s ease,
        transform 0.2s ease;
      z-index: 1000;
      min-width: 180px;
      overflow: hidden;
      backdrop-filter: blur(10px);
    }

    .action-submenu.show {
      opacity: 1;
      visibility: visible;
      transform: translateY(0);
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
      background: var(--primary-50);
      color: var(--primary-600);
    }

    .action-submenu.show .submenu-item:nth-child(2):hover {
      background: var(--success-light);
      color: var(--success-dark);
    }

    .action-submenu.show .submenu-item:nth-child(3):hover {
      background: var(--info-light);
      color: var(--info-dark);
    }

    .action-submenu.show .submenu-item:nth-child(4):hover {
      background: var(--warning-light);
      color: var(--warning-dark);
    }

    .action-submenu.show .submenu-item:nth-child(5):hover {
      background: var(--primary-50);
      color: var(--primary-700);
    }

    .action-submenu.show .submenu-item:nth-child(6):hover {
      background: var(--danger-light);
      color: var(--danger-dark);
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

    /* 响应式调整 — P1.2：搜索与排序 icon-button 同行展示 */
    @media (max-width: 768px) {
      .search-action-row {
        flex-direction: row;
        gap: 8px;
        align-items: center;
      }

      .search-input-wrapper {
        flex: 1;
        min-width: 0;
      }

      .sort-controls {
        flex: 0 0 auto;
        width: auto;
      }

      /* menu 在手机上贴右对齐，不超过屏幕宽度 */
      .sort-menu {
        max-width: calc(100vw - 32px);
      }
    }

    @media (max-width: 480px) {
      .search-input-wrapper {
        border-radius: var(--radius-sm);
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
        border-radius: var(--radius-sm);
      }

      .action-menu-float {
        bottom: calc(16px + env(safe-area-inset-bottom, 0px));
        right: calc(16px + env(safe-area-inset-right, 0px));
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
        bottom: 52px;
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
        bottom: calc(12px + env(safe-area-inset-bottom, 0px));
        right: calc(12px + env(safe-area-inset-right, 0px));
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
        bottom: 48px;
      }
    }

`;
}
