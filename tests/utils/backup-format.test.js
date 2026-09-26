import { describe, expect, it } from 'vitest';

import {
	MAX_HTML_QR_EXPORT_SECRETS,
	createBackupEntry,
	encodeBackupContent,
	decodeBackupContent,
	decodeBackupEntry,
} from '../../src/utils/backup-format.js';
import { encryptData } from '../../src/utils/encryption.js';

describe('backup format HTML decoding', () => {
	it('restores themed backups with special characters and all HOTP parameters', async () => {
		const secret = {
			id: 'hotp-backup',
			name: '服务 <script> & "test"',
			account: 'account<&>@example.test',
			secret: 'JBSWY3DPEHPK3PXP',
			type: 'HOTP',
			digits: 8,
			period: 60,
			algorithm: 'SHA256',
			counter: 42,
		};
		const { content } = await encodeBackupContent([secret], { format: 'html' });
		expect(content.match(/<th>/g)).toHaveLength(9);
		expect(content.match(/<script(?:\s|>)/g)).toHaveLength(3);
		expect(content).toContain('<img src="data:image/svg+xml');
		expect(decodeBackupContent(content, 'html', { strict: true }).secrets[0]).toMatchObject(secret);
		const { id: _id, ...tableFields } = secret;
		const tableOnly = content.replace(/<script id="__2fa_backup_data__"[\s\S]*?<\/script>/i, '');
		expect(decodeBackupContent(tableOnly, 'html', { strict: true }).secrets[0]).toMatchObject(tableFields);
	});

	it('restores legacy frontend HTML exports without embedded JSON', () => {
		const legacyHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>2FA 密钥导出</title>
</head>
<body>
  <div class="container">
    <h1>🔐 2FA 密钥备份</h1>
    <div class="meta">📅 导出时间: 2026/04/16 11:22:33 | 📊 密钥数量: 2 个</div>
    <table>
      <thead>
        <tr>
          <th>服务名称</th>
          <th>账户名称</th>
          <th>密钥</th>
          <th>类型</th>
          <th>位数</th>
          <th>周期</th>
          <th>算法</th>
          <th>二维码</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="service">GitHub</td>
          <td class="account">user@example.com</td>
          <td class="secret">JBSW Y3DP EH PK3PXP</td>
          <td class="param">TOTP</td>
          <td class="param">6</td>
          <td class="param">30</td>
          <td class="param">SHA1</td>
          <td class="qr-cell"><img src="data:image/png;base64,AAA" alt="QR"></td>
        </tr>
        <tr>
          <td class="service">Dropbox</td>
          <td class="account">-</td>
          <td class="secret"><code>MFRGGZDFMZTWQ2LK</code></td>
          <td class="param">HOTP</td>
          <td class="param">8</td>
          <td class="param">60</td>
          <td class="param">SHA256</td>
          <td class="qr-cell"><img src="data:image/png;base64,BBB" alt="QR"></td>
        </tr>
      </tbody>
    </table>
  </div>
</body>
</html>`;

		const result = decodeBackupContent(legacyHtml, 'html', {
			timestamp: '2026-04-16T03:30:00.000Z',
		});

		expect(result.format).toBe('html');
		expect(result.count).toBe(2);
		expect(result.secrets).toHaveLength(2);
		expect(result.secrets[0]).toMatchObject({
			name: 'GitHub',
			account: 'user@example.com',
			secret: 'JBSWY3DPEHPK3PXP',
			type: 'TOTP',
			digits: 6,
			period: 30,
			algorithm: 'SHA1',
		});
		expect(result.secrets[1]).toMatchObject({
			name: 'Dropbox',
			account: '',
			secret: 'MFRGGZDFMZTWQ2LK',
			type: 'HOTP',
			digits: 8,
			period: 60,
			algorithm: 'SHA256',
			counter: 0,
		});
	});

	it('falls back to table parsing when embedded JSON is corrupted', () => {
		const htmlWithBrokenJson = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>2FA Backup</title>
</head>
<body>
  <table>
    <tbody>
      <tr>
        <td>GitHub</td>
        <td>user@example.com</td>
        <td>JBSW Y3DP EH PK3PXP</td>
        <td>TOTP</td>
        <td>6</td>
        <td>30</td>
        <td>SHA1</td>
        <td>0</td>
        <td>QR</td>
      </tr>
    </tbody>
  </table>
  <script id="__2fa_backup_data__" type="application/json">{broken json</script>
</body>
</html>`;

		const result = decodeBackupContent(htmlWithBrokenJson, 'html', {
			timestamp: '2026-04-16T03:30:00.000Z',
		});

		expect(result.format).toBe('html');
		expect(result.count).toBe(1);
		expect(result.secrets).toHaveLength(1);
		expect(result.secrets[0]).toMatchObject({
			name: 'GitHub',
			account: 'user@example.com',
			secret: 'JBSWY3DPEHPK3PXP',
			type: 'TOTP',
			digits: 6,
			period: 30,
			algorithm: 'SHA1',
			counter: 0,
		});
	});

	it('extracts raw otpauth URLs from damaged HTML fragments', () => {
		const htmlWithRawOtpAuth = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>2FA Backup</title>
</head>
<body>
  <p>请使用下方链接恢复：</p>
  <a href="otpauth://totp/GitHub:user%40example.com?secret=JBSWY3DPEHPK3PXP&amp;issuer=GitHub&amp;digits=6&amp;period=30&amp;algorithm=SHA1">恢复 GitHub</a>
</body>
</html>`;

		const result = decodeBackupContent(htmlWithRawOtpAuth, 'html', {
			timestamp: '2026-04-16T03:30:00.000Z',
		});

		expect(result.format).toBe('html');
		expect(result.count).toBe(1);
		expect(result.secrets[0]).toMatchObject({
			name: 'GitHub',
			account: 'user@example.com',
			secret: 'JBSWY3DPEHPK3PXP',
			type: 'TOTP',
			digits: 6,
			period: 30,
			algorithm: 'SHA1',
		});
	});

	it.skip('rejects invalid legacy HTML rows in strict mode', () => {
		const legacyHtml = `<!DOCTYPE html>
<html>
<body>
  <table>
    <tbody>
      <tr>
        <td>GitHub</td>
        <td>user@example.com</td>
        <td>JBSWY3DPEHPK3PXP</td>
        <td>TOTP</td>
        <td>6</td>
        <td>30</td>
        <td>SHA1</td>
        <td><img src="data:image/png;base64,AAA" alt="QR"></td>
      </tr>
      <tr>
        <td>Broken</td>
        <td>broken@example.com</td>
        <td> </td>
        <td>TOTP</td>
        <td>6</td>
        <td>30</td>
        <td>SHA1</td>
        <td><img src="data:image/png;base64,BBB" alt="QR"></td>
      </tr>
    </tbody>
  </table>
</body>
</html>`;

		expect(() =>
			decodeBackupContent(legacyHtml, 'html', {
				timestamp: '2026-04-16T03:30:00.000Z',
				strict: true,
			}),
		).toThrow('备份 HTML 数据包含无效条目');
	});

	it.skip('counts truncated legacy HTML rows as invalid instead of silently dropping them', () => {
		const truncatedHtml = `<!DOCTYPE html>
<html>
<body>
  <table>
    <tbody>
      <tr>
        <td>GitHub</td>
        <td>user@example.com</td>
        <td>JBSWY3DPEHPK3PXP</td>
        <td>TOTP</td>
        <td>6</td>
        <td>30</td>
        <td>SHA1</td>
        <td>0</td>
        <td>QR</td>
      </tr>
      <tr>
        <td>Truncated</td>
        <td>broken@example.com</td>
      </tr>
    </tbody>
  </table>
</body>
</html>`;

		const decoded = decodeBackupContent(truncatedHtml, 'html', {
			timestamp: '2026-04-16T03:30:00.000Z',
			strict: false,
		});

		expect(decoded.count).toBe(1);
		expect(decoded.skippedInvalidCount).toBe(1);
		expect(decoded.secrets[0]).toMatchObject({
			name: 'GitHub',
			account: 'user@example.com',
			secret: 'JBSWY3DPEHPK3PXP',
		});
		expect(() =>
			decodeBackupContent(truncatedHtml, 'html', {
				timestamp: '2026-04-16T03:30:00.000Z',
				strict: true,
			}),
		).toThrow('备份 HTML 数据包含无效条目');
	});

	it('treats invalid legacy HTML rows as partial data instead of throwing in strict mode', () => {
		const legacyHtml = `<!DOCTYPE html>
<html>
<body>
  <table>
    <tbody>
      <tr>
        <td>GitHub</td>
        <td>user@example.com</td>
        <td>JBSWY3DPEHPK3PXP</td>
        <td>TOTP</td>
        <td>6</td>
        <td>30</td>
        <td>SHA1</td>
        <td><img src="data:image/png;base64,AAA" alt="QR"></td>
      </tr>
      <tr>
        <td>Broken</td>
        <td>broken@example.com</td>
        <td> </td>
        <td>TOTP</td>
        <td>6</td>
        <td>30</td>
        <td>SHA1</td>
        <td><img src="data:image/png;base64,BBB" alt="QR"></td>
      </tr>
    </tbody>
  </table>
</body>
</html>`;

		const decoded = decodeBackupContent(legacyHtml, 'html', {
			timestamp: '2026-04-16T03:30:00.000Z',
			strict: true,
		});

		expect(decoded.count).toBe(1);
		expect(decoded.skippedInvalidCount).toBe(1);
	});

	it('counts truncated legacy HTML rows as invalid without failing the strict fallback parse', () => {
		const truncatedHtml = `<!DOCTYPE html>
<html>
<body>
  <table>
    <tbody>
      <tr>
        <td>GitHub</td>
        <td>user@example.com</td>
        <td>JBSWY3DPEHPK3PXP</td>
        <td>TOTP</td>
        <td>6</td>
        <td>30</td>
        <td>SHA1</td>
        <td>0</td>
        <td>QR</td>
      </tr>
      <tr>
        <td>Truncated</td>
        <td>broken@example.com</td>
      </tr>
    </tbody>
  </table>
</body>
</html>`;

		const decoded = decodeBackupContent(truncatedHtml, 'html', {
			timestamp: '2026-04-16T03:30:00.000Z',
			strict: true,
		});

		expect(decoded.count).toBe(1);
		expect(decoded.skippedInvalidCount).toBe(1);
		expect(decoded.secrets[0]).toMatchObject({
			name: 'GitHub',
			account: 'user@example.com',
			secret: 'JBSWY3DPEHPK3PXP',
		});
	});
});

describe('backup format JSON decoding', () => {
	it('restores legacy JSON exports that use exportDate and issuer fields', () => {
		const legacyJson = JSON.stringify({
			version: '1.0',
			exportDate: '2026-04-16T03:30:00.000Z',
			count: 1,
			secrets: [
				{
					issuer: 'GitHub',
					account: 'user@example.com',
					secret: 'JBSWY3DPEHPK3PXP',
					type: 'TOTP',
					digits: 6,
					period: 30,
					algorithm: 'SHA1',
				},
			],
		});

		const decoded = decodeBackupContent(legacyJson, 'json', {
			strict: true,
		});

		expect(decoded.format).toBe('json');
		expect(decoded.timestamp).toBe('2026-04-16T03:30:00.000Z');
		expect(decoded.count).toBe(1);
		expect(decoded.secrets[0]).toMatchObject({
			name: 'GitHub',
			account: 'user@example.com',
			secret: 'JBSWY3DPEHPK3PXP',
			type: 'TOTP',
			digits: 6,
			period: 30,
			algorithm: 'SHA1',
		});
	});
});

describe('backup format partial metadata portability', () => {
	it('marks invalid Base32 secrets as partial data during encoding', async () => {
		const encoded = await encodeBackupContent(
			[
				{
					id: '1',
					name: 'GitHub',
					account: 'user@example.com',
					secret: 'JBSWY3DPEHPK3PXP',
					type: 'TOTP',
				},
				{
					id: '2',
					name: 'Broken',
					account: 'broken@example.com',
					secret: '***',
					type: 'TOTP',
				},
			],
			{
				format: 'json',
				reason: 'manual',
				strict: false,
			},
		);

		expect(encoded.count).toBe(1);
		expect(encoded.skippedInvalidCount).toBe(1);
		expect(encoded.invalidSecrets).toHaveLength(1);
	});

	it('treats invalid Base32 otpauth rows as invalid data', () => {
		const decoded = decodeBackupContent(
			[
				'otpauth://totp/GitHub:user%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&digits=6&period=30&algorithm=SHA1',
				'otpauth://totp/Broken:broken%40example.com?secret=***&issuer=Broken&digits=6&period=30&algorithm=SHA1',
			].join('\n'),
			'txt',
			{
				timestamp: '2026-04-16T03:30:00.000Z',
				strict: false,
			},
		);

		expect(decoded.count).toBe(1);
		expect(decoded.skippedInvalidCount).toBe(1);
		expect(decoded.secrets[0]).toMatchObject({
			name: 'GitHub',
			secret: 'JBSWY3DPEHPK3PXP',
		});
	});

	it('preserves account labels when an otpauth URL only stores issuer in the query string', () => {
		const decoded = decodeBackupContent(
			'otpauth://totp/user%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&digits=6&period=30&algorithm=SHA1',
			'txt',
			{
				timestamp: '2026-04-16T03:30:00.000Z',
				strict: true,
			},
		);

		expect(decoded.count).toBe(1);
		expect(decoded.secrets[0]).toMatchObject({
			name: 'GitHub',
			account: 'user@example.com',
			secret: 'JBSWY3DPEHPK3PXP',
		});
	});

	it('treats invalid Base32 CSV rows as invalid data', () => {
		const decoded = decodeBackupContent(
			[
				'\uFEFF服务名称,账户信息,密钥,类型,位数,周期(秒),算法,计数器,创建时间',
				'GitHub,user@example.com,JBSWY3DPEHPK3PXP,TOTP,6,30,SHA1,0,2026-04-16T03:30:00.000Z',
				'Broken,broken@example.com,***,TOTP,6,30,SHA1,0,2026-04-16T03:30:00.000Z',
			].join('\n'),
			'csv',
			{
				timestamp: '2026-04-16T03:30:00.000Z',
				strict: false,
			},
		);

		expect(decoded.count).toBe(1);
		expect(decoded.skippedInvalidCount).toBe(1);
		expect(decoded.secrets[0]).toMatchObject({
			name: 'GitHub',
			secret: 'JBSWY3DPEHPK3PXP',
		});
	});

	it('treats invalid Base32 HTML table rows as invalid data', () => {
		const decoded = decodeBackupContent(
			`<!DOCTYPE html>
<html>
<body>
  <table>
    <tbody>
      <tr>
        <td>GitHub</td>
        <td>user@example.com</td>
        <td>JBSWY3DPEHPK3PXP</td>
        <td>TOTP</td>
        <td>6</td>
        <td>30</td>
        <td>SHA1</td>
        <td>0</td>
        <td>QR</td>
      </tr>
      <tr>
        <td>Broken</td>
        <td>broken@example.com</td>
        <td>***</td>
        <td>TOTP</td>
        <td>6</td>
        <td>30</td>
        <td>SHA1</td>
        <td>0</td>
        <td>QR</td>
      </tr>
    </tbody>
  </table>
</body>
</html>`,
			'html',
			{
				timestamp: '2026-04-16T03:30:00.000Z',
				strict: true,
			},
		);

		expect(decoded.count).toBe(1);
		expect(decoded.skippedInvalidCount).toBe(1);
		expect(decoded.secrets[0]).toMatchObject({
			name: 'GitHub',
			secret: 'JBSWY3DPEHPK3PXP',
		});
	});

	it('preserves partial-backup state in plaintext CSV content without KV metadata', async () => {
		const entry = await createBackupEntry(
			[
				{
					id: '1',
					name: 'GitHub',
					account: 'user@example.com',
					secret: 'JBSWY3DPEHPK3PXP',
					type: 'TOTP',
				},
				{
					id: '2',
					name: 'Broken',
					account: 'broken@example.com',
					secret: '   ',
					type: 'TOTP',
				},
			],
			{},
			{
				format: 'csv',
				reason: 'secret-updated',
				strict: false,
			},
		);

		expect(entry.skippedInvalidCount).toBe(1);

		const decodedWithMetadata = await decodeBackupEntry(entry.backupContent, {}, {
			backupKey: entry.backupKey,
			metadata: entry.metadata,
			strict: true,
		});
		const decodedWithoutMetadata = await decodeBackupEntry(entry.backupContent, {}, {
			backupKey: entry.backupKey,
			strict: true,
		});

		expect(decodedWithMetadata.partial).toBe(true);
		expect(decodedWithMetadata.skippedInvalidCount).toBe(1);
		expect(decodedWithoutMetadata.partial).toBe(true);
		expect(decodedWithoutMetadata.skippedInvalidCount).toBe(1);
		expect(decodedWithoutMetadata.count).toBe(1);
		expect(decodedWithoutMetadata.secrets[0].name).toBe('GitHub');
	});

	it('preserves partial-backup state in HTML content when embedded JSON is missing', async () => {
		const entry = await createBackupEntry(
			[
				{
					id: '1',
					name: 'GitHub',
					account: 'user@example.com',
					secret: 'JBSWY3DPEHPK3PXP',
					type: 'TOTP',
				},
				{
					id: '2',
					name: 'Broken',
					account: 'broken@example.com',
					secret: '   ',
					type: 'TOTP',
				},
			],
			{},
			{
				format: 'html',
				reason: 'scheduled',
				strict: false,
			},
		);

		const damagedHtml = String(entry.backupContent)
			.replace(/<script id="__2fa_backup_data__"[\s\S]*?<\/script>/i, '')
			.replace(/<meta[^>]*name="2fa-backup-meta"[^>]*>/i, '')
			.replace(/\sdata-skipped-invalid-count="\d+"/gi, '')
			.replace(/<p class="partial-warning">[\s\S]*?<\/p>/i, '')
			.replace('</tbody>', '<tr><td>Broken</td><td></td><td></td></tr></tbody>');
		const decoded = await decodeBackupEntry(damagedHtml, {}, {
			backupKey: entry.backupKey,
			strict: true,
		});

		expect(decoded.partial).toBe(true);
		expect(decoded.skippedInvalidCount).toBe(1);
		expect(decoded.count).toBe(1);
		expect(decoded.secrets[0].name).toBe('GitHub');
	});

	it('keeps oversized HTML backups restorable by falling back to non-QR HTML', async () => {
		const secrets = Array.from({ length: MAX_HTML_QR_EXPORT_SECRETS + 1 }, (_, index) => ({
			id: String(index + 1),
			name: `Service-${index + 1}`,
			account: `user${index + 1}@example.com`,
			secret: 'JBSWY3DPEHPK3PXP',
			type: 'TOTP',
		}));

		const entry = await createBackupEntry(secrets, {}, { format: 'html', reason: 'scheduled' });

		expect(entry.backupKey.endsWith('.html')).toBe(true);
		expect(entry.content).toBeUndefined();
		expect(entry.backupContent).toContain('未嵌入二维码');
		expect(entry.backupContent).toContain(String(MAX_HTML_QR_EXPORT_SECRETS));
		expect(entry.backupContent).not.toContain('<img src="data:image/');
		expect(entry.backupContent).toContain('__2fa_backup_data__');

		const decoded = await decodeBackupEntry(entry.backupContent, {}, {
			backupKey: entry.backupKey,
			metadata: entry.metadata,
			strict: true,
		});

		expect(decoded.count).toBe(secrets.length);
		expect(decoded.partial).toBe(false);
		expect(decoded.secrets).toHaveLength(secrets.length);
	});

	it('stores skippedInvalidCount=0 in metadata for complete backups', async () => {
		const entry = await createBackupEntry(
			[
				{
					id: '1',
					name: 'GitHub',
					account: 'user@example.com',
					secret: 'JBSWY3DPEHPK3PXP',
					type: 'TOTP',
				},
			],
			{},
			{
				format: 'json',
				reason: 'manual',
				strict: true,
			},
		);

		expect(entry.skippedInvalidCount).toBe(0);
		expect(entry.metadata.skippedInvalidCount).toBe(0);
	});
});

describe('encrypted formatted backup format fallback', () => {
	it('uses metadata or file extension when encrypted formatted backups omit the format field', async () => {
		const env = {
			ENCRYPTION_KEY: Buffer.from('12345678901234567890123456789012').toString('base64'),
		};
		const backupContent = await encryptData(
			{
				type: 'formatted-backup',
				timestamp: '2026-04-16T00:00:00.000Z',
				reason: 'manual',
				count: 1,
				content:
					'otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&issuer=Test&period=30&digits=6&algorithm=SHA1',
			},
			env,
		);

		const decoded = await decodeBackupEntry(backupContent, env, {
			backupKey: 'backup_2026-04-16_00-00-00-000-test.txt',
			metadata: {
				format: 'txt',
				encrypted: true,
			},
			strict: true,
		});

		expect(decoded.format).toBe('txt');
		expect(decoded.count).toBe(1);
		expect(decoded.secrets[0]).toMatchObject({
			name: 'Test',
			secret: 'JBSWY3DPEHPK3PXP',
		});
	});
});

describe('restore validation of account parameters', () => {
	const encryptionEnv = { ENCRYPTION_KEY: Buffer.from('12345678901234567890123456789012').toString('base64') };
	const validSecret = {
		id: 'valid-1',
		name: 'GitHub',
		account: 'user@example.com',
		secret: 'JBSWY3DPEHPK3PXP',
		type: 'TOTP',
		digits: 6,
		period: 30,
		algorithm: 'SHA1',
		counter: 0,
	};
	const names = (decoded) => decoded.secrets.map((secret) => secret.name);

	it.each([
		['5 digits', { digits: 5 }],
		['a fractional digit count', { digits: 6.5 }],
		['a non-numeric digit count', { digits: 'abc' }],
		['the MD5 algorithm', { algorithm: 'MD5' }],
		['a fractional TOTP period', { period: 30.5 }],
		['a non-numeric TOTP period', { period: 'abc' }],
		['an unsupported OTP type', { type: 'STEAM' }],
		['a negative HOTP counter', { type: 'HOTP', counter: -1 }],
		['an unsafe HOTP counter', { type: 'HOTP', counter: Number.MAX_SAFE_INTEGER + 1 }],
	])('keeps a JSON entry with %s unchanged and lists it as unsupported instead of skipping it', (_label, override) => {
		const unsupported = { ...validSecret, id: 'unsupported', ...override };
		const content = JSON.stringify({ secrets: [validSecret, unsupported] });
		const decoded = decodeBackupContent(content, 'json', { strict: true });

		expect(decoded.secrets).toEqual([validSecret, unsupported]);
		expect(decoded.count).toBe(2);
		expect(decoded.skippedInvalidCount).toBe(0);
		expect(decoded.rejectedSecrets).toBeUndefined();
		expect(decoded.unsupportedSecrets).toEqual([{ entry: 2, name: 'GitHub', errors: [expect.any(String)] }]);
	});

	it('lists every unsupported parameter of an entry with its reason', () => {
		const content = JSON.stringify({
			secrets: [
				validSecret,
				{ ...validSecret, id: 'several', name: 'Several', digits: 5, algorithm: 'MD5', period: 'abc' },
				{ ...validSecret, id: 'steam', name: 'Steam', type: 'STEAM' },
				{ ...validSecret, id: 'negative', name: 'Negative counter', type: 'HOTP', counter: -1 },
			],
		});
		const decoded = decodeBackupContent(content, 'json', { strict: true });

		expect(names(decoded)).toEqual(['GitHub', 'Several', 'Steam', 'Negative counter']);
		expect(decoded.skippedInvalidCount).toBe(0);
		expect(decoded.unsupportedSecrets).toEqual([
			{ entry: 2, name: 'Several', errors: ['验证码位数仅支持6位或8位', '哈希算法仅支持SHA1、SHA256或SHA512', 'TOTP周期必须是正整数'] },
			{ entry: 3, name: 'Steam', errors: ['不支持的OTP类型，仅支持TOTP或HOTP'] },
			{ entry: 4, name: 'Negative counter', errors: ['HOTP计数器必须是非负安全整数'] },
		]);
	});

	it('skips structurally broken entries and keeps unsupported ones in the same backup', () => {
		// Passes the Base32 check (8 characters) but has a single non-padding character.
		const content = JSON.stringify({
			secrets: [
				validSecret,
				{ ...validSecret, id: 'short', name: 'Short', secret: 'A=======', digits: 5 },
				{ ...validSecret, id: 'five', name: 'Five digits', digits: 5 },
			],
		});
		const decoded = decodeBackupContent(content, 'json', { strict: true });

		expect(names(decoded)).toEqual(['GitHub', 'Five digits']);
		expect(decoded.skippedInvalidCount).toBe(1);
		// A skipped entry lists only its structural problems.
		expect(decoded.rejectedSecrets).toEqual([{ entry: 2, name: 'Short', errors: ['缺少有效密钥'] }]);
		expect(decoded.unsupportedSecrets).toEqual([{ entry: 3, name: 'Five digits', errors: ['验证码位数仅支持6位或8位'] }]);
	});

	it('treats a zero or blank digit count and period as the defaults in every format', async () => {
		const json = decodeBackupContent(
			JSON.stringify({
				secrets: [
					{ ...validSecret, id: 'zero', name: 'Zero', digits: 0, period: 0 },
					{ ...validSecret, id: 'blank', name: 'Blank', digits: '', period: null },
				],
			}),
			'json',
			{ strict: true },
		);
		const txt = decodeBackupContent(
			[
				'otpauth://totp/Zero?secret=JBSWY3DPEHPK3PXP&issuer=Zero&digits=0&period=0',
				'otpauth://totp/Blank?secret=JBSWY3DPEHPK3PXP&issuer=Blank&digits=&period=',
			].join('\n'),
			'txt',
			{ strict: true },
		);
		const { content: csv } = await encodeBackupContent([validSecret], { format: 'csv' });
		const csvDecoded = decodeBackupContent(`${csv}\n"Zero","","JBSWY3DPEHPK3PXP","TOTP",0,0,"SHA1",0`, 'csv', { strict: true });
		const params = (decoded) => decoded.secrets.map(({ name, digits, period }) => ({ name, digits, period }));

		expect(json.skippedInvalidCount).toBe(0);
		expect(params(json)).toEqual([
			{ name: 'Zero', digits: 6, period: 30 },
			{ name: 'Blank', digits: 6, period: 30 },
		]);
		expect(params(txt)).toEqual(params(json));
		expect(params(csvDecoded)[1]).toEqual({ name: 'Zero', digits: 6, period: 30 });
	});

	it('keeps entries the web UI accepts even where adding an account is stricter', async () => {
		const accepted = [
			{ ...validSecret, id: 'long-name', name: 'N'.repeat(62) },
			{ ...validSecret, id: 'period-45', name: 'Period 45', period: 45 },
			{ ...validSecret, id: 'period-15', name: 'Period 15', period: 15 },
			{ ...validSecret, id: 'hotp-period-0', name: 'HOTP period 0', type: 'HOTP', period: 0, counter: 3 },
			{ ...validSecret, id: 'totp-counter', name: 'Unused counter', counter: 'n/a' },
		];
		const decoded = decodeBackupContent(JSON.stringify({ secrets: accepted }), 'json', { strict: true });

		expect(decoded.skippedInvalidCount).toBe(0);
		expect(decoded.rejectedSecrets).toBeUndefined();
		// A zero period is treated as not set, like the web UI does.
		expect(decoded.secrets).toEqual(accepted.map((secret) => (secret.period === 0 ? { ...secret, period: 30 } : secret)));

		const hyphenated = decodeBackupContent(JSON.stringify({ secrets: [{ ...validSecret, algorithm: 'sha-256' }] }), 'json', {
			strict: true,
		});
		expect(hyphenated.secrets[0].algorithm).toBe('SHA256');

		const { content: csv } = await encodeBackupContent(accepted.slice(0, 2), { format: 'csv' });
		expect(decodeBackupContent(csv, 'csv', { strict: true }).secrets.map(({ name, period }) => ({ name, period }))).toEqual([
			{ name: 'N'.repeat(62), period: 30 },
			{ name: 'Period 45', period: 45 },
		]);
	});

	it('keeps CSV and otpauth entries with unsupported parameters unchanged', async () => {
		const { content: csv } = await encodeBackupContent([validSecret], { format: 'csv' });
		const csvWithUnsupportedRows = [
			csv,
			'"Five digits","","JBSWY3DPEHPK3PXP","TOTP",5,30,"SHA1",0',
			'"Unparsable digits","","JBSWY3DPEHPK3PXP","TOTP",abc,30,"SHA1",0',
			'"Unknown algorithm","","JBSWY3DPEHPK3PXP","TOTP",6,30,"MD5",0',
		].join('\n');
		const decodedCsv = decodeBackupContent(csvWithUnsupportedRows, 'csv', { strict: true });

		expect(names(decodedCsv)).toEqual(['GitHub', 'Five digits', 'Unparsable digits', 'Unknown algorithm']);
		expect(decodedCsv.secrets.slice(1).map(({ digits, algorithm }) => ({ digits, algorithm }))).toEqual([
			{ digits: 5, algorithm: 'SHA1' },
			{ digits: 'abc', algorithm: 'SHA1' },
			{ digits: 6, algorithm: 'MD5' },
		]);
		expect(decodedCsv.skippedInvalidCount).toBe(0);
		expect(decodedCsv.unsupportedSecrets.map(({ entry }) => entry)).toEqual([2, 3, 4]);

		const txt = [
			'otpauth://totp/GitHub:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub',
			'otpauth://totp/Seven?secret=JBSWY3DPEHPK3PXP&digits=7',
			'otpauth://totp/Md5?secret=JBSWY3DPEHPK3PXP&algorithm=MD5',
			'otpauth://steam/Steam?secret=JBSWY3DPEHPK3PXP',
		].join('\n');
		const decodedTxt = decodeBackupContent(txt, 'txt', { strict: true });

		expect(decodedTxt.count).toBe(4);
		expect(decodedTxt.secrets.slice(1).map(({ type, digits, algorithm }) => ({ type, digits, algorithm }))).toEqual([
			{ type: 'TOTP', digits: 7, algorithm: 'SHA1' },
			{ type: 'TOTP', digits: 6, algorithm: 'MD5' },
			{ type: 'STEAM', digits: 6, algorithm: 'SHA1' },
		]);
		expect(decodedTxt.skippedInvalidCount).toBe(0);
		expect(decodedTxt.unsupportedSecrets.map(({ entry }) => entry)).toEqual([2, 3, 4]);
	});

	it('keeps unsupported HTML entries from both the embedded JSON and the table fallback', async () => {
		const { content } = await encodeBackupContent([validSecret, { ...validSecret, id: 'five', name: 'Five digits', digits: 5 }], {
			format: 'html',
		});
		const tableOnly = content.replace(/<script id="__2fa_backup_data__"[\s\S]*?<\/script>/i, '');

		for (const html of [content, tableOnly]) {
			const decoded = decodeBackupContent(html, 'html', { strict: true });
			expect(names(decoded)).toEqual(['GitHub', 'Five digits']);
			expect(decoded.secrets[1].digits).toBe(5);
			expect(decoded.skippedInvalidCount).toBe(0);
			expect(decoded.unsupportedSecrets).toEqual([{ entry: 2, name: 'Five digits', errors: ['验证码位数仅支持6位或8位'] }]);
		}
	});

	it('numbers entries by their position in the backup even when unreadable rows were dropped first', async () => {
		const broken = { ...validSecret, id: 'broken', name: 'Broken', secret: 'MFRGGZDFMZTWQ2LK' };
		const five = { ...validSecret, id: 'five', name: 'Five digits', digits: 5 };
		const { content } = await encodeBackupContent([validSecret, broken, five], { format: 'html' });
		// A damaged HTML backup: no embedded data block and an unreadable secret in the second row.
		const tableOnly = content
			.replace(/<script id="__2fa_backup_data__"[\s\S]*?<\/script>/i, '')
			.replace(/otpauth:\/\/[^"'<>\s]+/gi, '')
			.replace(/MFRGGZDFMZTWQ2LK/g, '!!!!!!!!');
		const html = decodeBackupContent(tableOnly, 'html', { strict: true });

		expect(names(html)).toEqual(['GitHub', 'Five digits']);
		expect(html.skippedInvalidCount).toBe(1);
		expect(html.unsupportedSecrets).toEqual([{ entry: 3, name: 'Five digits', errors: ['验证码位数仅支持6位或8位'] }]);
		expect(html).not.toHaveProperty('entryNumbers');

		const txt = decodeBackupContent(
			[
				'otpauth://totp/GitHub?secret=JBSWY3DPEHPK3PXP',
				'not an otpauth url',
				'otpauth://totp/Five?secret=JBSWY3DPEHPK3PXP&digits=5',
			].join('\n'),
			'txt',
		);
		expect(txt.unsupportedSecrets).toEqual([{ entry: 3, name: 'Five', errors: ['验证码位数仅支持6位或8位'] }]);
		expect(txt).not.toHaveProperty('entryNumbers');
	});

	it('keeps defaults for omitted parameters and canonicalizes letter case', async () => {
		const decodedJson = decodeBackupContent(JSON.stringify({ secrets: [{ name: 'Legacy', secret: 'JBSWY3DPEHPK3PXP' }] }), 'json', {
			strict: true,
		});
		const { content: csv } = await encodeBackupContent([validSecret], { format: 'csv' });
		const decodedCsv = decodeBackupContent(`${csv}\n"Lowercase","","MFRGGZDFMZTWQ2LK","hotp",,,"sha256",7`, 'csv', { strict: true });

		expect(decodedJson.skippedInvalidCount).toBe(0);
		expect(decodedJson.secrets[0]).toMatchObject({ type: 'TOTP', digits: 6, period: 30, algorithm: 'SHA1', counter: 0 });
		expect(decodedCsv.skippedInvalidCount).toBe(0);
		expect(decodedCsv.secrets[1]).toMatchObject({ type: 'HOTP', digits: 6, period: 30, algorithm: 'SHA256', counter: 7 });
	});

	it('keeps usable ids, stores legacy numeric ids as strings and replaces only missing, unsafe or duplicate ones', () => {
		const content = JSON.stringify({
			secrets: [
				{ ...validSecret, id: 'same' },
				{ ...validSecret, id: 7, name: 'Legacy numeric' },
				{ ...validSecret, id: 0, name: 'Legacy zero' },
				{ ...validSecret, id: 'same', name: 'Duplicate' },
				{ ...validSecret, id: '7', name: 'Duplicate as string' },
				{ ...validSecret, id: 'has space', name: 'Spaced' },
				{ ...validSecret, id: '<b>&"\'\\', name: 'Markup' },
				{ ...validSecret, id: -1, name: 'Negative' },
				{ ...validSecret, id: 1.5, name: 'Fractional' },
				{ ...validSecret, id: '', name: 'Empty' },
				{ ...validSecret, id: undefined, name: 'Missing' },
			],
		});
		const decoded = decodeBackupContent(content, 'json', { strict: true });
		const ids = decoded.secrets.map((secret) => secret.id);

		expect(decoded.skippedInvalidCount).toBe(0);
		expect(names(decoded)).toEqual([
			'GitHub',
			'Legacy numeric',
			'Legacy zero',
			'Duplicate',
			'Duplicate as string',
			'Spaced',
			'Markup',
			'Negative',
			'Fractional',
			'Empty',
			'Missing',
		]);
		expect(ids.slice(0, 3)).toEqual(['same', '7', '0']);
		expect(ids.every((id) => typeof id === 'string')).toBe(true);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids.slice(3)) {
			expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
		}
	});

	it('keeps unsupported entries of encrypted legacy and formatted backups without marking them partial', async () => {
		const legacyContent = await encryptData(
			{ timestamp: '2026-04-16T00:00:00.000Z', secrets: [validSecret, { ...validSecret, id: 'md5', algorithm: 'MD5' }] },
			encryptionEnv,
		);
		const legacy = await decodeBackupEntry(legacyContent, encryptionEnv, {
			backupKey: 'backup_2026-04-16_00-00-00-000-test.json',
			strict: true,
		});

		expect(legacy.encrypted).toBe(true);
		expect(legacy.count).toBe(2);
		expect(legacy.partial).toBe(false);
		expect(legacy.skippedInvalidCount).toBe(0);
		expect(legacy.unsupportedSecrets).toEqual([{ entry: 2, name: 'GitHub', errors: ['哈希算法仅支持SHA1、SHA256或SHA512'] }]);

		// One entry is skipped while creating the backup: that alone makes it partial.
		const entry = await createBackupEntry(
			[validSecret, { ...validSecret, id: 'blank', secret: '   ' }, { ...validSecret, id: 'five', digits: 5 }],
			encryptionEnv,
			{ format: 'csv', reason: 'scheduled', strict: false },
		);
		const formatted = await decodeBackupEntry(entry.backupContent, encryptionEnv, {
			backupKey: entry.backupKey,
			metadata: entry.metadata,
			strict: true,
		});

		expect(entry.skippedInvalidCount).toBe(1);
		expect(formatted.count).toBe(2);
		expect(formatted.partial).toBe(true);
		expect(formatted.skippedInvalidCount).toBe(1);
		expect(formatted.rejectedSecrets).toBeUndefined();
		expect(formatted.unsupportedSecrets.map(({ entry: number }) => number)).toEqual([2]);
	});
});
