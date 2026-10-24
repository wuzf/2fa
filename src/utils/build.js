/** Content identity embedded by every supported build entry point. */
export function getBuildId() {
	return typeof globalThis.__2FA_BUILD_ID__ === 'string' ? globalThis.__2FA_BUILD_ID__ : '';
}
