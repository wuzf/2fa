/**
 * 样式模块集成
 * 将所有样式模块组合成完整的 <style> 标签
 */

import { getVariables } from './variables.js';
import { getBaseStyles } from './base.js';
import { getComponentStyles } from './components.js';
import { getModalStyles } from './modals.js';
import { getResponsiveStyles } from './responsive.js';

/**
 * 获取完整的样式内容
 * @returns {string} 完整的 <style>...</style> 标签
 */
export function getStyles() {
	return `
  <style>
${getVariables()}
${getBaseStyles()}${getComponentStyles()}${getModalStyles()}${getResponsiveStyles()}  </style>
</head>`;
}
