const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.cjs',
  timeout: 30000,
  workers: 1,
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  use: { baseURL: 'http://127.0.0.1:8767', viewport: { width: 390, height: 844 },
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'python ../tests/serve_web.py', url: 'http://127.0.0.1:8767',
    reuseExistingServer: false, timeout: 15000 },
});
