#!/usr/bin/env node

// Build the Chrome, Edge and Firefox extensions and zip each one for the GitHub
// Release: dist/2fa-extension-{browser}-{version}.zip. manifest.json sits at the
// archive root, so users can load the extracted folder as an unpacked extension
// in Chrome or Edge, and load the zip itself temporarily in Firefox. The archives
// are reproducible: entries are sorted and carry a fixed timestamp and no
// platform metadata, so the same source always produces the same bytes.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

import { buildExtensions } from './build-extension.js';
import { buildFirefoxExtension } from './build-firefox-extension.js';
import { isMainModule } from './is-main-module.js';
import { EXTENSION_BROWSERS, extensionPackageName } from './release-assets.js';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 1980-01-01 00:00:00, the earliest MS-DOS date a ZIP entry can hold.
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;
// Entry names are UTF-8.
const UTF8_NAMES = 0x0800;
const ZIP_VERSION = 20;
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;

function compareNames(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

function assertEntryName(name) {
	if (
		typeof name !== 'string' ||
		!name ||
		name.startsWith('/') ||
		name.includes('\\') ||
		name.split('/').some((part) => !part || part === '..')
	) {
		throw new Error(`Invalid archive entry name: ${name}`);
	}
}

/**
 * Create a ZIP archive from files given as { name, content } with forward-slash
 * names. Each entry is deflated unless that would not make it smaller.
 * @returns {Buffer}
 */
export function createZip(files) {
	const sorted = [...files].sort((left, right) => compareNames(left.name, right.name));
	if (sorted.length > MAX_UINT16) {
		throw new Error('Too many archive entries');
	}
	const records = [];
	const directory = [];
	let offset = 0;
	for (const [index, { name, content }] of sorted.entries()) {
		assertEntryName(name);
		if (index > 0 && sorted[index - 1].name === name) {
			throw new Error(`Duplicate archive entry: ${name}`);
		}
		const nameBytes = Buffer.from(name, 'utf8');
		const deflated = deflateRawSync(content, { level: 9 });
		const method = deflated.length < content.length ? 8 : 0;
		const data = method === 8 ? deflated : content;
		const checksum = crc32(content);
		if (content.length > MAX_UINT32 || offset > MAX_UINT32) {
			throw new Error('Archive is too large');
		}

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(ZIP_VERSION, 4);
		local.writeUInt16LE(UTF8_NAMES, 6);
		local.writeUInt16LE(method, 8);
		local.writeUInt16LE(DOS_TIME, 10);
		local.writeUInt16LE(DOS_DATE, 12);
		local.writeUInt32LE(checksum, 14);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(content.length, 22);
		local.writeUInt16LE(nameBytes.length, 26);
		records.push(local, nameBytes, data);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(ZIP_VERSION, 4);
		central.writeUInt16LE(ZIP_VERSION, 6);
		central.writeUInt16LE(UTF8_NAMES, 8);
		central.writeUInt16LE(method, 10);
		central.writeUInt16LE(DOS_TIME, 12);
		central.writeUInt16LE(DOS_DATE, 14);
		central.writeUInt32LE(checksum, 16);
		central.writeUInt32LE(data.length, 20);
		central.writeUInt32LE(content.length, 24);
		central.writeUInt16LE(nameBytes.length, 28);
		central.writeUInt32LE(offset, 42);
		directory.push(central, nameBytes);

		offset += local.length + nameBytes.length + data.length;
	}
	const directoryBytes = Buffer.concat(directory);
	if (offset > MAX_UINT32) {
		throw new Error('Archive is too large');
	}
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(sorted.length, 8);
	end.writeUInt16LE(sorted.length, 10);
	end.writeUInt32LE(directoryBytes.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...records, directoryBytes, end]);
}

function listFiles(directory, prefix = '') {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const name = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			files.push(...listFiles(join(directory, entry.name), name));
		} else if (entry.isFile()) {
			files.push(name);
		} else {
			throw new Error(`Unsupported file in extension build: ${name}`);
		}
	}
	return files;
}

/** Zip every file below directory, named relative to it. */
export function zipDirectory(directory) {
	return createZip(listFiles(directory).map((name) => ({ name, content: readFileSync(join(directory, ...name.split('/'))) })));
}

/** Build all three extensions and write their release packages to dist/. */
export async function packageExtensions() {
	const { version } = JSON.parse(readFileSync(join(rootDir, 'extension', 'manifest.base.json'), 'utf8'));
	// Chrome and Edge first: that build clears dist/extension, Firefox included.
	await buildExtensions();
	await buildFirefoxExtension();
	const outputDir = join(rootDir, 'dist');
	mkdirSync(outputDir, { recursive: true });
	const packages = [];
	for (const browser of EXTENSION_BROWSERS) {
		const buildDir = join(outputDir, 'extension', browser);
		const manifest = JSON.parse(readFileSync(join(buildDir, 'manifest.json'), 'utf8'));
		if (manifest.version !== version) {
			throw new Error(`The ${browser} build has version ${manifest.version}, expected ${version}`);
		}
		const path = join(outputDir, extensionPackageName(browser, version));
		writeFileSync(path, zipDirectory(buildDir));
		packages.push({ browser, path });
	}
	return packages;
}

if (isMainModule(import.meta.url)) {
	packageExtensions()
		.then((packages) => {
			for (const { path } of packages) {
				console.log(`Packaged ${relative(rootDir, path)}`);
			}
		})
		.catch((error) => {
			console.error(error.message);
			process.exitCode = 1;
		});
}
