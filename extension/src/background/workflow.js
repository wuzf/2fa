import { chooseAutoFillAccountId, readAccountEmail } from '../shared/account-match.js';
import { usesLoginEmailScope } from '../shared/login-context.js';
import { MESSAGE, sanitizeAccountList, sanitizeAccountMetadata } from '../shared/protocol.js';
import { hasAutofillSite } from '../shared/autofill-sites.js';
import {
	findBindings,
	getPendingFlow,
	getConnectionStatus,
	getFavoriteIds,
	removeBinding,
	rememberBinding,
	savePendingFlow,
	updatePendingFlow,
} from '../shared/storage.js';
import { getConfigurationGeneration } from './generation.js';
import { ExtensionError, throwFromResponse } from './errors.js';
import { requireSettings, requireInstancePermission, validateFlowConfiguration, assertCurrentGeneration } from './configuration.js';
import { sendDocumentMessage } from './browser-access.js';
import { captureTarget, validateCapturedTarget, claimPendingFlow, consumeClaim, discardClaim, prepareTarget } from './target-session.js';
import {
	requestSource,
	generateForAccount,
	validateSourceClock,
	validateGeneratedSource,
	validateAutomaticSource,
	validateGeneratedCode,
} from './source-service.js';

// Keep the background's existing operation API stable while implementation
// modules depend only on the narrower services above, never on this facade.
export { ExtensionError } from './errors.js';
export { validateFlowConfiguration, assertCurrentGeneration } from './configuration.js';
export { openInstance, sendDocumentMessage } from './browser-access.js';
export { getAutofillContext } from './target-session.js';
export { requestSource, generateForAccount, checkInstance } from './source-service.js';
export {
	refreshOfflineAccounts,
	importWebOfflineCache,
	disableOfflineCache,
	getOfflineCacheStatus,
	getOfflineCacheIcons,
} from './offline-management.js';

export async function startFlow({ refreshSource = false, preferCache = false } = {}) {
	const configurationGeneration = getConfigurationGeneration();
	const { instanceOrigin } = await requireSettings();
	await requireInstancePermission(instanceOrigin);
	const flow = await captureTarget(instanceOrigin, configurationGeneration);
	await savePendingFlow(flow);
	const rawAccounts = await requestSource(flow, 'list', {
		withDiagnostics: true,
		...(refreshSource ? { refresh: true } : {}),
		...(preferCache ? { preferCache: true } : {}),
	});
	flow.sourceRevision = rawAccounts?.sourceRevision ?? null;
	flow.sourceClockRevision = rawAccounts?.sourceClockRevision ?? null;
	flow.sourceChangeToken = rawAccounts?.sourceChangeToken ?? null;
	flow.sourceRefreshPending = rawAccounts?.sourceRefreshPending === true;
	const unavailableAccounts = rawAccounts?.unavailableAccounts || [];
	const connection = await getConnectionStatus(instanceOrigin);
	const accounts = sanitizeAccountList(rawAccounts?.accounts || rawAccounts);
	if (!accounts) {
		throw new ExtensionError('INVALID_RESPONSE');
	}
	await validateFlowConfiguration(flow);
	await validateCapturedTarget(flow);
	if ((await getPendingFlow())?.nonce !== flow.nonce) {
		throw new ExtensionError('REQUEST_EXPIRED');
	}

	const bindings = flow.viewOnly ? [] : await findBindings(instanceOrigin, flow.targetOrigin);
	const accountIds = new Set(accounts.map((account) => account.id));
	const boundAccountIds = [];
	const retainedBindingIds = [];
	for (const binding of bindings) {
		if (accountIds.has(binding.accountId)) {
			boundAccountIds.push(binding.accountId);
			retainedBindingIds.push(binding.accountId);
		} else if (connection.mode === 'session' && !unavailableAccounts.some((account) => account.id === binding.accountId)) {
			await removeBinding(instanceOrigin, flow.targetOrigin, binding.accountId);
		} else {
			retainedBindingIds.push(binding.accountId);
		}
	}

	const autoFillAccountId = flow.sourceRefreshPending
		? null
		: chooseAutoFillAccountId({ ...flow, accounts, boundAccountIds, retainedBindingIds, unavailableAccounts });
	// On a website that tells accounts apart by login email, remembering one
	// account replaces only bindings of accounts recording the same email. Keep
	// those emails from the instance data for this flow; the page's own email
	// is never stored in bindings.
	const bindingAccountEmails = usesLoginEmailScope(flow.targetOrigin)
		? Object.fromEntries(
				bindings.flatMap((binding) => {
					const account = accounts.find((item) => item.id === binding.accountId);
					return account ? [[binding.accountId, readAccountEmail(account.account)]] : [];
				}),
			)
		: {};
	await updatePendingFlow((current) => {
		if (!current || current.nonce !== flow.nonce || current.claimed) {
			throw new ExtensionError('REQUEST_EXPIRED');
		}
		return {
			...current,
			autoFillAccountId,
			...(Object.keys(bindingAccountEmails).length ? { bindingAccountEmails } : {}),
			sourceRevision: flow.sourceRevision,
			sourceClockRevision: flow.sourceClockRevision,
			sourceChangeToken: flow.sourceChangeToken,
			sourceRefreshPending: flow.sourceRefreshPending,
		};
	});
	await validateFlowConfiguration(flow);
	await validateCapturedTarget(flow);
	return {
		nonce: flow.nonce,
		configurationGeneration,
		sourceRevision: rawAccounts?.sourceRevision ?? null,
		sourceClockRevision: flow.sourceClockRevision,
		...(flow.sourceRefreshPending ? { sourceRefreshPending: true } : {}),
		...(flow.loginContext ? { loginContext: flow.loginContext } : {}),
		autoFillAccountId,
		canFill: !flow.viewOnly,
		authMode: connection.mode,
		...(rawAccounts?.offlineStatus ? { offlineStatus: rawAccounts.offlineStatus } : {}),
		...(rawAccounts?.serviceIcons ? { serviceIcons: rawAccounts.serviceIcons } : {}),
		instanceOrigin,
		targetOrigin: flow.targetOrigin,
		targetPath: flow.targetPath,
		targetTabId: flow.targetTabId,
		targetDocumentId: flow.targetDocumentId,
		accounts,
		unavailableAccounts,
		favoriteAccountIds: await getFavoriteIds(instanceOrigin),
		boundAccountIds,
		boundAccountId: boundAccountIds.length === 1 ? boundAccountIds[0] : null,
	};
}

export async function fillAccount(
	{ nonce, account: rawAccount, remember = false, confirmFocused = false, automatic = false },
	{ userCommand = false } = {},
) {
	const account = sanitizeAccountMetadata(rawAccount);
	if (!account) {
		throw new ExtensionError('INVALID_REQUEST');
	}
	if (typeof confirmFocused !== 'boolean' || typeof automatic !== 'boolean') {
		throw new ExtensionError('INVALID_REQUEST');
	}
	const flow = await claimPendingFlow(nonce);
	try {
		if (flow.viewOnly) {
			throw new ExtensionError('TARGET_UNAVAILABLE');
		}
		if (automatic && flow.autoFillAccountId !== account.id) {
			throw new ExtensionError('AMBIGUOUS_ACCOUNT');
		}
		if (automatic) {
			validateAutomaticSource(flow);
			flow.assertAutomaticTarget = async () => {
				if (!userCommand && !(await hasAutofillSite(flow.instanceOrigin, flow.targetOrigin, flow.targetPath))) {
					throw new ExtensionError('PERMISSION_REQUIRED', 'error_AUTOFILL_NOT_ENABLED');
				}
				await validateCapturedTarget(flow);
				validateAutomaticSource(flow);
				assertCurrentGeneration(flow);
			};
			await flow.assertAutomaticTarget();
		}
		await prepareTarget(flow, account, confirmFocused);
		let generationSource;
		const generated = await generateForAccount(
			flow,
			account,
			false,
			(source) => {
				generationSource = source;
			},
			{ automatic },
		);
		await validateCapturedTarget(flow);
		await flow.assertAutomaticTarget?.();
		await consumeClaim(flow);
		if (generated.expiresAt - Date.now() < 1000) {
			throw new ExtensionError('CODE_EXPIRED');
		}
		// No await between this check and dispatch: settings/permission events
		// invalidate the generation synchronously before their asynchronous work.
		assertCurrentGeneration(flow);
		validateSourceClock(flow);
		validateGeneratedSource(flow, generationSource);
		if (automatic) {
			validateAutomaticSource(flow);
		}

		const response = await sendDocumentMessage(
			flow.targetTabId,
			flow.targetDocumentId,
			{
				type: MESSAGE.FILL_CODE,
				nonce: flow.nonce,
				expectedOrigin: flow.targetOrigin,
				expectedTargetPath: flow.targetPath,
				code: generated.code,
				expiresAt: generated.expiresAt,
			},
			'TARGET_CHANGED',
		);
		if (!response?.ok || response.status !== 'filled') {
			throwFromResponse(response, 'FILL_FAILED');
		}

		if (automatic) {
			return { status: 'filled', targetOrigin: flow.targetOrigin };
		}
		if (remember) {
			// The remembered account replaces the website's other bindings so
			// automatic choice stays unique. Where accounts are told apart by login
			// email, it replaces only bindings of accounts with its own email.
			const emails = flow.bindingAccountEmails || {};
			await rememberBinding(
				{ instanceOrigin: flow.instanceOrigin, targetOrigin: flow.targetOrigin, accountId: account.id },
				usesLoginEmailScope(flow.targetOrigin)
					? {
							scopeOf: (accountId) =>
								accountId === account.id
									? readAccountEmail(account.account)
									: Object.hasOwn(emails, accountId)
										? emails[accountId]
										: undefined,
						}
					: {},
			);
		} else {
			await removeBinding(flow.instanceOrigin, flow.targetOrigin, account.id);
		}
		return { status: 'filled', targetOrigin: flow.targetOrigin };
	} finally {
		await discardClaim(nonce);
	}
}

export async function copyAccountCode({ nonce, account: rawAccount, includeNext = false }) {
	const account = sanitizeAccountMetadata(rawAccount);
	if (!account || typeof includeNext !== 'boolean') {
		throw new ExtensionError('INVALID_REQUEST');
	}
	const flow = await claimPendingFlow(nonce);
	let generated;
	let generationSource;
	try {
		generated = await generateForAccount(flow, account, includeNext, (source) => {
			generationSource = source;
		});
		await consumeClaim(flow);
	} finally {
		await discardClaim(nonce);
	}
	// Finish all storage work before the last document check; cleanup can yield
	// long enough for the target to navigate while a preview response is pending.
	await validateCapturedTarget(flow);
	if (generated.expiresAt - Date.now() < 1000) {
		throw new ExtensionError('CODE_EXPIRED');
	}
	assertCurrentGeneration(flow);
	validateSourceClock(flow);
	validateGeneratedSource(flow, generationSource);
	return generated;
}

export async function fillBoundAccountFromCommand() {
	const state = await startFlow({ refreshSource: true });
	const account = state.accounts.find((item) => item.id === state.autoFillAccountId);
	if (account) {
		// Only the browser command handler sets this internal option. Runtime
		// message properties cannot bypass automatic page authorization.
		return fillAccount({ nonce: state.nonce, account, automatic: true }, { userCommand: true });
	}
	throw new ExtensionError('AMBIGUOUS_ACCOUNT');
}

export async function copyAccountCodes({ nonce, accounts: rawAccounts, includeNext = false }) {
	const accounts = sanitizeAccountList(rawAccounts);
	if (!accounts?.length || accounts.length > 32 || typeof includeNext !== 'boolean') {
		throw new ExtensionError('INVALID_REQUEST');
	}
	const flow = await claimPendingFlow(nonce);
	let results;
	let generationSource;
	const startedWallTime = Date.now();
	const startedAt = performance.now();
	try {
		results = await requestSource(flow, 'generateMany', { accounts, includeNext }, (source) => {
			generationSource = source;
		});
		await consumeClaim(flow);
	} finally {
		await discardClaim(nonce);
	}
	await validateCapturedTarget(flow);
	assertCurrentGeneration(flow);
	validateSourceClock(flow);
	validateGeneratedSource(flow, generationSource);
	if (!Array.isArray(results) || results.length !== accounts.length) {
		throw new ExtensionError('INVALID_RESPONSE');
	}
	const receivedAt = Date.now();
	const timing = { startedWallTime, receivedAt, elapsedMs: performance.now() - startedAt };
	return results.map((result, index) => {
		if (result?.id !== accounts[index].id) {
			throw new ExtensionError('INVALID_RESPONSE');
		}
		if (result.error) {
			return { id: result.id, error: { code: result.error.code, message: result.error.message, messageKey: result.error.messageKey } };
		}
		return { id: result.id, ...validateGeneratedCode(result, accounts[index].digits, timing, includeNext) };
	});
}
