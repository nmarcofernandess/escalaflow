import { test, expect } from '@playwright/test'
import { launchEscalaflowElectron, firstWindowReady, closeApp } from './helpers/electron-app'
import { navigateToSetoresList } from './helpers/ia-chat'
import { E2E_SETOR_PADARIA_NOME, E2E_SETOR_6X1_NOME } from './constants'

/**
 * Valida harness: Electron real + preload + seed E2E (sem chamar LLM).
 * Requer: `npm run build` e `ESCALAFLOW_E2E=1` (via launch helper).
 */
test.describe.configure({ mode: 'serial' })

test('abre app, lista setores e mostra Padaria 5x2 + Mercearia 6x1 (seed E2E)', async () => {
  const app = await launchEscalaflowElectron()
  try {
    const page = await firstWindowReady(app)
    await navigateToSetoresList(page)
    await expect(page.getByText(E2E_SETOR_PADARIA_NOME, { exact: true }).first()).toBeVisible({ timeout: 60_000 })
    // Setor 6x1 do seed E2E — prova que regime_escala='6X1' + contrato 'CLT 44h 6x1' chegam vivos na UI
    await expect(page.getByText(E2E_SETOR_6X1_NOME, { exact: true }).first()).toBeVisible({ timeout: 30_000 })
  } finally {
    await closeApp(app)
  }
})
