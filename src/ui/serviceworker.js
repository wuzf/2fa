/**
 * Service Worker 生成模块
 * 提供离线支持和缓存管理
 */

/**
 * 生成 Service Worker 脚本
 * @returns {Response} Service Worker JavaScript 响应
 */
export function createServiceWorker(env = {}) {
	// 🚀 自动版本管理：从环境变量读取版本号
	// 支持多种版本策略：
	// 1. env.SW_VERSION - 构建时注入的版本号（推荐）
	// 2. env.BUILD_TIMESTAMP - 构建时间戳
	// 3. 'v1' - 默认版本（后备）
	const version = env.SW_VERSION || env.BUILD_TIMESTAMP || 'v1';

	// 生成缓存名称
	const CACHE_NAME = `2fa-cache-${version}`;
	const RUNTIME_CACHE = `2fa-runtime-${version}`;

	const swScript = `
/**
 * 2FA - Service Worker
 * 版本: ${version}
 * 生成时间: ${new Date().toISOString()}
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
async function getPendingOperations() {
  try {
    const db = await openDatabase();
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('timestamp');

    return new Promise((resolve, reject) => {
      const request = index.getAll();
      request.onsuccess = () => {
        const operations = request.result.filter(op => op.status === 'pending');
        console.log(\`[SW] 获取到 \${operations.length} 个待同步操作\`);
        resolve(operations);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[SW] 获取待同步操作失败:', error);
    return [];
  }
}

/**
 * 删除已同步操作
 * @param {string} operationId - 操作ID
 * @returns {Promise<void>}
 */
async function deleteOperation(operationId) {
  try {
    const db = await openDatabase();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    await new Promise((resolve, reject) => {
      const request = store.delete(operationId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    console.log('[SW] 操作已从 IndexedDB 删除:', operationId);
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
async function updateOperation(operationId, updates) {
  try {
    const db = await openDatabase();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    const operation = await new Promise((resolve, reject) => {
      const request = store.get(operationId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    if (operation) {
      Object.assign(operation, updates);
      await new Promise((resolve, reject) => {
        const request = store.put(operation);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      console.log('[SW] 操作已更新:', operationId);
    }
  } catch (error) {
    console.error('[SW] 更新操作失败:', error);
    throw error;
  }
}

/**
 * 获取待同步操作数量
 * @returns {Promise<number>}
 */
async function getPendingOperationsCount() {
  try {
    const operations = await getPendingOperations();
    return operations.length;
  } catch (error) {
    console.error('[SW] 获取待同步操作数量失败:', error);
    return 0;
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
    event.respondWith(
      fetch(request).catch(async err => {
        console.error('[SW] API 请求失败:', url.pathname, err);

        // 只有修改数据的请求才保存到离线队列（POST、PUT、DELETE）
        const method = request.method.toUpperCase();
        if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
          try {
            // 读取请求体
            const requestClone = request.clone();
            let requestBody = null;

            try {
              requestBody = await requestClone.json();
            } catch (jsonError) {
              console.warn('[SW] 无法解析请求体为 JSON:', jsonError);
              requestBody = await requestClone.text();
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

            // 保存到 IndexedDB
            const operation = {
              type: operationType,
              url: url.pathname,
              method: method,
              data: requestBody,
              headers: {
                'Content-Type': request.headers.get('Content-Type') || 'application/json'
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
                message: '您处于离线状态，操作已保存，网络恢复后将自动同步',
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
                error: '网络连接失败',
                detail: '无法连接到服务器，且无法保存离线操作',
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
            error: '网络连接失败',
            detail: '无法连接到服务器，请检查网络连接',
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
  
  // 主页和动态内容：网络优先，离线时使用缓存（Network First）
  // 这确保用户总是看到最新版本，只有在离线时才使用缓存
  if (url.pathname === '/' || url.pathname === '') {
    event.respondWith(
      fetch(request, { redirect: 'follow' })
        .then(response => {
          // 网络请求成功，更新缓存
          if (response && response.status === 200) {
            console.log('[SW] 从网络获取并更新缓存:', url.pathname);
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        })
        .catch(err => {
          // 网络请求失败（离线），尝试使用缓存
          console.log('[SW] 网络请求失败，使用缓存:', url.pathname, err.message);
          return caches.match(request).then(cachedResponse => {
            if (cachedResponse) {
              console.log('[SW] 从缓存返回（离线模式）:', url.pathname);
              return cachedResponse;
            }
            // 缓存也没有，返回离线页面提示
            return new Response(
              '<html><body><h1>离线模式</h1><p>无法连接到服务器，请检查网络连接。</p></body></html>',
              {
                status: 503,
                statusText: 'Service Unavailable',
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
              }
            );
          });
        })
    );
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
      return new Response('离线模式：无法访问此资源', {
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
    body: data.body || '您有新的通知',
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
    event.waitUntil(syncPendingOperations());
  }
});

/**
 * 同步所有待处理的离线操作
 * @returns {Promise<void>}
 */
async function syncPendingOperations() {
  try {
    console.log('[SW] 开始同步离线操作...');
    const operations = await getPendingOperations();

    if (operations.length === 0) {
      console.log('[SW] 没有待同步的操作');
      return;
    }

    console.log(\`[SW] 找到 \${operations.length} 个待同步操作\`);

    // 按时间戳顺序同步
    operations.sort((a, b) => a.timestamp - b.timestamp);

    let successCount = 0;
    let failCount = 0;

    for (const operation of operations) {
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
        const response = await fetch(operation.url, requestOptions);

        if (response.ok) {
          // 同步成功，删除操作
          await deleteOperation(operation.id);
          successCount++;
          console.log('[SW] 操作同步成功:', operation.id, operation.type);

          // 通知前端同步成功
          await notifyClients({
            type: 'SYNC_SUCCESS',
            operationId: operation.id,
            operationType: operation.type
          });
        } else {
          // 同步失败，增加重试计数
          const newRetryCount = (operation.retryCount || 0) + 1;

          if (newRetryCount >= 5) {
            // 超过最大重试次数，标记为失败
            await updateOperation(operation.id, {
              status: 'failed',
              retryCount: newRetryCount,
              lastError: \`HTTP \${response.status}: \${response.statusText}\`
            });
            failCount++;
            console.error('[SW] 操作同步失败（超过最大重试次数）:', operation.id);

            // 通知前端同步失败
            await notifyClients({
              type: 'SYNC_FAILED',
              operationId: operation.id,
              operationType: operation.type,
              error: \`HTTP \${response.status}\`
            });
          } else {
            // 更新重试计数
            await updateOperation(operation.id, {
              retryCount: newRetryCount,
              lastError: \`HTTP \${response.status}: \${response.statusText}\`
            });
            failCount++;
            console.warn('[SW] 操作同步失败，将重试:', operation.id, \`(\${newRetryCount}/5)\`);
          }
        }
      } catch (error) {
        // 网络错误或其他异常
        console.error('[SW] 同步操作时出错:', operation.id, error);
        const newRetryCount = (operation.retryCount || 0) + 1;

        if (newRetryCount >= 5) {
          await updateOperation(operation.id, {
            status: 'failed',
            retryCount: newRetryCount,
            lastError: error.message
          });
          failCount++;
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
    await notifyClients({
      type: 'SYNC_COMPLETE',
      successCount,
      failCount,
      totalCount: operations.length
    });

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

/**
 * 消息处理
 * 允许页面与 Service Worker 通信
 */
self.addEventListener('message', event => {
  console.log('[SW] 收到消息:', event.data);
  
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
