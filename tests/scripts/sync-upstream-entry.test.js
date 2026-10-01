import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const read = (name) => readFileSync(join(projectRoot, name), 'utf8').replace(/\r\n/g, '\n');
const entry = read('.github/sync-upstream-entry.yml');
const workflow = read('.github/workflows/sync-upstream.yml');
// One-click repositories add the entry through GitHub's "create file" page, filled from this link.
const link = `https://github.com/OWNER/REPO/new/main?filename=.github/workflows/sync-upstream.yml&value=${encodeURIComponent(entry)}`;
// The translated READMEs live in docs/<language>/README.md.
const translations = readdirSync(join(projectRoot, 'docs'), { withFileTypes: true })
	.filter((entry) => entry.isDirectory() && existsSync(join(projectRoot, 'docs', entry.name, 'README.md')))
	.map((entry) => `docs/${entry.name}/README.md`);
const documents = ['README.md', ...translations, 'docs/DEPLOYMENT.md'];

describe('Sync Upstream entry for one-click repositories', () => {
	it('calls the upstream workflow with the dispatch input', () => {
		expect(entry).toMatch(/^name: Sync Upstream$/m);
		expect(entry).toContain('uses: wuzf/2fa/.github/workflows/sync-upstream.yml@main');
		expect(entry).toContain('upstream_ref: ${{ inputs.upstream_ref }}');
		expect(entry).toMatch(/^permissions:\n {2}contents: write$/m);
	});

	it('leaves concurrency to the called workflow', () => {
		// GitHub cancels a run whose caller and called workflow share a concurrency group.
		expect(entry).not.toContain('concurrency');
		expect(workflow).toMatch(/^concurrency:\n {2}group: sync-upstream$/m);
	});

	it('is accepted by the upstream workflow', () => {
		expect(workflow).toMatch(/\n {2}workflow_call:\n {4}inputs:\n {6}upstream_ref:\n( {8}.+\n)* {8}type: string\n/);
		expect(workflow).toMatch(/\n {2}workflow_dispatch:\n/);
	});

	it('is linked from every README and the upgrade guide', () => {
		expect(documents).toHaveLength(16);
		for (const name of documents) {
			const text = read(name);
			expect(text, name).toContain(link);
			expect(text, name).toContain('https://github.com/wuzf/2fa/blob/main/.github/sync-upstream-entry.yml');
			expect(text, name).not.toContain('https://github.com/wuzf/2fa/blob/main/.github/workflows/sync-upstream.yml');
		}
	});
});
