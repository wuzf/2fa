import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { getModuleCode } from '../../src/ui/scripts/index.js';
import { getSharedTransferMessageLocalizerCode } from '../../src/ui/scripts/transferMessages.js';

describe('shared multilingual diagnostic payload budget', () => {
	it.each(['backup', 'qrcode', 'googleMigration'])(
		'keeps the %s feature small without its former repeated translation catalog',
		(moduleName) => {
			// Before sharing the catalog each module was ~1.4 MiB raw / 300 KiB gzip.
			// Allow room for ordinary feature changes while catching a catalog copy.
			const source = getModuleCode(moduleName);
			expect(Buffer.byteLength(source)).toBeLessThan(100 * 1024);
			expect(gzipSync(source).length).toBeLessThan(25 * 1024);
		},
	);
	it('keeps the shared catalog below its former single-module payload by reusing UI translations', () => {
		const source = getSharedTransferMessageLocalizerCode();
		expect(Buffer.byteLength(source)).toBeLessThan(400 * 1024);
		expect(gzipSync(source).length).toBeLessThan(100 * 1024);
	});
});
