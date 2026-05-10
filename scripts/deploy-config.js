export function injectWorkerVersion(configText, version) {
	const updated = configText.replace(
		/^(\s*SW_VERSION\s*=\s*)"[^"]*"(\s*)$/m,
		`$1"${version}"$2`
	);

	if (updated === configText) {
		throw new Error('在 wrangler.toml 中未找到 SW_VERSION 配置');
	}

	return updated;
}

/**
 * 提取 worker 名称。
 * - envName=null（默认）：返回顶层 `name`（生产环境名）
 * - envName="X"：在 `[env.X]` 块内查找 `name`，找不到则回落到顶层
 */
export function extractWorkerName(configText, envName = null) {
	if (envName) {
		const lines = configText.split('\n');
		const envHeader = `[env.${envName}]`;
		let inEnvBlock = false;
		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed === envHeader) {
				inEnvBlock = true;
				continue;
			}
			if (!inEnvBlock) continue;
			if (/^\[/.test(trimmed)) break; // 进入下一个 section，env 块结束
			const nameMatch = trimmed.match(/^name\s*=\s*"([^"]+)"/);
			if (nameMatch) return nameMatch[1];
		}
		// 未在 env 块内找到 name，回落到顶层
	}
	const match = configText.match(/^name\s*=\s*"([^"]+)"/m);
	return match ? match[1] : null;
}

/**
 * 把 KV namespace id 注入到指定块内（首个 binding = "SECRETS_KV" 的 [[kv_namespaces]] 数组项）。
 * - envName=null（默认）：目标为顶层 `[[kv_namespaces]]`
 * - envName="X"：目标为 `[[env.X.kv_namespaces]]`
 *
 * 已存在 id 时覆盖；不存在时插入到 binding 行后。其他块（含其它 env 的 KV 块）不会被改动。
 */
export function injectKvNamespaceId(configText, id, envName = null) {
	const lines = configText.split('\n');
	const targetHeader = envName
		? `[[env.${envName}.kv_namespaces]]`
		: '[[kv_namespaces]]';

	let inTargetBlock = false;
	let bindingLine = -1;
	let existingIdLine = -1;

	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();

		// 任何 section header 都视为当前块结束
		if (/^\[/.test(trimmed)) {
			if (inTargetBlock && bindingLine >= 0) {
				break; // 已经在目标块里找到 binding，停止扫描
			}
			inTargetBlock = trimmed === targetHeader;
			bindingLine = -1;
			existingIdLine = -1;
			continue;
		}

		if (!inTargetBlock) continue;

		if (/^binding\s*=\s*"SECRETS_KV"/.test(trimmed)) {
			bindingLine = i;
		}
		if (/^id\s*=\s*"/.test(trimmed)) {
			existingIdLine = i;
		}
	}

	if (bindingLine < 0) {
		return configText;
	}

	if (existingIdLine >= 0) {
		lines[existingIdLine] = `id = "${id}"`;
	} else {
		lines.splice(bindingLine + 1, 0, `id = "${id}"`);
	}

	return lines.join('\n');
}
