#!/usr/bin/env node

// Rasterize the existing PWA artwork: Chromium requires PNG extension icons.
// Run only when the PWA artwork changes; ordinary extension builds use these assets.
// @playwright/test is the declared dependency; it re-exports the browser launchers.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDefaultIcon } from '../src/ui/manifest.js';

const assetDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../extension/assets');
await mkdir(assetDirectory, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
	const page = await browser.newPage();
	for (const size of [16, 32, 48, 128]) {
		const svg = await createDefaultIcon(size).text();
		const png = await page.evaluate(
			async ({ svg, size }) => {
				const blob = new Blob([svg], { type: 'image/svg+xml' });
				const url = URL.createObjectURL(blob);
				try {
					const icon = new globalThis.Image();
					icon.src = url;
					await icon.decode();
					const canvas = document.createElement('canvas');
					canvas.width = canvas.height = size;
					canvas.getContext('2d').drawImage(icon, 0, 0, size, size);
					return canvas.toDataURL('image/png').split(',')[1];
				} finally {
					URL.revokeObjectURL(url);
				}
			},
			{ svg, size },
		);
		await writeFile(resolve(assetDirectory, `icon-${size}.png`), Buffer.from(png, 'base64'));
	}
	await writeFile(resolve(assetDirectory, 'icon.svg'), await createDefaultIcon(128).text());
} finally {
	await browser.close();
}
console.log('Extension icons generated from the existing PWA artwork.');
