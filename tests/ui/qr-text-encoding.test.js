import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { getUtilsCode } from '../../src/ui/scripts/utils.js';

describe('QR text byte encoding', () => {
	it.each(['Fluent 2 中文二维码 🔐', 'otpauth://totp/GitHub?secret=JBSWY3DPEHPK3PXP'])(
		'encodes %s without losing characters',
		async (text) => {
			let payload;
			// Match the generator library contract: addData uses its active byte converter.
			const qrcode = () => ({
				addData: (value) => {
					payload = qrcode.stringToBytes(value);
				},
				make: () => {},
				getModuleCount: () => 21,
				isDark: () => false,
			});
			qrcode.stringToBytes = (value) => Array.from(value, (char) => char.charCodeAt(0) & 255);
			qrcode.stringToBytesFuncs = { 'UTF-8': (value) => Array.from(new TextEncoder().encode(value)) };
			const context = createContext({
				window: {},
				qrcode,
				console: { log: vi.fn(), error: vi.fn() },
				document: {
					createElement: () => ({
						getContext: () => ({ fillRect: () => {} }),
						toDataURL: () => 'data:image/png;base64,test',
					}),
				},
			});
			runInContext(getUtilsCode(), context);
			await context.generateQRCodeDataURL(text);
			expect(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(payload))).toBe(text);
		},
	);
});
