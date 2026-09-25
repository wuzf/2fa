import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function realpathOrNull(path) {
	try {
		return realpathSync(path);
	} catch {
		return null;
	}
}

/**
 * Whether the module at moduleUrl is the script Node was started with.
 *
 * Node resolves the entry module's symlinks and Windows junctions before loading
 * it, so import.meta.url holds the real path while process.argv[1] keeps the path
 * as typed. Comparing the two directly fails when the project is opened through a
 * junction or symlink and silently skips the script's main code. Compare real paths
 * instead; the argument may also omit the extension, as Node allows.
 */
export function isMainModule(moduleUrl, entryArgument = process.argv[1]) {
	if (!entryArgument) {
		return false;
	}
	const modulePath = realpathOrNull(fileURLToPath(moduleUrl));
	const entryPath = resolve(entryArgument);
	return (
		modulePath !== null && [entryPath, `${entryPath}.js`, `${entryPath}.mjs`].some((candidate) => realpathOrNull(candidate) === modulePath)
	);
}
