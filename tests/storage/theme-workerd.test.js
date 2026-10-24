import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

let runtime;
beforeAll(async () => {
	const bundle = await build({
		stdin: {
			resolveDir: process.cwd(),
			contents: `
import { SecretsStore as Base } from './src/storage/secrets-store.js';
import { handleThemeRequest, handleThemeAssetRequest, getPublicAppearance } from './src/api/themes.js';
export class SecretsStore extends Base {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/test/write-rate') {
      return Response.json((await this.state.storage.get('theme:rate:import') || []).length);
    }
    if (path === '/test/alarm') {
      const entries = await this.state.storage.list({prefix:'theme:blob:'});
      for (const [key,value] of entries) {
        if(value.kind==='asset') await this.state.storage.put(key,{...value,nextAttemptAt:0});
      }
      await this.state.storage.setAlarm(Date.now()+1);
      return Response.json({scheduled:true});
    }
    if(path === '/test/status') {
      return Response.json([...await this.state.storage.list({prefix:'theme:blob:'})].map(([,v])=>({kind:v.kind,mirrored:v.mirrored,status:v.status})));
    }
    if(path === '/test/chunks') {
      await super.fetch(new Request('https://internal/api/appearance',{headers:{'X-2FA-Theme-Operation':'api'}}));
      const saved=await this.themeStore.saveDocument({value:'x'.repeat(300000)});
      const read=await this.themeStore.readDocument(saved.hash);
      return Response.json({chunks:saved.chunks,length:read.value.length});
    }
    return super.fetch(request);
  }
}
export default {fetch(request,env) {
  if (new URL(request.url).pathname === '/test/public') return getPublicAppearance(env).then(value => Response.json(value));
  if (new URL(request.url).pathname.startsWith('/theme-assets/')) return handleThemeAssetRequest(request, env);
  if (new URL(request.url).pathname.startsWith('/test/')) {
    return env.SECRETS_STORE.get(env.SECRETS_STORE.idFromName('appearance:v1')).fetch(request);
  }
  return handleThemeRequest(request,env);
}};`,
		},
		bundle: true,
		format: 'esm',
		platform: 'browser',
		write: false,
		target: 'es2022',
	});
	runtime = new Miniflare({
		modules: true,
		script: bundle.outputFiles[0].text,
		compatibilityDate: '2025-10-01',
		durableObjects: { SECRETS_STORE: { className: 'SecretsStore', useSQLite: true } },
		kvNamespaces: ['SECRETS_KV'],
	});
	await runtime.ready;
}, 60000);

afterAll(async () => {
	await runtime?.dispose();
});

const request = (path, body, method = body === undefined ? 'GET' : 'POST') =>
	runtime.dispatchFetch('https://local.example.com' + path, {
		method,
		headers: { 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	});

describe('theme storage on real workerd', () => {
	it('keeps published reads available while a real DO request body remains open', async () => {
		const png = new Uint8Array(
			Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9S0AAAAASUVORK5CYII=', 'base64'),
		);
		const upload = await runtime.dispatchFetch('https://local.example.com/api/appearance/assets', {
			method: 'POST',
			headers: { 'Content-Type': 'image/png', 'X-File-Name': 'logo.png' },
			body: png,
		});
		const { asset } = await upload.json();
		const logo = '/theme-assets/' + asset.hash + '/' + asset.name;
		const current = await (await request('/api/appearance')).json();
		const published = await (
			await request(
				'/api/appearance',
				{
					operationId: 'workerd_stream_publish',
					expectedRevision: current.revision,
					packageId: 'builtin:fluent',
					branding: { name: 'Streaming proof', logo },
				},
				'PUT',
			)
		).json();
		const before = await (await request('/test/write-rate')).json();
		let controller;
		const body = new ReadableStream({
			start(value) {
				controller = value;
				value.enqueue(new TextEncoder().encode('body{color:red}'));
			},
		});
		const installing = runtime.dispatchFetch('https://local.example.com/api/themes/import', {
			method: 'POST',
			headers: { 'Content-Type': 'text/css', 'X-File-Name': 'theme.css' },
			body,
			duplex: 'half',
		});
		try {
			await expect.poll(async () => (await (await request('/test/write-rate')).json()) > before).toBe(true);
			const publicResponse = await runtime.dispatchFetch('https://local.example.com/test/public', { signal: AbortSignal.timeout(2000) });
			expect(await publicResponse.json()).toMatchObject({ revision: published.revision, branding: { name: 'Streaming proof', logo } });
			const image = await runtime.dispatchFetch('https://local.example.com' + logo, { signal: AbortSignal.timeout(2000) });
			expect(new Uint8Array(await image.arrayBuffer())).toEqual(png);
		} finally {
			controller.close();
		}
		expect((await installing).status).toBe(201);
	});
	it('stores documents larger than the real per-value limit in bounded chunks', async () => {
		const response = await request('/test/chunks');
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ chunks: 3, length: 300000 });
	});

	it('commits publication atomically and handles concurrent revisions with real transactions', async () => {
		const revision = (await (await request('/api/appearance')).json()).revision;
		const body = {
			operationId: 'workerd_apply_first',
			expectedRevision: revision,
			packageId: 'builtin:fluent',
			branding: { name: 'Workerd' },
		};
		const responses = await Promise.all([
			request('/api/appearance', body, 'PUT'),
			request('/api/appearance', { ...body, operationId: 'workerd_apply_other' }, 'PUT'),
		]);
		expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
		const current = await (await request('/api/appearance')).json();
		expect(current).toMatchObject({ revision: revision + 1, active: { branding: { name: 'Workerd' } } });
		const successful = responses[0].status === 200 ? body : { ...body, operationId: 'workerd_apply_other' };
		expect((await request('/api/appearance', successful, 'PUT')).status).toBe(200);
	});

	it('runs the persisted alarm through the existing DO class without a user maintenance request', async () => {
		const png = new Uint8Array(
			Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9S0AAAAASUVORK5CYII=', 'base64'),
		);
		const uploaded = await runtime.dispatchFetch('https://local.example.com/api/appearance/assets', {
			method: 'POST',
			headers: { 'Content-Type': 'image/png', 'X-File-Name': 'logo.png' },
			body: png,
		});
		expect(uploaded.status).toBe(201);
		await request('/test/alarm', {});
		await expect
			.poll(
				async () => {
					const status = await (await request('/test/status')).json();
					return status.some((value) => value.kind === 'asset' && value.mirrored);
				},
				{ timeout: 10000, interval: 50 },
			)
			.toBe(true);
	}, 15000);
});
