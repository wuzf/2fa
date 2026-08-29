import { describe, expect, it } from 'vitest';

import { createMainPage } from '../../src/ui/page.js';
import { getScripts } from '../../src/ui/scripts/index.js';
import { getSettingsCode } from '../../src/ui/scripts/settings.js';

describe('settings module code generation', () => {
	it('guards the default export format against stale preference loads and saves', () => {
		const code = getSettingsCode();

		expect(code).toContain('let preferencesLoadRequestId = 0;');
		expect(code).toContain('let defaultExportFormatChangeVersion = 0;');
		expect(code).toContain('let defaultExportFormatSaveRequestId = 0;');
		expect(code).toContain('const requestId = ++preferencesLoadRequestId;');
		expect(code).toContain('const formatVersionAtStart = defaultExportFormatChangeVersion;');
		expect(code).toContain('if (requestId !== preferencesLoadRequestId) {');
		expect(code).toContain('const selectedFormat = formatSelect.value;');
		expect(code).toContain('const requestId = ++defaultExportFormatSaveRequestId;');
		expect(code).toContain('body: JSON.stringify({ defaultExportFormat: selectedFormat }),');
		expect(code).toContain('if (requestId !== defaultExportFormatSaveRequestId) {');
		expect(code).toContain('const savedFormat = (data.settings && data.settings.defaultExportFormat) || selectedFormat;');
		expect(code).toContain('偏好格式已保存，批量导出和备份导出会优先使用该格式');
	});

	it('loads and applies the local OTP animation preference through the OTP public API', () => {
		const code = getSettingsCode();

		expect(code).toContain("document.getElementById('settingsOTPAnimationMode')");
		expect(code).toContain('getOTPAnimationMode()');
		expect(code).toMatch(/function applyOTPAnimationFromSettings\(mode\)/);
		expect(code).toContain('setOTPAnimationMode(mode)');
	});

	it('includes settings in the full non-lazy script bundle', () => {
		const scripts = getScripts();

		expect(scripts).toContain(getSettingsCode());
		expect(scripts).toContain('function applyOTPAnimationFromSettings(mode)');
	});

	it('renders the four animation choices with an immediate change handler', async () => {
		const response = await createMainPage({ lazyLoad: false });
		const html = await response.text();
		const select = html.match(/<select\b[^>]*\bid="settingsOTPAnimationMode"[^>]*>[\s\S]*?<\/select>/)?.[0];

		expect(html).toContain('<h3 class="settings-section-title" id="settingsOTPAnimationTitle">验证码交接动效</h3>');
		expect(select).toBeTruthy();
		expect(select).toContain('onchange="applyOTPAnimationFromSettings(this.value)"');
		const options = [...select.matchAll(/<option\s+value="([^"]+)">([^<]+)<\/option>/g)].map((match) => ({
			value: match[1],
			label: match[2],
		}));
		expect(options).toEqual([
			{ value: 'none', label: '关闭动效' },
			{ value: 'flow', label: '流转交接' },
			{ value: 'flip', label: '翻牌交接' },
			{ value: 'spotlight', label: '聚光显现' },
		]);
	});
});
