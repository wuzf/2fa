/** Shared runtime identities and manifest validation. Self-contained for SW serialization. */
export function createRuntimeProtocol({ origin, crypto: cryptography = globalThis.crypto, languages = ['en'] } = {}) {
	const protocol = '2fa-runtime-v1';
	const hex = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
	const modules = ['appearance', 'import', 'export', 'backup', 'qrcode', 'tools', 'googleMigration'];
	const stable = (value) =>
		Array.isArray(value)
			? value.map(stable)
			: value && typeof value === 'object'
				? Object.fromEntries(
						Object.keys(value)
							.sort()
							.map((key) => [key, stable(value[key])]),
					)
				: value;
	const canonical = (value) => JSON.stringify(stable(value));
	function tuple(value) {
		if (
			!value ||
			!hex(value.hostBuild) ||
			value.sdkApiVersion !== 1 ||
			!Number.isSafeInteger(value.appearanceRevision) ||
			value.appearanceRevision < 0 ||
			!['app', 'official', 'safe'].includes(value.mode) ||
			(value.mode === 'app' ? !hex(value.packageId) : value.packageId !== null) ||
			(value.mode === 'safe' && value.appearanceRevision !== 0)
		) {
			throw new Error('Invalid runtime tuple');
		}
		return Object.freeze({
			hostBuild: value.hostBuild,
			sdkApiVersion: 1,
			packageId: value.packageId,
			appearanceRevision: value.appearanceRevision,
			mode: value.mode,
		});
	}
	const tupleKey = (value) => canonical(tuple(value));
	async function digest(bytes) {
		const value = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
		return Array.from(new Uint8Array(await cryptography.subtle.digest('SHA-256', value)), (byte) =>
			byte.toString(16).padStart(2, '0'),
		).join('');
	}
	function headersMatch(headers, expected, safe = false) {
		return (
			headers.get('X-2FA-Build') === expected.hostBuild &&
			headers.get('X-2FA-Appearance-Revision') === String(safe ? 0 : expected.appearanceRevision) &&
			headers.get('X-2FA-SDK-Api-Version') === String(expected.sdkApiVersion) &&
			(headers.get('X-2FA-Package-Id') || '') === (safe ? '' : expected.packageId || '') &&
			headers.get('X-2FA-Runtime-Mode') === (safe ? 'safe' : expected.mode)
		);
	}
	function resourceAllowed(resource, expected) {
		const url = new URL(resource.url, origin);
		if (
			url.origin !== origin ||
			url.username ||
			url.password ||
			url.hash ||
			resource.url.includes('\\') ||
			!Number.isSafeInteger(resource.size) ||
			resource.size < 0 ||
			resource.size > 16 * 1024 * 1024 ||
			!hex(resource.sha256) ||
			typeof resource.mime !== 'string' ||
			!['public', 'authenticated'].includes(resource.access)
		) {
			return false;
		}
		const path = url.pathname;
		if (resource.role === 'shell') {
			return path === '/' && !url.search && resource.mime === 'text/html' && hex(resource.shellConfigId);
		}
		if (resource.role === 'recovery') {
			return (
				path === '/' &&
				url.search === '?safeMode=1' &&
				resource.mime === 'text/html' &&
				resource.access === 'public' &&
				hex(resource.shellConfigId)
			);
		}
		if (resource.role === 'module') {
			return (
				modules.some((name) => path === '/modules/' + name + '.js') &&
				url.searchParams.get('build') === expected.hostBuild &&
				resource.access === 'authenticated' &&
				resource.mime === 'application/javascript'
			);
		}
		if (resource.role === 'vendor') {
			return (
				['/vendor/jsqr-1.4.0.js', '/vendor/qrcode-generator-1.4.4.js'].includes(path) &&
				!url.search &&
				['application/javascript', 'text/javascript'].includes(resource.mime)
			);
		}
		if (resource.role === 'manifest') {
			return path === '/manifest.json';
		}
		if (resource.role === 'icon') {
			return /^\/(icon-|apple-touch-icon)/.test(path);
		}
		if (resource.role === 'asset') {
			return /^\/theme-assets\/[a-f0-9]{64}\//.test(path);
		}
		if (resource.role === 'package') {
			return (
				expected.mode === 'app' &&
				path.startsWith('/theme-packages/' + expected.packageId + '/') &&
				!url.search &&
				resource.access === 'public'
			);
		}
		return false;
	}
	async function descriptor(value, expected) {
		const identity = tuple(value?.tuple);
		if (expected && tupleKey(identity) !== tupleKey(expected)) {
			throw new Error('Runtime tuple mismatch');
		}
		if (
			value.formatVersion !== 2 ||
			value.transportApiVersion !== 1 ||
			!Array.isArray(value.resources) ||
			value.resources.length < 1 ||
			value.resources.length > 512 ||
			!hex(value.inventoryHash) ||
			!hex(value.shellConfigId)
		) {
			throw new Error('Invalid runtime inventory');
		}
		const resources = value.resources.map((item) => ({
			url: item.url,
			mime: item.mime,
			size: item.size,
			sha256: item.sha256,
			role: item.role,
			access: item.access,
			...(['shell', 'recovery'].includes(item.role) ? { shellConfigId: item.shellConfigId } : {}),
		}));
		const seen = new Set();
		let total = 0;
		for (const resource of resources) {
			if (!resourceAllowed(resource, identity)) {
				throw new Error('Invalid runtime resource');
			}
			const url = new URL(resource.url, origin).href;
			if (seen.has(url)) {
				throw new Error('Duplicate runtime resource');
			}
			seen.add(url);
			total += resource.size;
		}
		if (total > 64 * 1024 * 1024) {
			throw new Error('Runtime inventory too large');
		}
		if (!resources.some((item) => item.role === 'recovery')) {
			throw new Error('Recovery shell missing');
		}
		for (const safe of identity.mode === 'safe' ? [true] : [false, true]) {
			for (const language of languages) {
				if (
					!resources.some((item) => {
						const url = new URL(item.url, origin);
						return (
							item.role === 'manifest' &&
							(url.searchParams.get('safeMode') === '1') === safe &&
							url.searchParams.get('appearance') === String(safe ? 0 : identity.appearanceRevision) &&
							url.searchParams.get('lang') === language
						);
					})
				) {
					throw new Error('Manifest inventory incomplete');
				}
			}
			for (const size of [192, 512]) {
				if (
					!resources.some(
						(item) =>
							item.role === 'icon' &&
							new URL(item.url, origin).pathname === '/icon-' + size + '.png' &&
							(new URL(item.url, origin).searchParams.get('safeMode') === '1') === safe,
					)
				) {
					throw new Error('Icon inventory incomplete');
				}
			}
		}
		if (
			identity.mode !== 'safe' &&
			(!resources.some((item) => item.role === 'shell') ||
				modules.some(
					(name) => !resources.some((item) => item.role === 'module' && new URL(item.url, origin).pathname === '/modules/' + name + '.js'),
				))
		) {
			throw new Error('Host inventory incomplete');
		}
		if (
			['/vendor/jsqr-1.4.0.js', '/vendor/qrcode-generator-1.4.4.js'].some(
				(path) => !resources.some((item) => item.role === 'vendor' && new URL(item.url, origin).pathname === path),
			)
		) {
			throw new Error('Vendor inventory incomplete');
		}
		if (identity.mode === 'app' && !resources.some((item) => item.role === 'package')) {
			throw new Error('App inventory missing');
		}
		const shell = resources.find((item) => item.role === (identity.mode === 'safe' ? 'recovery' : 'shell'));
		if (shell?.shellConfigId !== value.shellConfigId) {
			throw new Error('Shell configuration mismatch');
		}
		const normalized = { formatVersion: 2, transportApiVersion: 1, tuple: identity, shellConfigId: value.shellConfigId, resources };
		if ((await digest(canonical(normalized))) !== value.inventoryHash) {
			throw new Error('Inventory hash mismatch');
		}
		return { ...normalized, inventoryHash: value.inventoryHash };
	}
	return Object.freeze({ protocol, tuple, tupleKey, canonical, digest, descriptor, headersMatch, modules: Object.freeze(modules) });
}
