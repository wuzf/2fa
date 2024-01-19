// 添加事件监听器
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

// 处理请求的主要函数
async function handleRequest(request) {
  // 使用 new URL(request.url) 创建 URL 对象
  const url = new URL(request.url);

  // 从路径中提取密钥
  const secret = url.pathname.substring(1);

  // 检查密钥是否存在
  if (!secret) {
    const currentOrigin = url.origin; // 包含协议、域名和端口
    return new Response(`Missing secret parameter!\n\nUsage: ${currentOrigin}/YOUR_SECRET_KEY\nExample: ${currentOrigin}/JBSWY3DPEHPK3PXP`, { status: 400 });
  }

  // 记录页面加载时的时间
  const loadTime = Math.floor(Date.now() / 1000);

  // 生成 OTP
  const otp = await generateOTP(secret, loadTime);

  // 构建 HTML 页面
  const htmlContent = `
    <html>
      <head>
        <title>OTP Page</title>
        <script>
          // 页面加载时的时间
          const loadTime = ${loadTime};
          
          // 计算 OTP 剩余有效时间
          const remainingTime = ${calculateRemainingTime(loadTime)};
          
          // 如果 OTP 剩余时间小于等于 0，刷新页面
          if (remainingTime <= 0) {
            location.reload();
          } else {
            // 否则，延时刷新页面
            setTimeout(() => {
              location.reload();
            }, remainingTime * 1000); // 将剩余时间转换为毫秒
          }
        </script>
      </head>
      <body>
      <pre>{
  "token": "${otp}"
}</pre>
      </body>
    </html>
  `;

  // 构建 HTML 格式的 Response
  const htmlResponse = new Response(htmlContent, {
    headers: {
      'Content-Type': 'text/html'
    }
  });

  return htmlResponse;
}

// 生成 OTP 的函数
async function generateOTP(secret, loadTime) {
  // 获取当前时间戳的时间戳
  const epochTime = Math.floor(Date.now() / 1000);

  // 时间步长，这里假设是 30 秒
  const timeStep = 30;

  // 计算当前时间片
  let counter = Math.floor(epochTime / timeStep);

  // 计算当前时间片开始的时间
  const counterStart = counter * timeStep;

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
  const otp = (otpValue % 1000000).toString().padStart(6, '0');

  return otp;
}

// 辅助函数：将 Base32 编码的密钥转换为字节数组
function base32toByteArray(base32) {
  const charTable = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const base32Chars = base32.toUpperCase().split('');
  const bits = base32Chars.map(char => charTable.indexOf(char).toString(2).padStart(5, '0')).join('');

  const bytes = [];
  for (let i = 0; i < bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }

  return new Uint8Array(bytes);
}

// 辅助函数：计算 OTP 剩余有效时间
function calculateRemainingTime(loadTime) {
  const epochTime = Math.floor(Date.now() / 1000);
  const timeStep = 30; // 与生成 OTP 的时间步长相同
  const currentCounter = Math.floor(epochTime / timeStep);

  // 这里假设过期时间为 30 秒，您可以根据实际情况调整
  const expirationTime = (currentCounter + 1) * timeStep;

  // 计算剩余时间
  const remainingTime = expirationTime - loadTime;

  return remainingTime;
}
