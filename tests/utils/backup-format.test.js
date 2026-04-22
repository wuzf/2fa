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
