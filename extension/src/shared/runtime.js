// Losing a message port during a worker restart is recoverable. An unloaded
// extension context cannot use runtime APIs again and must release its listeners.
export function isExtensionContextInvalidated(runtime, error) {
	try {
		return (
			!runtime?.id ||
			/extension context invalidated|extension (?:was |has been |is )?(?:unloaded|removed|disabled)/i.test(error?.message || '')
		);
	} catch {
		return true;
	}
}
