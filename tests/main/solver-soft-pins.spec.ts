// tests/main/solver-soft-pins.spec.ts
// Tests for hierarchical soft pin constraints in solve_folga_pattern (Phase 1).
// Spawns the Python solver directly via stdin/stdout JSON — no DB needed.

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import path from 'path'

const SOLVER_PY = path.join(__dirname, '../../solver/solver_ortools.py')

function runSolver(data: Record<string, unknown>) {
  // Always use python3 directly to test latest source (binary may be stale)
  const cmd = 'python3'
  const args = [SOLVER_PY]
  const stdout = execFileSync(cmd, args, {
    input: JSON.stringify(data),
    encoding: 'utf-8',
    timeout: 90_000,
  })
  return JSON.parse(stdout)
}

function makeMinimalInput(
  pins?: Array<{
    c: number
    d: number
    band: number
    origin?: string
    weight?: number
  }>,
) {
  const colabs = Array.from({ length: 3 }, (_, i) => ({
    id: i + 1,
    nome: `Colab_${i}`,
    sexo: 'M',
    tipo_trabalhador: 'CLT',
    horas_semanais: 44,
    dias_trabalho: 5,
    max_minutos_dia: 585,
    folga_fixa_dia_semana: null,
    folga_variavel_dia_semana: null,
    rank: 0,
    prefere_turno: null,
  }))
  return {
    data_inicio: '2026-03-02',
    data_fim: '2026-03-08',
    empresa: {
      hora_abertura: '07:00',
      hora_fechamento: '22:00',
      grid_minutos: 15,
      tolerancia_semanal_min: 15,
      min_intervalo_almoco_min: 30,
    },
    colaboradores: colabs,
    demanda: ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'].map((d) => ({
      dia_semana: d,
      hora_inicio: '07:00',
      hora_fim: '22:00',
      min_pessoas: 2,
    })),
    feriados: [],
    excecoes: [],
    config: {
      rules: {},
      advisory_only: true,
      ...(pins ? { pinned_folga_externo: pins } : {}),
    },
  }
}

describe('solve_folga_pattern soft pins', { timeout: 120_000 }, () => {
    it('respects all pins when feasible (cost = 0)', () => {
      // 3 people, 7 days, need 2/day, each works 5 days
      // Person 0: SAB+DOM off (pins leave persons 1+2 on SAB, persons 1+2 on DOM = 2 each, meets demand)
      // Person 1: WED+THU off (no overlap with person 0 pins, all other days have 2+ people)
      const pins = [
        { c: 0, d: 5, band: 0, origin: 'manual', weight: 5000 }, // person 0 off SAB
        { c: 0, d: 6, band: 0, origin: 'saved', weight: 10000 }, // person 0 off DOM
        { c: 1, d: 2, band: 0, origin: 'auto', weight: 100 }, // person 1 off WED
        { c: 1, d: 3, band: 0, origin: 'auto', weight: 100 }, // person 1 off THU
      ]
      const result = runSolver(makeMinimalInput(pins))
      expect(result.status).not.toBe('ADVISORY_INFEASIBLE')
      const pinCost = result.diagnostico?.pin_cost ?? 0
      expect(pinCost).toBe(0)
    })

    it('prefers violating cheap pins over expensive ones', () => {
      // All 3 want SAB off (only 1 can be off — need 2 on SAB)
      // Manual pin (5000) should be preserved, auto (100) violated
      const pins = [
        { c: 0, d: 5, band: 0, origin: 'manual', weight: 5000 },
        { c: 1, d: 5, band: 0, origin: 'auto', weight: 100 },
        { c: 2, d: 5, band: 0, origin: 'auto', weight: 100 },
      ]
      const result = runSolver(makeMinimalInput(pins))
      expect(result.sucesso).toBe(true)
      const violations = result.diagnostico?.pin_violations ?? []
      // If any violations, they should be auto, NOT manual
      for (const v of violations) {
        expect(v.origin).not.toBe('manual')
      }
    })

    it('never returns INFEASIBLE when pins have weights', () => {
      // All 3 want SEG off but demanda needs all 3 on SEG -> conflict
      // With soft pins, should still find a solution (violating some pins)
      const pins = Array.from({ length: 3 }, (_, i) => ({
        c: i,
        d: 0,
        band: 0,
        origin: 'auto' as const,
        weight: 100,
      }))
      const data = makeMinimalInput(pins)
      ;(data.demanda[0] as any).min_pessoas = 3
      const result = runSolver(data)
      expect(result.sucesso).toBe(true)
    })

    it('returns pin_violations and pin_cost in diagnostico', () => {
      const pins = Array.from({ length: 3 }, (_, i) => ({
        c: i,
        d: 0,
        band: 0,
        origin: 'auto' as const,
        weight: 100,
      }))
      const data = makeMinimalInput(pins)
      ;(data.demanda[0] as any).min_pessoas = 3
      const result = runSolver(data)
      expect(result.diagnostico).toHaveProperty('pin_violations')
      expect(result.diagnostico).toHaveProperty('pin_cost')
      expect(result.diagnostico.pin_cost).toBeGreaterThan(0)
    })

    it('legacy pins without origin/weight still work (no pin_violations)', () => {
      // Pins without origin/weight -> HARD mode -> no violations field
      const pins = [
        { c: 0, d: 5, band: 0 },
        { c: 0, d: 6, band: 0 },
      ]
      const result = runSolver(makeMinimalInput(pins))
      expect(result.status).not.toBe('ADVISORY_INFEASIBLE')
      // Legacy mode should NOT have pin_violations in diagnostico
      expect(result.diagnostico?.pin_violations).toBeUndefined()
    })
  })
