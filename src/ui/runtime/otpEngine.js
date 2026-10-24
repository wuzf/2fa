/** The existing OTP algorithm, shared by browser and no-DOM hosts. */
export function createOtpCalculator({ clock, crypto: cryptoProvider, cacheNow = () => Date.now(), diagnostics = console }) {
	class OTPCalculator {
		constructor() {
			this.cache = new Map(); // 缓存计算结果
			this.cacheTimeout = 1000; // 缓存1秒
		}

		// 获取当前时间窗口
		getCurrentTimeWindow(period = 30) {
			const currentTime = Math.floor(clock.now() / 1000);
			return Math.floor(currentTime / period);
		}

		// 获取下一个时间窗口
		getNextTimeWindow(period = 30) {
			return this.getCurrentTimeWindow(period) + 1;
		}

		// 获取剩余时间
		getRemainingTime(period = 30) {
			const currentTime = Math.floor(clock.now() / 1000);
			const currentWindow = this.getCurrentTimeWindow(period);
			const nextRefresh = (currentWindow + 1) * period;
			return Math.max(0, nextRefresh - currentTime);
		}

		// 生成缓存键
		getCacheKey(secret, counter, options) {
			return secret + '_' + counter + '_' + options.digits + '_' + options.algorithm;
		}

		// HOTP 计数器必须能被 JavaScript 精确表示；offset 用于预计算下一个验证码。
		getHOTPCounter(secret, offset = 0) {
			const counter = secret && secret.counter !== undefined ? secret.counter : 0;
			if (!Number.isSafeInteger(counter) || counter < 0) {
				throw new RangeError('HOTP counter must be a non-negative safe integer');
			}

			const resolvedCounter = counter + offset;
			if (!Number.isSafeInteger(resolvedCounter) || resolvedCounter < 0) {
				throw new RangeError('HOTP counter increment exceeds the safe integer range');
			}
			return resolvedCounter;
		}

		// RFC 4226 使用 8 字节大端计数器，不能只写低 32 位。
		getCounterBytes(counter) {
			if (!Number.isSafeInteger(counter) || counter < 0) {
				throw new RangeError('OTP counter must be a non-negative safe integer');
			}

			const counterBytes = new ArrayBuffer(8);
			const counterView = new DataView(counterBytes);
			const high = Math.floor(counter / 0x100000000);
			const low = counter % 0x100000000;
			counterView.setUint32(0, high, false);
			counterView.setUint32(4, low, false);
			return counterBytes;
		}

		// 检查缓存
		getCachedResult(cacheKey) {
			const cached = this.cache.get(cacheKey);
			if (cached && cacheNow() - cached.timestamp < this.cacheTimeout) {
				return cached.value;
			}
			return null;
		}

		// 设置缓存
		setCachedResult(cacheKey, value) {
			this.cache.set(cacheKey, {
				value,
				timestamp: cacheNow(),
			});
		}

		clearCache() {
			this.cache.clear();
		}

		// 计算当前OTP
		async calculateCurrentOTP(secret) {
			const options = {
				digits: secret.digits || 6,
				algorithm: secret.algorithm || 'SHA1',
			};

			try {
				const isHOTP = String(secret.type || 'TOTP').toUpperCase() === 'HOTP';
				const counter = isHOTP ? this.getHOTPCounter(secret) : this.getCurrentTimeWindow(secret.period || 30);
				const cacheKey = this.getCacheKey(secret.secret, counter, options);
				const cached = this.getCachedResult(cacheKey);
				if (cached) {
					return cached;
				}

				const token = await this.generateTOTP(secret.secret, counter, options);
				this.setCachedResult(cacheKey, token);
				return token;
			} catch (error) {
				diagnostics.error('计算当前OTP失败:', error);
				return '-'.repeat(options.digits);
			}
		}

		// 计算下一个OTP
		async calculateNextOTP(secret) {
			const options = {
				digits: secret.digits || 6,
				algorithm: secret.algorithm || 'SHA1',
			};

			try {
				const isHOTP = String(secret.type || 'TOTP').toUpperCase() === 'HOTP';
				const counter = isHOTP ? this.getHOTPCounter(secret, 1) : this.getNextTimeWindow(secret.period || 30);
				const cacheKey = this.getCacheKey(secret.secret, counter, options);
				const cached = this.getCachedResult(cacheKey);
				if (cached) {
					return cached;
				}

				const token = await this.generateTOTP(secret.secret, counter, options);
				this.setCachedResult(cacheKey, token);
				return token;
			} catch (error) {
				diagnostics.error('计算下一个OTP失败:', error);
				return '-'.repeat(options.digits);
			}
		}

		// 生成TOTP（统一入口）
		async generateTOTP(secret, counter, options = {}) {
			try {
				// 检查cryptoProvider.subtle支持
				if (!cryptoProvider || !cryptoProvider.subtle) {
					diagnostics.warn('cryptoProvider.subtle not supported, using fallback');
					return this.generateTOTPFallback(secret, counter, options);
				}

				// 映射算法名称
				const hashAlgMap = {
					SHA1: 'SHA-1',
					'SHA-1': 'SHA-1',
					SHA256: 'SHA-256',
					'SHA-256': 'SHA-256',
					SHA512: 'SHA-512',
					'SHA-512': 'SHA-512',
				};

				const hashAlg = hashAlgMap[options.algorithm?.toUpperCase()] || 'SHA-1';
				const key = this.base32Decode(secret);
				const counterBytes = this.getCounterBytes(counter);

				return cryptoProvider.subtle
					.importKey('raw', key, { name: 'HMAC', hash: hashAlg }, false, ['sign'])
					.then((cryptoKey) => cryptoProvider.subtle.sign('HMAC', cryptoKey, counterBytes))
					.then((signature) => {
						const hmac = new Uint8Array(signature);
						const offset = hmac[hmac.length - 1] & 0x0f;
						const binary =
							((hmac[offset] & 0x7f) << 24) |
							((hmac[offset + 1] & 0xff) << 16) |
							((hmac[offset + 2] & 0xff) << 8) |
							(hmac[offset + 3] & 0xff);
						const modulus = Math.pow(10, options.digits || 6);
						const otp = binary % modulus;
						return otp.toString().padStart(options.digits || 6, '0');
					})
					.catch((error) => {
						diagnostics.warn('cryptoProvider.subtle failed, using fallback:', error);
						return this.generateTOTPFallback(secret, counter, options);
					});
			} catch (error) {
				diagnostics.warn('TOTP generation error, using fallback:', error);
				return this.generateTOTPFallback(secret, counter, options);
			}
		}

		// 备用TOTP生成函数（纯JavaScript实现）
		generateTOTPFallback(secret, counter, options = {}) {
			try {
				const digits = options.digits || 6;
				const algorithm = options.algorithm || 'SHA1';

				// 使用纯JavaScript的HMAC实现
				const key = this.base32Decode(secret);
				const counterBytes = this.getCounterBytes(counter);

				// 简化的HMAC-SHA1实现
				const hmac = this.simpleHMAC(key, new Uint8Array(counterBytes), algorithm);
				const offset = hmac[hmac.length - 1] & 0x0f;
				const binary =
					((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
				const modulus = Math.pow(10, digits);
				const otp = binary % modulus;
				return otp.toString().padStart(digits, '0');
			} catch (error) {
				diagnostics.error('Fallback TOTP generation error:', error);
				return '-'.repeat(options.digits || 6);
			}
		}

		// 简化的HMAC实现
		simpleHMAC(key, message, _algorithm) {
			// 这是一个简化的实现，仅用于SHA1
			const blockSize = 64;
			const keyBytes = new Uint8Array(key);
			const keyArray = new Uint8Array(blockSize);

			if (keyBytes.length > blockSize) {
				// 简化处理：直接截断
				keyArray.set(keyBytes.slice(0, blockSize));
			} else {
				keyArray.set(keyBytes);
			}

			// 创建ipad和opad
			const ipad = new Uint8Array(blockSize);
			const opad = new Uint8Array(blockSize);

			for (let i = 0; i < blockSize; i++) {
				ipad[i] = keyArray[i] ^ 0x36;
				opad[i] = keyArray[i] ^ 0x5c;
			}

			// 创建消息
			const innerMessage = new Uint8Array(blockSize + message.length);
			innerMessage.set(ipad);
			innerMessage.set(message, blockSize);

			// 使用简化的SHA1实现
			const hash1 = this.simpleSHA1(innerMessage);
			const outerMessage = new Uint8Array(blockSize + 20);
			outerMessage.set(opad);
			outerMessage.set(hash1, blockSize);
			return this.simpleSHA1(outerMessage);
		}

		// 简化的SHA1实现
		simpleSHA1(message) {
			const msg = new Uint8Array(message);
			const msgLength = msg.length;
			const bitLength = msgLength * 8;

			// 添加填充
			const paddedLength = Math.ceil((msgLength + 9) / 64) * 64;
			const padded = new Uint8Array(paddedLength);
			padded.set(msg);
			padded[msgLength] = 0x80;

			// 添加长度（64位）
			const lengthBytes = new ArrayBuffer(8);
			const lengthView = new DataView(lengthBytes);
			lengthView.setUint32(0, Math.floor(bitLength / 0x100000000), false);
			lengthView.setUint32(4, bitLength & 0xffffffff, false);
			padded.set(new Uint8Array(lengthBytes), paddedLength - 8);

			// 初始化哈希值
			let h0 = 0x67452301;
			let h1 = 0xefcdab89;
			let h2 = 0x98badcfe;
			let h3 = 0x10325476;
			let h4 = 0xc3d2e1f0;

			// 处理每个512位块
			for (let i = 0; i < paddedLength; i += 64) {
				const chunk = padded.slice(i, i + 64);
				const words = new Array(80);

				// 将块转换为16个32位字
				for (let j = 0; j < 16; j++) {
					words[j] = (chunk[j * 4] << 24) | (chunk[j * 4 + 1] << 16) | (chunk[j * 4 + 2] << 8) | chunk[j * 4 + 3];
				}

				// 扩展16个字到80个字
				for (let j = 16; j < 80; j++) {
					words[j] = this.rotateLeft(words[j - 3] ^ words[j - 8] ^ words[j - 14] ^ words[j - 16], 1);
				}

				// 初始化哈希值
				let a = h0,
					b = h1,
					c = h2,
					d = h3,
					e = h4;

				// 主循环
				for (let j = 0; j < 80; j++) {
					let f, k;
					if (j < 20) {
						f = (b & c) | (~b & d);
						k = 0x5a827999;
					} else if (j < 40) {
						f = b ^ c ^ d;
						k = 0x6ed9eba1;
					} else if (j < 60) {
						f = (b & c) | (b & d) | (c & d);
						k = 0x8f1bbcdc;
					} else {
						f = b ^ c ^ d;
						k = 0xca62c1d6;
					}

					const temp = (this.rotateLeft(a, 5) + f + e + k + words[j]) >>> 0;
					e = d;
					d = c;
					c = this.rotateLeft(b, 30);
					b = a;
					a = temp;
				}

				// 添加到哈希值
				h0 = (h0 + a) >>> 0;
				h1 = (h1 + b) >>> 0;
				h2 = (h2 + c) >>> 0;
				h3 = (h3 + d) >>> 0;
				h4 = (h4 + e) >>> 0;
			}

			// 返回哈希值
			const result = new Uint8Array(20);
			const view = new DataView(result.buffer);
			view.setUint32(0, h0, false);
			view.setUint32(4, h1, false);
			view.setUint32(8, h2, false);
			view.setUint32(12, h3, false);
			view.setUint32(16, h4, false);
			return result;
		}

		// 左旋转函数
		rotateLeft(value, amount) {
			return ((value << amount) | (value >>> (32 - amount))) >>> 0;
		}

		// Base32解码函数
		base32Decode(encoded) {
			const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
			const cleanInput = encoded.toUpperCase().replace(/=+$/, '');

			let bits = '';
			for (let i = 0; i < cleanInput.length; i++) {
				const char = cleanInput[i];
				const index = alphabet.indexOf(char);
				if (index === -1) {
					continue;
				}
				bits += index.toString(2).padStart(5, '0');
			}

			// 移除填充位
			const padding = bits.length % 8;
			if (padding > 0) {
				bits = bits.slice(0, -padding);
			}

			const bytes = [];
			for (let i = 0; i < bits.length; i += 8) {
				const byte = bits.slice(i, i + 8);
				if (byte.length === 8) {
					bytes.push(parseInt(byte, 2));
				}
			}

			return new Uint8Array(bytes);
		}
	}

	return new OTPCalculator();
}

/**
 * Authoritative committed OTP state. All effects are injected: this factory has
 * no dependency on account nodes, animation frames, or presentation timers.
 */
export function createOtpEngine({ accounts, clock, calculator, timers = {}, diagnostics = console }) {
	const committed = new Map();
	const requests = new Map();
	const listeners = new Set();
	const frames = [];
	const tickets = new WeakMap();
	const retries = new Map();
	const schedule = timers.setInterval || globalThis.setInterval.bind(globalThis);
	const unschedule = timers.clearInterval || globalThis.clearInterval.bind(globalThis);
	let activeIds = null;
	let revision = 0;
	let sequence = 0;
	let timer = null;
	let suspended = false;
	let disposed = false;
	let notifying = false;

	const key = (id) => String(id);
	const generation = () => clock.getGeneration();
	const monotonicNow = () => clock.monotonicNow();
	const windowFor = (period) => Math.floor(clock.now() / (period * 1000));
	const isToken = (value, digits) => typeof value === 'string' && value.length === digits && /^[0-9]+$/.test(value);
	function contextFor(id) {
		const source = accounts.getRecord(id);
		if (!source || disposed) {
			return null;
		}
		const sessionGeneration = accounts.getSessionGeneration();
		if (!accounts.isSessionCurrent(sessionGeneration)) {
			return null;
		}
		const record = { ...source };
		const kind = String(record.type || 'TOTP').toUpperCase();
		const period = Number(record.period) || 30;
		return {
			record,
			accountId: record.id,
			sessionGeneration,
			accountGeneration: accounts.getAccountGeneration(record.id),
			kind,
			period,
			digits: Number(record.digits) || 6,
			counter: kind === 'HOTP' ? (record.counter === undefined ? 0 : record.counter) : null,
			namespace: kind === 'HOTP' ? record.hotpCounterNamespace || null : null,
			window: kind === 'HOTP' ? null : windowFor(period),
			clockGeneration: kind === 'HOTP' ? null : generation(),
		};
	}
	function sameAccount(left, right) {
		return !!(
			left &&
			right &&
			left.sessionGeneration === right.sessionGeneration &&
			left.accountGeneration === right.accountGeneration &&
			left.kind === right.kind &&
			left.period === right.period &&
			left.digits === right.digits &&
			left.counter === right.counter &&
			left.namespace === right.namespace &&
			left.record.secret === right.record.secret &&
			left.record.algorithm === right.record.algorithm
		);
	}
	function sameContext(left, right) {
		return sameAccount(left, right) && left.window === right.window && left.clockGeneration === right.clockGeneration;
	}
	function validContext(context) {
		return sameContext(context, contextFor(context.accountId));
	}
	function notify(changes, reason) {
		if (!changes.length) {
			return;
		}
		const frame = Object.freeze({ revision: ++revision, reason, changes: Object.freeze(changes.map((change) => Object.freeze(change))) });
		frames.push(frame);
		if (notifying) {
			return;
		}
		notifying = true;
		try {
			while (frames.length) {
				const next = frames.shift();
				for (const listener of [...listeners]) {
					if (!listeners.has(listener)) {
						continue;
					}
					try {
						listener(next);
					} catch (error) {
						try {
							diagnostics.warn('OTP observer failed', error);
						} catch {
							/* Diagnostics cannot undo a commit. */
						}
					}
				}
			}
		} finally {
			notifying = false;
		}
	}
	function result(status, id, reason = null) {
		return Object.freeze({ status, accountId: id, reason, revision });
	}
	function cancel(request, reason = 'superseded') {
		if (!request || request.settled) {
			return;
		}
		request.cancelled = true;
		stage(request, { status: 'superseded', reason });
	}
	function createBatch(reason = 'refresh') {
		return { reason, tasks: [], pending: 0, sealed: false, flushed: false };
	}
	function flushBatch(batch) {
		if (!batch.sealed || batch.pending || batch.flushed) {
			return;
		}
		batch.flushed = true;
		const changes = [];
		const outcomes = batch.tasks.map((request) => commit(request, changes));
		notify(changes, batch.reason);
		batch.tasks.forEach((request, index) => finish(request, outcomes[index]));
	}
	function sealBatch(batch) {
		if (!batch) {
			return;
		}
		batch.sealed = true;
		flushBatch(batch);
	}
	function stage(request, candidate) {
		if (request.settled) {
			return;
		}
		if (request.staged) {
			if (request.cancelled) {
				request.candidate = candidate;
			}
			return;
		}
		request.staged = true;
		request.candidate = candidate;
		if (request.batch) {
			request.batch.pending -= 1;
			flushBatch(request.batch);
		} else {
			const changes = [];
			const outcome = commit(request, changes);
			notify(changes, request.reason);
			finish(request, outcome);
		}
	}
	function finish(request, outcome) {
		if (request.settled) {
			return;
		}
		request.settled = true;
		if (requests.get(key(request.context.accountId)) === request) {
			requests.delete(key(request.context.accountId));
		}
		request.resolve(Object.freeze({ ...outcome, revision }));
	}
	function commit(request, changes) {
		const context = request.context;
		const id = context.accountId;
		const candidate = request.candidate;
		if (request.cancelled || requests.get(key(id)) !== request || !validContext(context)) {
			return result('superseded', id, 'context-changed');
		}
		if (!candidate || candidate.status !== 'calculated') {
			return result('superseded', id, candidate?.reason || 'context-changed');
		}
		const beforeEntry = committed.get(key(id));
		const before = beforeEntry?.record || null;
		if (!isToken(candidate.current, context.digits) || !isToken(candidate.next, context.digits)) {
			committed.delete(key(id));
			changes.push({ id, before, after: null, digits: context.digits, error: 'calculation-failed' });
			return result('failed', id, 'calculation-failed');
		}
		if (
			beforeEntry &&
			sameContext(beforeEntry.context, context) &&
			before.current === candidate.current &&
			before.next === candidate.next
		) {
			return result('committed', id, 'unchanged');
		}
		const record = Object.freeze({
			accountId: id,
			computeGeneration: request.sequence,
			kind: context.kind,
			current: candidate.current,
			next: candidate.next,
			digits: context.digits,
			period: context.period,
			window: context.window,
			clockGeneration: context.clockGeneration,
			counter: context.counter,
			sessionGeneration: context.sessionGeneration,
			accountGeneration: context.accountGeneration,
			revision: revision + 1,
			committedAt: clock.now(),
		});
		committed.set(key(id), { record, context });
		changes.push({ id, before, after: record });
		return result('committed', id);
	}
	async function calculate(request) {
		for (let attempt = 0; attempt < (request.context.kind === 'HOTP' ? 1 : 3); attempt += 1) {
			const context = request.context;
			try {
				const [current, next] = await Promise.all([
					calculator.calculateCurrentOTP(context.record),
					calculator.calculateNextOTP(context.record),
				]);
				if (request.cancelled || requests.get(key(context.accountId)) !== request) {
					return;
				}
				const latest = contextFor(context.accountId);
				if (!sameAccount(context, latest)) {
					return stage(request, { status: 'superseded', reason: 'account-changed' });
				}
				if (!sameContext(context, latest)) {
					request.context = latest;
					continue;
				}
				stage(request, { status: 'calculated', current, next });
				return;
			} catch (error) {
				diagnostics.warn('OTP calculation failed', error);
				stage(request, { status: 'calculated', current: null, next: null });
				return;
			}
		}
		stage(request, { status: 'superseded', reason: 'unstable-clock' });
	}
	function refreshOne(id, { batch = null, reason = 'refresh' } = {}) {
		const context = contextFor(id);
		if (!context) {
			return Promise.resolve(result('superseded', id, disposed ? 'disposed' : 'account-unavailable'));
		}
		const existing = requests.get(key(id));
		if (existing && sameContext(existing.context, context) && (!batch || existing.batch)) {
			return existing.promise;
		}
		if (existing) {
			cancel(existing);
		}
		let resolve;
		const promise = new Promise((accept) => {
			resolve = accept;
		});
		const effectiveBatch = batch && !batch.sealed && !batch.flushed ? batch : null;
		const request = {
			context,
			batch: effectiveBatch,
			reason,
			promise,
			resolve,
			sequence: ++sequence,
			staged: false,
			settled: false,
			cancelled: false,
		};
		if (effectiveBatch) {
			effectiveBatch.tasks.push(request);
			effectiveBatch.pending += 1;
		}
		requests.set(key(id), request);
		// Invoke crypto immediately; no animation frame is involved in committing its result.
		calculate(request);
		return promise;
	}
	function refresh(ids = null, options = {}) {
		const candidates = ids === null ? accounts.getRecords().map((record) => record.id) : [...ids];
		const batch = createBatch(options.reason || 'refresh');
		const tasks = [...new Set(candidates.map(key))].map((id) => refreshOne(id, { batch, reason: batch.reason }));
		sealBatch(batch);
		return Promise.all(tasks).then((outcomes) =>
			Object.freeze({
				status: outcomes.every((outcome) => outcome.status === 'committed') ? 'committed' : 'partial',
				revision,
				outcomes: Object.freeze(outcomes),
			}),
		);
	}
	function readCommitted(id) {
		const entry = committed.get(key(id));
		return entry && validContext(entry.context) ? entry.record : null;
	}
	function readCopyTarget(id, slot = 'current') {
		if (slot !== 'current' && slot !== 'next') {
			return Object.freeze({ status: 'not-ready', reason: 'invalid-slot' });
		}
		const record = readCommitted(id);
		if (!record) {
			return Object.freeze({ status: 'not-ready', reason: 'uncommitted' });
		}
		if (record.kind === 'HOTP' && slot !== 'current') {
			return Object.freeze({ status: 'not-ready', reason: 'unsupported-slot' });
		}
		const target = Object.freeze({
			accountId: record.accountId,
			slot,
			value: record[slot],
			revision: record.revision,
			sessionGeneration: record.sessionGeneration,
			accountGeneration: record.accountGeneration,
			window: record.window,
			clockGeneration: record.clockGeneration,
			counter: record.counter,
		});
		tickets.set(target, record);
		return Object.freeze({ status: 'ready', target });
	}
	function validateCopyTarget(target) {
		const issued = target && typeof target === 'object' ? tickets.get(target) : null;
		if (!issued) {
			return Object.freeze({ status: 'not-ready', reason: 'invalid-target' });
		}
		if (readCommitted(issued.accountId) !== issued) {
			return Object.freeze({ status: 'not-ready', reason: 'stale-target' });
		}
		return Object.freeze({ status: 'ready', target });
	}
	function reconcileAccounts(change = {}) {
		const changes = [];
		const validIds = new Set(accounts.getRecords().map((record) => key(record.id)));
		for (const id of retries.keys()) {
			if (!validIds.has(id)) {
				retries.delete(id);
			}
		}
		if (activeIds !== null) {
			for (const id of activeIds) {
				if (!validIds.has(id)) {
					activeIds.delete(id);
				}
			}
		}
		for (const [id, entry] of committed) {
			if (!sameAccount(entry.context, contextFor(id))) {
				committed.delete(id);
				retries.delete(id);
				changes.push({ id: entry.record.accountId, before: entry.record, after: null });
			}
		}
		for (const request of [...requests.values()]) {
			if (!sameAccount(request.context, contextFor(request.context.accountId))) {
				cancel(request, 'account-changed');
			}
		}
		notify(changes, change.reason || 'accounts-changed');
		if (!demandedIds().length) {
			if (timer !== null) {
				unschedule(timer);
			}
			timer = null;
		} else {
			start();
		}
	}
	function demandedIds() {
		return activeIds === null ? accounts.getRecords().map((record) => record.id) : [...activeIds];
	}
	function tick() {
		if (disposed || suspended) {
			return;
		}
		const batch = createBatch('window');
		for (const id of demandedIds()) {
			const context = contextFor(id);
			if (!context || readCommitted(id)) {
				continue;
			}
			let retry = retries.get(key(id));
			if (!retry || !sameContext(retry.context, context)) {
				retry = { context, count: 0, deadline: 0, pending: null };
				retries.set(key(id), retry);
			}
			if (retry.pending || retry.count >= 5 || monotonicNow() < retry.deadline) {
				continue;
			}
			const promise = refreshOne(id, { batch, reason: 'window' });
			retry.pending = promise;
			promise.then((outcome) => {
				if (retries.get(key(id)) !== retry || retry.pending !== promise) {
					return;
				}
				retry.pending = null;
				if (outcome.status === 'committed' && readCommitted(id)) {
					retry.count = 0;
					retry.deadline = 0;
				} else {
					retry.count += 1;
					retry.deadline = monotonicNow() + Math.min(1000 * 2 ** (retry.count - 1), 8000);
				}
			});
		}
		sealBatch(batch);
	}
	function start() {
		if (disposed || suspended || timer !== null || !demandedIds().length) {
			return;
		}
		try {
			timer = schedule(tick, 250);
		} catch (error) {
			// The fallback remains a core timer, independent of progress elements.
			diagnostics.warn('OTP scheduler registration failed', error);
			try {
				timer = schedule(tick, 1000);
			} catch (fallbackError) {
				diagnostics.warn('OTP fallback scheduler failed', fallbackError);
			}
		}
	}
	function suspend() {
		suspended = true;
		if (timer !== null) {
			unschedule(timer);
		}
		timer = null;
	}
	function setActiveIds(ids) {
		activeIds = ids === null ? null : new Set([...ids].map(key));
		suspended = false;
		if (!demandedIds().length) {
			if (timer !== null) {
				unschedule(timer);
			}
			timer = null;
		} else {
			start();
		}
	}
	function activate(id) {
		if (activeIds !== null) {
			activeIds.add(key(id));
		}
		suspended = false;
		start();
	}
	function resume(reason = 'resume') {
		suspended = false;
		reconcileAccounts({ reason });
		tick();
	}
	function clockChanged() {
		const changes = [];
		for (const [id, entry] of committed) {
			if (entry.context.kind === 'HOTP') {
				continue;
			}
			committed.delete(id);
			changes.push({ id: entry.record.accountId, before: entry.record, after: null, invalidateOnly: true });
		}
		for (const request of [...requests.values()]) {
			if (request.context.kind !== 'HOTP') {
				cancel(request, 'clock-changed');
			}
		}
		retries.clear();
		calculator.clearCache();
		notify(changes, 'clock-changed');
		const ids = demandedIds().filter((id) => String(accounts.getRecord(id)?.type || 'TOTP').toUpperCase() !== 'HOTP');
		const task = refresh(ids, { reason: 'clock-changed' });
		// Reserve retry state before a following scheduler tick can duplicate the refresh.
		for (const id of ids) {
			const context = contextFor(id);
			const retry = { context, count: 0, deadline: 0, pending: task };
			retries.set(key(id), retry);
			task.then(() => {
				if (retries.get(key(id)) !== retry) {
					return;
				}
				retry.pending = null;
				if (!readCommitted(id)) {
					retry.count = 1;
					retry.deadline = monotonicNow() + 1000;
				}
			});
		}
		return task;
	}
	const unsubscribe = accounts.subscribe(reconcileAccounts, { phase: 'internal' });
	function dispose() {
		if (disposed) {
			return;
		}
		disposed = true;
		suspend();
		unsubscribe();
		for (const request of [...requests.values()]) {
			cancel(request, 'disposed');
		}
		requests.clear();
		committed.clear();
		retries.clear();
		listeners.clear();
	}
	return Object.freeze({
		reconcileAccounts,
		refresh,
		refreshOne,
		createBatch,
		sealBatch,
		readCommitted,
		readCopyTarget,
		validateCopyTarget,
		setActiveIds,
		activate,
		resume,
		suspend,
		clockChanged,
		tick,
		dispose,
		isScheduled: (id) => !suspended && timer !== null && (activeIds === null || activeIds.has(key(id))),
		subscribeCommits(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	});
}
