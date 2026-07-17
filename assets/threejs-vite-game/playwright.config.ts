import { defineConfig, devices } from '@playwright/test';

const browserChannel = process.env.PLAYWRIGHT_CHANNEL as 'chrome' | undefined;
const port = Number(process.env.THREE_GAME_PORT ?? '5188');
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('THREE_GAME_PORT must be an integer from 1 through 65535.');
}
const loopbackUrl = 'http://127.0.0.1' + ':' + port;

export default defineConfig({
  testDir: './tests',
  // One worker: parallel headless WebGL contexts share the software
  // rasterizer, and the frame-time collapse makes game time drift from wall
  // time, flaking timed gameplay phases and screenshot baselines.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: {
    timeout: 8_000,
  },
  use: {
    baseURL: loopbackUrl,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run build:e2e && npm run preview:e2e',
    env: {
      VITE_ENABLE_GAME_DIAGNOSTICS: 'true',
    },
    url: loopbackUrl,
    reuseExistingServer: false,
    timeout: 20_000,
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        ...(browserChannel ? { channel: browserChannel } : {}),
      },
    },
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 7'],
        ...(browserChannel ? { channel: browserChannel } : {}),
      },
    },
  ],
});
