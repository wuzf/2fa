/**
 * Merges the Durable Object migration history of a deployment's wrangler.toml
 * into the upstream one.
 *
 * Wrangler applies the migrations after the tag the Worker was deployed with.
 * When that tag is missing from the config it replays every migration, and a
 * class that exists already makes the deploy fail. Rolling back below 1.11.0
 * and upgrading again add migrations to the deployment's own file (see
 * docs/DEPLOYMENT.md), so they must survive a sync, followed by the upstream
 * migrations the deployment does not have yet.
 *
 * Both [[migrations]] and [[env.<name>.migrations]] tables are merged; an
 * environment without a list of its own inherits the top-level one. The text is
 * read with TOML's rules for strings, comments and multi-line values, and the
 * result is read back and compared before it is returned, so a migration is
 * never dropped silently: anything that cannot be merged stops the sync.
 */

const GUIDE = 'Merge them by hand as described in docs/DEPLOYMENT.md ("回滚到 1.11.0 之前的版本").';

class MigrationMergeError extends Error {}

/**
 * @param {string} upstreamText - the upstream wrangler.toml (LF line endings)
 * @param {string} localText - the deployment's wrangler.toml (LF line endings)
 * @returns {string} the upstream text with the merged migrations
 */
export function mergeMigrations(upstreamText, localText) {
	const upstream = readMigrations(upstreamText);
	const local = readMigrations(localText);
	const lines = upstreamText.split('\n');
	const removed = new Set();
	const inserted = new Map();
	const appended = [];
	const expected = new Map();

	const write = (scope, blocks, current) => {
		expected.set(scope, blocks);
		if (sameBlocks(blocks, current)) {
			return;
		}
		const text = blocks.map((block) => render(block, scope)).join('\n\n');
		if (current.length === 0) {
			appended.push(text);
			return;
		}
		current.forEach((block, index) => {
			for (let line = block.start; line < block.end; line++) {
				removed.add(line);
			}
			// The blank line after a later table goes with it.
			if (index > 0 && lines[block.end] === '') {
				removed.add(block.end);
			}
		});
		inserted.set(current[0].start, text);
	};

	write('', mergeLists(local.scope(''), upstream.scope(''), header('')), upstream.scope(''));
	for (const name of new Set([...local.environments, ...upstream.environments])) {
		const scope = `env.${name}`;
		const own = local.scope(scope);
		const theirs = upstream.scope(scope);
		const blocks = mergeLists(own.length > 0 ? own : local.scope(''), theirs.length > 0 ? theirs : upstream.scope(''), header(scope));
		if (own.length > 0 || theirs.length > 0) {
			write(scope, blocks, theirs);
		}
	}

	const output = [];
	lines.forEach((line, index) => {
		if (inserted.has(index)) {
			output.push(inserted.get(index));
		}
		if (!removed.has(index)) {
			output.push(line);
		}
	});
	let merged = output.join('\n');
	if (appended.length > 0) {
		merged = `${merged.trimEnd()}\n\n${appended.join('\n\n')}\n`;
	}

	// Read the result back: every scope must hold exactly the merged list.
	const check = readMigrations(merged);
	for (const [scope, blocks] of expected) {
		const found = check.scope(scope).length > 0 || scope === '' ? check.scope(scope) : check.scope('');
		if (!sameContent(found, blocks)) {
			throw new MigrationMergeError(`Merging ${header(scope)} of wrangler.toml went wrong; the file was not changed. ${GUIDE}`);
		}
	}
	return merged;
}

// The local list in its order, then the upstream migrations it does not have.
// The migrations both have must be the same and come first upstream.
function mergeLists(local, upstream, name) {
	const fail = (reason) => {
		throw new MigrationMergeError(`The ${name} of the local wrangler.toml cannot be merged with upstream: ${reason}. ${GUIDE}`);
	};
	if (local.length === 0) {
		return upstream;
	}
	const tags = local.map((block) => block.tag);
	if (tags.some((tag) => !tag)) {
		fail('a migration has no tag');
	}
	if (new Set(tags).size !== tags.length) {
		fail('a tag is used twice');
	}
	const shared = upstream.filter((block) => tags.includes(block.tag));
	shared.forEach((block, index) => {
		if (block !== upstream[index]) {
			fail(`migration "${block.tag}" follows migrations the local file does not have`);
		}
		if (block.content !== local.find(({ tag }) => tag === block.tag).content) {
			fail(`migration "${block.tag}" differs from upstream`);
		}
	});
	if (shared.map(({ tag }) => tag).join('\n') !== tags.filter((tag) => shared.some((block) => block.tag === tag)).join('\n')) {
		fail('the shared migrations are in another order');
	}
	return [
		...local.map((block) => shared.find(({ tag }) => tag === block.tag) ?? block),
		...upstream.filter((block) => !tags.includes(block.tag)),
	];
}

function sameBlocks(a, b) {
	return a.length === b.length && a.every((block, index) => block === b[index]);
}

function sameContent(a, b) {
	return a.length === b.length && a.every((block, index) => block.tag === b[index].tag && block.content === b[index].content);
}

// The header of a scope's migrations, or of a sub-table of one of them
// ([[migrations.renamed_classes]]).
function header(scope, below = [], array = true) {
	const base = scope ? ['env', scope.slice('env.'.length), 'migrations'] : ['migrations'];
	const path = [...base, ...below].map((part) => (/^[A-Za-z0-9_-]+$/.test(part) ? part : JSON.stringify(part))).join('.');
	return array ? `[[${path}]]` : `[${path}]`;
}

// A migration's lines under the headers of the scope it goes to. One already
// there keeps its own header lines (and comments on them).
function render(block, scope) {
	if (block.scope === scope) {
		return block.lines.join('\n');
	}
	const lines = [header(scope), ...block.lines.slice(1)];
	for (const table of block.tables) {
		lines[table.offset] = header(scope, table.below, table.array);
	}
	return lines.join('\n');
}

// The migrations of a wrangler.toml, by scope ('' or 'env.<name>'), with the
// lines each covers: from its header to its last value, so comments and blank
// lines before the next table stay where they are. A sub-table right after a
// migration ([[migrations.renamed_classes]], [migrations.x]) is part of it.
// Anything else under the migrations cannot be merged and stops the sync
// rather than being left out.
function readMigrations(text) {
	const lines = text.split('\n');
	const scopes = new Map();
	const environments = new Set();
	let table = { path: [], array: false };
	let block = null;
	// The migration's own table or the sub-table the values below go to.
	let target = null;
	let state = { depth: 0, string: null };
	let entry = null;
	const stop = (index, reason) => {
		throw new MigrationMergeError(`Line ${index + 1} of wrangler.toml ${reason}. ${GUIDE}`);
	};
	const close = () => {
		if (block) {
			block.lines = lines.slice(block.start, block.end);
			// The values of each table in any order, its sub-tables in theirs.
			block.content = [block.own, ...block.tables].map(({ name, entries }) => [name, ...entries.sort()].join('\n')).join('\n');
			block.tag = block.values.get('tag');
			block = null;
		}
	};
	lines.forEach((line, index) => {
		const inValue = state.depth > 0 || state.string;
		const { code, next } = scan(line, state);
		state = next;
		if (inValue) {
			if (entry) {
				entry.value += code;
			}
			if (block) {
				block.end = index + 1;
			}
		} else if (code.trim().startsWith('[')) {
			table = parseHeader(code.trim(), index);
			const place = migrationPlace(table.path);
			if (place && place.below.length > 0) {
				if (!block || block.scope !== place.scope) {
					stop(index, 'is a migration sub-table away from its migration');
				}
				const name = table.array ? `[[${place.below.join('.')}]]` : `[${place.below.join('.')}]`;
				target = { name, below: place.below, array: table.array, offset: index - block.start, entries: [] };
				block.tables.push(target);
				block.end = index + 1;
			} else {
				close();
				target = null;
				if (place) {
					if (!table.array) {
						stop(index, 'declares the migrations as one table; write each as [[migrations]]');
					}
					block = { scope: place.scope, start: index, end: index + 1, own: { name: '', entries: [] }, tables: [], values: new Map() };
					target = block.own;
					if (place.scope) {
						environments.add(place.scope.slice('env.'.length));
					}
					scopes.set(place.scope, [...(scopes.get(place.scope) ?? []), block]);
				}
			}
			entry = null;
		} else if (code.trim()) {
			const match = code.match(
				/^\s*((?:[A-Za-z0-9_-]+|"(?:[^"\\]|\\.)*"|'[^']*')(?:\s*\.\s*(?:[A-Za-z0-9_-]+|"(?:[^"\\]|\\.)*"|'[^']*'))*)\s*=(.*)$/,
			);
			if (!match) {
				stop(index, 'cannot be read');
			}
			const key = parseKey(match[1]);
			// Outside a migration, a key reaching the migrations is an inline
			// array (migrations = [...]) or a dotted key into them.
			if (!block && migrationPlace([...table.path, ...key])) {
				stop(index, 'writes migrations inline; use [[migrations]] tables');
			}
			entry = { key: key.join('.'), value: match[2], target };
			if (block) {
				target.entries.push(entry);
				block.end = index + 1;
			}
		}
		// A value is complete once no array, inline table or string is open.
		if (entry && !(state.depth > 0 || state.string)) {
			if (block) {
				const value = canonical(entry.value);
				if (entry.target === block.own) {
					block.values.set(entry.key, parseString(value));
				}
				entry.target.entries[entry.target.entries.indexOf(entry)] = `${entry.key}=${value}`;
			}
			entry = null;
		}
	});
	close();
	if (state.depth > 0 || state.string) {
		throw new MigrationMergeError(`wrangler.toml ends inside a value. ${GUIDE}`);
	}
	return { environments, scope: (scope) => scopes.get(scope) ?? [] };
}

// Where a table or key path falls among the migrations: the scope ('' or
// 'env.<name>') and the path below a migration, or null outside them.
function migrationPlace(path) {
	if (path[0] === 'migrations') {
		return { scope: '', below: path.slice(1) };
	}
	return path[0] === 'env' && path.length >= 3 && path[2] === 'migrations' ? { scope: `env.${path[1]}`, below: path.slice(3) } : null;
}

function parseHeader(code, index) {
	const match = code.match(/^(\[\[?)(.*?)(\]\]?)$/);
	if (!match || match[1].length !== match[3].length) {
		throw new MigrationMergeError(`Line ${index + 1} of wrangler.toml cannot be read. ${GUIDE}`);
	}
	return { path: parseKey(match[2]), array: match[1] === '[[' };
}

// A dotted key: bare, "basic" or 'literal' parts.
function parseKey(key) {
	return [...key.matchAll(/\s*([A-Za-z0-9_-]+|"(?:[^"\\]|\\.)*"|'[^']*')\s*(?:\.|$)/g)].map(([, part]) =>
		part.startsWith('"') ? JSON.parse(part) : part.startsWith("'") ? part.slice(1, -1) : part,
	);
}

// The line without its comment, and the array or string it leaves open.
function scan(line, { depth, string }) {
	let code = '';
	for (let index = 0; index < line.length; index++) {
		const char = line[index];
		if (string) {
			code += char;
			if (string.startsWith('"') && char === '\\') {
				code += line[++index] ?? '';
			} else if (line.startsWith(string, index)) {
				code += string.slice(1);
				index += string.length - 1;
				string = null;
			}
			continue;
		}
		if (char === '#') {
			break;
		}
		const quote = line.startsWith('"""', index)
			? '"""'
			: line.startsWith("'''", index)
				? "'''"
				: char === '"' || char === "'"
					? char
					: null;
		if (quote) {
			string = quote;
			code += quote;
			index += quote.length - 1;
			continue;
		}
		if (char === '[' || char === '{') {
			depth += 1;
		} else if (char === ']' || char === '}') {
			depth -= 1;
		}
		code += char;
	}
	// A single-line string cannot continue on the next line.
	if (string === '"' || string === "'") {
		string = null;
	}
	return { code, next: { depth, string } };
}

// A value without whitespace outside strings, literal strings as basic ones and
// trailing commas dropped, so equal values compare equal.
function canonical(value) {
	let result = '';
	for (let index = 0; index < value.length; index++) {
		const char = value[index];
		if (char === '"') {
			const end = findStringEnd(value, index);
			result += value.slice(index, end);
			index = end - 1;
		} else if (char === "'") {
			const end = value.indexOf("'", index + 1);
			result += JSON.stringify(value.slice(index + 1, end));
			index = end;
		} else if (!/\s/.test(char)) {
			result += char;
		}
	}
	return result.replace(/,(?=[\]}])/g, '');
}

function findStringEnd(value, start) {
	for (let index = start + 1; index < value.length; index++) {
		if (value[index] === '\\') {
			index++;
		} else if (value[index] === '"') {
			return index + 1;
		}
	}
	return value.length;
}

function parseString(value) {
	try {
		const parsed = JSON.parse(value);
		return typeof parsed === 'string' ? parsed : null;
	} catch {
		return null;
	}
}
