import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { zipSync } from 'fflate';
import { appThemeFixture, appPng } from '../helpers/app-theme.js';

let runtime;
beforeAll(async () => {
	const bundle = await build({
		stdin: {
			resolveDir: process.cwd(),
			contents: `
import { SecretsStore as Base } from './src/storage/secrets-store.js';
import { handleThemeRequest, handleThemeAssetRequest, handleThemePreviewRequest, revokeThemePreviewOwner, getPublicAppearance } from './src/api/themes.js';
export class SecretsStore extends Base {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/test/write-rate') {
      return Response.json((await this.state.storage.get('theme:rate:write') || []).length);
    }
    if (path === '/test/install') {
      // Installs a test-built ZIP through the same store path as the catalog installer.
      await super.fetch(new Request('https://internal/api/appearance',{headers:{'X-2FA-Theme-Operation':'api'}}));
      const bytes = new Uint8Array(await request.arrayBuffer());
      try {
        return Response.json(await this.themeStore.enqueue(() => this.themeStore.install({bytes,name:'theme.zip'})),{status:201});
      } catch(error) {return Response.json({error:error.code||error.message},{status:error.status||500});}
    }
    if (path === '/test/app-revision') return Response.json((await this.state.storage.get('test:app-revision'))||0);
    if (path === '/test/app-publish') {
      await super.fetch(new Request('https://internal/api/appearance',{headers:{'X-2FA-Theme-Operation':'api'}}));
      const {id,expectedRevision,fail} = await request.json();
      try {
        const revision=await this.state.storage.transaction(async tx => {
          const previous=(await tx.get('test:app-revision'))||0;
          if(previous!==expectedRevision) throw new Error('CAS conflict');
          await this.themeStore.markAppPackagePublic(tx,id);
          await tx.put('test:app-revision',previous+1);
          if(fail) throw new Error('publication interrupted');
          return previous+1;
        });
        return Response.json({revision});
      } catch(error) {return Response.json({error:error.message},{status:409});}
    }
    if (path === '/test/alarm') {
      const entries = await this.state.storage.list({prefix:'theme:blob:'});
      for (const [key,value] of entries) {
        if(value.kind==='asset'||value.kinds?.includes('asset')) await this.state.storage.put(key,{...value,nextAttemptAt:0});
      }
      await this.state.storage.setAlarm(Date.now()+1);
      return Response.json({scheduled:true});
    }
    if(path === '/test/status') {
      return Response.json([...await this.state.storage.list({prefix:'theme:blob:'})].map(([,v])=>({kind:v.kind,kinds:v.kinds,mirrored:v.mirrored,status:v.status})));
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
  request.authDetails={valid:true}; // This test adapter substitutes the production router's auth boundary.
  if (new URL(request.url).pathname === '/test/public') return getPublicAppearance(env).then(value => Response.json(value));
  if (new URL(request.url).pathname === '/test/preview-logout') return revokeThemePreviewOwner(request,env).then(()=>Response.json({ok:true}));
  if (new URL(request.url).pathname.startsWith('/theme-preview/')) return handleThemePreviewRequest(request,env);
  if (new URL(request.url).pathname.startsWith('/theme-assets/') || new URL(request.url).pathname.startsWith('/theme-packages/')) return handleThemeAssetRequest(request, env);
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
	await (await runtime.getKVNamespace('SECRETS_KV')).put('user_password', 'preview-owner-fixture');
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

const png = new Uint8Array(
	Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9S0AAAAASUVORK5CYII=', 'base64'),
);
const encode = (text) => new TextEncoder().encode(text);
const legacyArchive = (id) =>
	zipSync({
		'2fa-theme.json': encode(JSON.stringify({ themeApiVersion: 1, id, name: 'Theme ' + id, version: '1.0.0', styles: 'theme.css' })),
		'theme.css': encode('body{background:url(logo.png)}'),
		'logo.png': png,
	});
async function install(archive) {
	const installed = await runtime.dispatchFetch('https://local.example.com/test/install', { method: 'POST', body: archive });
	expect(installed.status).toBe(201);
	return (await installed.json()).theme;
}
function streamingApply(prefix) {
	let producer;
	const body = new ReadableStream({
		start(controller) {
			producer = controller;
			controller.enqueue(prefix);
		},
	});
	const response = runtime.dispatchFetch('https://local.example.com/api/appearance', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body,
		duplex: 'half',
	});
	return { response, producer };
}

describe('theme storage on real workerd', () => {
	it('commits real app snapshots and receipts through the ordinary HTTP API', async () => {
		const fixture = await appThemeFixture({ 'entry.js': 'export const app=true;', 'assets/logo.png': appPng }, { version: '3.0.0' });
		const theme = await install(fixture.archive);
		const current = await (await request('/api/appearance')).json();
		const body = { packageId: theme.packageId, expectedRevision: current.revision, operationId: crypto.randomUUID() };
		const committed = await request('/api/appearance', body, 'PUT');
		expect(committed.status).toBe(200);
		const saved = await committed.json();
		expect(await (await request('/test/public')).json()).toMatchObject({ kind: 'app', revision: current.revision + 1 });
		expect((await request(saved.active.files[0].url)).status).toBe(200);
		const replayed = await request('/api/appearance', body, 'PUT');
		expect(replayed.status).toBe(200);
		expect(await replayed.json()).toMatchObject({ replayed: true, revision: current.revision + 1, active: saved.active });
		const reused = await request('/api/appearance', { ...body, packageId: 'builtin:compact' }, 'PUT');
		expect(reused.status).toBe(409);
		expect(await reused.json()).toMatchObject({ error: 'THEME_OPERATION_REUSED' });
		const stale = await request('/api/appearance', { ...body, operationId: crypto.randomUUID() }, 'PUT');
		expect(stale.status).toBe(409);
		expect(await stale.json()).toMatchObject({ error: 'THEME_REVISION_CONFLICT' });
		const official = { packageId: 'builtin:document', expectedRevision: saved.revision, operationId: crypto.randomUUID() };
		expect((await request('/api/appearance', official, 'PUT')).status).toBe(200);
	});

	it('registers authenticated opaque capabilities, serves only anonymous scoped bytes, and revokes the owner on logout', async () => {
		const fixture = await appThemeFixture({ 'entry.js': 'export const preview=true;' }, { version: '4.0.0' });
		const theme = await install(fixture.archive);
		const first = await request('/api/themes/preview-capabilities', { packageId: theme.packageId });
		expect(first.status).toBe(201);
		const cap = await first.json();
		const file = await runtime.dispatchFetch('https://local.example.com' + cap.entryUrl, { headers: { Origin: 'null' } });
		expect(file.status).toBe(200);
		expect(await file.text()).toBe('export const preview=true;');
		expect(file.headers.get('Access-Control-Allow-Origin')).toBe('null');
		expect((await runtime.dispatchFetch('https://local.example.com' + cap.entryUrl, { headers: { Cookie: 'auth=private' } })).status).toBe(
			403,
		);
		expect((await request('/theme-packages/' + theme.packageId + '/entry.js')).status).toBe(404);
		expect((await request('/api/themes/' + theme.packageId, undefined, 'DELETE')).status).toBe(409);
		expect((await request('/test/preview-logout', {})).status).toBe(200);
		expect((await request(cap.entryUrl)).status).toBe(410);
		expect((await request('/api/themes/' + theme.packageId, undefined, 'DELETE')).status).toBe(200);
	});

	it('stores hydrated app files in SQLite and atomically publishes only the winning internal CAS transaction', async () => {
		const fixtures = await Promise.all([
			appThemeFixture({
				'entry.js': "export const details=()=>import('./chunks/detail.js');",
				'chunks/detail.js': 'export const detail=42;',
				'licenses/MIT.txt': 'License fixture\n'.repeat(12000),
			}),
			appThemeFixture(undefined, { version: '1.0.1' }),
		]);
		const packages = [];
		for (const fixture of fixtures) {
			packages.push(await install(fixture.archive));
		}
		const path = (pkg) => '/theme-packages/' + pkg.packageId + '/entry.js';
		const first = packages[0];
		expect((await request(path(first))).status).toBe(404);
		expect(await (await request('/api/themes/' + first.packageId + '/files/chunks/detail.js')).text()).toBe('export const detail=42;');
		expect(await (await request('/api/themes/' + first.packageId + '/files/licenses/MIT.txt')).text()).toBe(
			'License fixture\n'.repeat(12000),
		);
		const expectedRevision = await (await request('/test/app-revision')).json();
		expect((await request('/test/app-publish', { id: first.packageId, expectedRevision, fail: true })).status).toBe(409);
		expect((await request(path(first))).status).toBe(404);
		const results = await Promise.all(packages.map((pkg) => request('/test/app-publish', { id: pkg.packageId, expectedRevision })));
		expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
		for (let index = 0; index < packages.length; index++) {
			const resource = await request(path(packages[index]));
			expect(resource.status).toBe(results[index].ok ? 200 : 404);
			if (resource.ok) {
				expect(await resource.text()).toBe(new TextDecoder().decode(fixtures[index].files.get('entry.js')));
				expect(resource.headers.get('Content-Type')).toBe('text/javascript');
				expect(resource.headers.get('Cache-Control')).toContain('immutable');
			}
		}
		expect((await (await request('/api/themes')).json()).themes.some((pkg) => pkg.kind === 'app')).toBe(false);
		const current = await (await request('/api/appearance')).json();
		const published = await request(
			'/api/appearance',
			{ packageId: first.packageId, expectedRevision: current.revision, operationId: crypto.randomUUID() },
			'PUT',
		);
		expect(published.status).toBe(200);
		expect(await published.json()).toMatchObject({ revision: current.revision + 1, active: { packageId: first.packageId, kind: 'app' } });
	});

	it('keeps published app reads available during a real DO suspended request stream', async () => {
		const source = await appThemeFixture(undefined, { version: '2.0.0' });
		const pkg = await install(source.archive);
		const expectedRevision = await (await request('/test/app-revision')).json();
		expect((await request('/test/app-publish', { id: pkg.packageId, expectedRevision })).status).toBe(200);
		const current = await (await request('/api/appearance')).json();
		const text = JSON.stringify({ packageId: 'builtin:fluent', expectedRevision: current.revision, operationId: crypto.randomUUID() });
		const before = await (await request('/test/write-rate')).json();
		const { response, producer } = streamingApply(encode(text.slice(0, 10)));
		try {
			await expect.poll(async () => (await (await request('/test/write-rate')).json()) > before).toBe(true);
			const responses = await Promise.race([
				Promise.all([
					request('/test/public'),
					request('/theme-packages/' + pkg.packageId + '/entry.js'),
					request('/api/themes/' + pkg.packageId + '/files/entry.js'),
				]),
				new Promise((_, reject) => setTimeout(() => reject(new Error('app read blocked')), 1000)),
			]);
			expect(responses.map((item) => item.status)).toEqual([200, 200, 200]);
		} finally {
			producer.enqueue(encode(text.slice(10)));
			producer.close();
		}
		expect((await response).status).toBe(200);
	});

	it('keeps published reads available while a real DO request body remains open', async () => {
		const theme = await install(legacyArchive('workerd-stream'));
		const logo = '/theme-assets/' + theme.assets[0].hash + '/' + theme.assets[0].name;
		const current = await (await request('/api/appearance')).json();
		const published = await (
			await request(
				'/api/appearance',
				{ operationId: 'workerd_stream_publish', expectedRevision: current.revision, packageId: theme.packageId },
				'PUT',
			)
		).json();
		const text = JSON.stringify({ packageId: 'builtin:fluent', expectedRevision: published.revision, operationId: crypto.randomUUID() });
		const before = await (await request('/test/write-rate')).json();
		const { response, producer } = streamingApply(encode(text.slice(0, 10)));
		try {
			await expect.poll(async () => (await (await request('/test/write-rate')).json()) > before).toBe(true);
			const publicResponse = await runtime.dispatchFetch('https://local.example.com/test/public', { signal: AbortSignal.timeout(2000) });
			expect(await publicResponse.json()).toMatchObject({ revision: published.revision, packageId: theme.packageId });
			const image = await runtime.dispatchFetch('https://local.example.com' + logo, { signal: AbortSignal.timeout(2000) });
			expect(new Uint8Array(await image.arrayBuffer())).toEqual(png);
		} finally {
			producer.enqueue(encode(text.slice(10)));
			producer.close();
		}
		expect((await response).status).toBe(200);
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
			packageId: 'builtin:compact',
		};
		const responses = await Promise.all([
			request('/api/appearance', body, 'PUT'),
			request('/api/appearance', { ...body, operationId: 'workerd_apply_other' }, 'PUT'),
		]);
		expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
		const current = await (await request('/api/appearance')).json();
		expect(current).toMatchObject({ revision: revision + 1, active: { packageId: 'builtin:compact' } });
		const successful = responses[0].status === 200 ? body : { ...body, operationId: 'workerd_apply_other' };
		expect((await request('/api/appearance', successful, 'PUT')).status).toBe(200);
	});

	it('runs the persisted alarm through the existing DO class without a user maintenance request', async () => {
		await install(legacyArchive('workerd-alarm'));
		await request('/test/alarm', {});
		await expect
			.poll(
				async () => {
					const status = await (await request('/test/status')).json();
					return status.some((value) => (value.kind === 'asset' || value.kinds?.includes('asset')) && value.mirrored);
				},
				{ timeout: 10000, interval: 50 },
			)
			.toBe(true);
	}, 15000);
});
