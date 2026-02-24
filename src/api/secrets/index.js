/**
 * API 处理器入口文件（Barrel Export）
 *
 * 重新导出所有 API 处理器，保持向后兼容性
 * 允许外部代码继续使用 `import { handleGetSecrets } from './api/secrets'`
 *
 * 模块组织:
 * - shared.js: 共享工具函数（saveSecretsToKV, getAllSecrets）
 * - crud.js: CRUD 操作（GET, POST, PUT, DELETE）
 * - batch.js: 批量导入（POST batch）
 * - backup.js: 备份创建和列表（POST, GET backup）
 * - restore.js: 备份恢复和导出（POST restore, GET export）
 * - otp.js: OTP 生成（GET otp）
 */

// CRUD 操作处理器
export { handleGetSecrets, handleAddSecret, handleUpdateSecret, handleDeleteSecret } from './crud.js';

// 批量导入处理器
export { handleBatchAddSecrets } from './batch.js';

// 备份处理器
export { handleBackupSecrets, handleGetBackups } from './backup.js';

// 恢复和导出处理器
export { handleExportBackup, handleRestoreBackup } from './restore.js';

// OTP 生成处理器
export { handleGenerateOTP } from './otp.js';

// 共享工具函数（内部使用或测试）
export { saveSecretsToKV, getAllSecrets } from './shared.js';
