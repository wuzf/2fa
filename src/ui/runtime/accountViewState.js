/** Pure account selection. The host and themes use the same search/group algorithms. */
export function createAccountViewState(ports = {}) {
	const modes = ['grouped', 'flat'];
	const groupSorts = ['name-asc', 'name-desc'];
	const itemSorts = ['oldest-first', 'newest-first', 'name-asc', 'name-desc', 'account-asc', 'account-desc'];
	const groupedSorts = ['oldest-first', 'newest-first', 'account-asc', 'account-desc'];
	const listeners = new Set();
	let revision = 0;
	let state = {
		query: '',
		serviceFilter: null,
		mode: 'grouped',
		groupSort: 'name-asc',
		flatSort: 'oldest-first',
		groupedItemSort: 'oldest-first',
	};
	function freeze(value) {
		if (value && typeof value === 'object') {
			Object.values(value).forEach(freeze);
			Object.freeze(value);
		}
		return value;
	}
	function emit(reason) {
		revision += 1;
		for (const listener of [...listeners]) {
			if (!listeners.has(listener)) {
				continue;
			}
			try {
				listener({ reason, revision });
			} catch (error) {
				ports.onError?.(error);
			}
		}
	}
	function change(patch, persist = true) {
		const next = { ...state, ...patch };
		if (Object.keys(state).every((key) => state[key] === next[key])) {
			return { status: 'unchanged' };
		}
		state = next;
		let persistence = 'saved';
		if (persist) {
			try {
				ports.persist?.({ ...patch }, { ...state });
			} catch (error) {
				persistence = 'failed';
				ports.onError?.(error);
			}
		}
		emit('view');
		return freeze({ status: 'committed', persistence });
	}
	function restore(input = {}) {
		return change(
			{
				query: typeof input.query === 'string' ? input.query.trim().toLowerCase() : state.query,
				serviceFilter: typeof input.serviceFilter === 'string' ? input.serviceFilter : null,
				mode: modes.includes(input.mode) ? input.mode : state.mode,
				groupSort: groupSorts.includes(input.groupSort) ? input.groupSort : state.groupSort,
				flatSort: itemSorts.includes(input.flatSort) ? input.flatSort : state.flatSort,
				groupedItemSort: groupedSorts.includes(input.groupedItemSort) ? input.groupedItemSort : state.groupedItemSort,
			},
			false,
		);
	}
	function sort(items, type) {
		const result = [...items];
		if (type === 'newest-first') {
			return result.reverse();
		}
		if (!['name-asc', 'name-desc', 'account-asc', 'account-desc'].includes(type)) {
			return result;
		}
		const key = type.startsWith('account-') ? 'account' : 'name';
		const direction = type.endsWith('-desc') ? -1 : 1;
		const compare = ports.compareStrings || ((a, b) => a.localeCompare(b, 'zh-CN'));
		return result.sort((a, b) => direction * compare(String(a[key] || '').toLowerCase(), String(b[key] || '').toLowerCase()));
	}
	function derive(records = []) {
		const all = Array.isArray(records) ? records : [];
		const group = ports.groupSecretsByServiceFamily;
		const allGroups = typeof group === 'function' ? group(all, all, state.groupSort) : [];
		const activeGroup = allGroups.find((item) => item.key === state.serviceFilter);
		// A deleted service clears the selection synchronously, without a DOM round trip.
		if (state.serviceFilter && !activeGroup) {
			state = { ...state, serviceFilter: null };
		}
		const matching = ports.filterAccountsByQuery ? ports.filterAccountsByQuery(all, state.query) : all;
		const allowed = activeGroup ? new Set(activeGroup.items.map((item) => String(item.id))) : null;
		const filtered = allowed ? matching.filter((item) => allowed.has(String(item.id))) : matching;
		const sorted = sort(filtered, state.mode === 'grouped' ? state.groupedItemSort : state.flatSort);
		const groups = typeof group === 'function' ? group(sorted, all, state.groupSort) : [];
		return freeze({
			...state,
			revision,
			resultIds: sorted.map((item) => String(item.id)),
			found: sorted.length,
			total: all.length,
			queryFound: matching.length,
			groups: groups.map((item) => ({
				groupId: item.key,
				label: item.name,
				ids: item.items.map((account) => String(account.id)),
				matchedCount: item.matchedCount,
				totalCount: item.totalCount,
				isOther: item.isOther === true,
			})),
			services: allGroups.map((item) => ({
				groupId: item.key,
				label: item.name,
				count: item.totalCount,
				ids: item.items.map((account) => String(account.id)),
				isOther: item.isOther === true,
			})),
		});
	}
	return Object.freeze({
		getState: () => freeze({ ...state, revision }),
		derive,
		sort,
		restore,
		setQuery: (query) =>
			typeof query === 'string' ? change({ query: query.trim().toLowerCase() }, false) : { status: 'rejected', reason: 'invalid-query' },
		setServiceFilter: (groupId) =>
			groupId === null || typeof groupId === 'string'
				? change({ serviceFilter: groupId }, false)
				: { status: 'rejected', reason: 'invalid-service' },
		setMode: (mode) => (modes.includes(mode) ? change({ mode }) : { status: 'rejected', reason: 'invalid-mode' }),
		setSort(options) {
			if (!options || typeof options !== 'object' || Array.isArray(options)) {
				return { status: 'rejected', reason: 'invalid-sort' };
			}
			const valid = { groupSort: groupSorts, flatSort: itemSorts, groupedItemSort: groupedSorts };
			if (Object.keys(options).some((key) => !valid[key]?.includes(options[key]))) {
				return { status: 'rejected', reason: 'invalid-sort' };
			}
			return change(options);
		},
		invalidate: (reason = 'environment') => emit(reason),
		subscribe(listener) {
			if (typeof listener !== 'function') {
				throw new TypeError('listener');
			}
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		dispose() {
			listeners.clear();
		},
	});
}
