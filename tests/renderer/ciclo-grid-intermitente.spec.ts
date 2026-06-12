import { describe, expect, it } from 'vitest'
import { escalaParaCicloGrid, simulacaoParaCicloGrid } from '../../src/renderer/src/lib/ciclo-grid-converters'
import type { Alocacao, Colaborador, Funcao, RegraHorarioColaborador } from '../../src/shared'
import { gerarCicloFase1 } from '../../src/shared/simula-ciclo'

const hellen: Colaborador = {
  id: 10,
  setor_id: 1,
  tipo_contrato_id: 3,
  nome: 'HELLEN',
  sexo: 'F',
  horas_semanais: 6,
  rank: 1,
  prefere_turno: null,
  evitar_dia_semana: null,
  ativo: true,
  tipo_trabalhador: 'INTERMITENTE',
  funcao_id: 20,
}

const funcao: Funcao = {
  id: 20,
  setor_id: 1,
  apelido: 'BALCAO',
  tipo_contrato_id: 3,
  ativo: true,
  ordem: 1,
  cor_hex: null,
}

const regraTipoA: RegraHorarioColaborador = {
  id: 1,
  colaborador_id: hellen.id,
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

function alocacao(data: string, status: Alocacao['status'], minutos = 0): Alocacao {
  return {
    id: Number(data.replaceAll('-', '')),
    escala_id: 1,
    colaborador_id: hellen.id,
    data,
    status,
    hora_inicio: status === 'TRABALHO' ? '07:00' : null,
    hora_fim: status === 'TRABALHO' ? '13:00' : null,
    minutos: status === 'TRABALHO' ? minutos : null,
    minutos_trabalho: status === 'TRABALHO' ? minutos : null,
    funcao_id: funcao.id,
  }
}

describe('escalaParaCicloGrid intermitente tipo A', () => {
  it('exibe dias sem convocação como NT e não inventa FF/FV/DF', () => {
    const grid = escalaParaCicloGrid(
      { data_inicio: '2026-06-15', data_fim: '2026-06-21' },
      [
        alocacao('2026-06-15', 'FOLGA'),
        alocacao('2026-06-16', 'FOLGA'),
        alocacao('2026-06-17', 'FOLGA'),
        alocacao('2026-06-18', 'FOLGA'),
        alocacao('2026-06-19', 'FOLGA'),
        alocacao('2026-06-20', 'FOLGA'),
        alocacao('2026-06-21', 'TRABALHO', 360),
      ],
      [hellen],
      [funcao],
      [regraTipoA],
      [],
    )

    expect(grid.rows).toHaveLength(1)
    expect(grid.rows[0].fixa).toBeNull()
    expect(grid.rows[0].variavel).toBeNull()
    expect(grid.rows[0].semanas[0]).toEqual(['NT', 'NT', 'NT', 'NT', 'NT', 'NT', 'DT'])
  })
})

describe('simulacaoParaCicloGrid 6x1', () => {
  it('renderiza folga unica semanal sem inventar folga fixa', () => {
    const resultado = gerarCicloFase1({
      num_postos: 5,
      trabalham_domingo: 2,
      num_meses: 1,
      preflight: true,
      regime: '6X1',
    })

    expect(resultado.sucesso).toBe(true)
    if (!resultado.sucesso) return

    const grid = simulacaoParaCicloGrid(resultado)
    const rowComDomingoTrabalhado = grid.rows.find((row) => row.semanas.some((semana) => semana[6] === 'DT'))

    expect(rowComDomingoTrabalhado).toBeDefined()
    expect(rowComDomingoTrabalhado?.fixa).toBeNull()
    expect(rowComDomingoTrabalhado?.variavel).not.toBeNull()

    const semanasComDomingoTrabalhado = rowComDomingoTrabalhado!.semanas.filter((semana) => semana[6] === 'DT')
    expect(semanasComDomingoTrabalhado.length).toBeGreaterThan(0)
    for (const semana of semanasComDomingoTrabalhado) {
      expect(semana.filter((dia) => dia === 'FV')).toHaveLength(1)
      expect(semana.filter((dia) => dia === 'DF')).toHaveLength(0)
    }
  })
})
