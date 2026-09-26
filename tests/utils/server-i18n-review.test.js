import { describe, expect, it } from 'vitest';
import { getRequestLanguage, localizeResponseData, translateServerMessage } from '../../src/utils/i18n.js';
import { createJsonResponse } from '../../src/utils/response.js';
import { errorToResponse, ValidationError } from '../../src/utils/errors.js';
import { serverMessages, getServerTranslations } from '../../src/utils/server-messages.js';

describe('independent server localization review', () => {
	it.each(['Vary', 'vary'])('retains caller and security cache variation when the caller uses %s', async (header) => {
		const request = new Request('https://example.com/api/test?language=zh-Hant', {
			headers: { Host: 'example.com', Origin: 'https://example.com' },
		});
		const response = createJsonResponse({ message: '密码错误' }, 400, request, {
			[header]: 'Accept-Encoding',
			'Cache-Control': 'no-store',
		});
		expect(response.headers.get('Content-Language')).toBe('zh-TW');
		expect(
			new Set(
				response.headers
					.get('Vary')
					.split(',')
					.map((value) => value.trim().toLowerCase()),
			),
		).toEqual(new Set(['origin', 'accept-encoding', 'x-language', 'accept-language']));
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
		expect(await response.json()).toMatchObject({ message: '密碼錯誤' });
	});

	it('preserves user records and configuration while translating nested response diagnostics without mutating input', () => {
		const record = { name: '密码错误', account: '服务"名称" 已存在', secret: 'JBSWY3DPEHPK3PXP', message: '密钥添加成功' };
		const payload = {
			message: '密钥添加成功',
			data: { secret: record, warning: '密钥不能为空', config: { message: '密码错误', error: '密码错误' } },
			results: [{ index: 0, secret: record, error: '服务"中文; 名称"的账户"<script>原文</script>"密钥已存在' }],
			backups: [{ metadata: { message: '密码错误' } }],
			destinations: [{ name: '密码错误', status: { lastError: { error: 'WebDAV 推送失败: 密码错误' } } }],
		};
		const snapshot = globalThis.structuredClone(payload);
		const translated = localizeResponseData(payload, 'en');
		expect(translated.data.secret).toEqual(record);
		expect(translated.data.config).toEqual(payload.data.config);
		expect(translated.results[0].secret).toEqual(record);
		expect(translated.backups).toEqual(payload.backups);
		expect(translated.results[0].error).toBe('A secret for service "中文; 名称" and account "<script>原文</script>" already exists');
		expect(translated.destinations[0].name).toBe('密码错误');
		expect(translated.destinations[0].status.lastError.error).toBe('WebDAV upload failed: Incorrect password');
		expect(payload).toEqual(snapshot);
	});

	it('honors regional URL aliases, header priority and weighted browser preferences', () => {
		expect(getRequestLanguage(new Request('https://example.com/?language=en-GB', { headers: { 'Accept-Language': 'zh-CN' } }))).toBe('en');
		expect(getRequestLanguage(new Request('https://example.com/?lang=zh-Hant', { headers: { 'X-Language': 'en-US' } }))).toBe('en');
		expect(
			getRequestLanguage(new Request('https://example.com/', { headers: { 'Accept-Language': 'en;q=0, fr;q=1, zh-HK;q=.9, zh-CN;q=.2' } })),
		).toBe('fr');
		expect(
			getRequestLanguage(new Request('https://example.com/', { headers: { 'Accept-Language': 'en;q=NaN, zh-TW;q=-1, zh-CN;q=2' } }), 'en'),
		).toBe('en');
	});

	it('keeps operational error codes and unknown diagnostics intact', async () => {
		const request = new Request('https://example.com/api/test', { headers: { 'X-Language': 'en' } });
		const response = errorToResponse(new ValidationError('密钥不能为空', { field: 'secret', value: '密码错误' }), request);
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			error: 'ValidationError',
			message: 'Secret is required',
			details: { field: 'secret', value: '密码错误' },
		});
		expect(translateServerMessage('Provider-specific failure: 0x15 (用户自定义详情)', 'en')).toBe(
			'Provider-specific failure: 0x15 (用户自定义详情)',
		);
	});

	it('preserves every registered template parameter and does not shadow a more specific message', () => {
		const values = { message: '密码错误' };
		const fill = (template, language) =>
			template.replace(/\{(\w+)\}/g, (_, key) =>
				key === 'message' ? translateServerMessage(values.message, language) : `USER_VALUE_${key}`,
			);
		for (const row of serverMessages) {
			const original = fill(row[0], 'zh-CN');
			for (const [language, template] of Object.entries(getServerTranslations(row))) {
				expect(translateServerMessage(original, language), `${language}: ${row[0]}`).toBe(fill(template, language));
			}
		}
	});

	it('drops the full stop that some translations put after each reason before joining them', () => {
		const reasons = [
			'服务名称不能为空',
			'字段 "account" 类型错误，期望 string',
			'缺少有效密钥',
			'不支持的OTP类型，仅支持TOTP或HOTP',
			'验证码位数仅支持6位或8位',
			'哈希算法仅支持SHA1、SHA256或SHA512',
			'TOTP周期必须是正整数',
			'HOTP计数器必须是非负安全整数',
		];
		const warning = `第 2 条（A）：${reasons.join('；')}`;
		for (const language of ['en', 'zh-TW', 'ja', 'ko', 'ru', 'de', 'fr', 'es', 'pt-BR', 'it', 'tr', 'vi', 'id', 'th']) {
			const translated = translateServerMessage(warning, language);
			expect(translated, language).not.toBe(warning);
			expect(translated, language).not.toMatch(/[.。][;；]/u);
		}
	});
});
