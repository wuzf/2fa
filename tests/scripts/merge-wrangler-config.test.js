import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';
import { afterEach, describe, expect, it } from 'vitest';
import { mergeMigrations } from '../../scripts/merge-migrations.js';

const script = fileURLToPath(new URL('../../scripts/merge-wrangler-config.js', import.meta.url));
const directories = [];

const template = `name = "2fa"
main = "src/worker.js"

[[kv_namespaces]]
binding = "SECRETS_KV"

[[durable_objects.bindings]]
name = "SECRETS_STORE"
class_name = "SecretsStore"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["SecretsStore"]

# Environment variables
[vars]
ENVIRONMENT = "production"

[env.development]
name = "2fa-dev"

[env.development.vars]
ENVIRONMENT = "development"
`;
const withoutMigrations = template.replace(/\[\[migrations\]\]\n.*\n.*\n\n/, '');

const v1 = { tag: 'v1', new_sqlite_classes: ['SecretsStore'] };
const rollback = { tag: 'rollback-1', deleted_classes: ['SecretsStore'] };
const restore = { tag: 'restore-1', new_sqlite_classes: ['SecretsStore'] };
const later = { tag: 'v2', new_sqlite_classes: ['BackupStore'] };

// What docs/DEPLOYMENT.md has users append after rolling back below 1.11.0 and upgrading again.
const history = (header = '[[migrations]]') => `
${header}
tag = "rollback-1"
deleted_classes = ["SecretsStore"]

${header}
tag = "restore-1"
new_sqlite_classes = ["SecretsStore"]
`;
const rolledBack = template + history();
const upstreamWithLater = template.replace(
	'new_sqlite_classes = ["SecretsStore"]\n',
	'new_sqlite_classes = ["SecretsStore"]\n\n[[migrations]]\ntag = "v2"\nnew_sqlite_classes = ["BackupStore"]\n',
);

function run(local, upstream) {
	const directory = mkdtempSync(join(tmpdir(), '2fa-merge-'));
	directories.push(directory);
	const paths = ['local.toml', 'upstream.toml', 'merged.toml'].map((name) => join(directory, name));
	writeFileSync(paths[0], local);
	writeFileSync(paths[1], upstream);
	const result = spawnSync(process.execPath, [script, ...paths], { encoding: 'utf8', env: { PATH: process.env.PATH } });
	return { ...result, merged: result.status === 0 ? readFileSync(paths[2], 'utf8') : null };
}

// The migrations Wrangler reads, by a real TOML parser.
const migrations = (text) => parse(text).migrations;
const devMigrations = (text) => parse(text).env.development.migrations;

afterEach(() => {
	for (const directory of directories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe('migrations in the merged wrangler.toml', () => {
	it('takes the upstream migrations for a repository without any', () => {
		expect(run(withoutMigrations, template).merged).toBe(template);
	});

	it('leaves the upstream file unchanged when the history is the same', () => {
		expect(run(template, template).merged).toBe(template);
	});

	it('keeps the migrations added by a rollback and the upgrade after it', () => {
		const { merged } = run(rolledBack, template);
		expect(migrations(merged)).toEqual([v1, rollback, restore]);
		expect(merged).toContain('new_sqlite_classes = ["SecretsStore"]\n\n# Environment variables\n[vars]');
		// The next sync starts from the merged file and changes nothing.
		expect(run(merged, template).merged).toBe(merged);
	});

	it('adds later upstream migrations after the local history', () => {
		const { merged } = run(rolledBack, upstreamWithLater);
		expect(migrations(merged)).toEqual([v1, rollback, restore, later]);
	});

	it('keeps the local history when upstream has none', () => {
		expect(migrations(run(rolledBack, withoutMigrations).merged)).toEqual([v1, rollback, restore]);
	});

	it('stops when a local migration differs from the upstream one with its tag', () => {
		const local = `${template}\n[[migrations]]\ntag = "v2"\ndeleted_classes = ["SecretsStore"]\n`;
		const result = run(local, upstreamWithLater);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain('migration "v2" differs from upstream');
		expect(result.stderr).toContain('Merge them by hand');
	});
});

describe('migration tables written with other TOML layouts', () => {
	it.each([
		['a blank line inside a table', history().replace('tag = "rollback-1"\n', 'tag = "rollback-1"\n\n')],
		['a comment inside a table', history().replace('tag = "rollback-1"\n', 'tag = "rollback-1"\n# Before downgrading\n')],
		[
			'a comment after the header',
			history().replace('[[migrations]]\ntag = "rollback-1"', '[[migrations]] # Rollback\ntag = "rollback-1"'),
		],
		['spaces inside the header', history().replaceAll('[[migrations]]', '[[ migrations ]]')],
		['a comment after a value', history().replace('deleted_classes = ["SecretsStore"]', 'deleted_classes = ["SecretsStore"] # gone')],
		['a multi-line array', history().replace('deleted_classes = ["SecretsStore"]', 'deleted_classes = [\n  "SecretsStore", # gone\n]')],
		['literal strings', history().replace('tag = "rollback-1"', "tag = 'rollback-1'")],
	])('keeps every operation with %s', (_name, appended) => {
		const merged = mergeMigrations(template, template + appended);
		expect(migrations(merged)).toEqual([v1, rollback, restore]);
	});

	it('treats an upstream table with a comment inside as the same migration', () => {
		const upstream = template.replace('tag = "v1"\n', 'tag = "v1"\n\n# Created on the first deploy\n');
		const merged = mergeMigrations(upstream, rolledBack);
		expect(migrations(merged)).toEqual([v1, rollback, restore]);
		expect(merged).toContain('# Created on the first deploy');
	});

	it('treats the same migration in another layout as the same', () => {
		const local = rolledBack.replace(
			'tag = "v1"\nnew_sqlite_classes = ["SecretsStore"]',
			"new_sqlite_classes = [\n  'SecretsStore',\n]\ntag = 'v1'",
		);
		expect(migrations(mergeMigrations(template, local))).toEqual([v1, rollback, restore]);
	});

	it('refuses migrations written as an inline array', () => {
		const local = withoutMigrations.replace(
			'main = "src/worker.js"\n',
			'main = "src/worker.js"\nmigrations = [{ tag = "v1", new_sqlite_classes = ["SecretsStore"] }]\n',
		);
		expect(() => mergeMigrations(template, local)).toThrow('writes migrations inline');
	});
});

describe('sub-tables of a migration', () => {
	const renameTables = `
[[migrations]]
tag = "rename-1"

# Keeps the objects under the new name
[[migrations.renamed_classes]]
from = "OldStore"
to = "NewStore"

[[migrations.renamed_classes]]
from = "OtherStore"
to = "NextStore"
`;
	const rename = {
		tag: 'rename-1',
		renamed_classes: [
			{ from: 'OldStore', to: 'NewStore' },
			{ from: 'OtherStore', to: 'NextStore' },
		],
	};

	it('keeps them with their migration', () => {
		const merged = mergeMigrations(template, template + renameTables);
		expect(migrations(merged)).toEqual([v1, rename]);
		expect(mergeMigrations(template, merged)).toBe(merged);
	});

	it('keeps a plain sub-table too', () => {
		const merged = mergeMigrations(template, `${template}\n[[migrations]]\ntag = "note-1"\n\n[migrations.note]\ntext = "kept"\n`);
		expect(migrations(merged)).toEqual([v1, { tag: 'note-1', note: { text: 'kept' } }]);
	});

	it('compares them when both files have the migration', () => {
		const changed = renameTables.replace('to = "NewStore"', 'to = "ThirdStore"');
		expect(() => mergeMigrations(template + renameTables, template + changed)).toThrow('migration "rename-1" differs from upstream');
		expect(migrations(mergeMigrations(template + renameTables, template + renameTables))).toEqual([v1, rename]);
	});

	it('moves them to an environment list with its headers', () => {
		const upstream = template + '\n[[env.development.migrations]]\ntag = "v1"\nnew_sqlite_classes = ["SecretsStore"]\n';
		const merged = mergeMigrations(upstream, template + renameTables);
		expect(devMigrations(merged)).toEqual([v1, rename]);
		expect(migrations(merged)).toEqual([v1, rename]);
	});

	it.each([
		['a sub-table away from its migration', `${template}\n[[migrations.renamed_classes]]\nfrom = "OldStore"\nto = "NewStore"\n`],
		['the migrations as one table', `${withoutMigrations}\n[migrations]\ntag = "v1"\n`],
	])('stops at %s', (_name, local) => {
		expect(() => mergeMigrations(template, local)).toThrow('Merge them by hand');
	});
});

describe('migrations of an environment', () => {
	const devHistory = `
[[env.development.migrations]]
tag = "v1"
new_sqlite_classes = ["SecretsStore"]
${history('[[env.development.migrations]]')}`;

	it('keeps the history of an environment with a list of its own', () => {
		const merged = mergeMigrations(template, template + devHistory);
		expect(devMigrations(merged)).toEqual([v1, rollback, restore]);
		expect(migrations(merged)).toEqual([v1]);
		expect(mergeMigrations(template, merged)).toBe(merged);
	});

	it('adds later upstream migrations to that list as well', () => {
		const merged = mergeMigrations(upstreamWithLater, template + devHistory);
		expect(devMigrations(merged)).toEqual([v1, rollback, restore, later]);
		expect(migrations(merged)).toEqual([v1, later]);
	});

	it('merges an upstream environment list with the history it inherited locally', () => {
		const upstream = template + '\n[[env.development.migrations]]\ntag = "v1"\nnew_sqlite_classes = ["SecretsStore"]\n';
		const merged = mergeMigrations(upstream, rolledBack);
		expect(devMigrations(merged)).toEqual([v1, rollback, restore]);
		expect(migrations(merged)).toEqual([v1, rollback, restore]);
	});
});
