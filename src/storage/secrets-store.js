/**
 * Runs every operation on the stored secrets one at a time.
 *
 * The secrets are one encrypted KV document that each change reads, edits and
 * writes back whole. Two changes handled at the same moment start from the same
 * document, and the later write drops the other change; Workers KV can also
 * return an outdated document for a while after a write. Each operation is
 * therefore sent to a single Durable Object (binding SECRETS_STORE), which runs
 * the operations in arrival order and reads and writes the owned keys through
 * createConsistentKV().
 *
 * Without the binding (for example a Worker pasted into the dashboard) the
 * operations run in the isolate that received them. Changes are then queued only
 * behind other changes of the same isolate.
 */

import {
	handleAddSecret,
	handleAdvanceHOTPCounter,
	handleBackupSecrets,
	handleBatchAddSecrets,
	handleCompactHOTPCounters,
	handleDeleteSecret,
	handleGetSecrets,
	handleRestoreBackup,
	handleUpdateSecret,
} from '../api/secrets/index.js';
import { getAllSecrets } from '../api/secrets/shared.js';
import { deleteInactiveHOTPCounterStates, HOTP_COUNTER_EPOCH_KEY, HOTP_COUNTER_STATE_PREFIX } from '../api/secrets/counter-state.js';
import { KV_KEYS } from '../utils/constants.js';
import { createErrorResponse } from '../utils/response.js';
import { getLogger } from '../utils/logger.js';
import { createConsistentKV } from './consistent-kv.js';

export const SECRETS_STORE_OPERATION_HEADER = 'X-2FA-Store-Operation';
const SECRETS_STORE_NAME = 'secrets';
const INTERNAL_URL = 'https://secrets-store.internal/';

/** Keys whose reads must see every earlier write: the secrets document and the HOTP counters. */
export function isSecretsStoreKey(key) {
	return (
		typeof key === 'string' && (key === KV_KEYS.SECRETS || key === HOTP_COUNTER_EPOCH_KEY || key.startsWith(HOTP_COUNTER_STATE_PREFIX))
	);
}

const OPERATIONS = {
	'secrets.list': { readOnly: true, run: (request, env) => handleGetSecrets(env, request) },
	'secrets.add': { run: handleAddSecret },
	'secrets.update': { run: handleUpdateSecret },
	'secrets.delete': { run: handleDeleteSecret },
	'secrets.batch': { run: handleBatchAddSecrets },
	'secrets.counter': { run: handleAdvanceHOTPCounter },
	'secrets.compact': { run: handleCompactHOTPCounters },
	'backup.create': { readOnly: true, run: handleBackupSecrets },
	'backup.restore': { run: handleRestoreBackup },
	// Internal, used by the scheduled job.
	'secrets.snapshot': { readOnly: true, run: async (_request, env) => Response.json(await getAllSecrets(env)) },
	'counters.cleanup': {
		run: async (_request, env) => Response.json({ deleted: await deleteInactiveHOTPCounterStates(env, await getAllSecrets(env)) }),
	},
};

function createSerialQueue() {
	let tail = Promise.resolve();
	return (task) => {
		const run = tail.then(task, task);
		tail = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	};
}

// Background work (remote backup uploads) keeps running while the Durable Object
// has pending I/O, so the store only has to keep rejections from going unhandled.
const detachedContext = {
	waitUntil(promise) {
		Promise.resolve(promise).catch(() => undefined);
	},
};

export class SecretsStore {
	constructor(state, env) {
		this.state = state;
		this.env = {
			...env,
			SECRETS_KV: createConsistentKV({
				kv: env.SECRETS_KV,
				storage: state.storage,
				storeId: state.id.toString(),
				isOwnedKey: isSecretsStoreKey,
				logger: getLogger(env),
			}),
		};
		this.enqueue = createSerialQueue();
	}

	async fetch(request) {
		const name = request.headers.get(SECRETS_STORE_OPERATION_HEADER);
		const operation = Object.hasOwn(OPERATIONS, name) ? OPERATIONS[name] : null;
		if (!operation) {
			return new Response('Unknown secrets store operation', { status: 404 });
		}
		const headers = new Headers(request.headers);
		headers.delete(SECRETS_STORE_OPERATION_HEADER);
		const body = request.method === 'GET' || request.method === 'HEAD' ? null : await request.arrayBuffer();
		const forwarded = new Request(request.url, { method: request.method, headers, body });
		return this.enqueue(async () => {
			try {
				return await operation.run(forwarded, this.env, detachedContext);
			} catch (error) {
				getLogger(this.env).error('密钥存储协调服务处理请求失败', { operation: name, errorMessage: error.message }, error);
				return createErrorResponse('服务器错误', '请求处理失败，请稍后重试', 500, forwarded);
			}
		});
	}
}

const runLocalChange = createSerialQueue();
let missingBindingReported = false;

function runLocally(operation, request, env, ctx) {
	if (!missingBindingReported) {
		missingBindingReported = true;
		getLogger(env).warn('未绑定 SECRETS_STORE（Durable Object），多个实例同时修改密钥时仍可能互相覆盖', {
			hint: '使用仓库中的 wrangler.toml 部署即可创建该绑定',
		});
	}
	return operation.readOnly ? operation.run(request, env, ctx) : runLocalChange(() => operation.run(request, env, ctx));
}

function getStoreStub(env) {
	const namespace = env.SECRETS_STORE;
	return namespace.get(namespace.idFromName(SECRETS_STORE_NAME));
}

/**
 * Run a secrets operation for a request that has already passed authentication.
 *
 * @param {keyof typeof OPERATIONS} name
 * @param {Request} request
 * @param {Object} env
 * @param {Object} [ctx]
 * @returns {Promise<Response>}
 */
export async function runSecretsOperation(name, request, env, ctx) {
	const operation = OPERATIONS[name];
	if (!operation) {
		throw new Error(`未知的密钥存储操作: ${name}`);
	}
	if (!env.SECRETS_STORE) {
		return runLocally(operation, request, env, ctx);
	}

	const body = request.method === 'GET' || request.method === 'HEAD' ? null : await request.arrayBuffer();
	const createRequest = (extraHeaders = {}) => {
		const headers = new Headers(request.headers);
		for (const [key, value] of Object.entries(extraHeaders)) {
			headers.set(key, value);
		}
		return new Request(request.url, { method: request.method, headers, body });
	};

	try {
		return await getStoreStub(env).fetch(createRequest({ [SECRETS_STORE_OPERATION_HEADER]: name }));
	} catch (error) {
		const logger = getLogger(env);
		logger.error('无法连接密钥存储协调服务', { operation: name, errorMessage: error.message }, error);
		if (operation.readOnly) {
			// Reading KV directly can show an older list, but it cannot lose data.
			return operation.run(createRequest(), env, ctx);
		}
		return createErrorResponse('存储服务暂时不可用', '无法确认本次修改是否已保存，请刷新后重试', 503, request);
	}
}

async function fetchInternal(env, operation) {
	const response = await getStoreStub(env).fetch(new Request(INTERNAL_URL, { headers: { [SECRETS_STORE_OPERATION_HEADER]: operation } }));
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`);
	}
	return response.json();
}

/**
 * Delete HOTP counter records that no secret refers to any more. Runs only in the
 * store: elsewhere a change on another instance could make a record active meanwhile.
 *
 * @returns {Promise<number|null>} number of deleted records, or null when skipped
 */
export async function cleanupHOTPCounterStates(env) {
	if (!env.SECRETS_STORE) {
		return null;
	}
	return (await fetchInternal(env, 'counters.cleanup')).deleted;
}

/** Current secrets for work that has no request, such as the scheduled backup. */
export async function readSecretsSnapshot(env) {
	if (!env.SECRETS_STORE) {
		return getAllSecrets(env);
	}
	try {
		return await fetchInternal(env, 'secrets.snapshot');
	} catch (error) {
		getLogger(env).warn('无法通过存储协调服务读取密钥，改为直接读取 KV', { errorMessage: error.message }, error);
		return getAllSecrets(env);
	}
}
