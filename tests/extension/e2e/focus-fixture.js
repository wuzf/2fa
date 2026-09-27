// Playwright normally makes every Chromium page appear focused. Disable that
// emulation when exercising behavior driven by the user switching browser tabs.
export async function trackRealTabFocus(context, page) {
	const session = await context.newCDPSession(page);
	await session.send('Emulation.setFocusEmulationEnabled', { enabled: false });
	await page.evaluate(() => {
		window.fixtureFocusEvents = [];
		const record = (event) => {
			window.fixtureFocusEvents.push({
				type: event.type,
				trusted: event.isTrusted,
				visibility: document.visibilityState,
				focused: document.hasFocus(),
			});
		};
		window.addEventListener('focus', record);
		window.addEventListener('blur', record);
		document.addEventListener('visibilitychange', record);
	});
	return () =>
		page.evaluate(() => ({
			visibility: document.visibilityState,
			focused: document.hasFocus(),
			events: window.fixtureFocusEvents,
		}));
}
