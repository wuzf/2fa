export function injectWorkerVersion(configText, version) {
	// 必须带 g：顶层 [vars] 和各 [env.X.vars] 都有独立的 SW_VERSION，
	// 只替换首个会让 env 部署的 Service Worker 缓存版本停在旧值，用户拿不到更新
	const updated = configText.replace(/^(\s*SW_VERSION\s*=\s*)"[^"]*"(\s*)$/gm, `$1"${version}"$2`);

	if (updated === configText) {
		throw new Error('在 wrangler.toml 中未找到 SW_VERSION 配置');
	}

	return updated;
}
