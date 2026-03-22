import type { Page } from 'playwright'
import { expect } from '@playwright/test'
import { E2E_SETOR_PADARIA_NOME } from '../constants'

/** Tools consideradas mutação / escrita (heurística para E2E). */
export const IA_WRITE_TOOL_NAMES = new Set([
  'criar',
  'atualizar',
  'deletar',
  'cadastrar_lote',
  'gerar_escala',
  'ajustar_alocacao',
  'ajustar_horario',
  'oficializar_escala',
  'editar_regra',
  'salvar_regra_horario_colaborador',
  'upsert_regra_excecao_data',
  'resetar_regras_empresa',
  'configurar_horario_funcionamento',
  'salvar_perfil_horario',
  'deletar_perfil_horario',
  'salvar_demanda_excecao_data',
  'salvar_memoria',
  'remover_memoria',
  'salvar_conhecimento',
])

export async function navigateToSetoresList(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = '#/setores'
  })
  await page.waitForFunction(() => /#\/setores$/.test(window.location.hash), { timeout: 30_000 })
  await expect(page.getByText(E2E_SETOR_PADARIA_NOME, { exact: true }).first()).toBeVisible({ timeout: 60_000 })
}

/**
 * Abre o setor Padaria do seed E2E (nome estável — não depende de id; suporta lista em card ou tabela).
 */
export async function openSetorPadaria(page: Page): Promise<void> {
  await navigateToSetoresList(page)
  const tableRow = page.locator('tbody tr').filter({ hasText: E2E_SETOR_PADARIA_NOME }).first()
  if (await tableRow.isVisible().catch(() => false)) {
    await tableRow.getByRole('link').first().click()
  } else {
    const heading = page.getByRole('heading', { level: 3, name: E2E_SETOR_PADARIA_NOME, exact: true })
    await expect(heading).toBeVisible({ timeout: 30_000 })
    await heading.locator('xpath=ancestor::div[contains(@class,"border")][1]').getByRole('link', { name: /Abrir/i }).click()
  }

  await page.waitForFunction(() => /#\/setores\/\d+/.test(window.location.hash), { timeout: 30_000 })
  await expect(page.getByLabel('Nome')).toHaveValue(E2E_SETOR_PADARIA_NOME, { timeout: 45_000 })
}

export async function openIaPanel(page: Page): Promise<void> {
  const input = page.locator('[data-testid="ia-chat-input"]')
  const toggle = page.locator('#tour-ia-toggle')
  for (let i = 0; i < 3; i++) {
    if (await input.isVisible().catch(() => false)) return
    await toggle.click()
    await page.waitForTimeout(400)
  }
  await expect(input).toBeVisible({ timeout: 15_000 })
}

export async function waitForChatReady(page: Page): Promise<void> {
  const input = page.locator('[data-testid="ia-chat-input"]')
  await expect(input).toBeVisible({ timeout: 30_000 })
  await expect(input).toBeEnabled({ timeout: 120_000 })
}

export async function sendIaMessage(page: Page, texto: string): Promise<void> {
  await waitForChatReady(page)
  const input = page.locator('[data-testid="ia-chat-input"]')
  await input.fill(texto)
  await page.locator('[data-testid="ia-chat-send"]').click()
  await expect(input).toBeDisabled({ timeout: 30_000 })
}

/**
 * Aguarda o fim do turno: input reabilitado e última mensagem do assistente com texto.
 */
export async function waitForAssistantTurnComplete(page: Page, opts?: { minAssistantChars?: number }): Promise<void> {
  const minChars = opts?.minAssistantChars ?? 5
  const input = page.locator('[data-testid="ia-chat-input"]')
  await expect(input).toBeEnabled({ timeout: 180_000 })
  const last = page.locator('[data-testid="ia-assistant-message"]').last()
  await expect(last).toBeVisible({ timeout: 15_000 })
  await expect(last).not.toHaveText(/^\s*$/)
  const txt = await last.innerText()
  expect(txt.trim().length).toBeGreaterThanOrEqual(minChars)
}

export async function getLastAssistantText(page: Page): Promise<string> {
  const last = page.locator('[data-testid="ia-assistant-message"]').last()
  return (await last.innerText()).trim()
}

export async function getToolCallNamesInOrder(page: Page): Promise<string[]> {
  const panel = page.locator('[data-testid="ia-tool-calls-panel"]')
  const visible = await panel.isVisible().catch(() => false)
  if (!visible) return []
  const open = await panel.locator('[data-state="open"]').count()
  if (open === 0) {
    await panel.getByRole('button', { name: /ferramenta/i }).first().click().catch(() => {})
    await page.waitForTimeout(200)
  }
  const rows = page.locator('[data-testid="ia-tool-call"]')
  await rows.first().waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {})
  const n = await rows.count()
  const names: string[] = []
  for (let i = 0; i < n; i++) {
    const name = await rows.nth(i).getAttribute('data-tool-name')
    if (name) names.push(name)
  }
  return names
}

export function navigateHash(page: Page, hashPath: string): Promise<void> {
  return page.evaluate((p) => {
    const normalized = p.startsWith('/') ? p : `/${p}`
    window.location.hash = `#${normalized}`
  }, hashPath)
}

export async function startFreshIaConversation(page: Page): Promise<void> {
  const nova = page.getByTitle('Nova conversa')
  if (await nova.isVisible().catch(() => false)) {
    await nova.click()
  }
  await waitForChatReady(page)
}
