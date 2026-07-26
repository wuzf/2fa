/**
 * 应用版本工具
 * APP_VERSION 必须与 package.json 的 version 保持一致（tests/utils/version.test.js 强制校验），
 * 发版时与 package.json、git tag 一起更新
 */

export const APP_VERSION = '1.6.0';

/**
 * 比较两个语义化版本号（支持 "v" 前缀）
 * @param {string} a - 版本号，如 "1.5.0" 或 "v1.5.0"
 * @param {string} b - 版本号
 * @returns {number} a > b 返回 1，a < b 返回 -1，相等返回 0
 */
export function compareVersions(a, b) {
	const parse = (v) =>
		String(v)
			.trim()
			.replace(/^v/i, '')
			.split('.')
			.map((n) => parseInt(n, 10) || 0);
	const pa = parse(a);
	const pb = parse(b);
	const len = Math.max(pa.length, pb.length);
	for (let i = 0; i < len; i++) {
		const x = pa[i] || 0;
		const y = pb[i] || 0;
		if (x > y) {
			return 1;
		}
		if (x < y) {
			return -1;
		}
	}
	return 0;
}
