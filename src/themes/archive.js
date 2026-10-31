import { Unzip, UnzipInflate } from 'fflate';
import { LIMITS, ThemeError, invariant } from './schema.js';
import { cleanPath, decodeText } from './resources.js';

/** Import and export must enforce identical individual-file limits after resource paths are rewritten. */
export function assertArchiveFileLimit(name, bytes) {
	if (/\.css$/i.test(name)) {
		invariant(bytes <= LIMITS.cssBytes, 'THEME_CSS_LIMIT');
	}
	if (/\.json$/i.test(name)) {
		invariant(bytes <= (name === 'appearance.json' ? LIMITS.totalBytes : LIMITS.manifestBytes), 'THEME_MANIFEST_LIMIT');
	}
}

/** Inspect the central directory before decompression: encrypted/linked/duplicate entries are never started. */
function inspectDirectory(bytes, { maxEntries = LIMITS.files + 32, manifestBytes } = {}) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let end = -1;
	for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
		if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) {
			end = offset;
			break;
		}
	}
	invariant(end >= 0, 'THEME_INVALID_ZIP');
	invariant(view.getUint16(end + 4, true) === 0 && view.getUint16(end + 6, true) === 0, 'THEME_INVALID_ZIP');
	const count = view.getUint16(end + 10, true);
	invariant(count <= maxEntries && count === view.getUint16(end + 8, true), 'THEME_PACKAGE_LIMIT');
	const size = view.getUint32(end + 12, true);
	let offset = view.getUint32(end + 16, true);
	invariant(offset + size === end && count !== 65535, 'THEME_INVALID_ZIP');
	const paths = new Set();
	let expanded = 0;
	for (let index = 0; index < count; index++) {
		invariant(offset + 46 <= end && view.getUint32(offset, true) === 0x02014b50, 'THEME_INVALID_ZIP');
		const flags = view.getUint16(offset + 8, true);
		const compression = view.getUint16(offset + 10, true);
		const fileSize = view.getUint32(offset + 24, true);
		const nameSize = view.getUint16(offset + 28, true);
		const extraSize = view.getUint16(offset + 30, true);
		const commentSize = view.getUint16(offset + 32, true);
		const attributes = view.getUint32(offset + 38, true);
		const localOffset = view.getUint32(offset + 42, true);
		invariant(!(flags & 1) && [0, 8].includes(compression), 'THEME_UNSUPPORTED_ZIP');
		const kind = (attributes >>> 16) & 0xf000;
		invariant(kind === 0 || kind === 0x8000 || kind === 0x4000, 'THEME_UNSUPPORTED_ZIP');
		invariant(offset + 46 + nameSize + extraSize + commentSize <= end, 'THEME_INVALID_ZIP');
		const name = decodeText(bytes.subarray(offset + 46, offset + 46 + nameSize));
		const directory = name.endsWith('/');
		const path = cleanPath(directory ? name.slice(0, -1) : name);
		invariant(!paths.has(path), 'THEME_DUPLICATE_PATH', { path });
		paths.add(path);
		invariant(localOffset + 30 <= end && view.getUint32(localOffset, true) === 0x04034b50, 'THEME_INVALID_ZIP');
		const localNameSize = view.getUint16(localOffset + 26, true);
		invariant(
			localOffset + 30 + localNameSize <= end && decodeText(bytes.subarray(localOffset + 30, localOffset + 30 + localNameSize)) === name,
			'THEME_INVALID_ZIP',
		);
		invariant(
			view.getUint16(localOffset + 6, true) === flags && view.getUint16(localOffset + 8, true) === compression,
			'THEME_INVALID_ZIP',
		);
		if (!directory) {
			if (path === '2fa-theme.json' && manifestBytes !== undefined) {
				invariant(fileSize <= manifestBytes, 'THEME_MANIFEST_LIMIT');
			}
			expanded += fileSize;
			invariant(expanded <= LIMITS.totalBytes, 'THEME_PACKAGE_LIMIT');
		}
		offset += 46 + nameSize + extraSize + commentSize;
	}
	invariant(offset === end, 'THEME_INVALID_ZIP');
	return paths;
}

/** Inspect only the manifest to choose a validator, without inflating other files. */
export function readArchiveManifest(bytes, { maxEntries, manifestBytes }) {
	invariant(bytes.length <= LIMITS.upload, 'THEME_UPLOAD_LIMIT');
	invariant(bytes.length >= 22, 'THEME_INVALID_ZIP');
	const expected = inspectDirectory(bytes, { maxEntries, manifestBytes });
	invariant(expected.has('2fa-theme.json'), 'THEME_MISSING_MANIFEST');
	const seen = new Set();
	const chunks = [];
	let size = 0;
	let complete = false;
	const unzip = new Unzip((entry) => {
		const name = cleanPath(entry.name.endsWith('/') ? entry.name.slice(0, -1) : entry.name);
		invariant(expected.has(name) && !seen.has(name), 'THEME_DUPLICATE_PATH', { path: name });
		seen.add(name);
		if (entry.name !== '2fa-theme.json') {
			return;
		}
		entry.ondata = (error, chunk, final) => {
			invariant(!error, 'THEME_INVALID_ZIP');
			size += chunk.length;
			invariant(size <= manifestBytes, 'THEME_MANIFEST_LIMIT');
			chunks.push(chunk);
			complete = final;
		};
		entry.start();
	});
	unzip.register(UnzipInflate);
	try {
		for (let offset = 0; offset < bytes.length; offset += 1024) {
			unzip.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length);
		}
	} catch (error) {
		throw error instanceof ThemeError ? error : new ThemeError('THEME_INVALID_ZIP');
	}
	invariant(complete && seen.size === expected.size, 'THEME_INVALID_ZIP');
	const manifest = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		manifest.set(chunk, offset);
		offset += chunk.length;
	}
	return manifest;
}

export function unpackTheme(bytes, budget) {
	invariant(bytes.length <= LIMITS.upload, 'THEME_UPLOAD_LIMIT');
	invariant(bytes.length >= 22, 'THEME_INVALID_ZIP');
	const expected = inspectDirectory(bytes);
	const files = new Map();
	const seen = new Set();
	let total = 0;
	let failure;
	const unzip = new Unzip((entry) => {
		const directory = entry.name.endsWith('/');
		const name = cleanPath(directory ? entry.name.slice(0, -1) : entry.name);
		invariant(expected.has(name) && !seen.has(name), 'THEME_DUPLICATE_PATH', { path: name });
		seen.add(name);
		if (directory) {
			return;
		}
		invariant(seen.size <= LIMITS.files + 32, 'THEME_PACKAGE_LIMIT');
		invariant(/\.(css|json|png|jpe?g|gif|webp|woff2)$/i.test(name), 'THEME_FILE_TYPE', { path: name });
		const chunks = [];
		let fileBytes = 0;
		entry.ondata = (error, chunk, final) => {
			if (error) {
				failure = new ThemeError('THEME_INVALID_ZIP');
				throw failure;
			}
			total += chunk.length;
			fileBytes += chunk.length;
			invariant(total <= LIMITS.totalBytes, 'THEME_PACKAGE_LIMIT');
			assertArchiveFileLimit(name, fileBytes);
			chunks.push(chunk);
			if (final) {
				const output = new Uint8Array(fileBytes);
				let offset = 0;
				for (const part of chunks) {
					output.set(part, offset);
					offset += part.length;
				}
				budget.countFile('package:' + name, fileBytes);
				files.set(name, output);
			}
		};
		entry.start();
	});
	unzip.register(UnzipInflate);
	try {
		// Small compressed input slices limit transient inflate output before the actual output guard runs.
		for (let offset = 0; offset < bytes.length; offset += 1024) {
			unzip.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length);
		}
	} catch (error) {
		throw error instanceof ThemeError ? error : new ThemeError('THEME_INVALID_ZIP');
	}
	invariant(!failure && seen.size === expected.size && files.size <= LIMITS.files, 'THEME_INVALID_ZIP');
	return files;
}
