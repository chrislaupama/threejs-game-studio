import { expect, test as base, type Page } from '@playwright/test';

export type RuntimeEvidence = {
  consoleErrors: string[];
  externalWebSockets: string[];
  httpErrors: string[];
  pageErrors: string[];
  requestFailures: string[];
  outboundRequests: string[];
};

async function installRuntimeGuard(page: Page): Promise<RuntimeEvidence> {
  const evidence: RuntimeEvidence = {
    consoleErrors: [],
    externalWebSockets: [],
    httpErrors: [],
    pageErrors: [],
    requestFailures: [],
    outboundRequests: [],
  };

  page.on('console', (message) => {
    if (message.type() === 'error') evidence.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => evidence.pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) {
      evidence.httpErrors.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? 'unknown failure';
    const deliberatelyBlocked =
      failure.includes('BLOCKED_BY_CLIENT') && evidence.outboundRequests.includes(request.url());
    if (!deliberatelyBlocked) evidence.requestFailures.push(`${failure} ${request.url()}`);
  });
  page.on('websocket', (socket) => {
    const url = new URL(socket.url());
    if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
      evidence.externalWebSockets.push(socket.url());
    }
  });

  await page.context().route('**/*', async (route) => {
    const value = route.request().url();
    const url = new URL(value);
    const local = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
    const inProcess = ['about:', 'blob:', 'data:', 'file:'].includes(url.protocol);

    if (local || inProcess) {
      await route.continue();
      return;
    }

    evidence.outboundRequests.push(value);
    await route.abort('blockedbyclient');
  });

  return evidence;
}

/**
 * Drop-in Playwright test with an automatic local-only and runtime-error guard.
 * Import this instead of `test`/`expect` from `@playwright/test` so every test,
 * including future screenshots and playtests, receives the same assertions.
 */
export const test = base.extend<{ runtimeGuard: RuntimeEvidence }>({
  runtimeGuard: [
    async ({ page }, use) => {
      const evidence = await installRuntimeGuard(page);
      await use(evidence);

      expect.soft(evidence.consoleErrors, 'browser console errors').toEqual([]);
      expect.soft(evidence.externalWebSockets, 'unapproved external WebSockets').toEqual([]);
      expect.soft(evidence.httpErrors, 'HTTP error responses').toEqual([]);
      expect.soft(evidence.pageErrors, 'uncaught page errors').toEqual([]);
      expect.soft(evidence.requestFailures, 'unexpected failed requests').toEqual([]);
      expect.soft(evidence.outboundRequests, 'unapproved outbound requests').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
