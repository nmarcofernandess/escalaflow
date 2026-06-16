import { defineConfig } from '@playwright/test'

/**
 * E2E com Electron real: requer `npm run build` e variáveis de IA (ver tests/e2e/README.md).
 */
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  // IA local (Gemma E2B via llama-server) é mais lenta que a nuvem: o primeiro turno
  // inclui boot do llama-server + carga do modelo. Sobe o teto por teste só nesse modo.
  timeout: process.env.ESCALAFLOW_E2E_LOCAL ? 600_000 : 180_000,
  expect: { timeout: 45_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
})
