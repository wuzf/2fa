import { t } from '../shared/i18n.js';
import { loginContextsMatch } from '../shared/login-context.js';
import { MESSAGE, accountMetadataMatches } from '../shared/protocol.js';

export function sameFlowTarget(left, right) {
	return Boolean(
		left &&
		right &&
		left.targetOrigin === right.targetOrigin &&
		left.targetPath === right.targetPath &&
		left.targetTabId === right.targetTabId &&
		left.targetDocumentId === right.targetDocumentId &&
		left.instanceOrigin === right.instanceOrigin &&
		loginContextsMatch(left.loginContext, right.loginContext),
	);
}

// Preview and explicit fill requests spend the same background nonce. Keep its
// ownership and the queue together; source synchronization does not use this queue.
export function createFlowSession({ send, onRenewed }) {
	let flow = null;
	let version = 0;
	let consumed = false;
	let queue = Promise.resolve();
	let disposed = false;

	return {
		get flow() {
			return flow;
		},
		get version() {
			return version;
		},
		begin() {
			return ++version;
		},
		accept(next) {
			flow = next;
			consumed = false;
		},
		consume() {
			consumed = true;
		},
		updateServiceIcons(serviceIcons) {
			flow = { ...flow, serviceIcons };
		},
		updateFavorites(favoriteAccountIds) {
			flow = { ...flow, favoriteAccountIds };
		},
		serialize(operation) {
			// Let queued operations run their cancellation/finally paths so every
			// waiting preview promise is settled when its view closes.
			const pending = queue.then(operation);
			queue = pending.catch(() => {});
			return pending;
		},
		async ensureFresh(account, { allowMissing = false } = {}) {
			if (!consumed || disposed) {
				return;
			}
			const refreshed = await send({ type: MESSAGE.START_FLOW, preferCache: true, refreshSource: false });
			if (disposed) {
				return;
			}
			if (
				!sameFlowTarget(refreshed, flow) ||
				(!allowMissing && !refreshed.accounts.some((item) => accountMetadataMatches(item, account)))
			) {
				throw Object.assign(new Error(t('popupFlowChanged')), { i18nKey: 'popupFlowChanged' });
			}
			flow = refreshed;
			consumed = false;
			onRenewed();
		},
		dispose() {
			disposed = true;
			version += 1;
		},
	};
}
