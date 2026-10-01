import { parse, stringify } from 'smol-toml';

export function parseDeploymentArgs(args) {
	let versionStrategy = '';
	let envName = null;
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === '--git' || argument === '--package') {
			if (versionStrategy) {
				throw new Error('只能指定一种版本策略');
			}
			versionStrategy = argument;
		} else if (argument === '--env' || argument === '-e' || argument.startsWith('--env=')) {
			if (envName !== null) {
				throw new Error('只能指定一个部署环境');
			}
			envName = argument.startsWith('--env=') ? argument.slice(6) : args[++index];
			if (!envName || envName.startsWith('-') || !envName.trim()) {
				throw new Error('请明确指定部署环境名称');
			}
		} else {
			throw new Error(`不支持的部署参数: ${argument}`);
		}
	}
	return { versionStrategy, envName };
}

function namespaceTitles(workerName, envName) {
	if (!envName) {
		return new Set([`${workerName}-secrets-kv`, `${workerName}-SECRETS_KV`]);
	}
	const alias = { development: 'dev', production: 'prod' }[envName] || envName;
	const base = workerName.endsWith(`-${alias}`) ? workerName.slice(0, -(alias.length + 1)) : workerName;
	return new Set([
		`${workerName}-secrets-kv`,
		`${workerName}-SECRETS_KV`,
		`${base}-secrets-kv-${alias}`,
		`${base}-secrets-kv-${envName}`,
		`${alias}-${base}-SECRETS_KV`,
		`${envName}-${base}-SECRETS_KV`,
	]);
}

/**
 * Workers Builds sets WRANGLER_CI_OVERRIDE_NAME to the name of the connected
 * Worker. Wrangler deploys under that name (after environment resolution, with
 * no suffix added) whenever it differs from the configured one, so namespace
 * discovery must use it too. Wrangler adopts any value that is present, so an
 * empty value is returned as-is and rejected by resolveKvBinding.
 */
export function readWorkerNameOverride(environment = process.env) {
	return Object.hasOwn(environment, 'WRANGLER_CI_OVERRIDE_NAME') ? environment.WRANGLER_CI_OVERRIDE_NAME : undefined;
}

/**
 * Read the output of `wrangler kv namespace list`. Wrangler prints notices such
 * as "Proxy environment variables detected..." on stdout before the JSON, so
 * the list starts at the first line that opens a JSON array.
 */
export function parseNamespaceList(output) {
	const lines = String(output).split(/\r?\n/);
	for (let index = 0; index < lines.length; index += 1) {
		if (!lines[index].trimStart().startsWith('[')) {
			continue;
		}
		try {
			const parsed = JSON.parse(lines.slice(index).join('\n'));
			if (Array.isArray(parsed)) {
				return parsed;
			}
		} catch {
			// A notice that happens to start with "[": keep looking.
		}
	}
	throw new Error('KV 列表响应无效');
}

function effectiveWorkerName(configuration, target, envName, workerNameOverride) {
	if (workerNameOverride !== undefined) {
		if (typeof workerNameOverride !== 'string' || !workerNameOverride.trim()) {
			throw new Error('WRANGLER_CI_OVERRIDE_NAME 为空，无法确定实际部署的 Worker，已停止部署');
		}
		// The deployed Worker is exactly this name, so it is independent for every environment.
		return workerNameOverride;
	}
	const workerName = target.name || configuration.name;
	if (typeof workerName !== 'string' || !workerName.trim()) {
		throw new Error('缺少 Worker 名称，无法确定账户存储');
	}
	if (envName && !target.name) {
		throw new Error('无明确 KV id 的部署环境需要独立 Worker 名称，请填写该环境的 name 或 SECRETS_KV id');
	}
	return workerName;
}

// Explicit deployment configuration always wins. Namespace discovery is only
// for an unbound environment, and never guesses from substrings or list order.
// It uses the Worker name that Wrangler will actually deploy: the Workers Builds
// override when present, otherwise the configured name. Using the configured
// name for a connected Worker with a different name could adopt the storage of
// another deployment that happens to use the configured name.
export async function resolveKvBinding(configText, envName, listNamespaces, { workerNameOverride } = {}) {
	const configuration = parse(configText);
	const target = envName ? configuration.env?.[envName] : configuration;
	if (!target) {
		throw new Error(`未找到部署环境 ${envName}`);
	}
	if (!Array.isArray(target.kv_namespaces)) {
		throw new Error('目标环境未声明 SECRETS_KV 绑定');
	}
	const bindings = target.kv_namespaces.filter((binding) => binding.binding === 'SECRETS_KV');
	if (bindings.length !== 1) {
		throw new Error('目标环境必须且只能声明一个 SECRETS_KV 绑定');
	}
	const binding = bindings[0];
	if (Object.hasOwn(binding, 'id')) {
		if (typeof binding.id !== 'string' || !binding.id.trim()) {
			throw new Error('SECRETS_KV 的 id 不能为空');
		}
		return { kind: 'configured', id: binding.id };
	}
	const workerName = effectiveWorkerName(configuration, target, envName, workerNameOverride);
	let namespaces;
	try {
		namespaces = await listNamespaces();
	} catch {
		throw new Error('无法核对已有 KV，请检查 Cloudflare 登录状态或在配置中明确填写 SECRETS_KV id');
	}
	if (
		!Array.isArray(namespaces) ||
		namespaces.some(
			(namespace) =>
				!namespace ||
				typeof namespace.id !== 'string' ||
				!namespace.id.trim() ||
				typeof namespace.title !== 'string' ||
				!namespace.title.trim(),
		)
	) {
		throw new Error('KV 列表响应无效，已停止部署');
	}
	const titles = namespaceTitles(workerName, envName);
	const matches = new Map(namespaces.filter((namespace) => titles.has(namespace.title)).map((namespace) => [namespace.id, namespace]));
	if (matches.size > 1) {
		throw new Error('找到多个可能的账户库，请在目标环境中明确填写 SECRETS_KV id 后再部署');
	}
	if (matches.size === 1) {
		const { id, title } = matches.values().next().value;
		return { kind: 'existing', id, title };
	}
	return { kind: 'new' };
}

export function applyKvBinding(configText, envName, resolved) {
	if (resolved.kind !== 'existing') {
		return configText;
	}
	const configuration = parse(configText);
	const target = envName ? configuration.env?.[envName] : configuration;
	const bindings = target?.kv_namespaces?.filter((binding) => binding.binding === 'SECRETS_KV');
	if (bindings?.length !== 1 || Object.hasOwn(bindings[0], 'id') || typeof resolved.id !== 'string' || !resolved.id.trim()) {
		throw new Error('账户存储配置已变化，停止自动绑定');
	}
	bindings[0].id = resolved.id;
	return stringify(configuration);
}
