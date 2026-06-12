import { describe, expect, it } from 'vitest'
import { tipoFolga } from '../../src/renderer/src/lib/folga-helpers'
import type { Alocacao, RegraHorarioColaborador } from '../../src/shared'

const regraTipoA: RegraHorarioColaborador = {
  id: 1,
  colaborador_id: 10,
  dia_semana_regra: null,
  ativo: true,
  perfil_horario_id: null,
  inicio: null,
  fim: null,
  preferencia_turno_soft: null,
  folga_fixa_dia_semana: null,
  folga_variavel_dia_semana: null,
  recorrencia_semanas_trabalho: 1,
  recorrencia_semanas_folga: 1,
  recorrencia_ancora: '2026-06-15',
}

const alocacoes: Alocacao[] = [
  {
    id: 1,
    escala_id: 1,
    colaborador_id: 10,
    data: '2026-06-16',
    status: 'FOLGA',
    hora_inicio: null,
    hora_fim: null,
    minutos: null,
    funcao_id: null,
  },
]

describe('tipoFolga', () => {
  it('rotula intermitente tipo A sem convocação como NT, não como folga', () => {
    expect(
      tipoFolga(
        '2026-06-16',
        regraTipoA,
        alocacoes,
        10,
        { tipo_trabalhador: 'INTERMITENTE' },
      ),
    ).toBe('NT')
  })
})
