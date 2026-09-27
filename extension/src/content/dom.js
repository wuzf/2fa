// Browser same-origin access is the boundary; closed roots and inaccessible frames are skipped.
const documentFrames = new WeakMap();

export function frameDocument(frame) {
	try {
		const doc = frame.contentDocument;
		if (!doc || !frame.contentWindow || !frame.isConnected) {
			return null;
		}
		// Reading location also rejects sandboxed or cross-origin windows.
		void frame.contentWindow.location.href;
		documentFrames.set(doc, frame);
		return doc;
	} catch {
		return null;
	}
}

export function accessibleRoots(root) {
	const result = [];
	const pending = [root];
	const seen = new Set();
	while (pending.length) {
		const current = pending.pop();
		if (!current?.querySelectorAll || seen.has(current)) {
			continue;
		}
		seen.add(current);
		result.push(current);
		for (const element of current.querySelectorAll('*')) {
			if (element.shadowRoot) {
				pending.push(element.shadowRoot);
			}
			if (element.tagName === 'IFRAME') {
				const doc = frameDocument(element);
				if (doc) {
					pending.push(doc);
				}
			}
		}
	}
	return result;
}

export function currentDocument(doc) {
	const seen = new Set();
	while (doc && !seen.has(doc)) {
		seen.add(doc);
		let frame;
		try {
			frame = documentFrames.get(doc) || doc.defaultView?.frameElement;
		} catch {
			return false;
		}
		if (!frame) {
			return Boolean(doc.defaultView);
		}
		if (!frame.isConnected || frameDocument(frame) !== doc) {
			return false;
		}
		doc = frame.ownerDocument;
	}
	return false;
}

export function treeParent(element) {
	if (element.assignedSlot) {
		return element.assignedSlot;
	}
	if (element.parentElement) {
		return element.parentElement;
	}
	const root = element.getRootNode?.();
	if (root?.host) {
		return root.host;
	}
	try {
		return documentFrames.get(element.ownerDocument) || element.ownerDocument?.defaultView?.frameElement || null;
	} catch {
		return null;
	}
}

export function activeInput(doc) {
	let element = doc?.activeElement;
	const seen = new Set();
	while (element && !seen.has(element)) {
		seen.add(element);
		const nested = element.shadowRoot?.activeElement || (element.tagName === 'IFRAME' ? frameDocument(element)?.activeElement : null);
		if (!nested) {
			break;
		}
		element = nested;
	}
	return element?.tagName === 'INPUT' ? element : null;
}

export function referencedElement(element, id) {
	const root = element.getRootNode?.();
	return typeof root?.getElementById === 'function' ? root.getElementById(id) : element.ownerDocument?.getElementById(id);
}

// Modal dialogs make the rest of their document inert without adding an inert
// attribute. Build a snapshot for one synchronous validation; callers must make
// a new one after dispatching events that can open or close dialogs.
export function createModalGuard(root, knownRoots) {
	let doc = root?.nodeType === 9 ? root : root?.ownerDocument;
	while (doc?.documentElement) {
		const frame = treeParent(doc.documentElement);
		if (!frame || frame.ownerDocument === doc) {
			break;
		}
		doc = frame.ownerDocument;
	}
	const roots = root === doc && knownRoots ? knownRoots : accessibleRoots(doc);
	const dialogs = new Map();
	for (const current of roots) {
		for (const dialog of current.querySelectorAll('dialog')) {
			if (!dialog.matches(':modal')) {
				continue;
			}
			const owner = dialog.ownerDocument;
			if (!dialogs.has(owner)) {
				dialogs.set(owner, []);
			}
			dialogs.get(owner).push(dialog);
		}
	}
	if (dialogs.size === 0) {
		return () => true;
	}
	const activeDialogs = new Map();
	for (const [owner, modals] of dialogs) {
		if (modals.length === 1) {
			activeDialogs.set(owner, modals[0]);
			continue;
		}
		// DOM order is not top-layer order. Native focus cannot enter an inert
		// sibling modal, so use the focused modal when available. If focus was
		// lost (for example its field was removed), refuse to guess the stack.
		let focused = owner.activeElement;
		while (focused?.shadowRoot?.activeElement) {
			focused = focused.shadowRoot.activeElement;
		}
		let active = null;
		for (let element = focused; element?.ownerDocument === owner; element = treeParent(element)) {
			if (modals.includes(element)) {
				active = element;
				break;
			}
		}
		activeDialogs.set(owner, active);
	}
	return (element) => {
		const ancestry = new Set();
		const documents = new Set();
		for (let current = element; current; current = treeParent(current)) {
			ancestry.add(current);
			documents.add(current.ownerDocument);
		}
		for (const owner of documents) {
			if (activeDialogs.has(owner) && !ancestry.has(activeDialogs.get(owner))) {
				return false;
			}
		}
		return true;
	};
}
