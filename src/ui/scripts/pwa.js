/**
 * PWA (Progressive Web App) 功能模块
 * Service Worker 注册、PWA 检测、安装提示
 */

/**
 * 获取 PWA 相关代码
 * @returns {string} PWA JavaScript 代码
 */
export function getPWACode() {
	return `// ==================== PWA Service Worker 注册 ====================

    /**
     * 注册 Service Worker 以支持 PWA 和离线功能
     */
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', async () => {
        try {
          const registration = await navigator.serviceWorker.register('/sw.js', {
            scope: '/'
          });

          console.log('✅ Service Worker 注册成功:', registration.scope);

          // 监听更新（仅记录日志，不显示通知）
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            console.log('🔄 发现 Service Worker 更新');

            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('✨ 新的 Service Worker 已安装，下次访问时自动使用新版本');
              }
            });
          });

          // 监听控制器变化
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            console.log('🔄 Service Worker 控制器已更新');
          });

          // 📨 监听 Service Worker 消息（离线同步通知）
          navigator.serviceWorker.addEventListener('message', (event) => {
            console.log('[PWA] 收到 Service Worker 消息:', event.data);
            handleServiceWorkerMessage(event.data);
          });

          // 定期检查更新（每小时）
          setInterval(() => {
            registration.update().catch(err => {
              console.warn('检查 Service Worker 更新失败:', err);
            });
          }, 60 * 60 * 1000);

        } catch (error) {
          console.warn('⚠️  Service Worker 注册失败:', error);
          // PWA 功能不可用，但不影响应用正常运行
        }
      });
    } else {
      console.log('ℹ️  当前浏览器不支持 Service Worker');
    }

    /**
     * 处理 Service Worker 消息
     * @param {Object} message - 消息对象
     */
    function handleServiceWorkerMessage(message) {
      const { type } = message;

      switch (type) {
        case 'SYNC_SUCCESS':
          // 单个操作同步成功
          console.log('✅ 离线操作已同步:', message.operationType, message.operationId);
          // 刷新密钥列表
          if (typeof loadSecrets === 'function') {
            loadSecrets();
          }
          break;

        case 'SYNC_FAILED':
          // 单个操作同步失败
          console.error('❌ 离线操作同步失败:', message.operationType, message.error);
          showCenterToast('⚠️', \`同步失败: \${message.operationType}\`);
          break;

        case 'SYNC_COMPLETE':
          // 所有操作同步完成
          console.log(\`🎉 同步完成: 成功 \${message.successCount} 个, 失败 \${message.failCount} 个\`);

          if (message.successCount > 0) {
            showCenterToast('✅', \`已同步 \${message.successCount} 个离线操作\`);
            // 刷新密钥列表
            if (typeof loadSecrets === 'function') {
              loadSecrets();
            }
          }

          if (message.failCount > 0) {
            showCenterToast('⚠️', \`\${message.failCount} 个操作同步失败\`);
          }
          break;

        default:
          console.log('[PWA] 未知消息类型:', type);
      }
    }

    /**
     * 监听PWA安装提示事件
     * 仅保存事件，实际触发通过系统设置 › 偏好中的按钮
     */
    let deferredPrompt = null;
    window.addEventListener('beforeinstallprompt', (e) => {
      console.log('💡 PWA 安装提示事件触发');
      e.preventDefault();
      deferredPrompt = e;
      updateSettingsPwaInstallButton();
    });

    /**
     * 同步 系统设置 › 偏好 的 PWA 安装按钮状态
     * - PWA 模式下：隐藏整节
     * - 已捕获 beforeinstallprompt：启用按钮
     * - 未捕获：禁用并用 title 提示
     */
    function updateSettingsPwaInstallButton() {
      const section = document.getElementById('settingsPwaSection');
      const btn = document.getElementById('settingsPwaInstallBtn');
      if (!section || !btn) return;

      if (isPWAMode()) {
        section.style.display = 'none';
        return;
      }

      section.style.display = '';
      btn.textContent = '📱 安装到桌面';

      if (deferredPrompt) {
        btn.disabled = false;
        btn.title = '点击安装到桌面';
      } else {
        btn.disabled = true;
        btn.title = '暂不可用（浏览器未触发安装提示）';
      }
    }

    /**
     * 从 系统设置 触发 PWA 安装
     */
    async function triggerPwaInstallFromSettings() {
      const btn = document.getElementById('settingsPwaInstallBtn');
      if (!deferredPrompt) return;

      if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ 安装中…';
      }

      try {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(\`用户选择: \${outcome}\`);

        if (outcome === 'accepted') {
          showCenterToast('✅', '已发起安装');
        } else {
          showCenterToast('❌', '已取消安装');
        }
      } finally {
        deferredPrompt = null;
        updateSettingsPwaInstallButton();
      }
    }

    /**
     * 监听PWA安装成功事件
     */
    window.addEventListener('appinstalled', () => {
      console.log('✅ PWA 应用已成功安装');
      deferredPrompt = null;
      updateSettingsPwaInstallButton();
      showCenterToast('✅', '应用已安装到桌面');
    });

    /**
     * 检测是否在PWA模式下运行
     */
    function isPWAMode() {
      return window.matchMedia('(display-mode: standalone)').matches ||
             window.navigator.standalone === true;
    }

    if (isPWAMode()) {
      console.log('🚀 应用正在 PWA 模式下运行');
      // 可以根据PWA模式调整UI
    }

    /**
     * 监听在线/离线状态变化
     */
    window.addEventListener('online', () => {
      console.log('🌐 网络已连接');

      // 移除离线横幅
      document.body.classList.remove('offline-mode');
      const offlineBanner = document.getElementById('offline-banner');
      if (offlineBanner) {
        offlineBanner.classList.remove('show');
        setTimeout(() => offlineBanner.remove(), 300);
      }

      showCenterToast('🌐', '网络已恢复，正在同步...');

      // 手动触发同步（作为备用，如果 Background Sync 不可用）
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(registration => {
          if (registration.sync) {
            return registration.sync.register('sync-operations');
          }
        }).catch(err => {
          console.warn('手动触发同步失败:', err);
        });
      }
    });

    window.addEventListener('offline', () => {
      console.log('📡 网络已断开');

      // 添加离线横幅
      document.body.classList.add('offline-mode');
      showOfflineBanner();

      showCenterToast('📡', '已离线，操作将保存待同步');
    });

    /**
     * 显示离线横幅
     */
    function showOfflineBanner() {
      // 检查是否已经显示过
      if (document.getElementById('offline-banner')) {
        return;
      }

      // 创建离线横幅
      const banner = document.createElement('div');
      banner.id = 'offline-banner';
      banner.className = 'offline-banner';
      banner.innerHTML = \`
        <span class="offline-banner-icon">📡</span>
        <span class="offline-banner-text">离线模式 - 操作将在网络恢复后自动同步</span>
      \`;
      document.body.prepend(banner); // 添加到页面顶部

      // 添加显示动画
      setTimeout(() => banner.classList.add('show'), 100);
    }

    // 初始化时检查网络状态
    if (!navigator.onLine) {
      console.log('📡 应用启动时处于离线状态');
      document.body.classList.add('offline-mode');
      showOfflineBanner();
    }

    // ==================== 页面可见性处理 ====================
    // 解决手机切后台/锁屏后验证码不准确的问题
    
    /**
     * 当页面从后台切回前台时，刷新所有验证码
     * 原因：移动浏览器会暂停后台页面的定时器，导致验证码和倒计时不同步
     */
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        // 页面变为可见（从后台切回前台）
        console.log('📱 页面恢复可见，刷新所有验证码');
        
        // 立即刷新所有OTP验证码，确保时间同步
        if (typeof secrets !== 'undefined' && secrets && secrets.length > 0) {
          console.log('🔄 正在刷新 ' + secrets.length + ' 个验证码...');
          
          // 并发刷新所有验证码
          Promise.all(
            secrets.map(secret => {
              if (typeof updateOTP === 'function') {
                return updateOTP(secret.id);
              }
              return Promise.resolve();
            })
          ).then(() => {
            console.log('✅ 所有验证码已刷新完成');
          }).catch(err => {
            console.error('❌ 刷新验证码时出错:', err);
          });
        }
      } else {
        // 页面变为隐藏（切到后台）
        console.log('📱 页面进入后台');
      }
    });

    /**
     * 监听页面获得焦点事件（备用方案）
     * 某些浏览器在锁屏解锁时只会触发focus而不触发visibilitychange
     */
    window.addEventListener('focus', () => {
      console.log('📱 窗口获得焦点');
      
      // 延迟100ms执行，避免与visibilitychange重复
      setTimeout(() => {
        if (typeof secrets !== 'undefined' && secrets && secrets.length > 0) {
          console.log('🔄 窗口焦点恢复，检查并刷新验证码');
          
          secrets.forEach(secret => {
            if (typeof updateOTP === 'function') {
              updateOTP(secret.id);
            }
          });
        }
      }, 100);
    });

    /**
     * 监听页面失去焦点事件
     */
    window.addEventListener('blur', () => {
      console.log('📱 窗口失去焦点');
    });

    /**
     * 使用 Page Visibility API 监控页面活跃状态
     * 提供更详细的日志用于调试
     */
    if (typeof document.hidden !== 'undefined') {
      console.log('✅ Page Visibility API 已启用');
      console.log('📊 当前页面状态:', document.hidden ? '隐藏' : '可见');
    } else {
      console.warn('⚠️  浏览器不支持 Page Visibility API');
    }

`;
}
