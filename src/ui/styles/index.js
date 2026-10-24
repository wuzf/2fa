/**
 * 样式模块集成
 * 将所有样式模块组合成完整的 <style> 标签
 */

import { getVariables } from './variables.js';
import { getBaseStyles } from './base.js';
import { getComponentStyles } from './components.js';
import { getModalStyles } from './modals.js';
import { getResponsiveStyles } from './responsive.js';
import { getDialogStyles } from './dialogs.js';
import { getWorkspaceStyles } from './workspace.js';
import { getAppearanceStyles } from './appearance.js';
import { getAppearanceEditorStyles } from './appearanceEditor.js';
import { getAppThemeStatusStyles } from './appThemeStatus.js';
import { scopeHostStyles } from './hostScope.js';
import { getHostPartStyles } from './hostParts.js';

let cachedStyles;

/**
 * 获取完整的样式内容
 * @returns {string} 完整的 <style>...</style> 标签
 */
export function getStyles() {
	// Release builds embed the already-scoped CSS; production requests never parse it.
	if (typeof globalThis.__2FA_HOST_STYLES__ === 'string') {
		return globalThis.__2FA_HOST_STYLES__;
	}
	if (cachedStyles === undefined) {
		const css = `${getVariables()}
${getBaseStyles()}${getComponentStyles()}${getModalStyles()}${getResponsiveStyles()}${getWorkspaceStyles()}${getDialogStyles()}${getAppearanceStyles()}${getAppearanceEditorStyles()}${getAppThemeStatusStyles()}${getHostPartStyles()}`;
		// The style modules are static. Parse once per Worker isolate, never per page request.
		cachedStyles = `
  <style>
${scopeHostStyles(css)}  </style>
</head>`;
	}
	return cachedStyles;
}
