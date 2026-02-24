/**
 * 组件样式模块
 */
export function getComponentStyles() {
	return `    .secrets-list {
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
      justify-content: center;
      margin: 0 auto;
    }

    .secret-card {
      background: var(--card-bg);
      border-radius: 12px;
      padding: 16px;
      padding-top: 20px;
      border: 1px solid var(--card-border);
      transition: all 0.3s ease;
      position: relative;
      width: 100%;
      box-shadow: var(--card-shadow);
      margin-bottom: 0;
      cursor: pointer;
      -webkit-user-select: none;
      -moz-user-select: none;
      -ms-user-select: none;
      user-select: none;
      -webkit-touch-callout: none;
    }

    .secret-card:hover {
      border-color: var(--card-hover-border);
      box-shadow: var(--card-hover-shadow);
      transform: translateY(-1px);
    }

    .secret-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 12px;
    }

    .secret-info {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 8px;
    }

    .secret-info {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      flex: 1;
      min-width: 0;
    }

    .service-icon {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      font-weight: bold;
      font-size: 16px;
      color: var(--text-secondary);
      background: var(--bg-secondary);
      border: 1px solid var(--card-border);
    }

    .service-icon img {
      width: 30px;
      height: 30px;
      object-fit: contain;
      border-radius: 6px;
    }

    .secret-text {
      flex: 1;
      min-width: 0;
    }

    .service-details {
      flex: 1;
      min-width: 0;
    }

    .card-menu {
      position: relative;
      cursor: pointer;
      padding: 8px;
      margin: -8px;
      border-radius: 6px;
      transition: background 0.2s ease;
    }

    .card-menu:hover {
      background: var(--bg-hover);
    }

    .menu-dots {
      font-size: 20px;
      color: var(--text-secondary);
      line-height: 1;
      user-select: none;
    }

    .card-menu-dropdown {
      display: none;
      position: absolute;
      top: -8px;
      right: -8px;
      background: var(--menu-bg);
      border: 1px solid var(--menu-border);
      border-radius: 8px;
      min-width: 80px;
      width: fit-content;
      box-shadow: var(--menu-shadow);
      z-index: 10000;
      overflow: hidden;
    }

    .card-menu-dropdown.show {
      display: block;
    }

    .menu-item {
      padding: 10px 14px;
      color: var(--text-primary);
      cursor: pointer;
      transition: background 0.2s ease;
      font-size: 14px;
      white-space: nowrap;
    }

    .menu-item:hover {
      background: var(--menu-item-hover);
    }

    .menu-item-danger {
      color: var(--danger) !important;
    }

    .menu-item-danger:hover {
      background: var(--danger-light) !important;
    }

    .secret-text h3 {
      color: var(--text-primary);
      font-size: 16px;
      font-weight: 600;
      margin: 0 0 1px 0;
      line-height: 1.3;
      word-break: break-word;
    }

    .secret-text p {
      color: var(--text-secondary);
      font-size: 13px;
      margin: 0;
      line-height: 1.4;
      word-break: break-word;
    }

    .secret-actions {
      display: flex;
      gap: 6px;
      flex-shrink: 0;
      margin-left: 8px;
    }

    .action-btn {
      background: none;
      border: 2px solid;
      border-radius: 8px;
      padding: 8px 12px;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.3s ease;
      min-width: 60px;
    }

    .qr-btn {
      border-color: #9b59b6;
      color: #9b59b6;
    }

    .qr-btn:hover {
      background: #9b59b6;
      color: var(--btn-primary-text);
    }

    .edit-btn {
      border-color: var(--warning);
      color: var(--warning);
    }

    .edit-btn:hover {
      background: var(--warning);
      color: var(--btn-primary-text);
    }

    .delete-btn {
      border-color: var(--danger-dark);
      color: var(--danger-dark);
    }

    .delete-btn:hover {
      background: var(--danger-dark);
      color: var(--btn-primary-text);
    }

    .otp-preview {
      margin-top: 12px;
      padding: 0;
      background: none;
      border: none;
    }

    .otp-main {
      display: flex;
      align-items: center;
      gap: 16px;
      justify-content: space-between;
      /* Chrome兼容性修复 */
      display: -webkit-flex;
      -webkit-align-items: center;
      -webkit-justify-content: space-between;
    }

    .otp-code-container {
      flex: 1;
      min-width: 0;
      /* Chrome兼容性修复 */
      -webkit-flex: 1;
      -webkit-box-flex: 1;
    }

    .otp-code {
      font-family: -apple-system, BlinkMacSystemFont, 'SF Mono', 'SF Pro Display', monospace;
      font-size: 42px;
      font-weight: 300;
      color: var(--otp-text);
      letter-spacing: 6px;
      cursor: pointer;
      transition: all 0.2s ease;
      user-select: none;
      margin: 4px 0;
      line-height: 1.1;
      padding: 0;
      background: none;
      border: none;
      display: block;
      width: 100%;
      text-align: left;
    }

    .otp-code:hover {
      color: var(--text-secondary);
    }

    .otp-bottom {
      display: none;
    }

    .otp-next-container {
      text-align: right;
      cursor: pointer;
      transition: all 0.2s ease;
      padding: 6px 10px;
      border-radius: 8px;
      background: var(--otp-next-bg);
      flex-shrink: 0;
      min-width: 70px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: flex-end;
      /* Chrome兼容性修复 */
      -webkit-flex-shrink: 0;
      -webkit-box-flex: 0;
    }

    .otp-next-container:hover {
      background: var(--otp-next-bg-hover);
    }

    .otp-next-label {
      display: none;
    }

    .otp-next-code {
      font-family: -apple-system, BlinkMacSystemFont, 'SF Mono', monospace;
      font-size: 16px;
      font-weight: 600;
      color: var(--otp-next-text);
      letter-spacing: 2px;
      line-height: 1;
      display: block;
      white-space: nowrap;
      text-align: right;
    }

    .progress-mini {
      width: 60px;
      height: 4px;
      background: var(--border-primary);
      border-radius: 2px;
      overflow: hidden;
    }

    .progress-mini-fill {
      height: 100%;
      background: #8B5CF6;
      border-radius: 2px;
      transition: width 1s ease-in-out;
    }

    .progress-top {
      width: 100%;
      height: 1px;
      background: var(--bg-primary);
      border-radius: 0;
      overflow: hidden;
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
    }

    .progress-top-fill {
      height: 100%;
      background: var(--progress-fill);
      border-radius: 0;
      transition: width 1s linear, background-color 0.5s ease;
      width: 0%;
    }

    /* ========== 页面底部 Footer ========== */
    .page-footer {
      margin-top: 40px;
      padding: 15px 20px 20px 20px;
      background: var(--footer-bg);
      border-top: 1px solid var(--footer-border);
      text-align: center;
    }

    .footer-content {
      max-width: 800px;
      margin: 0 auto;
    }

    .footer-links {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }

    .footer-link {
      color: var(--footer-link);
      text-decoration: none;
      font-size: 12px;
      transition: color 0.2s ease;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }

    .footer-link:hover {
      color: var(--footer-link-hover);
    }

    .github-icon {
      vertical-align: middle;
      width: 14px;
      height: 14px;
    }

    .footer-separator {
      color: var(--border-secondary);
      font-size: 12px;
      user-select: none;
    }

    .footer-info {
      color: var(--text-tertiary);
      font-size: 11px;
      margin-top: 6px;
    }

    .footer-info a {
      color: var(--footer-link);
      text-decoration: none;
      transition: color 0.2s ease;
    }

    .footer-info a:hover {
      color: var(--footer-link-hover);
    }

    /* ========== PWA 安装提示按钮 ========== */
    .pwa-install-btn-float {
      position: fixed;
      bottom: 24px; /* 初始位置与主题按钮相同 */
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

    .pwa-install-btn-float:focus-visible {
      outline: 2px solid var(--border-focus);
      outline-offset: 2px;
    }

    .pwa-install-btn-float.show {
      opacity: 1;
      visibility: visible;
      bottom: 72px; /* 默认在主题按钮上方48px（返回顶部不显示时）*/
    }

    .pwa-install-btn-float:hover {
      transform: translateY(-2px) scale(1.05);
      box-shadow: var(--shadow-lg);
      background: var(--theme-toggle-hover);
    }

    .pwa-install-btn-float:active {
      transform: translateY(0) scale(0.98);
    }

    .pwa-install-icon {
      font-size: 20px;
      line-height: 1;
      transition: transform 0.3s ease;
    }

    .pwa-install-btn-float:hover .pwa-install-icon {
      transform: scale(1.1);
    }

    /* 当返回顶部按钮显示时，安装按钮上移 */
    .back-to-top.show ~ .pwa-install-btn-float.show {
      bottom: 120px !important; /* 缩小间距到48px */
    }

    /* ========== 离线状态横幅 ========== */
    .offline-banner {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: linear-gradient(135deg, #f59e0b 0%, #ef4444 100%);
      color: white;
      padding: 12px 20px;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
      z-index: 999; /* 低于操作菜单（1001），不会遮挡"+"按钮 */
      transform: translateY(-100%);
      transition: transform 0.3s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
    }

    .offline-banner.show {
      transform: translateY(0);
    }

    .offline-banner-icon {
      font-size: 20px;
      animation: pulse 2s infinite;
    }

    .offline-banner-text {
      font-size: 14px;
      font-weight: 600;
    }

    @keyframes pulse {
      0%, 100% {
        opacity: 1;
        transform: scale(1);
      }
      50% {
        opacity: 0.8;
        transform: scale(0.95);
      }
    }

    /* 离线模式下的页面样式调整 */
    body.offline-mode {
      padding-top: 44px; /* 为离线横幅留出空间 */
    }

    body.offline-mode .secret-card {
      opacity: 0.95;
    }

    /* ========== PWA 元素响应式设计 ========== */

    /* 移动设备 */
    @media (max-width: 480px) {
      .pwa-install-btn-float {
        width: 40px;
        height: 40px;
        bottom: 16px;
        right: 16px;
      }

      .pwa-install-btn-float.show {
        bottom: 64px; /* 在主题按钮上方 */
      }

      .pwa-install-icon {
        font-size: 18px;
      }

      /* 当返回顶部按钮显示时，安装按钮上移 */
      .back-to-top.show ~ .pwa-install-btn-float.show {
        bottom: 112px !important;
      }

      .offline-banner {
        padding: 10px 16px;
      }

      .offline-banner-icon {
        font-size: 18px;
      }

      .offline-banner-text {
        font-size: 13px;
      }

      body.offline-mode {
        padding-top: 40px;
      }
    }

    /* 超小屏幕 */
    @media (max-width: 360px) {
      .pwa-install-btn-float {
        width: 36px;
        height: 36px;
        bottom: 12px;
        right: 12px;
      }

      .pwa-install-btn-float.show {
        bottom: 56px; /* 在主题按钮上方 */
      }

      .pwa-install-icon {
        font-size: 16px;
      }

      /* 当返回顶部按钮显示时，安装按钮上移 */
      .back-to-top.show ~ .pwa-install-btn-float.show {
        bottom: 100px !important;
      }

      .offline-banner {
        padding: 8px 12px;
      }

      .offline-banner-icon {
        font-size: 16px;
      }

      .offline-banner-text {
        font-size: 12px;
      }

      body.offline-mode {
        padding-top: 36px;
      }
    }

    /* 超宽屏幕 */
    @media (min-width: 1440px) {
      .action-menu-float {
        right: 32px;
      }

      .theme-toggle-float {
        right: 32px;
        bottom: 24px; /* 默认在最底部（返回顶部不显示时）*/
      }

      /* 当返回顶部按钮显示时，主题按钮上移 */
      .back-to-top.show ~ .theme-toggle-float {
        bottom: 80px !important; /* 缩小间距到56px */
      }

      .back-to-top {
        right: 32px;
        bottom: 24px; /* 最底部 */
      }

      .pwa-install-btn-float {
        right: 32px;
        bottom: 24px;
      }

      .pwa-install-btn-float.show {
        bottom: 80px; /* 默认在主题按钮上方56px（返回顶部不显示时）*/
      }

      /* 当返回顶部按钮显示时，安装按钮上移 */
      .back-to-top.show ~ .pwa-install-btn-float.show {
        bottom: 136px !important; /* 缩小间距到56px */
      }
    }

`;
}
