/**
 * 弹窗样式模块
 */
export function getModalStyles() {
	return `    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: var(--modal-overlay);
      z-index: 99999;
      padding: 20px;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(5px);
    }

    .modal.show {
      display: flex;
    }

    .modal-content {
      background: var(--modal-bg);
      border: 1px solid var(--modal-border);
      border-radius: 20px;
      padding: 30px;
      max-width: 600px;
      width: 100%;
      max-height: 85vh;
      overflow-y: auto;
      color: var(--text-primary);
      box-shadow: var(--shadow-xl);
      transform: scale(0.95);
      opacity: 0;
      transition: all 0.3s ease;
      /* 修复模态框滚动条破坏圆角的问题 */
      scrollbar-width: thin;
      scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
    }

    /* 模态框滚动条样式 */
    .modal-content::-webkit-scrollbar {
      width: 8px;
    }

    .modal-content::-webkit-scrollbar-track {
      background: var(--scrollbar-track);
      border-radius: 20px;
    }

    .modal-content::-webkit-scrollbar-thumb {
      background: var(--scrollbar-thumb);
      border-radius: 4px;
      border: 2px solid transparent;
      background-clip: content-box;
    }

    .modal-content::-webkit-scrollbar-thumb:hover {
      background: var(--scrollbar-thumb-hover);
      background-clip: content-box;
    }

    .modal.show .modal-content {
      transform: scale(1);
      opacity: 1;
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 25px;
      padding-bottom: 20px;
      border-bottom: 2px solid var(--modal-header-border);
    }

    .modal-header h2 {
      color: var(--text-primary);
      font-size: 22px;
      font-weight: 600;
      margin: 0;
    }

    .modal-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid var(--modal-header-border);
    }

    /* 按钮样式 - 添加outline和active状态支持 */
    .btn-outline {
      background: transparent !important;
      border: 2px solid var(--border-primary) !important;
      color: var(--text-primary) !important;
    }

    .btn-outline:hover {
      background: var(--bg-hover) !important;
      border-color: var(--border-focus) !important;
    }

    .btn-outline.active {
      background: var(--btn-primary-bg) !important;
      border-color: var(--btn-primary-bg) !important;
      color: var(--btn-primary-text) !important;
    }

    .close-btn {
      background: none;
      border: none;
      font-size: 28px;
      cursor: pointer;
      color: var(--text-secondary);
      padding: 8px;
      border-radius: 50%;
      transition: all 0.3s ease;
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .close-btn:hover {
      color: var(--danger-dark);
      background: var(--danger-light);
      transform: scale(1.1);
    }

    .form-group {
      margin-bottom: 25px;
    }

    .form-group label {
      display: block;
      margin-bottom: 10px;
      color: var(--text-primary);
      font-weight: 600;
      font-size: 15px;
    }

    .form-group input {
      width: 100%;
      padding: 14px 16px;
      border: 2px solid var(--input-border);
      border-radius: 10px;
      font-size: 16px;
      transition: all 0.3s ease;
      background: var(--input-bg);
      color: var(--input-text);
    }

    .form-group input:focus {
      outline: none;
      border-color: var(--input-border-focus);
      background: var(--input-bg-focus);
      box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.1);
    }

    .form-group select {
      width: 100%;
      padding: 14px 16px;
      border: 2px solid var(--input-border);
      border-radius: 10px;
      font-size: 16px;
      background: var(--input-bg-focus);
      color: var(--input-text);
      transition: all 0.3s ease;
    }

    .form-group select:focus {
      outline: none;
      border-color: var(--input-border-focus);
      background: var(--input-bg-focus);
      box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.1);
    }

    /* 高级选项样式 */
    .form-section {
      margin: 25px 0;
      border: 2px solid var(--border-primary);
      border-radius: 12px;
      overflow: hidden;
      background: var(--bg-secondary);
      box-shadow: var(--shadow-sm);
      transition: all 0.3s ease;
    }

    .form-section:hover {
      border-color: var(--border-focus);
      box-shadow: var(--shadow-md);
    }

    .section-header {
      background: var(--import-instructions-bg);
      padding: 16px 20px;
      border-bottom: 1px solid var(--border-primary);
      transition: background 0.3s ease;
    }

    .section-header:hover {
      background: var(--bg-tertiary);
    }

    .section-header label {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      display: flex;
      align-items: center;
      cursor: pointer;
      color: var(--text-primary);
      transition: color 0.3s ease;
    }

    .section-header label:hover {
      color: var(--border-focus);
    }

    .section-header input[type="checkbox"] {
      margin-right: 10px;
      width: 18px;
      height: 18px;
      padding: 0;
      accent-color: var(--border-focus);
      cursor: pointer;
    }

    .advanced-options {
      padding: 20px;
      background: var(--card-bg);
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 20px;
    }

    .form-row:last-child {
      margin-bottom: 0;
    }

    .form-group-small {
      margin-bottom: 0;
      position: relative;
    }

    .form-group-small label {
      font-size: 14px;
      margin-bottom: 8px;
      font-weight: 600;
      color: var(--text-primary);
      display: block;
    }

    .form-group-small select,
    .form-group-small input {
      width: 100%;
      font-size: 14px;
      padding: 12px 16px;
      border: 2px solid var(--input-border);
      border-radius: 8px;
      background: var(--input-bg-focus);
      color: var(--input-text);
      transition: all 0.3s ease;
      font-weight: 500;
    }

    .form-group-small select:focus,
    .form-group-small input:focus {
      outline: none;
      border-color: var(--input-border-focus);
      box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.1);
      background: var(--input-bg-focus);
    }

    .form-group-small select:hover,
    .form-group-small input:hover {
      border-color: var(--border-tertiary);
    }

    .advanced-info {
      font-size: 13px;
      color: var(--text-secondary);
      background: var(--info-light);
      padding: 14px 16px;
      border-radius: 8px;
      border-left: 4px solid var(--border-focus);
      margin-top: 15px;
      line-height: 1.5;
      box-shadow: var(--shadow-sm);
    }

    .advanced-info::before {
      content: "💡 ";
      margin-right: 4px;
    }

    /* 响应式设计 */
    @media (max-width: 600px) {
      .form-row {
        grid-template-columns: 1fr;
        gap: 15px;
      }

      .advanced-options {
        padding: 16px;
      }

      .section-header {
        padding: 14px 16px;
      }
    }

    @media (max-width: 480px) {
      .form-section {
        margin: 20px 0;
        border-radius: 10px;
      }

      .form-group-small select,
      .form-group-small input {
        padding: 10px 14px;
        font-size: 13px;
      }

      .advanced-info {
        font-size: 12px;
        padding: 12px 14px;
      }
    }

    .form-actions {
      display: flex;
      gap: 12px;
      justify-content: flex-end;
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid var(--modal-header-border);
    }

    .btn {
      padding: 14px 24px;
      border: none;
      border-radius: 4px;
      font-size: 15px;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 0.2s ease;
      min-width: 120px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .btn-primary {
      background: var(--btn-primary-bg);
      color: var(--btn-primary-text);
    }

    .btn-primary:hover {
      background: var(--btn-primary-hover);
    }

    .btn-secondary {
      background: var(--btn-secondary-bg);
      color: var(--btn-secondary-text);
    }

    .btn-secondary:hover {
      background: var(--btn-secondary-hover);
    }

    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: var(--text-tertiary);
    }

    .empty-state .icon {
      font-size: 48px;
      margin-bottom: 15px;
    }

    .loading {
      text-align: center;
      padding: 40px;
      color: var(--text-tertiary);
    }

    /* 导入模态框样式 */
    .import-instructions {
      background: var(--import-instructions-bg);
      border-radius: 4px;
      padding: 20px;
      margin-bottom: 25px;
      border: 1px solid var(--import-instructions-border);
      box-shadow: var(--shadow-sm);
    }

    .import-instructions p {
      margin: 0 0 18px 0;
      color: var(--text-primary);
      font-size: 15px;
      font-weight: 500;
    }

    .import-methods {
      margin-bottom: 18px;
    }

    .import-method {
      background: var(--import-method-bg);
      border: 1px solid var(--import-method-border);
      border-radius: 8px;
      padding: 12px 15px;
      margin-bottom: 10px;
      font-size: 14px;
      transition: all 0.3s ease;
      box-shadow: var(--card-shadow);
    }

    .import-method:hover {
      border-color: var(--import-method-hover-border);
      box-shadow: var(--shadow-md);
    }

    .file-import-section {
      background: var(--import-file-bg);
      border: 2px dashed var(--import-file-border);
      border-radius: 4px;
      padding: 25px;
      text-align: center;
      margin-bottom: 25px;
      transition: all 0.3s ease;
      position: relative;
      overflow: hidden;
    }

    .file-import-section::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: linear-gradient(45deg, transparent 30%, rgba(23, 162, 184, 0.05) 50%, transparent 70%);
      transform: translateX(-100%);
      transition: transform 0.6s ease;
    }

    .file-import-section:hover::before {
      transform: translateX(100%);
    }

    .file-import-section:hover {
      border-color: var(--info-dark);
      background: var(--import-file-bg);
      transform: translateY(-2px);
      box-shadow: var(--shadow-md);
    }

    .file-info {
      display: block;
      margin-top: 10px;
      font-size: 13px;
      color: var(--text-secondary);
    }

    .import-example {
      background: var(--import-example-bg);
      border: 1px solid var(--import-example-border);
      border-radius: 8px;
      padding: 12px;
      font-size: 13px;
      margin-top: 12px;
      color: var(--import-example-text);
    }

    .import-example code {
      background: var(--card-bg);
      padding: 4px 6px;
      border-radius: 4px;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
      word-break: break-all;
      display: block;
      margin-top: 6px;
      font-size: 12px;
      border: 1px solid var(--border-primary);
    }

    /* 实用工具模态框样式 */
    .tools-list {
      background: var(--tool-bg);
      border-radius: 12px;
      overflow: hidden;
      margin-top: 20px;
    }

    .tool-item {
      display: flex;
      align-items: flex-start;
      padding: 20px;
      border-bottom: 1px solid var(--tool-border);
      cursor: pointer;
      transition: all 0.3s ease;
    }

    .tool-item:last-child {
      border-bottom: none;
    }

    .tool-item:hover {
      background-color: var(--tool-hover-bg);
      transform: translateX(5px);
    }

    .tool-item:active {
      background-color: var(--bg-active);
      transform: translateX(2px);
    }

    .tool-icon {
      font-size: 32px;
      margin-right: 16px;
      width: 48px;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      background: var(--tool-icon-bg);
      border-radius: 12px;
      border: 1px solid var(--tool-icon-border);
    }

    .tool-content {
      flex: 1;
    }

    .tool-title {
      font-size: 16px;
      color: var(--text-primary);
      margin-bottom: 4px;
      font-weight: 600;
    }

    .tool-desc {
      font-size: 14px;
      color: var(--text-secondary);
      line-height: 1.4;
    }

    .import-label {
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 10px;
      display: block;
    }

    .import-file-btn {
      font-size: 15px;
      padding: 12px 20px;
      border-radius: 8px;
    }

    .import-textarea {
      border-radius: 8px;
      border: 2px solid var(--input-border);
      font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
      font-size: 13px;
      line-height: 1.5;
      background: var(--input-bg-focus);
      color: var(--input-text);
      transition: border-color 0.2s;
    }

    .import-textarea:focus {
      border-color: var(--input-border-focus);
      outline: none;
    }

    .import-form-actions {
      margin-top: 25px;
      padding-top: 20px;
      border-top: 1px solid var(--modal-header-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .import-form-actions .btn {
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 14px;
    }

    .import-preview {
      background: var(--import-instructions-bg);
      border-radius: 12px;
      padding: 20px;
      margin: 20px 0;
      border: 1px solid var(--import-instructions-border);
      max-height: 350px;
      overflow-y: auto;
      box-shadow: var(--shadow-sm);
      /* 修复滚动条破坏圆角的问题 */
      scrollbar-width: thin;
      scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
    }

    /* Webkit浏览器的滚动条样式 */
    .import-preview::-webkit-scrollbar {
      width: 8px;
    }

    .import-preview::-webkit-scrollbar-track {
      background: var(--scrollbar-track);
      border-radius: 12px;
    }

    .import-preview::-webkit-scrollbar-thumb {
      background: var(--scrollbar-thumb);
      border-radius: 4px;
      border: 2px solid transparent;
      background-clip: content-box;
    }

    .import-preview::-webkit-scrollbar-thumb:hover {
      background: var(--scrollbar-thumb-hover);
      background-clip: content-box;
    }

    .import-preview h3 {
      margin: 0 0 18px 0;
      color: var(--text-primary);
      font-size: 17px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .import-preview h3::before {
      content: '📋';
      font-size: 20px;
    }

    .import-preview-item {
      background: var(--card-bg);
      border: 1px solid var(--border-secondary);
      border-radius: 8px;
      padding: 12px 15px;
      margin-bottom: 10px;
      font-size: 14px;
      transition: all 0.3s ease;
      box-shadow: var(--card-shadow);
    }

    .import-preview-item:hover {
      transform: translateY(-1px);
      box-shadow: var(--shadow-md);
    }

    .import-preview-item.valid {
      border-color: var(--success);
      background: var(--success-light);
      border-left: 4px solid var(--success);
    }

    .import-preview-item.invalid {
      border-color: var(--danger-darker);
      background: var(--danger-light);
      border-left: 4px solid var(--danger-darker);
    }

    .import-preview-item.skipped {
      border-color: var(--warning);
      background: var(--warning-light);
      border-left: 4px solid var(--warning);
      opacity: 0.8;
    }

    .import-preview-item .service-name {
      font-weight: bold;
      color: var(--text-primary);
    }

    .import-preview-item .account-name {
      color: var(--text-secondary);
      font-size: 12px;
    }

    .import-preview-item .error-msg {
      color: var(--danger-darker);
      font-size: 12px;
      margin-top: 5px;
    }

    .btn-info {
      background: var(--btn-info-bg);
      color: var(--btn-info-text);
    }

    .btn-info:hover {
      background: var(--btn-info-hover);
    }

    textarea {
      width: 100%;
      padding: 12px;
      border: 2px solid var(--input-border);
      border-radius: 8px;
      font-size: 14px;
      font-family: monospace;
      resize: vertical;
      min-height: 120px;
      background: var(--input-bg-focus);
      color: var(--input-text);
    }

    textarea:focus {
      outline: none;
      border-color: var(--info);
    }

    /* 二维码模态框样式 - 已移除，使用标准模态框样式 */

    .qr-code-container {
      background: var(--bg-secondary);
      border-radius: 12px;
      padding: 30px;
      margin: 20px 0;
      border: 1px solid var(--border-primary);
      text-align: center;
    }

    .qr-display {
      text-align: center;
      padding: 20px;
    }

    .qr-image {
      max-width: 300px;
      height: auto;
      margin: 0 auto;
      display: block;
      border-radius: 8px;
      box-shadow: var(--shadow-sm);
    }

    .qr-code {
      width: 200px;
      height: 200px;
      margin: 0 auto;
      display: block;
      border-radius: 8px;
      border: 1px solid var(--border-secondary);
      background: var(--card-bg);
      padding: 10px;
    }

    .qr-info {
      background: var(--info-light);
      border-radius: 8px;
      padding: 15px;
      margin: 20px 0;
      font-size: 14px;
      color: var(--info);
      text-align: center;
      border: 1px solid var(--border-primary);
      line-height: 1.5;
    }


    /* 扫描器相关样式 - 已更新，使用新的样式 */

    /* 小屏幕手机适配 */
    @media (max-width: 480px) {
      body {
        padding: 0;
      }

      .container {
        min-height: 100vh;
        border-radius: 0;
      }

      .header {
        padding: 40px 20px 30px 20px;
      }

      .content {
        padding: 0 16px 20px 16px;
      }

      /* 二维码专用样式 */
      .qr-subtitle-section {
        text-align: center;
        margin-bottom: 20px;
        padding: 12px;
        background: var(--bg-secondary);
        border-radius: 8px;
        border: 1px solid var(--border-primary);
      }

      .qr-subtitle-section p {
        color: var(--text-secondary);
        margin: 0;
        font-size: 14px;
        font-weight: 500;
      }



      /* 模态框移动端优化 */
      .modal {
        padding: 10px;
      }

      .modal-content {
        padding: 20px;
        max-height: 90vh;
        border-radius: 6px;
        /* 移动端模态框滚动条样式 */
        scrollbar-width: thin;
        scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
      }

      .modal-content::-webkit-scrollbar {
        width: 6px;
      }

      .modal-content::-webkit-scrollbar-track {
        background: var(--scrollbar-track);
        border-radius: 6px;
      }

      .modal-content::-webkit-scrollbar-thumb {
        background: var(--scrollbar-thumb);
        border-radius: 3px;
        border: 1px solid transparent;
        background-clip: content-box;
      }

      .modal-content::-webkit-scrollbar-thumb:hover {
        background: var(--scrollbar-thumb-hover);
        background-clip: content-box;
      }

      .modal-header {
        margin-bottom: 20px;
        padding-bottom: 15px;
      }

      .modal-header h2 {
        font-size: 20px;
      }

      .modal-actions {
        margin-top: 20px;
        padding-top: 15px;
        gap: 12px;
      }

      .form-actions {
        margin-top: 20px;
        padding-top: 15px;
        gap: 8px;
      }

      .btn {
        padding: 12px 16px;
        font-size: 14px;
        min-width: 100px;
      }

      .scanner-container {
        max-height: 250px;
        margin: 10px 0;
      }

      .qr-actions {
        margin-top: 10px;
        gap: 6px;
      }

      .qr-btn-action,
      .qr-btn-close {
        padding: 10px 12px;
        font-size: 13px;
        min-width: 100px;
        max-width: 150px;
      }

      /* 批量导入移动端优化 */
      .import-instructions {
        padding: 15px;
        margin-bottom: 20px;
      }

      /* 还原配置移动端优化 */
      .restore-content {
        flex-direction: column;
        gap: 20px;
      }

      .restore-instructions {
        padding: 15px;
        margin-bottom: 20px;
      }

      .restore-instructions p {
        font-size: 14px;
      }

      .restore-instructions p:last-child {
        font-size: 12px;
        padding: 6px 10px;
      }

      .backup-list-header {
        padding: 10px 12px;
        margin-bottom: 12px;
      }

      .backup-list-header span {
        font-size: 13px;
      }

      .backup-select {
        width: 100%;
        min-width: 100%;
        max-width: 100%;
        padding: 10px 14px;
        padding-right: 36px;
        font-size: 13px;
        border: 1px solid var(--table-border);
        border-radius: 8px;
        background: var(--backup-select-bg);
        background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23666666' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6,9 12,15 18,9'%3e%3c/polyline%3e%3c/svg%3e");
        background-repeat: no-repeat;
        background-position: right 10px center;
        background-size: 16px;
        color: var(--text-primary);
        cursor: pointer;
        appearance: none;
        -webkit-appearance: none;
        -moz-appearance: none;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        box-sizing: border-box;
        display: block;
      }

      /* 强制 option 元素不换行并正确显示 */
      .backup-select option {
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        padding: 8px 12px !important;
        font-size: 13px !important;
        line-height: normal !important;
        max-width: 100% !important;
        display: block !important;
      }

      .backup-actions {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 10px;
        gap: 8px;
      }

      .preview-header {
        padding: 10px 12px;
        margin-bottom: 12px;
        font-size: 13px;
      }

      .backup-preview-content {
        max-height: 300px;
        padding: 8px;
      }

      .backup-table {
        font-size: 11px;
        border: 2px solid var(--table-border);
      }

      .backup-table th {
        padding: 8px 10px;
        font-size: 10px;
        border-right: 1px solid rgba(255, 255, 255, 0.3);
        border-bottom: 2px solid var(--table-header-border);
      }

      .backup-table th:last-child {
        border-right: none;
      }

      .backup-table td {
        padding: 8px 10px;
        border-right: 1px solid var(--table-border);
        border-bottom: 1px solid var(--table-border);
      }

      .backup-table td:last-child {
        border-right: none;
      }

      .backup-table tbody tr:last-child td {
        border-bottom: none;
      }

      .service-name {
        min-width: 80px;
        max-width: 100px;
        font-size: 11px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .account-info {
        min-width: 100px;
        max-width: 120px;
        font-size: 10px;
      }

      .secret-type {
        min-width: 50px;
        font-size: 10px;
        white-space: nowrap;
      }

      .created-time {
        min-width: 100px;
        font-size: 9px;
      }

      /* 移动端深色主题表格边框 */
    }

    /* ==================== 导出格式选择 - 紧凑网格布局 ==================== */
    .export-modal-compact {
      max-width: 520px;
    }

    .export-summary {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      background: var(--bg-secondary);
      border-radius: 8px;
      margin-bottom: 20px;
      gap: 12px;
    }

    .export-count {
      font-size: 14px;
      color: var(--text-secondary);
    }

    .export-count strong {
      color: var(--text-primary);
      font-size: 16px;
    }

    .export-sort-wrapper {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .export-sort-label {
      font-size: 13px;
      color: var(--text-secondary);
      white-space: nowrap;
    }

    .export-sort-select {
      padding: 8px 12px;
      border: 1px solid var(--border-primary);
      border-radius: 6px;
      background: var(--input-bg);
      color: var(--text-primary);
      font-size: 13px;
      cursor: pointer;
    }

    .format-section {
      margin-bottom: 20px;
    }

    .format-section:last-of-type {
      margin-bottom: 16px;
    }

    .format-section-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-tertiary);
      margin-bottom: 10px;
      padding-left: 2px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .format-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
    }

    .format-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 14px 8px;
      background: var(--bg-primary);
      border: 2px solid var(--border-primary);
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.2s ease;
      min-height: 72px;
    }

    .format-card:hover {
      border-color: var(--success);
      background: var(--bg-hover);
      transform: translateY(-2px);
      box-shadow: var(--shadow-md);
    }

    .format-card:active {
      transform: translateY(0);
      box-shadow: var(--shadow-sm);
    }

    .format-icon {
      font-size: 24px;
      margin-bottom: 6px;
      line-height: 1;
    }

    .format-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
      text-align: center;
      line-height: 1.2;
    }

    .format-ext {
      font-size: 10px;
      color: var(--text-tertiary);
      margin-top: 2px;
    }

    .format-compat {
      font-size: 9px;
      color: var(--success);
      margin-top: 4px;
      padding: 2px 6px;
      background: var(--success-light, rgba(76, 175, 80, 0.1));
      border-radius: 4px;
      white-space: nowrap;
    }

    .format-details {
      margin: 16px 0;
      border: 1px solid var(--border-primary);
      border-radius: 8px;
      overflow: hidden;
    }

    .format-details summary {
      cursor: pointer;
      font-size: 13px;
      color: var(--text-secondary);
      padding: 12px 16px;
      background: var(--bg-secondary);
      user-select: none;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .format-details summary:hover {
      color: var(--text-primary);
      background: var(--bg-tertiary);
    }

    .format-details[open] summary {
      border-bottom: 1px solid var(--border-primary);
    }

    .format-help-content {
      padding: 12px 16px;
      font-size: 12px;
      color: var(--text-secondary);
      line-height: 1.8;
      background: var(--bg-primary);
    }

    .format-help-content p {
      margin: 4px 0;
      display: flex;
      gap: 8px;
    }

    .format-help-content strong {
      color: var(--text-primary);
      min-width: 70px;
    }

    /* 导出格式响应式 - 手机端 */
    @media (max-width: 480px) {
      .export-modal-compact {
        max-width: 100%;
      }

      .export-summary {
        flex-direction: column;
        align-items: stretch;
        gap: 10px;
        padding: 12px;
      }

      .export-sort-wrapper {
        width: 100%;
      }

      .export-sort-label {
        font-size: 12px;
      }

      .export-sort-select {
        flex: 1;
      }

      .format-grid {
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
      }

      .format-card {
        padding: 12px 6px;
        min-height: 68px;
        border-radius: 10px;
      }

      .format-icon {
        font-size: 22px;
        margin-bottom: 4px;
      }

      .format-name {
        font-size: 12px;
      }

      .format-ext {
        font-size: 9px;
      }

      .format-compat {
        font-size: 8px;
        padding: 1px 4px;
      }

      .format-details summary {
        padding: 10px 14px;
        font-size: 12px;
      }

      .format-help-content {
        padding: 10px 14px;
        font-size: 11px;
      }
    }

    /* ==================== 导入模态框 - 紧凑优化布局 ==================== */
    .import-modal-compact {
      max-width: 520px;
    }

    /* ==================== 智能输入区样式 ==================== */
    .smart-import-zone {
      margin-bottom: 12px;
    }

    .import-textarea-smart {
      width: 100%;
      min-height: 140px;
      padding: 14px 16px;
      border: 2px dashed var(--import-file-border);
      border-radius: 12px;
      background: var(--import-file-bg);
      color: var(--text-primary);
      font-size: 14px;
      font-family: inherit;
      line-height: 1.5;
      resize: vertical;
      transition: all 0.3s ease;
      box-sizing: border-box;
    }

    .import-textarea-smart::placeholder {
      color: var(--text-tertiary);
    }

    .import-textarea-smart:hover {
      border-color: var(--btn-primary-bg);
      background: var(--bg-hover);
    }

    .import-textarea-smart:focus {
      outline: none;
      border-color: var(--btn-primary-bg);
      border-style: solid;
      background: var(--input-bg-focus);
      box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.15);
    }

    .import-textarea-smart.drag-over {
      border-color: var(--success);
      border-style: solid;
      background: var(--success-light);
    }

    .import-textarea-smart.has-content {
      border-color: var(--success);
      border-style: solid;
    }

    /* 选择文件按钮区域 */
    .import-file-btn-wrapper {
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: flex-start;
      gap: 12px;
      margin-bottom: 12px;
    }

    .import-file-btn-wrapper > .btn {
      flex: 0 0 auto;
      width: auto;
      min-width: auto;
    }

    .import-file-btn {
      padding: 10px 18px;
      font-size: 14px;
      font-weight: 500;
      border-radius: 8px;
    }

    .import-file-hint {
      flex: 0 1 auto;
      font-size: 12px;
      color: var(--text-tertiary);
      text-align: left;
    }

    /* 已选文件信息徽章 */
    .file-info-badge {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      background: var(--success-light);
      border: 1px solid var(--success);
      border-radius: 8px;
      margin-bottom: 12px;
      font-size: 13px;
    }

    .file-info-badge .file-icon {
      font-size: 16px;
      flex-shrink: 0;
    }

    .file-info-badge .file-name {
      font-weight: 600;
      color: var(--text-primary);
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .file-info-badge .file-size {
      color: var(--text-secondary);
      font-size: 12px;
      flex-shrink: 0;
    }

    .file-info-badge .file-clear-btn {
      background: none;
      border: none;
      color: var(--text-tertiary);
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 14px;
      transition: all 0.2s;
      flex-shrink: 0;
    }

    .file-info-badge .file-clear-btn:hover {
      background: var(--danger-light);
      color: var(--danger-darker);
    }

    /* 导入小提示 */
    .import-tips {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-wrap: wrap;
      gap: 8px;
      padding: 10px 12px;
      margin: 12px 0;
      font-size: 12px;
      color: var(--text-secondary);
      background: var(--bg-secondary);
      border-radius: 6px;
    }

    .import-tip a {
      color: var(--text-link);
      text-decoration: none;
      font-weight: 500;
    }

    .import-tip a:hover {
      color: var(--text-link-hover);
      text-decoration: underline;
    }

    .import-tip-divider {
      color: var(--border-primary);
    }

    /* 格式说明折叠区 */
    .import-format-details {
      margin: 8px 0;
      border: 1px solid var(--border-primary);
      border-radius: 8px;
      overflow: hidden;
    }

    .import-format-details summary {
      cursor: pointer;
      font-size: 12px;
      color: var(--text-tertiary);
      padding: 8px 12px;
      background: var(--bg-secondary);
      user-select: none;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .import-format-details summary:hover {
      color: var(--text-primary);
      background: var(--bg-tertiary);
    }

    .import-format-details[open] summary {
      border-bottom: 1px solid var(--border-primary);
    }

    .import-format-help {
      padding: 12px 14px;
      font-size: 12px;
      color: var(--text-secondary);
      line-height: 1.8;
      background: var(--bg-primary);
    }

    .import-format-help p {
      margin: 4px 0;
    }

    .import-format-help strong {
      color: var(--text-primary);
      min-width: 80px;
      display: inline-block;
    }

    .import-format-help code {
      display: block;
      margin-top: 10px;
      padding: 10px;
      background: var(--bg-secondary);
      border-radius: 6px;
      font-size: 11px;
      word-break: break-all;
      color: var(--text-secondary);
      border: 1px solid var(--border-primary);
    }

    /* 紧凑预览区 */
    .import-preview-compact {
      background: var(--bg-secondary);
      border-radius: 10px;
      padding: 14px;
      margin: 16px 0;
      border: 1px solid var(--border-primary);
    }

    .import-preview-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      flex-wrap: wrap;
      gap: 8px;
    }

    .preview-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .preview-title::before {
      content: '📋';
      font-size: 16px;
    }

    .import-stats-inline {
      display: flex;
      gap: 12px;
      font-size: 12px;
    }

    .stat-valid {
      color: var(--success);
      font-weight: 600;
    }

    .stat-invalid {
      color: var(--danger-darker);
      font-weight: 600;
    }

    .stat-skipped {
      color: var(--warning);
      font-weight: 600;
    }

    .stat-total {
      color: var(--text-secondary);
    }

    .import-preview-list {
      max-height: 200px;
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
    }

    .import-preview-list::-webkit-scrollbar {
      width: 6px;
    }

    .import-preview-list::-webkit-scrollbar-track {
      background: var(--scrollbar-track);
      border-radius: 3px;
    }

    .import-preview-list::-webkit-scrollbar-thumb {
      background: var(--scrollbar-thumb);
      border-radius: 3px;
    }

    /* 导入响应式 - 手机端 */
    @media (max-width: 480px) {
      .import-modal-compact {
        max-width: 100%;
      }

      /* 智能输入区响应式 */
      .import-textarea-smart {
        min-height: 120px;
        padding: 12px 14px;
        font-size: 13px;
        border-radius: 10px;
      }

      .import-file-btn-wrapper {
        flex-direction: column;
        align-items: stretch;
        gap: 8px;
      }

      .import-file-btn {
        width: 100%;
        text-align: center;
      }

      .import-file-hint {
        text-align: center;
      }

      .file-info-badge {
        padding: 8px 12px;
        font-size: 12px;
      }

      .file-info-badge .file-icon {
        font-size: 14px;
      }

      .file-info-badge .file-size {
        font-size: 11px;
      }

      .import-tips {
        flex-direction: column;
        gap: 4px;
        text-align: center;
      }

      .import-tip-divider {
        display: none;
      }

      .import-stats-inline {
        flex-wrap: wrap;
        gap: 8px;
        justify-content: flex-end;
      }

      .import-preview-header {
        flex-direction: column;
        align-items: flex-start;
      }

      .import-preview-list {
        max-height: 150px;
      }
    }

    /* 导入响应式 - 超小屏幕 */
    @media (max-width: 360px) {
      .import-textarea-smart {
        min-height: 100px;
        padding: 10px 12px;
        font-size: 12px;
      }

      .import-file-btn {
        padding: 8px 14px;
        font-size: 13px;
      }

      .import-file-hint {
        font-size: 11px;
      }

      .file-info-badge {
        padding: 6px 10px;
        font-size: 11px;
        gap: 6px;
      }
    }

    /* ==================== 二级格式选择模态框 ==================== */

    /* 二级格式选择模态框 */
    .sub-format-modal {
      max-width: 450px;
    }

    .sub-format-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-top: 16px;
    }

    .sub-format-option {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 16px;
      background: var(--bg-primary);
      border: 2px solid var(--border-primary);
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .sub-format-option:hover {
      border-color: var(--accent-color);
      background: var(--bg-hover);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .sub-format-icon {
      font-size: 32px;
      flex-shrink: 0;
    }

    .sub-format-info {
      flex: 1;
    }

    .sub-format-name {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 4px;
    }

    .sub-format-ext {
      font-size: 11px;
      color: var(--accent-color);
      font-weight: 600;
      margin-bottom: 6px;
    }

    .sub-format-desc {
      font-size: 12px;
      color: var(--text-secondary);
      margin-bottom: 4px;
    }

    .sub-format-compat {
      font-size: 10px;
      color: var(--text-tertiary);
    }

    /* 二级格式选择 - 移动端适配 */
    @media (max-width: 480px) {
      .sub-format-modal {
        max-width: 95vw;
      }

      .sub-format-option {
        flex-direction: column;
        text-align: center;
        gap: 12px;
      }

      .sub-format-icon {
        font-size: 40px;
      }
    }
  `;
}
