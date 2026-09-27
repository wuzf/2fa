import { currentDocument, treeParent } from './dom.js';
import { applyTranslations, getLanguage, onLanguageChange } from '../shared/i18n.js';

function placementFor(input, doc) {
	if (!input.isConnected || !currentDocument(input.ownerDocument)) {
		return null;
	}
	const ancestors = [];
	const dialogs = [];
	for (let element = input; element?.nodeType === 1; element = treeParent(element)) {
		ancestors.push(element);
		if (element.tagName === 'DIALOG') {
			if (!element.open) {
				return null;
			}
			if (element.matches(':modal')) {
				dialogs.push(element);
			}
		}
	}
	return { ancestors, dialogs, parent: dialogs[0] || doc.documentElement };
}

function rectInDocument(input, destination) {
	let { left, top, bottom } = input.getBoundingClientRect();
	for (let current = input.ownerDocument; current !== destination; ) {
		const frame = current.defaultView?.frameElement;
		if (!frame?.isConnected || frame.contentDocument !== current) {
			return null;
		}
		const rect = frame.getBoundingClientRect();
		const scaleX = frame.offsetWidth > 0 ? rect.width / frame.offsetWidth : 1;
		const scaleY = frame.offsetHeight > 0 ? rect.height / frame.offsetHeight : 1;
		const css = frame.ownerDocument.defaultView.getComputedStyle(frame);
		const offsetX = rect.left + (frame.clientLeft + (Number.parseFloat(css.paddingLeft) || 0)) * scaleX;
		const offsetY = rect.top + (frame.clientTop + (Number.parseFloat(css.paddingTop) || 0)) * scaleY;
		left = offsetX + left * scaleX;
		top = offsetY + top * scaleY;
		bottom = offsetY + bottom * scaleY;
		current = frame.ownerDocument;
	}
	return { left, top, bottom };
}

export function createAutomaticPanel({ doc = globalThis.document } = {}) {
	let panel = null;
	let input = null;
	let disposed = false;
	const unsubscribeLanguage = onLanguageChange(translate);

	function translate() {
		if (!panel || disposed) {
			return;
		}
		// Update only our closed shadow tree. Keeping the same controls preserves
		// keyboard focus, disabled selections, and every pending autofill guard.
		panel.host.lang = getLanguage();
		applyTranslations(panel.section);
		position();
	}

	function remove() {
		panel?.cleanup?.();
		panel?.host.remove();
		panel = null;
		input = null;
	}

	function detach() {
		const onDetached = panel?.onDetached;
		remove();
		onDetached?.();
	}

	function watchPlacement(placement) {
		panel.cleanup?.();
		const cleanup = [];
		const observer = new doc.defaultView.MutationObserver(position);
		const nodes = new Set();
		const views = new Set();
		const listen = (target, event, handler) => {
			target.addEventListener(event, handler);
			cleanup.push(() => target.removeEventListener(event, handler));
		};
		for (const ancestor of placement.ancestors) {
			nodes.add(ancestor);
			if (ancestor.parentNode) {
				nodes.add(ancestor.parentNode);
			}
			views.add(ancestor.ownerDocument.defaultView);
			if (ancestor.tagName === 'IFRAME') {
				listen(ancestor, 'load', position);
			}
		}
		// Observe only the input's ancestry: removals, reparenting, and modal
		// state changes do not need a second whole-document subtree observer.
		for (const node of nodes) {
			observer.observe(node, { childList: true, attributes: true, attributeFilter: ['open', 'slot', 'name'] });
		}
		for (const dialog of placement.dialogs) {
			// A close event can arrive after showModal() already reopened the same
			// dialog. Retire the old popover instead of trusting its current open state.
			listen(dialog, 'close', detach);
		}
		for (const view of views) {
			listen(view, 'resize', position);
			if (view !== doc.defaultView) {
				listen(view, 'pagehide', detach);
			}
		}
		panel.placement = placement;
		panel.cleanup = () => {
			observer.disconnect();
			for (const stop of cleanup) {
				stop();
			}
		};
	}

	function position() {
		if (!panel || !input) {
			return;
		}
		try {
			const placement = placementFor(input, doc);
			if (!placement || (panel.placement && !panel.host.isConnected)) {
				detach();
				return;
			}
			const previous = panel.placement;
			if (
				!previous ||
				previous.parent !== placement.parent ||
				previous.dialogs.length !== placement.dialogs.length ||
				previous.dialogs.some((element, index) => element !== placement.dialogs[index]) ||
				previous.ancestors.length !== placement.ancestors.length ||
				previous.ancestors.some((element, index) => element !== placement.ancestors[index])
			) {
				panel.cleanup?.();
				if (panel.host.hasAttribute('popover')) {
					panel.host.hidePopover();
					panel.host.removeAttribute('popover');
				}
				placement.parent.append(panel.host);
				if (placement.dialogs.length) {
					// A top-layer popover escapes transformed/clipping dialog boxes,
					// while being a dialog descendant keeps it outside the inert background.
					panel.host.setAttribute('popover', 'manual');
					panel.host.showPopover();
				}
				watchPlacement(placement);
			}
			const destination = panel.host.ownerDocument;
			const rect = rectInDocument(input, destination);
			if (!rect) {
				detach();
				return;
			}
			const view = destination.defaultView;
			const width = Math.min(320, Math.max(0, view.innerWidth - 16));
			panel.host.style.width = `${width}px`;
			const height = Math.min(panel.host.getBoundingClientRect().height || 180, Math.max(0, view.innerHeight - 16));
			panel.host.style.left = `${Math.max(8, Math.min(rect.left, view.innerWidth - width - 8))}px`;
			panel.host.style.top = `${Math.max(8, Math.min(rect.bottom + 8 + height > view.innerHeight ? rect.top - height - 8 : rect.bottom + 8, view.innerHeight - height - 8))}px`;
		} catch {
			detach();
		}
	}

	function show({ input: targetInput, accounts, failed = false, onClose, onRetry, onSelect, onDetached }) {
		if (disposed) {
			return;
		}
		remove();
		const host = doc.createElement('div');
		host.setAttribute('data-twofa-autofill', '');
		host.style.cssText =
			'all:initial;position:fixed;inset:auto;margin:0;border:0;padding:0;z-index:2147483647;display:block;color-scheme:light dark;';
		const shadow = host.attachShadow({ mode: 'closed' });
		const style = doc.createElement('style');
		style.textContent = `
			:host{font:13px/1.4 system-ui,"Segoe UI",sans-serif;color:#242424;text-align:start}
			*{box-sizing:border-box}section{font:13px/1.4 system-ui,"Segoe UI",sans-serif;color:#242424;text-align:start;background:#fff;border:1px solid #d1d1d1;border-radius:8px;padding:10px;box-shadow:0 8px 28px #0003;max-height:min(340px,70vh);overflow:auto}
			header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}strong{font-weight:600}p{margin:6px 0;color:#616161}
			button{font:inherit;cursor:pointer;border:1px solid transparent;border-radius:4px;color:inherit;background:transparent;text-align:start;padding:8px;width:100%;display:block}
			button:hover{background:#f0f0f0}button:focus-visible{outline:2px solid #0f6cbd;outline-offset:1px}button:disabled{opacity:.6;cursor:wait}
			.close{flex:none;width:28px;height:28px;padding:2px;text-align:center;font-size:18px}.account span{display:block;overflow-wrap:anywhere}.account .detail{font-size:12px;color:#616161}.retry{color:#0f6cbd}
			@media(prefers-color-scheme:dark){section{color:#fff;background:#292929;border-color:#666}button:hover{background:#383838}p,.account .detail{color:#d1d1d1}.retry{color:#7fbcff}}
		`;
		const section = doc.createElement('section');
		section.setAttribute('role', 'region');
		section.setAttribute('data-i18n-aria-label', 'contentAutofillRegion');
		const header = doc.createElement('header');
		const title = doc.createElement('strong');
		title.setAttribute('data-i18n', failed ? 'contentFillUnavailableTitle' : 'contentChooseAccount');
		const close = doc.createElement('button');
		close.type = 'button';
		close.className = 'close';
		close.setAttribute('data-i18n-aria-label', 'contentCloseAutofill');
		close.textContent = '×';
		close.addEventListener('click', (event) => {
			if (event.isTrusted) {
				onClose();
			}
		});
		header.append(title, close);
		section.append(header);
		if (failed) {
			const explanation = doc.createElement('p');
			explanation.setAttribute('data-i18n', 'contentRetryExplanation');
			const retry = doc.createElement('button');
			retry.type = 'button';
			retry.className = 'retry';
			retry.setAttribute('data-i18n', 'contentRetry');
			retry.addEventListener('click', (event) => {
				if (event.isTrusted) {
					onRetry();
				}
			});
			section.append(explanation, retry);
		} else {
			for (const account of accounts) {
				const button = doc.createElement('button');
				button.type = 'button';
				button.className = 'account';
				const name = doc.createElement('span');
				name.textContent = account.name;
				const detail = doc.createElement('span');
				detail.className = 'detail';
				detail.textContent = account.account;
				button.append(name, detail);
				button.addEventListener('click', (event) => {
					if (event.isTrusted) {
						void onSelect(account.id);
					}
				});
				section.append(button);
			}
		}
		shadow.addEventListener('keydown', (event) => {
			if (!event.isTrusted) {
				return;
			}
			if (event.key === 'Escape') {
				event.preventDefault();
				onClose();
				targetInput?.focus({ preventScroll: true });
			} else if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
				const buttons = [...section.querySelectorAll('button:not(:disabled)')];
				const index = buttons.indexOf(shadow.activeElement);
				const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
				event.preventDefault();
				buttons[next]?.focus();
			}
		});
		shadow.append(style, section);
		panel = { host, section, onDetached };
		input = targetInput;
		translate();
	}

	function setSelecting() {
		for (const button of panel?.section.querySelectorAll('button.account,button.retry') || []) {
			button.disabled = true;
		}
	}

	function dispose() {
		if (disposed) {
			return;
		}
		disposed = true;
		unsubscribeLanguage();
		remove();
	}

	return { show, remove, position, setSelecting, isHost: (node) => Boolean(panel && node === panel.host), dispose };
}
