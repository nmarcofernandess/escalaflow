import { queryOne, queryAll } from '../db/query'
import { parseEscalaEquipeSnapshot } from '../escala-equipe-snapshot'
import { buildEffectiveRulePolicy } from './rule-policy'
import type {
  EscalaCompletaV3, Alocacao, Escala, Setor, Demanda, Feriado,
  SetorHorarioSemana, Empresa, AntipatternViolacao, DecisaoMotor,
} from '../../shared'
import { CLT } from '../../shared'
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
  celulaFolga,
  janelaOperacional,
  isFeriadoProibido,
  validarTudoV3,
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
  resolveDemandaSlot,
  calcularScoreV3,
  calcularIndicadoresV3,
  gerarSlotComparacao,
} from './validacao-compartilhada'

// ─── Tipo interno: colaborador com dados do contrato (query JOIN) ──────────────

interface ColabComContrato {
  id: number
  nome: string
  sexo: string
  horas_semanais: number
  dias_trabalho: number
  max_minutos_dia: number
  rank: number | null
  prefere_turno: string | null
  evitar_dia_semana: string | null
  tipo_trabalhador: string | null
  funcao_id: number | null
}

// ─── VALIDADOR V3 ─────────────────────────────────────────────────────────────

/**
 * validarEscalaV3 — Revalida uma escala existente após ajuste manual.
 *
 * Busca a escala + alocações do banco, reconstrói o mapa interno de CelulaMotor,
 * roda todas as regras H1-H20, APs Tier 1+2 e preferências SOFT, e retorna
 * EscalaCompletaV3 completo com indicadores, violações e explicabilidade atualizados.
 *
 * NÃO faz backtrack. NÃO modifica alocações. Apenas analisa e reporta.
 */
export async function validarEscalaV3(escalaId: number): Promise<EscalaCompletaV3> {
  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Buscar escala e alocações do banco
  // ═══════════════════════════════════════════════════════════════════════════

  const escala = await queryOne<Escala>('SELECT * FROM escalas WHERE id = ?', escalaId)

  if (!escala) throw new Error(`Escala ${escalaId} não encontrada`)

  const rulePolicy = await buildEffectiveRulePolicy({ generationMode: 'OFFICIAL' })
  const rules = rulePolicy.validatorRules

  const ruleIs = (codigo: string, defaultStatus = 'ON'): string => {
    return rules[codigo] ?? defaultStatus
  }

  const alocacoesDB = await queryAll<Alocacao>('SELECT * FROM alocacoes WHERE escala_id = ? ORDER BY data', escalaId)

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Buscar entidades necessárias (mesmas queries do gerador)
  // ═══════════════════════════════════════════════════════════════════════════

  const empresa = await queryOne<Empresa>('SELECT * FROM empresa LIMIT 1')

  if (!empresa) throw new Error('Empresa não configurada — execute o seed antes de validar escalas.')

  const setor = await queryOne<Setor>('SELECT * FROM setores WHERE id = ?', escala.setor_id)

  if (!setor) throw new Error(`Setor ${escala.setor_id} não encontrado`)

  const horariosSemana = await queryAll<SetorHorarioSemana>('SELECT * FROM setor_horario_semana WHERE setor_id = ?', escala.setor_id)

  const demandas = await queryAll<Demanda>('SELECT * FROM demandas WHERE setor_id = ?', escala.setor_id)

  const colaboradoresRaw = await queryAll<ColabComContrato>(
    `SELECT c.*, tc.horas_semanais, tc.dias_trabalho, tc.max_minutos_dia
     FROM colaboradores c
     JOIN tipos_contrato tc ON c.tipo_contrato_id = tc.id
     WHERE c.setor_id = ? AND c.ativo = true
     ORDER BY c.rank DESC`,
    escala.setor_id
  )

  const excecoes = await queryAll<{
    id: number
    colaborador_id: number
    data_inicio: string
    data_fim: string
    tipo: string
    observacao: string | null
  }>(
    `SELECT * FROM excecoes
     WHERE colaborador_id IN (SELECT id FROM colaboradores WHERE setor_id = ? AND ativo = true)
       AND data_fim >= ? AND data_inicio <= ?`,
    escala.setor_id, escala.data_inicio, escala.data_fim
  )

  const feriados = await queryAll<Feriado>('SELECT * FROM feriados WHERE data BETWEEN ? AND ?', escala.data_inicio, escala.data_fim)


  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Build ColabMotor array (igual ao gerador)
  // ═══════════════════════════════════════════════════════════════════════════

  const colaboradores: ColabMotor[] = colaboradoresRaw.map(c => ({
    id: c.id,
    nome: c.nome,
    sexo: c.sexo as 'M' | 'F',
    tipo_trabalhador: c.tipo_trabalhador ?? 'CLT',
    horas_semanais: c.horas_semanais,
    dias_trabalho: c.dias_trabalho,
    max_minutos_dia: c.max_minutos_dia,
    rank: c.rank ?? 5,
    prefere_turno: c.prefere_turno ?? null,
    evitar_dia_semana: (c.evitar_dia_semana ?? null) as import('../../shared').DiaSemana | null,
    funcao_id: c.funcao_id ?? null,
  }))

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. Calcular dias e semanas
  // ═══════════════════════════════════════════════════════════════════════════

  const dias = dateRange(escala.data_inicio, escala.data_fim)
  const corteSemanal = empresa.corte_semanal ?? 'SEG_DOM'
  const semanas = getWeeks(dias, corteSemanal)

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. Lookback: buscar escala OFICIAL anterior para continuidade (H1, H2, H3)
  // ═══════════════════════════════════════════════════════════════════════════

  const escalasAnteriores = await queryOne<Escala>(
    `SELECT * FROM escalas
     WHERE setor_id = ? AND status = 'OFICIAL' AND data_fim < ?
     ORDER BY data_fim DESC LIMIT 1`,
    escala.setor_id, escala.data_inicio
  )

  const lookback = new Map<number, LookbackV3>()

  if (escalasAnteriores) {
    const alocacoesAnteriores = await queryAll<Alocacao>('SELECT * FROM alocacoes WHERE escala_id = ? ORDER BY data DESC', escalasAnteriores.id)

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
            ultimaHoraFim = aloc.hora_fim ?? null
          }
          diasConsec++
          if (!domStreakDone && isDomingo(aloc.data)) {
            domConsec++
          } else if (!isDomingo(aloc.data)) {
            domStreakDone = true
          }
        } else {
          if (diasConsec === 0) continue
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

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. Montar resultado Map a partir das alocações persistidas
  // ═══════════════════════════════════════════════════════════════════════════

  const resultado = new Map<number, Map<string, CelulaMotor>>()

  // Inicializar todos os colaboradores x dias como FOLGA
  for (const colab of colaboradores) {
    const mapaColab = new Map<string, CelulaMotor>()
    for (const data of dias) {
      mapaColab.set(data, celulaFolga())
    }
    resultado.set(colab.id, mapaColab)
  }

  // Sobrescrever com dados das alocações persistidas
  for (const aloc of alocacoesDB) {
    const mapaColab = resultado.get(aloc.colaborador_id)
    if (!mapaColab) continue

    // Mapear StatusAlocacao → TipoStatus
    // 'TRABALHO' | 'FOLGA' | 'INDISPONIVEL' são válidos diretos;
    // alocações v3 podem ter outros status se estendidos no futuro
    const status = aloc.status as CelulaMotor['status']

    // minutos_trabalho: campo v3 (pode ser null se gerado pelo motor v2)
    // fallback para 'minutos' (campo v2 compat) para não quebrar validações
    const minutosTrabalho = aloc.minutos_trabalho ?? aloc.minutos ?? 0

    const cel: CelulaMotor = {
      status,
      hora_inicio: aloc.hora_inicio ?? null,
      hora_fim: aloc.hora_fim ?? null,
      minutos: minutosTrabalho,
      minutos_trabalho: minutosTrabalho,
      hora_almoco_inicio: aloc.hora_almoco_inicio ?? null,
      hora_almoco_fim: aloc.hora_almoco_fim ?? null,
      minutos_almoco: aloc.minutos_almoco ?? 0,
      intervalo_15min: aloc.intervalo_15min ?? false,
      funcao_id: aloc.funcao_id ?? null,
    }

    mapaColab.set(aloc.data, cel)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. Montar grid de slots (necessário para APs Tier 1 + SlotComparacao)
  // ═══════════════════════════════════════════════════════════════════════════

  const grid: SlotGrid[] = []

  for (const data of dias) {
    const janela = janelaOperacional(data, setor, horariosSemana)
    // v3.1 PRD: so 25/12 e 01/01 sao hard-blocked (CCT).
    // Outros feriados sao orientados por demanda — geram slots normalmente.
    const feriadoProib = isFeriadoProibido(data, feriados)
    const diaClosed = janela === null

    if (diaClosed || feriadoProib) continue

    let slotStart = timeToMin(janela.abertura)
    const slotEnd = timeToMin(janela.fechamento)
    const diaLabel = diaSemana(data)

    while (slotStart + CLT.GRID_MINUTOS <= slotEnd) {
      const hora_inicio = minToTime(slotStart)

      const resolved = resolveDemandaSlot({
        demandas,
        dia: diaLabel,
        slotInicioMin: slotStart,
        slotFimMin: slotStart + CLT.GRID_MINUTOS,
      })

      grid.push({
        data,
        hora_inicio,
        hora_fim: minToTime(slotStart + CLT.GRID_MINUTOS),
        target_planejado: resolved.target_planejado,
        override: resolved.override,
        dia_fechado: false,
        feriado_proibido: false,
      })

      slotStart += CLT.GRID_MINUTOS
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. Rodar H1-H20 via validarTudoV3
  // ═══════════════════════════════════════════════════════════════════════════

  const validarParams: ValidarTudoParams = {
    colaboradores,
    resultado,
    demandas,
    dias,
    feriados,
    excecoes: excecoes as any,
    lookback,
    tolerancia_min: empresa.tolerancia_semanal_min ?? 0,
    empresa,
    corte_semanal: corteSemanal,
    rules,
  }

  const violacoes = validarTudoV3(validarParams)

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. Rodar APs Tier 1 + Tier 2 + SOFT (mesmo padrão do gerador Fase 7)
  // ═══════════════════════════════════════════════════════════════════════════

  const allAntipatterns: AntipatternViolacao[] = []

  // ── Tier 1: per-colab ──────────────────────────────────────────────────────

  for (const colab of colaboradores) {
    const mapaColab = resultado.get(colab.id) ?? new Map<string, CelulaMotor>()
    const diasOrdered = dias
      .map(d => [d, mapaColab.get(d)] as [string, CelulaMotor | undefined])
      .filter(([, cel]) => cel !== undefined) as [string, CelulaMotor][]

    if (ruleIs('AP1') !== 'OFF') {
      allAntipatterns.push(...checkAP1_Clopening(colab, diasOrdered))
    }
    if (ruleIs('AP7') !== 'OFF') {
      allAntipatterns.push(...checkAP7_WeekendStarvation(colab, semanas, resultado))
    }
  }

  // ── Tier 1: cross-colab ────────────────────────────────────────────────────

  if (ruleIs('AP4') !== 'OFF') {
    allAntipatterns.push(...checkAP4_WorkloadImbalance(colaboradores, resultado, dias))
  }
  if (ruleIs('AP15') !== 'OFF') {
    allAntipatterns.push(...checkAP15_PeakDayClustering(dias, demandas, resultado, colaboradores))
  }

  // ── Tier 1: per-day APs (AP3 e AP16) ─────────────────────────────────────

  for (const data of dias) {
    if (ruleIs('AP3') !== 'OFF') {
      allAntipatterns.push(...checkAP3_LunchCollision(data, colaboradores, resultado))
    }

    const slotsNoDia = grid.filter(s => s.data === data)
    if (ruleIs('AP16') !== 'OFF') {
      for (const slot of slotsNoDia) {
        allAntipatterns.push(...checkAP16_UnsupervisedJunior(data, slot, colaboradores, resultado))
      }
    }
  }

  // ── Tier 2: per-colab ─────────────────────────────────────────────────────

  for (const colab of colaboradores) {
    const mapaColab = resultado.get(colab.id) ?? new Map<string, CelulaMotor>()
    const diasOrdered = dias
      .map(d => [d, mapaColab.get(d)] as [string, CelulaMotor | undefined])
      .filter(([, cel]) => cel !== undefined) as [string, CelulaMotor][]

    if (ruleIs('AP2') !== 'OFF') {
      allAntipatterns.push(...checkAP2_ScheduleInstability(colab, diasOrdered))
    }
    if (ruleIs('AP5') !== 'OFF') {
      allAntipatterns.push(...checkAP5_IsolatedDayOff(colab, diasOrdered))
    }
    if (ruleIs('AP8') !== 'OFF') {
      allAntipatterns.push(...checkAP8_MealTimeDeviation(colab, diasOrdered))
    }
    if (ruleIs('AP9') !== 'OFF') {
      allAntipatterns.push(...checkAP9_CommuteToWorkRatio(colab, diasOrdered))
    }
  }

  // ── Tier 2: cross-colab ────────────────────────────────────────────────────

  if (ruleIs('AP6') !== 'OFF') {
    allAntipatterns.push(...checkAP6_ShiftInequity(colaboradores, resultado, dias))
  }

  // ── Tier 2: per-slot AP10 ─────────────────────────────────────────────────

  for (const data of dias) {
    const slotsNoDia = grid.filter(s => s.data === data)
    if (ruleIs('AP10') !== 'OFF') {
      for (const slot of slotsNoDia) {
        allAntipatterns.push(...checkAP10_OverstaffingCost(data, slot, demandas, resultado, colaboradores))
      }
    }
  }

  // ── SOFT scoring (S1-S5) ──────────────────────────────────────────────────

  let softPenalty = 0

  for (const colab of colaboradores) {
    const mapaColab = resultado.get(colab.id) ?? new Map<string, CelulaMotor>()
    const diasOrdered = dias
      .map(d => [d, mapaColab.get(d)] as [string, CelulaMotor | undefined])
      .filter(([, cel]) => cel !== undefined) as [string, CelulaMotor][]

    softPenalty += checkS1_PrefereTurno(colab, diasOrdered)
    softPenalty += checkS2_EvitarDia(colab, diasOrdered)
    softPenalty += checkS4_FolgaPreferida(colab, diasOrdered)
    softPenalty += checkS5_ConsistenciaHorario(colab, diasOrdered)
  }

  softPenalty += checkS3_EquilibrioAberturas(colaboradores, resultado, dias)

  // ═══════════════════════════════════════════════════════════════════════════
  // 10. Calcular score + indicadores
  // ═══════════════════════════════════════════════════════════════════════════

  const pontuacao = calcularScoreV3(allAntipatterns, softPenalty)

  const calcParams: CalcIndicadoresParams = {
    colaboradores,
    resultado,
    demandas,
    dias,
    violacoes,
    antipatterns: allAntipatterns,
    softPenalty,
    grid,
  }

  const indicadores = calcularIndicadoresV3(calcParams)

  // ═══════════════════════════════════════════════════════════════════════════
  // 11. Gerar DecisaoMotor[] — reflete estado atual pós-ajuste manual
  // ═══════════════════════════════════════════════════════════════════════════

  const decisoes: DecisaoMotor[] = []

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
        razao = `${colab.nome} — folga em ${data}`
      } else {
        // INDISPONIVEL, FERIAS, ATESTADO
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

  // ═══════════════════════════════════════════════════════════════════════════
  // 12. Gerar SlotComparacao[] — Planejado x Executado x Delta atualizado
  // ═══════════════════════════════════════════════════════════════════════════

  const comparacaoDemanda = gerarSlotComparacao({
    grid,
    colaboradores,
    resultado,
    dias,
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 13. Montar e retornar EscalaCompletaV3
  // ═══════════════════════════════════════════════════════════════════════════

  // Atualizar pontuação na escala (score recalculado pós-ajuste)
  const escalaAtualizada: Escala = {
    ...escala,
    pontuacao,
  }
  const snapshotEquipe = parseEscalaEquipeSnapshot(escala.equipe_snapshot_json ?? null)

  return {
    escala: escalaAtualizada,
    alocacoes: alocacoesDB,          // alocações originais do banco (não o mapa interno)
    snapshot_equipe: snapshotEquipe,
    indicadores,
    violacoes,
    antipatterns: allAntipatterns,
    decisoes,
    comparacao_demanda: comparacaoDemanda,
    // timing: undefined — validador não rastreia timing por fase
  }
}
