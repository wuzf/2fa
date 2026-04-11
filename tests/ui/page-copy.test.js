import { describe, expect, it } from 'vitest';

import { createMainPage } from '../../src/ui/page.js';

describe('settings page copy', () => {
	it('explains that the default export format also applies to newly created backups', async () => {
		const response = await createMainPage({ lazyLoad: false });
		const html = await response.text();

		expect(html).toContain('也会用于新创建的手动备份、自动备份和远程自动备份文件');
		expect(html).not.toContain('不会改变内部备份的完整格式');
	});
});
