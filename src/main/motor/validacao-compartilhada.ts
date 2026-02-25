import { CLT, ANTIPATTERNS, FERIADOS_CCT_PROIBIDOS, type DiaSemana } from '../../shared'
import type {
  Setor, Demanda, Colaborador, Excecao, Alocacao, Funcao, Feriado,
  SetorHorarioSemana, Empresa, TipoContrato,
  Violacao, Indicadores, DecisaoMotor, SlotComparacao, AntipatternViolacao, PinnedCell,
  GerarEscalaInput, GerarEscalaOutput, EscalaCompletaV3,
} from '../../shared'

// Imports usados por checkers nas subtasks subsequentes (1-2 a 1-6)
// CLT, ANTIPATTERNS: constantes para checks HARD e APs
// Tipos: re-exportados para o validador e utilitarios de motor
export type {
  Demanda, Violacao, Indicadores, Feriado, Setor, SetorHorarioSemana,
  Excecao, AntipatternViolacao, SlotComparacao, DecisaoMotor,
  Colaborador, Alocacao, Funcao, Empresa, TipoContrato, PinnedCell,
  GerarEscalaInput, GerarEscalaOutput, EscalaCompletaV3,
}
export { CLT, ANTIPATTERNS }

// ─── Tipos internos v3 (internos ao motor — NAO vao para shared) ─────────────

export type TipoStatus = 'TRABALHO' | 'FOLGA' | 'FERIAS' | 'ATESTADO' | 'INDISPONIVEL'

export interface ColabMotor {
  id: number
  nome: string
  sexo: 'M' | 'F'
  tipo_trabalhador: string                // 'CLT' | 'ESTAGIARIO' | 'APRENDIZ' | 'INTERMITENTE'
  horas_semanais: number
  dias_trabalho: number
  max_minutos_dia: number
  rank: number
  prefere_turno: string | null
  evitar_dia_semana: DiaSemana | null
  funcao_id: number | null
}

export interface CelulaMotor {
  status: TipoStatus
  hora_inicio: string | null              // 'HH:MM'
  hora_fim: string | null                 // 'HH:MM'
  minutos: number                         // = minutos_trabalho (compat v2)
  minutos_trabalho: number                // tempo efetivo SEM almoco
  hora_almoco_inicio: string | null
  hora_almoco_fim: string | null
  minutos_almoco: number
  intervalo_15min: boolean
  funcao_id: number | null
}

export interface LookbackV3 {
  diasConsec: number                      // dias consecutivos no fim da escala anterior
  domConsec: number                       // domingos consecutivos
  ultimaHoraFim: string | null            // hora_fim do ultimo dia trabalhado (para H2 cross-escala)
}

export interface SlotGrid {
  data: string                            // 'YYYY-MM-DD'
  hora_inicio: string                     // 'HH:MM'
  hora_fim: string                        // 'HH:MM' (hora_inicio + CLT.GRID_MINUTOS)
  target_planejado: number                // min_pessoas para este slot
  override: boolean                       // demanda.override = true
  dia_fechado: boolean
  feriado_proibido: boolean
}

export interface ValidacaoResultado {
  violacoes: Violacao[]
  antipatterns: AntipatternViolacao[]
  decisoes: DecisaoMotor[]
  comparacao: SlotComparacao[]
}

// ─── Helpers de data/hora compartilhados (preservados identicos do v2) ───────

const JS_DAY_MAP: DiaSemana[] = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB']

export function diaSemana(dateStr: string): DiaSemana {
  return JS_DAY_MAP[new Date(dateStr + 'T12:00:00').getDay()]
}

export function isDomingo(dateStr: string): boolean {
  return new Date(dateStr + 'T12:00:00').getDay() === 0
}

export function timeToMin(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

export function minToTime(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function dateRange(inicio: string, fim: string): string[] {
  const dates: string[] = []
  const d = new Date(inicio + 'T12:00:00')
  const end = new Date(fim + 'T12:00:00')
  while (d <= end) {
    dates.push(d.toISOString().split('T')[0])
    d.setDate(d.getDate() + 1)
  }
  return dates
}

/** Agrupa datas em semanas, iniciando no dia definido pelo corte_semanal.
 *  corte_semanal segue o formato do schema: 'SEG_DOM', 'QUI_QUA', etc.
 *  Os primeiros 3 caracteres indicam o dia de inicio da semana.
 *  Default: 'SEG' (segunda) para backward compatibility. */
export function getWeeks(dates: string[], corte_semanal?: string): string[][] {
  const startDay: DiaSemana = corte_semanal
    ? (corte_semanal.slice(0, 3) as DiaSemana)
    : 'SEG'
  const weeks: string[][] = []
  let current: string[] = []
  for (const d of dates) {
    if (diaSemana(d) === startDay && current.length > 0) {
      weeks.push(current)
      current = []
    }
    current.push(d)
  }
  if (current.length > 0) weeks.push(current)
  return weeks
}

// ─── Meta diaria compartilhada ───────────────────────────────────────────────

/** Calcula meta diaria em minutos a partir do contrato do colaborador.
 *  Usada pelo gerador (FASE 3 — distribuicao de horas) para definir duracao do turno. */
export function calcMetaDiariaMin(horas_semanais: number, dias_trabalho: number): number {
  return Math.round((horas_semanais * 60) / dias_trabalho)
}

// ─── Novos helpers v3 ────────────────────────────────────────────────────────

export function isAprendiz(c: ColabMotor): boolean {
  return c.tipo_trabalhador === 'APRENDIZ'
}

export function isEstagiario(c: ColabMotor): boolean {
  return c.tipo_trabalhador === 'ESTAGIARIO'
}

export function isFeriadoProibido(data: string, feriados: Feriado[]): boolean {
  // Checar se data esta em FERIADOS_CCT_PROIBIDOS (12-25, 01-01) — CCT FecomercioSP
  const mmdd = data.slice(5) // 'MM-DD'
  if ((FERIADOS_CCT_PROIBIDOS as readonly string[]).includes(mmdd)) return true
  // Ou se ha feriado na base marcado como proibido de trabalhar
  return feriados.some(f => f.data === data && f.proibido_trabalhar === true)
}

export function isFeriadoSemCCT(data: string, feriados: Feriado[]): boolean {
  // Retorna true se data e um feriado onde cct_autoriza = false
  // (nao-CCT: feriados que exigem autorizacao especial para trabalhar — Portaria MTE 3.665)
  return feriados.some(f => f.data === data && f.cct_autoriza === false)
}

export function janelaOperacional(
  data: string,
  setor: Setor,
  horarios: SetorHorarioSemana[]
): { abertura: string; fechamento: string } | null {
  // Fallback de 3 niveis (RFC §6 Fase 1):
  // 1. setor_horario_semana[dia].ativo=true → usa abertura/fechamento do registro
  // 2. Sem registro para este dia → fallback para setor.hora_abertura / hora_fechamento
  // 3. setor_horario_semana[dia].ativo=false → dia FECHADO → retornar null
  const dia = diaSemana(data)
  const registro = horarios.find(h => h.dia_semana === dia)
  if (registro) {
    if (!registro.ativo) return null // dia fechado
    return { abertura: registro.hora_abertura, fechamento: registro.hora_fechamento }
  }
  // Fallback: usar padrao do setor
  return { abertura: setor.hora_abertura, fechamento: setor.hora_fechamento }
}

export function resolveDemandaSlot(params: {
  demandas: Demanda[]
  dia: DiaSemana
  slotInicioMin: number
  slotFimMin: number
}): { target_planejado: number; override: boolean } {
  const { demandas, dia, slotInicioMin, slotFimMin } = params

  let targetDia = 0
  let targetLegacy = 0
  let overrideDia = false
  let overrideLegacy = false

  for (const d of demandas) {
    const dInicio = timeToMin(d.hora_inicio)
    const dFim = timeToMin(d.hora_fim)
    if (dInicio > slotInicioMin || dFim < slotFimMin) continue

    if (d.dia_semana === dia) {
      targetDia += d.min_pessoas
      overrideDia = overrideDia || Boolean(d.override)
      continue
    }
    if (d.dia_semana === null) {
      targetLegacy += d.min_pessoas
      overrideLegacy = overrideLegacy || Boolean(d.override)
    }
  }

  const temDiaEspecifico = targetDia > 0
  const targetBruto = temDiaEspecifico ? targetDia : targetLegacy
  return {
    target_planejado: targetBruto || 0,
    override: temDiaEspecifico ? overrideDia : overrideLegacy,
  }
}

export function countExecutadoNoSlot(params: {
  data: string
  slotInicioMin: number
  slotFimMin: number
  colaboradores: ColabMotor[]
  resultado: Map<number, Map<string, CelulaMotor>>
}): number {
  const { data, slotInicioMin, slotFimMin, colaboradores, resultado } = params
  let executado = 0
  for (const c of colaboradores) {
    const mapa = resultado.get(c.id)
    const cel = mapa?.get(data)
    if (!cel || cel.status !== 'TRABALHO' || !cel.hora_inicio || !cel.hora_fim) continue

    const celInicioMin = timeToMin(cel.hora_inicio)
    const celFimMin = timeToMin(cel.hora_fim)
    const cobre = celInicioMin <= slotInicioMin && celFimMin >= slotFimMin
    if (!cobre) continue

    if (cel.hora_almoco_inicio && cel.hora_almoco_fim) {
      const almocoInicioMin = timeToMin(cel.hora_almoco_inicio)
      const almocoFimMin = timeToMin(cel.hora_almoco_fim)
      if (slotInicioMin >= almocoInicioMin && slotFimMin <= almocoFimMin) continue
    }

    executado++
  }
  return executado
}

export function checkPisoOperacionalCobertura(
  grid: SlotGrid[],
  colaboradores: ColabMotor[],
  resultado: Map<number, Map<string, CelulaMotor>>,
): Violacao[] {
  void grid
  void colaboradores
  void resultado
  return []
}

export function minutosTrabalhoEfetivo(cel: CelulaMotor): number {
  // Retorna minutos efetivos de trabalho (SEM almoco)
  return cel.minutos_trabalho
}

// ─── Factories de celula ─────────────────────────────────────────────────────

export function celulaFolga(): CelulaMotor {
  return {
    status: 'FOLGA',
    hora_inicio: null,
    hora_fim: null,
    minutos: 0,
    minutos_trabalho: 0,
    hora_almoco_inicio: null,
    hora_almoco_fim: null,
    minutos_almoco: 0,
    intervalo_15min: false,
    funcao_id: null,
  }
}

export function celulaIndisponivel(): CelulaMotor {
  return { ...celulaFolga(), status: 'INDISPONIVEL' }
}

// ─── Checkers HARD H1-H10 (regras CLT base) ──────────────────────────────────

/**
 * H1 — MAX_DIAS_CONSECUTIVOS
 * Max 6 dias de trabalho seguidos (Art. 67 + OJ 410 TST).
 * Usa lookback.diasConsec para checar continuidade de escala anterior.
 */
export function checkH1(
  c: ColabMotor,
  diasOrdered: Array<[string, CelulaMotor]>,
  lookback: LookbackV3
): Violacao[] {
  const violacoes: Violacao[] = []
  let consec = lookback.diasConsec

  for (const [data, cel] of diasOrdered) {
    if (cel.status === 'TRABALHO') {
      consec++
      if (consec > CLT.MAX_DIAS_CONSECUTIVOS) {
        violacoes.push({
          severidade: 'HARD',
          regra: 'H1_MAX_DIAS_CONSECUTIVOS',
          colaborador_id: c.id,
          colaborador_nome: c.nome,
          mensagem: `${c.nome} trabalhou ${consec} dias seguidos (máximo ${CLT.MAX_DIAS_CONSECUTIVOS})`,
          data,
        })
      }
    } else {
      consec = 0
    }
  }

  return violacoes
}

/**
 * H2 — DESCANSO_ENTRE_JORNADAS
 * Min 11h (660min) de descanso entre o fim de um dia e o início do próximo (Art. 66 CLT).
 * Usa lookback.ultimaHoraFim para checar a transição entre escalas.
 */
export function checkH2(
  c: ColabMotor,
  diasOrdered: Array<[string, CelulaMotor]>,
  lookback: LookbackV3
): Violacao[] {
  const violacoes: Violacao[] = []
  let horaFimAnterior: string | null = lookback.ultimaHoraFim

  for (const [data, cel] of diasOrdered) {
    if (cel.status === 'TRABALHO' && cel.hora_inicio !== null && cel.hora_fim !== null) {
      if (horaFimAnterior !== null) {
        const fimMin = timeToMin(horaFimAnterior)
        const inicioMin = timeToMin(cel.hora_inicio)
        // Descanso = minutos do dia que sobraram + minutos até o início de hoje
        // (1440 - fimMin) + inicioMin, ou se hoje começa após ontem terminou, simplesmente a diferença
        // Assumindo que os turnos estão dentro de um mesmo dia (não cruzam meia-noite para simplificar)
        // Diferença em minutos considerando que fimAnterior foi ontem e inicioHoje é hoje
        const descansoMin = (1440 - fimMin) + inicioMin
        if (descansoMin < CLT.MIN_DESCANSO_ENTRE_JORNADAS_MIN) {
          violacoes.push({
            severidade: 'HARD',
            regra: 'H2_DESCANSO_ENTRE_JORNADAS',
            colaborador_id: c.id,
            colaborador_nome: c.nome,
            mensagem: `${c.nome} teve apenas ${Math.floor(descansoMin / 60)}h${descansoMin % 60}min de descanso entre jornadas em ${data} (mínimo 11h)`,
            data,
          })
        }
      }
      horaFimAnterior = cel.hora_fim
    } else if (cel.status !== 'TRABALHO') {
      // Dia de folga/indisponível — não atualiza horaFimAnterior, reinicia a contagem de descanso
      // (se há um dia inteiro de folga, o descanso certamente é suficiente)
      horaFimAnterior = null
    }
  }

  return violacoes
}

/**
 * H2b — DSR_INTERJORNADA
 * Min 35h (2100min) de descanso quando há DSR/folga semanal (Súmula 110 TST).
 * Calcula: (1440 - fimAntesDoFolga) + 1440 (dia de folga) + inicioDepoisDoFolga.
 */
export function checkH2b(
  c: ColabMotor,
  diasOrdered: Array<[string, CelulaMotor]>
): Violacao[] {
  const violacoes: Violacao[] = []

  for (let i = 0; i < diasOrdered.length; i++) {
    const [dataFolga, celFolga] = diasOrdered[i]
    // Identificar dia de DSR (FOLGA)
    if (celFolga.status !== 'FOLGA') continue

    // Buscar o dia de trabalho anterior ao DSR
    const anterior = i > 0 ? diasOrdered[i - 1] : null
    // Buscar o dia de trabalho posterior ao DSR
    const posterior = i < diasOrdered.length - 1 ? diasOrdered[i + 1] : null

    if (anterior === null || posterior === null) continue

    const [, celAntes] = anterior
    const [dataDepois, celDepois] = posterior

    if (celAntes.status !== 'TRABALHO' || celAntes.hora_fim === null) continue
    if (celDepois.status !== 'TRABALHO' || celDepois.hora_inicio === null) continue

    const fimAntes = timeToMin(celAntes.hora_fim)
    const inicioDepois = timeToMin(celDepois.hora_inicio)

    // Descanso total = restante do dia antes da folga + dia inteiro de folga (1440) + início do próximo dia
    const descansoMin = (1440 - fimAntes) + 1440 + inicioDepois

    if (descansoMin < CLT.DSR_INTERJORNADA_MIN) {
      violacoes.push({
        severidade: 'HARD',
        regra: 'H2B_DSR_INTERJORNADA',
        colaborador_id: c.id,
        colaborador_nome: c.nome,
        mensagem: `${c.nome} teve apenas ${Math.floor(descansoMin / 60)}h de descanso ao redor do DSR em ${dataFolga} (mínimo 35h — Súmula 110 TST)`,
        data: dataDepois,
      })
    }
  }

  return violacoes
}

/**
 * H3 — RODIZIO_DOMINGO (v3.1: rebaixado para SOFT)
 * Mulher: max 1 domingo consecutivo trabalhado (Art. 386 CLT).
 * Homem: max 2 domingos consecutivos (Lei 10.101/2000).
 * Usa lookback.domConsec para checar continuidade de escala anterior.
 *
 * v3.1 PRD: H3 deixa de ser HARD e vira indicador SOFT.
 * O solver Python agora usa add_domingo_ciclo_soft() com peso 3000.
 * Este checker reporta como SOFT para o dashboard, nao bloqueia oficializacao.
 */
export function checkH3(
  c: ColabMotor,
  domingos: string[],
  mapa: Map<string, CelulaMotor>,
  lookback: LookbackV3
): Violacao[] {
  const violacoes: Violacao[] = []
  const maxConsec = CLT.MAX_DOMINGOS_CONSECUTIVOS[c.sexo]
  let consec = lookback.domConsec

  for (const data of domingos) {
    const cel = mapa.get(data)
    if (!cel) continue

    if (cel.status === 'TRABALHO') {
      consec++
      if (consec > maxConsec) {
        const descricao = c.sexo === 'F'
          ? `máximo 1 domingo consecutivo para mulheres (Art. 386 CLT)`
          : `máximo 2 domingos consecutivos para homens (Lei 10.101/2000)`
        violacoes.push({
          severidade: 'SOFT',
          regra: 'H3_RODIZIO_DOMINGO',
          colaborador_id: c.id,
          colaborador_nome: c.nome,
          mensagem: `${c.nome} trabalhou ${consec} domingos consecutivos (${descricao}) — indicador de justiça dominical`,
          data,
        })
      }
    } else {
      consec = 0
    }
  }

  return violacoes
}

/**
 * H4 — MAX_JORNADA_DIARIA
 * minutos_trabalho não pode exceder c.max_minutos_dia (Art. 58+59 CLT).
 */
export function checkH4(
  c: ColabMotor,
  diasOrdered: Array<[string, CelulaMotor]>
): Violacao[] {
  const violacoes: Violacao[] = []

  for (const [data, cel] of diasOrdered) {
    if (cel.status === 'TRABALHO' && cel.minutos_trabalho > c.max_minutos_dia) {
      violacoes.push({
        severidade: 'HARD',
        regra: 'H4_MAX_JORNADA_DIARIA',
        colaborador_id: c.id,
        colaborador_nome: c.nome,
        mensagem: `${c.nome} teve ${cel.minutos_trabalho}min de jornada em ${data} (máximo ${c.max_minutos_dia}min = ${Math.floor(c.max_minutos_dia / 60)}h${c.max_minutos_dia % 60 > 0 ? c.max_minutos_dia % 60 + 'min' : ''})`,
        data,
      })
    }
  }

  return violacoes
}

/**
 * H5 — EXCECOES_RESPEITADAS
 * Se colaborador tem exceção ativa (férias/atestado/bloqueio) em um dia
 * e a célula está como TRABALHO → violação (CLT).
 */
export function checkH5(
  c: ColabMotor,
  diasOrdered: Array<[string, CelulaMotor]>,
  excecoes: Excecao[]
): Violacao[] {
  const violacoes: Violacao[] = []
  // Filtrar exceções do colaborador
  const excecoesDocolab = excecoes.filter(e => e.colaborador_id === c.id)

  for (const [data, cel] of diasOrdered) {
    if (cel.status !== 'TRABALHO') continue

    const temExcecaoAtiva = excecoesDocolab.some(
      e => e.data_inicio <= data && e.data_fim >= data
    )
    if (temExcecaoAtiva) {
      const excecao = excecoesDocolab.find(e => e.data_inicio <= data && e.data_fim >= data)
      const tipoLabel = excecao?.tipo === 'FERIAS' ? 'férias'
        : excecao?.tipo === 'ATESTADO' ? 'atestado médico'
        : 'bloqueio'
      violacoes.push({
        severidade: 'HARD',
        regra: 'H5_EXCECOES_RESPEITADAS',
        colaborador_id: c.id,
        colaborador_nome: c.nome,
        mensagem: `${c.nome} está em ${tipoLabel} em ${data} e foi alocado como TRABALHO — exceção deve ser respeitada`,
        data,
      })
    }
  }

  return violacoes
}

/**
 * H6 — ALMOCO_OBRIGATORIO
 * Se minutos_trabalho > 360min (>6h) e não há almoço definido → violação (Art. 71 CLT + CCT).
 */
export function checkH6(
  cel: CelulaMotor,
  c: ColabMotor,
  data: string
): Violacao[] {
  if (cel.status !== 'TRABALHO') return []
  if (cel.minutos_trabalho <= CLT.LIMIAR_ALMOCO_MIN) return []

  if (cel.hora_almoco_inicio === null || cel.minutos_almoco === 0) {
    return [{
      severidade: 'HARD',
      regra: 'H6_ALMOCO_OBRIGATORIO',
      colaborador_id: c.id,
      colaborador_nome: c.nome,
      mensagem: `${c.nome} precisa de intervalo de almoço em ${data} — jornada de ${Math.floor(cel.minutos_trabalho / 60)}h${cel.minutos_trabalho % 60 > 0 ? cel.minutos_trabalho % 60 + 'min' : ''} exige almoço obrigatório (Art. 71 CLT)`,
      data,
    }]
  }

  return []
}

/**
 * H7 — INTERVALO_CURTO
 * Se minutos_trabalho > 240 e <= 360 (>4h e <=6h) e intervalo_15min = false → violação (Art. 71 §1 CLT).
 */
export function checkH7(
  cel: CelulaMotor,
  c: ColabMotor,
  data: string
): Violacao[] {
  if (cel.status !== 'TRABALHO') return []
  if (cel.minutos_trabalho <= CLT.LIMIAR_INTERVALO_CURTO_MIN) return []
  if (cel.minutos_trabalho > CLT.LIMIAR_ALMOCO_MIN) return []

  if (!cel.intervalo_15min) {
    return [{
      severidade: 'HARD',
      regra: 'H7_INTERVALO_CURTO',
      colaborador_id: c.id,
      colaborador_nome: c.nome,
      mensagem: `${c.nome} tem jornada de ${Math.floor(cel.minutos_trabalho / 60)}h${cel.minutos_trabalho % 60 > 0 ? cel.minutos_trabalho % 60 + 'min' : ''} em ${data} — exige pausa de 15min obrigatória (Art. 71 §1 CLT)`,
      data,
    }]
  }

  return []
}

/**
 * H7b — SEM_INTERVALO_4H
 * Jornada <= 4h: nenhum intervalo necessário (Art. 71 §1 CLT — contrário).
 * Checker no-op documentando a regra — ausência de intervalo é o comportamento correto.
 */
export function checkH7b(
  _cel: CelulaMotor,
  _c: ColabMotor,
  _data: string
): Violacao[] {
  // Jornada <= 4h: sem intervalo — conforme Art. 71 §1 CLT
  return []
}

/**
 * H8 — GRID_HORARIOS
 * Todos os horários definidos devem ser múltiplos de CLT.GRID_MINUTOS (15min).
 * Decisão de produto: grid fixo para simplificar a alocação.
 */
export function checkH8(
  cel: CelulaMotor,
  c: ColabMotor,
  data: string
): Violacao[] {
  if (cel.status !== 'TRABALHO') return []
  const violacoes: Violacao[] = []

  const campos: Array<[string, string | null]> = [
    ['hora_inicio', cel.hora_inicio],
    ['hora_fim', cel.hora_fim],
    ['hora_almoco_inicio', cel.hora_almoco_inicio],
    ['hora_almoco_fim', cel.hora_almoco_fim],
  ]

  for (const [campo, valor] of campos) {
    if (valor === null) continue
    const minutos = timeToMin(valor)
    if (minutos % CLT.GRID_MINUTOS !== 0) {
      violacoes.push({
        severidade: 'HARD',
        regra: 'H8_GRID_HORARIOS',
        colaborador_id: c.id,
        colaborador_nome: c.nome,
        mensagem: `${c.nome} tem ${campo} = ${valor} em ${data} que não é múltiplo de ${CLT.GRID_MINUTOS}min — todos horários devem seguir o grid de ${CLT.GRID_MINUTOS}min`,
        data,
      })
    }
  }

  return violacoes
}

/**
 * H9 — MAX_SAIDA_VOLTA
 * Max 2 blocos de trabalho por dia (Art. 71 CLT).
 * Com almoço: 2 blocos (antes + depois) — OK.
 * Sem almoço: 1 bloco contínuo — OK.
 * >2 blocos: violação (modelo atual suporta no máximo 2 via hora_inicio/almoco/hora_fim).
 */
export function checkH9(
  cel: CelulaMotor,
  c: ColabMotor,
  data: string
): Violacao[] {
  if (cel.status !== 'TRABALHO') return []

  // Com almoco = 2 blocos (antes + depois): OK
  // Sem almoco = 1 bloco: OK
  // O modelo atual (hora_inicio / almoco / hora_fim) suporta no máximo 2 blocos,
  // portanto violação só ocorre se os dados forem inconsistentes.
  // Guard: se há almoco mas falta hora_inicio ou hora_fim → inconsistência de dados
  if (cel.hora_almoco_inicio !== null && cel.hora_almoco_fim !== null) {
    if (cel.hora_inicio === null || cel.hora_fim === null) {
      return [{
        severidade: 'HARD',
        regra: 'H9_MAX_SAIDA_VOLTA',
        colaborador_id: c.id,
        colaborador_nome: c.nome,
        mensagem: `${c.nome} tem almoço definido em ${data} mas sem hora_inicio ou hora_fim — dados inconsistentes`,
        data,
      }]
    }
    // Verificar que o almoço está dentro do turno (não gera bloco extra)
    const inicioMin = timeToMin(cel.hora_inicio)
    const fimMin = timeToMin(cel.hora_fim)
    const almocoInicioMin = timeToMin(cel.hora_almoco_inicio)
    const almocoFimMin = timeToMin(cel.hora_almoco_fim)
    if (almocoInicioMin < inicioMin || almocoFimMin > fimMin) {
      return [{
        severidade: 'HARD',
        regra: 'H9_MAX_SAIDA_VOLTA',
        colaborador_id: c.id,
        colaborador_nome: c.nome,
        mensagem: `${c.nome} tem almoço fora do horário de trabalho em ${data} — almoço deve estar entre ${cel.hora_inicio} e ${cel.hora_fim}`,
        data,
      }]
    }
  }

  return []
}

/**
 * H10 — META_SEMANAL
 * A soma semanal de minutos_trabalho deve estar dentro da tolerância da empresa.
 * Meta proporcional quando há dias de exceção, semana parcial ou feriado proibido.
 * Os dias marcados como INDISPONIVEL não contam na meta proporcional.
 */
export function checkH10(
  c: ColabMotor,
  semana: string[],
  mapa: Map<string, CelulaMotor>,
  tolerancia_min: number,
  _empresa: Empresa
): Violacao[] {
  if (semana.length === 0) return []

  let somaMin = 0
  let diasDisponiveis = 0

  for (const data of semana) {
    const cel = mapa.get(data)
    if (!cel) continue

    // INDISPONIVEL não conta como dia disponível para a meta
    if (cel.status === 'INDISPONIVEL') continue

    diasDisponiveis++
    if (cel.status === 'TRABALHO') {
      somaMin += cel.minutos_trabalho
    }
  }

  if (diasDisponiveis === 0) return []

  // Meta proporcional: (horas_semanais * 60) * (dias_disponíveis / 7)
  const metaTotal = c.horas_semanais * 60
  const metaProporcional = Math.round(metaTotal * (diasDisponiveis / 7))

  const desvio = Math.abs(somaMin - metaProporcional)

  if (desvio > tolerancia_min) {
    const semanaRef = semana[0]
    return [{
      // v3.1 pragmático: divergência de meta semanal é alertável, não bloqueante.
      severidade: 'SOFT',
      regra: 'H10_META_SEMANAL',
      colaborador_id: c.id,
      colaborador_nome: c.nome,
      mensagem: `${c.nome} trabalhou ${Math.floor(somaMin / 60)}h${somaMin % 60}min na semana de ${semanaRef} (meta proporcional: ${Math.floor(metaProporcional / 60)}h${metaProporcional % 60}min, tolerância: ±${tolerancia_min}min)`,
      data: semanaRef,
    }]
  }

  return []
}

// ─── Checkers HARD H11-H20 (aprendiz, estagiário, feriados, almoço) ──────────

/**
 * H11 — APRENDIZ_DOMINGO
 * Aprendiz não pode trabalhar aos domingos (Art. 432 CLT).
 */
export function checkH11(
  c: ColabMotor,
  data: string,
  cel: CelulaMotor
): Violacao[] {
  if (!isAprendiz(c)) return []
  if (!isDomingo(data)) return []
  if (cel.status !== 'TRABALHO') return []

  return [{
    severidade: 'HARD',
    regra: 'H11_APRENDIZ_DOMINGO',
    colaborador_id: c.id,
    colaborador_nome: c.nome,
    mensagem: `Aprendiz ${c.nome} não pode trabalhar aos domingos (CLT Art. 432) — ${data} é domingo`,
    data,
  }]
}

/**
 * H12 — APRENDIZ_FERIADO
 * Aprendiz não pode trabalhar em feriados (Art. 432 CLT).
 */
export function checkH12(
  c: ColabMotor,
  data: string,
  cel: CelulaMotor,
  feriados: Feriado[]
): Violacao[] {
  if (!isAprendiz(c)) return []
  if (cel.status !== 'TRABALHO') return []

  const eFeriado = feriados.some(f => f.data === data)
  if (!eFeriado) return []

  const feriado = feriados.find(f => f.data === data)
  const nomeFeriado = feriado?.nome ?? 'feriado'

  return [{
    severidade: 'HARD',
    regra: 'H12_APRENDIZ_FERIADO',
    colaborador_id: c.id,
    colaborador_nome: c.nome,
    mensagem: `Aprendiz ${c.nome} não pode trabalhar em feriados (CLT Art. 432) — ${data} é ${nomeFeriado}`,
    data,
  }]
}

/**
 * H13 — APRENDIZ_NOTURNO
 * Aprendiz não pode trabalhar no período noturno entre 22:00 e 05:00 (Art. 404 CLT).
 * Verifica: hora_fim > 22:00 OU hora_inicio < 05:00 OU hora_inicio >= 22:00.
 */
export function checkH13(
  c: ColabMotor,
  cel: CelulaMotor,
  data: string
): Violacao[] {
  if (!isAprendiz(c)) return []
  if (cel.status !== 'TRABALHO') return []
  if (cel.hora_inicio === null || cel.hora_fim === null) return []

  const inicioMin = timeToMin(cel.hora_inicio)
  const fimMin = timeToMin(cel.hora_fim)
  const noturnoInicioMin = timeToMin(CLT.APRENDIZ_HORARIO_NOTURNO_INICIO) // 22:00 = 1320
  const noturnoFimMin = timeToMin(CLT.APRENDIZ_HORARIO_NOTURNO_FIM)       // 05:00 = 300

  const entraNoNoturno =
    fimMin > noturnoInicioMin ||   // turno termina após 22:00
    inicioMin < noturnoFimMin ||   // turno começa antes das 05:00
    inicioMin >= noturnoInicioMin  // turno começa às 22:00 ou depois

  if (!entraNoNoturno) return []

  return [{
    severidade: 'HARD',
    regra: 'H13_APRENDIZ_NOTURNO',
    colaborador_id: c.id,
    colaborador_nome: c.nome,
    mensagem: `Aprendiz ${c.nome} não pode trabalhar no horário noturno (${CLT.APRENDIZ_HORARIO_NOTURNO_INICIO}–${CLT.APRENDIZ_HORARIO_NOTURNO_FIM}) em ${data} — turno ${cel.hora_inicio}–${cel.hora_fim} viola Art. 404 CLT`,
    data,
  }]
}

/**
 * H14 — APRENDIZ_HORA_EXTRA
 * Aprendiz não pode fazer hora extra: max 6h/dia (360min) e 30h/semana (1800min) (Art. 432 CLT).
 */
export function checkH14(
  c: ColabMotor,
  semana: string[],
  mapa: Map<string, CelulaMotor>
): Violacao[] {
  if (!isAprendiz(c)) return []

  const violacoes: Violacao[] = []
  let somaSemanal = 0

  for (const data of semana) {
    const cel = mapa.get(data)
    if (!cel || cel.status !== 'TRABALHO') continue

    somaSemanal += cel.minutos_trabalho

    if (cel.minutos_trabalho > CLT.APRENDIZ_MAX_JORNADA_MIN) {
      violacoes.push({
        severidade: 'HARD',
        regra: 'H14_APRENDIZ_HORA_EXTRA',
        colaborador_id: c.id,
        colaborador_nome: c.nome,
        mensagem: `Aprendiz ${c.nome} tem ${Math.floor(cel.minutos_trabalho / 60)}h${cel.minutos_trabalho % 60}min em ${data} — máximo permitido é ${Math.floor(CLT.APRENDIZ_MAX_JORNADA_MIN / 60)}h/dia (Art. 432 CLT)`,
        data,
      })
    }
  }

  if (somaSemanal > CLT.APRENDIZ_MAX_SEMANAL_MIN) {
    const semanaRef = semana[0] ?? null
    violacoes.push({
      severidade: 'HARD',
      regra: 'H14_APRENDIZ_HORA_EXTRA',
      colaborador_id: c.id,
      colaborador_nome: c.nome,
      mensagem: `Aprendiz ${c.nome} tem ${Math.floor(somaSemanal / 60)}h${somaSemanal % 60}min na semana de ${semanaRef} — máximo permitido é ${Math.floor(CLT.APRENDIZ_MAX_SEMANAL_MIN / 60)}h/semana (Art. 432 CLT)`,
      data: semanaRef,
    })
  }

  return violacoes
}

/**
 * H15 — ESTAGIARIO_JORNADA
 * Estagiário: max 6h/dia (360min) e 30h/semana (1800min) (Lei 11.788 Art. 10).
 */
export function checkH15(
  c: ColabMotor,
  semana: string[],
  mapa: Map<string, CelulaMotor>
): Violacao[] {
  if (!isEstagiario(c)) return []

  const violacoes: Violacao[] = []
  let somaSemanal = 0

  for (const data of semana) {
    const cel = mapa.get(data)
    if (!cel || cel.status !== 'TRABALHO') continue

    somaSemanal += cel.minutos_trabalho

    if (cel.minutos_trabalho > CLT.ESTAGIARIO_MAX_JORNADA_MIN) {
      violacoes.push({
        severidade: 'HARD',
        regra: 'H15_ESTAGIARIO_JORNADA',
        colaborador_id: c.id,
        colaborador_nome: c.nome,
        mensagem: `Estagiário ${c.nome} tem ${Math.floor(cel.minutos_trabalho / 60)}h${cel.minutos_trabalho % 60}min em ${data} — máximo permitido é ${Math.floor(CLT.ESTAGIARIO_MAX_JORNADA_MIN / 60)}h/dia (Lei 11.788 Art. 10)`,
        data,
      })
    }
  }

  if (somaSemanal > CLT.ESTAGIARIO_MAX_SEMANAL_MIN) {
    const semanaRef = semana[0] ?? null
    violacoes.push({
      severidade: 'HARD',
      regra: 'H15_ESTAGIARIO_JORNADA',
      colaborador_id: c.id,
      colaborador_nome: c.nome,
      mensagem: `Estagiário ${c.nome} tem ${Math.floor(somaSemanal / 60)}h${somaSemanal % 60}min na semana de ${semanaRef} — máximo permitido é ${Math.floor(CLT.ESTAGIARIO_MAX_SEMANAL_MIN / 60)}h/semana (Lei 11.788 Art. 10)`,
      data: semanaRef,
    })
  }

  return violacoes
}

/**
 * H16 — ESTAGIARIO_HORA_EXTRA
 * Estagiário nunca pode fazer hora extra: soma semanal > 30h (1800min) é violação (Lei 11.788).
 * Checker focado na perspectiva semanal (complementa H15 que também checa diário).
 */
export function checkH16(
  c: ColabMotor,
  semana: string[],
  mapa: Map<string, CelulaMotor>
): Violacao[] {
  if (!isEstagiario(c)) return []

  let somaSemanal = 0
  for (const data of semana) {
    const cel = mapa.get(data)
    if (!cel || cel.status !== 'TRABALHO') continue
    somaSemanal += cel.minutos_trabalho
  }

  if (somaSemanal <= CLT.ESTAGIARIO_MAX_SEMANAL_MIN) return []

  const semanaRef = semana[0] ?? null
  return [{
    severidade: 'HARD',
    regra: 'H16_ESTAGIARIO_HORA_EXTRA',
    colaborador_id: c.id,
    colaborador_nome: c.nome,
    mensagem: `Estagiário ${c.nome} acumulou ${Math.floor(somaSemanal / 60)}h${somaSemanal % 60}min na semana de ${semanaRef} — hora extra é proibida para estagiários (Lei 11.788)`,
    data: semanaRef,
  }]
}

/**
 * H17 — FERIADO_PROIBIDO
 * 25/12 e 01/01 são feriados absolutamente proibidos para trabalho (CCT FecomercioSP).
 * Qualquer colaborador alocado como TRABALHO nesses dias = violação.
 */
export function checkH17(
  data: string,
  alocacoesDia: Array<{ colabId: number; colabNome: string; cel: CelulaMotor }>
): Violacao[] {
  const mmdd = data.slice(5) // 'MM-DD'
  if (!(FERIADOS_CCT_PROIBIDOS as readonly string[]).includes(mmdd)) return []

  const violacoes: Violacao[] = []

  for (const { colabId, colabNome, cel } of alocacoesDia) {
    if (cel.status !== 'TRABALHO') continue
    const nomeFeriado = mmdd === '12-25' ? 'Natal (25/12)' : 'Ano Novo (01/01)'
    violacoes.push({
      severidade: 'HARD',
      regra: 'H17_FERIADO_PROIBIDO',
      colaborador_id: colabId,
      colaborador_nome: colabNome,
      mensagem: `${colabNome} não pode trabalhar em ${nomeFeriado} — feriado absolutamente proibido pela CCT FecomercioSP`,
      data,
    })
  }

  return violacoes
}

/**
 * H18 — FERIADO_SEM_CCT
 * Feriados onde cct_autoriza = false não podem ter colaboradores trabalhando
 * (Portaria MTE 3.665 — trabalho em feriado exige autorização CCT).
 */
export function checkH18(
  data: string,
  feriados: Feriado[],
  alocacoesDia: Array<{ colabId: number; colabNome: string; cel: CelulaMotor }>
): Violacao[] {
  const feriadoSemCCT = feriados.find(f => f.data === data && f.cct_autoriza === false)
  if (!feriadoSemCCT) return []

  const violacoes: Violacao[] = []

  for (const { colabId, colabNome, cel } of alocacoesDia) {
    if (cel.status !== 'TRABALHO') continue
    violacoes.push({
      severidade: 'HARD',
      regra: 'H18_FERIADO_SEM_CCT',
      colaborador_id: colabId,
      colaborador_nome: colabNome,
      mensagem: `${colabNome} não pode trabalhar em ${feriadoSemCCT.nome} (${data}) — feriado sem autorização CCT (Portaria MTE 3.665)`,
      data,
    })
  }

  return violacoes
}

/**
 * H19 — FOLGA_COMP_DOM
 * Para cada domingo trabalhado, o colaborador deve ter pelo menos uma folga
 * nos próximos 7 dias corridos (Lei 605/1949).
 */
export function checkH19(
  c: ColabMotor,
  dias: string[],
  mapa: Map<string, CelulaMotor>
): Violacao[] {
  const violacoes: Violacao[] = []

  for (let i = 0; i < dias.length; i++) {
    const data = dias[i]
    if (!isDomingo(data)) continue

    const cel = mapa.get(data)
    if (!cel || cel.status !== 'TRABALHO') continue

    // Verificar se há folga nos próximos CLT.FOLGA_COMPENSATORIA_DOM_DIAS dias
    const diasSeguintes = dias.slice(i + 1, i + 1 + CLT.FOLGA_COMPENSATORIA_DOM_DIAS)
    const temFolgaCompensatoria = diasSeguintes.some(d => {
      const celD = mapa.get(d)
      return celD?.status === 'FOLGA'
    })

    if (!temFolgaCompensatoria) {
      violacoes.push({
        severidade: 'HARD',
        regra: 'H19_FOLGA_COMP_DOM',
        colaborador_id: c.id,
        colaborador_nome: c.nome,
        mensagem: `${c.nome} trabalhou domingo ${data} sem folga compensatória nos ${CLT.FOLGA_COMPENSATORIA_DOM_DIAS} dias seguintes (Lei 605/1949)`,
        data,
      })
    }
  }

  return violacoes
}

// ─── Checkers v3.1: Regra hard de janela por colaborador + Folga fixa 5x2 ────

/**
 * Regra de horario individual resolvida para um (colaborador, dia).
 * Produzida pela bridge (precedencia: excecao_data > regra_colab > perfil_contrato).
 */
export interface RegraHorarioDiaResolvida {
  colaborador_id: number
  data: string
  inicio: string | null
  fim: string | null
  domingo_forcar_folga: boolean
  folga_fixa: boolean
}

/**
 * checkHardJanelaColaborador — Valida que ajuste manual respeita janela de horario.
 * Se colaborador tem regra ativa com inicio/fim, a celula deve estar dentro.
 * Violacao HARD (nao pode oficializar).
 */
export function checkHardJanelaColaborador(
  c: ColabMotor,
  diasOrdered: Array<[string, CelulaMotor]>,
  regras: RegraHorarioDiaResolvida[],
): Violacao[] {
  const violacoes: Violacao[] = []
  const regrasPorData = new Map<string, RegraHorarioDiaResolvida>()
  for (const r of regras) {
    if (r.colaborador_id === c.id) regrasPorData.set(r.data, r)
  }

  for (const [data, cel] of diasOrdered) {
    if (cel.status !== 'TRABALHO') continue
    if (!cel.hora_inicio || !cel.hora_fim) continue

    const regra = regrasPorData.get(data)
    if (!regra) continue

    const celInicioMin = timeToMin(cel.hora_inicio)
    const celFimMin = timeToMin(cel.hora_fim)

    // Inicio nao pode ser antes do inicio
    if (regra.inicio) {
      const limiteMin = timeToMin(regra.inicio)
      if (celInicioMin < limiteMin) {
        violacoes.push({
          severidade: 'HARD',
          regra: 'JANELA_COLABORADOR_INICIO',
          colaborador_id: c.id,
          colaborador_nome: c.nome,
          mensagem: `${c.nome} inicia as ${cel.hora_inicio} em ${data} mas a regra individual permite inicio a partir de ${regra.inicio}`,
          data,
        })
      }
    }

    // Fim nao pode ser depois do fim
    if (regra.fim) {
      const limiteMax = timeToMin(regra.fim)
      if (celFimMin > limiteMax) {
        violacoes.push({
          severidade: 'HARD',
          regra: 'JANELA_COLABORADOR_FIM',
          colaborador_id: c.id,
          colaborador_nome: c.nome,
          mensagem: `${c.nome} sai as ${cel.hora_fim} em ${data} mas a regra individual permite saida ate ${regra.fim}`,
          data,
        })
      }
    }

    // Domingo forcar folga — se esta como TRABALHO e regra diz folga
    if (regra.domingo_forcar_folga) {
      violacoes.push({
        severidade: 'HARD',
        regra: 'DOMINGO_FORCAR_FOLGA',
        colaborador_id: c.id,
        colaborador_nome: c.nome,
        mensagem: `${c.nome} esta alocado em ${data} mas tem excecao de folga obrigatoria neste domingo`,
        data,
      })
    }

    // Folga fixa — se esta como TRABALHO e regra diz folga fixa
    if (regra.folga_fixa) {
      violacoes.push({
        severidade: 'HARD',
        regra: 'FOLGA_FIXA_5X2',
        colaborador_id: c.id,
        colaborador_nome: c.nome,
        mensagem: `${c.nome} esta alocado em ${data} mas tem folga fixa configurada neste dia da semana`,
        data,
      })
    }
  }

  return violacoes
}

// ─── Orquestrador geral H1-H20 ───────────────────────────────────────────────

export interface ValidarTudoParams {
  colaboradores: ColabMotor[]
  resultado: Map<number, Map<string, CelulaMotor>>   // colabId → (data → celula)
  demandas: Demanda[]
  dias: string[]                                      // sorted YYYY-MM-DD
  feriados: Feriado[]
  excecoes: Excecao[]
  lookback: Map<number, LookbackV3>                   // colabId → lookback
  tolerancia_min: number
  empresa: Empresa
  corte_semanal: string                               // ex: 'SEG_DOM', 'DOM_SAB'
}

/**
 * validarTudoV3 — Orquestrador de todas as 20 regras HARD (H1-H20).
 * Chamada tanto pelo gerador (Fase 6) quanto pelo validador pós-ajuste.
 * Retorna SOMENTE violações com severidade='HARD'.
 */
export function validarTudoV3(params: ValidarTudoParams): Violacao[] {
  const { colaboradores, resultado, dias, feriados, excecoes, lookback,
    tolerancia_min, empresa, corte_semanal } = params

  const violacoes: Violacao[] = []

  // Calcular semanas uma vez (compartilhado entre colaboradores)
  const semanas = getWeeks(dias, corte_semanal)

  // Domingos do período
  const domingos = dias.filter(d => isDomingo(d))

  // ── Por colaborador ────────────────────────────────────────────────────────
  for (const c of colaboradores) {
    const mapa = resultado.get(c.id) ?? new Map<string, CelulaMotor>()

    // diasOrdered: Array<[string, CelulaMotor]> sorted by date
    const diasOrdered: Array<[string, CelulaMotor]> = dias
      .filter(d => mapa.has(d))
      .map(d => [d, mapa.get(d)!])

    const lb: LookbackV3 = lookback.get(c.id) ?? {
      diasConsec: 0,
      domConsec: 0,
      ultimaHoraFim: null,
    }

    // H1 — max dias consecutivos (por colaborador)
    violacoes.push(...checkH1(c, diasOrdered, lb))

    // H2 — descanso entre jornadas (por colaborador)
    violacoes.push(...checkH2(c, diasOrdered, lb))

    // H2b — DSR interjornada (por colaborador)
    violacoes.push(...checkH2b(c, diasOrdered))

    // H3 — rodízio de domingo (v3.1: SOFT — nao bloqueia, apenas indicador)
    // Retornado junto com as violacoes para o dashboard, mas com severidade SOFT
    violacoes.push(...checkH3(c, domingos, mapa, lb))

    // H4 — max jornada diária (por colaborador, itera internamente)
    violacoes.push(...checkH4(c, diasOrdered))

    // H5 — exceções respeitadas (por colaborador, itera internamente)
    violacoes.push(...checkH5(c, diasOrdered, excecoes))

    // H19 — folga compensatória de domingo (por colaborador, vê todos os dias)
    violacoes.push(...checkH19(c, dias, mapa))

    // ── Por dia de trabalho (célula) ─────────────────────────────────────────
    for (const [data, cel] of diasOrdered) {
      if (cel.status !== 'TRABALHO') continue

      // H6 — almoço obrigatório
      violacoes.push(...checkH6(cel, c, data))

      // H7 — intervalo curto (>4h e <=6h → 15min obrigatório)
      violacoes.push(...checkH7(cel, c, data))

      // H8 — grid de horários (múltiplos de 30min)
      violacoes.push(...checkH8(cel, c, data))

      // H9 — max saída e volta (max 2 blocos por dia)
      violacoes.push(...checkH9(cel, c, data))

      // H11 — aprendiz nunca domingo
      violacoes.push(...checkH11(c, data, cel))

      // H12 — aprendiz nunca feriado
      violacoes.push(...checkH12(c, data, cel, feriados))

      // H13 — aprendiz nunca noturno (22h-5h)
      violacoes.push(...checkH13(c, cel, data))

      // H20 — almoço nunca na 1ª ou última hora
      violacoes.push(...checkH20(cel, c, data))
    }

    // ── Por semana ───────────────────────────────────────────────────────────
    for (const semana of semanas) {
      // Mapa restrito à semana para os checkers semanais
      const mapaSemana = new Map<string, CelulaMotor>()
      for (const d of semana) {
        const cel = mapa.get(d)
        if (cel) mapaSemana.set(d, cel)
      }

      // H10 — meta semanal
      violacoes.push(...checkH10(c, semana, mapaSemana, tolerancia_min, empresa))

      // H14 — aprendiz hora extra (diário + semanal)
      violacoes.push(...checkH14(c, semana, mapaSemana))

      // H15 — estagiário jornada (diário + semanal)
      violacoes.push(...checkH15(c, semana, mapaSemana))

      // H16 — estagiário hora extra (semanal)
      violacoes.push(...checkH16(c, semana, mapaSemana))
    }
  }

  // ── Por dia (todas as colaboradores — H17 e H18) ──────────────────────────
  for (const data of dias) {
    // Montar alocacoesDia com identidade do colaborador
    const alocacoesDia: Array<{ colabId: number; colabNome: string; cel: CelulaMotor }> = []
    for (const c of colaboradores) {
      const mapa = resultado.get(c.id)
      if (!mapa) continue
      const cel = mapa.get(data)
      if (!cel) continue
      alocacoesDia.push({ colabId: c.id, colabNome: c.nome, cel })
    }

    // H17 — feriado proibido (25/12 e 01/01 — CCT FecomercioSP)
    violacoes.push(...checkH17(data, alocacoesDia))

    // H18 — feriado sem CCT (cct_autoriza = false)
    violacoes.push(...checkH18(data, feriados, alocacoesDia))
  }

  return violacoes
}

// ─── Checkers Antipatterns Tier 1 (AP1, AP3, AP4, AP7, AP15, AP16) ──────────

/**
 * AP1 — CLOPENING
 * Descanso confortável: se possível, manter >= 13h entre jornadas.
 * (11h = mínimo legal HARD via H2; 13h = mínimo confortável AP Tier 1)
 * Peso: ANTIPATTERNS.PESO_CLOPENING (-15) por ocorrência.
 */
export function checkAP1_Clopening(
  c: ColabMotor,
  diasOrdered: Array<[string, CelulaMotor]>
): AntipatternViolacao[] {
  const violacoes: AntipatternViolacao[] = []
  let horaFimAnterior: string | null = null

  for (const [data, cel] of diasOrdered) {
    if (cel.status === 'TRABALHO' && cel.hora_inicio !== null && cel.hora_fim !== null) {
      if (horaFimAnterior !== null) {
        const fimMin = timeToMin(horaFimAnterior)
        const inicioMin = timeToMin(cel.hora_inicio)
        const descansoMin = (1440 - fimMin) + inicioMin

        if (descansoMin < ANTIPATTERNS.CLOPENING_MIN_DESCANSO_CONFORTAVEL_MIN) {
          const horas = Math.floor(descansoMin / 60)
          const mins = descansoMin % 60
          violacoes.push({
            tier: 1,
            antipattern: 'AP1',
            nome_industria: 'Clopening',
            peso: ANTIPATTERNS.PESO_CLOPENING,
            colaborador_id: c.id,
            data,
            mensagem_rh: `${c.nome} fecha e abre com apenas ${horas}h${mins > 0 ? mins + 'min' : ''} de descanso em ${data} (recomendado mínimo 13h para qualidade de vida)`,
            sugestao: `Considere iniciar o turno de ${data} mais tarde para garantir ao menos 13h de descanso`,
          })
        }
      }
      horaFimAnterior = cel.hora_fim
    } else if (cel.status !== 'TRABALHO') {
      horaFimAnterior = null
    }
  }

  return violacoes
}

/**
 * AP3 — LUNCH COLLISION
 * Mais de 50% dos colaboradores do setor almoçando no mesmo slot de 30min.
 * Peso: ANTIPATTERNS.PESO_ALMOCO_SIMULTANEO (-20) por slot violado.
 */
export function checkAP3_LunchCollision(
  data: string,
  colaboradores: ColabMotor[],
  resultado: Map<number, Map<string, CelulaMotor>>
): AntipatternViolacao[] {
  const violacoes: AntipatternViolacao[] = []

  // Identificar colaboradores que trabalham neste dia
  const colabsTrabalhando: ColabMotor[] = colaboradores.filter(c => {
    const mapa = resultado.get(c.id)
    const cel = mapa?.get(data)
    return cel?.status === 'TRABALHO'
  })

  if (colabsTrabalhando.length === 0) return []

  // Coletar todos os slots de almoço de 30min (hora_almoco_inicio)
  const almocosPorSlot = new Map<string, number>()

  for (const c of colabsTrabalhando) {
    const mapa = resultado.get(c.id)
    const cel = mapa?.get(data)
    if (!cel || cel.hora_almoco_inicio === null) continue

    const slot = cel.hora_almoco_inicio // 'HH:MM' já no grid de 30min
    almocosPorSlot.set(slot, (almocosPorSlot.get(slot) ?? 0) + 1)
  }

  const limiteSimultaneo = Math.ceil(colabsTrabalhando.length * ANTIPATTERNS.ALMOCO_MAX_SIMULTANEO_PERCENT / 100)

  for (const [slot, qtd] of almocosPorSlot.entries()) {
    if (qtd > limiteSimultaneo) {
      violacoes.push({
        tier: 1,
        antipattern: 'AP3',
        nome_industria: 'Lunch Collision',
        peso: ANTIPATTERNS.PESO_ALMOCO_SIMULTANEO,
        colaborador_id: colabsTrabalhando[0].id, // representativo — colisão é do setor
        data,
        mensagem_rh: `${qtd} de ${colabsTrabalhando.length} colaboradores estão almoçando ao mesmo tempo às ${slot} em ${data} (máximo recomendado: ${limiteSimultaneo})`,
        sugestao: `Escalone os almoços em intervalos de 30min para nunca deixar o setor sem cobertura`,
      })
    }
  }

  return violacoes
}

/**
 * AP4 — WORKLOAD IMBALANCE
 * Desvio de horas semanais entre colaboradores do mesmo tipo de contrato.
 * Peso: ANTIPATTERNS.PESO_HORA_EXTRA_EVITAVEL (-8) por hora de desvio acima da margem.
 */
export function checkAP4_WorkloadImbalance(
  colaboradores: ColabMotor[],
  resultado: Map<number, Map<string, CelulaMotor>>,
  dias: string[]
): AntipatternViolacao[] {
  const violacoes: AntipatternViolacao[] = []

  // Agrupar colaboradores por horas_semanais (proxy para tipo de contrato)
  const gruposPorContrato = new Map<number, ColabMotor[]>()
  for (const c of colaboradores) {
    const grupo = gruposPorContrato.get(c.horas_semanais) ?? []
    grupo.push(c)
    gruposPorContrato.set(c.horas_semanais, grupo)
  }

  for (const [, grupo] of gruposPorContrato.entries()) {
    if (grupo.length < 2) continue

    // Calcular horas totais do período para cada colab do grupo
    const horasPorColab = new Map<number, number>()
    for (const c of grupo) {
      const mapa = resultado.get(c.id)
      if (!mapa) {
        horasPorColab.set(c.id, 0)
        continue
      }
      let totalMin = 0
      for (const data of dias) {
        const cel = mapa.get(data)
        if (cel?.status === 'TRABALHO') totalMin += cel.minutos_trabalho
      }
      horasPorColab.set(c.id, totalMin)
    }

    const valores = Array.from(horasPorColab.values())
    const media = valores.reduce((a, b) => a + b, 0) / valores.length
    // Margem de redistribuição (ANTIPATTERNS.HORA_EXTRA_MARGEM_REDISTRIBUICAO_MIN = 60min)
    const margem = ANTIPATTERNS.HORA_EXTRA_MARGEM_REDISTRIBUICAO_MIN

    for (const c of grupo) {
      const totalMin = horasPorColab.get(c.id) ?? 0
      const desvioMin = totalMin - media

      // Só penalizar quem tem MAIS que a média + margem (hora extra evitável)
      if (desvioMin > margem) {
        const desvioHoras = Math.floor(desvioMin / 60)
        const desvioMins = desvioMin % 60
        violacoes.push({
          tier: 1,
          antipattern: 'AP4',
          nome_industria: 'Workload Imbalance',
          peso: ANTIPATTERNS.PESO_HORA_EXTRA_EVITAVEL * Math.ceil(desvioMin / 60),
          colaborador_id: c.id,
          mensagem_rh: `${c.nome} trabalhou ${desvioHoras}h${desvioMins > 0 ? desvioMins + 'min' : ''} a mais que a média dos colegas do mesmo contrato — hora extra evitável que poderia ser redistribuída`,
          sugestao: `Redistribua ${desvioHoras}h para colaboradores abaixo da média`,
        })
      }
    }
  }

  return violacoes
}

/**
 * AP7 — WEEKEND STARVATION
 * Colaborador sem nenhum fim de semana livre (sab+dom) em N semanas consecutivas.
 * Peso: ANTIPATTERNS.PESO_SEM_FIM_DE_SEMANA (-8) quando exceder o limiar.
 */
export function checkAP7_WeekendStarvation(
  c: ColabMotor,
  semanas: string[][],
  resultado: Map<number, Map<string, CelulaMotor>>
): AntipatternViolacao[] {
  const violacoes: AntipatternViolacao[] = []
  const mapa = resultado.get(c.id)
  if (!mapa) return []

  let semanasSemFds = 0

  for (const semana of semanas) {
    // Verificar se há pelo menos 1 dia de fim de semana livre (sab ou dom) nesta semana
    const temFdsl = semana.some(data => {
      const diaSem = new Date(data + 'T12:00:00').getDay()
      const ehFds = diaSem === 0 || diaSem === 6 // dom=0, sab=6
      if (!ehFds) return false
      const cel = mapa.get(data)
      return !cel || cel.status === 'FOLGA' || cel.status === 'INDISPONIVEL'
    })

    if (temFdsl) {
      semanasSemFds = 0
    } else {
      semanasSemFds++
    }

    if (semanasSemFds >= ANTIPATTERNS.FIM_SEMANA_MAX_SEMANAS_SEM) {
      const semanaRef = semana[0]
      violacoes.push({
        tier: 1,
        antipattern: 'AP7',
        nome_industria: 'Weekend Starvation',
        peso: ANTIPATTERNS.PESO_SEM_FIM_DE_SEMANA,
        colaborador_id: c.id,
        data: semanaRef,
        mensagem_rh: `${c.nome} está há ${semanasSemFds} semanas consecutivas sem nenhum sábado ou domingo livre — vida social e descanso comprometidos`,
        sugestao: `Garantir ao menos 1 fim de semana livre a cada 4-5 semanas para ${c.nome}`,
      })
    }
  }

  return violacoes
}

/**
 * AP15 — PEAK DAY CLUSTERING
 * Dias de maior demanda com menos cobertura que dias calmos.
 * Peso: ANTIPATTERNS.PESO_MARATONA_PICO (-6) quando padrão detectado.
 */
export function checkAP15_PeakDayClustering(
  dias: string[],
  demandas: Demanda[],
  resultado: Map<number, Map<string, CelulaMotor>>,
  colaboradores: ColabMotor[]
): AntipatternViolacao[] {
  if (dias.length < 2) return []

  // Calcular demanda total por dia (soma de min_pessoas das demandas do dia)
  const demandaPorDia = new Map<string, number>()
  for (const data of dias) {
    const diaSem = new Date(data + 'T12:00:00').getDay()
    const diasSemana: Array<string> = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB']
    const diaLabel = diasSemana[diaSem]
    const demandasDoDia = demandas.filter(d => d.dia_semana === diaLabel || d.dia_semana === null)
    const totalDemanda = demandasDoDia.reduce((sum, d) => sum + d.min_pessoas, 0)
    demandaPorDia.set(data, totalDemanda)
  }

  if (demandaPorDia.size === 0) return []

  const valores = Array.from(demandaPorDia.values())
  const mediaDemanda = valores.reduce((a, b) => a + b, 0) / valores.length

  // Classificar dias como pico (> média) ou calmo (<= média)
  const diasPico = dias.filter(d => (demandaPorDia.get(d) ?? 0) > mediaDemanda)
  const diasCalmos = dias.filter(d => (demandaPorDia.get(d) ?? 0) <= mediaDemanda)

  if (diasPico.length === 0 || diasCalmos.length === 0) return []

  // Calcular cobertura média em dias de pico vs dias calmos
  const coberturaMedia = (diasFiltrados: string[]): number => {
    let totalCobertura = 0
    let totalSlots = 0
    for (const data of diasFiltrados) {
      let coberturaNoSlot = 0
      for (const c of colaboradores) {
        const mapa = resultado.get(c.id)
        const cel = mapa?.get(data)
        if (cel?.status === 'TRABALHO') coberturaNoSlot++
      }
      totalCobertura += coberturaNoSlot
      totalSlots++
    }
    return totalSlots > 0 ? totalCobertura / totalSlots : 0
  }

  const coberturaPico = coberturaMedia(diasPico)
  const coberturaCalmo = coberturaMedia(diasCalmos)

  const violacoes: AntipatternViolacao[] = []

  // Se dias de pico têm MENOS cobertura que dias calmos → antipattern
  if (coberturaPico < coberturaCalmo) {
    // Reportar por colaborador representativo (o de maior rank)
    const colabRef = colaboradores.reduce((prev, curr) => curr.rank > prev.rank ? curr : prev, colaboradores[0])
    violacoes.push({
      tier: 1,
      antipattern: 'AP15',
      nome_industria: 'Peak Day Clustering',
      peso: ANTIPATTERNS.PESO_MARATONA_PICO,
      colaborador_id: colabRef?.id ?? 0,
      mensagem_rh: `Dias de maior demanda têm menos cobertura (${coberturaPico.toFixed(1)} pessoas) que dias calmos (${coberturaCalmo.toFixed(1)} pessoas) — alocação inversa ao necessário`,
      sugestao: `Concentre mais colaboradores nos dias de maior demanda (${diasPico.slice(0, 3).join(', ')}...)`,
    })
  }

  return violacoes
}

/**
 * AP16 — UNSUPERVISED JUNIOR
 * Colaborador com rank < JUNIOR_SOZINHO_RANK_MINIMO sozinho num slot sem senior presente.
 * Peso: ANTIPATTERNS.PESO_JUNIOR_SOZINHO (-12) por slot com junior sozinho.
 */
export function checkAP16_UnsupervisedJunior(
  data: string,
  slot: { hora_inicio: string; hora_fim: string },
  colaboradores: ColabMotor[],
  resultado: Map<number, Map<string, CelulaMotor>>
): AntipatternViolacao[] {
  const rankMinimo = ANTIPATTERNS.JUNIOR_SOZINHO_RANK_MINIMO

  // Identificar quem está trabalhando neste slot
  const presentes: ColabMotor[] = colaboradores.filter(c => {
    const mapa = resultado.get(c.id)
    const cel = mapa?.get(data)
    if (!cel || cel.status !== 'TRABALHO') return false
    if (!cel.hora_inicio || !cel.hora_fim) return false

    const slotInicioMin = timeToMin(slot.hora_inicio)
    const slotFimMin = timeToMin(slot.hora_fim)
    const celInicioMin = timeToMin(cel.hora_inicio)
    const celFimMin = timeToMin(cel.hora_fim)

    // Colab cobre o slot se seu turno engloba o slot (excluindo período de almoço)
    const coberturaBasica = celInicioMin <= slotInicioMin && celFimMin >= slotFimMin

    if (!coberturaBasica) return false

    // Excluir se está em almoço durante este slot
    if (cel.hora_almoco_inicio && cel.hora_almoco_fim) {
      const almocoInicioMin = timeToMin(cel.hora_almoco_inicio)
      const almocoFimMin = timeToMin(cel.hora_almoco_fim)
      if (slotInicioMin >= almocoInicioMin && slotFimMin <= almocoFimMin) return false
    }

    return true
  })

  if (presentes.length === 0) return []

  const violacoes: AntipatternViolacao[] = []

  // Verificar se há pelo menos 1 senior (rank >= rankMinimo)
  const temSenior = presentes.some(c => c.rank >= rankMinimo)

  if (!temSenior) {
    // Todos são juniors — reportar o de menor rank
    const juniorMaisNovo = presentes.reduce((prev, curr) => curr.rank < prev.rank ? curr : prev, presentes[0])
    violacoes.push({
      tier: 1,
      antipattern: 'AP16',
      nome_industria: 'Unsupervised Junior',
      peso: ANTIPATTERNS.PESO_JUNIOR_SOZINHO,
      colaborador_id: juniorMaisNovo.id,
      data,
      mensagem_rh: `${presentes.length === 1 ? `${juniorMaisNovo.nome} (rank ${juniorMaisNovo.rank}) está sozinho` : `Todos presentes são júnior`} no slot ${slot.hora_inicio}-${slot.hora_fim} em ${data} sem nenhum colaborador experiente (rank >= ${rankMinimo})`,
      sugestao: `Garanta pelo menos 1 colaborador com rank >= ${rankMinimo} no slot ${slot.hora_inicio}-${slot.hora_fim}`,
    })
  }

  return violacoes
}

// ─── Checkers Antipatterns Tier 2 (AP2, AP5, AP6, AP8, AP9, AP10) ────────────

/**
 * AP2 — SCHEDULE INSTABILITY (Ioiô)
 * Variação de hora_inicio entre dias de trabalho.
 * > 2h: peso PESO_IOIO_GRAVE (-10). Entre 1h e 2h: peso PESO_IOIO_MODERADO (-5).
 */
export function checkAP2_ScheduleInstability(
  c: ColabMotor,
  diasOrdered: Array<[string, CelulaMotor]>
): AntipatternViolacao[] {
  const violacoes: AntipatternViolacao[] = []

  // Coletar hora_inicio dos dias de trabalho
  const inicios: Array<[string, number]> = diasOrdered
    .filter(([, cel]) => cel.status === 'TRABALHO' && cel.hora_inicio !== null)
    .map(([data, cel]) => [data, timeToMin(cel.hora_inicio!)])

  if (inicios.length < 2) return []

  // Calcular variação máxima (max - min)
  const valores = inicios.map(([, min]) => min)
  const maxInicio = Math.max(...valores)
  const minInicio = Math.min(...valores)
  const variacao = maxInicio - minInicio

  const limiteGrave = ANTIPATTERNS.HORARIO_VARIACAO_MAX_ACEITAVEL_MIN   // 120 = 2h
  const limiteModerado = ANTIPATTERNS.HORARIO_VARIACAO_MAX_IDEAL_MIN    // 60 = 1h

  if (variacao > limiteGrave) {
    const [dataMaior] = inicios.find(([, m]) => m === maxInicio)!
    violacoes.push({
      tier: 2,
      antipattern: 'AP2',
      nome_industria: 'Schedule Instability',
      peso: ANTIPATTERNS.PESO_IOIO_GRAVE,
      colaborador_id: c.id,
      data: dataMaior,
      mensagem_rh: `${c.nome} tem variação de ${Math.floor(variacao / 60)}h${variacao % 60 > 0 ? variacao % 60 + 'min' : ''} no horário de entrada ao longo da semana (máximo recomendado: 2h) — ritmo circadiano comprometido`,
      sugestao: `Mantenha o horário de entrada de ${c.nome} mais consistente entre os dias`,
    })
  } else if (variacao > limiteModerado) {
    const [dataMaior] = inicios.find(([, m]) => m === maxInicio)!
    violacoes.push({
      tier: 2,
      antipattern: 'AP2',
      nome_industria: 'Schedule Instability',
      peso: ANTIPATTERNS.PESO_IOIO_MODERADO,
      colaborador_id: c.id,
      data: dataMaior,
      mensagem_rh: `${c.nome} tem variação de ${Math.floor(variacao / 60)}h${variacao % 60 > 0 ? variacao % 60 + 'min' : ''} no horário de entrada ao longo da semana (ideal: até 1h)`,
      sugestao: `Tente manter o horário de entrada de ${c.nome} com variação menor que 1h`,
    })
  }

  return violacoes
}

/**
 * AP5 — ISOLATED DAY OFF
 * Folga cercada de trabalho nos dois lados (não agrega descanso real).
 * Peso: ANTIPATTERNS.PESO_FOLGA_ISOLADA (-5) por folga isolada.
 */
export function checkAP5_IsolatedDayOff(
  c: ColabMotor,
  diasOrdered: Array<[string, CelulaMotor]>
): AntipatternViolacao[] {
  const violacoes: AntipatternViolacao[] = []

  for (let i = 1; i < diasOrdered.length - 1; i++) {
    const [, celAnterior] = diasOrdered[i - 1]
    const [dataFolga, celFolga] = diasOrdered[i]
    const [, celProxima] = diasOrdered[i + 1]

    if (celFolga.status !== 'FOLGA') continue
    if (celAnterior.status !== 'TRABALHO') continue
    if (celProxima.status !== 'TRABALHO') continue

    // Folga está "sanduíchada" entre dois dias de trabalho
    violacoes.push({
      tier: 2,
      antipattern: 'AP5',
      nome_industria: 'Isolated Day Off',
      peso: ANTIPATTERNS.PESO_FOLGA_ISOLADA,
      colaborador_id: c.id,
      data: dataFolga,
      mensagem_rh: `${c.nome} tem folga isolada em ${dataFolga} entre dois dias de trabalho — folga no meio da semana não agrega descanso real`,
      sugestao: `Agrupe as folgas de ${c.nome} em bloco (ex: sáb+dom) para um descanso mais efetivo`,
    })
  }

  return violacoes
}

/**
 * AP6 — SHIFT INEQUITY
 * Distribuição injusta de aberturas/fechamentos entre colaboradores.
 * Peso: ANTIPATTERNS.PESO_TURNOS_INJUSTOS (-3) por colaborador com distribuição desigual.
 */
export function checkAP6_ShiftInequity(
  colaboradores: ColabMotor[],
  resultado: Map<number, Map<string, CelulaMotor>>,
  dias: string[]
): AntipatternViolacao[] {
  if (colaboradores.length < 2) return []

  // Contar aberturas (hora_inicio mais cedo do dia) e fechamentos (hora_fim mais tarde)
  // por colaborador ao longo do período
  const aberturasColab = new Map<number, number>()
  const fechamentosColab = new Map<number, number>()

  for (const c of colaboradores) {
    aberturasColab.set(c.id, 0)
    fechamentosColab.set(c.id, 0)
  }

  for (const data of dias) {
    // Encontrar horário mais cedo e mais tarde do dia
    let menorInicio: number | null = null
    let maiorFim: number | null = null
    const trabalhando: Array<{ c: ColabMotor; inicioMin: number; fimMin: number }> = []

    for (const c of colaboradores) {
      const mapa = resultado.get(c.id)
      const cel = mapa?.get(data)
      if (!cel || cel.status !== 'TRABALHO' || !cel.hora_inicio || !cel.hora_fim) continue

      const inicioMin = timeToMin(cel.hora_inicio)
      const fimMin = timeToMin(cel.hora_fim)
      trabalhando.push({ c, inicioMin, fimMin })

      if (menorInicio === null || inicioMin < menorInicio) menorInicio = inicioMin
      if (maiorFim === null || fimMin > maiorFim) maiorFim = fimMin
    }

    if (trabalhando.length === 0) continue

    // Quem abre (tem o início mais cedo, com tolerância de 30min do grid)
    for (const { c, inicioMin } of trabalhando) {
      if (menorInicio !== null && inicioMin <= menorInicio) {
        aberturasColab.set(c.id, (aberturasColab.get(c.id) ?? 0) + 1)
      }
    }

    // Quem fecha (tem o fim mais tarde, com tolerância de 30min do grid)
    for (const { c, fimMin } of trabalhando) {
      if (maiorFim !== null && fimMin >= maiorFim) {
        fechamentosColab.set(c.id, (fechamentosColab.get(c.id) ?? 0) + 1)
      }
    }
  }

  const violacoes: AntipatternViolacao[] = []

  // Calcular desvio entre o máximo e mínimo de aberturas
  const abert = colaboradores.map(c => aberturasColab.get(c.id) ?? 0)
  const fech = colaboradores.map(c => fechamentosColab.get(c.id) ?? 0)
  const maxAbert = Math.max(...abert)
  const minAbert = Math.min(...abert)
  const maxFech = Math.max(...fech)
  const minFech = Math.min(...fech)

  // Penaliza quando o desvio é maior que 2 (uma pessoa tem muito mais aberturas ou fechamentos)
  const limiteDesvio = 2

  if (maxAbert - minAbert > limiteDesvio || maxFech - minFech > limiteDesvio) {
    // Identificar o colaborador mais penalizado (mais aberturas)
    const maisAbertura = colaboradores.reduce((prev, curr) =>
      (aberturasColab.get(curr.id) ?? 0) > (aberturasColab.get(prev.id) ?? 0) ? curr : prev,
      colaboradores[0]
    )
    violacoes.push({
      tier: 2,
      antipattern: 'AP6',
      nome_industria: 'Shift Inequity',
      peso: ANTIPATTERNS.PESO_TURNOS_INJUSTOS,
      colaborador_id: maisAbertura.id,
      mensagem_rh: `Distribuição injusta de aberturas (variação de ${maxAbert - minAbert}) e fechamentos (variação de ${maxFech - minFech}) entre colaboradores — a mesma pessoa sempre abre/fecha`,
      sugestao: `Implemente rodízio de abertura e fechamento para distribuir igualmente entre os colaboradores`,
    })
  }

  return violacoes
}

/**
 * AP8 — MEAL TIME DEVIATION
 * Almoço fora da janela ideal 11:00-13:30.
 * Fora do ideal: PESO_ALMOCO_FORA_IDEAL (-3). Extremo (antes 10:30 ou depois 14:00): PESO_ALMOCO_FORA_ACEITAVEL (-8).
 */
export function checkAP8_MealTimeDeviation(
  c: ColabMotor,
  diasOrdered: Array<[string, CelulaMotor]>
): AntipatternViolacao[] {
  const violacoes: AntipatternViolacao[] = []

  const idealInicioMin = timeToMin(ANTIPATTERNS.ALMOCO_HORARIO_IDEAL_INICIO)     // 11:00 = 660
  const idealFimMin = timeToMin(ANTIPATTERNS.ALMOCO_HORARIO_IDEAL_FIM)           // 13:30 = 810
  // Janela aceitável: 10:30-14:00 (inferida da lógica do RFC — ANTIPATTERNS não tem esses campos,
  // usar constante documentada: 30min antes/depois do ideal)
  const aceitavelInicioMin = idealInicioMin - 30   // 10:30 = 630
  const aceitavelFimMin = idealFimMin + 30         // 14:00 = 840

  for (const [data, cel] of diasOrdered) {
    if (cel.status !== 'TRABALHO') continue
    if (cel.hora_almoco_inicio === null) continue

    const almocoInicioMin = timeToMin(cel.hora_almoco_inicio)

    if (almocoInicioMin < aceitavelInicioMin || almocoInicioMin > aceitavelFimMin) {
      // Extremo: fora da janela aceitável
      violacoes.push({
        tier: 2,
        antipattern: 'AP8',
        nome_industria: 'Meal Time Deviation',
        peso: ANTIPATTERNS.PESO_ALMOCO_FORA_ACEITAVEL,
        colaborador_id: c.id,
        data,
        mensagem_rh: `${c.nome} almoça às ${cel.hora_almoco_inicio} em ${data} — horário fora do intervalo aceitável (10:30-14:00). Funcionário pode passar horas com fome ou almoçar muito cedo`,
        sugestao: `Posicione o almoço de ${c.nome} entre 11:00-13:30 para maior conforto`,
      })
    } else if (almocoInicioMin < idealInicioMin || almocoInicioMin > idealFimMin) {
      // Fora do ideal mas dentro do aceitável
      violacoes.push({
        tier: 2,
        antipattern: 'AP8',
        nome_industria: 'Meal Time Deviation',
        peso: ANTIPATTERNS.PESO_ALMOCO_FORA_IDEAL,
        colaborador_id: c.id,
        data,
        mensagem_rh: `${c.nome} almoça às ${cel.hora_almoco_inicio} em ${data} — fora da janela ideal de 11:00-13:30`,
        sugestao: `Prefira posicionar o almoço de ${c.nome} entre 11:00-13:30`,
      })
    }
  }

  return violacoes
}

/**
 * AP9 — COMMUTE-TO-WORK RATIO
 * Dia com menos de 5h (DIA_CURTO_MINIMO_PREFERIDO_MIN = 300min) de trabalho efetivo.
 * O deslocamento não compensa a jornada curta.
 * Peso: ANTIPATTERNS.PESO_DIA_CURTO (-2) por dia curto.
 */
export function checkAP9_CommuteToWorkRatio(
  c: ColabMotor,
  diasOrdered: Array<[string, CelulaMotor]>
): AntipatternViolacao[] {
  const violacoes: AntipatternViolacao[] = []
  const minimoPreferido = ANTIPATTERNS.DIA_CURTO_MINIMO_PREFERIDO_MIN // 300min = 5h

  for (const [data, cel] of diasOrdered) {
    if (cel.status !== 'TRABALHO') continue
    if (cel.minutos_trabalho < minimoPreferido) {
      const horas = Math.floor(cel.minutos_trabalho / 60)
      const mins = cel.minutos_trabalho % 60
      violacoes.push({
        tier: 2,
        antipattern: 'AP9',
        nome_industria: 'Commute-to-Work Ratio',
        peso: ANTIPATTERNS.PESO_DIA_CURTO,
        colaborador_id: c.id,
        data,
        mensagem_rh: `${c.nome} trabalha apenas ${horas}h${mins > 0 ? mins + 'min' : ''} em ${data} — dia curto que pode não compensar o deslocamento`,
        sugestao: `Redistribua horas para que ${c.nome} tenha pelo menos 5h nos dias de trabalho`,
      })
    }
  }

  return violacoes
}

/**
 * AP10 — OVERSTAFFING COST
 * Mais pessoas alocadas que o target da demanda em slots não-override.
 * Peso: ANTIPATTERNS.PESO_HORA_MORTA (-3) por pessoa excedente por slot.
 */
export function checkAP10_OverstaffingCost(
  data: string,
  slot: { hora_inicio: string; hora_fim: string; target_planejado: number; override: boolean },
  _demandas: Demanda[],
  resultado: Map<number, Map<string, CelulaMotor>>,
  colaboradores: ColabMotor[]
): AntipatternViolacao[] {
  const slotInicioMin = timeToMin(slot.hora_inicio)
  const slotFimMin = timeToMin(slot.hora_fim)
  if (slot.override) return []
  const target = slot.target_planejado

  // Contar quantos colaboradores cobrem este slot (trabalhando e não em almoço)
  const presentes = countExecutadoNoSlot({
    data,
    slotInicioMin,
    slotFimMin,
    colaboradores,
    resultado,
  })

  // Margem de 1 extra aceitável (alinhado com o doc ANTIPATTERNS: "demanda + 1 margem")
  const excedentes = presentes - (target + 1)

  if (excedentes <= 0) return []

  const colabRef = colaboradores[0]
  return [{
    tier: 2,
    antipattern: 'AP10',
    nome_industria: 'Overstaffing Cost',
    peso: ANTIPATTERNS.PESO_HORA_MORTA * excedentes,
    colaborador_id: colabRef?.id ?? 0,
    data,
    mensagem_rh: `Slot ${slot.hora_inicio}-${slot.hora_fim} em ${data} tem ${presentes} pessoas mas demanda é ${target} — ${excedentes} pessoa(s) excedente(s) (hora morta evitável)`,
    sugestao: `Reduza a alocação no slot ${slot.hora_inicio}-${slot.hora_fim} para max ${target + 1} colaboradores`,
  }]
}

// ─── SOFT Scorers (S1-S5) — retornam número (penalidade negativa) ─────────────

/**
 * S1 — PREFERE_TURNO
 * Se o colaborador tem prefere_turno e o turno alocado não corresponde → penalidade.
 * Turno 'MANHA': hora_inicio < 12:00. Turno 'TARDE': hora_inicio >= 12:00.
 * Peso: -2 por dia com preferência não atendida.
 */
export function checkS1_PrefereTurno(
  c: ColabMotor,
  diasOrdered: Array<[string, CelulaMotor]>
): number {
  if (!c.prefere_turno) return 0

  let penalidade = 0

  for (const [, cel] of diasOrdered) {
    if (cel.status !== 'TRABALHO' || cel.hora_inicio === null) continue

    const inicioMin = timeToMin(cel.hora_inicio)
    const turnoAlocado = inicioMin < 720 ? 'MANHA' : 'TARDE' // 720 = 12:00

    if (turnoAlocado !== c.prefere_turno) {
      penalidade += -2 // -2 por dia com preferência não atendida
    }
  }

  return penalidade
}

/**
 * S2 — EVITAR_DIA
 * Se o colaborador tem evitar_dia_semana e trabalha nesse dia → penalidade.
 * Peso: -3 por ocorrência.
 */
export function checkS2_EvitarDia(
  c: ColabMotor,
  diasOrdered: Array<[string, CelulaMotor]>
): number {
  if (!c.evitar_dia_semana) return 0

  let penalidade = 0

  for (const [data, cel] of diasOrdered) {
    if (cel.status !== 'TRABALHO') continue
    if (diaSemana(data) === c.evitar_dia_semana) {
      penalidade += -3 // -3 por dia evitado mas trabalhado
    }
  }

  return penalidade
}

/**
 * S3 — EQUILIBRIO_ABERTURAS
 * Mede desequilíbrio na distribuição de aberturas/fechamentos entre colaboradores.
 * Retorna penalidade proporcional ao desvio.
 */
export function checkS3_EquilibrioAberturas(
  colaboradores: ColabMotor[],
  resultado: Map<number, Map<string, CelulaMotor>>,
  dias: string[]
): number {
  if (colaboradores.length < 2) return 0

  const aberturasColab = new Map<number, number>()
  for (const c of colaboradores) aberturasColab.set(c.id, 0)

  for (const data of dias) {
    let menorInicio: number | null = null

    for (const c of colaboradores) {
      const mapa = resultado.get(c.id)
      const cel = mapa?.get(data)
      if (!cel || cel.status !== 'TRABALHO' || !cel.hora_inicio) continue
      const inicioMin = timeToMin(cel.hora_inicio)
      if (menorInicio === null || inicioMin < menorInicio) menorInicio = inicioMin
    }

    if (menorInicio === null) continue

    for (const c of colaboradores) {
      const mapa = resultado.get(c.id)
      const cel = mapa?.get(data)
      if (!cel || cel.status !== 'TRABALHO' || !cel.hora_inicio) continue
      const inicioMin = timeToMin(cel.hora_inicio)
      if (inicioMin <= menorInicio) {
        aberturasColab.set(c.id, (aberturasColab.get(c.id) ?? 0) + 1)
      }
    }
  }

  const valores = Array.from(aberturasColab.values())
  const maxAbert = Math.max(...valores)
  const minAbert = Math.min(...valores)
  const desvio = maxAbert - minAbert

  // Penalidade: -1 por desvio acima de 2 (alinhado com S3 no RFC -1/dev)
  if (desvio <= 2) return 0
  return -(desvio - 2)
}

/**
 * S4 — FOLGA_PREFERIDA
 * Se a folga não está no dia de menor demanda do colaborador → penalidade.
 * Peso: -1 por folga não posicionada no dia mais calmo.
 */
export function checkS4_FolgaPreferida(
  c: ColabMotor,
  diasOrdered: Array<[string, CelulaMotor]>
): number {
  // Verificar se há ao menos uma folga e um dia de trabalho
  const folgas = diasOrdered.filter(([, cel]) => cel.status === 'FOLGA')
  const trabalhos = diasOrdered.filter(([, cel]) => cel.status === 'TRABALHO')

  if (folgas.length === 0 || trabalhos.length === 0) return 0

  // Para simplificar: verificar se alguma folga está entre os dias de menor atividade
  // Consideramos o "dia preferido" como segunda, sábado ou domingo (menor demanda histórica típica)
  // Na prática o gerador deve escolher o dia correto — este soft apenas penaliza se não o fez

  // Heurística: se há folga na segunda (dia após fim de semana, menor demanda típica no varejo)
  // ou se o colaborador tem folga adjacente ao domingo → sem penalidade
  const temFolgaBoa = folgas.some(([data]) => {
    const diaSem = diaSemana(data)
    return diaSem === 'SEG' || diaSem === 'DOM' || diaSem === 'SAB'
  })

  if (temFolgaBoa) return 0

  // Folga está no meio da semana (ter/qua/qui/sex) — penalidade leve
  return -1 * folgas.length
}

/**
 * S5 — CONSISTENCIA_HORARIO
 * Se hora_inicio varia significativamente entre dias de trabalho → penalidade.
 * Complementa AP2 mas com threshold mais leve (S5 é SOFT, AP2 é Tier 2).
 * Peso: -2 por desvio significativo (> 30min do ideal).
 */
export function checkS5_ConsistenciaHorario(
  c: ColabMotor,
  diasOrdered: Array<[string, CelulaMotor]>
): number {
  const inicios: number[] = diasOrdered
    .filter(([, cel]) => cel.status === 'TRABALHO' && cel.hora_inicio !== null)
    .map(([, cel]) => timeToMin(cel.hora_inicio!))

  if (inicios.length < 2) return 0

  const media = inicios.reduce((a, b) => a + b, 0) / inicios.length
  // Contar dias com desvio > 30min da média (1 slot de grid)
  const diasComDesvio = inicios.filter(min => Math.abs(min - media) > 30).length

  // -2 por dia com desvio significativo
  return -2 * diasComDesvio
}

/**
 * H20 — ALMOCO_POSICAO
 * O almoço não pode estar na primeira nem na última hora da jornada.
 * Deve haver pelo menos 2h (120min) de trabalho antes e depois do almoço (TST 5ª Turma).
 * Só aplica quando há almoço definido (hora_almoco_inicio != null).
 */
export function checkH20(
  cel: CelulaMotor,
  c: ColabMotor,
  data: string
): Violacao[] {
  if (cel.status !== 'TRABALHO') return []
  if (cel.hora_almoco_inicio === null || cel.hora_almoco_fim === null) return []
  if (cel.hora_inicio === null || cel.hora_fim === null) return []

  const inicioMin = timeToMin(cel.hora_inicio)
  const fimMin = timeToMin(cel.hora_fim)
  const almocoInicioMin = timeToMin(cel.hora_almoco_inicio)
  const almocoFimMin = timeToMin(cel.hora_almoco_fim)

  const violacoes: Violacao[] = []

  // Min 2h (120min) de trabalho ANTES do almoço
  const trabalhoAntes = almocoInicioMin - inicioMin
  if (trabalhoAntes < 120) {
    violacoes.push({
      severidade: 'HARD',
      regra: 'H20_ALMOCO_POSICAO',
      colaborador_id: c.id,
      colaborador_nome: c.nome,
      mensagem: `${c.nome} tem almoço às ${cel.hora_almoco_inicio} em ${data} com apenas ${trabalhoAntes}min de trabalho antes (mínimo 2h antes do almoço — TST 5ª Turma)`,
      data,
    })
  }

  // Min 2h (120min) de trabalho DEPOIS do almoço
  const trabalhoDepois = fimMin - almocoFimMin
  if (trabalhoDepois < 120) {
    violacoes.push({
      severidade: 'HARD',
      regra: 'H20_ALMOCO_POSICAO',
      colaborador_id: c.id,
      colaborador_nome: c.nome,
      mensagem: `${c.nome} tem almoço até ${cel.hora_almoco_fim} em ${data} com apenas ${trabalhoDepois}min de trabalho depois (mínimo 2h após o almoço — TST 5ª Turma)`,
      data,
    })
  }

  return violacoes
}

// ─── Consolidação Final: Score, Indicadores, SlotComparacao ──────────────────

/**
 * calcularScoreV3 — Fórmula de pontuação v3.
 * base 100 + soma dos pesos negativos dos antipatterns detectados + softPenalty.
 * DIFERENTE do v2 (fórmula ponderada cobertura*0.4 + ...).
 * Resultado clampado em [0, 100].
 */
export function calcularScoreV3(
  antipatterns: AntipatternViolacao[],
  softPenalty: number
): number {
  const somaPesos = antipatterns.reduce((acc, ap) => acc + ap.peso, 0)
  const score = 100 + somaPesos + softPenalty
  return Math.max(0, Math.min(100, score))
}

export interface CalcIndicadoresParams {
  colaboradores: ColabMotor[]
  resultado: Map<number, Map<string, CelulaMotor>>
  demandas: Demanda[]
  dias: string[]
  violacoes: Violacao[]
  antipatterns: AntipatternViolacao[]
  softPenalty: number
  grid: SlotGrid[]
}

/**
 * calcularIndicadoresV3 — Calcula os indicadores de qualidade da escala.
 * - pontuacao: score final (base 100 + pesos APs + softPenalty)
 * - cobertura_percent: % de slots com executado >= target_planejado
 * - violacoes_hard: contagem de violações com severidade HARD
 * - violacoes_soft: contagem de APs + magnitude de penalidades SOFT
 * - equilibrio: 0-100 — quanto mais uniforme a carga entre colabs, mais alto
 */
export function calcularIndicadoresV3(params: CalcIndicadoresParams): Indicadores {
  const { colaboradores, resultado, dias, violacoes, antipatterns, softPenalty, grid } = params

  // violacoes_hard
  const violacoes_hard = violacoes.filter(v => v.severidade === 'HARD').length

  // pontuacao
  let pontuacao = calcularScoreV3(antipatterns, softPenalty)
  // Baseline de qualidade: se não há HARD, score mínimo de 40 para evitar colapso
  // por acúmulo de antipatterns/soft em cenários densos.
  if (violacoes_hard === 0 && pontuacao < 40) {
    pontuacao = 40
  }

  // violacoes_soft — conta APs + magnitude normalizada das penalidades SOFT
  // Cada AP conta como 1; softPenalty divide pelo peso médio SOFT (-2) para estimar ocorrências
  const apCount = antipatterns.length
  const softOcorrencias = softPenalty < 0 ? Math.round(Math.abs(softPenalty) / 2) : 0
  const violacoes_soft = apCount + softOcorrencias

  // cobertura_percent — % de slots onde executado >= target_planejado
  let slotsTotal = 0
  let slotsCobertos = 0

  for (const slot of grid) {
    if (slot.dia_fechado || slot.feriado_proibido) continue
    slotsTotal++

    const slotInicioMin = timeToMin(slot.hora_inicio)
    const slotFimMin = timeToMin(slot.hora_fim)
    const executado = countExecutadoNoSlot({
      data: slot.data,
      slotInicioMin,
      slotFimMin,
      colaboradores,
      resultado,
    })

    if (executado >= slot.target_planejado) slotsCobertos++
  }

  const cobertura_percent = slotsTotal > 0
    ? Math.round((slotsCobertos / slotsTotal) * 100)
    : 100

  // equilibrio — 0-100 baseado no desvio padrão do % de meta atingida por colab
  // Baixo desvio = alto equilíbrio. Calculamos o DP do % atingido por colaborador.
  const percentuaisMeta: number[] = []

  for (const c of colaboradores) {
    const mapa = resultado.get(c.id)
    if (!mapa) {
      percentuaisMeta.push(0)
      continue
    }

    let totalMinutos = 0
    for (const data of dias) {
      const cel = mapa.get(data)
      if (cel?.status === 'TRABALHO') totalMinutos += cel.minutos_trabalho
    }

    const semanas = getWeeks(dias)
    const metaTotal = semanas.length * c.horas_semanais * 60
    const pct = metaTotal > 0 ? (totalMinutos / metaTotal) * 100 : 100
    percentuaisMeta.push(pct)
  }

  let equilibrio = 100
  if (percentuaisMeta.length > 1) {
    const media = percentuaisMeta.reduce((a, b) => a + b, 0) / percentuaisMeta.length
    const variancia = percentuaisMeta.reduce((acc, v) => acc + (v - media) ** 2, 0) / percentuaisMeta.length
    const desvio = Math.sqrt(variancia)
    // Converter desvio (0-100%) para score de equilíbrio (100 = perfeito, 0 = caótico)
    // Desvio de 50% = equilibrio 0 (escala muito desequilibrada)
    equilibrio = Math.max(0, Math.min(100, Math.round(100 - desvio * 2)))
  }

  return {
    cobertura_percent,
    violacoes_hard,
    violacoes_soft,
    equilibrio,
    pontuacao,
  }
}

/**
 * gerarSlotComparacao — Gera a tabela Planejado x Executado x Delta para cada slot do grid.
 * Cobre TODOS os slots do período. Justificativa OBRIGATÓRIA quando delta != 0.
 * Um colaborador "cobre" um slot se:
 *   - status === 'TRABALHO'
 *   - hora_inicio <= slot.hora_inicio
 *   - hora_fim >= slot.hora_fim
 *   - slot NÃO está dentro do período de almoço do colaborador
 */
export function gerarSlotComparacao(params: {
  grid: SlotGrid[]
  colaboradores: ColabMotor[]
  resultado: Map<number, Map<string, CelulaMotor>>
  dias: string[]
}): SlotComparacao[] {
  const { grid, colaboradores, resultado } = params
  const comparacoes: SlotComparacao[] = []

  for (const slot of grid) {
    if (slot.dia_fechado) continue

    const slotInicioMin = timeToMin(slot.hora_inicio)
    const slotFimMin = timeToMin(slot.hora_fim)
    const executado = countExecutadoNoSlot({
      data: slot.data,
      slotInicioMin,
      slotFimMin,
      colaboradores,
      resultado,
    })

    const planejado = slot.target_planejado
    const delta = executado - planejado

    // Justificativa OBRIGATÓRIA quando delta != 0
    let justificativa: string | undefined
    if (delta < 0) {
      if (slot.feriado_proibido) {
        justificativa = `Feriado proibido em ${slot.data} — todos os colaboradores indisponíveis (CCT FecomercioSP)`
      } else if (slot.override) {
        justificativa = `Slot override (${planejado}) nao foi totalmente atingido por restricoes HARD (CLT/CCT/interjornada)`
      } else {
        justificativa = `${executado} colaborador(es) cobrem o slot ${slot.hora_inicio}-${slot.hora_fim} em ${slot.data}, abaixo do planejado ${planejado} (${Math.abs(delta)} insuficiente(s)) por limitacao de capacidade/horarios`
      }
    } else if (delta > 0) {
      justificativa = `Excesso de ${delta} pessoa(s) além do target de ${planejado} no slot ${slot.hora_inicio}-${slot.hora_fim} em ${slot.data}`
    }

    comparacoes.push({
      data: slot.data,
      hora_inicio: slot.hora_inicio,
      hora_fim: slot.hora_fim,
      planejado,
      executado,
      delta,
      override: slot.override,
      justificativa,
    })
  }

  return comparacoes
}
