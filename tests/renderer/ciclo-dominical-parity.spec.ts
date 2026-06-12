import { describe, expect, it } from 'vitest'
import { gerarCicloFase1, converterNivel1ParaEscala } from '../../src/shared/simula-ciclo'
import { escalaParaCicloGrid } from '../../src/renderer/src/lib/ciclo-grid-converters'
import type { Colaborador, Demanda, Funcao } from '../../src/shared'

const PERIODO = { data_inicio: '2026-03-02', data_fim: '2026-05-31' }

function buildPostos(n: number): Array<{ funcao: Funcao; titular: Colaborador }> {
  return Array.from({ length: n }, (_, index) => {
    const id = index + 1
    const funcao = {
      id,
      setor_id: 1,
      apelido: `Posto ${id}`,
      tipo_contrato_id: 1,
      ativo: true,
      ordem: id,
      cor_hex: null,
    } as Funcao
    const titular = {
      id,
      setor_id: 1,
      tipo_contrato_id: 1,
      funcao_id: id,
      nome: `Pessoa ${id}`,
      sexo: 'M',
      horas_semanais: 44,
      tipo_trabalhador: 'CLT',
      ativo: true,
      rank: id,
    } as Colaborador
    return { funcao, titular }
  })
}

function buildDemandas(k: number): Demanda[] {
  return [{
    id: 1,
    setor_id: 1,
    dia_semana: 'DOM',
    hora_inicio: '08:00',
    hora_fim: '14:00',
    min_pessoas: k,
    override: false,
  } as Demanda]
}

describe('ciclo dominical — paridade visual do preview com grid oficial', () => {
  for (const regime of ['5X2', '6X1'] as const) {
    it(`preserva ciclo_semanas em ${regime} para N=1..10 e K=0..floor(N/2)`, () => {
      for (let n = 1; n <= 10; n += 1) {
        for (let k = 0; k <= Math.floor(n / 2); k += 1) {
          const simulado = gerarCicloFase1({
            num_postos: n,
            trabalham_domingo: k,
            num_meses: 3,
            regime,
          })
          expect(simulado.sucesso, `${regime} N=${n} K=${k}`).toBe(true)

          const postos = buildPostos(n)
          const { escala, alocacoes, regras } = converterNivel1ParaEscala(
            simulado,
            postos,
            1,
            PERIODO,
          )
          const oficial = escalaParaCicloGrid(
            escala,
            alocacoes,
            postos.map((p) => p.titular),
            postos.map((p) => p.funcao),
            regras,
            buildDemandas(k),
          )

          expect(oficial.cicloSemanas, `${regime} N=${n} K=${k}`).toBe(simulado.ciclo_semanas)
        }
      }
    })
  }
})
