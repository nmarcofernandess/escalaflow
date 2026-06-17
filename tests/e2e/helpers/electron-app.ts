import { createRequire } from 'node:module'
import path from 'node:path'
import { _electron } from 'playwright'
import type { ElectronApplication, Page } from 'playwright'
import { E2E_PGLITE_DIR, E2E_USER_DATA_DIR, pathToMainJs } from '../paths'

/** Gate canônico de onboarding: `config.onboarding_complete` no DB (via config.get/set). */
const ONBOARDING_COMPLETE_KEY = 'onboarding_complete'

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
  const page = app.windows()[0] ?? (await app.waitForEvent('window', { timeout: 60_000 }))
  await page.waitForLoadState('domcontentloaded')
  await page.locator('#root').waitFor({ state: 'attached', timeout: 60_000 })
  // Marca onboarding como concluído (gate DB) antes do reload, para o smoke
  // E2E não ver o wizard de 1º boot bloqueando cliques.
  await page.evaluate(async (dbKey) => {
    try {
      // @ts-expect-error - preload expõe ipcRenderer no contexto do page
      await window.electron.ipcRenderer.invoke('config.set', {
        key: dbKey,
        value: '"true"',
      })
    } catch {
      // não fatal em E2E (db pode estar em estado parcial)
    }
  }, ONBOARDING_COMPLETE_KEY)
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await page.locator('#root').waitFor({ state: 'attached', timeout: 60_000 })
  return page
}

export async function closeApp(app: ElectronApplication): Promise<void> {
  await app.close()
}
