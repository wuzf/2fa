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

    function showQRDecodeModal() {
      showModal('qrDecodeModal', () => {
        document.getElementById('decodeScannerContainer').style.display = 'none';
        document.getElementById('decodeResultSection').style.display = 'none';
        document.getElementById('decodeQRSection').style.display = 'none';
      });
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
      status.textContent = '正在启动摄像头...';
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
          throw new Error('无法获取摄像头访问权限');
        }

        decodeStream = stream;
        video.srcObject = decodeStream;

        // 等待视频加载并播放
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('摄像头加载超时'));
          }, 10000);

          video.onloadedmetadata = () => {
            clearTimeout(timeout);
            video.play()
              .then(resolve)
              .catch(reject);
          };

          video.onerror = () => {
            clearTimeout(timeout);
            reject(new Error('摄像头播放失败'));
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
        let errorMsg = '摄像头启动失败: ' + err.message;

        if (err.name === 'NotAllowedError') {
          errorMsg = '摄像头权限被拒绝，请在浏览器设置中允许摄像头访问';
        } else if (err.name === 'NotFoundError') {
          errorMsg = '未找到摄像头设备，请确保设备连接正常';
        } else if (err.name === 'NotReadableError') {
          errorMsg = '摄像头被其他应用占用，请关闭其他摄像头应用';
        } else if (err.name === 'OverconstrainedError') {
          errorMsg = '摄像头不支持请求的配置，请尝试其他设备';
        }

        errorMessage.textContent = errorMsg;
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

      showCenterToast('✅', '二维码解析成功');
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
                processDecodeResult(code.data);
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

    async function copyDecodeResult() {
      const content = document.getElementById('decodeResultContent').textContent;
      if (!content) {
        showCenterToast('❌', '没有可复制的内容');
        return;
      }

      try {
        await navigator.clipboard.writeText(content);
        showCenterToast('✅', '内容已复制到剪贴板');
      } catch (error) {
        showCenterToast('❌', '复制失败');
      }
    }

    async function generateDecodeQRCode() {
      const content = document.getElementById('decodeResultContent').textContent;
      if (!content) {
        showCenterToast('❌', '没有可生成二维码的内容');
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
          showCenterToast('❌', '二维码生成失败');
        };

      } catch (error) {
        console.error('二维码生成过程发生错误:', error);
        showCenterToast('❌', '二维码生成失败: ' + error.message);
      }
    }

`;
}
