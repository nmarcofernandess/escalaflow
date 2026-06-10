/**
 * Overlay de paridade solver ↔ validador: células não-TRABALHO dentro de
 * exceção (real ou recorrência expandida) viram INDISPONIVEL, fazendo o
 * checkH10 proratar a meta semanal em vez de acusar falso positivo.
 */
import { describe, expect, it } from 'vitest'
import {
  aplicarExcecoesComoIndisponivel,
  celulaFolga,
  checkH10,
  type CelulaMotor,
  type ColabMotor,
} from '../../src/main/motor/validacao-compartilhada'
import type { Empresa } from '../../src/shared'

const SEMANA = [
  '2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12',
  '2026-03-13', '2026-03-14', '2026-03-15',
]

function mapaSemanaFolga(): Map<string, CelulaMotor> {
  const m = new Map<string, CelulaMotor>()
  for (const d of SEMANA) m.set(d, celulaFolga())
  return m
}

const COLAB = { id: 1, nome: 'Colab1', horas_semanais: 44 } as ColabMotor

describe('aplicarExcecoesComoIndisponivel', () => {
  it('célula FOLGA dentro de exceção vira INDISPONIVEL; TRABALHO fica intacto (H5 acusa)', () => {
    const resultado = new Map([[1, mapaSemanaFolga()]])
    const celTrabalho: CelulaMotor = { ...celulaFolga(), status: 'TRABALHO', minutos_trabalho: 480 }
    resultado.get(1)!.set('2026-03-10', celTrabalho)

    aplicarExcecoesComoIndisponivel(resultado, [
      { colaborador_id: 1, data_inicio: '2026-03-09', data_fim: '2026-03-15' },
    ], SEMANA)

    expect(resultado.get(1)!.get('2026-03-09')!.status).toBe('INDISPONIVEL')
    expect(resultado.get(1)!.get('2026-03-15')!.status).toBe('INDISPONIVEL')
    expect(resultado.get(1)!.get('2026-03-10')!.status).toBe('TRABALHO')
  })

  it('exceção de outro colaborador não vaza', () => {
    const resultado = new Map([[1, mapaSemanaFolga()]])
    aplicarExcecoesComoIndisponivel(resultado, [
      { colaborador_id: 99, data_inicio: '2026-03-09', data_fim: '2026-03-15' },
    ], SEMANA)
    expect(resultado.get(1)!.get('2026-03-09')!.status).toBe('FOLGA')
  })

  it('exceção parcial converte só os dias do range', () => {
    const resultado = new Map([[1, mapaSemanaFolga()]])
    aplicarExcecoesComoIndisponivel(resultado, [
      { colaborador_id: 1, data_inicio: '2026-03-11', data_fim: '2026-03-12' },
    ], SEMANA)
    expect(resultado.get(1)!.get('2026-03-10')!.status).toBe('FOLGA')
    expect(resultado.get(1)!.get('2026-03-11')!.status).toBe('INDISPONIVEL')
    expect(resultado.get(1)!.get('2026-03-12')!.status).toBe('INDISPONIVEL')
    expect(resultado.get(1)!.get('2026-03-13')!.status).toBe('FOLGA')
  })
})

describe('checkH10 + overlay (paridade com proração do solver)', () => {
  it('semana 100% FOLGA SEM overlay dispara H10 (falso positivo que o overlay resolve)', () => {
    const mapa = mapaSemanaFolga()
    const violacoes = checkH10(COLAB, SEMANA, mapa, 30, {} as Empresa, 'SOFT')
    expect(violacoes.length).toBe(1)
  })

  it('semana 100% INDISPONIVEL (pós-overlay) NÃO dispara H10', () => {
    const resultado = new Map([[1, mapaSemanaFolga()]])
    aplicarExcecoesComoIndisponivel(resultado, [
      { colaborador_id: 1, data_inicio: '2026-03-09', data_fim: '2026-03-15' },
    ], SEMANA)
    const violacoes = checkH10(COLAB, SEMANA, resultado.get(1)!, 30, {} as Empresa, 'SOFT')
    expect(violacoes).toEqual([])
  })
})
