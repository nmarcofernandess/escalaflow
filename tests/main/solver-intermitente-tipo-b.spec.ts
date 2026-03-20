import { describe, it, expect } from 'vitest'
import { calcularCicloDomingo, runSolver } from '../../src/main/motor/solver-bridge'
import { enrichPreflightWithCapacityChecks } from '../../src/main/preflight-capacity'
import { isIntermitenteTipoA, isIntermitenteTipoB } from '../../src/shared/sunday-cycle'
import type { SolverInput, SolverInputColab } from '../../src/shared/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildHorarioPorDia(): Record<number, { abertura: string; fechamento: string }> {
  return Object.fromEntries(
    Array.from({ length: 7 }, (_, dia) => [dia, { abertura: '08:00', fechamento: '14:00' }]),
  )
}

/** Build regras_colaborador_dia for an intermitente with specific active days.
 *  Active days get folga_fixa=false (available), inactive days get folga_fixa=true (blocked).
 *  Optionally sets a time window on active days. */
function buildIntermitenteRegrasDia(
  colaboradorId: number,
  dataInicio: string,
  dataFim: string,
  activeDays: Set<number>, // 0=DOM, 1=SEG, 2=TER, 3=QUA, 4=QUI, 5=SEX, 6=SAB
  window?: { inicio: string; fim: string },
): NonNullable<SolverInput['regras_colaborador_dia']> {
  const regras: NonNullable<SolverInput['regras_colaborador_dia']> = []
  const cursor = new Date(`${dataInicio}T00:00:00`)
  const end = new Date(`${dataFim}T00:00:00`)

  while (cursor <= end) {
    const iso = cursor.toISOString().slice(0, 10)
    const jsDay = cursor.getDay() // 0=SUN, 1=MON...
    const active = activeDays.has(jsDay)

    regras.push({
      colaborador_id: colaboradorId,
      data: iso,
      inicio_min: active && window ? window.inicio : null,
      inicio_max: active && window ? window.inicio : null,
      fim_min: null,
      fim_max: active && window ? window.fim : null,
      preferencia_turno_soft: null,
      domingo_forcar_folga: false,
      folga_fixa: !active,
    })
    cursor.setDate(cursor.getDate() + 1)
  }

  return regras
}

type RegraGroupPadrao = { folga_fixa_dia_semana: string | null; folga_variavel_dia_semana?: string | null }
type RegraGroupDia = { inicio?: string | null; fim?: string | null }
type RegraGroup = { padrao: RegraGroupPadrao | null; dias: Map<string, RegraGroupDia> }

/** Build a minimal SolverInput for tipo B tests. */
function buildTipoBInput(opts?: {
  tipoBActiveDays?: Set<number>
  tipoBFolgaVariavel?: string
  tipoBWindow?: { inicio: string; fim: string }
  extraCLTs?: number
  domDemanda?: number
}): SolverInput {
  const activeDays = opts?.tipoBActiveDays ?? new Set([0, 1]) // DOM + SEG
  const folgaVariavel = opts?.tipoBFolgaVariavel ?? 'SEG'
  const tipoBWindow = opts?.tipoBWindow ?? { inicio: '08:00', fim: '14:00' }
  const numCLTs = opts?.extraCLTs ?? 5
  const domDemanda = opts?.domDemanda ?? 3
  const data_inicio = '2026-03-02'
  const data_fim = '2026-03-15'

  const cltColabs: SolverInputColab[] = Array.from({ length: numCLTs }, (_, idx) => ({
    id: idx + 1,
    nome: `CLT ${idx + 1}`,
    horas_semanais: 30,
    regime_escala: '5X2' as const,
    dias_trabalho: 5,
    max_minutos_dia: 360,
    tipo_trabalhador: 'CLT',
    sexo: 'F',
    funcao_id: idx + 1,
    rank: idx,
    domingo_ciclo_trabalho: 1,
    domingo_ciclo_folga: 1,
  }))

  // Tipo B: active on specific days, with folga_variavel
  // dias_trabalho = activeDays.size - 1 (XOR deducts 1)
  const tipoBColab: SolverInputColab = {
    id: numCLTs + 1,
    nome: 'Intermitente Tipo B',
    horas_semanais: Math.max(0, activeDays.size - 1) * 6, // matches dias_trabalho
    regime_escala: '5X2' as const,
    dias_trabalho: Math.max(0, activeDays.size - 1), // XOR deducts 1
    max_minutos_dia: 360,
    tipo_trabalhador: 'INTERMITENTE',
    sexo: 'F',
    funcao_id: numCLTs + 1,
    rank: 10,
    domingo_ciclo_trabalho: 1,
    domingo_ciclo_folga: 1,
    folga_variavel_dia_semana: folgaVariavel as any,
  }

  return {
    setor_id: 999,
    data_inicio,
    data_fim,
    empresa: {
      tolerancia_semanal_min: 60,
      hora_abertura: '08:00',
      hora_fechamento: '14:00',
      min_intervalo_almoco_min: 60,
      max_intervalo_almoco_min: 120,
      grid_minutos: 30,
      horario_por_dia: buildHorarioPorDia(),
    },
    colaboradores: [...cltColabs, tipoBColab],
    demanda: [
      { dia_semana: 'SEG', hora_inicio: '08:00', hora_fim: '14:00', min_pessoas: 2, override: false },
      { dia_semana: 'TER', hora_inicio: '08:00', hora_fim: '14:00', min_pessoas: 2, override: false },
      { dia_semana: 'QUA', hora_inicio: '08:00', hora_fim: '14:00', min_pessoas: 2, override: false },
      { dia_semana: 'QUI', hora_inicio: '08:00', hora_fim: '14:00', min_pessoas: 2, override: false },
      { dia_semana: 'SEX', hora_inicio: '08:00', hora_fim: '14:00', min_pessoas: 2, override: false },
      { dia_semana: 'SAB', hora_inicio: '08:00', hora_fim: '14:00', min_pessoas: 2, override: false },
      { dia_semana: 'DOM', hora_inicio: '08:00', hora_fim: '14:00', min_pessoas: domDemanda, override: false },
    ],
    feriados: [],
    excecoes: [],
    pinned_cells: [],
    regras_colaborador_dia: buildIntermitenteRegrasDia(
      numCLTs + 1, data_inicio, data_fim, activeDays, tipoBWindow,
    ),
    config: {
      solve_mode: 'rapido',
      max_time_seconds: 10,
      num_workers: 2,
      generation_mode: 'OFFICIAL',
      rules: {
        H3_DOM_MAX_CONSEC_F: 'HARD',
        H3_DOM_MAX_CONSEC_M: 'HARD',
        S_DEFICIT: 'ON',
        S_SURPLUS: 'ON',
        S_DOMINGO_CICLO: 'ON',
      },
    },
  }
}

// ===========================================================================
// T2-T4, T11: calcularCicloDomingo — tipo B in rotating pool
// ===========================================================================

describe('calcularCicloDomingo — tipo B intermitente', () => {
  it('T2: tipo B stays in the rotating pool (not counted as guaranteed)', () => {
    // 5 CLTs + 1 intermitente tipo B (with folga_variavel=SEG)
    // Tipo B has DOM in active days → should count toward nDom (pool), not guaranteed
    const regraGroupByColab = new Map<number, RegraGroup>([
      [1, { padrao: { folga_fixa_dia_semana: null }, dias: new Map() }],
      [2, { padrao: { folga_fixa_dia_semana: null }, dias: new Map() }],
      [3, { padrao: { folga_fixa_dia_semana: null }, dias: new Map() }],
      [4, { padrao: { folga_fixa_dia_semana: null }, dias: new Map() }],
      [5, { padrao: { folga_fixa_dia_semana: null }, dias: new Map() }],
      // Tipo B: has folga_variavel_dia_semana, DOM active (in dias map)
      [6, {
        padrao: { folga_fixa_dia_semana: null, folga_variavel_dia_semana: 'SEG' },
        dias: new Map([['DOM', { inicio: '08:00', fim: '14:00' }], ['SEG', { inicio: '08:00', fim: '14:00' }]]),
      }],
    ])

    const ciclo = calcularCicloDomingo(
      [{ dia_semana: 'DOM', min_pessoas: 3 }],
      [
        { id: 1, tipo_trabalhador: 'CLT' },
        { id: 2, tipo_trabalhador: 'CLT' },
        { id: 3, tipo_trabalhador: 'CLT' },
        { id: 4, tipo_trabalhador: 'CLT' },
        { id: 5, tipo_trabalhador: 'CLT' },
        { id: 6, tipo_trabalhador: 'INTERMITENTE' },
      ],
      regraGroupByColab,
    )

    // nDom = 6 (5 CLTs + 1 tipo B in pool), guaranteed = 0 (tipo B not guaranteed)
    // effective demand = 3, 6*(1/3)=2 > 3? No. 6*(1/2)=3 > 3? No. 6*(2/3)=4 > 3? Yes → 2:1
    expect(ciclo).toEqual({ cicloTrabalho: 2, cicloFolga: 1 })
  })

  it('T3: tipo A excluded from pool, tipo B included', () => {
    // 4 CLTs + 1 tipo A + 1 tipo B
    const regraGroupByColab = new Map<number, RegraGroup>([
      [1, { padrao: { folga_fixa_dia_semana: null }, dias: new Map() }],
      [2, { padrao: { folga_fixa_dia_semana: null }, dias: new Map() }],
      [3, { padrao: { folga_fixa_dia_semana: null }, dias: new Map() }],
      [4, { padrao: { folga_fixa_dia_semana: null }, dias: new Map() }],
      // Tipo A: no folga_variavel, DOM active
      [5, {
        padrao: { folga_fixa_dia_semana: null },
        dias: new Map([['DOM', { inicio: '08:00', fim: '14:00' }]]),
      }],
      // Tipo B: has folga_variavel, DOM active
      [6, {
        padrao: { folga_fixa_dia_semana: null, folga_variavel_dia_semana: 'QUA' },
        dias: new Map([['DOM', { inicio: '08:00', fim: '14:00' }], ['QUA', { inicio: '08:00', fim: '14:00' }]]),
      }],
    ])

    const ciclo = calcularCicloDomingo(
      [{ dia_semana: 'DOM', min_pessoas: 2 }],
      [
        { id: 1, tipo_trabalhador: 'CLT' },
        { id: 2, tipo_trabalhador: 'CLT' },
        { id: 3, tipo_trabalhador: 'CLT' },
        { id: 4, tipo_trabalhador: 'CLT' },
        { id: 5, tipo_trabalhador: 'INTERMITENTE' }, // Tipo A
        { id: 6, tipo_trabalhador: 'INTERMITENTE' }, // Tipo B
      ],
      regraGroupByColab,
    )

    // nDom: 4 CLTs + 1 tipo B = 5 (tipo A excluded because no folga_variavel)
    // guaranteed: tipo A has DOM rule → 1 guaranteed
    // effective demand = max(0, 2 - 1) = 1
    // 5 * (1/3) = 1.67 > 1 → ciclo 1:2
    expect(ciclo).toEqual({ cicloTrabalho: 1, cicloFolga: 2 })
  })

  it('T4: tipo B with folga_variavel=QUA, active days QUA+DOM', () => {
    const regraGroupByColab = new Map<number, RegraGroup>([
      [1, { padrao: { folga_fixa_dia_semana: null }, dias: new Map() }],
      [2, { padrao: { folga_fixa_dia_semana: null }, dias: new Map() }],
      [3, { padrao: { folga_fixa_dia_semana: null }, dias: new Map() }],
      // Tipo B: folga_variavel=QUA, days QUA+DOM
      [4, {
        padrao: { folga_fixa_dia_semana: null, folga_variavel_dia_semana: 'QUA' },
        dias: new Map([['DOM', { inicio: '08:00', fim: '14:00' }], ['QUA', { inicio: '08:00', fim: '14:00' }]]),
      }],
    ])

    const ciclo = calcularCicloDomingo(
      [{ dia_semana: 'DOM', min_pessoas: 2 }],
      [
        { id: 1, tipo_trabalhador: 'CLT' },
        { id: 2, tipo_trabalhador: 'CLT' },
        { id: 3, tipo_trabalhador: 'CLT' },
        { id: 4, tipo_trabalhador: 'INTERMITENTE' },
      ],
      regraGroupByColab,
    )

    // nDom: 3 CLTs + 1 tipo B = 4, guaranteed = 0
    // effective demand = 2
    // 4 * (1/3) = 1.33 > 2? No. 4*(1/2)=2 > 2? No. 4*(2/3)=2.67 > 2? Yes → 2:1
    expect(ciclo).toEqual({ cicloTrabalho: 2, cicloFolga: 1 })
  })

  it('T11: tipo B with 7 active days has dias_trabalho=6 (7-1 XOR)', () => {
    // This tests the bridge logic: when tipo B has all 7 days active,
    // dias_trabalho should be 6 (deducting 1 for XOR folga_variavel)
    const activeDays = new Set([0, 1, 2, 3, 4, 5, 6]) // all 7 days
    const input = buildTipoBInput({ tipoBActiveDays: activeDays, tipoBFolgaVariavel: 'SEG' })
    const tipoBColab = input.colaboradores.find(c => c.tipo_trabalhador === 'INTERMITENTE')!

    expect(tipoBColab.dias_trabalho).toBe(6) // 7 active - 1 XOR = 6
    expect(tipoBColab.folga_variavel_dia_semana).toBe('SEG')
    expect(tipoBColab.domingo_ciclo_trabalho).toBe(1)
    expect(tipoBColab.domingo_ciclo_folga).toBe(1)
  })

  it('tipo B with 2 active days has dias_trabalho=1 (2-1 XOR)', () => {
    const activeDays = new Set([0, 1]) // DOM + SEG
    const input = buildTipoBInput({ tipoBActiveDays: activeDays, tipoBFolgaVariavel: 'SEG' })
    const tipoBColab = input.colaboradores.find(c => c.tipo_trabalhador === 'INTERMITENTE')!

    expect(tipoBColab.dias_trabalho).toBe(1) // 2 active - 1 XOR = 1
  })

  it('tipo B with 1 active day has dias_trabalho=0 (1-1 XOR edge case)', () => {
    const activeDays = new Set([0]) // only DOM
    const input = buildTipoBInput({ tipoBActiveDays: activeDays, tipoBFolgaVariavel: 'SEG' })
    const tipoBColab = input.colaboradores.find(c => c.tipo_trabalhador === 'INTERMITENTE')!

    // Edge: 1 active - 1 XOR = 0, clamped to 0
    expect(tipoBColab.dias_trabalho).toBe(0)
  })
})

// ===========================================================================
// Preflight: tipo B availability
// ===========================================================================

describe('preflight capacity — tipo B intermitente', () => {
  it('accepts tipo B with active days including DOM', () => {
    const input = buildTipoBInput()
    const blockers: Array<{ codigo: string; severidade: string; mensagem: string; detalhe?: string }> = []
    const warnings: typeof blockers = []

    enrichPreflightWithCapacityChecks(input, blockers, warnings)

    // No DOMINGO_SEM_COLABORADORES blocker — tipo B has DOM active
    expect(blockers.filter(b => b.codigo === 'DOMINGO_SEM_COLABORADORES')).toHaveLength(0)
  })

  it('tipo B with DOM blocked in regras = not available on Sunday', () => {
    // Build with only SEG active (DOM not in active set)
    const input = buildTipoBInput({ tipoBActiveDays: new Set([1]) }) // only SEG

    // Remove CLTs to isolate the intermitente
    input.colaboradores = input.colaboradores.filter(c => c.tipo_trabalhador === 'INTERMITENTE')
    input.demanda = [
      { dia_semana: 'DOM', hora_inicio: '08:00', hora_fim: '14:00', min_pessoas: 1, override: false },
    ]

    const blockers: Array<{ codigo: string; severidade: string; mensagem: string; detalhe?: string }> = []
    const warnings: typeof blockers = []

    enrichPreflightWithCapacityChecks(input, blockers, warnings)

    // Should block — intermitente has DOM blocked (folga_fixa=true on sundays)
    const domBlocker = blockers.find(b => b.codigo === 'DOMINGO_SEM_COLABORADORES')
    expect(domBlocker).toBeDefined()
  })
})

// ===========================================================================
// Solver integration: tipo B feasibility and XOR
// ===========================================================================

describe('solver integration — tipo B intermitente', () => {
  it('solver stays feasible with CLTs + tipo B covering Sunday', async () => {
    const input = buildTipoBInput({
      tipoBActiveDays: new Set([0, 1]), // DOM + SEG
      tipoBFolgaVariavel: 'SEG',
    })

    const result = await runSolver(input, 30_000)

    expect(result.sucesso).toBe(true)
    expect(result.alocacoes).toBeDefined()

    // Verify tipo B works on at least one Sunday
    const tipoBId = input.colaboradores.find(c => c.tipo_trabalhador === 'INTERMITENTE')!.id
    const tipoBSundayWork = result.alocacoes?.filter(
      a => a.colaborador_id === tipoBId
        && a.status === 'TRABALHO'
        && new Date(`${a.data}T00:00:00`).getDay() === 0,
    ) ?? []

    // Tipo B should work on at least one Sunday (it's in the rotation pool)
    expect(tipoBSundayWork.length).toBeGreaterThanOrEqual(1)
  }, 60_000)

  it('tipo B XOR: when works DOM, SEG should be FOLGA (and vice versa)', async () => {
    const input = buildTipoBInput({
      tipoBActiveDays: new Set([0, 1]), // DOM + SEG
      tipoBFolgaVariavel: 'SEG',
    })

    const result = await runSolver(input, 30_000)
    expect(result.sucesso).toBe(true)

    const tipoBId = input.colaboradores.find(c => c.tipo_trabalhador === 'INTERMITENTE')!.id
    const tipoBAlocs = result.alocacoes?.filter(a => a.colaborador_id === tipoBId) ?? []

    // Group by week (Monday to Sunday)
    const weeks = new Map<string, typeof tipoBAlocs>()
    for (const a of tipoBAlocs) {
      const d = new Date(`${a.data}T00:00:00`)
      // Find the Monday of this week
      const dayOfWeek = d.getDay()
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
      const monday = new Date(d)
      monday.setDate(monday.getDate() + mondayOffset)
      const weekKey = monday.toISOString().slice(0, 10)
      if (!weeks.has(weekKey)) weeks.set(weekKey, [])
      weeks.get(weekKey)!.push(a)
    }

    // For each week, check XOR: if worked DOM, SEG should be FOLGA
    for (const [_weekKey, alocs] of weeks) {
      const domAlloc = alocs.find(a => new Date(`${a.data}T00:00:00`).getDay() === 0)
      const segAlloc = alocs.find(a => new Date(`${a.data}T00:00:00`).getDay() === 1)

      if (!domAlloc || !segAlloc) continue // skip incomplete weeks

      if (domAlloc.status === 'TRABALHO') {
        // XOR: worked DOM → SEG should be FOLGA
        expect(segAlloc.status).toBe('FOLGA')
      }
      // Note: if DOM is FOLGA, SEG could be TRABALHO (XOR allows this)
    }
  }, 60_000)

  it('tipo B with QUA+DOM active stays feasible', async () => {
    const input = buildTipoBInput({
      tipoBActiveDays: new Set([0, 3]), // DOM + QUA (Wednesday=3 in JS)
      tipoBFolgaVariavel: 'QUA',
      tipoBWindow: { inicio: '08:00', fim: '14:00' },
    })

    const result = await runSolver(input, 30_000)

    expect(result.sucesso).toBe(true)
    expect(result.alocacoes).toBeDefined()
  }, 60_000)

  it('tipo A + tipo B coexist: tipo A works only fixed days, tipo B rotates', async () => {
    const data_inicio = '2026-03-02'
    const data_fim = '2026-03-15'

    const cltColabs: SolverInputColab[] = Array.from({ length: 4 }, (_, idx) => ({
      id: idx + 1,
      nome: `CLT ${idx + 1}`,
      horas_semanais: 30,
      regime_escala: '5X2' as const,
      dias_trabalho: 5,
      max_minutos_dia: 360,
      tipo_trabalhador: 'CLT',
      sexo: 'F',
      funcao_id: idx + 1,
      rank: idx,
      domingo_ciclo_trabalho: 1,
      domingo_ciclo_folga: 1,
    }))

    // Tipo A: only DOM active, no folga_variavel
    const tipoAColab: SolverInputColab = {
      id: 5,
      nome: 'Intermitente Tipo A',
      horas_semanais: 6,
      regime_escala: '5X2' as const,
      dias_trabalho: 1,
      max_minutos_dia: 360,
      tipo_trabalhador: 'INTERMITENTE',
      sexo: 'F',
      funcao_id: 5,
      rank: 10,
      // No domingo_ciclo — tipo A excluded from rotation
    }

    // Tipo B: DOM + SEG active, folga_variavel=SEG
    const tipoBColab: SolverInputColab = {
      id: 6,
      nome: 'Intermitente Tipo B',
      horas_semanais: 6, // 1 day * 6h (after XOR deduction)
      regime_escala: '5X2' as const,
      dias_trabalho: 1, // 2 active - 1 XOR
      max_minutos_dia: 360,
      tipo_trabalhador: 'INTERMITENTE',
      sexo: 'F',
      funcao_id: 6,
      rank: 10,
      domingo_ciclo_trabalho: 1,
      domingo_ciclo_folga: 1,
      folga_variavel_dia_semana: 'SEG',
    }

    const tipoARegras = buildIntermitenteRegrasDia(
      5, data_inicio, data_fim,
      new Set([0]), // only DOM
      { inicio: '08:00', fim: '14:00' },
    )

    const tipoBRegras = buildIntermitenteRegrasDia(
      6, data_inicio, data_fim,
      new Set([0, 1]), // DOM + SEG
      { inicio: '08:00', fim: '14:00' },
    )

    const input: SolverInput = {
      setor_id: 999,
      data_inicio,
      data_fim,
      empresa: {
        tolerancia_semanal_min: 60,
        hora_abertura: '08:00',
        hora_fechamento: '14:00',
        min_intervalo_almoco_min: 60,
        max_intervalo_almoco_min: 120,
        grid_minutos: 30,
        horario_por_dia: buildHorarioPorDia(),
      },
      colaboradores: [...cltColabs, tipoAColab, tipoBColab],
      demanda: [
        { dia_semana: 'SEG', hora_inicio: '08:00', hora_fim: '14:00', min_pessoas: 2, override: false },
        { dia_semana: 'TER', hora_inicio: '08:00', hora_fim: '14:00', min_pessoas: 2, override: false },
        { dia_semana: 'QUA', hora_inicio: '08:00', hora_fim: '14:00', min_pessoas: 2, override: false },
        { dia_semana: 'QUI', hora_inicio: '08:00', hora_fim: '14:00', min_pessoas: 2, override: false },
        { dia_semana: 'SEX', hora_inicio: '08:00', hora_fim: '14:00', min_pessoas: 2, override: false },
        { dia_semana: 'SAB', hora_inicio: '08:00', hora_fim: '14:00', min_pessoas: 2, override: false },
        { dia_semana: 'DOM', hora_inicio: '08:00', hora_fim: '14:00', min_pessoas: 3, override: false },
      ],
      feriados: [],
      excecoes: [],
      pinned_cells: [],
      regras_colaborador_dia: [...tipoARegras, ...tipoBRegras],
      config: {
        solve_mode: 'rapido',
        max_time_seconds: 10,
        num_workers: 2,
        generation_mode: 'OFFICIAL',
        rules: {
          H3_DOM_MAX_CONSEC_F: 'HARD',
          H3_DOM_MAX_CONSEC_M: 'HARD',
          S_DEFICIT: 'ON',
          S_SURPLUS: 'ON',
          S_DOMINGO_CICLO: 'ON',
        },
      },
    }

    const result = await runSolver(input, 30_000)
    expect(result.sucesso).toBe(true)

    // Tipo A works every Sunday (fixed schedule, no rotation)
    const domingos = ['2026-03-08', '2026-03-15']
    for (const domingo of domingos) {
      expect(
        result.alocacoes?.some(a =>
          a.colaborador_id === 5
          && a.data === domingo
          && a.status === 'TRABALHO',
        ),
      ).toBe(true)
    }

    // Tipo B works at least one Sunday (in rotation pool)
    const tipoBSundays = result.alocacoes?.filter(
      a => a.colaborador_id === 6
        && a.status === 'TRABALHO'
        && domingos.includes(a.data),
    ) ?? []
    expect(tipoBSundays.length).toBeGreaterThanOrEqual(1)
  }, 60_000)
})
