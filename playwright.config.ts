import { defineConfig } from '@playwright/test'

/**
 * E2E com Electron real: requer `npm run build` e variáveis de IA (ver tests/e2e/README.md).
 */
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 180_000,
  expect: { timeout: 45_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
})
