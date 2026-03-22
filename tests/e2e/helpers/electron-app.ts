import { createRequire } from 'node:module'
import path from 'node:path'
import { _electron } from 'playwright'
import type { ElectronApplication, Page } from 'playwright'
import { E2E_PGLITE_DIR, E2E_USER_DATA_DIR, pathToMainJs } from '../paths'

/** Alinhado a `TOUR_STORAGE_KEY` em `src/renderer/src/lib/tour-constants.ts` */
const TOUR_COMPLETED_KEY = 'escalaflow-tour-completed'

const require = createRequire(import.meta.url)

export type LaunchElectronOptions = {
  /** Sobrescreve env para o processo Electron */
  extraEnv?: NodeJS.ProcessEnv
}

/**
 * Sobe o app Electron real (build em `out/`), com preload + IPC.
 * Requer `npm run build` antes.
 */
export async function launchEscalaflowElectron(
  options: LaunchElectronOptions = {},
): Promise<ElectronApplication> {
  const mainJs = pathToMainJs()
  const executablePath = require('electron') as string

  return _electron.launch({
    executablePath,
    args: [`--user-data-dir=${E2E_USER_DATA_DIR}`, mainJs],
    cwd: path.join(process.cwd()),
    env: {
      ...process.env,
      ESCALAFLOW_E2E: '1',
      ESCALAFLOW_DB_PATH: E2E_PGLITE_DIR,
      NODE_ENV: 'development',
      ...options.extraEnv,
    },
  })
}

export async function firstWindowReady(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.locator('#root').waitFor({ state: 'attached', timeout: 60_000 })
  // Evita overlay do tour (z-50) bloqueando cliques nos testes
  await page.evaluate((key) => {
    localStorage.setItem(key, 'true')
  }, TOUR_COMPLETED_KEY)
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await page.locator('#root').waitFor({ state: 'attached', timeout: 60_000 })
  return page
}

export async function closeApp(app: ElectronApplication): Promise<void> {
  await app.close()
}
