import Database from 'better-sqlite3'
import { CLT, ANTIPATTERNS } from '../../shared'
import type {
  GerarEscalaInput, GerarEscalaOutput, EscalaCompletaV3,
  Setor, Demanda, Colaborador, Excecao, Alocacao, Escala, Funcao, Feriado,
  SetorHorarioSemana, Empresa, TipoContrato, Violacao, Indicadores,
  DecisaoMotor, SlotComparacao, AntipatternViolacao, PinnedCell,
} from '../../shared'
import {
  type ColabMotor,
  type CelulaMotor,
  type LookbackV3,
  type SlotGrid,
  type ValidarTudoParams,
  type CalcIndicadoresParams,
  diaSemana,
  isDomingo,
  timeToMin,
  minToTime,
  dateRange,
  getWeeks,
  calcMetaDiariaMin,
  celulaFolga,
  celulaIndisponivel,
  janelaOperacional,
  resolveDemandaSlot,
  isFeriadoProibido,
  isFeriadoSemCCT,
  isAprendiz,
  isEstagiario,
  minutosTrabalhoEfetivo,
  validarTudoV3,
  calcularScoreV3,
  calcularIndicadoresV3,
  gerarSlotComparacao,
  checkAP1_Clopening,
  checkAP3_LunchCollision,
  checkAP4_WorkloadImbalance,
  checkAP7_WeekendStarvation,
  checkAP15_PeakDayClustering,
  checkAP16_UnsupervisedJunior,
  checkAP2_ScheduleInstability,
  checkAP5_IsolatedDayOff,
  checkAP6_ShiftInequity,
  checkAP8_MealTimeDeviation,
  checkAP9_CommuteToWorkRatio,
  checkAP10_OverstaffingCost,
  checkS1_PrefereTurno,
  checkS2_EvitarDia,
  checkS3_EquilibrioAberturas,
  checkS4_FolgaPreferida,
  checkS5_ConsistenciaHorario,
} from './validacao-compartilhada'
import { runOptimizerV2 } from './optimizer-v2/orchestrator'
import { cloneResultadoMap, overwriteResultadoMap } from './optimizer-v2/utils'

// ─── Tipo interno: colaborador com dados do contrato (query JOIN) ──────────────

interface ColabComContrato extends Colaborador {
  horas_semanais: number
  dias_trabalho: number
  trabalha_domingo: boolean
  max_minutos_dia: number
  tipo_contrato_nome?: string
}

function readOptimizerBudgetMs(): number {
  const raw = process.env.ESCALAFLOW_OPTIMIZER_BUDGET_MS
  if (raw === '0') return 0  // explicitamente desabilitado
  const parsed = raw ? Number(raw) : NaN
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed)
  return 1200
}

function readOptimizerMaxIterations(): number {
  const raw = process.env.ESCALAFLOW_OPTIMIZER_MAX_ITERATIONS
  const parsed = raw ? Number(raw) : NaN
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed)
  return 96
}

// ─── MOTOR PRINCIPAL ─────────────────────────────────────────────────────────

/**
 * gerarEscalaV3 — Motor v3.1 — gera proposta de escala para um setor/período.
 *
 * Executa 8 fases (0-7) conforme RFC §6:
 *  0. Preflight — validações, queries, lookback, pinnedCells
 *  1. Grid de slots — janela operacional por dia, slot 30min
 *  2. Distribuir folgas — rodízio, H1, H3, H19, excecoes (TODO: subtask-2-3)
 *  3. Distribuir horas por dia — livre, demanda-proporcional (TODO: subtask-2-3)
 *  4. Alocar horários — grid 30min, descanso H2/H2b (TODO: subtask-2-4)
 *  5. Posicionar almoço — H6, AP3, H20 (TODO: subtask-2-4)
 *  6. Validar + backtrack — H1-H20, pinnedCells v3
 *  7. Pontuar + explicar + montar output (TODO: subtask-2-6)
 */
export function gerarEscalaV3(db: Database.Database, input: GerarEscalaInput): GerarEscalaOutput {
  const timing: Record<string, number> = {}
  // Dados extras do optimizer (nao-numericos) armazenados separadamente
  let otimNeighborhoods: Record<string, { attempts: number; accepted: number }> | undefined
  let otimTemperature: number | undefined
  let otimStagnation: number | undefined
  const t_total = performance.now()

  // ═══════════════════════════════════════════════════════════════════════════
  // FASE 0 — PREFLIGHT
  // ═══════════════════════════════════════════════════════════════════════════

  const t0 = performance.now()

  // ── 1. DB queries — buscar tudo que o motor precisa ──────────────────────

  const empresa = db.prepare('SELECT * FROM empresa LIMIT 1').get() as Empresa | undefined

  if (!empresa) {
    return {
      sucesso: false,
      erro: {
        tipo: 'PREFLIGHT',
        regra: 'EMPRESA_NAO_CONFIGURADA',
        mensagem: 'Empresa não encontrada. Configure a empresa antes de gerar escalas.',
        sugestoes: ['Acesse Configurações e preencha os dados da empresa.'],
      },
    }
  }

  const setor = db
    .prepare('SELECT * FROM setores WHERE id = ? AND ativo = 1')
    .get(input.setor_id) as Setor | undefined

  if (!setor) {
    return {
      sucesso: false,
      erro: {
        tipo: 'PREFLIGHT',
        regra: 'SETOR_INVALIDO',
        mensagem: `Setor ${input.setor_id} não encontrado ou inativo.`,
        sugestoes: ['Verifique se o setor está ativo no cadastro.'],
      },
    }
  }

  const horariosSemana = db
    .prepare('SELECT * FROM setor_horario_semana WHERE setor_id = ?')
    .all(input.setor_id) as SetorHorarioSemana[]

  const demandas = db
    .prepare('SELECT * FROM demandas WHERE setor_id = ?')
    .all(input.setor_id) as Demanda[]

  const colaboradoresRaw = db
    .prepare(
      `SELECT c.*, tc.horas_semanais, tc.dias_trabalho, tc.trabalha_domingo, tc.max_minutos_dia
       , tc.nome as tipo_contrato_nome
       FROM colaboradores c
       JOIN tipos_contrato tc ON c.tipo_contrato_id = tc.id
       WHERE c.setor_id = ? AND c.ativo = 1
       ORDER BY c.rank DESC`
    )
    .all(input.setor_id) as ColabComContrato[]

  if (colaboradoresRaw.length === 0) {
    return {
      sucesso: false,
      erro: {
        tipo: 'PREFLIGHT',
        regra: 'SEM_COLABORADORES',
        mensagem: `Nenhum colaborador ativo no setor "${setor.nome}".`,
        sugestoes: ['Cadastre colaboradores no setor antes de gerar a escala.'],
      },
    }
  }

  const excecoes = db
    .prepare(
      `SELECT * FROM excecoes
       WHERE colaborador_id IN (SELECT id FROM colaboradores WHERE setor_id = ? AND ativo = 1)
         AND data_fim >= ? AND data_inicio <= ?`
    )
    .all(input.setor_id, input.data_inicio, input.data_fim) as Excecao[]

  const feriados = db
    .prepare('SELECT * FROM feriados WHERE data BETWEEN ? AND ?')
    .all(input.data_inicio, input.data_fim) as Feriado[]

  const funcoes = db
    .prepare('SELECT * FROM funcoes WHERE setor_id = ? AND ativo = 1')
    .all(input.setor_id) as Funcao[]

  // ── 2. Build ColabMotor array ─────────────────────────────────────────────

  const colaboradores: ColabMotor[] = colaboradoresRaw.map(c => {
    const contratoNome = (c.tipo_contrato_nome ?? '').toUpperCase()
    const tipoPorContrato =
      contratoNome.includes('APRENDIZ') ? 'APRENDIZ'
      : contratoNome.includes('ESTAG') ? 'ESTAGIARIO'
      : 'CLT'
    const tipoDeclarado = (c.tipo_trabalhador as 'CLT' | 'ESTAGIARIO' | 'APRENDIZ' | null) ?? null
    const tipoEfetivo = (tipoDeclarado === 'CLT' && tipoPorContrato !== 'CLT')
      ? tipoPorContrato
      : (tipoDeclarado ?? tipoPorContrato)

    return {
      id: c.id,
      nome: c.nome,
      sexo: c.sexo as 'M' | 'F',
      tipo_trabalhador: tipoEfetivo,
      horas_semanais: c.horas_semanais,
      dias_trabalho: c.dias_trabalho,
      trabalha_domingo: c.trabalha_domingo,
      max_minutos_dia: c.max_minutos_dia,
      rank: c.rank ?? 5,
      prefere_turno: c.prefere_turno ?? null,
      evitar_dia_semana: c.evitar_dia_semana ?? null,
      funcao_id: c.funcao_id ?? null,
    }
  })

  // ── 3. Calcular dias e semanas ────────────────────────────────────────────

  const dias = dateRange(input.data_inicio, input.data_fim)
  const corteSemanal = empresa.corte_semanal ?? 'SEG_DOM'
  const semanas = getWeeks(dias, corteSemanal)

  // ── 4. Lookback: buscar escala OFICIAL anterior para continuidade ─────────

  const escalaAnterior = db
    .prepare(
      `SELECT * FROM escalas
       WHERE setor_id = ? AND status = 'OFICIAL' AND data_fim < ?
       ORDER BY data_fim DESC LIMIT 1`
    )
    .get(input.setor_id, input.data_inicio) as Escala | undefined

  const lookback = new Map<number, LookbackV3>()

  if (escalaAnterior) {
    const alocacoesAnteriores = db
      .prepare('SELECT * FROM alocacoes WHERE escala_id = ? ORDER BY data DESC')
      .all(escalaAnterior.id) as Alocacao[]

    for (const colab of colaboradores) {
      const alocColabRev = alocacoesAnteriores
        .filter(a => a.colaborador_id === colab.id)
        .sort((a, b) => b.data.localeCompare(a.data))

      let diasConsec = 0
      let domConsec = 0
      let ultimaHoraFim: string | null = null
      let domStreakDone = false

      for (const aloc of alocColabRev) {
        if (aloc.status === 'TRABALHO') {
          if (ultimaHoraFim === null) {
            // hora_fim pode vir de v3 (minutos_trabalho) ou v2 (hora_fim)
            ultimaHoraFim = aloc.hora_fim ?? null
          }
          diasConsec++
          if (!domStreakDone && isDomingo(aloc.data)) {
            domConsec++
          } else if (!isDomingo(aloc.data)) {
            domStreakDone = true // domingo streak só conta domingos consecutivos do fim
          }
        } else {
          // Encontrou não-TRABALHO — para a contagem de consecutivos
          if (diasConsec === 0) continue // leading non-TRABALHO, skip
          break
        }
      }

      lookback.set(colab.id, { diasConsec, domConsec, ultimaHoraFim })
    }
  }

  // Colaboradores sem lookback anterior → zerar
  for (const colab of colaboradores) {
    if (!lookback.has(colab.id)) {
      lookback.set(colab.id, { diasConsec: 0, domConsec: 0, ultimaHoraFim: null })
    }
  }

  // ── 5. PinnedCells: converter array → Map para lookup O(1) ───────────────

  const pinnedMap = new Map<string, PinnedCell>()
  for (const pin of (input.pinned_cells ?? [])) {
    pinnedMap.set(`${pin.colaborador_id}-${pin.data}`, pin)
  }

  const isPinned = (colabId: number, data: string): boolean =>
    pinnedMap.has(`${colabId}-${data}`)

  const getPinned = (colabId: number, data: string): PinnedCell | undefined =>
    pinnedMap.get(`${colabId}-${data}`)

  timing['fase0_ms'] = performance.now() - t0

  // ═══════════════════════════════════════════════════════════════════════════
  // FASE 1 — MONTAR GRID DE SLOTS
  // ═══════════════════════════════════════════════════════════════════════════

  const t1 = performance.now()

  const grid: SlotGrid[] = []

  // Inicializar resultado: Map<colabId, Map<data, CelulaMotor>>
  const resultado = new Map<number, Map<string, CelulaMotor>>()
  for (const colab of colaboradores) {
    resultado.set(colab.id, new Map())
  }

  for (const data of dias) {
    const janela = janelaOperacional(data, setor, horariosSemana)
    const feriadoProib = isFeriadoProibido(data, feriados)
    const feriadoSemCCT = isFeriadoSemCCT(data, feriados)
    const diaProibido = feriadoProib || feriadoSemCCT
    const diaClosed = janela === null

    // Inicializar célula de cada colaborador para este dia
    for (const colab of colaboradores) {
      const mapaColab = resultado.get(colab.id)!
      const pin = getPinned(colab.id, data)

      if (diaProibido) {
        // Dia proibido (feriado CCT) — todos INDISPONIVEL, ignorar pins
        mapaColab.set(data, celulaIndisponivel())
      } else if (diaClosed) {
        // Setor fechado neste dia — todos INDISPONIVEL
        mapaColab.set(data, celulaIndisponivel())
      } else {
        // Verificar exceção ativa para o colaborador neste dia
        const excecaoAtiva = excecoes.find(
          e => e.colaborador_id === colab.id && e.data_inicio <= data && e.data_fim >= data
        )

        if (excecaoAtiva && !pin) {
          // Exceção ativa sem pin → INDISPONIVEL com tipo da exceção
          const cel: CelulaMotor = {
            ...celulaIndisponivel(),
            status: excecaoAtiva.tipo as 'FERIAS' | 'ATESTADO' | 'INDISPONIVEL',
          }
          mapaColab.set(data, cel)
        } else if (pin) {
          // PinnedCell presente: permite forçar TRABALHO/FOLGA/INDISPONIVEL.
          const pinStatus = pin.status ?? 'TRABALHO'

          if (pinStatus === 'INDISPONIVEL') {
            mapaColab.set(data, celulaIndisponivel())
          } else if (pinStatus === 'FOLGA') {
            mapaColab.set(data, celulaFolga())
          } else {
            const cel: CelulaMotor = {
              status: 'FOLGA', // candidato a TRABALHO, promovido nas fases 2-4
              hora_inicio: pin.hora_inicio ?? null,
              hora_fim: pin.hora_fim ?? null,
              minutos: 0,
              minutos_trabalho: 0,
              hora_almoco_inicio: null,
              hora_almoco_fim: null,
              minutos_almoco: 0,
              intervalo_15min: false,
              funcao_id: colab.funcao_id,
            }
            mapaColab.set(data, cel)
          }
        } else {
          // Default: FOLGA — fases 2+ vão promover para TRABALHO conforme necessário
          mapaColab.set(data, celulaFolga())
        }
      }
    }

    // Gerar slots de 30min para este dia (só se aberto e não proibido)
    if (diaClosed || diaProibido) {
      // Dia fechado ou feriado proibido — sem slots operacionais.
      // gerarSlotComparacao só itera o grid, então dias sem slots são ignorados automaticamente.
      continue
    }

    // Janela aberta — gerar slots reais
    let slotStart = timeToMin(janela.abertura)
    const slotEnd = timeToMin(janela.fechamento)
    const diaLabel = diaSemana(data)

    while (slotStart + CLT.GRID_MINUTOS <= slotEnd) {
      const hora_inicio = minToTime(slotStart)
      const hora_fim = minToTime(slotStart + CLT.GRID_MINUTOS)

      const resolved = resolveDemandaSlot({
        demandas,
        dia: diaLabel,
        slotInicioMin: slotStart,
        slotFimMin: slotStart + CLT.GRID_MINUTOS,
      })

      grid.push({
        data,
        hora_inicio,
        hora_fim,
        target_planejado: resolved.target_planejado,
        override: resolved.override,
        dia_fechado: false,
        feriado_proibido: false,
      })

      slotStart += CLT.GRID_MINUTOS
    }
  }

  timing['fase1_ms'] = performance.now() - t1

  // ═══════════════════════════════════════════════════════════════════════════
  // FASE 2 — DISTRIBUIR FOLGAS
  // ═══════════════════════════════════════════════════════════════════════════

  const t2 = performance.now()

  // ── Helper: somar demanda total de um dia (sum de min_pessoas de todos os slots) ──
  const demandaTotalDia = new Map<string, number>()
  for (const data of dias) {
    const slotsNoDia = grid.filter(s => s.data === data)
    // Override entra com peso dobrado para priorizar cobertura quasi-hard.
    const total = slotsNoDia.reduce((acc, s) => acc + s.target_planejado + (s.override ? s.target_planejado : 0), 0)
    demandaTotalDia.set(data, total)
  }

  // ── Helper: retorna o índice (0-6) do dia da semana para ordenação ──
  function getDayIndex(data: string): number {
    return new Date(data + 'T12:00:00').getDay()
  }

  // ── Helper: retorna o dia anterior na lista de dias do período ──
  function getDayBefore(data: string, diasList: string[]): string | null {
    const idx = diasList.indexOf(data)
    return idx > 0 ? diasList[idx - 1] : null
  }

  // ── Estado de domingos consecutivos para uso em Fase 2 ──
  // Vamos rastrear quantos domingos consecutivos cada colab trabalhou (considerando lookback)
  const domConsecAtual = new Map<number, number>()
  for (const colab of colaboradores) {
    domConsecAtual.set(colab.id, lookback.get(colab.id)!.domConsec)
  }

  for (const semana of semanas) {
    // Contador de folgas já distribuídas por dia nesta semana.
    // Usado para desempatar e evitar concentração de folgas no mesmo dia.
    const folgasDistribuidasDia = new Map<string, number>()
    for (const d of semana) folgasDistribuidasDia.set(d, 0)

    // Dias da semana que são domingos
    const domingosDaSemana = semana.filter(d => isDomingo(d))

    for (const colab of colaboradores) {
      const mapaColab = resultado.get(colab.id)!

      // Calcular folgas necessárias: 7 - dias_trabalho
      // Mas só entre os dias disponíveis (não INDISPONIVEL) desta semana
      const diasDisponiveisSemana = semana.filter(d => {
        const cel = mapaColab.get(d)
        if (!cel || cel.status !== 'FOLGA') return false
        const pin = getPinned(colab.id, d)
        // Pins de FOLGA/INDISPONIVEL não podem virar trabalho.
        return pin?.status !== 'FOLGA' && pin?.status !== 'INDISPONIVEL'
      })

      const folgasPorSemana = 7 - colab.dias_trabalho
      // Quantas folgas já estão fixadas por INDISPONIVEL (não contam como folgas do colaborador)
      const diasIndisponiveis = semana.filter(d => {
        const cel = mapaColab.get(d)
        return cel && cel.status !== 'FOLGA'
      }).length

      // Folgas a atribuir: limitado pelos dias disponíveis
      const folgasAAtribuir = Math.min(folgasPorSemana, diasDisponiveisSemana.length)

      // ── Determinar quais dias DEVEM ser folga por obrigações HARD ──
      const folgasObrigatorias = new Set<string>()

      // H11: Aprendiz nunca domingo
      if (isAprendiz(colab)) {
        for (const dom of domingosDaSemana) {
          const cel = mapaColab.get(dom)
          if (cel && cel.status === 'FOLGA') {
            folgasObrigatorias.add(dom)
          }
        }
      }

      // H3/H3b: Rodízio de domingo
      for (const dom of domingosDaSemana) {
        const cel = mapaColab.get(dom)
        if (!cel || cel.status !== 'FOLGA') continue

        const maxConsec = colab.sexo === 'F'
          ? CLT.MAX_DOMINGOS_CONSECUTIVOS.F
          : CLT.MAX_DOMINGOS_CONSECUTIVOS.M

        const domConsec = domConsecAtual.get(colab.id) ?? 0
        if (domConsec >= maxConsec) {
          folgasObrigatorias.add(dom)
        }
      }

      // H1: Se colab já tem muitos dias consecutivos do lookback, pode precisar de folga cedo
      const diasConsecAtual = lookback.get(colab.id)!.diasConsec
      if (diasConsecAtual >= CLT.MAX_DIAS_CONSECUTIVOS) {
        // Forçar folga no primeiro dia disponível desta semana
        const primeiroDiaDisponivel = diasDisponiveisSemana[0]
        if (primeiroDiaDisponivel) {
          folgasObrigatorias.add(primeiroDiaDisponivel)
        }
      }

      // ── Candidatos para folga: ordenados por prioridade ──
      // 1. Folgas obrigatórias (HARD)
      // 2. Dias com menor demanda
      const candidatosOrdenados = [...diasDisponiveisSemana].sort((a, b) => {
        const aObrig = folgasObrigatorias.has(a) ? 0 : 1
        const bObrig = folgasObrigatorias.has(b) ? 0 : 1
        if (aObrig !== bObrig) return aObrig - bObrig
        // Menor demanda tem prioridade para folga
        const demA = demandaTotalDia.get(a) ?? 0
        const demB = demandaTotalDia.get(b) ?? 0
        if (demA !== demB) return demA - demB

        // Desempate: dia com menos folgas já distribuídas no setor.
        const folgasA = folgasDistribuidasDia.get(a) ?? 0
        const folgasB = folgasDistribuidasDia.get(b) ?? 0
        if (folgasA !== folgasB) return folgasA - folgasB

        // Último desempate determinístico por rotação (evita sempre cair no mesmo dia).
        const rotA = (getDayIndex(a) + colab.id) % 7
        const rotB = (getDayIndex(b) + colab.id) % 7
        return rotA - rotB
      })

      // ── Atribuir folgas ──
      // Respeitar pinnedCells: pin sem hora = TRABALHO obrigatório
      let folgasAtribuidas = 0
      const diasFolga = new Set<string>()

      for (const data of candidatosOrdenados) {
        if (folgasAtribuidas >= folgasAAtribuir) break

        // Pin de TRABALHO impede folga; FOLGA/INDISPONIVEL já foram filtrados antes.
        const pin = getPinned(colab.id, data)
        if (pin && pin.status !== 'FOLGA' && pin.status !== 'INDISPONIVEL') continue

        diasFolga.add(data)
        folgasAtribuidas++
        folgasDistribuidasDia.set(data, (folgasDistribuidasDia.get(data) ?? 0) + 1)
      }

      // Marcar células como FOLGA (as demais ficam como candidatas a TRABALHO)
      for (const data of semana) {
        const cel = mapaColab.get(data)
        if (!cel || cel.status !== 'FOLGA') continue // INDISPONIVEL: não mexer

        if (diasFolga.has(data)) {
          // Manter como FOLGA (já está FOLGA)
          // não precisa mudar
        } else {
          // Dia disponível não escolhido para folga → será TRABALHO (nas fases seguintes)
          // Por agora deixamos como FOLGA — Fase 3 vai marcar como TRABALHO
          // Usamos uma flag auxiliar: status 'FOLGA' com minutos > 0 indica candidato
          // Na verdade, vamos manter como FOLGA aqui e em Fase 3 só processamos dias NÃO-folga
          // Mas precisamos distinguir: dias marcados como folga real vs candidatos a trabalho
          // Estratégia: usar uma estrutura auxiliar de "dias de trabalho"
        }
      }

      // Armazenar quais dias são TRABALHO para este colab nesta semana
      // (todos os dias disponíveis que NÃO foram escolhidos como folga)
      const diasTrabalhoSemana = diasDisponiveisSemana.filter(d => !diasFolga.has(d))

      // Marcar os dias de trabalho com status provisório
      // (em Fase 3 vamos completar com minutos; aqui apenas distinguimos)
      for (const data of diasTrabalhoSemana) {
        const cel = mapaColab.get(data)!
        // Deixamos status como FOLGA por ora — Fase 3 vai promover para TRABALHO
        // Usamos minutos como flag: 0 = FOLGA real, -1 = candidato a TRABALHO
        cel.minutos = -1 // flag interna: será TRABALHO
      }

      // H19: Folga compensatória de domingo
      // Para cada domingo onde o colab VAI trabalhar nesta semana, verificar folga nos próximos 7 dias
      // Isso é resolvido parcialmente pelo folgasAAtribuir — o colab terá pelo menos folgasPorSemana folgas/semana
      // Verificação completa feita no validador; aqui garantimos a estrutura básica

      // Atualizar domConsecAtual para próxima semana
      let domConsecNovaSemana = domConsecAtual.get(colab.id) ?? 0
      for (const dom of domingosDaSemana) {
        const cel = mapaColab.get(dom)
        if (cel && cel.minutos === -1) {
          // Vai trabalhar domingo
          domConsecNovaSemana++
        } else {
          domConsecNovaSemana = 0
        }
      }
      domConsecAtual.set(colab.id, domConsecNovaSemana)
    }
  }

  // ── Post-processamento: verificar H1 (max 6 dias consecutivos) no período completo ──
  for (const colab of colaboradores) {
    const mapaColab = resultado.get(colab.id)!
    let consec = lookback.get(colab.id)!.diasConsec

    for (const data of dias) {
      const cel = mapaColab.get(data)
      if (!cel) continue

      const eCandidatoTrabalho = cel.status === 'FOLGA' && cel.minutos === -1
      const eIndisponivel = cel.status !== 'FOLGA'

      if (eCandidatoTrabalho) {
        consec++
        if (consec > CLT.MAX_DIAS_CONSECUTIVOS) {
          // Forçar folga: reverter para FOLGA real
          cel.minutos = 0

          // Encontrar o próximo dia que também é candidato e fazer TRABALHO
          // para manter o total de horas (compensação simplificada)
          consec = 0
        }
      } else if (eIndisponivel) {
        // INDISPONIVEL não conta como trabalho, mas também não zera consecutivos
        // (depende da interpretação — usamos: interrupção zera contagem)
        consec = 0
      } else {
        // FOLGA real
        consec = 0
      }
    }
  }

  timing['fase2_ms'] = performance.now() - t2

  // ═══════════════════════════════════════════════════════════════════════════
  // FASE 3 — DISTRIBUIR HORAS POR DIA
  // ═══════════════════════════════════════════════════════════════════════════

  const t3 = performance.now()

  for (const semana of semanas) {
    for (const colab of colaboradores) {
      const mapaColab = resultado.get(colab.id)!

      // Dias de trabalho desta semana: células com flag -1 (candidato a TRABALHO)
      const workDays = semana.filter(d => {
        const cel = mapaColab.get(d)
        return cel && cel.status === 'FOLGA' && cel.minutos === -1
      })

      if (workDays.length === 0) continue

      // ── Meta semanal proporcional ──
      // Mantém a mesma semântica do checkH10:
      // dias disponíveis na semana (exceto INDISPONIVEL) sobre 7 dias corridos.
      const totalMinutosMeta = colab.horas_semanais * 60
      const diasDisponiveis = semana.filter(d => {
        const cel = mapaColab.get(d)
        return cel && cel.status !== 'INDISPONIVEL'
      }).length
      const proporcao = diasDisponiveis / 7
      let metaSemanal = Math.round(totalMinutosMeta * proporcao)

      // Limitar pela capacidade máxima (max_minutos_dia * workDays)
      const maxSemana = isAprendiz(colab) || isEstagiario(colab)
        ? CLT.ESTAGIARIO_MAX_SEMANAL_MIN
        : colab.max_minutos_dia * workDays.length
      metaSemanal = Math.min(metaSemanal, maxSemana)

      // ── Demanda por dia de trabalho ──
      const demandaDia = new Map<string, number>()
      let totalDemanda = 0
      for (const data of workDays) {
        const dem = demandaTotalDia.get(data) ?? 0
        demandaDia.set(data, dem)
        totalDemanda += dem
      }

      // Se demanda total = 0, distribuir uniformemente
      if (totalDemanda === 0) {
        for (const data of workDays) {
          demandaDia.set(data, 1)
          totalDemanda += 1
        }
      }

      // ── Distribuição proporcional à demanda ──
      const workDaysSorted = [...workDays].sort((a, b) =>
        (demandaDia.get(b) ?? 0) - (demandaDia.get(a) ?? 0)
      )

      let minutosRestantes = metaSemanal
      const minutosAtribuidos = new Map<string, number>()

      for (let i = 0; i < workDaysSorted.length; i++) {
        const data = workDaysSorted[i]
        const diasRestantes = workDaysSorted.length - i
        let minutos: number

        if (diasRestantes === 1) {
          // Último dia: atribuir o restante
          minutos = minutosRestantes
        } else {
          const dem = demandaDia.get(data) ?? 0
          const propDia = dem / totalDemanda
          minutos = Math.round(metaSemanal * propDia)
        }

        // ── Aplicar limites ──
        // Min 4h por dia
        minutos = Math.max(CLT.MIN_JORNADA_DIA_MIN, minutos)

        // Limites especiais: estagiário/aprendiz
        if (isAprendiz(colab) || isEstagiario(colab)) {
          minutos = Math.min(CLT.ESTAGIARIO_MAX_JORNADA_MIN, minutos)
        } else {
          minutos = Math.min(colab.max_minutos_dia, minutos)
        }

        // ── GUARD: Cliff Súmula 437 — NUNCA 361-389min ──
        // Com grid 30min é impossível (360 ou 390), mas guardamos por segurança
        if (minutos > 360 && minutos < 390) {
          minutos = 360
        }

        // ── Arredondar para múltiplo de 30min ──
        minutos = Math.round(minutos / CLT.GRID_MINUTOS) * CLT.GRID_MINUTOS
        // Reaplicar cliff guard após arredondamento
        if (minutos > 360 && minutos < 390) minutos = 360

        // ── Verificar se há pin com hora_inicio e hora_fim ──
        const pin = getPinned(colab.id, data)
        if (pin?.hora_inicio && pin?.hora_fim) {
          // Pin com horário fixo → usar duração do pin
          minutos = timeToMin(pin.hora_fim) - timeToMin(pin.hora_inicio)
          if (minutos <= 0) minutos = CLT.MIN_JORNADA_DIA_MIN
          // Arredondar para 30min
          minutos = Math.round(minutos / CLT.GRID_MINUTOS) * CLT.GRID_MINUTOS
          if (minutos <= 0) minutos = CLT.GRID_MINUTOS
        }

        minutosAtribuidos.set(data, minutos)
        minutosRestantes -= minutos
      }

      // ── Atribuir minutos às células e marcar como TRABALHO ──
      for (const data of workDays) {
        const cel = mapaColab.get(data)!
        const minutos = minutosAtribuidos.get(data) ?? CLT.MIN_JORNADA_DIA_MIN

        cel.status = 'TRABALHO'
        cel.minutos = minutos
        cel.minutos_trabalho = minutos

        // ── Flags de intervalo ──
        if (minutos > CLT.LIMIAR_ALMOCO_MIN) {
          // > 6h → almoço obrigatório (será posicionado na Fase 5)
          cel.hora_almoco_inicio = null // placeholder
          cel.intervalo_15min = false
        } else if (minutos > CLT.LIMIAR_INTERVALO_CURTO_MIN) {
          // > 4h e ≤ 6h → intervalo 15min
          cel.intervalo_15min = true
          cel.hora_almoco_inicio = null
        } else {
          // ≤ 4h → nenhum intervalo
          cel.intervalo_15min = false
          cel.hora_almoco_inicio = null
        }
      }

      // ── Dias de FOLGA real: garantir flag limpa ──
      for (const data of semana) {
        const cel = mapaColab.get(data)
        if (!cel) continue
        if (cel.status === 'FOLGA' && cel.minutos === -1) {
          // Flag interna que não foi marcada como TRABALHO → manter como FOLGA
          cel.minutos = 0
        }
      }
    }
  }

  // Limpar qualquer flag -1 residual (dias fora das semanas processadas)
  for (const colab of colaboradores) {
    const mapaColab = resultado.get(colab.id)!
    for (const data of dias) {
      const cel = mapaColab.get(data)
      if (cel && cel.status === 'FOLGA' && cel.minutos === -1) {
        cel.minutos = 0
      }
    }
  }

  timing['fase3_ms'] = performance.now() - t3

  // ═══════════════════════════════════════════════════════════════════════════
  // FASE 4 — ALOCAR HORÁRIOS
  // ═══════════════════════════════════════════════════════════════════════════

  const t4 = performance.now()

  // Pré-computar janela operacional por data para evitar chamadas repetidas
  const janelaPorData = new Map<string, { abertura: string; fechamento: string } | null>()
  for (const data of dias) {
    janelaPorData.set(data, janelaOperacional(data, setor, horariosSemana))
  }

  for (const colab of colaboradores) {
    const mapaColab = resultado.get(colab.id)!
    // Rastrear hora_fim do dia anterior trabalhado (para H2)
    let horaFimAnterior: string | null = lookback.get(colab.id)!.ultimaHoraFim

    for (const data of dias) {
      const cel = mapaColab.get(data)
      if (!cel || cel.status !== 'TRABALHO') {
        // Dia não trabalhado: não atualiza hora_fim
        if (cel && cel.status !== 'TRABALHO') {
          horaFimAnterior = null // folga/indisponível zera o descanso
        }
        continue
      }

      // ── Verificar pin com horários fixos ──
      const pin = getPinned(colab.id, data)
      if (pin?.hora_inicio && pin?.hora_fim) {
        cel.hora_inicio = pin.hora_inicio
        cel.hora_fim = pin.hora_fim
        horaFimAnterior = cel.hora_fim
        continue
      }

      // ── Determinar janela operacional do dia ──
      const janela = janelaPorData.get(data)
      const aberturaMin = janela ? timeToMin(janela.abertura) : timeToMin(setor.hora_abertura)

      // ── Calcular início mais cedo possível (H2: descanso 11h) ──
      let earliestStart = aberturaMin

      if (horaFimAnterior !== null) {
        const fimOntemMin = timeToMin(horaFimAnterior)
        // Descanso mínimo entre jornadas: fim de ontem + 660min, considerando virada de dia
        // fimOntem + descanso - 1440 = início mínimo de hoje (se resultado < 0, qualquer hora serve)
        const minStartFromRest = fimOntemMin + CLT.MIN_DESCANSO_ENTRE_JORNADAS_MIN - 1440
        if (minStartFromRest > earliestStart) {
          earliestStart = minStartFromRest
        }
      }

      // ── Arredondar para próximo múltiplo de 30min (H8) ──
      let startMin = Math.ceil(earliestStart / CLT.GRID_MINUTOS) * CLT.GRID_MINUTOS

      // ── H13: Aprendiz nunca noturno (22:00-05:00) ──
      if (isAprendiz(colab)) {
        const noturnoInicio = timeToMin(CLT.APRENDIZ_HORARIO_NOTURNO_INICIO) // 22:00 = 1320
        const noturnoFim = timeToMin(CLT.APRENDIZ_HORARIO_NOTURNO_FIM)       // 05:00 = 300
        // Garantir que começa após 05:00
        if (startMin < noturnoFim) {
          startMin = Math.ceil(noturnoFim / CLT.GRID_MINUTOS) * CLT.GRID_MINUTOS
        }
      }

      const endMin = startMin + cel.minutos_trabalho

      // ── H13: Aprendiz não pode terminar após 22:00 ──
      if (isAprendiz(colab)) {
        const noturnoInicio = timeToMin(CLT.APRENDIZ_HORARIO_NOTURNO_INICIO)
        if (endMin > noturnoInicio) {
          // Deslocar para caber antes das 22:00
          const noturnoFimMin = timeToMin(CLT.APRENDIZ_HORARIO_NOTURNO_FIM) // 05:00
          const newStart = noturnoInicio - cel.minutos_trabalho
          const newStartRounded = Math.floor(newStart / CLT.GRID_MINUTOS) * CLT.GRID_MINUTOS
          startMin = Math.max(noturnoFimMin, newStartRounded)
        }
      }

      cel.hora_inicio = minToTime(startMin)
      // hora_fim provisória sem almoço — Fase 5 vai ajustar se tiver almoço
      cel.hora_fim = minToTime(startMin + cel.minutos_trabalho)
      horaFimAnterior = cel.hora_fim
    }
  }

  timing['fase4_ms'] = performance.now() - t4

  // ═══════════════════════════════════════════════════════════════════════════
  // FASE 5 — POSICIONAR ALMOÇO
  // ═══════════════════════════════════════════════════════════════════════════

  const t5 = performance.now()

  // Duração do almoço baseada na config da empresa
  const minAlmoco = empresa.usa_cct_intervalo_reduzido
    ? CLT.ALMOCO_MIN_CCT_MIN   // 30min (CCT FecomercioSP)
    : CLT.ALMOCO_MIN_CLT_MIN   // 60min (CLT padrão)
  // Garantir mínimo absoluto de 30min
  const minAlmocoEfetivo = Math.max(minAlmoco, CLT.ALMOCO_MIN_CCT_MIN)

  // Rastrear uso de slots de almoço por dia (para AP3: escalonamento)
  const almocosPorSlot = new Map<string, number>() // `${data}-${horaInicio}` → count

  for (const data of dias) {
    // Contar quantos colaboradores precisam de almoço neste dia (para AP3)
    let totalComAlmoco = 0
    for (const colab of colaboradores) {
      const cel = resultado.get(colab.id)!.get(data)
      if (cel?.status === 'TRABALHO' && cel.minutos_trabalho > CLT.LIMIAR_ALMOCO_MIN) {
        totalComAlmoco++
      }
    }

    const maxSimultaneo = Math.ceil(totalComAlmoco * (ANTIPATTERNS.ALMOCO_MAX_SIMULTANEO_PERCENT / 100))

    for (const colab of colaboradores) {
      const mapaColab = resultado.get(colab.id)!
      const cel = mapaColab.get(data)
      if (!cel || cel.status !== 'TRABALHO') continue

      if (cel.minutos_trabalho > CLT.LIMIAR_ALMOCO_MIN) {
        // ── Almoço obrigatório (H6) ──
        const inicioMin = timeToMin(cel.hora_inicio!)
        const fimTurnoComAlmoco = inicioMin + cel.minutos_trabalho + minAlmocoEfetivo

        // Ajustar hora_fim para incluir o tempo de almoço
        cel.hora_fim = minToTime(fimTurnoComAlmoco)

        // ── Posicionar almoço (H20: min 2h antes e 2h depois) ──
        const janelAlmocoIdealInicio = timeToMin(ANTIPATTERNS.ALMOCO_HORARIO_IDEAL_INICIO) // 11:00
        const janelAlmocoIdealFim = timeToMin(ANTIPATTERNS.ALMOCO_HORARIO_IDEAL_FIM)       // 13:30

        // Mais cedo possível: 2h após início do turno
        const earliestAlmoco = inicioMin + 120
        // Mais tarde possível: 2h antes do fim do turno (excluindo almoço)
        const latestAlmoco = fimTurnoComAlmoco - minAlmocoEfetivo - 120

        // Posição desejada: dentro da janela ideal ou o mais próximo dela
        let almocoStart = Math.max(earliestAlmoco, janelAlmocoIdealInicio)
        almocoStart = Math.min(almocoStart, Math.min(latestAlmoco, janelAlmocoIdealFim))

        // Garantir limites absolutos de H20
        almocoStart = Math.max(almocoStart, earliestAlmoco)
        almocoStart = Math.min(almocoStart, latestAlmoco)

        // ── Arredondar para múltiplo de 30min ──
        almocoStart = Math.round(almocoStart / CLT.GRID_MINUTOS) * CLT.GRID_MINUTOS

        // ── AP3: Escalonamento — max 50% do setor no mesmo slot ──
        const slotKey = `${data}-${minToTime(almocoStart)}`
        const countHere = almocosPorSlot.get(slotKey) ?? 0
        if (countHere >= maxSimultaneo && totalComAlmoco > 1) {
          // Tentar empurrar 30min à frente
          const almocoStartShifted = almocoStart + CLT.GRID_MINUTOS
          const slotKeyShifted = `${data}-${minToTime(almocoStartShifted)}`
          const countShifted = almocosPorSlot.get(slotKeyShifted) ?? 0

          // Só deslocar se ainda respeita H20 (2h antes e 2h depois)
          if (almocoStartShifted <= latestAlmoco && countShifted < maxSimultaneo) {
            almocoStart = almocoStartShifted
          }
          // Se não conseguir deslocar, mantém o slot original (AP3 é penalidade, não HARD)
        }

        const almocoFim = almocoStart + minAlmocoEfetivo

        cel.hora_almoco_inicio = minToTime(almocoStart)
        cel.hora_almoco_fim = minToTime(almocoFim)
        cel.minutos_almoco = minAlmocoEfetivo

        // Registrar uso do slot
        const slotKeyFinal = `${data}-${minToTime(almocoStart)}`
        almocosPorSlot.set(slotKeyFinal, (almocosPorSlot.get(slotKeyFinal) ?? 0) + 1)

      } else if (cel.minutos_trabalho > CLT.LIMIAR_INTERVALO_CURTO_MIN) {
        // ── > 4h e ≤ 6h: intervalo 15min (H7) ──
        // hora_fim já está correta (sem almoço)
        cel.intervalo_15min = true
        cel.hora_almoco_inicio = null
        cel.hora_almoco_fim = null
        cel.minutos_almoco = 0
      } else {
        // ── ≤ 4h: sem intervalo (H7b) ──
        cel.intervalo_15min = false
        cel.hora_almoco_inicio = null
        cel.hora_almoco_fim = null
        cel.minutos_almoco = 0
      }
    }
  }

  timing['fase5_ms'] = performance.now() - t5

  // ═══════════════════════════════════════════════════════════════════════════
  // FASE 6 — VALIDAR + BACKTRACK + PINNEDCELLS v3
  // ═══════════════════════════════════════════════════════════════════════════

  const t6 = performance.now()

  // ── PinnedCells preprocessing: remover pins que violam regras HARD ─────────
  // Feito ANTES do loop de backtrack. Pins inválidos não participam da correção.
  const removedPins: DecisaoMotor[] = []

  for (const [key, pin] of pinnedMap.entries()) {
    const colab = colaboradores.find(c => c.id === pin.colaborador_id)
    if (!colab) continue

    const cel = resultado.get(pin.colaborador_id)?.get(pin.data)
    if (!cel) continue

    // H11: Aprendiz NUNCA domingo — remover pin que força TRABALHO
    if (isAprendiz(colab) && isDomingo(pin.data) && cel.status === 'TRABALHO') {
      resultado.get(pin.colaborador_id)!.set(pin.data, celulaFolga())
      removedPins.push({
        colaborador_id: pin.colaborador_id,
        colaborador_nome: colab.nome,
        data: pin.data,
        acao: 'REMOVIDO',
        razao: `Pin removido: ${colab.nome} é aprendiz e não pode trabalhar aos domingos (H11 — CLT Art. 432)`,
        alternativas_tentadas: 0,
      })
      pinnedMap.delete(key)
      continue
    }

    // H5: Exceção ativa (férias/atestado/bloqueio) — remover pin que força TRABALHO
    const excecaoAtiva = excecoes.find(
      e => e.colaborador_id === pin.colaborador_id && e.data_inicio <= pin.data && e.data_fim >= pin.data
    )
    if (excecaoAtiva && cel.status === 'TRABALHO') {
      const statusExcecao = excecaoAtiva.tipo === 'FERIAS'
        ? 'FERIAS'
        : excecaoAtiva.tipo === 'ATESTADO'
        ? 'ATESTADO'
        : 'INDISPONIVEL'
      resultado.get(pin.colaborador_id)!.set(pin.data, {
        ...celulaIndisponivel(),
        status: statusExcecao,
      })
      removedPins.push({
        colaborador_id: pin.colaborador_id,
        colaborador_nome: colab.nome,
        data: pin.data,
        acao: 'REMOVIDO',
        razao: `Pin removido: ${colab.nome} tem exceção ativa (${excecaoAtiva.tipo}) em ${pin.data} e não pode ser alocado`,
        alternativas_tentadas: 0,
      })
      pinnedMap.delete(key)
      continue
    }

    // H17: Feriado proibido (25/12 e 01/01) — remover pin que força TRABALHO
    if (isFeriadoProibido(pin.data, feriados) && cel.status === 'TRABALHO') {
      resultado.get(pin.colaborador_id)!.set(pin.data, celulaIndisponivel())
      removedPins.push({
        colaborador_id: pin.colaborador_id,
        colaborador_nome: colab.nome,
        data: pin.data,
        acao: 'REMOVIDO',
        razao: `Pin removido: ${pin.data} é feriado proibido pelo CCT FecomercioSP (H17)`,
        alternativas_tentadas: 0,
      })
      pinnedMap.delete(key)
      continue
    }

    // H18: Feriado sem autorização CCT — remover pin que força TRABALHO
    if (isFeriadoSemCCT(pin.data, feriados) && cel.status === 'TRABALHO') {
      resultado.get(pin.colaborador_id)!.set(pin.data, celulaIndisponivel())
      removedPins.push({
        colaborador_id: pin.colaborador_id,
        colaborador_nome: colab.nome,
        data: pin.data,
        acao: 'REMOVIDO',
        razao: `Pin removido: ${pin.data} é feriado sem autorização CCT (H18)`,
        alternativas_tentadas: 0,
      })
      pinnedMap.delete(key)
      continue
    }

    // H12: Aprendiz NUNCA feriado (qualquer feriado) — remover pin
    if (isAprendiz(colab) && feriados.some(f => f.data === pin.data) && cel.status === 'TRABALHO') {
      resultado.get(pin.colaborador_id)!.set(pin.data, celulaIndisponivel())
      removedPins.push({
        colaborador_id: pin.colaborador_id,
        colaborador_nome: colab.nome,
        data: pin.data,
        acao: 'REMOVIDO',
        razao: `Pin removido: ${colab.nome} é aprendiz e não pode trabalhar em feriados (H12 — CLT Art. 432)`,
        alternativas_tentadas: 0,
      })
      pinnedMap.delete(key)
    }
  }

  // ── Backtrack loop (max 3 iterações, greedy) ────────────────────────────────
  const validarParams: ValidarTudoParams = {
    colaboradores,
    resultado,
    demandas,
    dias,
    feriados,
    excecoes,
    lookback,
    tolerancia_min: empresa.tolerancia_semanal_min ?? 30,
    empresa,
    corte_semanal: corteSemanal,
  }

  let hardViolacoes: Violacao[] = []
  let backtrackAttempts = 0
  const MAX_BACKTRACK = 256
  const h1LockedFolgas = new Set<string>()

  do {
    const hardBase = validarTudoV3(validarParams).filter(v => v.severidade === 'HARD')
    hardViolacoes = [...hardBase]

    if (hardViolacoes.length === 0) break

    // Tentar corrigir as violações detectadas
    let fixedAny = false
    for (const violacao of hardViolacoes) {
      const fixed = tryFixViolation(
        violacao,
        colaboradores,
        resultado,
        dias,
        lookback,
        pinnedMap,
        feriados,
        h1LockedFolgas,
      )
      if (fixed) fixedAny = true
    }

    if (!fixedAny) break // Não conseguiu corrigir nenhuma — desistir
    backtrackAttempts++
  } while (backtrackAttempts < MAX_BACKTRACK)

  // Se ainda há violações HARD após o backtrack → falha com erro explicativo
  if (hardViolacoes.length > 0) {
    const firstViol = hardViolacoes[0]
    timing['fase6_ms'] = performance.now() - t6
    timing['fase7_ms'] = 0
    timing['total_ms'] = performance.now() - t_total
    return {
      sucesso: false,
      erro: {
        tipo: 'CONSTRAINT',
        regra: firstViol.regra,
        mensagem: firstViol.mensagem,
        sugestoes: [
          'Verifique se há colaboradores suficientes para cobrir a demanda.',
          'Considere ajustar as restrições de contrato.',
          'Revise as exceções ativas no período.',
        ],
        colaborador_id: firstViol.colaborador_id ?? undefined,
        data: firstViol.data ?? undefined,
      },
    }
  }

  timing['fase6_ms'] = performance.now() - t6

  // ── FASE 6.5 — OTIMIZACAO ANYTIME (v2) ───────────────────────────────────
  // Executa busca local com objetivo lexicográfico:
  // HARD > override deficit > deficit total > excesso.
  // Guardrail: se qualquer violação HARD surgir após otimização, reverte.

  const t65 = performance.now()
  const optimizerBudget = readOptimizerBudgetMs()

  if (optimizerBudget > 0) {
    const resultadoAntesOtim = cloneResultadoMap(resultado)

    const otimResult = runOptimizerV2({
      resultado,
      colaboradores,
      grid,
      dias,
      demandas,
      feriados,
      excecoes,
      lookback,
      empresa,
      corteSemanal,
      pinnedMap,
      maxMs: optimizerBudget,
      maxIterations: readOptimizerMaxIterations(),
    })
    timing['otimizacao_ms'] = otimResult.elapsedMs
    timing['otimizacao_moves'] = otimResult.acceptedMoves
    otimNeighborhoods = otimResult.neighborhoods
    otimTemperature = otimResult.temperatureFinal
    otimStagnation = otimResult.stagnationEvents

    const hardAfterOtim = validarTudoV3(validarParams).filter(v => v.severidade === 'HARD')
    if (hardAfterOtim.length > 0) {
      overwriteResultadoMap(resultado, resultadoAntesOtim)
    }
  }

  timing['fase6_ms'] += performance.now() - t65

  // ═══════════════════════════════════════════════════════════════════════════
  // FASE 7 — PONTUAR E EXPLICAR
  // ═══════════════════════════════════════════════════════════════════════════

  const t7 = performance.now()

  const allAntipatterns: AntipatternViolacao[] = []

  // ── Tier 1: 6 APs graves — per-colab ─────────────────────────────────────

  for (const colab of colaboradores) {
    const diasOrdered: Array<[string, CelulaMotor]> = dias
      .map(d => [d, resultado.get(colab.id)!.get(d)!] as [string, CelulaMotor])
      .filter(([, cel]) => cel !== undefined)

    allAntipatterns.push(...checkAP1_Clopening(colab, diasOrdered))
    allAntipatterns.push(...checkAP7_WeekendStarvation(colab, semanas, resultado))
  }

  // ── Tier 1: cross-colab APs ───────────────────────────────────────────────

  allAntipatterns.push(...checkAP4_WorkloadImbalance(colaboradores, resultado, dias))
  allAntipatterns.push(...checkAP15_PeakDayClustering(dias, demandas, resultado, colaboradores))

  // ── Tier 1: per-day APs (AP3 is per-day, AP16 is per-slot) ──────────────

  for (const data of dias) {
    // AP3 — Lunch Collision (per-day, call once per day)
    allAntipatterns.push(...checkAP3_LunchCollision(data, colaboradores, resultado))

    // AP16 — Unsupervised Junior (per-slot within the day)
    const slotsNoDia = grid.filter(s => s.data === data)
    for (const slot of slotsNoDia) {
      allAntipatterns.push(...checkAP16_UnsupervisedJunior(data, slot, colaboradores, resultado))
    }
  }

  // ── Calcular score parcial Tier 1 ────────────────────────────────────────

  const tier1APs = allAntipatterns.filter(ap => ap.tier === 1)
  const partialScore = calcularScoreV3(tier1APs, 0)

  // ── Reoptimização simples se score < 60 após Tier 1 ─────────────────────
  // Heurística: se há AP1 (clopening), empurrar hora_inicio 30min para frente
  // para aumentar o descanso entre jornadas sem revalidar HARD completo.

  if (partialScore < 60) {
    const clopenings = tier1APs.filter(ap => ap.antipattern === 'AP1')
    for (const clop of clopenings.slice(0, 3)) {
      if (!clop.colaborador_id || !clop.data) continue
      const cel = resultado.get(clop.colaborador_id)?.get(clop.data)
      if (!cel || cel.status !== 'TRABALHO' || !cel.hora_inicio || !cel.hora_fim) continue
      // Verificar que não é uma célula pinada
      if (pinnedMap.has(`${clop.colaborador_id}-${clop.data}`)) continue

      // Empurrar início 30min para frente (melhora descanso do dia anterior)
      const newStart = timeToMin(cel.hora_inicio) + CLT.GRID_MINUTOS
      const newEnd = newStart + cel.minutos_trabalho
      // Ajustar almoço se houver
      if (cel.hora_almoco_inicio && cel.minutos_almoco > 0) {
        const almocoStart = timeToMin(cel.hora_almoco_inicio) + CLT.GRID_MINUTOS
        cel.hora_almoco_inicio = minToTime(almocoStart)
        cel.hora_almoco_fim = minToTime(almocoStart + cel.minutos_almoco)
        cel.hora_fim = minToTime(newEnd + cel.minutos_almoco)
      } else {
        cel.hora_fim = minToTime(newEnd)
      }
      cel.hora_inicio = minToTime(newStart)
    }
  }

  // ── Tier 2: 6 APs moderados — per-colab ──────────────────────────────────

  for (const colab of colaboradores) {
    const diasOrdered: Array<[string, CelulaMotor]> = dias
      .map(d => [d, resultado.get(colab.id)!.get(d)!] as [string, CelulaMotor])
      .filter(([, cel]) => cel !== undefined)

    allAntipatterns.push(...checkAP2_ScheduleInstability(colab, diasOrdered))
    allAntipatterns.push(...checkAP5_IsolatedDayOff(colab, diasOrdered))
    allAntipatterns.push(...checkAP8_MealTimeDeviation(colab, diasOrdered))
    allAntipatterns.push(...checkAP9_CommuteToWorkRatio(colab, diasOrdered))
  }

  // ── Tier 2: cross-colab APs ───────────────────────────────────────────────

  allAntipatterns.push(...checkAP6_ShiftInequity(colaboradores, resultado, dias))

  // ── Tier 2: per-slot AP10 ────────────────────────────────────────────────

  for (const data of dias) {
    const slotsNoDia = grid.filter(s => s.data === data)
    for (const slot of slotsNoDia) {
      allAntipatterns.push(...checkAP10_OverstaffingCost(data, slot, demandas, resultado, colaboradores))
    }
  }

  // ── SOFT scoring (S1-S5) ─────────────────────────────────────────────────

  let softPenalty = 0

  for (const colab of colaboradores) {
    const diasOrdered: Array<[string, CelulaMotor]> = dias
      .map(d => [d, resultado.get(colab.id)!.get(d)!] as [string, CelulaMotor])
      .filter(([, cel]) => cel !== undefined)

    softPenalty += checkS1_PrefereTurno(colab, diasOrdered)
    softPenalty += checkS2_EvitarDia(colab, diasOrdered)
    softPenalty += checkS4_FolgaPreferida(colab, diasOrdered)
    softPenalty += checkS5_ConsistenciaHorario(colab, diasOrdered)
  }

  softPenalty += checkS3_EquilibrioAberturas(colaboradores, resultado, dias)

  // ── Score final ───────────────────────────────────────────────────────────

  const pontuacao = calcularScoreV3(allAntipatterns, softPenalty)

  // ── Indicadores ───────────────────────────────────────────────────────────

  const violacoes = [
    ...validarTudoV3(validarParams),
  ]

  const indicadores = calcularIndicadoresV3({
    colaboradores,
    resultado,
    demandas,
    dias,
    violacoes,
    antipatterns: allAntipatterns,
    softPenalty,
    grid,
  })

  // ── DecisaoMotor[] ────────────────────────────────────────────────────────
  // Começar com pins removidos (já tem acao='REMOVIDO') + decisões por colab-dia

  const decisoes: DecisaoMotor[] = [...removedPins]

  for (const colab of colaboradores) {
    const mapaColab = resultado.get(colab.id)!
    for (const data of dias) {
      const cel = mapaColab.get(data)
      if (!cel) continue

      let acao: DecisaoMotor['acao']
      let razao: string

      if (cel.status === 'TRABALHO') {
        acao = 'ALOCADO'
        razao = cel.hora_inicio && cel.hora_fim
          ? `${colab.nome} alocado: ${cel.hora_inicio}-${cel.hora_fim} (${cel.minutos_trabalho}min efetivos)`
          : `${colab.nome} alocado em ${data}`
      } else if (cel.status === 'FOLGA') {
        acao = 'FOLGA'
        razao = `${colab.nome} — folga programada em ${data}`
      } else {
        // INDISPONIVEL, FERIAS, ATESTADO — todos mapeiam para FOLGA no AcaoMotor
        // (não há acao='INDISPONIVEL' no enum — FOLGA é a acao mais próxima para RH)
        acao = 'FOLGA'
        razao = cel.status === 'FERIAS'
          ? `${colab.nome} — em férias em ${data}`
          : cel.status === 'ATESTADO'
          ? `${colab.nome} — atestado médico em ${data}`
          : `${colab.nome} — indisponível em ${data}`
      }

      decisoes.push({
        colaborador_id: colab.id,
        colaborador_nome: colab.nome,
        data,
        acao,
        razao,
        alternativas_tentadas: 0,
      })
    }
  }

  // ── SlotComparacao[] ──────────────────────────────────────────────────────

  const comparacaoDemanda = gerarSlotComparacao({
    grid,
    colaboradores,
    resultado,
    dias,
  })

  timing['fase7_ms'] = performance.now() - t7
  timing['total_ms'] = performance.now() - t_total

  // ═══════════════════════════════════════════════════════════════════════════
  // MONTAR OUTPUT FINAL
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Converter Map<colabId, Map<data, CelulaMotor>> → Alocacao[] ──────────

  const alocacoes: Alocacao[] = []

  for (const colab of colaboradores) {
    const mapaColab = resultado.get(colab.id)!
    for (const [data, cel] of mapaColab.entries()) {
      // Mapear TipoStatus → StatusAlocacao (FERIAS e ATESTADO → INDISPONIVEL para compat v2)
      const statusAlocacao = (cel.status === 'TRABALHO' || cel.status === 'FOLGA' || cel.status === 'INDISPONIVEL')
        ? cel.status
        : 'INDISPONIVEL' as const

      alocacoes.push({
        id: 0,                                        // placeholder — IPC preenche ao persistir
        escala_id: 0,                                 // placeholder — IPC preenche ao persistir
        colaborador_id: colab.id,
        data,
        status: statusAlocacao,
        hora_inicio: cel.hora_inicio,
        hora_fim: cel.hora_fim,
        minutos: cel.minutos_trabalho,                // compat v2 — igual a minutos_trabalho
        minutos_trabalho: cel.minutos_trabalho,       // v3: tempo efetivo SEM almoço
        hora_almoco_inicio: cel.hora_almoco_inicio,
        hora_almoco_fim: cel.hora_almoco_fim,
        minutos_almoco: cel.minutos_almoco,
        intervalo_15min: cel.intervalo_15min,
        funcao_id: cel.funcao_id,
      })
    }
  }

  // Ordenar por data e colaborador_id para saída consistente
  alocacoes.sort((a, b) =>
    a.data.localeCompare(b.data) || a.colaborador_id - b.colaborador_id
  )

  // ── Escala stub (IPC atribuirá id real ao persistir) ─────────────────────

  const escala: Escala = {
    id: 0,
    setor_id: input.setor_id,
    data_inicio: input.data_inicio,
    data_fim: input.data_fim,
    status: 'RASCUNHO',
    pontuacao,
    criada_em: new Date().toISOString(),
  }

  // ── Montar EscalaCompletaV3 ───────────────────────────────────────────────

  const escalaCompleta: EscalaCompletaV3 = {
    escala,
    alocacoes,
    indicadores,
    violacoes,
    antipatterns: allAntipatterns,
    decisoes,
    comparacao_demanda: comparacaoDemanda,
    timing: {
      fase0_ms: timing['fase0_ms'] ?? 0,
      fase1_ms: timing['fase1_ms'] ?? 0,
      fase2_ms: timing['fase2_ms'] ?? 0,
      fase3_ms: timing['fase3_ms'] ?? 0,
      fase4_ms: timing['fase4_ms'] ?? 0,
      fase5_ms: timing['fase5_ms'] ?? 0,
      fase6_ms: timing['fase6_ms'] ?? 0,
      fase7_ms: timing['fase7_ms'] ?? 0,
      total_ms: timing['total_ms'] ?? 0,
      otimizacao_ms: timing['otimizacao_ms'] ?? 0,
      otimizacao_moves: timing['otimizacao_moves'] ?? 0,
      otimizacao_neighborhoods: otimNeighborhoods,
      otimizacao_temperature: otimTemperature,
      otimizacao_stagnation: otimStagnation,
    },
  }

  return {
    sucesso: true,
    escala: escalaCompleta,
  }
}

// ─── Helper privado: tryFixViolation ─────────────────────────────────────────
// Tenta corrigir uma violação HARD de forma greedy.
// Retorna true se conseguiu aplicar alguma correção, false caso contrário.
// NÃO modifica células pinadas (pinnedMap).

function tryFixViolation(
  violacao: Violacao,
  colaboradores: ColabMotor[],
  resultado: Map<number, Map<string, CelulaMotor>>,
  dias: string[],
  lookback: Map<number, LookbackV3>,
  pinnedMap: Map<string, PinnedCell>,
  feriados: Feriado[],
  h1LockedFolgas: Set<string>,
): boolean {
  if (violacao.regra === '__SLOT_COBERTURA_INTERNA__') {
    const data = violacao.data
    if (!data) return false

    const hhmm = /(\d{2}:\d{2})-(\d{2}:\d{2})/.exec(violacao.mensagem ?? '')
    if (!hhmm) return false
    const slotInicio = hhmm[1]
    const slotFim = hhmm[2]
    const slotInicioMin = timeToMin(slotInicio)
    const slotFimMin = timeToMin(slotFim)
    const idxDia = dias.indexOf(data)
    const novoInicioFolga = Math.max(0, slotFimMin - CLT.MIN_JORNADA_DIA_MIN)
    const novoFimFolga = novoInicioFolga + CLT.MIN_JORNADA_DIA_MIN
    const isDomingoSlot = isDomingo(data)

    const violaRodizioDomingo = (c: ColabMotor, mapa: Map<string, CelulaMotor>): boolean => {
      if (!isDomingoSlot) return false
      const maxConsec = c.sexo === 'F'
        ? CLT.MAX_DOMINGOS_CONSECUTIVOS.F
        : CLT.MAX_DOMINGOS_CONSECUTIVOS.M
      let domConsec = lookback.get(c.id)?.domConsec ?? 0
      for (const d of dias) {
        if (!isDomingo(d)) continue
        const cel = mapa.get(d)
        const vaiTrabalhar = d === data ? true : cel?.status === 'TRABALHO'
        if (vaiTrabalhar) domConsec++
        else domConsec = 0
        if (d === data) return domConsec > maxConsec
      }
      return false
    }

    const excedeSemanalEstagiario = (c: ColabMotor, deltaMin: number): boolean => {
      if (!isEstagiario(c)) return false
      const semanas = getWeeks(dias, 'SEG_DOM')
      const semana = semanas.find((w) => w.includes(data))
      if (!semana) return false
      const mapa = resultado.get(c.id)
      if (!mapa) return false
      const somaAtual = semana.reduce((acc, d) => {
        const cel = mapa.get(d)
        if (!cel || cel.status !== 'TRABALHO') return acc
        return acc + (cel.minutos_trabalho ?? 0)
      }, 0)
      return somaAtual + deltaMin > CLT.ESTAGIARIO_MAX_SEMANAL_MIN
    }

    // Primeiro tenta resolver por remanejamento de almoço
    // (evita criar novo turno e preserva H1/H2).
    for (const c of colaboradores) {
      if (h1LockedFolgas.has(`${c.id}-${data}`)) continue
      const pin = pinnedMap.get(`${c.id}-${data}`)
      if (pin) continue

      const cel = resultado.get(c.id)?.get(data)
      if (!cel || cel.status !== 'TRABALHO' || !cel.hora_inicio || !cel.hora_fim) continue
      if (!cel.hora_almoco_inicio || !cel.hora_almoco_fim || cel.minutos_almoco <= 0) continue

      const almocoInicioMin = timeToMin(cel.hora_almoco_inicio)
      const almocoFimMin = timeToMin(cel.hora_almoco_fim)
      const slotEmAlmoco = slotInicioMin >= almocoInicioMin && slotFimMin <= almocoFimMin
      if (!slotEmAlmoco) continue

      const turnoInicio = timeToMin(cel.hora_inicio)
      const turnoFim = timeToMin(cel.hora_fim)
      for (const offset of [60, 30, -30, -60]) {
        const novoInicio = almocoInicioMin + offset
        const novoFim = novoInicio + cel.minutos_almoco
        if (novoInicio < turnoInicio || novoFim > turnoFim) continue
        if (novoInicio - turnoInicio < 120) continue
        if (turnoFim - novoFim < 120) continue

        const novoColide = slotInicioMin >= novoInicio && slotFimMin <= novoFim
        if (novoColide) continue

        cel.hora_almoco_inicio = minToTime(novoInicio)
        cel.hora_almoco_fim = minToTime(novoFim)
        return true
      }
    }

    // Segundo: tenta estender um turno já existente para cobrir o slot.
    for (const c of colaboradores) {
      if (h1LockedFolgas.has(`${c.id}-${data}`)) continue
      const pin = pinnedMap.get(`${c.id}-${data}`)
      if (pin) continue

      const cel = resultado.get(c.id)?.get(data)
      if (!cel || cel.status !== 'TRABALHO' || !cel.hora_inicio || !cel.hora_fim) continue

      const fimAtual = timeToMin(cel.hora_fim)
      if (fimAtual > slotInicioMin || slotInicioMin - fimAtual > CLT.GRID_MINUTOS) continue

      const novoMinutos = cel.minutos_trabalho + CLT.GRID_MINUTOS
      if (novoMinutos > c.max_minutos_dia) continue
      if (excedeSemanalEstagiario(c, CLT.GRID_MINUTOS)) continue
      if (novoMinutos > 360 && novoMinutos < 390) continue // guard cliff Súmula 437

      let novoFim = fimAtual + CLT.GRID_MINUTOS
      const inicioMin = timeToMin(cel.hora_inicio)
      const tinhaAlmoco = Boolean(cel.hora_almoco_inicio && cel.hora_almoco_fim)
      const passouALimiteAlmoco = novoMinutos > CLT.LIMIAR_ALMOCO_MIN

      if (tinhaAlmoco && cel.hora_almoco_fim) {
        const almocoFim = timeToMin(cel.hora_almoco_fim)
        if (novoFim - almocoFim < 120) continue // H20 pós-almoço
      }

      if (!tinhaAlmoco && passouALimiteAlmoco) {
        const duracaoAlmoco = CLT.ALMOCO_MIN_CLT_MIN
        const limiteInicio = inicioMin + 120
        const limiteFim = inicioMin + novoMinutos - 120 - duracaoAlmoco
        if (limiteFim < limiteInicio) continue

        const centro = inicioMin + Math.floor((novoMinutos - duracaoAlmoco) / 2)
        let almocoInicio = Math.max(limiteInicio, Math.min(centro, limiteFim))
        almocoInicio = Math.round(almocoInicio / CLT.GRID_MINUTOS) * CLT.GRID_MINUTOS
        if (almocoInicio < limiteInicio) almocoInicio = limiteInicio
        if (almocoInicio > limiteFim) almocoInicio = limiteFim

        cel.hora_almoco_inicio = minToTime(almocoInicio)
        cel.hora_almoco_fim = minToTime(almocoInicio + duracaoAlmoco)
        cel.minutos_almoco = duracaoAlmoco
        novoFim += duracaoAlmoco
      }

      // Evitar criar clopening técnico ao estender o turno atual.
      if (idxDia >= 0) {
        const mapaCand = resultado.get(c.id)
        const nextData = idxDia < dias.length - 1 ? dias[idxDia + 1] : null
        const nextCel = nextData ? mapaCand?.get(nextData) : null
        if (nextCel?.status === 'TRABALHO' && nextCel.hora_inicio) {
          const descanso = (24 * 60 - novoFim) + timeToMin(nextCel.hora_inicio)
          if (descanso < CLT.MIN_DESCANSO_ENTRE_JORNADAS_MIN) continue
        }
      }

      cel.minutos_trabalho = novoMinutos
      cel.minutos = novoMinutos
      cel.hora_fim = minToTime(novoFim)
      cel.intervalo_15min = cel.minutos_almoco === 0 && novoMinutos > CLT.LIMIAR_INTERVALO_CURTO_MIN
      return true
    }

    // Terceiro: tenta deslocar um turno existente para cobrir o slot
    // sem aumentar carga diária (mesmos minutos_trabalho).
    for (const c of colaboradores) {
      if (h1LockedFolgas.has(`${c.id}-${data}`)) continue
      const pin = pinnedMap.get(`${c.id}-${data}`)
      if (pin) continue

      const mapa = resultado.get(c.id)
      const cel = mapa?.get(data)
      if (!mapa || !cel || cel.status !== 'TRABALHO' || !cel.hora_inicio || !cel.hora_fim) continue

      const inicioAtual = timeToMin(cel.hora_inicio)
      const fimAtual = timeToMin(cel.hora_fim)
      const jaCobre = inicioAtual <= slotInicioMin && fimAtual >= slotFimMin
      if (jaCobre) continue

      const tentarAplicarPlano = (params: {
        novoInicio: number
        novoFim: number
        novoMinutosTrabalho: number
        manterAlmocoOriginal: boolean
      }): boolean => {
        const { novoInicio, novoFim, novoMinutosTrabalho, manterAlmocoOriginal } = params
        const novoMinutosAlmoco = manterAlmocoOriginal ? cel.minutos_almoco : 0
        if (novoInicio < 0 || novoFim > 24 * 60) return false
        if (novoMinutosTrabalho < CLT.MIN_JORNADA_DIA_MIN) return false
        if (novoMinutosTrabalho > c.max_minutos_dia) return false
        if (novoMinutosTrabalho > 360 && novoMinutosTrabalho < 390) return false
        if (novoMinutosTrabalho > CLT.LIMIAR_ALMOCO_MIN && novoMinutosAlmoco <= 0) return false

        if (isAprendiz(c)) {
          const noturnoInicio = timeToMin(CLT.APRENDIZ_HORARIO_NOTURNO_INICIO) // 22:00
          const noturnoFim = timeToMin(CLT.APRENDIZ_HORARIO_NOTURNO_FIM)       // 05:00
          if (novoInicio < noturnoFim || novoFim > noturnoInicio) return false
        }

        if (idxDia >= 0) {
          const prevDia = idxDia > 0 ? mapa.get(dias[idxDia - 1]) : null
          if (prevDia?.status === 'TRABALHO' && prevDia.hora_fim) {
            const descansoPrev = (24 * 60 - timeToMin(prevDia.hora_fim)) + novoInicio
            if (descansoPrev < CLT.MIN_DESCANSO_ENTRE_JORNADAS_MIN) return false
          }
          const nextDia = idxDia < dias.length - 1 ? mapa.get(dias[idxDia + 1]) : null
          if (nextDia?.status === 'TRABALHO' && nextDia.hora_inicio) {
            const descansoNext = (24 * 60 - novoFim) + timeToMin(nextDia.hora_inicio)
            if (descansoNext < CLT.MIN_DESCANSO_ENTRE_JORNADAS_MIN) return false
          }
        }

        const delta = novoInicio - inicioAtual
        cel.hora_inicio = minToTime(novoInicio)
        cel.hora_fim = minToTime(novoFim)
        cel.minutos_trabalho = novoMinutosTrabalho
        cel.minutos = novoMinutosTrabalho

        if (novoMinutosAlmoco > 0 && cel.hora_almoco_inicio && cel.hora_almoco_fim) {
          cel.hora_almoco_inicio = minToTime(timeToMin(cel.hora_almoco_inicio) + delta)
          cel.hora_almoco_fim = minToTime(timeToMin(cel.hora_almoco_fim) + delta)
          cel.minutos_almoco = novoMinutosAlmoco
          cel.intervalo_15min = false
        } else {
          cel.hora_almoco_inicio = null
          cel.hora_almoco_fim = null
          cel.minutos_almoco = 0
          cel.intervalo_15min = novoMinutosTrabalho > CLT.LIMIAR_INTERVALO_CURTO_MIN
            && novoMinutosTrabalho <= CLT.LIMIAR_ALMOCO_MIN
        }

        return true
      }

      // Plano A: manter minutos atuais e só reancorar.
      const totalDuracaoAtual = cel.minutos_trabalho + cel.minutos_almoco
      const novoFimA = slotFimMin
      const novoInicioA = novoFimA - totalDuracaoAtual
      if (tentarAplicarPlano({
        novoInicio: novoInicioA,
        novoFim: novoFimA,
        novoMinutosTrabalho: cel.minutos_trabalho,
        manterAlmocoOriginal: cel.minutos_almoco > 0,
      })) {
        return true
      }

      // Plano B: compactar para jornada mínima (4h) para abrir espaço de cobertura.
      const novoMinutosTrabalhoB = CLT.MIN_JORNADA_DIA_MIN
      const novoFimB = slotFimMin
      const novoInicioB = Math.max(0, novoFimB - novoMinutosTrabalhoB)
      if (tentarAplicarPlano({
        novoInicio: novoInicioB,
        novoFim: novoInicioB + novoMinutosTrabalhoB,
        novoMinutosTrabalho: novoMinutosTrabalhoB,
        manterAlmocoOriginal: false,
      })) {
        return true
      }
    }

    // Quarto: tenta cobrir o slot com alguém em FOLGA não pinado.
    // Escolhe rank maior primeiro para reduzir impacto em operadores juniores.
    const candidatosEstritos = [...colaboradores]
      .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
      .filter((c) => {
        if (h1LockedFolgas.has(`${c.id}-${data}`)) return false
        const pin = pinnedMap.get(`${c.id}-${data}`)
        if (pin?.status === 'FOLGA' || pin?.status === 'INDISPONIVEL') return false
        const mapa = resultado.get(c.id)
        const cel = mapa?.get(data)
        if (!cel || cel.status !== 'FOLGA') return false
        if (!mapa || violaRodizioDomingo(c, mapa)) return false
        if (excedeSemanalEstagiario(c, CLT.MIN_JORNADA_DIA_MIN)) return false

        if (idxDia < 0) return false

        let before = 0
        for (let i = idxDia - 1; i >= 0; i--) {
          const prev = mapa.get(dias[i])
          if (prev?.status === 'TRABALHO') before++
          else break
        }
        if (idxDia - before === 0) {
          before += lookback.get(c.id)?.diasConsec ?? 0
        }

        let after = 0
        for (let i = idxDia + 1; i < dias.length; i++) {
          const next = mapa.get(dias[i])
          if (next?.status === 'TRABALHO') after++
          else break
        }

        if (before + 1 + after > CLT.MAX_DIAS_CONSECUTIVOS) return false

        // Guarda interjornada mínima (H2) com dia anterior e seguinte.
        const novoFimMin = novoFimFolga
        const prevDia = idxDia > 0 ? mapa.get(dias[idxDia - 1]) : null
        if (prevDia?.status === 'TRABALHO' && prevDia.hora_fim) {
          const descanso = (24 * 60 - timeToMin(prevDia.hora_fim)) + novoInicioFolga
          if (descanso < CLT.MIN_DESCANSO_ENTRE_JORNADAS_MIN) return false
        }
        const nextDia = idxDia < dias.length - 1 ? mapa.get(dias[idxDia + 1]) : null
        if (nextDia?.status === 'TRABALHO' && nextDia.hora_inicio) {
          const descanso = (24 * 60 - novoFimMin) + timeToMin(nextDia.hora_inicio)
          if (descanso < CLT.MIN_DESCANSO_ENTRE_JORNADAS_MIN) return false
        }

        return true
      })

    let escolhido = candidatosEstritos[0]
    if (!escolhido) {
      // Fallback pragmático: escolhe o "menos pior" quando não há candidato estrito.
      // Prioriza quem gera menor estouro de H1 (dias consecutivos), mantendo bloqueios legais.
      const relaxados = [...colaboradores]
        .map((c) => {
          if (h1LockedFolgas.has(`${c.id}-${data}`)) return null
          const pin = pinnedMap.get(`${c.id}-${data}`)
          if (pin?.status === 'FOLGA' || pin?.status === 'INDISPONIVEL') return null

          const mapa = resultado.get(c.id)
          const cel = mapa?.get(data)
          if (!mapa || !cel || cel.status !== 'FOLGA') return null
          if (violaRodizioDomingo(c, mapa)) return null
          if (excedeSemanalEstagiario(c, CLT.MIN_JORNADA_DIA_MIN)) return null

          if (isAprendiz(c) && isDomingo(data)) return null
          if (isFeriadoProibido(data, feriados)) return null
          if (isFeriadoSemCCT(data, feriados)) return null

          let before = 0
          if (idxDia >= 0) {
            for (let i = idxDia - 1; i >= 0; i--) {
              const prev = mapa.get(dias[i])
              if (prev?.status === 'TRABALHO') before++
              else break
            }
            if (idxDia - before === 0) {
              before += lookback.get(c.id)?.diasConsec ?? 0
            }
          }

          let after = 0
          if (idxDia >= 0) {
            for (let i = idxDia + 1; i < dias.length; i++) {
              const next = mapa.get(dias[i])
              if (next?.status === 'TRABALHO') after++
              else break
            }
          }

          const overflow = Math.max(0, before + 1 + after - CLT.MAX_DIAS_CONSECUTIVOS)
          return { c, overflow }
        })
        .filter((x): x is { c: ColabMotor; overflow: number } => x !== null)
        .sort((a, b) => {
          if (a.overflow !== b.overflow) return a.overflow - b.overflow
          return (a.c.rank ?? 0) - (b.c.rank ?? 0)
        })

      escolhido = relaxados[0]?.c
    }

    if (!escolhido) return false

    const mapa = resultado.get(escolhido.id)
    const cel = mapa?.get(data)
    if (!mapa || !cel) return false

    cel.status = 'TRABALHO'
    cel.hora_inicio = minToTime(novoInicioFolga)
    cel.minutos_trabalho = CLT.MIN_JORNADA_DIA_MIN
    cel.minutos = CLT.MIN_JORNADA_DIA_MIN
    cel.hora_fim = minToTime(novoFimFolga)
    cel.hora_almoco_inicio = null
    cel.hora_almoco_fim = null
    cel.minutos_almoco = 0
    cel.intervalo_15min = cel.minutos_trabalho > CLT.LIMIAR_INTERVALO_CURTO_MIN
    return true
  }

  const colabId = violacao.colaborador_id
  if (colabId === null) return false

  const colab = colaboradores.find(c => c.id === colabId)
  if (!colab) return false

  const mapaColab = resultado.get(colabId)
  if (!mapaColab) return false

  const pinKey = (data: string) => `${colabId}-${data}`
  const isPinnedCell = (data: string) => pinnedMap.has(pinKey(data))

  switch (violacao.regra) {
    case 'H1_MAX_DIAS_CONSECUTIVOS': {
      // H1: quebrar a sequência escolhendo o melhor dia para folga dentro do bloco.
      // Preferimos o dia com maior cobertura alternativa para reduzir efeito sanfona com piso.
      let consec = lookback.get(colabId)?.diasConsec ?? 0
      for (let idx = 0; idx < dias.length; idx++) {
        const data = dias[idx]
        const cel = mapaColab.get(data)
        if (!cel) continue

        if (cel.status === 'TRABALHO') {
          consec++
          if (consec > CLT.MAX_DIAS_CONSECUTIVOS) {
            const seqStart = Math.max(0, idx - consec + 1)
            const seqDias = dias.slice(seqStart, idx + 1).filter((d) => {
              const c = mapaColab.get(d)
              return Boolean(c && c.status === 'TRABALHO' && !isPinnedCell(d))
            })

            const diaEscolhido = [...seqDias].sort((a, b) => {
              const suporteA = colaboradores.reduce((acc, c) => {
                if (c.id === colabId) return acc
                const celOutro = resultado.get(c.id)?.get(a)
                return acc + (celOutro?.status === 'TRABALHO' ? 1 : 0)
              }, 0)
              const suporteB = colaboradores.reduce((acc, c) => {
                if (c.id === colabId) return acc
                const celOutro = resultado.get(c.id)?.get(b)
                return acc + (celOutro?.status === 'TRABALHO' ? 1 : 0)
              }, 0)
              if (suporteA !== suporteB) return suporteB - suporteA
              return b.localeCompare(a)
            })[0]

            if (!diaEscolhido) return false
            const celEscolhida = mapaColab.get(diaEscolhido)
            if (!celEscolhida) return false

            const celCorrigida: CelulaMotor = {
              status: 'FOLGA',
              hora_inicio: null,
              hora_fim: null,
              minutos: 0,
              minutos_trabalho: 0,
              hora_almoco_inicio: null,
              hora_almoco_fim: null,
              minutos_almoco: 0,
              intervalo_15min: false,
              funcao_id: celEscolhida.funcao_id,
            }
            mapaColab.set(diaEscolhido, celCorrigida)
            return true
          }
        } else {
          consec = 0
        }
      }
      return false
    }

    case 'H2_DESCANSO_ENTRE_JORNADAS': {
      // H2: Empurrar hora_inicio do segundo dia para frente em incrementos de 30min
      // até o descanso entre jornadas ser >= 11h (660min)
      const diasOrdered = dias.filter(d => mapaColab.has(d))
      for (let i = 1; i < diasOrdered.length; i++) {
        const dataPrev = diasOrdered[i - 1]
        const dataHoje = diasOrdered[i]
        const celPrev = mapaColab.get(dataPrev)
        const celHoje = mapaColab.get(dataHoje)

        if (!celPrev || celPrev.status !== 'TRABALHO' || !celPrev.hora_fim) continue
        if (!celHoje || celHoje.status !== 'TRABALHO' || !celHoje.hora_inicio) continue

        const fimOntem = timeToMin(celPrev.hora_fim)
        const inicioHoje = timeToMin(celHoje.hora_inicio)
        // Descanso entre jornadas (considerando virada de dia)
        const descanso = (inicioHoje + 1440 - fimOntem) % 1440

        if (descanso < CLT.MIN_DESCANSO_ENTRE_JORNADAS_MIN) {
          if (!isPinnedCell(dataHoje)) {
            // Empurrar hora_inicio para respeitar 11h de descanso
            const novoInicio = (fimOntem + CLT.MIN_DESCANSO_ENTRE_JORNADAS_MIN) % 1440
            const novoInicioArredondado = Math.ceil(novoInicio / CLT.GRID_MINUTOS) * CLT.GRID_MINUTOS
            const deltaInicio = novoInicioArredondado - inicioHoje
            const minutosTotaisHoje = celHoje.minutos_trabalho + celHoje.minutos_almoco
            const novoFimTotal = novoInicioArredondado + minutosTotaisHoje
            if (novoFimTotal > 24 * 60) continue

            celHoje.hora_inicio = minToTime(novoInicioArredondado)
            celHoje.hora_fim = minToTime(novoFimTotal)
            // Ajustar almoço junto com o deslocamento de início.
            if (celHoje.minutos_almoco > 0) {
              if (celHoje.hora_almoco_inicio && celHoje.hora_almoco_fim) {
                const almocoInicio = timeToMin(celHoje.hora_almoco_inicio) + deltaInicio
                const almocoFim = timeToMin(celHoje.hora_almoco_fim) + deltaInicio
                if (almocoInicio < 0 || almocoFim > 24 * 60) continue
                celHoje.hora_almoco_inicio = minToTime(almocoInicio)
                celHoje.hora_almoco_fim = minToTime(almocoFim)
              }
            }
            return true
          }
        }
      }
      return false
    }

    case 'H2B_DSR_INTERJORNADA': {
      // H2b: garantir 35h ao redor da folga semanal (Súmula 110 TST).
      // Estratégia: empurrar início do dia pós-folga.
      const alvoData = violacao.data
      const diasOrdered = dias.filter((d) => mapaColab.has(d))

      for (let i = 1; i < diasOrdered.length - 1; i++) {
        const dataAntes = diasOrdered[i - 1]
        const dataFolga = diasOrdered[i]
        const dataDepois = diasOrdered[i + 1]
        if (alvoData && alvoData !== dataFolga && alvoData !== dataDepois) continue

        const celAntes = mapaColab.get(dataAntes)
        const celFolga = mapaColab.get(dataFolga)
        const celDepois = mapaColab.get(dataDepois)
        if (!celAntes || !celFolga || !celDepois) continue
        if (celFolga.status !== 'FOLGA') continue
        if (celAntes.status !== 'TRABALHO' || !celAntes.hora_fim) continue
        if (celDepois.status !== 'TRABALHO' || !celDepois.hora_inicio) continue

        const fimAntes = timeToMin(celAntes.hora_fim)
        const inicioDepois = timeToMin(celDepois.hora_inicio)
        const descansoMin = (1440 - fimAntes) + 1440 + inicioDepois
        if (descansoMin >= CLT.DSR_INTERJORNADA_MIN) continue

        const deficit = CLT.DSR_INTERJORNADA_MIN - descansoMin
        const ajuste = Math.ceil(deficit / CLT.GRID_MINUTOS) * CLT.GRID_MINUTOS

        // Empurra o início do dia posterior à folga.
        if (!isPinnedCell(dataDepois)) {
          const novoInicio = inicioDepois + ajuste
          const novoFim = novoInicio + celDepois.minutos_trabalho + celDepois.minutos_almoco
          if (novoInicio >= 0 && novoFim <= 24 * 60) {
            celDepois.hora_inicio = minToTime(novoInicio)
            celDepois.hora_fim = minToTime(novoFim)
            if (celDepois.minutos_almoco > 0 && celDepois.hora_almoco_inicio && celDepois.hora_almoco_fim) {
              celDepois.hora_almoco_inicio = minToTime(timeToMin(celDepois.hora_almoco_inicio) + ajuste)
              celDepois.hora_almoco_fim = minToTime(timeToMin(celDepois.hora_almoco_fim) + ajuste)
            }
            h1LockedFolgas.add(pinKey(dataDepois))
            return true
          }

          // Fallback: se não cabe no dia sem estourar horário, transforma o pós-folga em FOLGA.
          // Isso garante as 35h de DSR; o piso deste dia pode ser recomposto por outro colaborador.
          mapaColab.set(dataDepois, {
            status: 'FOLGA',
            hora_inicio: null,
            hora_fim: null,
            minutos: 0,
            minutos_trabalho: 0,
            hora_almoco_inicio: null,
            hora_almoco_fim: null,
            minutos_almoco: 0,
            intervalo_15min: false,
            funcao_id: celDepois.funcao_id,
          })
          h1LockedFolgas.add(pinKey(dataDepois))
          return true
        }
      }

      return false
    }

    case 'H3_RODIZIO_DOMINGO': {
      // H3/H3b: Converter o domingo problemático em FOLGA
      const violacaoData = violacao.data
      if (violacaoData && isDomingo(violacaoData) && !isPinnedCell(violacaoData)) {
        const cel = mapaColab.get(violacaoData)
        if (cel && cel.status === 'TRABALHO') {
          const celCorrigida: CelulaMotor = {
            status: 'FOLGA',
            hora_inicio: null,
            hora_fim: null,
            minutos: 0,
            minutos_trabalho: 0,
            hora_almoco_inicio: null,
            hora_almoco_fim: null,
            minutos_almoco: 0,
            intervalo_15min: false,
            funcao_id: cel.funcao_id,
          }
          mapaColab.set(violacaoData, celCorrigida)
          return true
        }
      }
      // Se data não disponível, procurar o último domingo TRABALHO não pinado
      for (let i = dias.length - 1; i >= 0; i--) {
        const d = dias[i]
        if (!isDomingo(d)) continue
        if (isPinnedCell(d)) continue
        const cel = mapaColab.get(d)
        if (cel && cel.status === 'TRABALHO') {
          mapaColab.set(d, {
            status: 'FOLGA',
            hora_inicio: null,
            hora_fim: null,
            minutos: 0,
            minutos_trabalho: 0,
            hora_almoco_inicio: null,
            hora_almoco_fim: null,
            minutos_almoco: 0,
            intervalo_15min: false,
            funcao_id: cel.funcao_id,
          })
          return true
        }
      }
      return false
    }

    case 'H4_MAX_JORNADA_DIARIA': {
      // H4: Reduzir minutos_trabalho ao máximo permitido pelo contrato
      const violacaoData = violacao.data
      const maxMin = colab.max_minutos_dia
      const targets = violacaoData ? [violacaoData] : dias

      for (const data of targets) {
        if (isPinnedCell(data)) continue
        const cel = mapaColab.get(data)
        if (!cel || cel.status !== 'TRABALHO') continue

        if (cel.minutos_trabalho > maxMin) {
          const novoMinutos = Math.floor(maxMin / CLT.GRID_MINUTOS) * CLT.GRID_MINUTOS
          cel.minutos_trabalho = novoMinutos
          cel.minutos = novoMinutos
          // Recalcular hora_fim
          if (cel.hora_inicio) {
            const inicioMin = timeToMin(cel.hora_inicio)
            if (cel.minutos_almoco > 0) {
              cel.hora_fim = minToTime(inicioMin + novoMinutos + cel.minutos_almoco)
            } else {
              cel.hora_fim = minToTime(inicioMin + novoMinutos)
            }
          }
          return true
        }
      }
      return false
    }

    case 'H10_META_SEMANAL': {
      // H10: Redistribuir horas na semana para atingir a meta
      // Estratégia simples: encontrar a semana com desvio e ajustar +/- 30min
      const violacaoData = violacao.data

      // Encontrar dias de trabalho ao redor da data da violação
      const semanaAlvo = violacaoData
        ? dias.filter(d => {
            const diff = Math.abs(
              new Date(d + 'T12:00:00').getTime() - new Date(violacaoData + 'T12:00:00').getTime()
            )
            return diff <= 7 * 24 * 60 * 60 * 1000 // ±7 dias
          })
        : dias

      const workDays = semanaAlvo.filter(d => {
        if (isPinnedCell(d)) return false
        const cel = mapaColab.get(d)
        return cel && cel.status === 'TRABALHO'
      })

      if (workDays.length === 0) return false

      // Calcular soma atual
      let somaAtual = 0
      for (const d of workDays) {
        somaAtual += mapaColab.get(d)?.minutos_trabalho ?? 0
      }

      const metaTotal = colab.horas_semanais * 60
      const metaProporcional = Math.round(metaTotal * (workDays.length / colab.dias_trabalho))
      const diff = metaProporcional - somaAtual

      if (diff === 0) return false

      // Ajustar incrementalmente +30min ou -30min
      const ajuste = diff > 0 ? CLT.GRID_MINUTOS : -CLT.GRID_MINUTOS
      const diasOrdemDemanda = [...workDays].sort((a, b) =>
        (resultado.get(colabId)?.get(a)?.minutos_trabalho ?? 0) -
        (resultado.get(colabId)?.get(b)?.minutos_trabalho ?? 0)
      )

      // Adicionar ao dia com menos horas (ou remover do dia com mais)
      const diaAlvo = diff > 0 ? diasOrdemDemanda[0] : diasOrdemDemanda[diasOrdemDemanda.length - 1]
      const cel = mapaColab.get(diaAlvo)
      if (!cel || cel.status !== 'TRABALHO' || !cel.hora_inicio) return false

      const novoMinutos = cel.minutos_trabalho + ajuste

      // Respeitar limites
      if (novoMinutos < CLT.MIN_JORNADA_DIA_MIN) return false
      if (novoMinutos > colab.max_minutos_dia) return false
      // Guard cliff Súmula 437
      if (novoMinutos > 360 && novoMinutos < 390) return false

      cel.minutos_trabalho = novoMinutos
      cel.minutos = novoMinutos
      const inicioMin = timeToMin(cel.hora_inicio)
      if (cel.minutos_almoco > 0) {
        cel.hora_fim = minToTime(inicioMin + novoMinutos + cel.minutos_almoco)
      } else {
        cel.hora_fim = minToTime(inicioMin + novoMinutos)
      }
      // Atualizar flags de intervalo
      if (novoMinutos > CLT.LIMIAR_ALMOCO_MIN) {
        cel.intervalo_15min = false
      } else if (novoMinutos > CLT.LIMIAR_INTERVALO_CURTO_MIN) {
        cel.intervalo_15min = true
      } else {
        cel.intervalo_15min = false
      }
      return true
    }

    case 'H15_ESTAGIARIO_JORNADA':
    case 'H16_ESTAGIARIO_HORA_EXTRA': {
      const dataRef = violacao.data
      const semanaAlvo = dataRef
        ? dias.filter((d) => {
            const diff = Math.abs(
              new Date(d + 'T12:00:00').getTime() - new Date(dataRef + 'T12:00:00').getTime()
            )
            return diff <= 6 * 24 * 60 * 60 * 1000
          })
        : dias

      const workDays = semanaAlvo
        .filter((d) => {
          if (isPinnedCell(d)) return false
          const cel = mapaColab.get(d)
          return Boolean(cel && cel.status === 'TRABALHO' && cel.hora_inicio)
        })
        .sort((a, b) => (mapaColab.get(b)?.minutos_trabalho ?? 0) - (mapaColab.get(a)?.minutos_trabalho ?? 0))

      if (workDays.length === 0) return false

      const aplicarMinutos = (data: string, novoMinutosTrabalho: number): boolean => {
        const cel = mapaColab.get(data)
        if (!cel || cel.status !== 'TRABALHO' || !cel.hora_inicio) return false
        if (novoMinutosTrabalho < CLT.MIN_JORNADA_DIA_MIN) return false
        if (novoMinutosTrabalho > CLT.ESTAGIARIO_MAX_JORNADA_MIN) return false

        const inicioMin = timeToMin(cel.hora_inicio)
        cel.minutos_trabalho = novoMinutosTrabalho
        cel.minutos = novoMinutosTrabalho
        cel.hora_almoco_inicio = null
        cel.hora_almoco_fim = null
        cel.minutos_almoco = 0
        cel.hora_fim = minToTime(inicioMin + novoMinutosTrabalho)
        cel.intervalo_15min = novoMinutosTrabalho > CLT.LIMIAR_INTERVALO_CURTO_MIN
          && novoMinutosTrabalho <= CLT.LIMIAR_ALMOCO_MIN
        return true
      }

      // 1) Corrigir estouro diário (>6h) antes de tratar semana.
      for (const d of workDays) {
        const cel = mapaColab.get(d)
        if (!cel || cel.status !== 'TRABALHO') continue
        if (cel.minutos_trabalho > CLT.ESTAGIARIO_MAX_JORNADA_MIN) {
          return aplicarMinutos(d, CLT.ESTAGIARIO_MAX_JORNADA_MIN)
        }
      }

      // 2) Corrigir estouro semanal (>30h) em passos de 30min.
      const somaSemanal = workDays.reduce((acc, d) => acc + (mapaColab.get(d)?.minutos_trabalho ?? 0), 0)
      if (somaSemanal <= CLT.ESTAGIARIO_MAX_SEMANAL_MIN) return false

      for (const d of workDays) {
        const cel = mapaColab.get(d)
        if (!cel || cel.status !== 'TRABALHO') continue
        if (cel.minutos_trabalho > CLT.MIN_JORNADA_DIA_MIN) {
          const novo = Math.max(CLT.MIN_JORNADA_DIA_MIN, cel.minutos_trabalho - CLT.GRID_MINUTOS)
          if (novo !== cel.minutos_trabalho) {
            return aplicarMinutos(d, novo)
          }
        }
      }

      // 3) Se todos já estão no mínimo diário, zera 1 dia da semana.
      const diaParaFolga = [...workDays]
        .sort((a, b) => (mapaColab.get(a)?.minutos_trabalho ?? 0) - (mapaColab.get(b)?.minutos_trabalho ?? 0))[0]
      if (!diaParaFolga) return false
      const celFolga = mapaColab.get(diaParaFolga)
      if (!celFolga) return false
      mapaColab.set(diaParaFolga, {
        status: 'FOLGA',
        hora_inicio: null,
        hora_fim: null,
        minutos: 0,
        minutos_trabalho: 0,
        hora_almoco_inicio: null,
        hora_almoco_fim: null,
        minutos_almoco: 0,
        intervalo_15min: false,
        funcao_id: celFolga.funcao_id,
      })
      return true
    }

    default:
      // Para outras violações (H5, H6, H7, H8, H9, H11-H20):
      // Sem correção automática disponível — reportar como não-corrigível
      return false
  }
}
