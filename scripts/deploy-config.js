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

export function extractWorkerName(configText) {
	const match = configText.match(/^name\s*=\s*"([^"]+)"/m);
	return match ? match[1] : null;
}

export function injectKvNamespaceId(configText, id) {
	// Match the first [[kv_namespaces]] block that contains binding = "SECRETS_KV"
	// and is NOT inside an [env.*] section.
	const lines = configText.split('\n');
	let inEnvSection = false;
	let kvBlockStart = -1;
	let bindingLine = -1;
	let existingIdLine = -1;

	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();

		// Track whether we're inside an [env.*] section
		if (/^\[env\./.test(trimmed)) {
			inEnvSection = true;
			continue;
		}
		if (/^\[(?!env\.)/.test(trimmed) || /^\[\[(?!env\.)/.test(trimmed)) {
			inEnvSection = false;
		}

		if (inEnvSection) continue;

		if (trimmed === '[[kv_namespaces]]') {
			kvBlockStart = i;
			bindingLine = -1;
			existingIdLine = -1;
			continue;
		}

		if (kvBlockStart >= 0) {
			// End of block: next section header or empty line after content
			if (/^\[/.test(trimmed) || /^\[\[/.test(trimmed)) {
				if (bindingLine >= 0) break;
				kvBlockStart = -1;
				continue;
			}

			if (/^binding\s*=\s*"SECRETS_KV"/.test(trimmed)) {
				bindingLine = i;
			}
			if (/^id\s*=\s*"/.test(trimmed)) {
				existingIdLine = i;
			}
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
