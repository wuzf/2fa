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

describe('top-level settings next to an environment', () => {
	const devRoutes = 'routes = [{ pattern = "dev.example.com", custom_domain = true }]\n';
	const withDevRoutes = (text) => text.replace('name = "2fa-dev"\n', 'name = "2fa-dev"\n' + devRoutes);
	const withTopRoutes = (text) =>
		text.replace('main = "src/worker.js"\n', 'main = "src/worker.js"\nroutes = [\n  { pattern = "2fa.example.com", custom_domain = true }\n]\n');

	it.each([
		['with workers_dev', (text) => text.replace('main = "src/worker.js"\n', 'main = "src/worker.js"\nworkers_dev = true\n')],
		['without workers_dev', (text) => text],
	])('does not give the production Worker the routes of the development environment (%s)', (_label, layout) => {
		const { status, merged } = run(withDevRoutes(layout(template)), layout(template));
		expect(status).toBe(0);
		const config = parse(merged);
		expect(config.routes).toBeUndefined();
		expect(config.env.development.routes).toEqual([{ pattern: 'dev.example.com', custom_domain: true }]);
		expect(config.env.development.vars).toEqual({ ENVIRONMENT: 'development' });
	});

	it('keeps the production routes and the development routes each in their own place', () => {
		const { status, merged } = run(withDevRoutes(withTopRoutes(template)), template);
		expect(status).toBe(0);
		const config = parse(merged);
		expect(config.routes).toEqual([{ pattern: '2fa.example.com', custom_domain: true }]);
		expect(config.env.development.routes).toEqual([{ pattern: 'dev.example.com', custom_domain: true }]);
	});

	it('does not replace a development setting with a production one missing upstream', () => {
		const local = template.replace('main = "src/worker.js"\n', 'main = "src/worker.js"\nworkers_dev = false\n');
		const upstream = template.replace('name = "2fa-dev"\n', 'name = "2fa-dev"\nworkers_dev = true\n');
		const { status, merged } = run(local, upstream);
		expect(status).toBe(0);
		const config = parse(merged);
		expect(config.workers_dev).toBe(false);
		expect(config.env.development.workers_dev).toBe(true);
	});

	it('reads the settings after a multi-line string with a bracketed line as top-level settings', () => {
		const local = template.replace(
			'name = "2fa"\nmain = "src/worker.js"\n',
			'description = """\nStatus page\n[Service status]\n"""\nname = "my-2fa"\nmain = "src/worker.js"\nworkers_dev = false\nroutes = [\n  { pattern = "2fa.example.com", custom_domain = true }\n]\n',
		);
		const upstream = template.replace('main = "src/worker.js"\n', 'main = "src/worker.js"\nworkers_dev = true\n');
		const { status, merged } = run(local, upstream);
		expect(status).toBe(0);
		const config = parse(merged);
		expect(config.name).toBe('my-2fa');
		expect(config.workers_dev).toBe(false);
		expect(config.routes).toEqual([{ pattern: '2fa.example.com', custom_domain: true }]);
	});

	it('keeps an environment setting written after a bracketed line inside a multi-line string', () => {
		const local = template.replace(
			'name = "2fa-dev"\n',
			"name = \"2fa-dev\"\nnote = '''\n[draft]\n'''\n" + devRoutes,
		);
		const { status, merged } = run(local, template);
		expect(status).toBe(0);
		expect(parse(merged).env.development.routes).toEqual([{ pattern: 'dev.example.com', custom_domain: true }]);
	});
});

describe('deployment tables written with other TOML headers', () => {
	const upstream = template
		.replace(
			'[vars]\nENVIRONMENT = "production"',
			'[triggers]\ncrons = ["0 16 * * *"]\n\n[vars]\nSW_VERSION = "upstream"\nENVIRONMENT = "production"',
		)
		.replace(
			'[env.development.vars]',
			'[[env.development.kv_namespaces]]\nbinding = "SECRETS_KV"\n\n[env.development.vars]\nSW_VERSION = "upstream-dev"',
		);
	const local = upstream
		.replaceAll('binding = "SECRETS_KV"', 'binding = "SECRETS_KV"\nid = "production-id"\npreview_id = "preview-id"')
		.replace('crons = ["0 16 * * *"]', 'crons = ["0 */6 * * *"]')
		.replace('SW_VERSION = "upstream"', 'SW_VERSION = "local-old"\nOAUTH_REDIRECT_BASE_URL = "https://auth.example.com"')
		.replace('name = "2fa-dev"', 'name = "personal-dev"\nroutes = []')
		.replace('SW_VERSION = "upstream-dev"', 'SW_VERSION = "local-dev-old"\nLOG_LEVEL = "WARN"')
		.replace(
			'[[env.development.kv_namespaces]]\nbinding = "SECRETS_KV"\nid = "production-id"',
			'[[env.development.kv_namespaces]]\nbinding = "SECRETS_KV"\nid = "development-id"',
		);
	const layouts = [
		['comments', (path) => path, '', ' # deployment settings'],
		['whitespace', (path) => path.split('.').join(' . '), ' \t', ''],
		[
			'basic quoted keys',
			(path) =>
				path
					.split('.')
					.map((part) => JSON.stringify(part))
					.join('.'),
			'',
			' # quoted',
		],
		[
			'literal quoted keys',
			(path) =>
				path
					.split('.')
					.map((part) => `'${part}'`)
					.join(' . '),
			' ',
			' # literal',
		],
		[
			'escaped quoted keys',
			(path) =>
				path
					.split('.')
					.map((part) => `"\\u${part.charCodeAt(0).toString(16).padStart(4, '0')}${part.slice(1)}"`)
					.join('.'),
			'',
			'',
		],
	];
	function restyle(text, formatPath, spacing, comment) {
		return text.replace(
			/^(\[\[?)([A-Za-z0-9_.]+)(\]\]?)$/gm,
			(_line, open, path, close) => `${spacing}${open}${spacing}${formatPath(path)}${spacing}${close}${comment}`,
		);
	}
	function expectPreserved(merged) {
		const config = parse(merged);
		expect(config.kv_namespaces).toEqual([{ binding: 'SECRETS_KV', id: 'production-id', preview_id: 'preview-id' }]);
		expect(config.triggers.crons).toEqual(['0 */6 * * *']);
		expect(config.vars).toEqual({ ENVIRONMENT: 'production', SW_VERSION: 'upstream', OAUTH_REDIRECT_BASE_URL: 'https://auth.example.com' });
		expect(config.env.development.name).toBe('personal-dev');
		expect(config.env.development.routes).toEqual([]);
		expect(config.env.development.kv_namespaces).toEqual([{ binding: 'SECRETS_KV', id: 'development-id', preview_id: 'preview-id' }]);
		expect(config.env.development.vars).toEqual({ ENVIRONMENT: 'development', SW_VERSION: 'upstream-dev', LOG_LEVEL: 'WARN' });
		expect(config.migrations).toEqual([v1]);
	}

	it.each(layouts)('keeps deployment values when local headers use %s', (_name, formatPath, spacing, comment) => {
		const source = restyle(local, formatPath, spacing, comment);
		expect(parse(source).kv_namespaces[0].id).toBe('production-id');
		const { status, merged } = run(source, upstream);
		expect(status).toBe(0);
		expectPreserved(merged);
	});

	it.each(layouts)('keeps deployment values when upstream headers use %s', (_name, formatPath, spacing, comment) => {
		const target = restyle(upstream, formatPath, spacing, comment);
		const { status, merged } = run(local, target);
		expect(status).toBe(0);
		expectPreserved(merged);
		expect(merged).toContain(restyle('[vars]', formatPath, spacing, comment));
		expect(merged).toContain(restyle('[[kv_namespaces]]', formatPath, spacing, comment));
		expect(run(merged, target).merged).toBe(merged);
	});

	it('does not confuse a quoted dotted key with separate path segments', () => {
		const decoys =
			'\n["env.development"]\nname = "wrong-dev"\nroutes = ["wrong.example.com/*"]\n\n[["env.development.kv_namespaces"]]\nbinding = "SECRETS_KV"\nid = "wrong-id"\n';
		const source = local.replace('[env.development]', decoys + '\n[env . "development"] # real environment');
		const { status, merged } = run(source, upstream);
		expect(status).toBe(0);
		expectPreserved(merged);
	});

	it('ignores header-shaped lines in a multi-line string', () => {
		const note = 'description = """\n[vars] # not a table\n[[kv_namespaces]]\n"""\n';
		const source = note + restyle(local, (path) => path, '', ' # actual table');
		const { status, merged } = run(source, upstream);
		expect(status).toBe(0);
		expectPreserved(merged);
	});

	it('continues past other KV bindings before reading the account database', () => {
		const source = local.replace(
			'[[kv_namespaces]]',
			'[[ kv_namespaces ]] # unrelated\nbinding = "OTHER_KV"\nid = "other-id"\n\n[[ "kv_namespaces" ]] # accounts',
		);
		const { status, merged } = run(source, upstream);
		expect(status).toBe(0);
		expectPreserved(merged);
	});

	it.each(['', ' # documented settings'])('replaces the actual tables when a description repeats their entire contents%s', (comment) => {
		const actualTables = restyle(upstream.slice(upstream.indexOf('[[kv_namespaces]]')), (path) => path, '', comment);
		const target = 'name = "2fa"\nmain = "src/worker.js"\ndescription = \'\'\'\n' + actualTables + "'''\n\n" + actualTables;
		const originalDescription = parse(target).description;
		const { status, merged } = run(local, target);
		expect(status).toBe(0);
		expect(parse(merged).description).toBe(originalDescription);
		expectPreserved(merged);
	});
});

describe('deployment assignments containing multi-line strings', () => {
	function readVars(config, environment) {
		return environment ? config.env.development.vars : config.vars;
	}
	function multilineValue(delimiter, label) {
		return `${delimiter}\n${label}\n# this is content\ntoken=alpha=beta\n[env.development]\nSW_VERSION = "inside the string"\n${delimiter}`;
	}
	const variableCases = [
		['production basic string', false, '"""'],
		['production literal string', false, "'''"],
		['development basic string', true, '"""'],
		['development literal string', true, "'''"],
	];
	it.each(variableCases)('preserves complete local and upstream vars values: %s', (_name, environment, delimiter) => {
		const header = environment ? '[env.development.vars]' : '[vars]';
		const source = template.replace(header, `${header} # settings\nSW_VERSION = "local-old"\nTEXT = ${multilineValue(delimiter, 'local text')}`);
		const upstream = template.replace(
			header,
			`${header} # settings\nSW_VERSION = "upstream-version"\nTEXT = ${multilineValue(delimiter, 'upstream text')}\nUPSTREAM_ONLY = ${multilineValue(delimiter, 'upstream-only text')}`,
		);
		const expected = {
			...readVars(parse(upstream), environment),
			...readVars(parse(source), environment),
			SW_VERSION: 'upstream-version',
		};
		const { status, merged } = run(source, upstream);
		expect(status).toBe(0);
		expect(readVars(parse(merged), environment)).toEqual(expected);
		expect(run(merged, upstream).merged).toBe(merged);
	});

	function buildCommand(label) {
		return `build.command = '''\ncat <<'EOF'\n# ${label}\nname = "${label}-generated"\nroutes = ["generated.example.com/*"]\nEOF\n'''\n`;
	}
	const environments = [
		['both real names follow build commands', true, true],
		['no local name or routes outside the build command', false, true],
		['no upstream name or routes outside the build command', true, false],
	];
	it.each(environments)('only reads and replaces real development assignments: %s', (_name, sourceHasName, targetHasName) => {
		const source = template.replace(
			'name = "2fa-dev"\n',
			buildCommand('local script') + (sourceHasName ? 'name = "personal-dev"\nroutes = []\n' : ''),
		);
		const upstream = template.replace(
			'name = "2fa-dev"\n',
			buildCommand('upstream script') + (targetHasName ? 'name = "upstream-dev"\nroutes = ["upstream.example.com/*"]\n' : ''),
		);
		const expectedUpstream = parse(upstream).env.development;
		const { status, merged } = run(source, upstream);
		expect(status).toBe(0);
		const environment = parse(merged).env.development;
		expect(environment.build.command).toBe(expectedUpstream.build.command);
		expect(environment.name).toBe(sourceHasName ? 'personal-dev' : expectedUpstream.name);
		expect(environment.routes).toEqual(sourceHasName ? [] : expectedUpstream.routes);
		expect(run(merged, upstream).merged).toBe(merged);
	});

	it('keeps production assignments outside a build command and does not change the script', () => {
		const source = template.replace('name = "2fa"\n', buildCommand('local production') + 'name = "personal-auth"\nroutes = []\n');
		const upstream = template.replace('name = "2fa"\n', buildCommand('upstream production') + 'name = "upstream-auth"\nroutes = ["auth.example.com/*"]\n');
		const originalScript = parse(upstream).build.command;
		const { status, merged } = run(source, upstream);
		expect(status).toBe(0);
		const config = parse(merged);
		expect(config.build.command).toBe(originalScript);
		expect(config.name).toBe('personal-auth');
		expect(config.routes).toEqual([]);
		expect(run(merged, upstream).merged).toBe(merged);
	});

	it('does not invent production settings from a build command', () => {
		const source = template.replace('name = "2fa"\n', buildCommand('local without top-level name'));
		const upstream = template.replace('name = "2fa"\n', 'name = "upstream-auth"\nroutes = ["auth.example.com/*"]\n');
		const { status, merged } = run(source, upstream);
		expect(status).toBe(0);
		const config = parse(merged);
		expect(config.name).toBe('upstream-auth');
		expect(config.routes).toEqual(['auth.example.com/*']);
	});
});

describe('complete TOML values in deployment settings', () => {
	it('preserves arrays and JSON object vars with nested multi-line text', () => {
		const source = template.replace(
			'[vars]',
			'[vars] # settings\nJSON_DATA = [\n  { label = "local # = [value]", enabled = true },\n  """\n[vars]\nname = "text only"\n# still text\n""",\n]\nOBJECT = { "a=b" = "local", nested = { values = [1, 2] } }',
		);
		const upstream = template.replace(
			'[vars]',
			'[vars]\nJSON_DATA = ["upstream"]\nOBJECT = { "a=b" = "upstream" }\nUPSTREAM_ONLY = [\n  { label = "# retained = true", values = [3, 4] },\n]',
		);
		const { status, merged } = run(source, upstream);
		expect(status).toBe(0);
		expect(parse(merged).vars).toEqual({ ...parse(upstream).vars, ...parse(source).vars });
		expect(run(merged, upstream).merged).toBe(merged);
	});

	it('matches quoted keys by their decoded path and still protects SW_VERSION', () => {
		const source = template.replace(
			'[vars]',
			'[vars]\n"A=B" = "local equal"\n\'A#B\' = "local hash"\n"A.B" = "local dotted key"\n\'SW_VERSION\' = "local-old"\nnested.value = "local nested"',
		);
		const upstream = template.replace(
			'[vars]',
			'[vars]\n\'A=B\' = "upstream equal"\n"A#B" = "upstream hash"\n\'A.B\' = "upstream dotted key"\n"SW_VERSION" = "upstream-version"\n"nested.value" = "separate dotted key"',
		);
		const { status, merged } = run(source, upstream);
		expect(status).toBe(0);
		expect(parse(merged).vars).toEqual({ ...parse(upstream).vars, ...parse(source).vars, SW_VERSION: 'upstream-version' });
		expect(run(merged, upstream).merged).toBe(merged);
	});

	it('selects the real KV binding despite binding text in other blocks', () => {
		const decoys = `[[kv_namespaces]] # unrelated comment
binding = "COMMENTS"
# binding = "SECRETS_KV"
id = "comment-id"

[[kv_namespaces]] # unrelated string
binding = "STRINGS"
note = '''
binding = "SECRETS_KV"
'''
id = "string-id"

`;
		const source = template.replace(
			'[[kv_namespaces]]\nbinding = "SECRETS_KV"',
			decoys + '[[kv_namespaces]]\n  \'binding\'\t=\t\'SECRETS_KV\' # actual binding\nid = "account-id"\npreview_id = "preview-id"',
		);
		const upstream = template.replace('[[kv_namespaces]]\nbinding = "SECRETS_KV"', decoys + '[[kv_namespaces]]\nbinding="SECRETS_KV"');
		const originalBlocks = parse(upstream).kv_namespaces;
		const { status, merged } = run(source, upstream);
		expect(status).toBe(0);
		expect(parse(merged).kv_namespaces).toEqual([
			...originalBlocks.slice(0, 2),
			{ binding: 'SECRETS_KV', id: 'account-id', preview_id: 'preview-id' },
		]);
		expect(run(merged, upstream).merged).toBe(merged);
	});

	it.each([
		['basic with four quotes', '"', 4],
		['basic with five quotes', '"', 5],
		['literal with four quotes', "'", 4],
		['literal with five quotes', "'", 5],
	])('keeps trailing value quotes when a multi-line string closes: %s', (_name, quote, count) => {
		const value = (label) => `${quote.repeat(3)}\n${label}\n${quote.repeat(count)} # closed here`;
		const source = template.replace('[env.development.vars]', `[env.development.vars]\nTEXT = ${value('local')}\nAFTER = "local after"`);
		const upstream = template.replace(
			'[env.development.vars]',
			`[env.development.vars]\nTEXT = ${value('upstream')}\nUPSTREAM_ONLY = ${value('retained')}\nAFTER = "upstream after"`,
		);
		const localVars = parse(source).env.development.vars;
		expect(localVars.TEXT).toBe('local\n' + quote.repeat(count - 3));
		const { status, merged } = run(source, upstream);
		expect(status).toBe(0);
		expect(parse(merged).env.development.vars).toEqual({ ...parse(upstream).env.development.vars, ...localVars });
		expect(run(merged, upstream).merged).toBe(merged);
	});
});
