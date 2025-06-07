import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.js'],  // 加载测试环境设置
    include: ['tests/**/*.test.js', 'src/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.js'],
      exclude: [
        'src/ui/**',  // 前端代码单独测试
        'src/worker.js',  // Worker 入口需要集成测试
        'src/**/*.test.js'
      ]
    },
    testTimeout: 10000,
    hookTimeout: 10000
  }
});
