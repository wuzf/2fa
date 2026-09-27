import { isPlainObject, sanitizeAccountList } from '../shared/protocol.js';
import { getConnectionStatus } from '../shared/storage.js';
import { generateTotpCode, generateTotpCodes, listTotpAccounts, serializeBridgeError } from '../bridge/api.js';
import { runOfflineOperation, getOfflineSourceRevision, getOfflineSourceChangeToken, getOfflineClockRevision } from './offline-source.js';
import { getConfigurationGeneration } from './generation.js';
import { ExtensionError } from './errors.js';
import { requireSettings, validateFlowConfiguration, assertCurrentGeneration, validateOfflineConfiguration } from './configuration.js';
import { withTimeout } from './browser-access.js';

// Route session/local reads and validate returned codes without owning a target
// document or consuming a user-action nonce.
const SOURCE_OPERATIONS = Object.freeze({
	list: listTotpAccounts,
	generate: generateTotpCode,
	generateMany: generateTotpCodes,
});

function offlineGenerationCheck(configuration, signal) {
	let pending = null;
	const assertCurrent = () => {
		if (signal.aborted) {
			throw new ExtensionError('REQUEST_EXPIRED');
		}
		assertCurrentGeneration(configuration);
	};
	return async () => {
		assertCurrent();
		if (!pending) {
			const checking = validateOfflineConfiguration(configuration);
			pending = checking;
			const release = () => {
				if (pending === checking) {
					pending = null;
				}
			};
			// A batch shares only a check that is still running. Later checks and
			// separate requests must read configuration and permissions again.
			void checking.then(release, release);
		}
		await pending;
		assertCurrent();
	};
}

export async function requestSource(configuration, kind, payload = {}, onGenerationSource) {
	if (typeof kind !== 'string' || !Object.hasOwn(SOURCE_OPERATIONS, kind)) {
		throw new ExtensionError('INVALID_REQUEST');
	}
	await validateFlowConfiguration(configuration);
	const controller = new AbortController();
	const connection = await getConnectionStatus(configuration.instanceOrigin);
	await validateFlowConfiguration(configuration);
	let data;
	try {
		const options = {
			...payload,
			instanceOrigin: configuration.instanceOrigin,
			signal: controller.signal,
			...(connection.mode === 'offline'
				? {
						onGenerationSource,
						checkConfiguration:
							kind === 'list'
								? () => validateOfflineConfiguration(configuration)
								: offlineGenerationCheck(configuration, controller.signal),
					}
				: {}),
		};
		const read = async () => {
			try {
				return await runOfflineOperation(kind, options);
			} catch (error) {
				if (kind !== 'list' || error?.code !== 'ACCOUNT_CHANGED') {
					throw error;
				}
				// A source hint can land while the list is being read. Retry once using
				// the new snapshot instead of asking the user to repeat the operation.
				await validateFlowConfiguration(configuration);
				return runOfflineOperation(kind, options);
			}
		};
		data = await withTimeout(connection.mode === 'offline' ? read() : SOURCE_OPERATIONS[kind](options), 'SOURCE_UNAVAILABLE', controller);
	} catch (error) {
		await validateFlowConfiguration(configuration);
		if (error instanceof ExtensionError) {
			throw error;
		}
		if (
			connection.mode === 'offline' &&
			[
				'AUTH_REQUIRED',
				'INVALID_RESPONSE',
				'REQUEST_EXPIRED',
				'ACCOUNT_CHANGED',
				'CLOCK_CHANGED',
				'CLOCK_UNAVAILABLE',
				'OFFLINE_CACHE_MISSING',
				'SOURCE_OFFLINE',
			].includes(error?.code)
		) {
			throw new ExtensionError(error.code);
		}
		const safeError = serializeBridgeError(error);
		throw new ExtensionError(safeError.code, safeError.messageKey);
	}
	await validateFlowConfiguration(configuration);
	return data;
}

export function validateSourceClock(flow) {
	if (flow.sourceRevision && flow.sourceClockRevision !== getOfflineClockRevision(flow.instanceOrigin)) {
		throw new ExtensionError('REQUEST_EXPIRED');
	}
}

export function validateGeneratedSource(flow, source) {
	if (
		source &&
		(source.revision !== getOfflineSourceRevision(flow.instanceOrigin) ||
			source.clockRevision !== getOfflineClockRevision(flow.instanceOrigin))
	) {
		throw new ExtensionError('ACCOUNT_CHANGED');
	}
}

export function validateAutomaticSource(flow) {
	if (flow.sourceRefreshPending) {
		throw new ExtensionError('REQUEST_EXPIRED');
	}
	validateSourceClock(flow);
	if (
		flow.sourceRevision &&
		(flow.sourceRevision !== getOfflineSourceRevision(flow.instanceOrigin) ||
			flow.sourceChangeToken !== getOfflineSourceChangeToken(flow.instanceOrigin))
	) {
		throw new ExtensionError('REQUEST_EXPIRED');
	}
}

export function validateGeneratedCode(data, digits, { startedWallTime, receivedAt, elapsedMs }, includeNext) {
	if (
		!isPlainObject(data) ||
		typeof data.code !== 'string' ||
		data.digits !== digits ||
		data.code.length !== digits ||
		!/^\d+$/.test(data.code) ||
		![30, 60, 120].includes(data.period) ||
		!Number.isFinite(data.remainingMs) ||
		data.remainingMs > data.period * 1000 ||
		data.remainingMs < 0 ||
		!Number.isSafeInteger(data.generatedAt) ||
		data.generatedAt < 0 ||
		data.generatedAt < startedWallTime ||
		data.generatedAt > receivedAt ||
		!Number.isSafeInteger(startedWallTime) ||
		!Number.isSafeInteger(receivedAt) ||
		!Number.isFinite(elapsedMs) ||
		elapsedMs < 0 ||
		Math.abs(receivedAt - startedWallTime - elapsedMs) > 2000 ||
		(includeNext
			? typeof data.nextCode !== 'string' || data.nextCode.length !== digits || !/^\d+$/.test(data.nextCode)
			: Object.hasOwn(data, 'nextCode'))
	) {
		throw new ExtensionError('INVALID_RESPONSE');
	}
	// Bridge remainingMs starts after generation, so only delivery time elapses
	// from this anchor. Subtracting the entire request would advance nextStartsAt.
	const expiresAt = data.generatedAt + data.remainingMs;
	const remainingMs = expiresAt - receivedAt;
	if (remainingMs < 1000) {
		throw new ExtensionError('CODE_EXPIRED');
	}
	return {
		code: data.code,
		expiresAt,
		digits,
		period: data.period,
		...(includeNext
			? {
					nextCode: data.nextCode,
					nextStartsAt: expiresAt,
					nextExpiresAt: expiresAt + data.period * 1000,
				}
			: {}),
	};
}

export async function generateForAccount(flow, account, includeNext = false, onGenerationSource, { automatic = false } = {}) {
	const startedWallTime = Date.now();
	const startedAt = performance.now();
	const generated = await requestSource(
		flow,
		'generate',
		{
			id: account.id,
			metadata: account,
			...(includeNext ? { includeNext: true } : {}),
			// Automatic filling lets a running offline time check finish first.
			...(automatic ? { awaitClockCheck: true } : {}),
		},
		onGenerationSource,
	);
	const receivedAt = Date.now();
	return validateGeneratedCode(
		generated,
		account.digits,
		{ startedWallTime, receivedAt, elapsedMs: performance.now() - startedAt },
		includeNext,
	);
}

export async function checkInstance() {
	const configurationGeneration = getConfigurationGeneration();
	const { instanceOrigin } = await requireSettings();
	const data = await requestSource({ instanceOrigin, configurationGeneration }, 'list', { withDiagnostics: true, refresh: true });
	const accounts = sanitizeAccountList(data?.accounts || data);
	if (!accounts) {
		throw new ExtensionError('INVALID_RESPONSE');
	}
	return {
		instanceOrigin,
		accounts,
		accountCount: accounts.length,
		unavailableCount: data?.unavailableAccounts?.length || 0,
		...(data?.offlineStatus ? { offlineStatus: data.offlineStatus } : {}),
	};
}
