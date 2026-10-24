import { QR_VENDOR_FILES } from './vendor/qrLibraries.js';

/** Versioned same-origin libraries make QR tools available in a complete offline bundle. */
export function createQrVendorResponse(request) {
	const resource = QR_VENDOR_FILES.find((file) => file.path === new URL(request.url).pathname);
	if (!resource || !['GET', 'HEAD'].includes(request.method)) {
		return new Response('Not found', { status: 404 });
	}
	return new Response(request.method === 'HEAD' ? null : resource.source, {
		headers: {
			'Content-Type': resource.mime + '; charset=utf-8',
			'Cache-Control': 'public, max-age=31536000, immutable',
			'X-Content-Type-Options': 'nosniff',
		},
	});
}

export function getQrVendorInventory() {
	return QR_VENDOR_FILES.map(({ path, mime, size, sha256 }) => ({ url: path, mime, size, sha256, role: 'vendor', access: 'public' }));
}
