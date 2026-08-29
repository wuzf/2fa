/**
 * 组件样式模块
 */
export function getComponentStyles() {
	return `    .clock-warning {
      margin: 0 0 12px;
      padding: 10px 12px;
      display: flex;
      align-items: center;
      gap: 10px;
      background: var(--warning-light);
      border: 1px solid var(--warning);
      border-left: 3px solid var(--warning-dark);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      line-height: 1.45;
    }

    .clock-warning[hidden] {
      display: none;
    }

    .clock-warning-message {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      flex: 1 1 auto;
      min-width: 0;
    }

    .clock-warning-icon {
      flex: 0 0 auto;
      font-size: 15px;
      line-height: 1.4;
    }

    .clock-warning-text {
      min-width: 0;
      font-size: 13px;
      overflow-wrap: anywhere;
    }

    .clock-sync-retry-button {
      min-height: 32px;
      flex: 0 0 auto;
      padding: 6px 10px;
      border: 1px solid var(--warning-dark);
      border-radius: 4px;
      background: var(--bg-primary);
      color: var(--text-primary);
      font-size: 12px;
      font-weight: 600;
      line-height: 1;
      white-space: nowrap;
      cursor: pointer;
      transition: background 0.2s ease, border-color 0.2s ease;
    }

    .clock-sync-retry-button:hover {
      background: var(--bg-hover);
    }

    .clock-sync-retry-button:focus-visible {
      outline: 2px solid var(--border-focus);
      outline-offset: 2px;
    }

    .clock-sync-retry-button:disabled {
      cursor: wait;
      opacity: 0.65;
    }

    @media (max-width: 480px) {
      .clock-warning {
        padding: 10px;
        gap: 8px;
      }

      .clock-warning-message {
        gap: 7px;
      }

      .clock-sync-retry-button {
        min-height: 44px;
        padding: 8px 10px;
      }
    }

    .secrets-list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 10px;
      justify-content: center;
      margin: 0 auto;
    }

    .secret-card {
      background: var(--card-bg);
      border-radius: var(--radius-lg);
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

    /* P1.6 手机端保证 ≥44px 触控面积（iOS HIG） */
    @media (max-width: 768px) {
      .card-menu {
        min-width: 44px;
        min-height: 44px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
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
      border-radius: var(--radius-sm);
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
      border-color: var(--qr-btn-color);
      color: var(--qr-btn-color);
    }

    .qr-btn:hover {
      background: var(--qr-btn-hover-bg);
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

    /* TOTP 窗口切换动效：同一组 nextToken 通过流转、翻牌或聚光显现完成交接 */
    @keyframes otp-promote-current-slide {
      0%, 38% {
        opacity: 0;
        transform: translateX(12px);
      }
      100% {
        opacity: 1;
        transform: translateX(0);
      }
    }

    @keyframes otp-promote-next-settle {
      from {
        opacity: 0;
        transform: translateX(6px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }

    @keyframes otp-promote-flip-current {
      0%, 28% {
        opacity: 0;
        transform: perspective(420px) rotateX(88deg);
      }
      62% {
        opacity: 1;
        transform: perspective(420px) rotateX(-8deg);
      }
      100% {
        opacity: 1;
        transform: perspective(420px) rotateX(0);
      }
    }

    @keyframes otp-promote-flip-next {
      0%, 72% {
        opacity: 0;
        transform: none;
      }
      100% {
        opacity: 1;
        transform: none;
      }
    }

    @keyframes otp-promote-spotlight-current {
      0%, 18% {
        opacity: 0;
        transform: scale(0.94);
        text-shadow: none;
      }
      54% {
        opacity: 1;
        transform: scale(1.04);
        text-shadow: 0 0 14px var(--accent-color, #2196F3);
      }
      100% {
        opacity: 1;
        transform: scale(1);
        text-shadow: none;
      }
    }

    @keyframes otp-promote-spotlight-next {
      0%, 72% {
        opacity: 0;
        transform: none;
      }
      100% {
        opacity: 1;
        transform: none;
      }
    }

    @keyframes otp-promote-source-flip {
      0%, 12% {
        opacity: 0.95;
        transform: translate(-50%, -50%) perspective(420px) rotateX(0) scale(1);
      }
      48% {
        opacity: 0.3;
        transform: translate(-50%, -50%) perspective(420px) rotateX(-78deg) scale(1);
      }
      100% {
        opacity: 0;
        transform: translate(-50%, -50%) perspective(420px) rotateX(-90deg) scale(0.98);
      }
    }

    @keyframes otp-promote-source-spotlight {
      0%, 12% {
        opacity: 0.72;
        transform: translate(-50%, -50%) scale(1);
        text-shadow: none;
      }
      30% {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1.1);
        text-shadow: 0 0 10px var(--accent-color, #2196F3);
      }
      52% {
        opacity: 0.8;
        transform: translate(-50%, -50%) scale(1.02);
        text-shadow: 0 0 5px var(--accent-color, #2196F3);
      }
      72% {
        opacity: 0;
        transform: translate(-50%, -50%) scale(0.96);
        text-shadow: none;
      }
      100% {
        opacity: 0;
        transform: translate(-50%, -50%) scale(0.96);
        text-shadow: none;
      }
    }

    @keyframes otp-promote-fly {
      0% {
        opacity: 0.78;
        transform: translate(-50%, -50%) scale(var(--otp-fly-start-scale, 0.5));
      }
      68% {
        opacity: 1;
        transform: translate(
          calc(-50% + var(--otp-fly-x, 0px)),
          calc(-50% + var(--otp-fly-y, 0px))
        ) scale(1.06);
      }
      100% {
        opacity: 0;
        transform: translate(
          calc(-50% + var(--otp-fly-x, 0px)),
          calc(-50% + var(--otp-fly-y, 0px))
        ) scale(1);
      }
    }

    .otp-promote-current {
      animation: otp-promote-current-slide 360ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
      transition: none;
      will-change: transform, opacity;
    }

    .otp-promote-next {
      animation: otp-promote-next-settle 180ms ease-out both;
      transition: none;
      will-change: transform, opacity;
    }

    .otp-promote-flip-current {
      animation: otp-promote-flip-current 520ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
      transform-origin: center top;
      backface-visibility: hidden;
      transition: none;
      will-change: transform, opacity;
    }

    .otp-promote-flip-next {
      animation: otp-promote-flip-next 520ms ease-out both;
      transition: none;
      will-change: transform, opacity;
    }

    .otp-promote-spotlight-current {
      animation: otp-promote-spotlight-current 460ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
      transform-origin: center;
      transition: none;
      will-change: transform, opacity;
    }

    .otp-promote-spotlight-next {
      animation: otp-promote-spotlight-next 460ms ease-out both;
      transition: none;
      will-change: opacity;
    }

    .otp-promotion-flyer {
      position: fixed;
      display: block;
      z-index: 1002;
      pointer-events: none;
      user-select: none;
      white-space: nowrap;
      margin: 0;
      padding: 0;
      color: var(--otp-text);
      font-family: -apple-system, BlinkMacSystemFont, 'SF Mono', 'SF Pro Display', monospace;
      font-size: 42px;
      font-weight: 300;
      letter-spacing: 6px;
      line-height: 1.1;
      text-align: left;
      transform-origin: center;
      opacity: 0;
      will-change: transform, opacity;
    }

    .otp-promotion-flyer-active {
      animation: otp-promote-fly 360ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
    }

    .otp-promotion-flyer-flip {
      animation: otp-promote-source-flip 520ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
      backface-visibility: hidden;
    }

    .otp-promotion-flyer-spotlight {
      animation: otp-promote-source-spotlight 460ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
    }

    @media (prefers-reduced-motion: reduce) {
      .otp-promote-current,
      .otp-promote-next,
      .otp-promote-flip-current,
      .otp-promote-flip-next,
      .otp-promote-spotlight-current,
      .otp-promote-spotlight-next {
        animation: none;
        transform: none;
        opacity: 1;
        will-change: auto;
      }

      .otp-promotion-flyer,
      .otp-promotion-flyer-active,
      .otp-promotion-flyer-flip,
      .otp-promotion-flyer-spotlight {
        display: none !important;
        animation: none !important;
      }
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
      height: 1px;
      background: transparent;
      border-radius: 0;
      overflow: hidden;
      position: absolute;
      top: -1px;
      left: var(--radius-lg);
      right: var(--radius-lg);
    }

    .progress-top-fill {
      height: 100%;
      background: var(--progress-fill);
      border-radius: 0;
      transition: width 1s linear, background-color 0.5s ease;
      width: 0%;
    }

    /* ========== 同步目标卡片 ========== */
    .dest-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 10px;
      transition: opacity 0.2s ease;
    }

    .dest-card-disabled {
      opacity: 0.55;
    }

    .dest-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }

    .dest-card-info {
      flex: 1;
      min-width: 0;
    }

    .dest-card-name {
      display: block;
      font-weight: 600;
      font-size: 14px;
      color: var(--text-primary);
      margin-bottom: 2px;
    }

    .dest-card-url {
      display: block;
      font-size: 12px;
      color: var(--text-tertiary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .dest-card-status {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 8px;
    }

    .dest-status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .dest-status-dot-green {
      background: #22c55e;
    }

    .dest-status-dot-red {
      background: #ef4444;
    }

    .dest-status-dot-gray {
      background: #9ca3af;
    }

    .dest-status-text {
      font-size: 12px;
      color: var(--text-tertiary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .dest-card-actions {
      display: flex;
      gap: 8px;
    }

    .btn-sm {
      padding: 4px 12px;
      font-size: 12px;
      border-radius: 4px;
      cursor: pointer;
      border: 1px solid var(--border-primary);
      background: var(--bg-primary);
      color: var(--text-secondary);
      transition: all 0.2s ease;
    }

    .btn-sm:hover {
      background: var(--bg-hover, var(--bg-secondary));
    }

    .btn-danger-outline {
      border-color: var(--danger, #ef4444);
      color: var(--danger, #ef4444);
    }

    .btn-danger-outline:hover {
      background: var(--danger-light, rgba(239, 68, 68, 0.1));
    }

    /* 开关切换 */
    .dest-toggle {
      position: relative;
      display: inline-block;
      width: 40px;
      height: 22px;
      flex-shrink: 0;
      margin-left: 10px;
    }

    .dest-toggle input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .dest-toggle-slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: #ccc;
      border-radius: 22px;
      transition: 0.3s;
    }

    .dest-toggle-slider:before {
      position: absolute;
      content: "";
      height: 16px;
      width: 16px;
      left: 3px;
      bottom: 3px;
      background: white;
      border-radius: 50%;
      transition: 0.3s;
    }

    .dest-toggle input:checked + .dest-toggle-slider {
      background: var(--primary);
    }

    .dest-toggle input:checked + .dest-toggle-slider:before {
      transform: translateX(18px);
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

    .footer-version {
      font-family: monospace;
      color: var(--text-tertiary);
      user-select: text;
    }

    .footer-update-badge {
      display: inline-block;
      margin-left: 6px;
      padding: 1px 8px;
      border-radius: 10px;
      font-size: 11px;
      color: var(--footer-link);
      background: var(--bg-secondary);
      text-decoration: none;
      transition: color 0.2s ease;
    }

    .footer-update-badge:hover {
      color: var(--footer-link-hover);
    }

    /* ========== 离线状态横幅 ========== */
    .offline-banner {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: var(--warning-dark);
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
    }

    .offline-banner-text {
      font-size: 14px;
      font-weight: 600;
    }

    /* 离线模式下的页面样式调整 */
    body.offline-mode {
      padding-top: 44px; /* 为离线横幅留出空间 */
    }

    body.offline-mode .secret-card {
      opacity: 0.95;
    }

    /* ========== 离线横幅响应式 ========== */

    /* 移动设备 */
    @media (max-width: 480px) {
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
        right: calc(32px + env(safe-area-inset-right, 0px));
      }
    }

`;
}
