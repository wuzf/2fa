// 常量定义
const TIME_STEP = 30; // TOTP时间步长（秒）
const OTP_LENGTH = 6; // OTP长度

// 添加事件监听器
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

// 处理请求的主要函数
async function handleRequest(request) {
  try {
    // 使用 new URL(request.url) 创建 URL 对象
    const url = new URL(request.url);

    // 从路径中提取密钥
    const secret = url.pathname.substring(1);

    // 检查密钥是否存在
    if (!secret) {
      const currentOrigin = url.origin; // 包含协议、域名和端口
      return new Response(`Missing secret parameter!\n\nUsage: ${currentOrigin}/YOUR_SECRET_KEY\nExample: ${currentOrigin}/JBSWY3DPEHPK3PXP\n\nAPI Mode: ${currentOrigin}/YOUR_SECRET_KEY?format=json`, { status: 400 });
    }

    // 生成 OTP
    const otp = await generateOTP(secret);

    // 计算剩余时间
    const remainingTime = calculateRemainingTime();

    // 检查是否请求JSON格式
    const format = url.searchParams.get('format');
    if (format === 'json') {
      return new Response(JSON.stringify({
        token: otp
      }, null, 2), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // 构建 HTML 页面
    const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>2FA OTP Generator</title>
        <style>
          body {
            font-family: monospace;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: #1a1a1a;
            color: #fff;
          }
          .container {
            text-align: center;
            padding: 20px;
            max-width: 400px;
          }
          .token {
            font-size: 48px;
            font-weight: bold;
            letter-spacing: 8px;
            margin: 20px 0;
            color: #4CAF50;
            cursor: pointer;
            user-select: none;
            transition: transform 0.1s;
          }
          .token:hover {
            transform: scale(1.05);
          }
          .token:active {
            transform: scale(0.95);
          }
          .copied-message {
            font-size: 14px;
            color: #4CAF50;
            opacity: 0;
            transition: opacity 0.3s;
            margin-top: 10px;
            height: 20px;
          }
          .copied-message.show {
            opacity: 1;
          }
          .progress-container {
            width: 100%;
            height: 6px;
            background: #333;
            border-radius: 3px;
            overflow: hidden;
            margin-top: 20px;
          }
          .progress-bar {
            height: 100%;
            background: linear-gradient(90deg, #4CAF50, #2196F3);
            border-radius: 3px;
            transition: width 1s linear;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="token" id="token" title="点击复制">${otp}</div>
          <div class="copied-message" id="copied">已复制!</div>
          <div class="progress-container">
            <div class="progress-bar" id="progress"></div>
          </div>
        </div>
        <script>
          const tokenEl = document.getElementById('token');
          const copiedEl = document.getElementById('copied');
          const totalTime = ${TIME_STEP};
          let remaining = ${remainingTime};
          const progressBar = document.getElementById('progress');

          // 点击复制功能
          tokenEl.addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(tokenEl.textContent);
              copiedEl.classList.add('show');
              setTimeout(() => {
                copiedEl.classList.remove('show');
              }, 2000);
            } catch (err) {
              console.error('复制失败:', err);
            }
          });

          // 设置初始进度
          progressBar.style.width = (remaining / totalTime * 100) + '%';

          const interval = setInterval(() => {
            remaining--;
            progressBar.style.width = (remaining / totalTime * 100) + '%';

            if (remaining <= 0) {
              clearInterval(interval);
              location.reload();
            }
          }, 1000);
        </script>
      </body>
    </html>
    `;

    // 构建 HTML 格式的 Response
    return new Response(htmlContent, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
  } catch (error) {
    // 错误处理
    return new Response(`Error: ${error.message}\n\nPlease check your secret key format. It should be Base32 encoded (A-Z, 2-7).`, {
      status: 400,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8'
      }
    });
  }
}

// 生成 OTP 的函数
async function generateOTP(secret) {
  // 获取当前时间戳
  const epochTime = Math.floor(Date.now() / 1000);

  // 计算当前时间片
  let counter = Math.floor(epochTime / TIME_STEP);

  // 将时间片转换为字节数组
  const counterBytes = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = counter & 0xff;
    counter >>>= 8;
  }

  // 使用 crypto.subtle 计算 HMAC-SHA1
  const key = await crypto.subtle.importKey(
    'raw',
    base32toByteArray(secret),
    { name: 'HMAC', hash: { name: 'SHA-1' } },
    false,
    ['sign']
  );

  const hmacBuffer = await crypto.subtle.sign('HMAC', key, counterBytes.buffer);
  const hmacArray = Array.from(new Uint8Array(hmacBuffer));

  // 将结果转换为 OTP
  const offset = hmacArray[hmacArray.length - 1] & 0xf;
  const truncatedHash = hmacArray.slice(offset, offset + 4);
  const otpValue = new DataView(new Uint8Array(truncatedHash).buffer).getUint32(0) & 0x7fffffff;
  const otp = (otpValue % Math.pow(10, OTP_LENGTH)).toString().padStart(OTP_LENGTH, '0');

  return otp;
}

// 辅助函数：将 Base32 编码的密钥转换为字节数组
function base32toByteArray(base32) {
  const charTable = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  // 移除填充字符并转为大写
  const cleanedBase32 = base32.toUpperCase().replace(/=+$/, '');
  const base32Chars = cleanedBase32.split('');

  // 验证所有字符是否有效
  for (const char of base32Chars) {
    if (charTable.indexOf(char) === -1) {
      throw new Error(`Invalid Base32 character: '${char}'. Only A-Z and 2-7 are allowed.`);
    }
  }

  // 转换为二进制字符串
  const bits = base32Chars.map(char => charTable.indexOf(char).toString(2).padStart(5, '0')).join('');

  // 转换为字节数组
  const bytes = [];
  for (let i = 0; i < bits.length; i += 8) {
    if (i + 8 <= bits.length) {
      bytes.push(parseInt(bits.slice(i, i + 8), 2));
    }
  }

  return new Uint8Array(bytes);
}

// 辅助函数：计算 OTP 剩余有效时间
function calculateRemainingTime() {
  const epochTime = Math.floor(Date.now() / 1000);
  const currentCounter = Math.floor(epochTime / TIME_STEP);

  // 计算下一个时间片的开始时间
  const expirationTime = (currentCounter + 1) * TIME_STEP;

  // 计算剩余时间（修复：使用当前时间而不是加载时间）
  const remainingTime = expirationTime - epochTime;

  return remainingTime;
}
