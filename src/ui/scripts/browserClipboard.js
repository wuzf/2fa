/** One browser clipboard boundary. Native writes start before returning to the caller. */
export function createBrowserClipboardPort({ navigator, document, isCurrent = () => true } = {}) {
	function fallback(text, current) {
		if (!current() || !document?.body || typeof document.execCommand !== 'function') {
			return false;
		}
		const active = document.activeElement;
		const selection = document.getSelection?.();
		const ranges = [];
		if (selection) {
			for (let i = 0; i < selection.rangeCount; i += 1) {
				ranges.push(selection.getRangeAt(i).cloneRange());
			}
		}
		const input = document.createElement('textarea');
		input.value = text;
		input.setAttribute('readonly', '');
		input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
		document.body.appendChild(input);
		try {
			input.select();
			return document.execCommand('copy') === true;
		} catch {
			return false;
		} finally {
			input.remove();
			if (active?.isConnected) {
				try {
					active.focus({ preventScroll: true });
				} catch {
					/* Detached focus is harmless. */
				}
			}
			if (selection) {
				try {
					selection.removeAllRanges();
					ranges.forEach((range) => selection.addRange(range));
				} catch {
					/* The document may have changed. */
				}
			}
		}
	}
	return Object.freeze({
		writeText(value, options = {}) {
			const text = String(value);
			const current = () => isCurrent() && (!options.isCurrent || options.isCurrent());
			if (!current()) {
				return Promise.reject(new Error('clipboard-session-invalidated'));
			}
			const recover = (error) => {
				if (fallback(text, current)) {
					return true;
				}
				throw error;
			};
			let operation;
			try {
				if (typeof navigator?.clipboard?.writeText !== 'function') {
					throw new Error('clipboard-unavailable');
				}
				operation = navigator.clipboard.writeText(text);
			} catch (error) {
				try {
					return Promise.resolve(recover(error));
				} catch (failure) {
					return Promise.reject(failure);
				}
			}
			// A pending native promise remains pending: no timeout can prove it did not copy.
			return Promise.resolve(operation).then(() => true, recover);
		},
	});
}
