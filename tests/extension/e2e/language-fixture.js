// Extension scenarios assert Chinese text and accessible names. Pin the
// extension's own language preference so they do not depend on the interface
// language of the Chromium build running them.
export const FIXTURE_LANGUAGE = 'zh-CN';

/**
 * Save the fixture language before the scenario opens extension pages or
 * content-script UI. Extension pages read the preference once while starting,
 * so pages the install handler already opened are reloaded to start again.
 */
export async function pinFixtureLanguage(worker, openedPages = []) {
	await worker.evaluate((language) => chrome.storage.local.set({ language }), FIXTURE_LANGUAGE);
	for (const page of openedPages) {
		await page.reload();
	}
}
