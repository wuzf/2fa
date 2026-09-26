/**
 * 二维码解析工具模块
 */

/**
 * 获取二维码解析工具代码
 * @returns {string} 二维码解析工具 JavaScript 代码
 */
export function getQRDecodeToolCode() {
	return `    // ==================== 二维码解析工具 ====================

    let decodeStream = null;
    let decodeInterval = null;
    let isDecodeScanning = false;
    let _decodeCameraError = null;

    function _newDecodeCameraError(key) {
      const error = new Error(t(key));
      error.i18nKey = key;
      return error;
    }

    function _decodeCameraErrorText(error) {
      const keys = {
        NotAllowedError: 'toolCameraDenied',
        NotFoundError: 'toolCameraMissing',
        NotReadableError: 'toolCameraBusy',
        OverconstrainedError: 'toolCameraConstraints'
      };
      if (keys[error.name]) return t(keys[error.name]);
      return t('toolCameraStartError', { message: error.i18nKey ? t(error.i18nKey) : error.message });
    }

    function _refreshDecodeCameraTranslations() {
      const status = document.getElementById('decodeScannerStatus');
      if (status && status.style.display !== 'none') status.textContent = t('scannerStarting');
      const message = document.getElementById('decodeErrorMessage');
      if (message && _decodeCameraError) message.textContent = _decodeCameraErrorText(_decodeCameraError);
    }

    function showQRDecodeModal() {
      showModal('qrDecodeModal', () => {
        document.getElementById('decodeScannerContainer').style.display = 'none';
        document.getElementById('decodeResultSection').style.display = 'none';
        document.getElementById('decodeQRSection').style.display = 'none';
      });
      initDecodeModalDragPaste();
    }

    function hideQRDecodeModal() {
      hideModal('qrDecodeModal', () => {
        stopDecodeScanner();
      });
    }

    function startQRDecodeScanner() {
      const container = document.getElementById('decodeScannerContainer');
      const status = document.getElementById('decodeScannerStatus');
      const error = document.getElementById('decodeScannerError');

      container.style.display = 'block';
      error.style.display = 'none';
      _decodeCameraError = null;
      status.textContent = t('scannerStarting');
      status.style.display = 'block';

      startDecodeCamera();
    }

    async function startDecodeCamera() {
      const video = document.getElementById('decodeScannerVideo');
      const status = document.getElementById('decodeScannerStatus');
      const error = document.getElementById('decodeScannerError');
      const errorMessage = document.getElementById('decodeErrorMessage');

      try {
        // 检查浏览器支持 - 增强iPad兼容性
        if (!navigator.mediaDevices) {
          // 尝试 polyfill for older browsers
          if (navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia) {
            // 为旧版浏览器创建 polyfill
            navigator.mediaDevices = {};
            navigator.mediaDevices.getUserMedia = function(constraints) {
              const getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
              if (!getUserMedia) {
                return Promise.reject(_newDecodeCameraError('toolCameraUnsupported'));
              }
              return new Promise((resolve, reject) => {
                getUserMedia.call(navigator, constraints, resolve, reject);
              });
            };
          } else {
            throw _newDecodeCameraError('toolCameraUnsupported');
          }
        }

        if (!navigator.mediaDevices.getUserMedia) {
          throw _newDecodeCameraError('toolCameraUnsupported');
        }

        // iPad 特殊处理：检查设备类型和权限
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const isIPad = /iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

        console.log('工具模块设备检测:', {
          userAgent: navigator.userAgent,
          isIOS,
          isIPad,
          platform: navigator.platform,
          maxTouchPoints: navigator.maxTouchPoints
        });

        // 停止之前的流（如果存在）
        if (decodeStream) {
          decodeStream.getTracks().forEach(track => track.stop());
          decodeStream = null;
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
                facingMode: 'environment',
                width: { ideal: 1280, max: 1920 },
                height: { ideal: 720, max: 1080 }
              }
            },
            {
              video: {
                facingMode: 'user',
                width: { ideal: 640 },
                height: { ideal: 480 }
              }
            },
            {
              video: true
            }
          ];
        }

        let stream = null;
        for (let i = 0; i < configs.length; i++) {
          try {
            stream = await navigator.mediaDevices.getUserMedia(configs[i]);
            break;
          } catch (e) {
            if (i === configs.length - 1) {
              throw e;
            }
          }
        }

        if (!stream) {
          throw _newDecodeCameraError('toolCameraAccess');
        }

        decodeStream = stream;
        video.srcObject = decodeStream;

        // 等待视频加载并播放
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(_newDecodeCameraError('toolCameraTimeout'));
          }, 10000);

          video.onloadedmetadata = () => {
            clearTimeout(timeout);
            video.play()
              .then(resolve)
              .catch(reject);
          };

          video.onerror = () => {
            clearTimeout(timeout);
            reject(_newDecodeCameraError('toolCameraPlayback'));
          };
        });

        status.textContent = '';
        status.style.display = 'none';
        isDecodeScanning = true;

        // 开始扫描
        setTimeout(() => {
          if (isDecodeScanning) {
            scanForDecodeQRCode();
          }
        }, 500);

      } catch (err) {
        _decodeCameraError = err;
        errorMessage.textContent = _decodeCameraErrorText(err);
        error.style.display = 'block';
        status.style.display = 'none';
      }
    }

    function stopDecodeScanner() {
      isDecodeScanning = false;
      if (decodeInterval) {
        clearInterval(decodeInterval);
        decodeInterval = null;
      }
      if (decodeStream) {
        decodeStream.getTracks().forEach(track => track.stop());
        decodeStream = null;
      }
    }

    function retryDecodeCamera() {
      document.getElementById('decodeScannerError').style.display = 'none';
      startDecodeCamera();
    }

    function scanForDecodeQRCode() {
      if (!isDecodeScanning) return;

      const video = document.getElementById('decodeScannerVideo');
      const status = document.getElementById('decodeScannerStatus');

      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');

          const videoWidth = video.videoWidth;
          const videoHeight = video.videoHeight;

          if (videoWidth > 0 && videoHeight > 0) {
            canvas.width = videoWidth;
            canvas.height = videoHeight;

            ctx.drawImage(video, 0, 0, videoWidth, videoHeight);

            const imageData = ctx.getImageData(0, 0, videoWidth, videoHeight);
            const qrCode = decodeQRCode(imageData);

            if (qrCode) {
              console.log('二维码解析成功:', qrCode);
              processDecodeResult(qrCode);
              return;
            }
          }
        } catch (error) {
          console.error('扫描过程出错:', error);
        }
      }

      requestAnimationFrame(scanForDecodeQRCode);
    }

    function processDecodeResult(qrCodeData) {
      // 停止扫描
      stopDecodeScanner();
      document.getElementById('decodeScannerContainer').style.display = 'none';

      // 显示结果
      const resultContent = document.getElementById('decodeResultContent');
      const resultSection = document.getElementById('decodeResultSection');

      resultContent.textContent = qrCodeData;
      resultSection.style.display = 'block';

      showCenterToast('✅', t('toolQrDecoded'));
    }

    function uploadImageForDecode() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = function(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(e) {
          const img = new Image();
          img.onload = async function() {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

            if (typeof jsQR === 'undefined') {
              try { await ensureJsQR(); } catch (_) {}
            }
            if (typeof jsQR !== 'undefined') {
              const code = jsQR(imageData.data, imageData.width, imageData.height);

              if (code) {
                processDecodeResult(code.data);
              } else {
                showCenterToast('❌', t('toolQrNotFound'));
              }
            } else {
              showCenterToast('❌', t('toolQrLibraryMissing'));
            }
          };
          img.src = e.target.result;
        };
        reader.readAsDataURL(file);
      };
      input.click();
    }

    async function copyDecodeResult() {
      const content = document.getElementById('decodeResultContent').textContent;
      if (!content) {
        showCenterToast('❌', t('toolNothingToCopy'));
        return;
      }

      try {
        await navigator.clipboard.writeText(content);
        showCenterToast('✅', t('toolContentCopied'));
      } catch (error) {
        showCenterToast('❌', t('copyFailed'));
      }
    }

    async function generateDecodeQRCode() {
      const content = document.getElementById('decodeResultContent').textContent;
      if (!content) {
        showCenterToast('❌', t('toolNoQrContent'));
        return;
      }

      const qrImage = document.getElementById('decodeQRCode');

      try {
        let qrDataURL = null;
        let generationMethod = 'unknown';

        // 使用客户端本地生成二维码（隐私安全）
        qrDataURL = await generateQRCodeDataURL(content, {
          width: 200,
          height: 200
        });
        generationMethod = 'client_local';

        qrImage.src = qrDataURL;
        qrImage.onload = function() {
          document.getElementById('decodeQRSection').style.display = 'block';
        };
        qrImage.onerror = function() {
          showCenterToast('❌', t('toolQrGenerateFailed'));
        };

      } catch (error) {
        console.error('二维码生成过程发生错误:', error);
        showCenterToast('❌', t('toolQrGenerateError', { message: error.message }));
      }
    }

    // ========== 剪贴板粘贴识别二维码（解析工具） ==========

    async function pasteImageForDecode() {
      try {
        const clipboardItems = await navigator.clipboard.read();
        let imageBlob = null;

        for (const item of clipboardItems) {
          const imageType = item.types.find(t => t.startsWith('image/'));
          if (imageType) {
            imageBlob = await item.getType(imageType);
            break;
          }
        }

        if (!imageBlob) {
          showCenterToast('❌', t('toolClipboardNoImage'));
          return;
        }

        processImageBlobForDecode(imageBlob);
      } catch (error) {
        if (error.name === 'NotAllowedError') {
          showCenterToast('❌', t('toolClipboardDenied'));
        } else {
          showCenterToast('❌', t('toolClipboardError', { message: error.message }));
        }
      }
    }

    function processImageBlobForDecode(blob) {
      const reader = new FileReader();
      reader.onload = function(e) {
        const img = new Image();
        img.onload = async function() {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');

          let { width, height } = img;
          const maxSize = 1000;
          if (width > maxSize || height > maxSize) {
            const ratio = Math.min(maxSize / width, maxSize / height);
            width = Math.floor(width * ratio);
            height = Math.floor(height * ratio);
          }

          canvas.width = width;
          canvas.height = height;
          ctx.drawImage(img, 0, 0, width, height);

          const imageData = ctx.getImageData(0, 0, width, height);

          if (typeof jsQR === 'undefined') {
            try { await ensureJsQR(); } catch (_) {}
          }
          if (typeof jsQR === 'undefined') {
            showCenterToast('❌', t('toolQrLibraryMissing'));
            return;
          }

          const parseOptions = [
            { inversionAttempts: "dontInvert" },
            { inversionAttempts: "onlyInvert" },
            { inversionAttempts: "attemptBoth" }
          ];

          let qrCode = null;
          for (const opt of parseOptions) {
            const result = jsQR(imageData.data, imageData.width, imageData.height, opt);
            if (result && result.data) {
              qrCode = result.data;
              break;
            }
          }

          if (qrCode) {
            processDecodeResult(qrCode);
          } else {
            showCenterToast('❌', t('toolQrNotFound'));
          }
        };
        img.onerror = function() {
          showCenterToast('❌', t('toolImageLoadFailed'));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(blob);
    }

    // 初始化解析模态框的拖拽和粘贴事件
    function initDecodeModalDragPaste() {
      const modal = document.getElementById('qrDecodeModal');
      if (!modal || modal.dataset.dragPasteInit) return;
      modal.dataset.dragPasteInit = 'true';

      // 拖拽事件
      modal.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.stopPropagation();
        modal.classList.add('drag-over');
      });

      modal.addEventListener('dragleave', function(e) {
        e.preventDefault();
        e.stopPropagation();
        if (!modal.contains(e.relatedTarget)) {
          modal.classList.remove('drag-over');
        }
      });

      modal.addEventListener('drop', function(e) {
        e.preventDefault();
        e.stopPropagation();
        modal.classList.remove('drag-over');

        const files = e.dataTransfer.files;
        if (files.length > 0 && files[0].type.startsWith('image/')) {
          processImageBlobForDecode(files[0]);
        } else {
          showCenterToast('❌', t('toolDropImage'));
        }
      });

      // Ctrl+V 粘贴事件（仅处理解析工具模态框）
      document.addEventListener('paste', function(e) {
        if (!modal.classList.contains('show')) return;

        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;

        for (const item of items) {
          if (item.type.startsWith('image/')) {
            e.preventDefault();
            const blob = item.getAsFile();
            if (blob) processImageBlobForDecode(blob);
            return;
          }
        }
      });
    }

`;
}
