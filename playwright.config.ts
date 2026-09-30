import { defineConfig } from '@playwright/test';

// Each test launches its own Chromium with the unpacked extension (see scripts/lib/extension.ts).
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
});
