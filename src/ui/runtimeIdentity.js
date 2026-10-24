import { hashBytes, stableStringify } from '../themes/schema.js';

/** Runtime identity also binds dynamic shell configuration, not only the code build. */
export function isAppAppearance(appearance) {
	return appearance?.kind === 'app' || appearance?.manifest?.themeApiVersion === 2;
}

export async function getAdminCodeId(customCode = '') {
	return hashBytes(new TextEncoder().encode(customCode));
}

export async function getShellConfigId({ appearance, customCode = '', adminCodeId, safeMode = false }) {
	const codeId = safeMode ? await getAdminCodeId('') : adminCodeId || (await getAdminCodeId(customCode));
	return hashBytes(
		new TextEncoder().encode(
			stableStringify({
				appearance: safeMode ? null : (appearance ?? null),
				adminCodeId: codeId,
				safeMode,
			}),
		),
	);
}

export function getRuntimeTuple(appearance, buildId, safeMode = false) {
	const app = !safeMode && isAppAppearance(appearance);
	return {
		hostBuild: buildId,
		sdkApiVersion: 1,
		packageId: app ? appearance.packageId : null,
		appearanceRevision: safeMode ? 0 : appearance?.revision || 0,
		mode: safeMode ? 'safe' : app ? 'app' : 'official',
	};
}
