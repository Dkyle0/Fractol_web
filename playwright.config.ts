import { defineConfig, devices } from '@playwright/test';

// Inherit the run id in workers so every invocation has a stable, unique path.
const runId = process.env.FRACTOL_PLAYWRIGHT_RUN ??= `${new Date().toISOString().replaceAll(':', '-')}-${process.pid}`;
if (!/^[a-z0-9._-]+$/i.test(runId)) throw new Error('Invalid FRACTOL_PLAYWRIGHT_RUN');

export default defineConfig({
  testDir: './tests/browser',
  outputDir: `.local/runs/playwright-${runId}`,
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1440, height: 900 } } },
    { name: 'edge', use: { ...devices['Desktop Edge'], channel: 'msedge', viewport: { width: 1440, height: 900 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI },
});
