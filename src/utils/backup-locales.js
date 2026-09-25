import { SUPPORTED_LANGUAGES, normalizeLanguage } from '../shared/languages.js';
import { localizeDictionary } from '../shared/locales/index.js';

/** Labels for portable HTML and CSV backup documents. */
export const BACKUP_DOCUMENT_LOCALES = {
	'zh-CN': {
		headers: ['服务名称', '账户信息', '密钥', '类型', '位数', '周期(秒)', '算法', '计数器'],
		title: '2FA 密钥备份',
		created: '创建时间：',
		count: '备份数量：',
		format: '格式：',
		table: '备份密钥表格',
		qr: '二维码',
		qrAlt: '{name} 的二维码',
		qrSkipped: '数量过多，未嵌入',
		qrOmitted: '未嵌入',
		withQr: 'HTML（含二维码）',
		withoutQr: 'HTML（未嵌入二维码）',
		qrHelp: '每行二维码可直接扫码导入到支持 OTPAuth 的验证器。',
		qrLimit: '当前备份共有 {count} 条密钥，超过 {limit} 条二维码内嵌上限，已保留完整可恢复数据和密钥表格，但未嵌入二维码。',
		noQrHelp: '当前文件未嵌入二维码，但已保留完整可恢复数据和密钥表格。',
		partial: '警告：已跳过 {skipped} 条无效密钥。此备份仅保留 {count} 条可恢复数据。',
	},
	'zh-TW': {
		headers: ['服務名稱', '帳戶資訊', '金鑰', '類型', '位數', '週期(秒)', '演算法', '計數器'],
		title: '2FA 金鑰備份',
		created: '建立時間：',
		count: '備份數量：',
		format: '格式：',
		table: '備份金鑰表格',
		qr: 'QR 碼',
		qrAlt: '{name} 的 QR 碼',
		qrSkipped: '數量過多，未嵌入',
		qrOmitted: '未嵌入',
		withQr: 'HTML（含 QR 碼）',
		withoutQr: 'HTML（未嵌入 QR 碼）',
		qrHelp: '每列 QR 碼皆可直接掃描匯入支援 OTPAuth 的驗證器。',
		qrLimit: '目前備份共有 {count} 筆金鑰，超過 {limit} 筆 QR 碼內嵌上限，已保留完整可還原資料和金鑰表格，但未嵌入 QR 碼。',
		noQrHelp: '目前檔案未嵌入 QR 碼，但已保留完整可還原資料和金鑰表格。',
		partial: '警告：已略過 {skipped} 筆無效金鑰。此備份僅保留 {count} 筆可還原資料。',
	},
	en: {
		headers: ['Service', 'Account', 'Secret', 'Type', 'Digits', 'Period (seconds)', 'Algorithm', 'Counter'],
		title: '2FA Key Backup',
		created: 'Created:',
		count: 'Backup entries:',
		format: 'Format:',
		table: 'Backed-up keys',
		qr: 'QR Code',
		qrAlt: 'QR code for {name}',
		qrSkipped: 'Too many entries to embed',
		qrOmitted: 'Not embedded',
		withQr: 'HTML (with QR codes)',
		withoutQr: 'HTML (without QR codes)',
		qrHelp: 'Scan each QR code to import it into an authenticator that supports OTPAuth.',
		qrLimit:
			'This backup contains {count} keys, exceeding the limit of {limit} embedded QR codes. All recoverable data and the key table are included, without QR codes.',
		noQrHelp: 'This file includes all recoverable data and the key table, without embedded QR codes.',
		partial: 'Warning: {skipped} invalid keys were skipped. This backup preserves only {count} recoverable entries.',
	},
};

for (const language of SUPPORTED_LANGUAGES) {
	if (!BACKUP_DOCUMENT_LOCALES[language]) {
		BACKUP_DOCUMENT_LOCALES[language] = localizeDictionary(language, BACKUP_DOCUMENT_LOCALES.en);
	}
}

export function getBackupDocumentText(language, key, params = {}) {
	const value = (BACKUP_DOCUMENT_LOCALES[normalizeLanguage(language)] || BACKUP_DOCUMENT_LOCALES.en)[key];
	return value.replace(/\{(\w+)\}/g, (match, name) => (params[name] === undefined ? match : String(params[name])));
}
