import { accessibleRoots } from './dom.js';

const OBSERVED_ATTRIBUTES = [
	'aria-hidden',
	'aria-disabled',
	'aria-label',
	'aria-labelledby',
	'aria-describedby',
	'autocomplete',
	'class',
	'disabled',
	'hidden',
	'inert',
	'id',
	'maxlength',
	'name',
	'pattern',
	'placeholder',
	'readonly',
	'role',
	'style',
	'title',
	'type',
	'src',
	'srcdoc',
	'data-profile-identifier',
	'value',
	'for',
	'form',
	'inputmode',
	'open',
];
const MOTION_EVENTS = ['animationstart', 'animationend', 'animationcancel', 'animationiteration', 'transitionend', 'transitioncancel'];

// Owns DOM and page observation only. Authorization, input ownership, and
// account episodes remain with the automatic controller.
export function createAutomaticObservation({
	doc,
	isEnabled,
	isPanelHost,
	onInspect,
	onInput,
	onNavigation,
	onPause,
	onResume,
	onPosition,
}) {
	const view = doc.defaultView;
	const roots = new Map();
	let pageActive = true;
	let disposed = false;
	let observing = false;
	let rootsDirty = true;
	let scanTimer = null;
	let rootTimer = null;
	let urlTimer = null;

	const isVisible = () => pageActive && doc.visibilityState !== 'hidden';

	function schedule() {
		if (!disposed && isEnabled() && isVisible() && scanTimer === null) {
			scanTimer = setTimeout(() => {
				scanTimer = null;
				onInspect();
			}, 120);
		}
	}

	function onRootLoad() {
		rootsDirty = true;
		schedule();
	}

	function onLayoutChange() {
		onPosition();
		// Scrolling and responsive layout can reveal an OTP without a DOM mutation.
		// The window resize listener outlives pause(), so retain completion/edit guards.
		if (observing) {
			schedule();
		}
	}

	function removeRootListeners(root) {
		for (const name of ['beforeinput', 'input', 'change']) {
			root.removeEventListener(name, onInput, true);
		}
		root.removeEventListener('load', onRootLoad, true);
		root.removeEventListener('focusin', schedule, true);
		root.removeEventListener('scroll', onLayoutChange, true);
		for (const name of MOTION_EVENTS) {
			root.removeEventListener(name, onLayoutChange, true);
		}
	}

	function observeRoots() {
		if (disposed) {
			return false;
		}
		rootsDirty = false;
		const currentRoots = new Set(accessibleRoots(doc));
		for (const [root, observer] of roots) {
			if (!currentRoots.has(root)) {
				observer.disconnect();
				removeRootListeners(root);
				roots.delete(root);
			}
		}
		let added = false;
		for (const root of currentRoots) {
			if (roots.has(root)) {
				continue;
			}
			added = true;
			const observer = new view.MutationObserver((records) => {
				const changes = records.filter((record) => !isPanelHost(record.target));
				if (
					changes.some(
						(record) =>
							record.type === 'childList' &&
							[...record.addedNodes, ...record.removedNodes].some((node) => node.nodeType === 1 && !isPanelHost(node)),
					)
				) {
					rootsDirty = true;
				}
				if (changes.length) {
					schedule();
				}
			});
			observer.observe(root, {
				subtree: true,
				childList: true,
				attributes: true,
				attributeFilter: OBSERVED_ATTRIBUTES,
				characterData: true,
			});
			roots.set(root, observer);
			for (const name of ['beforeinput', 'input', 'change']) {
				root.addEventListener(name, onInput, true);
			}
			root.addEventListener('load', onRootLoad, true);
			root.addEventListener('focusin', schedule, true);
			root.addEventListener('scroll', onLayoutChange, true);
			for (const name of MOTION_EVENTS) {
				root.addEventListener(name, onLayoutChange, true);
			}
		}
		return added;
	}

	function refreshRootsIfDirty() {
		if (rootsDirty) {
			observeRoots();
		}
	}

	function start() {
		if (disposed) {
			return;
		}
		observing = true;
		observeRoots();
		// attachShadow() on an existing host causes no outer DOM mutation. This
		// infrequent root discovery performs no source IO and only rescans OTPs
		// when it finds a new accessible root.
		if (rootTimer === null) {
			rootTimer = setInterval(() => {
				if (observeRoots()) {
					schedule();
				}
			}, 5000);
		}
	}

	function pause() {
		observing = false;
		clearTimeout(scanTimer);
		scanTimer = null;
		clearInterval(rootTimer);
		rootTimer = null;
		for (const [root, observer] of roots) {
			observer.disconnect();
			removeRootListeners(root);
		}
		roots.clear();
		rootsDirty = true;
	}

	function pauseNavigationWatch() {
		clearInterval(urlTimer);
		urlTimer = null;
	}

	function watchNavigation() {
		if (urlTimer === null && isVisible() && !disposed) {
			// pushState/replaceState do not emit navigation events. Comparing one
			// local string also works on unapproved routes, without page patches or
			// background messages until the URL actually changes.
			urlTimer = setInterval(onNavigation, 500);
		}
	}

	function onVisibility() {
		if (!isVisible()) {
			pauseNavigationWatch();
			onPause();
		} else {
			onResume();
		}
	}
	function onPageHide() {
		pageActive = false;
		pauseNavigationWatch();
		onPause();
	}
	function onPageShow() {
		pageActive = true;
		onResume();
	}
	function onOnline() {
		if (isVisible()) {
			onResume();
		}
	}

	doc.addEventListener('visibilitychange', onVisibility);
	view.addEventListener('pagehide', onPageHide);
	view.addEventListener('pageshow', onPageShow);
	view.addEventListener('popstate', onNavigation);
	view.addEventListener('hashchange', onNavigation);
	view.addEventListener('resize', onLayoutChange);
	view.addEventListener('online', onOnline);

	function dispose() {
		if (disposed) {
			return;
		}
		disposed = true;
		pauseNavigationWatch();
		pause();
		doc.removeEventListener('visibilitychange', onVisibility);
		view.removeEventListener('pagehide', onPageHide);
		view.removeEventListener('pageshow', onPageShow);
		view.removeEventListener('popstate', onNavigation);
		view.removeEventListener('hashchange', onNavigation);
		view.removeEventListener('resize', onLayoutChange);
		view.removeEventListener('online', onOnline);
	}

	return { isVisible, schedule, start, refreshRootsIfDirty, pause, watchNavigation, dispose };
}
