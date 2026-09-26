/**
 * Service Worker 生成模块
 * 提供离线支持和缓存管理
 */

import { createOfflinePage } from './offlinePage.js';
import { OFFLINE_MESSAGES } from './locales/offline.js';
import { normalizeLanguage } from '../shared/languages.js';

/**
 * 生成 Service Worker 脚本
 * @returns {Response} Service Worker JavaScript 响应
 */
export function createServiceWorker(env = {}) {
	const embeddedBuildVersion = typeof globalThis.__BUILD_SW_VERSION__ === 'string' ? globalThis.__BUILD_SW_VERSION__ : '';
	// 🚀 自动版本管理：从环境变量读取版本号
	// 支持多种版本策略：
	// 1. env.SW_VERSION - 构建时注入的版本号（推荐）
	// 2. env.BUILD_TIMESTAMP - 构建时间戳
	// 3. __BUILD_SW_VERSION__ - 单文件 release 构建时内嵌的版本号
	// 4. 'v1' - 默认版本（后备）
	const version = env.SW_VERSION || env.BUILD_TIMESTAMP || embeddedBuildVersion || 'v1';

	// 生成缓存名称
	const CACHE_NAME = `2fa-cache-${version}`;
	const RUNTIME_CACHE = `2fa-runtime-${version}`;

	const swScript = `
/**
 * 2FA - Service Worker
 * 版本: ${version}
 *
 * ⚡ 自动版本管理：
 * - 每次部署自动更新缓存版本
 * - 自动清理旧版本缓存
 * - 无需手动维护版本号
 * 提供离线支持和资源缓存
 */

const CACHE_NAME = '${CACHE_NAME}';
const RUNTIME_CACHE = '${RUNTIME_CACHE}';
const DB_NAME = '2fa-offline-db';
const DB_VERSION = 1;
const SW_VERSION = '${version}';
const STORE_NAME = 'pending-operations';
const OFFLINE_PAGE = ${JSON.stringify(createOfflinePage())};
const OFFLINE_MESSAGES = ${JSON.stringify(OFFLINE_MESSAGES)};
const offlineLanguage = ${normalizeLanguage.toString()};
function offlineRequestLanguage(request) {
  const explicit = request.headers.get('X-Language');
  if (typeof explicit === 'string') return offlineLanguage(explicit) || 'en';
  const params = new URL(request.url).searchParams;
  const query = params.has('lang') ? params.get('lang') : params.get('language');
  if (query !== null) return offlineLanguage(query) || 'en';
  const languages = (request.headers.get('Accept-Language') || '').split(',').map((entry, index) => {
    const [tag, ...parameters] = entry.trim().split(';');
    const quality = parameters.find(parameter => /^\\s*q\\s*=/i.test(parameter));
    const q = quality ? Number(quality.split('=')[1]) : 1;
    return { language: offlineLanguage(tag), q, index };
  }).filter(item => item.language && Number.isFinite(item.q) && item.q > 0 && item.q <= 1)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  const requested = request.headers.get('X-Language') || params.get('lang') || params.get('language') || request.headers.get('Accept-Language');
  return languages[0]?.language || (requested ? 'en' : 'zh-CN');
}
function offlineText(key, language) {
  return OFFLINE_MESSAGES[offlineLanguage(language) || 'en'][key];
}
let syncPendingOperationsPromise = null;
let offlineQueueTail = Promise.resolve();

// 版本信息（用于调试）
console.log('[SW] Service Worker 版本:', SW_VERSION);
console.log('[SW] 缓存名称:', CACHE_NAME);

// 需要缓存的静态资源
const STATIC_RESOURCES = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
  // 注意：API 请求不缓存，因为需要实时数据
];

// 外部 CDN 资源（Service Worker 会自动缓存）
const CDN_RESOURCES = [
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'
];

function serializeOfflineQueue(operation) {
  const pending = offlineQueueTail.then(operation);
  offlineQueueTail = pending.catch(() => {});
  return pending;
}

function transactionDone(transaction) {
  const done = new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error || new Error('保存更改失败，请重试'));
    transaction.onerror = () => {};
  });
  // A request may fail before its transaction abort is delivered.
  void done.catch(() => {});
  return done;
}

// ==================== IndexedDB 操作 ====================

/**
 * 打开 IndexedDB 数据库
 * @returns {Promise<IDBDatabase>}
 */
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('[SW] IndexedDB 打开失败:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      console.log('[SW] IndexedDB 打开成功');
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      console.log('[SW] IndexedDB 升级中...');
      const db = event.target.result;

      // 创建对象存储（如果不存在）
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        objectStore.createIndex('timestamp', 'timestamp', { unique: false });
        objectStore.createIndex('type', 'type', { unique: false });
        console.log('[SW] IndexedDB 对象存储已创建');
      }
    };
  });
}

/**
 * 保存待同步操作到 IndexedDB
 * @param {Object} operation - 操作对象
 * @returns {Promise<string>} 操作ID
 */
async function saveOperation(operation) {
  try {
    const db = await openDatabase();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const committed = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);

    // 生成唯一ID
    operation.id = operation.id || \`op-\${Date.now()}-\${Math.random().toString(36).substr(2, 9)}\`;
    operation.timestamp = operation.timestamp || Date.now();
    operation.retryCount = operation.retryCount || 0;
    operation.status = 'pending';

    await new Promise((resolve, reject) => {
      const request = store.put(operation);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    await committed;
    await notifyClients({ type: 'OFFLINE_QUEUE_CHANGED' });
    console.log('[SW] 操作已保存到 IndexedDB:', operation.id, operation.type);
    return operation.id;
  } catch (error) {
    console.error('[SW] 保存操作到 IndexedDB 失败:', error);
    throw error;
  }
}

/**
 * 获取所有待同步操作
 * @returns {Promise<Array>}
 */
async function getOfflineOperations() {
  try {
    const db = await openDatabase();
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('timestamp');

    return new Promise((resolve, reject) => {
      const request = index.getAll();
      request.onsuccess = () => {
        const operations = request.result;
        console.log(\`[SW] 获取到 \${operations.length} 个待同步操作\`);
        resolve(operations);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[SW] 获取待同步操作失败:', error);
    throw error;
  }
}

/**
 * 删除已同步操作
 * @param {string} operationId - 操作ID
 * @returns {Promise<void>}
 */
async function deleteOperation(operationId, condition = null) {
  try {
    const db = await openDatabase();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const committed = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);

    // The condition is checked in the same transaction as the removal, so no
    // other change to this operation can come in between.
    if (condition) {
      const operation = await new Promise((resolve, reject) => {
        const request = store.get(operationId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (operation && !condition(operation)) {
        await committed;
        return false;
      }
    }

    await new Promise((resolve, reject) => {
      const request = store.delete(operationId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    await committed;
    console.log('[SW] 操作已从 IndexedDB 删除:', operationId);
    return true;
  } catch (error) {
    console.error('[SW] 删除操作失败:', error);
    throw error;
  }
}

/**
 * 更新操作状态
 * @param {string} operationId - 操作ID
 * @param {Object} updates - 更新数据
 * @returns {Promise<void>}
 */
async function updateOperation(operationId, updates, condition = null) {
  try {
    const db = await openDatabase();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const committed = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);

    const operation = await new Promise((resolve, reject) => {
      const request = store.get(operationId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    // Checked in the same transaction as the write, so the update is atomic.
    const allowed = Boolean(operation) && (!condition || condition(operation));
    if (allowed) {
      Object.assign(operation, updates);
      await new Promise((resolve, reject) => {
        const request = store.put(operation);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      console.log('[SW] 操作已更新:', operationId);
    }
    await committed;
    return operation ? allowed : null;
  } catch (error) {
    console.error('[SW] 更新操作失败:', error);
    throw error;
  }
}

/**
 * Service Worker 安装事件
 * 预缓存静态资源
 */
self.addEventListener('install', event => {
  console.log('[SW] 正在安装 Service Worker...');
  
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] 预缓存静态资源...');
      // 只缓存静态资源，CDN 资源在首次请求时按需缓存
      return cache.addAll(STATIC_RESOURCES).catch(err => {
        console.warn('[SW] 预缓存静态资源部分失败:', err);
        // 即使失败也继续，不影响 Service Worker 安装
        return Promise.resolve();
      });
    }).then(() => {
      console.log('[SW] Service Worker 安装完成');
      console.log('[SW] CDN 资源将在首次请求时自动缓存（使用 CORS 模式）');
      // 立即激活，不等待
      return self.skipWaiting();
    }).catch(err => {
      console.error('[SW] Service Worker 安装失败:', err);
    })
  );
});

/**
 * Service Worker 激活事件
 * 清理旧缓存
 */
self.addEventListener('activate', event => {
  console.log('[SW] 正在激活 Service Worker...');
  
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(cacheName => {
            // 删除旧版本缓存
            return cacheName !== CACHE_NAME && cacheName !== RUNTIME_CACHE;
          })
          .map(cacheName => {
            console.log('[SW] 删除旧缓存:', cacheName);
            return caches.delete(cacheName);
          })
      );
    }).then(() => {
      console.log('[SW] Service Worker 激活完成');
      // 立即控制所有页面
      return self.clients.claim();
    })
  );
});

/**
 * Service Worker Fetch 事件
 * 实现缓存策略和离线队列
 */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  const language = offlineRequestLanguage(request);

  // Favicon 代理请求：缓存优先策略（在 API 请求之前处理）
  if (url.pathname.startsWith('/api/favicon/')) {
    event.respondWith(
      caches.match(request).then(cachedResponse => {
        if (cachedResponse) {
          console.log('[SW] Favicon 从缓存返回:', url.pathname);
          return cachedResponse;
        }

        // 缓存未命中，从网络获取
        console.log('[SW] Favicon 从网络获取:', url.pathname);
        return fetch(request).then(response => {
          // 只缓存成功的响应
          if (response && response.ok) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(request, responseToCache);
              console.log('[SW] Favicon 已缓存:', url.pathname);
            });
          }
          return response;
        }).catch(err => {
          console.error('[SW] Favicon 加载失败:', url.pathname, err);
          // 返回空响应，触发 img onerror
          return new Response('', {
            status: 404,
            statusText: 'Not Found',
            headers: { 'Content-Type': 'text/plain' }
          });
        });
      })
    );
    return;
  }

  // API 请求：网络优先，失败时保存到离线队列
  if (url.pathname.startsWith('/api/')) {
    // fetch consumes a mutation body even when transport fails. Preserve it
    // before starting the request so an offline edit can still be queued.
    const offlineRequest = ['POST', 'PUT', 'DELETE'].includes(request.method.toUpperCase()) ? request.clone() : null;
    event.respondWith(
      fetch(request).catch(async err => {
        console.error('[SW] API 请求失败:', url.pathname, err);

        // 只有修改数据的请求才保存到离线队列（POST、PUT、DELETE）
        const method = request.method.toUpperCase();
        if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
          try {
            // 读取请求体
            const requestClone = offlineRequest;
            let requestBody = null;

            try {
              const rawBody = await requestClone.text();
              try { requestBody = JSON.parse(rawBody); } catch { requestBody = rawBody; }
            } catch (jsonError) {
              console.warn('[SW] 无法解析请求体为 JSON:', jsonError);
              throw jsonError;
            }

            // 确定操作类型
            let operationType = 'UNKNOWN';
            if (method === 'POST' && url.pathname === '/api/secrets') {
              operationType = 'ADD';
            } else if (method === 'POST' && url.pathname === '/api/secrets/batch') {
              operationType = 'BATCH_ADD';
            } else if (method === 'PUT' && url.pathname.startsWith('/api/secrets/')) {
              operationType = 'UPDATE';
            } else if (method === 'DELETE' && url.pathname.startsWith('/api/secrets/')) {
              operationType = 'DELETE';
            }

            if (operationType === 'UNKNOWN') {
              return new Response(
                JSON.stringify({
                  error: offlineText('unavailable', language),
                  detail: offlineText('onlineRequired', language),
                  offline: true,
                  queued: false
                }),
                {
                  status: 503,
                  statusText: 'Service Unavailable',
                  headers: { 'Content-Type': 'application/json' }
                }
              );
            }

            // 保存到 IndexedDB
            const operation = {
              type: operationType,
              url: url.pathname,
              method: method,
              data: requestBody,
              headers: {
                'Content-Type': request.headers.get('Content-Type') || 'application/json',
                'X-Language': language
              }
            };

            const operationId = await saveOperation(operation);
            console.log('[SW] 离线操作已保存，等待同步:', operationId, operationType);

            // 注册 Background Sync
            try {
              await self.registration.sync.register('sync-operations');
              console.log('[SW] Background Sync 已注册');
            } catch (syncError) {
              console.warn('[SW] Background Sync 注册失败:', syncError);
            }

            // 通知前端操作已排队
            return new Response(
              JSON.stringify({
                success: true,
                queued: true,
                operationId: operationId,
                message: offlineText('queued', language),
                offline: true
              }),
              {
                status: 202, // Accepted
                statusText: 'Accepted - Queued for sync',
                headers: { 'Content-Type': 'application/json' }
              }
            );
          } catch (saveError) {
            console.error('[SW] 保存离线操作失败:', saveError);
            // 如果保存失败，返回标准错误
            return new Response(
              JSON.stringify({
                error: offlineText('networkFailed', language),
                detail: offlineText('queueFailed', language),
                offline: true
              }),
              {
                status: 503,
                statusText: 'Service Unavailable',
                headers: { 'Content-Type': 'application/json' }
              }
            );
          }
        }

        // GET 请求失败时返回标准错误（不保存到队列）
        return new Response(
          JSON.stringify({
            error: offlineText('networkFailed', language),
            detail: offlineText('connectFailed', language),
            offline: true
          }),
          {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'application/json' }
          }
        );
      })
    );
    return;
  }
  
  // Limit both headers and the full HTML body so weak networks cannot prevent
  // an already-cached app from opening. This never applies to account writes.
  if (url.origin === self.location.origin && request.method === 'GET' && url.pathname === '/') {
    let cacheUpdate = Promise.resolve();
    const navigation = (async () => {
      const cached = await caches.match(request).catch(() => null);
      const controller = new AbortController();
      let timer;
      try {
        const network = (async () => {
          const response = await fetch(request, { redirect: 'follow', signal: controller.signal });
          if (!response || response.status >= 500) throw new Error('首页暂时无法连接');
          // An explicit authorization denial must never be replaced by an old
          // shell, even if its error response body is incomplete.
          if (response.status === 401 || response.status === 403) return response;
          const body = await response.arrayBuffer();
          if (controller.signal.aborted) throw new Error('首页加载超时');
          const complete = new Response([204, 205, 304].includes(response.status) ? null : body, {
            status: response.status, statusText: response.statusText, headers: response.headers
          });
          if (response.status === 200) {
            const responseToCache = complete.clone();
            cacheUpdate = caches.open(CACHE_NAME)
              .then(cache => cache.put(request, responseToCache))
              .catch(error => console.warn('[SW] 无法更新首页缓存:', error));
          }
          return complete;
        })();
        return await Promise.race([
          network,
          new Promise((_, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(new Error('首页加载超时')); }, cached ? 1500 : 8000);
          })
        ]);
      } catch {
        return cached || new Response(OFFLINE_PAGE, {
          status: 503, statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      } finally {
        clearTimeout(timer);
      }
    })();
    event.respondWith(navigation);
    event.waitUntil(navigation.then(() => cacheUpdate));
    return;
  }

  // 外部资源（CDN 库、favicon、logo等）
  if (url.origin !== location.origin) {
    // 只缓存我们指定的 CDN 资源（jsQR 和 qrcode-generator）
    const isCDNLibrary = CDN_RESOURCES.some(cdn => url.href.startsWith(cdn));
    
    if (isCDNLibrary) {
      // CDN 库：缓存优先策略（使用 CORS 模式）
      event.respondWith(
        caches.match(request).then(cachedResponse => {
          if (cachedResponse) {
            console.log('[SW] CDN 资源从缓存返回:', url.href);
            // 后台更新策略（stale-while-revalidate）
            fetch(request, { mode: 'cors', redirect: 'follow' }).then(response => {
              if (response && response.status === 200) {
                caches.open(CACHE_NAME).then(cache => {
                  cache.put(request, response);
                  console.log('[SW] CDN 资源已更新缓存:', url.href);
                });
              }
            }).catch(() => {
              // 后台更新失败，不影响
            });
            return cachedResponse;
          }
          
          // 缓存未命中，从网络获取（使用 CORS 模式）
          console.log('[SW] CDN 资源从网络获取:', url.href);
          return fetch(request, { mode: 'cors', redirect: 'follow' }).then(response => {
            // 只缓存成功的 CORS 响应
            if (response && response.status === 200 && response.type === 'cors') {
              const responseToCache = response.clone();
              caches.open(CACHE_NAME).then(cache => {
                cache.put(request, responseToCache);
                console.log('[SW] CDN 资源已缓存（CORS 模式）:', url.href);
              });
            }
            return response;
          }).catch(err => {
            console.error('[SW] CDN 资源加载失败:', url.href, err);
            // 如果网络失败，尝试再次从缓存获取（防止竞态条件）
            return caches.match(request).then(cached => {
              if (cached) {
                console.log('[SW] 从缓存降级返回:', url.href);
                return cached;
              }
              throw err;
            });
          });
        })
      );
    } else {
      // 其他外部资源（favicon、logo等）：直接透传，不缓存
      // 这样可以避免 CORS 错误和不必要的缓存
      event.respondWith(
        fetch(request, { redirect: 'follow' }).catch(() => {
          // 加载失败时静默处理，返回空响应
          // 避免控制台错误日志
          return new Response('', {
            status: 404,
            statusText: 'Not Found'
          });
        })
      );
    }
    return;
  }
  
  // 其他请求：网络优先
  event.respondWith(
    fetch(request, { redirect: 'follow' }).catch(err => {
      console.error('[SW] 请求失败:', url.pathname, err);
      // 返回离线页面或错误信息
      return new Response(offlineText('resourceUnavailable', language), {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    })
  );
});

/**
 * 处理推送通知（未来功能）
 */
self.addEventListener('push', event => {
  console.log('[SW] 收到推送通知');
  
  if (!event.data) {
    console.warn('[SW] 推送通知无数据');
    return;
  }
  
  const data = event.data.json();
  const title = data.title || '2FA';
  const options = {
    body: data.body || offlineText('notification', data.language || self.navigator?.language),
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200],
    data: data.data || {},
    actions: data.actions || []
  };
  
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

/**
 * 处理通知点击（未来功能）
 */
self.addEventListener('notificationclick', event => {
  console.log('[SW] 通知被点击');
  event.notification.close();
  
  event.waitUntil(
    clients.openWindow('/')
  );
});

/**
 * 处理后台同步
 * 网络恢复时自动同步离线操作
 */
self.addEventListener('sync', event => {
  console.log('[SW] 后台同步事件触发:', event.tag);

  if (event.tag === 'sync-operations') {
    event.waitUntil(syncPendingOperations().then(result => {
      // Background Sync 以 Promise 拒绝判断是否需要稍后重试。
      if (result && result.deferredCount > 0) {
        throw new Error('网络不可用，离线操作等待重试');
      }
    }));
  }
});

/**
 * 同步所有待处理的离线操作
 * @returns {Promise<Object|undefined>} 本批同步结果，包含等待网络恢复的数量
 */
function syncPendingOperations() {
  if (syncPendingOperationsPromise) return syncPendingOperationsPromise;

  const operation = performPendingOperationSync();
  syncPendingOperationsPromise = operation;
  operation.then(
    () => {
      if (syncPendingOperationsPromise === operation) syncPendingOperationsPromise = null;
    },
    () => {
      if (syncPendingOperationsPromise === operation) syncPendingOperationsPromise = null;
    }
  );
  return operation;
}

function performPendingOperationSync() {
  return serializeOfflineQueue(replayPendingOperations);
}

function needsLogin(operation) {
  return operation.status === 'awaiting_auth' ||
    (operation.status === 'failed' && /^HTTP 401(?::|$)/.test(operation.lastError || ''));
}

// Keep the server's own answer so the page can show why a change stopped.
// Error bodies are small; a stalled body must not hold the rest of the queue.
async function replayFailureBody(response) {
  if (!response || typeof response.json !== 'function') return null;
  let timer;
  try {
    const body = await Promise.race([
      response.json(),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), 3000); })
    ]);
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function replayFailureMessage(body) {
  const message = [body && body.message, body && body.error].find(value => typeof value === 'string' && value.trim());
  return message ? message.trim().slice(0, 300) : '';
}

function replayFailureDetails(body) {
  return body && body.details && typeof body.details === 'object' && !Array.isArray(body.details) ? body.details : {};
}

// The server names the account it looked for; older servers use the raw path segment.
function isQueuedTarget(operation, secretId) {
  if (typeof secretId !== 'string' || !secretId) return false;
  const prefix = '/api/secrets/';
  const raw = typeof operation.url === 'string' && operation.url.startsWith(prefix) ? operation.url.slice(prefix.length) : '';
  return secretId === raw || secretId === queuedOperationTarget(operation);
}

function isQueuedAddConflict(operation, status, body) {
  return operation.type === 'ADD' && operation.method === 'POST' && operation.url === '/api/secrets' && status === 409 &&
    replayFailureDetails(body).operation === 'addSecret';
}

// Nothing is left to do when the server reports that a queued delete's account
// is already gone, or that the queued add already exists with the same OTP
// parameters (details.identical). Older servers do not compare parameters and
// send no such flag, so their answer stops the change for review.
function isReplayAlreadyApplied(operation, status, body) {
  const details = replayFailureDetails(body);
  if (operation.type === 'DELETE' && operation.method === 'DELETE' && status === 404) {
    return details.operation === 'deleteSecret' && isQueuedTarget(operation, details.secretId);
  }
  return isQueuedAddConflict(operation, status, body) && details.identical === true;
}

// The account the queued add names exists with other OTP parameters; the page
// explains this instead of the server's plain "already exists".
function isReplayDuplicateDifferent(operation, status, body) {
  return isQueuedAddConflict(operation, status, body) && replayFailureDetails(body).identical === false;
}

// A queued edit whose account was deleted meanwhile can only be saved as a new account.
function isReplayTargetMissing(operation, status, body) {
  const details = replayFailureDetails(body);
  return operation.type === 'UPDATE' && status === 404 && details.operation === 'updateSecret' &&
    isQueuedTarget(operation, details.secretId);
}

async function replayPendingOperations() {
  try {
    console.log('[SW] 开始同步离线操作...');
    const queued = await getOfflineOperations();
    if (queued.some(needsLogin)) {
      const paused = { type: 'SYNC_COMPLETE', successCount: 0, failCount: 0, deferredCount: 0, authRequired: true, totalCount: queued.length };
      await notifyClients(paused);
      return paused;
    }
    const operations = queued.filter(operation => operation.status === 'pending');

    if (operations.length === 0) {
      console.log('[SW] 没有待同步的操作');
      // Pages waiting for this replay still need the completion signal to
      // revalidate their account list after reconnecting.
      const idle = { type: 'SYNC_COMPLETE', successCount: 0, failCount: 0, deferredCount: 0, authRequired: false, totalCount: 0 };
      await notifyClients(idle);
      return idle;
    }

    console.log(\`[SW] 找到 \${operations.length} 个待同步操作\`);

    // 按时间戳顺序同步
    operations.sort((a, b) => a.timestamp - b.timestamp);

    let successCount = 0;
    let failCount = 0;
    let deferredCount = 0;
    let authRequired = false;

    for (const operation of operations) {
      if (self.navigator && self.navigator.onLine === false) {
        deferredCount = operations.length - successCount - failCount;
        break;
      }

      try {
        console.log('[SW] 正在同步操作:', operation.id, operation.type);

        // 构建请求
        const requestOptions = {
          method: operation.method,
          headers: operation.headers || { 'Content-Type': 'application/json' },
          credentials: 'include' // 包含认证 Cookie
        };

        // 添加请求体（如果有）
        if (operation.data && (operation.method === 'POST' || operation.method === 'PUT')) {
          requestOptions.body = typeof operation.data === 'string'
            ? operation.data
            : JSON.stringify(operation.data);
        }

        // 发送请求
        let response;
        try {
          response = await fetch(operation.url, requestOptions);
        } catch (error) {
          // onLine 不能保证服务器可达。传输失败不消耗 HTTP 重试额度，
          // 并停止本批，避免掉线后继续请求后面的操作。
          console.warn('[SW] 网络请求未完成，保留操作等待重试:', operation.id, error);
          deferredCount = operations.length - successCount - failCount;
          break;
        }

        if (response.status === 401) {
          // Persist the pause before notifying pages. A login failure is not a
          // failed edit and must neither consume retries nor advance the batch.
          authRequired = true;
          await updateOperation(operation.id, { status: 'awaiting_auth', lastError: 'HTTP 401' });
          break;
        }

        const failureBody = response.ok ? null : await replayFailureBody(response);
        if (response.ok || isReplayAlreadyApplied(operation, response.status, failureBody)) {
          // 同步成功（或服务器确认已无需再做），删除操作
          await deleteOperation(operation.id);
          successCount++;
          console.log('[SW] 操作同步成功:', operation.id, operation.type);

          // 通知前端同步成功
          await notifyClients({
            type: 'SYNC_SUCCESS',
            operationId: operation.id,
            operationType: operation.type,
            operationUrl: operation.url
          });
        } else {
          // 同步失败，增加重试计数
          const newRetryCount = (operation.retryCount || 0) + 1;
          // A client error (other than timeout or rate limiting) rejects the
          // saved request itself, so resending it unchanged cannot succeed.
          const rejected = response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status);
          const failureMessage = replayFailureMessage(failureBody);

          if (rejected || newRetryCount >= 5) {
            // 请求被拒绝或超过最大重试次数，标记为失败
            await updateOperation(operation.id, {
              status: 'failed',
              retryCount: newRetryCount,
              lastError: \`HTTP \${response.status}: \${response.statusText}\`,
              failureMessage,
              targetMissing: isReplayTargetMissing(operation, response.status, failureBody),
              duplicateDiffers: isReplayDuplicateDifferent(operation, response.status, failureBody)
            });
            failCount++;
            console.error('[SW] 操作同步失败（已停止自动重试）:', operation.id);

            // 通知前端同步失败
            await notifyClients({
              type: 'SYNC_FAILED',
              operationId: operation.id,
              operationType: operation.type,
              operationUrl: operation.url,
              error: \`HTTP \${response.status}\`
            });
          } else {
            // 更新重试计数
            await updateOperation(operation.id, {
              retryCount: newRetryCount,
              lastError: \`HTTP \${response.status}: \${response.statusText}\`,
              failureMessage
            });
            failCount++;
            console.warn('[SW] 操作同步失败，将重试:', operation.id, \`(\${newRetryCount}/5)\`);
          }
        }
      } catch (error) {
        if (authRequired) throw error;
        // 请求构建或本地存储异常（fetch 传输错误已在上方单独处理）
        console.error('[SW] 同步操作时出错:', operation.id, error);
        const newRetryCount = (operation.retryCount || 0) + 1;

        if (newRetryCount >= 5) {
          await updateOperation(operation.id, {
            status: 'failed',
            retryCount: newRetryCount,
            lastError: error.message
          });
          failCount++;
          await notifyClients({
            type: 'SYNC_FAILED',
            operationId: operation.id,
            operationType: operation.type,
            operationUrl: operation.url,
            error: error.message
          });
        } else {
          await updateOperation(operation.id, {
            retryCount: newRetryCount,
            lastError: error.message
          });
          failCount++;
        }
      }
    }

    console.log(\`[SW] 同步完成: 成功 \${successCount} 个, 失败 \${failCount} 个\`);

    // 通知前端同步完成
    const result = {
      type: 'SYNC_COMPLETE',
      successCount,
      failCount,
      deferredCount,
      authRequired,
      totalCount: operations.length
    };
    await notifyClients(result);
    await notifyClients({ type: 'OFFLINE_QUEUE_CHANGED' });
    return result;

  } catch (error) {
    console.error('[SW] 同步离线操作失败:', error);
  }
}

/**
 * 通知所有客户端
 * @param {Object} message - 消息对象
 * @returns {Promise<void>}
 */
async function notifyClients(message) {
  try {
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(client => {
      client.postMessage(message);
    });
    console.log('[SW] 已通知', clients.length, '个客户端:', message.type);
  } catch (error) {
    console.error('[SW] 通知客户端失败:', error);
  }
}

function queuedOperationData(operation) {
  let data = operation.data;
  if (typeof data === 'string') {
    if (data.length > 4 * 1024 * 1024) return null;
    try { data = JSON.parse(data); } catch { return null; }
  }
  return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
}

function queuedOperationName(operation) {
  const data = queuedOperationData(operation);
  return typeof data?.name === 'string' ? data.name.slice(0, 160) : '';
}

function queuedOperationTarget(operation) {
  const prefix = '/api/secrets/';
  if (typeof operation.url !== 'string' || !operation.url.startsWith(prefix)) return '';
  const encoded = operation.url.slice(prefix.length);
  if (!encoded || encoded.includes('/')) return '';
  try { return decodeURIComponent(encoded); } catch { return ''; }
}

// A stopped add or edit can be reopened in the account dialog instead of
// being cancelled with its content.
function isEditableQueuedOperation(operation) {
  const add = operation.type === 'ADD' && operation.method === 'POST' && operation.url === '/api/secrets';
  const update = operation.type === 'UPDATE' && operation.method === 'PUT' && Boolean(queuedOperationTarget(operation));
  const data = (add || update) ? queuedOperationData(operation) : null;
  return Boolean(data && typeof data.name === 'string' && typeof data.secret === 'string');
}

async function offlineQueueStatus(queued = null) {
  queued = queued || await getOfflineOperations();
  const operations = queued
    .filter(operation => typeof operation.id === 'string' && ['pending', 'awaiting_auth', 'failed'].includes(operation.status))
    .sort((left, right) => left.timestamp - right.timestamp)
    .map(operation => {
      const status = needsLogin(operation) ? 'awaiting_auth' : operation.status;
      const item = {
        id: operation.id,
        type: typeof operation.type === 'string' ? operation.type.slice(0, 32) : 'UNKNOWN',
        name: queuedOperationName(operation),
        timestamp: Number.isFinite(operation.timestamp) ? operation.timestamp : 0,
        status
      };
      if (status === 'failed') {
        // Only the server's explanation is shared; raw transport details stay here.
        if (typeof operation.failureMessage === 'string' && operation.failureMessage) item.reason = operation.failureMessage.slice(0, 300);
        if (operation.type === 'ADD' && operation.duplicateDiffers === true) item.duplicateDiffers = true;
        if (isEditableQueuedOperation(operation)) item.editable = true;
      }
      return item;
    });
  return { ok: true, operations, authRequired: queued.some(needsLogin) };
}

// Returns account fields only for an explicit edit of a stopped add/edit.
async function offlineQueueDetail(operationId) {
  const queued = await getOfflineOperations();
  const operation = queued.find(item => item.id === operationId);
  if (!operation || operation.status !== 'failed' || needsLogin(operation) || !isEditableQueuedOperation(operation)) {
    throw new Error('无法编辑此更改');
  }
  const data = queuedOperationData(operation);
  const text = value => typeof value === 'string' ? value : '';
  const number = value => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  const summary = await offlineQueueStatus(queued);
  summary.detail = {
    id: operation.id,
    type: operation.type,
    targetId: operation.type === 'UPDATE' ? queuedOperationTarget(operation) : '',
    targetMissing: operation.type === 'UPDATE' && operation.targetMissing === true,
    duplicateDiffers: operation.type === 'ADD' && operation.duplicateDiffers === true,
    reason: text(operation.failureMessage).slice(0, 300),
    data: {
      name: text(data.name),
      account: text(data.account),
      secret: text(data.secret),
      type: text(data.type),
      digits: number(data.digits),
      period: number(data.period),
      algorithm: text(data.algorithm),
      counter: number(data.counter)
    }
  };
  return summary;
}

// A page saving the corrected copy of a stopped change claims the original
// first. Until the page removes or releases it, another tab can neither
// retry, cancel nor replace it, so the change is never applied twice.
const QUEUE_CLAIM_TTL_MS = 2 * 60 * 1000;

// A claim dated in the future (the clock was set back after it was taken)
// counts as expired, so it cannot block the change until the clock catches up.
function isClaimedByOther(operation, clientId) {
  if (typeof operation.claimedBy !== 'string' || operation.claimedBy === '' || operation.claimedBy === clientId) return false;
  if (!Number.isFinite(operation.claimedAt)) return false;
  const age = Date.now() - operation.claimedAt;
  return age >= 0 && age < QUEUE_CLAIM_TTL_MS;
}

// Errors with a code the page explains precisely instead of as an unavailable queue.
function queueError(code) {
  return Object.assign(new Error(code), { code });
}

// A claim is one IndexedDB transaction, so it is answered at once instead of
// waiting behind a replay that is still sending other changes.
async function changeOfflineQueueClaim(message, clientId) {
  if (typeof message.operationId !== 'string' || !message.operationId) throw new Error('未找到待处理的更改');
  if (message.type === 'OFFLINE_QUEUE_CLAIM') {
    const claimed = await updateOperation(message.operationId, { claimedBy: clientId, claimedAt: Date.now() }, operation =>
      operation.status === 'failed' && !needsLogin(operation) && !isClaimedByOther(operation, clientId));
    if (claimed === null) throw queueError('changeGone');
    if (!claimed) throw queueError('changeBusy');
  } else {
    await updateOperation(message.operationId, { claimedBy: '', claimedAt: 0 }, operation => operation.claimedBy === clientId);
  }
  await notifyClients({ type: 'OFFLINE_QUEUE_CHANGED' });
  return { summary: await offlineQueueStatus() };
}

function manageOfflineQueue(message, clientId = '') {
  if (message.type === 'OFFLINE_QUEUE_STATUS') return offlineQueueStatus().then(summary => ({ summary }));
  if (message.type === 'OFFLINE_QUEUE_DETAIL') return offlineQueueDetail(message.operationId).then(summary => ({ summary }));
  if (message.type === 'OFFLINE_QUEUE_CLAIM' || message.type === 'OFFLINE_QUEUE_RELEASE') return changeOfflineQueueClaim(message, clientId);
  return serializeOfflineQueue(async () => {
    const operations = await getOfflineOperations();
    let shouldReplay = false;
    if (message.type === 'OFFLINE_QUEUE_RESUME') {
      for (const operation of operations.filter(needsLogin)) {
        await updateOperation(operation.id, {
          status: 'pending',
          retryCount: operation.status === 'failed' ? 0 : (operation.retryCount || 0),
          lastError: '',
          failureMessage: '',
          targetMissing: false,
          duplicateDiffers: false,
          claimedBy: '',
          claimedAt: 0
        });
      }
      shouldReplay = true;
    } else {
      if (typeof message.operationId !== 'string' || !message.operationId) throw new Error('未找到待处理的更改');
      const operation = operations.find(item => item.id === message.operationId);
      // Another tab's claim is checked again inside each write below.
      const unclaimed = item => !isClaimedByOther(item, clientId);
      if (operation) {
        if (!['failed', 'awaiting_auth'].includes(operation.status)) throw new Error('更改正在等待同步，请稍后再试');
        if (!unclaimed(operation)) throw queueError('changeBusy');
        if (message.type === 'OFFLINE_QUEUE_CANCEL') {
          if (needsLogin(operation) && !operations.some(item => item.id !== operation.id && needsLogin(item))) {
            const next = operations.filter(item => item.status === 'pending').sort((left, right) => left.timestamp - right.timestamp)[0];
            // Keep the queue's login requirement durable before removing its
            // current marker, so cancellation cannot strand the remaining edits.
            if (next) await updateOperation(next.id, { status: 'awaiting_auth', lastError: 'HTTP 401' });
          }
          if (!(await deleteOperation(operation.id, unclaimed))) throw queueError('changeBusy');
        } else if (message.type === 'OFFLINE_QUEUE_RETRY') {
          if (needsLogin(operation)) throw new Error('请先登录后再继续同步');
          const retried = await updateOperation(operation.id, {
            status: 'pending', retryCount: 0, lastError: '', failureMessage: '', targetMissing: false, duplicateDiffers: false,
            claimedBy: '', claimedAt: 0
          }, unclaimed);
          if (retried === false) throw queueError('changeBusy');
          shouldReplay = true;
        } else {
          throw new Error('无法处理此操作');
        }
      }
    }
    await notifyClients({ type: 'OFFLINE_QUEUE_CHANGED' });
    const summary = await offlineQueueStatus();
    // Queue the network phase after this serialized mutation returns. The page
    // receives durable local state immediately; waitUntil keeps replay alive.
    const replay = shouldReplay ? performPendingOperationSync() : null;
    return { summary, replay };
  });
}

function isQueueClient(event) {
  try {
    return event.source?.type === 'window' &&
      typeof event.source.id === 'string' &&
      new URL(event.source.url).origin === self.location.origin;
  } catch {
    return false;
  }
}

/**
 * 消息处理
 * 允许页面与 Service Worker 通信
 */
self.addEventListener('message', event => {
  console.log('[SW] 收到消息:', event.data);
  if (['OFFLINE_QUEUE_STATUS', 'OFFLINE_QUEUE_DETAIL', 'OFFLINE_QUEUE_RESUME', 'OFFLINE_QUEUE_RETRY', 'OFFLINE_QUEUE_CANCEL',
    'OFFLINE_QUEUE_CLAIM', 'OFFLINE_QUEUE_RELEASE'].includes(event.data?.type)) {
    const task = (async () => {
      let result;
      let replay;
      try {
        if (!isQueueClient(event)) throw new Error('请在 2FA 页面处理未同步更改');
        ({ summary: result, replay } = await manageOfflineQueue(event.data, event.source.id));
      } catch (error) {
        result = { ok: false, error: offlineText('queueUnavailable', event.data?.language) };
        if (['changeBusy', 'changeGone'].includes(error?.code)) result.code = error.code;
      }
      event.ports?.[0]?.postMessage(result);
      await replay;
    })();
    event.waitUntil(task);
    return;
  }
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            console.log('[SW] 清除缓存:', cacheName);
            return caches.delete(cacheName);
          })
        );
      }).then(() => {
        console.log('[SW] 所有缓存已清除');
        event.ports[0].postMessage({ success: true });
      })
    );
  }
  
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }

  if (event.data && event.data.type === 'SYNC_OPERATIONS') {
    event.waitUntil(syncPendingOperations());
  }
});

console.log('[SW] Service Worker 脚本已加载');
`;

	return new Response(swScript, {
		status: 200,
		headers: {
			'Content-Type': 'application/javascript; charset=utf-8',
			'Cache-Control': 'no-cache, no-store, must-revalidate',
			'Service-Worker-Allowed': '/',
			'Access-Control-Allow-Origin': '*',
		},
	});
}
