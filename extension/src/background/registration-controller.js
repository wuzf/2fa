import { originFromTabUrl, permissionPatternCoversOrigin } from '../shared/origin.js';

const RENDERER_TIMEOUT_MS = 2_000;
const MAX_TRACKED_TABS = 512;

function canContact(tab, allowIncognito = false) {
	return Number.isInteger(tab.id) && tab.id >= 0 && !tab.discarded && !tab.frozen && (allowIncognito || !tab.incognito);
}

async function contactRenderer(operation) {
	let timer;
	try {
		return await Promise.race([
			Promise.resolve()
				.then(operation)
				.then(() => true),
			new Promise((resolve) => {
				timer = setTimeout(() => resolve(false), RENDERER_TIMEOUT_MS);
			}),
		]);
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
	}
}

function scriptMatches(current, expected) {
	return ['runAt', 'allFrames', 'world', 'persistAcrossSessions', 'js', 'matches'].every(
		(key) => JSON.stringify(key === 'matches' ? [...(current[key] || [])].sort() : current[key]) === JSON.stringify(expected[key]),
	);
}

// Policy selection belongs to each role. This controller only reconciles the
// browser registration and contacts renderers whose effective scope changed.
export function createRegistrationController({ id, ownsScript, file, stopMessage, getScopes, permissionPattern, stopIncognito = false }) {
	let queue = Promise.resolve();
	let appliedScopes = null;
	let retryOrigins = new Set();
	const knownTabs = new Map();
	const pendingStops = new Map();

	// Origins remembered from an older policy while waiting for a stop message
	// may no longer convert to a pattern.
	// Skip them: failing here would fail the whole reconciliation and remove the
	// scripts of every website. Their stops are still retried by tab and origin.
	function patternsFor(origins) {
		const patterns = new Set();
		for (const origin of origins) {
			try {
				patterns.add(permissionPattern(origin));
			} catch {
				// Not a pattern this role can register or query.
			}
		}
		return [...patterns].sort();
	}

	function remember(tabId, origin) {
		knownTabs.delete(tabId);
		knownTabs.set(tabId, origin);
		if (knownTabs.size > MAX_TRACKED_TABS) {
			knownTabs.delete(knownTabs.keys().next().value);
		}
	}

	function observeRenderer(sender) {
		const origin = originFromTabUrl(sender?.url);
		if (
			sender?.id !== chrome.runtime.id ||
			!chrome.runtime.id ||
			sender.frameId !== 0 ||
			typeof sender.documentId !== 'string' ||
			!sender.documentId ||
			(sender.documentLifecycle && sender.documentLifecycle !== 'active') ||
			!origin ||
			!canContact(sender.tab || {})
		) {
			return;
		}
		remember(sender.tab.id, origin);
	}

	async function tabsToStop(affected, previousPatterns, cold) {
		const patterns = [...new Set(patternsFor(affected).concat(previousPatterns))].sort();
		if (!patterns.length && !knownTabs.size && !pendingStops.size && !cold) {
			return [];
		}
		// A permission-removal event may cold-start the worker after Chrome has
		// already hidden tab URLs or removed the persistent registration. Only this
		// initial pass conservatively contacts unknown-URL pages.
		const fallback = cold;
		let tabs = fallback ? await chrome.tabs.query({}) : patterns.length ? await chrome.tabs.query({ url: patterns }) : [];
		const visibleIds = new Set(tabs.map((tab) => tab.id));
		const missingKnown =
			[...knownTabs].some(([tabId, origin]) => affected.has(origin) && !visibleIds.has(tabId)) ||
			[...pendingStops.keys()].some((tabId) => !visibleIds.has(tabId));
		if (!fallback && missingKnown) {
			// After host revocation Chrome can omit both tab.url and URL-filtered
			// results. Use remembered renderer IDs only for the affected old scope.
			tabs = await chrome.tabs.query({});
			const openIds = new Set(tabs.map((tab) => tab.id));
			for (const tabId of knownTabs.keys()) {
				if (!openIds.has(tabId)) {
					knownTabs.delete(tabId);
				}
			}
			for (const tabId of pendingStops.keys()) {
				if (!openIds.has(tabId)) {
					pendingStops.delete(tabId);
				}
			}
		}
		return tabs.filter((tab) => {
			if (!canContact(tab, stopIncognito)) {
				return false;
			}
			const origin = originFromTabUrl(tab.url);
			if (origin) {
				// A visible current URL wins over historical tab ownership.
				if (pendingStops.has(tab.id) && pendingStops.get(tab.id) !== origin) {
					pendingStops.delete(tab.id);
				}
				return affected.has(origin) || previousPatterns.some((pattern) => permissionPatternCoversOrigin(pattern, origin));
			}
			return affected.has(knownTabs.get(tab.id)) || pendingStops.has(tab.id) || fallback;
		});
	}

	function descriptor(scopes) {
		return {
			id,
			matches: patternsFor(scopes.keys()),
			js: [file],
			runAt: 'document_idle',
			allFrames: false,
			world: 'ISOLATED',
			persistAcrossSessions: true,
		};
	}

	async function stopRenderers(tabs) {
		await Promise.all(
			tabs.map(async (tab) => {
				const stopped = await contactRenderer(async () => {
					try {
						await chrome.tabs.sendMessage(tab.id, { type: stopMessage }, { frameId: 0 });
					} catch (error) {
						// A missing/closed receiver is already stopped. Other failures and
						// timeouts retain bounded metadata for the next reconciliation.
						if (
							!/receiving end does not exist|could not establish connection|no tab with id|no frame with id|no receiver/i.test(
								error?.message || '',
							)
						) {
							throw error;
						}
					}
				});
				if (stopped) {
					pendingStops.delete(tab.id);
				} else {
					pendingStops.set(tab.id, originFromTabUrl(tab.url) || knownTabs.get(tab.id) || null);
					if (pendingStops.size > MAX_TRACKED_TABS) {
						pendingStops.delete(pendingStops.keys().next().value);
					}
				}
			}),
		);
	}

	async function updateRegistration(scripts, scopes) {
		const obsolete = scripts.filter((script) => !scopes.size || script.id !== id).map((script) => script.id);
		if (obsolete.length) {
			await chrome.scripting.unregisterContentScripts({ ids: obsolete });
		}
		if (!scopes.size) {
			return;
		}
		const desired = descriptor(scopes);
		const current = scripts.find((script) => script.id === id);
		if (!current) {
			await chrome.scripting.registerContentScripts([desired]);
		} else if (!scriptMatches(current, desired)) {
			await chrome.scripting.updateContentScripts([desired]);
		}
	}

	async function startRenderers(scopes, affected) {
		const origins = [...scopes.keys()].filter((origin) => affected.has(origin));
		if (!origins.length) {
			return new Set();
		}
		const allowed = new Set(origins);
		const patterns = patternsFor(origins);
		if (!patterns.length) {
			return new Set();
		}
		const tabs = await chrome.tabs.query({ url: patterns });
		const failed = new Set();
		await Promise.all(
			tabs
				.filter((tab) => canContact(tab) && !tab.pendingUrl && allowed.has(originFromTabUrl(tab.url)))
				.map(async (tab) => {
					const origin = originFromTabUrl(tab.url);
					remember(tab.id, origin);
					if (
						!(await contactRenderer(() =>
							chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: [file], world: 'ISOLATED' }),
						))
					) {
						failed.add(origin);
					}
				}),
		);
		return failed;
	}

	async function reconcile(cleanupPatterns, refreshCurrent) {
		let scripts = [];
		try {
			scripts = (await chrome.scripting.getRegisteredContentScripts()).filter(ownsScript);
			const scopes = await getScopes();
			const cold = appliedScopes === null;
			const current = scripts.find((script) => script.id === id);
			const externallyChanged = !cold && current && !scriptMatches(current, descriptor(appliedScopes));
			const oldPatterns = scripts
				.filter((script) => cold || script.id !== id || externallyChanged)
				.flatMap((script) => script.matches || [])
				.concat(cleanupPatterns);
			const affected = new Set(retryOrigins);
			for (const origin of pendingStops.values()) {
				if (origin) {
					affected.add(origin);
				}
			}
			for (const origin of new Set([...(appliedScopes?.keys() || []), ...scopes.keys()])) {
				if (cold || appliedScopes.get(origin) !== scopes.get(origin) || (refreshCurrent && scopes.has(origin))) {
					affected.add(origin);
				}
			}
			// A legacy registration may overlap a still-authorized origin. Any
			// allowed renderer stopped during legacy cleanup must be restarted too.
			for (const origin of scopes.keys()) {
				if (oldPatterns.some((pattern) => permissionPatternCoversOrigin(pattern, origin))) {
					affected.add(origin);
				}
			}
			// Repair externally removed/legacy registrations and refresh their live
			// pages even if the saved policy itself has not changed.
			if (externallyChanged || (!current && scopes.size)) {
				for (const origin of scopes.keys()) {
					affected.add(origin);
				}
			}
			if (cold || affected.size || oldPatterns.length || pendingStops.size) {
				const tabs = await tabsToStop(affected, oldPatterns, cold);
				await stopRenderers(tabs);
			}
			await updateRegistration(scripts, scopes);
			retryOrigins = await startRenderers(scopes, affected);
			appliedScopes = scopes;
		} catch (error) {
			appliedScopes = null;
			let current = scripts;
			try {
				current = (await chrome.scripting.getRegisteredContentScripts()).filter(ownsScript);
			} catch {
				// Registry failures must not skip stopping known live renderers.
			}
			try {
				const patterns = [...scripts, ...current].flatMap((script) => script.matches || []).concat(cleanupPatterns);
				const tabs = await tabsToStop(new Set(knownTabs.values()), patterns, true);
				await stopRenderers(tabs);
			} catch {
				// Tab enumeration cannot prevent cleanup of persistent registrations.
			}
			try {
				await chrome.scripting.unregisterContentScripts({ ids: current.length ? current.map((script) => script.id) : [id] });
			} catch {
				// Preserve the cause; the next call retries from the browser's state.
			}
			throw error;
		}
	}

	return {
		observeRenderer,
		reconcile({ cleanupPatterns = [], refreshCurrent = false } = {}) {
			// Revocation facts survive queued work and browser registry cleanup.
			// They select STOP targets only; getScopes remains the authority for
			// registering or injecting scripts, including a rapid regrant.
			const cleanup = Array.isArray(cleanupPatterns) ? cleanupPatterns.filter((pattern) => typeof pattern === 'string') : [];
			const operation = queue.then(() => reconcile(cleanup, refreshCurrent === true));
			queue = operation.catch(() => {});
			return operation;
		},
	};
}
