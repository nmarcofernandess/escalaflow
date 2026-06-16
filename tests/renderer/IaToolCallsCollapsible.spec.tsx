/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { IaToolCallsCollapsible } from '../../src/renderer/src/componentes/IaToolCallsCollapsible'
import type { ToolCall } from '../../src/shared/types'

// IaToolCallsCollapsible agora é um re-export de FlowToolCalls (AI Elements Tool).
// Mostra label amigável (toolLabel) no header e expõe o nome cru via data-tool-name
// para a ordenação do E2E.
describe('IaToolCallsCollapsible (FlowToolCalls)', () => {
  it('renderiza estados concluído e com erro usando labels amigáveis', () => {
    const calls: ToolCall[] = [
      { id: 'a', name: 'consultar', args: {}, result: { ok: true } },
      { id: 'b', name: 'buscar_conhecimento', args: {}, result: { error: 'sem fonte' } },
    ]

    render(<IaToolCallsCollapsible toolCalls={calls} />)

    expect(screen.getByText('Consultando dados')).toBeInTheDocument()
    expect(screen.getByText('Concluída')).toBeInTheDocument()
    expect(screen.getByText('Buscando na base')).toBeInTheDocument()
    // "Erro" aparece no badge de status e no header do frame de output — ambos PT corretos.
    expect(screen.getAllByText('Erro').length).toBeGreaterThan(0)
  })

  it('expõe o nome cru da tool via data-tool-name (contrato do E2E)', () => {
    render(
      <IaToolCallsCollapsible
        toolCalls={[{ id: 'a', name: 'consultar', args: {}, result: null }]}
      />,
    )

    const row = document.querySelector('[data-testid="ia-tool-call"]')
    expect(row?.getAttribute('data-tool-name')).toBe('consultar')
  })

  it('renderiza tools em andamento (streaming) pela mesma UI de tool', () => {
    render(
      <IaToolCallsCollapsible
        toolCalls={[]}
        runningTools={{
          c: { tool_name: 'gerar_escala', args: {}, started_at: 1 },
        }}
      />,
    )

    expect(screen.getByText('Gerando escala')).toBeInTheDocument()
    expect(screen.getByText('Executando')).toBeInTheDocument()
  })
})
