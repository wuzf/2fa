(() => {
  // src/index.js
  addEventListener("fetch", (event) => {
    event.respondWith(handleRequest(event.request));
  });
  async function handleRequest(request) {
    const url = new URL(request.url);
    const secret = url.pathname.substring(1);
    if (!secret) {
      return new Response("Missing secret parameter", { status: 400 });
    }
    const loadTime = Math.floor(Date.now() / 1e3);
    const otp = await generateOTP(secret, loadTime);
    const htmlContent = `
    <html>
      <head>
        <title>OTP Page</title>
        <script>
          const loadTime = ${loadTime};
          
          const remainingTime = ${calculateRemainingTime(loadTime)};
          
          if (remainingTime <= 0) {
            location.reload();
          } else {
            setTimeout(() => {
              location.reload();
            }, remainingTime * 1000);
          }
        <\/script>
      </head>
      <body>
      <pre>{
  "token": "${otp}"
}</pre>
      </body>
    </html>
  `;
    const htmlResponse = new Response(htmlContent, {
      headers: {
        "Content-Type": "text/html"
      }
    });
    return htmlResponse;
  }
  async function generateOTP(secret, loadTime) {
    const epochTime = Math.floor(Date.now() / 1e3);
    const timeStep = 30;
    let counter = Math.floor(epochTime / timeStep);
    const counterStart = counter * timeStep;
    const counterBytes = new Uint8Array(8);
    for (let i = 7; i >= 0; i--) {
      counterBytes[i] = counter & 255;
      counter >>>= 8;
    }
    const key = await crypto.subtle.importKey(
      "raw",
      base32toByteArray(secret),
      { name: "HMAC", hash: { name: "SHA-1" } },
      false,
      ["sign"]
    );
    const hmacBuffer = await crypto.subtle.sign("HMAC", key, counterBytes.buffer);
    const hmacArray = Array.from(new Uint8Array(hmacBuffer));
    const offset = hmacArray[hmacArray.length - 1] & 15;
    const truncatedHash = hmacArray.slice(offset, offset + 4);
    const otpValue = new DataView(new Uint8Array(truncatedHash).buffer).getUint32(0) & 2147483647;
    const otp = (otpValue % 1e6).toString().padStart(6, "0");
    return otp;
  }
  function base32toByteArray(base32) {
    const charTable = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const base32Chars = base32.toUpperCase().split("");
    const bits = base32Chars.map((char) => charTable.indexOf(char).toString(2).padStart(5, "0")).join("");
    const bytes = [];
    for (let i = 0; i < bits.length; i += 8) {
      bytes.push(parseInt(bits.slice(i, i + 8), 2));
    }
    return new Uint8Array(bytes);
  }
  function calculateRemainingTime(loadTime) {
    const epochTime = Math.floor(Date.now() / 1e3);
    const timeStep = 30;
    const currentCounter = Math.floor(epochTime / timeStep);
    const expirationTime = (currentCounter + 1) * timeStep;
    const remainingTime = expirationTime - loadTime;
    return remainingTime;
  }
})();
//# sourceMappingURL=index.js.map
