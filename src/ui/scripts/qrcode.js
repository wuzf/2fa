/**
 * 二维码模块
 * 包含所有二维码生成、扫描和处理功能
 */

/**
 * 获取二维码相关代码
 * @returns {string} 二维码 JavaScript 代码
 */
export function getQRCodeCode() {
	return `    // ========== 二维码功能模块 ==========

    // 连续扫描模式状态
    let continuousScanMode = false;
    let continuousScanCount = 0;

    // 切换连续扫描模式
    function toggleContinuousScan() {
      const toggle = document.getElementById('continuousScanToggle');
      continuousScanMode = toggle.checked;

      // 更新计数器显示
      const counter = document.getElementById('scanCounter');
      if (continuousScanMode) {
        counter.style.display = 'block';
      } else {
        counter.style.display = 'none';
        continuousScanCount = 0;
        document.getElementById('scanCountNum').textContent = '0';
      }

      console.log('连续扫描模式:', continuousScanMode ? '开启' : '关闭');
    }

    // 更新扫描计数
    function updateScanCount() {
      continuousScanCount++;
      document.getElementById('scanCountNum').textContent = continuousScanCount;
    }

    // 显示二维码
    function showQRCode(secretId) {
      console.log('showQRCode called with secretId:', secretId);
      const secret = secrets.find(s => s.id === secretId);
      if (!secret) {
        console.log('Secret not found for id:', secretId);
        return;
      }
      console.log('Found secret:', secret.name);

      const serviceName = secret.name.trim();
      const accountName = secret.account ? secret.account.trim() : '';

      let label;
      if (accountName) {
        label = encodeURIComponent(serviceName) + ':' + encodeURIComponent(accountName);
      } else {
        label = encodeURIComponent(serviceName);
      }

      // 根据类型构建不同的参数
      const type = secret.type || 'TOTP';
      let params;

      switch (type.toUpperCase()) {
        case 'HOTP':
          params = new URLSearchParams({
            secret: secret.secret.toUpperCase(),
            issuer: serviceName,
            algorithm: secret.algorithm || 'SHA1',
            digits: (secret.digits || 6).toString(),
            counter: (secret.counter || 0).toString()
          });
          break;
        case 'TOTP':
        default:
          params = new URLSearchParams({
            secret: secret.secret.toUpperCase(),
            issuer: serviceName,
            algorithm: secret.algorithm || 'SHA1',
            digits: (secret.digits || 6).toString(),
            period: (secret.period || 30).toString()
          });
          break;
      }

      // 根据类型选择正确的scheme
      const scheme = type.toUpperCase() === 'HOTP' ? 'hotp' : 'totp';
      currentOTPAuthURL = 'otpauth://' + scheme + '/' + label + '?' + params.toString();

      document.getElementById('qrTitle').textContent = secret.name + ' 二维码';
      document.getElementById('qrSubtitle').textContent = secret.account ?
        '账户: ' + secret.account : '扫描此二维码导入到其他2FA应用';

      generateQRCodeForModal(currentOTPAuthURL);
      const modal = document.getElementById('qrModal');
      modal.style.display = 'flex';
      setTimeout(() => modal.classList.add('show'), 10);
      disableBodyScroll();
    }

    // 为模态框生成二维码
    async function generateQRCodeForModal(text) {
      const container = document.querySelector('.qr-code-container');
      container.innerHTML = '';

      // 显示加载状态
      const loadingDiv = document.createElement('div');
      loadingDiv.textContent = '🔄 生成中...';
      loadingDiv.style.cssText =
        'text-align: center;' +
        'padding: 80px 20px;' +
        'color: #7f8c8d;' +
        'font-size: 14px;';
      container.appendChild(loadingDiv);

      try {
        let qrDataURL = null;
        let generationMethod = 'unknown';

        console.log('开始生成二维码（客户端）...');

        // 使用客户端本地生成二维码（隐私安全）
        qrDataURL = await generateQRCodeDataURL(text, {
          width: 200,
          height: 200
        });
        generationMethod = 'client_local';

        // 创建图片元素
        const img = document.createElement('img');
        img.src = qrDataURL;
        img.alt = '2FA二维码';
        img.className = 'qr-code';
        img.style.cssText =
          'width: 200px;' +
          'height: 200px;' +
          'display: block;' +
          'margin: 0 auto;' +
          'border-radius: 8px;' +
          'background: white;';

        img.onload = function() {
          container.innerHTML = '';
          container.appendChild(img);
          console.log('二维码显示成功 - 生成方式:', generationMethod);
        };

        img.onerror = function() {
          console.error('二维码显示失败');
          container.innerHTML =
            '<div style="width: 200px; height: 200px; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #f8f9fa; border: 2px dashed #dee2e6; border-radius: 8px; text-align: center; font-size: 12px; color: #6c757d; line-height: 1.4;">' +
            '<div style="font-size: 24px; margin-bottom: 10px;">❌</div>' +
            '<div style="margin-bottom: 8px; font-weight: bold;">二维码生成失败</div>' +
            '<div style="margin-bottom: 8px;">请检查网络连接</div>' +
            '<div>或稍后重试</div>' +
            '</div>';
        };

      } catch (error) {
        console.error('二维码生成过程发生错误:', error);
        container.innerHTML =
          '<div style="width: 200px; height: 200px; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #f8f9fa; border: 2px dashed #dee2e6; border-radius: 8px; text-align: center; font-size: 12px; color: #6c757d; line-height: 1.4;">' +
          '<div style="font-size: 24px; margin-bottom: 10px;">⚠️</div>' +
          '<div style="margin-bottom: 8px; font-weight: bold;">生成失败</div>' +
          '<div style="margin-bottom: 8px;">发生未知错误</div>' +
          '<div>' + error.message + '</div>' +
          '</div>';
      }
    }

    // 显示二维码扫描器
    function showQRScanner() {
      const modal = document.getElementById('qrScanModal');
      modal.style.display = 'flex';
      setTimeout(() => modal.classList.add('show'), 10);

      // 重置连续扫描状态
      continuousScanMode = false;
      continuousScanCount = 0;
      const toggle = document.getElementById('continuousScanToggle');
      if (toggle) toggle.checked = false;
      const counter = document.getElementById('scanCounter');
      if (counter) {
        counter.style.display = 'none';
        document.getElementById('scanCountNum').textContent = '0';
      }

      startQRScanner();
      disableBodyScroll();
    }

    // 隐藏二维码扫描器
    function hideQRScanner() {
      const modal = document.getElementById('qrScanModal');
      modal.classList.remove('show');
      setTimeout(() => modal.style.display = 'none', 300);
      stopQRScanner();
      enableBodyScroll();

      // 重置连续扫描状态
      continuousScanMode = false;
      continuousScanCount = 0;
      const toggle = document.getElementById('continuousScanToggle');
      if (toggle) toggle.checked = false;
      const counter = document.getElementById('scanCounter');
      if (counter) {
        counter.style.display = 'none';
        document.getElementById('scanCountNum').textContent = '0';
      }

      // 重置文件输入框，确保下次可以选择同一个文件
      const fileInput = document.getElementById('qrImageInput');
      if (fileInput) {
        fileInput.value = '';
      }
    }

    // 启动二维码扫描器
    async function startQRScanner() {
      const video = document.getElementById('scannerVideo');
      const status = document.getElementById('scannerStatus');
      const error = document.getElementById('scannerError');

      try {
        error.style.display = 'none';
        status.textContent = '正在启动摄像头...';
        status.style.display = 'block';

        // 检查浏览器支持 - 增强iPad兼容性
        if (!navigator.mediaDevices) {
          // 尝试 polyfill for older browsers
          if (navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia) {
            // 为旧版浏览器创建 polyfill
            navigator.mediaDevices = {};
            navigator.mediaDevices.getUserMedia = function(constraints) {
              const getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
              if (!getUserMedia) {
                return Promise.reject(new Error('getUserMedia is not implemented in this browser'));
              }
              return new Promise((resolve, reject) => {
                getUserMedia.call(navigator, constraints, resolve, reject);
              });
            };
          } else {
            throw new Error('您的浏览器不支持摄像头功能，请使用现代浏览器');
          }
        }

        if (!navigator.mediaDevices.getUserMedia) {
          throw new Error('您的浏览器不支持摄像头功能，请使用现代浏览器');
        }

        // iPad 特殊处理：检查设备类型和权限
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const isIPad = /iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

        console.log('设备检测:', {
          userAgent: navigator.userAgent,
          isIOS,
          isIPad,
          platform: navigator.platform,
          maxTouchPoints: navigator.maxTouchPoints
        });

        // 停止之前的流（如果存在）
        if (scanStream) {
          scanStream.getTracks().forEach(track => track.stop());
          scanStream = null;
        }

        // 尝试不同的摄像头配置 - iPad 优化
        let configs;

        if (isIPad || isIOS) {
          // iPad/iOS 特殊配置
          configs = [
            {
              video: {
                facingMode: 'environment',
                width: { ideal: 640, max: 1280 },  // 降低分辨率要求
                height: { ideal: 480, max: 720 }
              }
            },
            {
              video: {
                facingMode: 'user',
                width: { ideal: 480, max: 640 },
                height: { ideal: 360, max: 480 }
              }
            },
            {
              video: {
                width: { ideal: 640 },
                height: { ideal: 480 }
              }
            },
            {
              video: true  // 最简单的配置
            }
          ];
        } else {
          // 其他设备的标准配置
          configs = [
            {
              video: {
                facingMode: 'environment', // 后置摄像头
                width: { ideal: 1280, max: 1920 },
                height: { ideal: 720, max: 1080 }
              }
            },
            {
              video: {
                facingMode: 'user', // 前置摄像头
                width: { ideal: 640 },
                height: { ideal: 480 }
              }
            },
            {
              video: true // 默认摄像头
            }
          ];
        }

        let stream = null;
        for (let i = 0; i < configs.length; i++) {
          try {
            console.log('尝试摄像头配置:', configs[i]);
            stream = await navigator.mediaDevices.getUserMedia(configs[i]);
            console.log('摄像头配置成功');
            break;
          } catch (e) {
            console.warn('摄像头配置 ' + (i + 1) + ' 失败:', e.message);
            if (i === configs.length - 1) {
              throw e; // 最后一个配置也失败了，抛出错误
            }
          }
        }

        if (!stream) {
          throw new Error('无法获取摄像头访问权限');
        }

        scanStream = stream;
        video.srcObject = scanStream;

        // 等待视频加载并播放
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('摄像头加载超时'));
          }, 10000);

          video.onloadedmetadata = () => {
            clearTimeout(timeout);
            video.play()
              .then(() => {
                console.log('摄像头启动成功，分辨率:', video.videoWidth + 'x' + video.videoHeight);
                resolve();
              })
              .catch(reject);
          };

          video.onerror = () => {
            clearTimeout(timeout);
            reject(new Error('摄像头播放失败'));
          };
        });

        status.textContent = '';
        status.style.display = 'none';
        isScanning = true;

        // 创建画布用于分析图像
        if (!scannerCanvas) {
          scannerCanvas = document.createElement('canvas');
          scannerContext = scannerCanvas.getContext('2d');
          console.log('画布创建成功');
        }

        // 延迟开始扫描，确保视频稳定
        setTimeout(() => {
          if (isScanning) {
            console.log('开始二维码扫描循环');
            scanForQRCode();
          }
        }, 500);

      } catch (err) {
        console.error('启动摄像头失败:', err);
        console.error('错误详情:', {
          name: err.name,
          message: err.message,
          userAgent: navigator.userAgent,
          isSecure: location.protocol === 'https:',
          mediaDevicesSupport: !!navigator.mediaDevices,
          getUserMediaSupport: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
        });

        let errorMsg = '摄像头启动失败: ' + err.message;

        // iPad 特殊错误处理
        const isIPad = /iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

        if (err.name === 'NotAllowedError') {
          if (isIPad) {
            errorMsg = 'iPad 摄像头权限被拒绝。请在 Safari 设置中允许摄像头访问，或尝试在地址栏点击"aA"图标允许摄像头权限';
          } else {
            errorMsg = '摄像头权限被拒绝，请在浏览器设置中允许摄像头访问';
          }
        } else if (err.name === 'NotFoundError') {
          if (isIPad) {
            errorMsg = 'iPad 未找到摄像头设备，请确保在系统设置中允许浏览器访问摄像头';
          } else {
            errorMsg = '未找到摄像头设备，请确保设备连接正常';
          }
        } else if (err.name === 'NotReadableError') {
          if (isIPad) {
            errorMsg = 'iPad 摄像头被其他应用占用，请关闭其他摄像头应用后重试';
          } else {
            errorMsg = '摄像头被其他应用占用，请关闭其他摄像头应用';
          }
        } else if (err.name === 'OverconstrainedError') {
          if (isIPad) {
            errorMsg = 'iPad 摄像头不支持请求的配置，正在尝试兼容模式...';
          } else {
            errorMsg = '摄像头不支持请求的配置，请尝试其他设备';
          }
        } else if (err.message.includes('getUserMedia is not implemented')) {
          errorMsg = '您的浏览器版本过旧，请更新到最新版本的 Safari 或 Chrome';
        } else if (location.protocol !== 'https:') {
          errorMsg = '摄像头功能需要HTTPS协议，请使用 https:// 访问';
        }

        showScannerError(errorMsg);
      }
    }

    // 停止二维码扫描器
    function stopQRScanner() {
      isScanning = false;
      if (scanInterval) {
        clearInterval(scanInterval);
        scanInterval = null;
      }
      if (scanStream) {
        scanStream.getTracks().forEach(track => track.stop());
        scanStream = null;
      }
    }

    // 重试启动摄像头
    function retryCamera() {
      document.getElementById('scannerError').style.display = 'none';
      startQRScanner();
    }

    // 显示扫描器错误
    function showScannerError(message) {
      const error = document.getElementById('scannerError');
      const errorMessage = document.getElementById('errorMessage');
      const status = document.getElementById('scannerStatus');

      status.style.display = 'none';
      errorMessage.textContent = message;
      error.style.display = 'block';
    }

    // 扫描二维码
    function scanForQRCode() {
      if (!isScanning) return;

      const video = document.getElementById('scannerVideo');
      const status = document.getElementById('scannerStatus');

      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        try {
          // 设置画布尺寸
          const videoWidth = video.videoWidth;
          const videoHeight = video.videoHeight;

          if (videoWidth > 0 && videoHeight > 0) {
            scannerCanvas.width = videoWidth;
            scannerCanvas.height = videoHeight;

            // 绘制当前帧到画布
            scannerContext.drawImage(video, 0, 0, videoWidth, videoHeight);

            // 获取图像数据
            const imageData = scannerContext.getImageData(0, 0, videoWidth, videoHeight);

            // 尝试解析二维码
            const qrCode = decodeQRCode(imageData);

            if (qrCode) {
              console.log('二维码扫描成功!');
              processScannedQRCode(qrCode);
              return;
            }
          }
        } catch (error) {
          console.error('扫描过程出错:', error);
        }
      } else {
        // 视频还未准备好
        status.textContent = '正在加载摄像头...';
      }

      // 继续扫描（提高频率到60fps）
      requestAnimationFrame(scanForQRCode);
    }

    // 使用jsQR库进行二维码解码
    function decodeQRCode(imageData) {
      try {
        // 检查jsQR库是否已加载
        if (typeof jsQR === 'undefined') {
          console.warn('jsQR库未加载，无法解析二维码');
          return null;
        }

        // 使用jsQR库进行解析
        const qrResult = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: "dontInvert", // 提高性能
        });

        if (qrResult && qrResult.data) {
          console.log('二维码解析成功:', qrResult.data);
          return qrResult.data;
        }

        return null;
      } catch (error) {
        console.error('二维码解析失败:', error);
        return null;
      }
    }

    // 处理扫描到的二维码
    function processScannedQRCode(qrCodeData) {
      try {
        console.log('扫描到二维码:', qrCodeData);

        // 检查是否是 Google Authenticator 迁移格式
        if (qrCodeData.startsWith('otpauth-migration://')) {
          processGoogleMigration(qrCodeData);
          return;
        }

        // 检查是否是有效的 OTP Auth URL
        if (!qrCodeData.startsWith('otpauth://totp/') && !qrCodeData.startsWith('otpauth://hotp/')) {
          showScannerError('这不是有效的2FA二维码');
          return;
        }

        // 解析 OTP Auth URL
        const url = new URL(qrCodeData);
        const pathParts = url.pathname.substring(1).split(':');
        const params = new URLSearchParams(url.search);

        // 对URL编码的部分进行解码
        const issuer = decodeURIComponent(params.get('issuer') || (pathParts.length > 1 ? pathParts[0] : ''));
        const account = decodeURIComponent(pathParts.length > 1 ? pathParts[1] : pathParts[0]);
        const secret = params.get('secret');

        // 解析类型和高级参数
        const urlType = url.protocol.replace(':', '').split('//')[1]; // 提取协议后的类型
        let type = 'TOTP';
        if (urlType === 'hotp') {
          type = 'HOTP';
        }

        const digits = parseInt(params.get('digits')) || 6;
        const period = parseInt(params.get('period')) || 30;
        const algorithm = params.get('algorithm') || 'SHA1';
        const counter = parseInt(params.get('counter')) || 0;

        if (!secret) {
          showScannerError('二维码中缺少密钥信息');
          return;
        }

        // 直接保存密钥（不显示编辑界面）
        // 连续扫描模式下不关闭扫描器，在保存成功后继续扫描
        directSaveFromQR(issuer, account, secret, { type, digits, period, algorithm, counter });

      } catch (error) {
        console.error('解析二维码失败:', error);
        showScannerError('解析二维码失败: ' + error.message);
      }
    }

    // 直接保存扫描到的密钥（不显示编辑界面）
    async function directSaveFromQR(issuer, account, secret, options = {}) {
      const newSecret = {
        name: issuer || account || '未命名',
        account: account || '',
        secret: secret.toUpperCase(),
        type: options.type || 'TOTP',
        digits: options.digits || 6,
        period: options.period || 30,
        algorithm: options.algorithm || 'SHA1',
        counter: options.counter || 0
      };

      try {
        showCenterToast('⏳', '正在保存...');

        const response = await authenticatedFetch('/api/secrets', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(newSecret)
        });

        if (response.ok) {
          const result = await response.json();
          console.log('密钥保存成功:', result);
          showCenterToast('✅', '密钥添加成功：' + newSecret.name);
          // 刷新密钥列表
          loadSecrets();

          // 连续扫描模式处理
          if (continuousScanMode) {
            // 更新计数
            updateScanCount();
            // 继续扫描（延迟一下让用户看到提示）
            setTimeout(() => {
              if (isScanning && continuousScanMode) {
                console.log('连续扫描模式：继续扫描下一个二维码');
                scanForQRCode();
              }
            }, 800);
          } else {
            // 非连续模式，关闭扫描器
            hideQRScanner();
          }
        } else {
          const errorText = await response.text();
          console.error('保存密钥失败:', response.status, errorText);
          // 解析错误信息，只显示简短提示
          let errorMsg = '保存失败';
          try {
            const errorJson = JSON.parse(errorText);
            if (response.status === 409) {
              errorMsg = '"' + newSecret.name + '"已存在';
            } else {
              errorMsg = errorJson.error || errorJson.message || errorText;
            }
          } catch (e) {
            errorMsg = errorText;
          }
          showCenterToast('❌', errorMsg);
          // 失败时也继续扫描（如果是连续模式）
          if (continuousScanMode && isScanning) {
            setTimeout(() => scanForQRCode(), 1000);
          }
        }
      } catch (error) {
        console.error('保存密钥出错:', error);
        showCenterToast('❌', '保存出错：' + error.message);
        // 出错时也继续扫描（如果是连续模式）
        if (continuousScanMode && isScanning) {
          setTimeout(() => scanForQRCode(), 1000);
        }
      }
    }

    // 上传图片扫描二维码
    function uploadImageForScan() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = function(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(e) {
          const img = new Image();
          img.onload = function() {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

            if (typeof jsQR !== 'undefined') {
              const code = jsQR(imageData.data, imageData.width, imageData.height);

              if (code) {
                hideQRScanner();
                processScannedQRCode(code.data);
              } else {
                showCenterToast('❌', '未在图片中找到二维码，请尝试其他图片');
              }
            } else {
              showCenterToast('❌', '二维码解析库未加载');
            }
          };
          img.src = e.target.result;
        };
        reader.readAsDataURL(file);
      };
      input.click();
    }

    // 处理图片上传和解析
    function handleImageUpload(event) {
      const file = event.target.files[0];
      if (!file) {
        console.log('没有选择文件');
        return;
      }

      console.log('选择了文件:', file.name, file.type, file.size);

      // 检查文件类型
      if (!file.type.startsWith('image/')) {
        showScannerError('请选择图片文件（支持 JPG、PNG、GIF、WebP 等格式）');
        return;
      }

      // 检查文件大小（限制为10MB）
      if (file.size > 10 * 1024 * 1024) {
        showScannerError('图片文件过大，请选择小于10MB的图片');
        return;
      }

      // 显示加载状态
      const status = document.getElementById('scannerStatus');
      const error = document.getElementById('scannerError');
      const originalText = status.textContent;

      status.textContent = '正在分析图片...';
      status.style.display = 'block';
      status.style.color = '#17a2b8';
      error.style.display = 'none';

      console.log('开始处理图片文件...');

      // 创建 FileReader
      const reader = new FileReader();

      reader.onload = function(e) {
        console.log('FileReader加载完成');

        try {
          // 创建图片元素
          const img = new Image();

          img.onload = function() {
            console.log('图片加载成功，尺寸:', img.width + 'x' + img.height);

            try {
              // 检查jsQR库是否可用
              if (typeof jsQR === 'undefined') {
                throw new Error('二维码解析库未加载，请刷新页面重试');
              }

              // 创建 canvas 来处理图片
              const canvas = document.createElement('canvas');
              const ctx = canvas.getContext('2d');

              // 限制最大尺寸以提高性能
              let { width, height } = img;
              const maxSize = 1000;

              if (width > maxSize || height > maxSize) {
                const ratio = Math.min(maxSize / width, maxSize / height);
                width = Math.floor(width * ratio);
                height = Math.floor(height * ratio);
                console.log('缩放图片到:', width + 'x' + height);
              }

              // 设置 canvas 尺寸
              canvas.width = width;
              canvas.height = height;

              // 将图片绘制到 canvas
              ctx.drawImage(img, 0, 0, width, height);

              // 获取图像数据
              const imageData = ctx.getImageData(0, 0, width, height);
              console.log('获取图像数据成功，像素数:', imageData.data.length / 4);

              // 尝试解析二维码（多种配置）
              status.textContent = '正在解析二维码...';

              let qrCode = null;

              // 尝试不同的解析选项
              const parseOptions = [
                { inversionAttempts: "dontInvert" },
                { inversionAttempts: "onlyInvert" },
                { inversionAttempts: "attemptBoth" },
                { inversionAttempts: "attemptBoth", margin: 5 }
              ];

              for (let i = 0; i < parseOptions.length && !qrCode; i++) {
                try {
                  console.log('尝试解析选项 ' + (i + 1) + ':', parseOptions[i]);
                  const result = jsQR(imageData.data, imageData.width, imageData.height, parseOptions[i]);
                  if (result && result.data) {
                    qrCode = result.data;
                    console.log('二维码解析成功（选项 ' + (i + 1) + '）:', qrCode);
                    break;
                  }
                } catch (parseError) {
                  console.warn('解析选项 ' + (i + 1) + ' 失败:', parseError);
                }
              }

              if (qrCode) {
                status.textContent = '二维码解析成功！';
                status.style.color = '#4CAF50';

                console.log('成功解析到二维码:', qrCode);

                // 处理解析到的二维码
                setTimeout(() => {
                  processScannedQRCode(qrCode);
                }, 1000);
              } else {
                console.log('未找到二维码');
                showScannerError('未在图片中找到有效的二维码' + '\\n\\n' + '请确保：' + '\\n' + '• 图片清晰度足够' + '\\n' + '• 二维码完整可见' + '\\n' + '• 包含有效的2FA二维码');
              }
            } catch (error) {
              console.error('图片处理失败:', error);
              showScannerError('图片处理失败: ' + error.message);
            }
          };

          img.onerror = function() {
            console.error('图片加载失败');
            showScannerError('图片加载失败，请选择有效的图片文件' + '\\n' + '支持格式：JPG、PNG、GIF、WebP');
          };

          // 设置图片源
          img.src = e.target.result;

        } catch (error) {
          console.error('图片读取失败:', error);
          showScannerError('图片读取失败: ' + error.message);
        }
      };

      reader.onerror = function() {
        console.error('FileReader读取失败');
        showScannerError('文件读取失败，请重试');
      };

      reader.onprogress = function(e) {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          status.textContent = '正在加载图片... ' + percent + '%';
        }
      };

      // 读取文件为 data URL
      reader.readAsDataURL(file);

      // 清空文件输入，允许重复选择同一文件
      event.target.value = '';
    }
`;
}
