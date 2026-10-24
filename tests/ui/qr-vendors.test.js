import { createContext, runInContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { QR_VENDOR_FILES } from '../../src/ui/vendor/qrLibraries.js';
import { createQrVendorResponse, getQrVendorInventory } from '../../src/ui/qrVendors.js';

describe('same-origin QR dependencies', () => {
	it('serves exactly the pinned browser bytes for offline inventory and SRI', async () => {
		for (const file of QR_VENDOR_FILES) {
			const response = createQrVendorResponse(new Request('https://vault.test' + file.path));
			const bytes = new Uint8Array(await response.arrayBuffer());
			expect('sha384-' + createHash('sha384').update(bytes).digest('base64')).toBe(file.integrity);
			expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
			expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
			expect(getQrVendorInventory().find((entry) => entry.url === file.path)).toMatchObject({ size: bytes.length, access: 'public' });
		}
		expect(createQrVendorResponse(new Request('https://vault.test/vendor/unknown.js')).status).toBe(404);
	});
	it('actually generates and decodes an authenticator QR using only bundled libraries', () => {
		const context = createContext({});
		for (const file of QR_VENDOR_FILES) {
			runInContext(file.source, context);
		}
		const content = 'otpauth://totp/Pixel:test?secret=JBSWY3DPEHPK3PXP&issuer=Pixel';
		const qr = context.qrcode(0, 'M');
		qr.addData(content);
		qr.make();
		const count = qr.getModuleCount();
		const scale = 5;
		const size = (count + 8) * scale;
		const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
		for (let y = 0; y < count; y++) {
			for (let x = 0; x < count; x++) {
				if (!qr.isDark(y, x)) {
					continue;
				}
				for (let dy = 0; dy < scale; dy++) {
					for (let dx = 0; dx < scale; dx++) {
						const offset = (((y + 4) * scale + dy) * size + (x + 4) * scale + dx) * 4;
						pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
					}
				}
			}
		}
		expect(context.jsQR(pixels, size, size)?.data).toBe(content);
	});
});
