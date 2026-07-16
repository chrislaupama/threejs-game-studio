import { defineConfig, devices } from '@playwright/test';

const browserChannel = process.env.PLAYWRIGHT_CHANNEL as 'chrome' | undefined;

export default defineConfig({
  testDir: './tests',
  // One worker: parallel headless WebGL contexts share the software
  // rasterizer, and the frame-time collapse makes game time drift from wall
  // time, flaking timed gameplay phases and screenshot baselines.
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:5188',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5188',
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
