import { Unzip, UnzipInflate } from 'fflate';
import { invariant, ThemeError } from './schema.js';
import { decodeText } from './resources.js';
import { APP_LIMITS, appPath, assertAppFileLimit } from './appSchema.js';

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
	for (let i = 0; i < 8; i++) {
		value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
	}
	return value >>> 0;
});
function crc32(bytes) {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
	}
	return (crc ^ 0xffffffff) >>> 0;
}
function inspect(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let end = -1;
	for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
		if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) {
			end = offset;
			break;
		}
	}
	invariant(end >= 0 && view.getUint16(end + 4, true) === 0 && view.getUint16(end + 6, true) === 0, 'THEME_INVALID_ZIP');
	const count = view.getUint16(end + 10, true);
	const start = view.getUint32(end + 16, true);
	invariant(count > 0 && count <= APP_LIMITS.files && count === view.getUint16(end + 8, true), 'THEME_PACKAGE_LIMIT');
	invariant(start + view.getUint32(end + 12, true) === end, 'THEME_INVALID_ZIP');
	const entries = new Map(),
		aliases = new Set(),
		ranges = [];
	let offset = start,
		expanded = 0;
	for (let index = 0; index < count; index++) {
		invariant(offset + 46 <= end && view.getUint32(offset, true) === 0x02014b50, 'THEME_INVALID_ZIP');
		const flags = view.getUint16(offset + 8, true),
			compression = view.getUint16(offset + 10, true);
		const crc = view.getUint32(offset + 16, true),
			compressed = view.getUint32(offset + 20, true),
			size = view.getUint32(offset + 24, true);
		const nameSize = view.getUint16(offset + 28, true),
			extraSize = view.getUint16(offset + 30, true),
			commentSize = view.getUint16(offset + 32, true);
		const kind = (view.getUint32(offset + 38, true) >>> 16) & 0xf000,
			local = view.getUint32(offset + 42, true);
		invariant(
			(flags & ~0x080e) === 0 && !(flags & 1) && [0, 8].includes(compression) && [0, 0x8000, 0x4000].includes(kind),
			'THEME_UNSUPPORTED_ZIP',
		);
		invariant(view.getUint16(offset + 34, true) === 0 && offset + 46 + nameSize + extraSize + commentSize <= end, 'THEME_INVALID_ZIP');
		const name = decodeText(bytes.subarray(offset + 46, offset + 46 + nameSize));
		const directory = name.endsWith('/'),
			path = appPath(directory ? name.slice(0, -1) : name);
		invariant(!aliases.has(path.toLowerCase()), 'THEME_DUPLICATE_PATH', { path });
		aliases.add(path.toLowerCase());
		invariant(local + 30 <= start && view.getUint32(local, true) === 0x04034b50, 'THEME_INVALID_ZIP');
		const localName = view.getUint16(local + 26, true),
			localExtra = view.getUint16(local + 28, true);
		const dataStart = local + 30 + localName + localExtra;
		invariant(
			dataStart + compressed <= start && decodeText(bytes.subarray(local + 30, local + 30 + localName)) === name,
			'THEME_INVALID_ZIP',
		);
		invariant(view.getUint16(local + 6, true) === flags && view.getUint16(local + 8, true) === compression, 'THEME_INVALID_ZIP');
		if (!(flags & 8)) {
			invariant(
				view.getUint32(local + 14, true) === crc &&
					view.getUint32(local + 18, true) === compressed &&
					view.getUint32(local + 22, true) === size,
				'THEME_INVALID_ZIP',
			);
		}
		if (directory) {
			invariant(size === 0 && compressed <= 2, 'THEME_INVALID_ZIP');
		} else {
			assertAppFileLimit(path, size);
			expanded += size;
			invariant(expanded <= APP_LIMITS.totalBytes, 'THEME_PACKAGE_LIMIT');
		}
		entries.set(name, { path, directory, size, crc });
		ranges.push([local, dataStart + compressed]);
		offset += 46 + nameSize + extraSize + commentSize;
	}
	ranges.sort((a, b) => a[0] - b[0]);
	invariant(
		offset === end && ranges[0][0] === 0 && ranges.every((range, i) => i === 0 || range[0] >= ranges[i - 1][1]),
		'THEME_INVALID_ZIP',
	);
	return entries;
}

export function unpackAppTheme(input) {
	const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
	invariant(bytes.length <= APP_LIMITS.upload, 'THEME_UPLOAD_LIMIT');
	invariant(bytes.length >= 22, 'THEME_INVALID_ZIP');
	const expected = inspect(bytes),
		files = new Map(),
		seen = new Set();
	let total = 0;
	const unzip = new Unzip((entry) => {
		const held = expected.get(entry.name);
		invariant(held && !seen.has(entry.name), 'THEME_INVALID_ZIP');
		seen.add(entry.name);
		if (held.directory) {
			return;
		}
		const chunks = [];
		let size = 0;
		entry.ondata = (error, chunk, final) => {
			invariant(!error, 'THEME_INVALID_ZIP');
			size += chunk.length;
			total += chunk.length;
			invariant(size <= held.size && total <= APP_LIMITS.totalBytes, 'THEME_PACKAGE_LIMIT');
			assertAppFileLimit(held.path, size);
			chunks.push(chunk);
			if (final) {
				invariant(size === held.size, 'THEME_INVALID_ZIP');
				const data = new Uint8Array(size);
				let offset = 0;
				for (const chunk of chunks) {
					data.set(chunk, offset);
					offset += chunk.length;
				}
				invariant(crc32(data) === held.crc, 'THEME_INVALID_ZIP');
				files.set(held.path, data);
			}
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
	invariant(
		seen.size === expected.size && files.size === Array.from(expected.values()).filter((entry) => !entry.directory).length,
		'THEME_INVALID_ZIP',
	);
	return files;
}

export function assertAppPortableBudget(files) {
	invariant(files instanceof Map && files.size > 0 && files.size <= APP_LIMITS.files, 'THEME_APPEARANCE_LIMIT');
	let totalBytes = 0;
	const aliases = new Set();
	for (const [path, bytes] of files) {
		appPath(path);
		invariant(bytes instanceof Uint8Array, 'THEME_MISSING_FILE');
		assertAppFileLimit(path, bytes.length);
		invariant(!aliases.has(path.toLowerCase()), 'THEME_DUPLICATE_PATH');
		aliases.add(path.toLowerCase());
		totalBytes += bytes.length;
	}
	invariant(totalBytes <= APP_LIMITS.totalBytes, 'THEME_APPEARANCE_LIMIT', { totalBytes, fileCount: files.size });
	return { totalBytes, fileCount: files.size };
}
