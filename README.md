# 2fa
这是一个用Cloudflare Worker代码实现的Two Factor Authentication，worker页面会显示动态生成的 One-Time Password（OTP），并且能够在 OTP 过期后自动刷新以提供新的 OTP，可以简单代替Google Authenticator或者Microsoft Authenticator。
如果不想用演示站，也可以自己复制worker.js源码，通过Cloudflare Worker自行搭建。

### 演示网站
 https://2fa.free.hr/MBWJJVDIQ3PH3SA5

### 备用网站：
 1. https://2fa.guts.eu.org/MBWJJVDIQ3PH3SA5
 2. https://2fa.my2fa.workers.dev/MBWJJVDIQ3PH3SA5
 3. https://tfa.mytfa.workers.dev/MBWJJVDIQ3PH3SA5
