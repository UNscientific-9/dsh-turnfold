import { defineConfig } from '@playwright/test';

/**
 * Browser-integration runner.
 *
 * Tests in `./specs/` run against the static fixture pages served by
 * `server.mjs` on port 3100. Each spec file owns one Playwright `test()`
 * case; specs share the projector singleton loaded by `lib/fixture.js`
 * inside the page, so we serialise with `workers: 1` to keep DOM
 * mutations from one spec bleeding into the next.
 */
export default defineConfig({
  testDir: './specs',
  timeout: 10_000,
  expect: { timeout: 2_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    headless: true,
    channel: 'msedge', // 用本机已装的 Edge，避免下载 chromium
    baseURL: 'http://127.0.0.1:3100',
  },
  webServer: {
    command: 'node ./server.mjs',
    port: 3100,
    reuseExistingServer: true,
    timeout: 10_000,
  },
});
