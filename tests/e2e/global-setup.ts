import fs from 'node:fs'
import type { FullConfig } from '@playwright/test'
import { E2E_PGLITE_DIR, E2E_USER_DATA_DIR } from './paths'

/**
 * Remove PGlite e userData do último run para o bootstrap recriar DB + seeds.
 */
async function globalSetup(_config: FullConfig): Promise<void> {
  fs.rmSync(E2E_PGLITE_DIR, { recursive: true, force: true })
  fs.rmSync(E2E_USER_DATA_DIR, { recursive: true, force: true })
}

export default globalSetup
