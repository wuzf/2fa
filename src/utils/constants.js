/**
 * Centralized constants for KV keys and configuration
 * 集中管理 KV 键名和配置常量
 */

// =============================================================================
// KV Storage Keys
// =============================================================================

export const KV_KEYS = {
	// Main data keys
	SECRETS: 'secrets',
	PASSWORD: 'password',
	SETTINGS: 'settings',

	// Backup keys
	BACKUP_PREFIX: 'backup:',
	BACKUP_METADATA: 'backup:metadata',
	LAST_HASH: 'last-data-hash',

	// Rate limiting
	RATE_LIMIT_PREFIX: 'ratelimit:',

	// Session
	SESSION_PREFIX: 'session:',

	// Setup
	SETUP_COMPLETED: 'setup_completed',
};

// =============================================================================
// Limits and Thresholds
// =============================================================================

export const LIMITS = {
	// Backup configuration
	BACKUP_DEBOUNCE_MS: 5 * 60 * 1000, // 5 minutes - debounce interval for backup triggers

	// Secret limits
	MAX_SECRETS: 1000, // Maximum number of secrets allowed
	MAX_SECRET_NAME_LENGTH: 100, // Maximum length for secret name
	MAX_ACCOUNT_LENGTH: 100, // Maximum length for account name
	MAX_ISSUER_LENGTH: 100, // Maximum length for issuer

	// OTP configuration
	OTP_PERIOD_DEFAULT: 30, // Default TOTP period in seconds
	OTP_DIGITS_DEFAULT: 6, // Default number of OTP digits
	OTP_ALGORITHM_DEFAULT: 'SHA1', // Default HMAC algorithm

	// File size limits
	MAX_IMPORT_SIZE: 5 * 1024 * 1024, // 5MB - max import file size
	MAX_EXPORT_SIZE: 10 * 1024 * 1024, // 10MB - max export file size
};

// =============================================================================
// Rate Limiting Configuration
// =============================================================================

export const RATE_LIMITS = {
	// Login attempts - strict limit
	LOGIN: {
		max: 5,
		window: 60, // 5 attempts per minute
		message: '登录尝试过于频繁，请稍后再试',
	},

	// General API operations
	API: {
		max: 30,
		window: 60, // 30 requests per minute
		message: '请求过于频繁，请稍后再试',
	},

	// Sensitive operations (delete, export)
	SENSITIVE: {
		max: 10,
		window: 60, // 10 requests per minute
		message: '敏感操作过于频繁，请稍后再试',
	},

	// Bulk operations (batch import)
	BULK: {
		max: 5,
		window: 300, // 5 requests per 5 minutes
		message: '批量操作过于频繁，请稍后再试',
	},

	// Global protection
	GLOBAL: {
		max: 100,
		window: 60, // 100 requests per minute globally
		message: '服务器繁忙，请稍后再试',
	},

	// OTP generation
	OTP: {
		max: 100,
		window: 60, // 100 OTP generations per minute
		message: 'OTP 生成过于频繁',
	},
};

// =============================================================================
// Security Configuration
// =============================================================================

export const SECURITY = {
	// JWT configuration (defaults, can be overridden via settings UI)
	JWT_EXPIRY_DAYS_DEFAULT: 30, // JWT token default expiration in days
	JWT_REFRESH_RATIO: 0.25, // Refresh when remaining time < 25% of expiry

	// Password requirements
	PASSWORD_MIN_LENGTH: 8,
	PASSWORD_MAX_LENGTH: 128,

	// PBKDF2 configuration
	PBKDF2_ITERATIONS: 100000,
	PBKDF2_KEY_LENGTH: 32,
	PBKDF2_HASH: 'SHA-256',

	// Encryption configuration
	ENCRYPTION_ALGORITHM: 'AES-GCM',
	ENCRYPTION_KEY_LENGTH: 256,
	ENCRYPTION_IV_LENGTH: 12, // 96 bits for AES-GCM
	ENCRYPTION_TAG_LENGTH: 128, // 128 bits auth tag

	// Cookie configuration
	COOKIE_NAME: 'auth_token',
	COOKIE_MAX_AGE: 30 * 24 * 60 * 60, // Default 30 days in seconds (actual value computed from jwtExpiryDays setting at runtime)
};

// =============================================================================
// OTP Configuration
// =============================================================================

export const OTP_CONFIG = {
	// Supported algorithms
	ALGORITHMS: ['SHA1', 'SHA256', 'SHA512'],

	// Supported periods (seconds)
	PERIODS: [30, 60, 120],

	// Supported digit counts
	DIGITS: [6, 8],

	// OTP types
	TYPES: {
		TOTP: 'totp',
		HOTP: 'hotp',
	},
};

// =============================================================================
// HTTP Configuration
// =============================================================================

export const HTTP = {
	// Content types
	CONTENT_TYPE_JSON: 'application/json',
	CONTENT_TYPE_HTML: 'text/html; charset=utf-8',
	CONTENT_TYPE_JS: 'application/javascript',
	CONTENT_TYPE_CSS: 'text/css',

	// Cache control
	CACHE_NO_STORE: 'no-store, no-cache, must-revalidate',
	CACHE_STATIC: 'public, max-age=31536000, immutable',

	// Common headers
	HEADERS: {
		CONTENT_TYPE: 'Content-Type',
		CACHE_CONTROL: 'Cache-Control',
		X_CONTENT_TYPE_OPTIONS: 'X-Content-Type-Options',
		X_FRAME_OPTIONS: 'X-Frame-Options',
		X_XSS_PROTECTION: 'X-XSS-Protection',
	},
};

// =============================================================================
// Error Codes
// =============================================================================

export const ERROR_CODES = {
	// Authentication errors (1xxx)
	AUTH_REQUIRED: 1001,
	AUTH_INVALID: 1002,
	AUTH_EXPIRED: 1003,
	PASSWORD_REQUIRED: 1004,
	PASSWORD_INVALID: 1005,

	// Validation errors (2xxx)
	VALIDATION_FAILED: 2001,
	INVALID_INPUT: 2002,
	MISSING_REQUIRED: 2003,
	DUPLICATE_ENTRY: 2004,

	// Resource errors (3xxx)
	NOT_FOUND: 3001,
	ALREADY_EXISTS: 3002,

	// Rate limiting (4xxx)
	RATE_LIMITED: 4001,

	// Server errors (5xxx)
	INTERNAL_ERROR: 5001,
	STORAGE_ERROR: 5002,
	ENCRYPTION_ERROR: 5003,
};

// =============================================================================
// Theme Configuration
// =============================================================================

export const THEME = {
	// Theme modes
	LIGHT: 'light',
	DARK: 'dark',
	AUTO: 'auto',

	// LocalStorage key
	STORAGE_KEY: 'theme',

	// Data attribute
	DATA_ATTRIBUTE: 'data-theme',

	// CSS transition duration (ms)
	TRANSITION_DURATION: 300,

	// Icons for each theme mode
	ICONS: {
		light: '☀️',
		dark: '🌙',
		auto: '🌓',
	},

	// Labels for accessibility (Chinese)
	LABELS: {
		light: {
			title: '当前：浅色模式（点击切换）',
			ariaLabel: '切换主题：当前浅色模式',
		},
		dark: {
			title: '当前：深色模式（点击切换）',
			ariaLabel: '切换主题：当前深色模式',
		},
		auto: {
			title: '当前：跟随系统（点击切换）',
			ariaLabel: '切换主题：当前跟随系统',
		},
	},
};
