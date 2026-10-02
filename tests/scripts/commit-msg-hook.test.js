import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const hook = fileURLToPath(new URL('../../.husky/commit-msg', import.meta.url));
const directories = [];

function check(message) {
	const directory = mkdtempSync(join(tmpdir(), '2fa-commit-msg-'));
	directories.push(directory);
	const file = join(directory, 'COMMIT_EDITMSG');
	writeFileSync(file, message);
	return spawnSync('sh', [hook, file], { encoding: 'utf8' }).status;
}

afterEach(() => {
	for (const directory of directories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe('commit-msg hook', () => {
	it.each([
		'fix(api): handle empty response\n',
		'feat: add user authentication\n\nLonger explanation in the body.\n',
		`docs: ${'a'.repeat(72)}\n`,
	])('accepts %j', (message) => {
		expect(check(message)).toBe(0);
	});

	it('rejects a subject longer than 72 characters', () => {
		expect(check(`docs: ${'a'.repeat(73)}\n`)).not.toBe(0);
	});

	it('rejects a malformed subject even when a body line looks valid', () => {
		expect(check('Update stuff\n\nfix: this line is only the body\n')).not.toBe(0);
	});
});
