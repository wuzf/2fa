import { describe, expect, it } from 'vitest';

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
});
