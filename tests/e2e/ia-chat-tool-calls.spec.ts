import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchEscalaflowElectron, firstWindowReady, closeApp } from './helpers/electron-app'
import {
  openSetorPadaria,
  openIaPanel,
  sendIaMessage,
  waitForAssistantTurnComplete,
  getLastAssistantText,
  getToolCallNamesInOrder,
  getTurnMeta,
  navigateHash,
  startFreshIaConversation,
  IA_WRITE_TOOL_NAMES,
} from './helpers/ia-chat'

const hasIaKey = Boolean(process.env.GEMINI_API_KEY?.trim() || process.env.OPENROUTER_API_KEY?.trim())

/**
 * E2E real: chat embutido no Electron, IPC + preload, contexto de rota.
 * Requer chave de API no ambiente; `npm run build` antes.
 */
const describeIa = hasIaKey ? test.describe : test.describe.skip

describeIa('IA chat E2E (Electron real)', () => {
  test.describe.configure({ mode: 'serial' })

  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    app = await launchEscalaflowElectron()
    page = await firstWindowReady(app)
  })

  test.afterAll(async () => {
    await closeApp(app)
  })

  test.beforeEach(async () => {
    await openSetorPadaria(page)
    await openIaPanel(page)
    await startFreshIaConversation(page)
  })

  test('contexto: pergunta sobre folgas no setor sem pedir ID de setor', async () => {
    expect(page.url()).toMatch(/#\/setores\/\d+/)
    await sendIaMessage(page, 'a distribuicao de folgas da padaria esta boa? Responda em portugues de forma breve.')
    await waitForAssistantTurnComplete(page, { minAssistantChars: 10 })
    const reply = await getLastAssistantText(page)
    expect(reply.length).toBeGreaterThan(10)
    expect(reply.toLowerCase()).not.toMatch(/informe (o )?id|qual (é|e) o id do setor|preciso do id do setor/)
    await getToolCallNamesInOrder(page)
  })

  test('deficit: pergunta sobre deficit de cobertura', async () => {
    await sendIaMessage(page, 'tem deficit em algum dia no setor? Responda em portugues, breve.')
    await waitForAssistantTurnComplete(page, { minAssistantChars: 10 })
    const reply = await getLastAssistantText(page)
    expect(reply.length).toBeGreaterThan(10)
    await getToolCallNamesInOrder(page)
  })

  test('operacional: pessoas fora do posto', async () => {
    await sendIaMessage(
      page,
      'Quais pessoas estao fora do posto neste setor agora? Use dados do contexto ou consulta. Breve.',
    )
    await waitForAssistantTurnComplete(page, { minAssistantChars: 10 })
    const reply = await getLastAssistantText(page)
    expect(reply.length).toBeGreaterThan(10)
  })

  test('acao: salvar_memoria e ver na pagina Memoria', async () => {
    const marker = `E2E_MEM_${crypto.randomUUID()}`
    await sendIaMessage(
      page,
      `Use a ferramenta salvar_memoria para gravar exatamente este texto (uma linha): "${marker}". Depois confirme que salvou.`,
    )
    await waitForAssistantTurnComplete(page, { minAssistantChars: 5 })

    const tools = await getToolCallNamesInOrder(page)
    if (tools.length > 0) {
      expect(tools.some((n) => IA_WRITE_TOOL_NAMES.has(n))).toBe(true)
      expect(tools).toContain('salvar_memoria')
    }

    await navigateHash(page, '/memoria')
    await page.waitForFunction(() => /#\/memoria$/.test(window.location.hash), { timeout: 30_000 })
    await page.getByRole('tab', { name: /memorias/i }).click()
    await expect(page.getByRole('tabpanel').getByText(marker, { exact: true })).toBeVisible({ timeout: 120_000 })
  })

  test('folgas — responde com preview sem pedir ID', async () => {
    await sendIaMessage(page, 'a distribuicao de folgas da padaria esta boa?')
    await waitForAssistantTurnComplete(page)

    const text = await getLastAssistantText(page)
    expect(text.length).toBeGreaterThan(20)

    // Must NOT ask for setor ID — context already has it
    expect(text.toLowerCase()).not.toContain('id do setor')
    expect(text.toLowerCase()).not.toContain('qual setor')

    // Context metadata should show setor was in context
    const meta = await getTurnMeta(page)
    if (meta) {
      expect(meta.bundle_sections).toContain('setor')
      expect(meta.briefing_chars).toBeGreaterThan(100)
    }
  })

  test('deficit — resposta coerente com preview', async () => {
    await startFreshIaConversation(page)
    await sendIaMessage(page, 'tem deficit de cobertura em algum dia?')
    await waitForAssistantTurnComplete(page)

    const text = await getLastAssistantText(page)
    expect(text.length).toBeGreaterThan(20)

    // Should reference data, not ask for more info
    expect(text.toLowerCase()).not.toContain('qual setor')
  })

  test('operacional — quem esta fora do posto usa setor atual', async () => {
    await startFreshIaConversation(page)
    await sendIaMessage(page, 'quem esta fora do posto na padaria?')
    await waitForAssistantTurnComplete(page)

    const text = await getLastAssistantText(page)
    expect(text.length).toBeGreaterThan(10)

    // Must NOT ask which sector
    expect(text.toLowerCase()).not.toContain('qual setor')
  })
})
