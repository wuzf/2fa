import { createNonce } from '../shared/protocol.js';

// A worker restart also invalidates pending user actions. This token is not a credential.
let generation = createNonce();

export function getConfigurationGeneration() {
	return generation;
}

export function invalidateConfigurationGeneration() {
	generation = createNonce();
}
