import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { crc32, inflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import { createZip, zipDirectory } from '../../scripts/package-extensions.js';
import { EXTENSION_BROWSERS, extensionPackageName, releaseAssetNames, WORKER_ASSET_NAMES } from '../../scripts/release-assets.js';

// Reads an archive through its central directory, the way unzip tools and
// browsers do, and checks each local header against it.
function readZip(archive) {
	const endOffset = archive.length - 22;
	expect(archive.readUInt32LE(endOffset)).toBe(0x06054b50);
	const count = archive.readUInt16LE(endOffset + 10);
	const directorySize = archive.readUInt32LE(endOffset + 12);
	const directoryOffset = archive.readUInt32LE(endOffset + 16);
	expect(directoryOffset + directorySize).toBe(endOffset);
	const entries = [];
	let cursor = directoryOffset;
	for (let index = 0; index < count; index += 1) {
		expect(archive.readUInt32LE(cursor)).toBe(0x02014b50);
		const flags = archive.readUInt16LE(cursor + 8);
		const method = archive.readUInt16LE(cursor + 10);
		const time = archive.readUInt16LE(cursor + 12);
		const date = archive.readUInt16LE(cursor + 14);
		const checksum = archive.readUInt32LE(cursor + 16);
		const compressedSize = archive.readUInt32LE(cursor + 20);
		const size = archive.readUInt32LE(cursor + 24);
		const nameLength = archive.readUInt16LE(cursor + 28);
		const extraLength = archive.readUInt16LE(cursor + 30);
		const commentLength = archive.readUInt16LE(cursor + 32);
		const localOffset = archive.readUInt32LE(cursor + 42);
		const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
		cursor += 46 + nameLength + extraLength + commentLength;

		expect(archive.readUInt32LE(localOffset)).toBe(0x04034b50);
		expect(archive.readUInt16LE(localOffset + 8)).toBe(method);
		expect(archive.readUInt32LE(localOffset + 14)).toBe(checksum);
		const localNameLength = archive.readUInt16LE(localOffset + 26);
		const localExtraLength = archive.readUInt16LE(localOffset + 28);
		expect(archive.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString('utf8')).toBe(name);
		const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
		const data = archive.subarray(dataOffset, dataOffset + compressedSize);
		const content = method === 8 ? inflateRawSync(data) : Buffer.from(data);
		expect(method === 0 || method === 8).toBe(true);
		expect(content.length).toBe(size);
		expect(crc32(content)).toBe(checksum);
		entries.push({ name, flags, method, time, date, content: content.toString('utf8') });
	}
	expect(cursor).toBe(endOffset);
	return entries;
}

let directory;

afterEach(() => {
	if (directory && dirname(resolve(directory)) === resolve(tmpdir()) && basename(directory).startsWith('2fa-package-extensions-')) {
		rmSync(directory, { recursive: true, force: true });
	}
	directory = null;
});

describe('extension release archives', () => {
	it('stores every file with its content, sorted by name, with UTF-8 names and a fixed date', () => {
		const archive = createZip([
			{ name: 'popup.js', content: Buffer.from('console.log("popup");\n'.repeat(50)) },
			{ name: '_locales/zh_CN/messages.json', content: Buffer.from('{"name":{"message":"2FA 验证助手"}}\n') },
			{ name: 'manifest.json', content: Buffer.from('{"manifest_version":3}\n') },
		]);
		const entries = readZip(archive);
		expect(entries.map(({ name }) => name)).toEqual(['_locales/zh_CN/messages.json', 'manifest.json', 'popup.js']);
		expect(entries[0].content).toBe('{"name":{"message":"2FA 验证助手"}}\n');
		expect(entries[2].content).toBe('console.log("popup");\n'.repeat(50));
		for (const entry of entries) {
			expect(entry.flags).toBe(0x0800);
			expect(entry.time).toBe(0);
			expect(entry.date).toBe(0x21);
		}
		expect(entries[2].method).toBe(8);
	});

	it('produces the same bytes for the same files in any order', () => {
		const files = [
			{ name: 'b.txt', content: Buffer.from('second') },
			{ name: 'a.txt', content: Buffer.from('first') },
		];
		expect(createZip(files).equals(createZip([...files].reverse()))).toBe(true);
	});

	it('stores content uncompressed when deflating would not make it smaller', () => {
		const [entry] = readZip(createZip([{ name: 'tiny.txt', content: Buffer.from('x') }]));
		expect(entry.method).toBe(0);
		expect(entry.content).toBe('x');
	});

	it.each(['', '/manifest.json', '../manifest.json', 'icons/../manifest.json', 'icons\\icon.png', 'icons//icon.png', 'icons/'])(
		'rejects the unsafe entry name %j',
		(name) => {
			expect(() => createZip([{ name, content: Buffer.from('x') }])).toThrow('Invalid archive entry name');
		},
	);

	it('rejects duplicate entry names', () => {
		const file = { name: 'manifest.json', content: Buffer.from('{}') };
		expect(() => createZip([file, file])).toThrow('Duplicate archive entry');
	});

	it('zips a build directory with manifest.json at the archive root and forward-slash names', () => {
		directory = mkdtempSync(join(tmpdir(), '2fa-package-extensions-'));
		mkdirSync(join(directory, 'icons'));
		mkdirSync(join(directory, '_locales', 'en'), { recursive: true });
		writeFileSync(join(directory, 'manifest.json'), '{"version":"1.1.1"}\n');
		writeFileSync(join(directory, 'icons', 'icon-16.png'), 'png');
		writeFileSync(join(directory, '_locales', 'en', 'messages.json'), '{}\n');
		const entries = readZip(zipDirectory(directory));
		expect(entries.map(({ name }) => name)).toEqual(['_locales/en/messages.json', 'icons/icon-16.png', 'manifest.json']);
		expect(entries.find(({ name }) => name === 'manifest.json').content).toBe('{"version":"1.1.1"}\n');
	});
});

describe('release asset names', () => {
	it('names one package per browser after the extension version', () => {
		expect(EXTENSION_BROWSERS).toEqual(['chrome', 'edge', 'firefox']);
		expect(releaseAssetNames('1.1.1')).toEqual([
			...WORKER_ASSET_NAMES,
			'2fa-extension-chrome-1.1.1.zip',
			'2fa-extension-edge-1.1.1.zip',
			'2fa-extension-firefox-1.1.1.zip',
		]);
	});

	it.each(['', '1.1.1-beta', '01.1.1', '1.2.3.4.5', '../1.1.1', '1.1.1/x', 1])('rejects the extension version %j', (version) => {
		expect(() => extensionPackageName('chrome', version)).toThrow('Extension version');
	});

	it('rejects an unknown browser', () => {
		expect(() => extensionPackageName('safari', '1.1.1')).toThrow('Unsupported browser target');
	});
});
