import { SUPPORTED_LANGUAGES } from '../../shared/languages.js';
import { localizeDictionary } from '../../shared/locales/index.js';

export const OFFLINE_MESSAGES = {
	'zh-CN': {
		unavailable: '离线不可用',
		onlineRequired: '当前请求需要在线完成，无法加入离线同步队列',
		queued: '您处于离线状态，操作已保存，网络恢复后将自动同步',
		networkFailed: '网络连接失败',
		queueFailed: '无法连接到服务器，且无法保存离线操作',
		connectFailed: '无法连接到服务器，请检查网络连接',
		resourceUnavailable: '离线模式：无法访问此资源',
		notification: '您有新的通知',
		queueUnavailable: '暂时无法处理，请确认已登录后重试',
	},
	'zh-TW': {
		unavailable: '離線時無法使用',
		onlineRequired: '目前請求需要連線才能完成，無法加入離線同步佇列',
		queued: '目前離線，操作已儲存，網路恢復後將自動同步',
		networkFailed: '網路連線失敗',
		queueFailed: '無法連線至伺服器，且無法儲存離線操作',
		connectFailed: '無法連線至伺服器，請檢查網路連線',
		resourceUnavailable: '離線模式：無法存取此資源',
		notification: '您有新的通知',
		queueUnavailable: '暫時無法處理，請確認已登入後重試',
	},
	en: {
		unavailable: 'Unavailable offline',
		onlineRequired: 'This request requires a connection and cannot be queued for offline sync',
		queued: 'You are offline. Your change has been saved and will sync when you reconnect.',
		networkFailed: 'Network connection failed',
		queueFailed: 'Unable to connect to the server or save the offline change',
		connectFailed: 'Unable to connect to the server. Check your network connection.',
		resourceUnavailable: 'Offline: this resource is unavailable',
		notification: 'You have a new notification',
		queueUnavailable: 'Unable to process this request. Check that you are logged in and retry.',
	},
};

for (const language of SUPPORTED_LANGUAGES) {
	if (!Object.hasOwn(OFFLINE_MESSAGES, language)) {
		OFFLINE_MESSAGES[language] = localizeDictionary(language, OFFLINE_MESSAGES.en);
	}
}
