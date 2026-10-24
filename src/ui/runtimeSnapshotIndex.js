/** Independent durable index; existing v1 workers never upgrade or mutate this database. */
export function createRuntimeSnapshotIndex(database = indexedDB) {
	const initial = () => ({
		generation: 0,
		candidates: {},
		complete: {},
		active: null,
		previous: null,
		startupValidated: null,
		pins: {},
		deleting: {},
		activation: null,
		workerProtocol: {},
	});
	async function transact(change) {
		const db = await new Promise((resolve, reject) => {
			const open = database.open('2fa-runtime-snapshots-v2', 1);
			open.onupgradeneeded = () => open.result.createObjectStore('state');
			open.onsuccess = () => resolve(open.result);
			open.onerror = () => reject(open.error);
		});
		return new Promise((resolve, reject) => {
			const transaction = db.transaction('state', change ? 'readwrite' : 'readonly');
			const store = transaction.objectStore('state');
			const request = store.get('index');
			let result;
			let failure;
			request.onsuccess = () => {
				try {
					const state = request.result || initial();
					result = change ? change(state) : state;
					if (result && typeof result.then === 'function') {
						throw new Error('Index mutations must be synchronous');
					}
					if (change) {
						store.put(state, 'index');
					}
				} catch (error) {
					failure = error;
					transaction.abort();
				}
			};
			transaction.oncomplete = () => {
				db.close();
				resolve(result);
			};
			transaction.onabort = transaction.onerror = () => {
				db.close();
				reject(failure || transaction.error || new Error('Runtime index transaction failed'));
			};
		});
	}
	return { read: () => transact(), update: (change) => transact(change) };
}
