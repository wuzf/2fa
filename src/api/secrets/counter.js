/**
 * Advance a HOTP counter without accepting a full secret object from the client.
 */

import { getAllSecrets, getSecretByIdWithHOTPState, saveSecretsToKV } from './shared.js';
import { rotateHOTPCounterEpoch, saveHOTPCounterState } from './counter-state.js';
import { getLogger } from '../../utils/logger.js';
import { getMonitoring, ErrorSeverity } from '../../utils/monitoring.js';
import { validateRequest, advanceHOTPCounterSchema } from '../../utils/validation.js';
import { createErrorResponse, createSuccessResponse } from '../../utils/response.js';
import {
	ValidationError,
	NotFoundError,
	ConflictError,
	StorageError,
	CryptoError,
	ConfigurationError,
	ErrorFactory,
	errorToResponse,
	logError,
} from '../../utils/errors.js';

function getSecretId(request) {
	const pathSegments = new URL(request.url).pathname.split('/');
	return pathSegments.at(-2) || '';
}

function createCounterResult(secret, request) {
	return createSuccessResponse(
		{
			secret,
			id: secret.id,
			counter: secret.counter,
			idempotent: false,
		},
		'HOTP计数器递增成功',
		request,
	);
}

/**
 * Advance a HOTP counter using an optimistic client snapshot.
 *
 * The current server object is preserved verbatim except for `counter`.
 */
export async function handleAdvanceHOTPCounter(request, env, _ctx) {
	const logger = getLogger(env);

	try {
		const snapshot = await validateRequest(advanceHOTPCounterSchema)(request);
		if (snapshot instanceof Response) {
			return snapshot;
		}

		const secretId = getSecretId(request);
		if (!secretId) {
			throw new ValidationError('密钥ID不能为空', { operation: 'advanceHOTPCounter' });
		}

		const currentState = await getSecretByIdWithHOTPState(env, secretId);
		if (!currentState.secret) {
			throw ErrorFactory.secretNotFound(secretId, { operation: 'advanceHOTPCounter' });
		}

		const currentSecret = currentState.secret;
		if (String(currentSecret.type).toUpperCase() !== 'HOTP') {
			throw new ConflictError('只有HOTP密钥可以递增计数器', {
				operation: 'advanceHOTPCounter',
				secretId,
			});
		}

		const currentCounter = currentSecret.counter;
		if (currentCounter < 0 || !Number.isSafeInteger(currentCounter)) {
			throw new ConflictError('服务端HOTP计数器状态无效', {
				operation: 'advanceHOTPCounter',
				secretId,
			});
		}

		const currentAlgorithm = String(currentSecret.algorithm).toUpperCase();
		const snapshotMatches =
			(currentSecret.hotpCounterNamespace || null) === snapshot.expectedNamespace &&
			currentSecret.secret === snapshot.expectedSecret &&
			currentSecret.digits === snapshot.expectedDigits &&
			currentAlgorithm === snapshot.expectedAlgorithm;
		if (!snapshotMatches) {
			throw new ConflictError('HOTP生成参数已变更，请刷新后重试', {
				operation: 'advanceHOTPCounter',
				secretId,
				currentCounter,
			});
		}

		if (currentCounter !== snapshot.expectedCounter) {
			throw new ConflictError('HOTP计数器已变更，请刷新后重试', {
				operation: 'advanceHOTPCounter',
				secretId,
				expectedCounter: snapshot.expectedCounter,
				currentCounter,
			});
		}

		if (currentCounter === Number.MAX_SAFE_INTEGER) {
			throw new ConflictError('HOTP计数器已达到安全整数上限，无法继续递增', {
				operation: 'advanceHOTPCounter',
				secretId,
				currentCounter,
			});
		}

		const nextCounter = currentCounter + 1;
		const updatedSecret = {
			...currentSecret,
			counter: nextCounter,
		};

		await saveHOTPCounterState(env, currentSecret, nextCounter, currentState.epoch);

		logger.info('HOTP计数器递增成功', {
			operation: 'handleAdvanceHOTPCounter',
			secretId,
			counter: nextCounter,
		});

		return createCounterResult(updatedSecret, request);
	} catch (error) {
		if (
			error instanceof NotFoundError ||
			error instanceof ConflictError ||
			error instanceof ValidationError ||
			error instanceof StorageError ||
			error instanceof CryptoError ||
			error instanceof ConfigurationError
		) {
			logError(error, logger, { operation: 'handleAdvanceHOTPCounter' });
			getMonitoring(env).getErrorMonitor().captureError(error, { operation: 'handleAdvanceHOTPCounter' }, ErrorSeverity.WARNING);
			return errorToResponse(error, request);
		}

		logger.error('HOTP计数器递增失败', { operation: 'handleAdvanceHOTPCounter', errorMessage: error.message }, error);
		getMonitoring(env).getErrorMonitor().captureError(error, { operation: 'handleAdvanceHOTPCounter' }, ErrorSeverity.ERROR);
		return createErrorResponse('HOTP计数器递增失败', '递增HOTP计数器时发生内部错误', 500, request);
	}
}

/**
 * Persist effective counters into the encrypted base document before a rollback
 * to a release that does not understand HOTP counter sidecars.
 */
export async function handleCompactHOTPCounters(request, env, ctx) {
	const logger = getLogger(env);

	try {
		if (request.headers.get('X-Confirm-Maintenance') !== 'compact-hotp-counters') {
			throw new ValidationError('缺少HOTP计数器维护确认头', {
				requiredHeader: 'X-Confirm-Maintenance: compact-hotp-counters',
			});
		}

		const secrets = await getAllSecrets(env);
		const compactedCount = secrets.filter((secret) => String(secret?.type || '').toUpperCase() === 'HOTP').length;

		await saveSecretsToKV(env, secrets, 'hotp-counters-compacted', { skipEventBackup: true }, ctx);
		// Base write and epoch rotation are deliberately retryable, not atomic. If
		// rotation fails, the old sidecars remain authoritative until a retry.
		await rotateHOTPCounterEpoch(env);

		logger.info('HOTP计数器sidecar已压实到主数据', {
			operation: 'handleCompactHOTPCounters',
			compactedCount,
			secretCount: secrets.length,
		});

		return createSuccessResponse(
			{
				compactedCount,
				secretCount: secrets.length,
			},
			'HOTP计数器压实成功',
			request,
		);
	} catch (error) {
		if (
			error instanceof StorageError ||
			error instanceof CryptoError ||
			error instanceof ConfigurationError ||
			error instanceof ValidationError
		) {
			logError(error, logger, { operation: 'handleCompactHOTPCounters' });
			return errorToResponse(error, request);
		}

		logger.error('HOTP计数器压实失败', { operation: 'handleCompactHOTPCounters', errorMessage: error.message }, error);
		return createErrorResponse('HOTP计数器压实失败', '压实HOTP计数器时发生内部错误', 500, request);
	}
}
