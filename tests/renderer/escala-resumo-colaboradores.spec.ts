import { describe, expect, it } from 'vitest'
import { calcularResumoColaboradores } from '../../src/renderer/src/lib/escala-resumo-colaboradores'
import type { Alocacao, Colaborador, TipoContrato } from '../../src/shared'

const contratoClt: TipoContrato = {
  id: 1,
  nome: 'CLT 44h',
  horas_semanais: 44,
  tipo_trabalhador: 'CLT',
  regime_escala: '6X1',
  dias_trabalho: 6,
  max_minutos_dia: 585,
  protegido_sistema: true,
}

const contratoIntermitente: TipoContrato = {
  id: 2,
  nome: 'Intermitente',
  horas_semanais: 6,
  tipo_trabalhador: 'INTERMITENTE',
  regime_escala: '6X1',
  dias_trabalho: 1,
  max_minutos_dia: 360,
  protegido_sistema: true,
}

function colaborador(partial: Partial<Colaborador>): Colaborador {
  return {
    id: partial.id ?? 1,
    setor_id: 1,
    tipo_contrato_id: partial.tipo_contrato_id ?? contratoClt.id,
    nome: partial.nome ?? 'ANA',
    sexo: 'F',
    horas_semanais: partial.horas_semanais ?? 44,
    rank: 1,
    prefere_turno: null,
    evitar_dia_semana: null,
    ativo: true,
    tipo_trabalhador: partial.tipo_trabalhador ?? 'CLT',
    funcao_id: null,
  }
}

function trabalho(colaboradorId: number, data: string, minutos: number): Alocacao {
  return {
    id: Number(`${colaboradorId}${data.replaceAll('-', '')}`),
    escala_id: 1,
    colaborador_id: colaboradorId,
    data,
    status: 'TRABALHO',
    hora_inicio: '07:00',
    hora_fim: '13:00',
    minutos,
    minutos_trabalho: minutos,
    funcao_id: null,
  }
}

describe('calcularResumoColaboradores', () => {
  it('não cria meta semanal falsa para intermitente tipo A sem violação do validador', () => {
    const rows = calcularResumoColaboradores({
      colaboradores: [
        colaborador({
          id: 10,
          nome: 'HELLEN',
          tipo_contrato_id: contratoIntermitente.id,
          tipo_trabalhador: 'INTERMITENTE',
          horas_semanais: 6,
        }),
      ],
      tiposContrato: [contratoIntermitente],
      alocacoes: [
        trabalho(10, '2026-06-21', 360),
        trabalho(10, '2026-07-05', 360),
      ],
      violacoes: [],
      dataInicio: '2026-06-15',
      dataFim: '2026-07-12',
    })

    expect(rows[0]).toMatchObject({
      real: 720,
      meta: 720,
      delta: 0,
      ok: true,
    })
    expect(rows[0].soft).toHaveLength(0)
    expect(rows[0].hard).toHaveLength(0)
  })

  it('mantém a meta contratual para CLT', () => {
    const rows = calcularResumoColaboradores({
      colaboradores: [colaborador({ id: 20, nome: 'CELIA' })],
      tiposContrato: [contratoClt],
      alocacoes: [
        trabalho(20, '2026-06-15', 440),
        trabalho(20, '2026-06-16', 440),
        trabalho(20, '2026-06-17', 440),
        trabalho(20, '2026-06-18', 440),
        trabalho(20, '2026-06-19', 440),
        trabalho(20, '2026-06-20', 440),
      ],
      violacoes: [],
      dataInicio: '2026-06-15',
      dataFim: '2026-06-21',
    })

    expect(rows[0].meta).toBe(2640)
    expect(rows[0].delta).toBe(0)
    expect(rows[0].ok).toBe(true)
  })
})
