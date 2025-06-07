/**
 * 响应式样式模块
 * CSS 变量会自动处理颜色主题切换,此文件仅包含响应式布局调整
 */
export function getResponsiveStyles() {
	return `
      /* ========== 全局 Select 和 Option 样式修复 ========== */
      /* 修复 iOS/Safari/iPad 下拉列表显示问题 */
      select.backup-select {
        width: 100% !important;
        max-width: 100% !important;
        box-sizing: border-box !important;
      }

      /* 强制所有 option 元素不换行 */
      select.backup-select option {
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        line-height: normal !important;
        display: block !important;
      }

      /* 还原配置样式 */
      .restore-instructions {
        padding: 20px;
        margin-bottom: 25px;
        background: var(--restore-instructions-bg);
        border-radius: 12px;
        border-left: 5px solid var(--restore-instructions-border);
        box-shadow: 0 2px 8px rgba(255, 152, 0, 0.1);
        position: relative;
        overflow: hidden;
      }

      .restore-instructions::before {
        content: '';
        position: absolute;
        top: -50%;
        right: -50%;
        width: 100%;
        height: 100%;
        background: radial-gradient(circle, rgba(255, 152, 0, 0.05) 0%, transparent 70%);
        pointer-events: none;
      }

      .restore-instructions p {
        margin: 0;
        font-size: 15px;
        color: var(--text-primary);
        line-height: 1.5;
      }

      .restore-instructions p:first-child {
        font-weight: 600;
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .restore-instructions p:last-child {
        color: var(--restore-warning-text);
        font-size: 13px;
        background: var(--restore-warning-bg);
        padding: 8px 12px;
        border-radius: 6px;
        border: 1px solid var(--restore-warning-border);
        margin-top: 10px;
      }
      
      .restore-content {
        display: flex;
        flex-direction: column;
        gap: 25px;
        margin-bottom: 25px;
      }

      .backup-list-container {
        width: 100%;
        min-width: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      .backup-list-header {
        display: flex;
        justify-content: center;
        align-items: center;
        margin-bottom: 15px;
        padding: 12px 16px;
        background: var(--backup-header-bg);
        border-radius: 10px;
        border: 1px solid var(--backup-header-border);
        box-shadow: 0 2px 4px rgba(33, 150, 243, 0.1);
        width: 100%;
      }

      .backup-list-header span {
        font-weight: 600;
        color: var(--backup-header-text);
        font-size: 14px;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .backup-actions {
        display: flex;
        justify-content: center;
        align-items: center;
        margin-top: 12px;
        gap: 12px;
        width: 100%;
      }

      .backup-select-wrapper {
        position: relative;
        width: 100%;
      }
      
      .backup-select {
        width: 100%;
        min-width: 100%;
        max-width: 100%;
        padding: 12px 16px;
        border: 2px solid var(--backup-select-border);
        border-radius: 10px;
        background: var(--card-bg);
        font-size: 14px;
        color: var(--text-primary);
        cursor: pointer;
        transition: all 0.3s ease;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
        appearance: none;
        -webkit-appearance: none;
        -moz-appearance: none;
        background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%231976d2' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6,9 12,15 18,9'%3e%3c/polyline%3e%3c/svg%3e");
        background-repeat: no-repeat;
        background-position: right 12px center;
        background-size: 16px;
        padding-right: 40px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        box-sizing: border-box;
        display: block;
      }

      /* Safari/iPad 特殊处理 */
      @supports (-webkit-touch-callout: none) {
        .backup-select {
          -webkit-appearance: none;
          appearance: none;
        }
      }

      .backup-select:hover {
        border-color: var(--backup-header-border);
        box-shadow: 0 4px 12px rgba(33, 150, 243, 0.15);
        transform: translateY(-1px);
      }

      .backup-select:focus {
        outline: none;
        border-color: var(--backup-header-text);
        box-shadow: 0 0 0 3px rgba(33, 150, 243, 0.2);
      }

      /* 强制 option 元素不换行并正确显示 */
      .backup-select option {
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        padding: 8px 12px !important;
        font-size: 14px !important;
        line-height: normal !important;
        max-width: 100% !important;
        display: block !important;
        color: var(--text-primary);
        background: var(--card-bg);
      }

      .backup-select option:hover {
        background: var(--bg-secondary);
      }

      .backup-select option:checked {
        background: var(--backup-select-border);
        color: var(--backup-header-text);
        font-weight: 600;
      }
      
      .backup-preview {
        width: 100%;
        min-width: 0;
      }
      
      .preview-header {
        font-weight: 600;
        color: var(--text-primary);
        margin-bottom: 15px;
        padding: 12px 16px;
        background: linear-gradient(135deg, #e8f5e8 0%, #d4f1d4 100%);
        border-radius: 10px;
        border: 1px solid var(--success);
        box-shadow: 0 2px 4px rgba(76, 175, 80, 0.1);
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
      }

      .backup-preview-content {
        max-height: 400px;
        overflow-y: auto;
        border: 2px solid var(--success-light);
        border-radius: 12px;
        background: var(--table-bg);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
        scrollbar-width: thin;
        scrollbar-color: var(--success) var(--bg-secondary);
      }

      .backup-preview-content::-webkit-scrollbar {
        width: 6px;
      }

      .backup-preview-content::-webkit-scrollbar-track {
        background: var(--bg-secondary);
        border-radius: 3px;
      }

      .backup-preview-content::-webkit-scrollbar-thumb {
        background: var(--success);
        border-radius: 3px;
      }

      .backup-preview-content::-webkit-scrollbar-thumb:hover {
        background: var(--success-dark);
      }
      
      .backup-table-container {
        width: 100%;
        overflow-x: auto;
      }
      
      .backup-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
        background: var(--table-bg);
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        border: 2px solid var(--table-border);
      }

      .backup-table thead {
        background: var(--table-header-bg);
        color: white;
      }

      .backup-table th {
        padding: 12px 16px;
        text-align: left;
        font-weight: 600;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        border-bottom: 2px solid var(--table-header-border);
        border-right: 1px solid rgba(255, 255, 255, 0.3);
      }

      .backup-table th:last-child {
        border-right: none;
      }

      .backup-table tbody tr {
        border-bottom: 1px solid var(--table-border);
        transition: all 0.2s ease;
      }

      .backup-table tbody tr:hover {
        background: var(--table-row-hover);
        transform: scale(1.01);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      }

      .backup-table tbody tr:last-child {
        border-bottom: none;
      }

      .backup-table td {
        padding: 12px 16px;
        vertical-align: middle;
        word-break: break-word;
        border-right: 1px solid var(--table-border);
      }

      .backup-table td:last-child {
        border-right: none;
      }

      .service-name {
        font-weight: 600;
        color: var(--text-primary);
        min-width: 120px;
        max-width: 180px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .account-info {
        color: var(--text-secondary);
        min-width: 150px;
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .secret-type {
        color: var(--success);
        font-weight: 600;
        text-align: center;
        min-width: 80px;
        white-space: nowrap;
      }

      .created-time {
        color: var(--text-secondary);
        font-size: 11px;
        min-width: 140px;
      }

      .loading-backup {
        text-align: center;
        padding: 30px 20px;
        color: var(--text-secondary);
        font-style: italic;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
      }
      
      .loading-backup::before {
        content: '⏳';
        font-size: 24px;
        animation: spin 1s linear infinite;
      }
      
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      
      .no-backups {
        text-align: center;
        padding: 30px 20px;
        color: var(--text-secondary);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
      }
      
      .no-backups::before {
        content: '📭';
        font-size: 24px;
      }
      
      .import-method {
        padding: 10px 12px;
        font-size: 13px;
      }
      
      .file-import-section {
        padding: 20px;
        margin-bottom: 20px;
      }
      
      .import-preview {
        padding: 15px;
        margin: 15px 0;
        max-height: 300px;
      }
      
      .form-actions {
        margin-top: 20px;
        padding-top: 15px;
      }
      
      .form-actions .btn {
        padding: 10px 16px;
        font-size: 13px;
      }
      
      /* 实用工具移动端优化 */
      .tools-list {
        margin-top: 15px;
      }
      
      .tool-item {
        padding: 15px;
      }
      
      .tool-icon {
        font-size: 24px;
        width: 40px;
        height: 40px;
        margin-right: 12px;
      }
      
      .tool-title {
        font-size: 15px;
      }
      
      .tool-desc {
        font-size: 13px;
      }

      .header h1 {
        font-size: 20px;
      }

      .content {
        padding: 15px;
      }

      .import-export-buttons {
        gap: 8px;
        margin-bottom: 15px;
      }
      
      .export-button, .import-button {
        font-size: 14px;
        padding: 12px 16px;
        min-width: 160px;
      }
      
      .secret-card {
        padding: 12px;
        padding-top: 16px;
        margin-bottom: 0;
        border-radius: 4px;
        box-shadow: none;
      }
      
      .secret-header {
        flex-direction: column;
        align-items: stretch;
        gap: 10px;
      }
      
      .secret-actions {
        justify-content: center;
        width: 100%;
        gap: 8px;
      }
      
      .action-btn {
        flex: 1;
        max-width: 90px;
        min-width: 60px;
        font-size: 11px;
        padding: 6px 8px;
      }
      
      .otp-code {
        font-size: 24px;
        letter-spacing: 5px;
        padding: 12px 16px;
      }
      
      .otp-preview {
        margin-top: 8px;
      }
      
      .otp-code {
        font-size: 28px !important;
        letter-spacing: 4px !important;
        margin: 6px 0 !important;
      }
      
      .otp-main {
        gap: 12px !important;
        /* Chrome兼容性修复 */
        display: -webkit-flex !important;
        -webkit-align-items: center !important;
        -webkit-justify-content: space-between !important;
      }
      
      .otp-next-container {
        min-width: 70px !important;
        padding: 6px 8px !important;
        /* Chrome兼容性修复 */
        display: -webkit-flex !important;
        -webkit-flex-direction: column !important;
        -webkit-justify-content: center !important;
        -webkit-align-items: flex-end !important;
        -webkit-flex-shrink: 0 !important;
        -webkit-box-flex: 0 !important;
      }
      
      .otp-next-code {
        font-size: 14px !important;
        letter-spacing: 1px !important;
      }
      
      .progress-mini {
        width: 60px;
        height: 5px;
      }

      .progress-top {
        border-radius: 0;
      }

      .progress-top-fill {
        border-radius: 0;
      }

      .modal {
        padding: 10px;
      }
      
      .modal-content {
        padding: 20px;
        /* 小屏幕移动端模态框滚动条样式 */
        scrollbar-width: thin;
        scrollbar-color: var(--scrollbar-thumb) transparent;
      }

      .modal-content::-webkit-scrollbar {
        width: 4px;
      }

      .modal-content::-webkit-scrollbar-track {
        background: transparent;
      }

      .modal-content::-webkit-scrollbar-thumb {
        background: var(--scrollbar-thumb);
        border-radius: 2px;
        border: 1px solid transparent;
        background-clip: content-box;
      }

      .modal-content::-webkit-scrollbar-thumb:hover {
        background: var(--scrollbar-thumb-hover);
        background-clip: content-box;
      }
      
      .form-actions {
        flex-direction: row;
        justify-content: space-between;
        gap: 4px;
      }
      
      .form-actions .btn {
        flex: 1;
        padding: 10px 8px;
        font-size: 12px;
        min-width: auto;
      }
      
      .btn {
        width: 100%;
      }
    }
    
    /* 大屏幕手机和小平板适配 */
    @media (min-width: 481px) and (max-width: 767px) {
      /* 容器宽度适配 */
      .container {
        max-width: 600px;
      }

      body {
        padding: 8px;
      }
      
      .secrets-list {
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        justify-content: center;
        text-align: left;
      }
      
      .content {
        text-align: center;
      }
      
      .secret-header {
        flex-wrap: nowrap;
        align-items: center;
      }
      
      .secret-actions {
        flex-wrap: wrap;
      }
      
      .action-btn {
        font-size: 12px;
        min-width: 50px;
      }
    }

    /* 平板和中等桌面屏幕适配 */
    @media (min-width: 768px) and (max-width: 1199px) {
      /* iPad 和平板优化 */

      /* 还原配置模态框优化 */
      #restoreModal .modal-content {
        padding: 20px !important;
        max-width: 88vw !important;
        width: 88vw !important;
      }

      .restore-content {
        width: 100%;
        box-sizing: border-box;
      }

      .backup-list-container {
        width: 100% !important;
        max-width: 100% !important;
        box-sizing: border-box !important;
      }

      .backup-select-wrapper {
        width: 100% !important;
        max-width: 100% !important;
        box-sizing: border-box !important;
      }

      .backup-select {
        width: 100% !important;
        min-width: 100% !important;
        max-width: 100% !important;
        box-sizing: border-box !important;
        display: block !important;
      }

      /* 强制 option 元素不换行并正确显示 */
      .backup-select option {
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        padding: 10px 15px !important;
        font-size: 14px !important;
        line-height: normal !important;
        max-width: 100% !important;
        display: block !important;
      }

      .backup-preview {
        width: 100% !important;
        max-width: 100% !important;
      }

      /* 容器宽度适配 */
      .container {
        max-width: 750px;
      }

      /* iPad 和平板两列卡片布局 */
      .secrets-list {
        grid-template-columns: 1fr 1fr;
        gap: 14px;
        justify-content: center;
        text-align: left;
      }

      .content {
        text-align: center;
      }

      /* 确保备份表格在中等屏幕端正确显示 */
      .backup-table {
        width: 100% !important;
        border-collapse: collapse !important;
        font-size: 13px !important;
        background: var(--table-bg) !important;
        border-radius: 8px !important;
        overflow: hidden !important;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1) !important;
        border: 2px solid var(--table-border) !important;
      }

      .backup-table thead {
        background: var(--table-header-bg) !important;
        color: white !important;
      }

      .backup-table th {
        padding: 12px 16px !important;
        text-align: left !important;
        font-weight: 600 !important;
        font-size: 12px !important;
        text-transform: uppercase !important;
        letter-spacing: 0.5px !important;
        border-bottom: 2px solid var(--table-header-border) !important;
        border-right: 1px solid rgba(255, 255, 255, 0.3) !important;
      }

      .backup-table th:last-child {
        border-right: none !important;
      }

      .backup-table tbody tr {
        border-bottom: 1px solid var(--table-border) !important;
        transition: all 0.2s ease !important;
      }

      .backup-table tbody tr:hover {
        background: var(--table-row-hover) !important;
        transform: scale(1.01) !important;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1) !important;
      }

      .backup-table tbody tr:last-child {
        border-bottom: none !important;
      }

      .backup-table td {
        padding: 12px 16px !important;
        vertical-align: middle !important;
        word-break: break-word !important;
        border-right: 1px solid var(--table-border) !important;
      }

      .backup-table td:last-child {
        border-right: none !important;
      }

      .backup-table .service-name {
        font-weight: 600 !important;
        color: var(--text-primary) !important;
        min-width: 120px !important;
        max-width: 180px !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
      }

      .backup-table .account-info {
        color: var(--text-secondary) !important;
        min-width: 150px !important;
        max-width: 200px !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
      }

      .backup-table .secret-type {
        color: var(--success) !important;
        font-weight: 600 !important;
        text-align: center !important;
        min-width: 80px !important;
        white-space: nowrap !important;
      }

      .backup-table .created-time {
        color: var(--text-secondary) !important;
        font-size: 11px !important;
        min-width: 140px !important;
      }

      /* 中等屏幕备份操作按钮样式 */
      .backup-actions {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        margin-top: 12px !important;
        gap: 12px !important;
      }

      /* 中等屏幕下拉框优化 */
      .backup-select {
        width: 100% !important;
        min-width: 100% !important;
        max-width: 100% !important;
        font-size: 15px !important;
        padding: 14px 18px !important;
        padding-right: 45px !important;
        border-radius: 12px !important;
        background-size: 18px !important;
        background-position: right 15px center !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        box-sizing: border-box !important;
        display: block !important;
        -webkit-appearance: none !important;
        appearance: none !important;
      }

      /* 强制 option 元素不换行并正确显示 */
      .backup-select option {
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        padding: 10px 15px !important;
        font-size: 15px !important;
        line-height: normal !important;
        max-width: 100% !important;
        display: block !important;
      }
    }
    

    
    /* 大屏幕桌面端适配 */
    @media (min-width: 1200px) {
      /* 还原配置模态框优化 */
      #restoreModal .modal-content {
        max-width: 700px !important;
      }

      .restore-content {
        width: 100%;
      }

      .backup-list-container {
        width: 100% !important;
        max-width: 100% !important;
      }

      .backup-select-wrapper {
        width: 100% !important;
        max-width: 100% !important;
      }

      .backup-select {
        width: 100% !important;
        min-width: 100% !important;
        max-width: 100% !important;
        box-sizing: border-box !important;
      }

      .backup-select option {
        width: 100% !important;
        min-width: 100% !important;
      }

      .backup-preview {
        width: 100% !important;
        max-width: 100% !important;
      }

      .container {
        max-width: 900px;
      }

      .secrets-list {
        grid-template-columns: 1fr 1fr;
        gap: 16px;
        justify-content: center;
        text-align: left;
      }

      .content {
        text-align: center;
      }

      .secret-card {
        padding: 20px;
        padding-top: 24px;
        margin-bottom: 0;
        border-radius: 6px;
        box-shadow: none;
      }

      .otp-code {
        font-size: 38px;
        letter-spacing: 6px;
        margin: 6px 0;
      }

      .otp-preview {
        margin-top: 14px;
      }

      .progress-mini {
        width: 120px;
        height: 8px;
      }

      .progress-top {
        border-radius: 0;
      }

      .progress-top-fill {
        border-radius: 0;
      }

      /* 确保备份表格在大屏幕端正确显示 */
      .backup-table {
        width: 100% !important;
        border-collapse: collapse !important;
        font-size: 13px !important;
        background: var(--table-bg) !important;
        border-radius: 8px !important;
        overflow: hidden !important;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1) !important;
        border: 2px solid var(--table-border) !important;
      }

      .backup-table thead {
        background: var(--table-header-bg) !important;
        color: white !important;
      }

      .backup-table th {
        padding: 12px 16px !important;
        text-align: left !important;
        font-weight: 600 !important;
        font-size: 12px !important;
        text-transform: uppercase !important;
        letter-spacing: 0.5px !important;
        border-bottom: 2px solid var(--table-header-border) !important;
        border-right: 1px solid rgba(255, 255, 255, 0.3) !important;
      }

      .backup-table th:last-child {
        border-right: none !important;
      }

      .backup-table tbody tr {
        border-bottom: 1px solid var(--table-border) !important;
        transition: all 0.2s ease !important;
      }

      .backup-table tbody tr:hover {
        background: var(--table-row-hover) !important;
        transform: scale(1.01) !important;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1) !important;
      }

      .backup-table tbody tr:last-child {
        border-bottom: none !important;
      }

      .backup-table td {
        padding: 12px 16px !important;
        vertical-align: middle !important;
        word-break: break-word !important;
        border-right: 1px solid var(--table-border) !important;
      }

      .backup-table td:last-child {
        border-right: none !important;
      }

      .backup-table .service-name {
        font-weight: 600 !important;
        color: var(--text-primary) !important;
        min-width: 120px !important;
        max-width: 180px !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
      }

      .backup-table .account-info {
        color: var(--text-secondary) !important;
        min-width: 150px !important;
        max-width: 200px !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
      }

      .backup-table .secret-type {
        color: var(--success) !important;
        font-weight: 600 !important;
        text-align: center !important;
        min-width: 80px !important;
        white-space: nowrap !important;
      }

      .backup-table .created-time {
        color: var(--text-secondary) !important;
        font-size: 11px !important;
        min-width: 140px !important;
      }

      /* 大屏幕备份操作按钮样式 */
      .backup-actions {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        margin-top: 15px !important;
        gap: 15px !important;
      }

      /* 大屏幕下拉框优化 */
      .backup-select {
        width: 100% !important;
        min-width: 100% !important;
        max-width: 100% !important;
        font-size: 16px !important;
        padding: 16px 20px !important;
        padding-right: 50px !important;
        border-radius: 12px !important;
        background-size: 22px !important;
        background-position: right 18px center !important;
        min-height: 50px !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        box-sizing: border-box !important;
        display: block !important;
        -webkit-appearance: none !important;
        appearance: none !important;
      }

      /* 强制 option 元素不换行并正确显示 */
      .backup-select option {
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        padding: 12px 18px !important;
        font-size: 16px !important;
        line-height: normal !important;
        max-width: 100% !important;
        display: block !important;
      }
    }

    /* 中间提示组件样式 */
    .center-toast {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) scale(0.9);
      z-index: 100000;
      pointer-events: none;
      opacity: 0;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .center-toast.show {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }

    .toast-content {
      background: var(--toast-bg);
      color: var(--toast-text);
      padding: 16px 24px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      gap: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      backdrop-filter: blur(10px);
      border: 1px solid var(--toast-border);
      min-width: 200px;
      text-align: center;
      font-size: 16px;
      font-weight: 500;
    }

    .toast-icon {
      font-size: 20px;
      flex-shrink: 0;
    }

    .toast-message {
      flex: 1;
      white-space: nowrap;
    }

    /* 响应式设计 */
    @media (max-width: 480px) {
      .toast-content {
        padding: 14px 20px;
        font-size: 15px;
        min-width: 180px;
        border-radius: 10px;
      }

      .toast-icon {
        font-size: 18px;
      }
    }

    @media (max-width: 360px) {
      .toast-content {
        padding: 12px 16px;
        font-size: 14px;
        min-width: 160px;
        border-radius: 8px;
      }

      .toast-icon {
        font-size: 16px;
      }
    }

    @media (min-width: 768px) and (max-width: 1024px) {
      /* iPad 专用样式优化 */

      /* 还原配置模态框优化 */
      #restoreModal .modal-content {
        padding: 20px !important;
        max-width: 92vw !important;
        width: 92vw !important;
      }

      .restore-content {
        width: 100%;
        box-sizing: border-box;
      }

      .backup-list-container {
        width: 100% !important;
        max-width: 100% !important;
        box-sizing: border-box !important;
      }

      .backup-select-wrapper {
        width: 100% !important;
        max-width: 100% !important;
        box-sizing: border-box !important;
      }

      .backup-select {
        width: 100% !important;
        min-width: 100% !important;
        max-width: 100% !important;
        font-size: 15px !important;
        padding: 14px 18px !important;
        padding-right: 45px !important;
        border-radius: 10px !important;
        background-size: 18px !important;
        background-position: right 15px center !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        box-sizing: border-box !important;
        display: block !important;
        -webkit-appearance: none !important;
        appearance: none !important;
      }

      /* 强制 option 元素不换行并正确显示 */
      .backup-select option {
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        padding: 10px 15px !important;
        font-size: 15px !important;
        line-height: normal !important;
        max-width: 100% !important;
        display: block !important;
      }

      .backup-preview {
        width: 100% !important;
        max-width: 100% !important;
      }

      /* Toast 样式 */
      .toast-content {
        padding: 18px 28px;
        font-size: 17px;
        min-width: 220px;
        border-radius: 14px;
      }

      .toast-icon {
        font-size: 22px;
      }
    }

    @media (min-width: 1025px) {
      .toast-content {
        padding: 20px 32px;
        font-size: 18px;
        min-width: 240px;
        border-radius: 16px;
      }

      .toast-icon {
        font-size: 24px;
      }
    }

    /* ========== 扫描二维码页面样式 ========== */
    .scanner-section {
      padding: 20px 0;
    }

    .scanner-description {
      text-align: center;
      margin-top: 10px;
      margin-bottom: 10px;
      padding: 8px 12px;
      background: var(--bg-secondary);
      border-radius: 6px;
      color: var(--text-tertiary);
      font-size: 11px;
      line-height: 1.4;
    }

    .scanner-description p {
      margin: 2px 0;
    }

    .scanner-description p:first-child {
      margin-top: 0;
    }

    .scanner-description p:last-child {
      margin-bottom: 0;
    }

    /* ========== 扫描器底部操作区（紧凑布局）========== */
    .scanner-bottom-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin: 12px 0 8px 0;
      padding: 0 4px;
    }

    .continuous-scan-inline {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      user-select: none;
      font-size: 13px;
      color: var(--text-secondary);
    }

    .continuous-scan-inline input[type="checkbox"] {
      width: 16px;
      height: 16px;
      accent-color: var(--success);
      cursor: pointer;
    }

    .continuous-scan-inline span {
      white-space: nowrap;
    }

    .btn-compact {
      padding: 8px 14px !important;
      font-size: 13px !important;
      min-width: auto !important;
      width: auto !important;
    }

    .scanner-hint {
      text-align: center;
      font-size: 11px;
      color: var(--text-tertiary);
      margin-bottom: 8px;
      line-height: 1.4;
    }

    /* 旧样式保留兼容 */
    .continuous-scan-toggle {
      margin: 16px 0;
      padding: 12px 16px;
      background: var(--bg-secondary);
      border-radius: 10px;
      border: 1px solid var(--border-primary);
    }

    .toggle-label {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      cursor: pointer;
      user-select: none;
    }

    .toggle-label input[type="checkbox"] {
      width: 18px;
      height: 18px;
      accent-color: var(--success);
      cursor: pointer;
      flex-shrink: 0;
    }

    .toggle-text {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .toggle-hint {
      font-size: 12px;
      color: var(--text-tertiary);
      flex-basis: 100%;
      margin-left: 28px;
    }

    /* 扫描计数器 */
    .scan-counter {
      text-align: center;
      padding: 10px 16px;
      margin-bottom: 15px;
      background: linear-gradient(135deg, var(--success-light) 0%, var(--info-light) 100%);
      border: 1px solid var(--success);
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      color: var(--success-dark);
    }

    .scan-counter #scanCountNum {
      font-size: 18px;
      color: var(--success);
      margin: 0 4px;
    }

    .scanner-container {
      position: relative;
      display: flex;
      justify-content: center;
      margin-bottom: 30px;
    }

    .video-wrapper {
      position: relative;
      width: 360px;
      height: 360px;
      border-radius: 20px;
      overflow: hidden;
      box-shadow: var(--shadow-lg);
      background: #000;
      border: 3px solid var(--border-primary);
      transition: all 0.3s ease;
    }

    .video-wrapper:hover {
      transform: translateY(-4px);
      box-shadow: var(--shadow-xl);
    }

    .video-wrapper video {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: center;
    }

    .scanner-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      pointer-events: none;
      background: rgba(0, 0, 0, 0.5);
    }

    .scanner-frame {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 70%;
      height: 70%;
      border: 4px solid #4CAF50;
      border-radius: 16px;
      box-shadow:
        0 0 30px rgba(76, 175, 80, 0.6),
        inset 0 0 30px rgba(76, 175, 80, 0.2);
      animation: scannerPulse 2s ease-in-out infinite;
    }

    .scanner-frame::before,
    .scanner-frame::after {
      content: '';
      position: absolute;
      width: 24px;
      height: 24px;
      border: 4px solid #4CAF50;
    }

    .scanner-frame::before {
      top: -4px;
      left: -4px;
      border-right: none;
      border-bottom: none;
      border-top-left-radius: 16px;
    }

    .scanner-frame::after {
      bottom: -4px;
      right: -4px;
      border-left: none;
      border-top: none;
      border-bottom-right-radius: 16px;
    }

    @keyframes scannerPulse {
      0%, 100% {
        box-shadow:
          0 0 30px rgba(76, 175, 80, 0.6),
          inset 0 0 30px rgba(76, 175, 80, 0.2);
        border-color: #4CAF50;
      }
      50% {
        box-shadow:
          0 0 50px rgba(76, 175, 80, 0.9),
          inset 0 0 50px rgba(76, 175, 80, 0.3);
        border-color: #66BB6A;
      }
    }

    .scanner-status {
      text-align: center;
      margin-bottom: 25px;
      padding: 12px 20px;
      background: var(--bg-secondary);
      border-radius: 10px;
      color: var(--text-primary);
      font-size: 15px;
      font-weight: 500;
      line-height: 1.6;
      min-height: 50px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      box-shadow: var(--shadow-sm);
    }

    .scanner-status::before {
      content: '📡';
      font-size: 20px;
      animation: pulse 1.5s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% {
        opacity: 1;
        transform: scale(1);
      }
      50% {
        opacity: 0.7;
        transform: scale(1.1);
      }
    }

    .scanner-error {
      background: var(--danger-light);
      border: 1px solid var(--danger);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
      text-align: center;
      color: var(--danger-darker);
      box-shadow: var(--shadow-sm);
    }

    .scanner-error #errorMessage {
      margin-bottom: 8px;
      font-size: 13px;
      line-height: 1.4;
      font-weight: 500;
      white-space: pre-line; /* 支持换行符显示 */
    }

    .scanner-error::before {
      content: '⚠️';
      display: block;
      font-size: 20px;
      margin-bottom: 6px;
    }

    .scanner-actions {
      margin-top: 25px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .scanner-actions .btn {
      width: 100%;
      padding: 14px 20px;
      font-size: 15px;
      font-weight: 600;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all 0.3s ease;
    }

    .scanner-actions .btn:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-md);
    }

    .scanner-actions .btn:active {
      transform: translateY(0);
    }

    /* 响应式设计 */
    @media (max-width: 600px) {
      .scanner-section {
        padding: 20px 0;
      }

      .video-wrapper {
        width: 300px;
        height: 300px;
        border-radius: 16px;
      }

      .scanner-description {
        font-size: 11px;
        padding: 8px 12px;
      }

      .scanner-status {
        font-size: 13px;
        padding: 8px 12px;
        min-height: 40px;
      }

      .scanner-error {
        padding: 10px;
      }

      .scanner-bottom-actions {
        margin: 10px 0 6px 0;
      }

      .continuous-scan-inline {
        font-size: 12px;
      }

      .scanner-hint {
        font-size: 10px;
      }
    }

    @media (max-width: 480px) {
      .video-wrapper {
        width: 280px;
        height: 280px;
        border-radius: 14px;
      }

      .scanner-frame {
        width: 75%;
        height: 75%;
      }

      .btn-compact {
        padding: 7px 12px !important;
        font-size: 12px !important;
      }
    }

    @media (max-width: 360px) {
      .video-wrapper {
        width: 250px;
        height: 250px;
        border-radius: 12px;
      }

      .scanner-description {
        font-size: 10px;
        padding: 6px 10px;
      }

      .scanner-status {
        font-size: 12px;
        padding: 6px 10px;
      }
    }

    @media (min-width: 768px) {
      .video-wrapper {
        width: 400px;
        height: 400px;
      }

      .scanner-actions {
        flex-direction: row;
      }

      .scanner-actions .btn {
        flex: 1;
      }
    }

    @media (min-width: 1024px) {
      .video-wrapper {
        width: 450px;
        height: 450px;
      }

      .scanner-description {
        font-size: 12px;
        padding: 10px 16px;
      }

      .scanner-status {
        font-size: 14px;
        padding: 10px 16px;
      }
    }
`;
}
