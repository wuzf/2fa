/**
 * PWA Manifest 生成模块
 * 提供 Web App Manifest 用于支持 PWA 安装和 WebAPK
 */

/**
 * 生成 Web App Manifest
 * @param {Request} request - HTTP 请求对象（用于获取主机名）
 * @returns {Response} Manifest JSON 响应
 */
export function createManifest(request) {
	const url = new URL(request.url);
	const baseUrl = `${url.protocol}//${url.host}`;

	// 简化的 Manifest 配置，确保最佳兼容性
	const manifest = {
		name: '2FA - 两步验证密钥管理器',
		short_name: '2FA',
		description: '安全的两步验证密钥管理器，支持 TOTP、HOTP 验证码生成',
		start_url: '/',
		display: 'standalone',
		background_color: '#ffffff',
		theme_color: '#2196F3',
		orientation: 'portrait-primary',
		scope: '/',

		// 使用 SVG 格式图标（声明为 any 类型以提高兼容性）
		icons: [
			{
				src: `${baseUrl}/icon-192.png`,
				sizes: '192x192',
				type: 'image/svg+xml',
				purpose: 'any',
			},
			{
				src: `${baseUrl}/icon-512.png`,
				sizes: '512x512',
				type: 'image/svg+xml',
				purpose: 'any',
			},
			{
				src: `${baseUrl}/icon-192.png`,
				sizes: '192x192',
				type: 'image/svg+xml',
				purpose: 'maskable',
			},
		],

		categories: ['productivity', 'utilities', 'security'],

		// 移除 screenshots（非必需）

		// 简化的快捷方式（无图标）
		shortcuts: [
			{
				name: '添加密钥',
				short_name: '添加',
				description: '快速添加新的 2FA 密钥',
				url: '/?action=add',
			},
			{
				name: '扫描二维码',
				short_name: '扫描',
				description: '扫描二维码添加密钥',
				url: '/?action=scan',
			},
		],

		related_applications: [],
		prefer_related_applications: false,

		// 显示模式（从最佳到降级）
		display_override: ['standalone', 'minimal-ui'],

		// 简化的协议处理器
		protocol_handlers: [
			{
				protocol: 'web+otpauth',
				url: '/?otpauth=%s',
			},
		],
	};

	return new Response(JSON.stringify(manifest, null, 2), {
		status: 200,
		headers: {
			'Content-Type': 'application/manifest+json',
			'Cache-Control': 'public, max-age=3600',
			'Access-Control-Allow-Origin': '*',
		},
	});
}

/**
 * 生成默认图标（Base64 SVG）
 * 如果没有实际图标文件，可以使用这个作为后备
 * @param {number} size - 图标大小
 * @returns {Response} PNG 图标响应
 */
export function createDefaultIcon(size = 192) {
	// 创建一个简单的 SVG 图标
	const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#2196F3;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#1976D2;stop-opacity:1" />
    </linearGradient>
  </defs>
  
  <!-- 背景 -->
  <rect width="${size}" height="${size}" rx="${size * 0.15}" fill="url(#grad)"/>
  
  <!-- 锁图标 -->
  <g transform="translate(${size * 0.3}, ${size * 0.25})">
    <!-- 锁身 -->
    <rect x="0" y="${size * 0.2}" width="${size * 0.4}" height="${size * 0.3}"
          rx="${size * 0.05}" fill="white" opacity="0.95"/>

    <!-- 锁扣 -->
    <path d="M ${size * 0.05} ${size * 0.2}
             L ${size * 0.05} ${size * 0.15}
             A ${size * 0.1} ${size * 0.1} 0 0 1 ${size * 0.35} ${size * 0.15}
             L ${size * 0.35} ${size * 0.2}"
          fill="none" stroke="white" stroke-width="${size * 0.04}"
          stroke-linecap="round" opacity="0.95"/>
    
    <!-- 钥匙孔 -->
    <circle cx="${size * 0.2}" cy="${size * 0.32}" r="${size * 0.04}" fill="#2196F3"/>
    <rect x="${size * 0.18}" y="${size * 0.32}" width="${size * 0.04}" height="${size * 0.08}" 
          rx="${size * 0.01}" fill="#2196F3"/>
  </g>
  
  <!-- 2FA 文字 -->
  <text x="${size / 2}" y="${size * 0.85}" 
        font-family="Arial, sans-serif" 
        font-size="${size * 0.12}" 
        font-weight="bold" 
        fill="white" 
        text-anchor="middle" 
        opacity="0.95">2FA</text>
</svg>`;

	return new Response(svg, {
		status: 200,
		headers: {
			'Content-Type': 'image/svg+xml',
			'Cache-Control': 'public, max-age=86400',
			'Access-Control-Allow-Origin': '*',
		},
	});
}
