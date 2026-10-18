import { describe, expect, it } from 'vitest';

import { createMainPage } from '../../src/ui/page.js';

describe('settings page copy', () => {
	it('keeps account security settings without the removed device authorization entry', async () => {
		const response = await createMainPage({ lazyLoad: false });
		const html = await response.text();

		expect(html).toContain('id="settingsCurrentPassword"');
		expect(html).not.toContain('href="/devices"');
		expect(html).not.toContain('浏览器扩展设备');
		expect(html).not.toContain('管理扩展设备授权');
	});

	it('explains that the default export format also applies to newly created backups', async () => {
		const response = await createMainPage({ lazyLoad: false });
		const html = await response.text();

		expect(html).toContain('也会用于新创建的手动备份、自动备份和远程自动备份文件');
		expect(html).not.toContain('不会改变内部备份的完整格式');
	});

	it('keeps clock synchronization in the background without a warning or retry action', async () => {
		const response = await createMainPage({ lazyLoad: false });
		const html = await response.text();

		expect(html).not.toContain('id="clockWarning"');
		expect(html).not.toContain('id="clockWarningText"');
		expect(html).not.toContain('id="clockSyncRetryButton"');
		expect(html).not.toContain('retryClockSync');
	});

	it('renders accessible automatic grouping and flat view controls', async () => {
		const response = await createMainPage({ lazyLoad: false });
		const html = await response.text();

		expect(html).toContain('aria-label="显示与排序"');
		expect(html).toContain('class="view-mode-option active" data-view-mode="grouped" aria-pressed="true"');
		expect(html).toContain('class="view-mode-option" data-view-mode="flat" aria-pressed="false"');
		expect(html).toContain('class="sort-menu-section group-sort-only" id="groupSortSection"');
		expect(html).toContain('class="group-sort-option active" data-group-sort="name-asc" aria-pressed="true"');
		expect(html).toContain('id="sortModeLabel">组内排序');
		expect(html).toContain('class="sort-option flat-sort-only" data-sort="name-asc"');
		expect(html).toContain('class="sort-option flat-sort-only" data-sort="name-desc"');
		expect(html).toContain('class="sort-options" role="group"');
		expect(html).toContain('aria-pressed="true" class="sort-option active"');
		expect(html).toContain('id="searchStats" role="status" aria-live="polite"');
		expect(html).not.toContain('id="searchStats" role="status" aria-live="polite" aria-atomic="true" style="display: none;"');
		expect(html).toContain('oninput="scheduleSecretFilter(this.value)"');
	});
});
