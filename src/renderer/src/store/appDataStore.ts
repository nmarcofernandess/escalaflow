import { create } from 'zustand'
import type {
  Empresa,
  TipoContrato,
  Feriado,
  RuleDefinition,
  Setor,
  Colaborador,
  Funcao,
  Demanda,
  RegraHorarioColaborador,
  Excecao,
  Escala,
  SetorHorarioSemana,
} from '@shared/index'
import { gcd, sugerirK } from '@shared/simula-ciclo'
import { empresaService } from '@/servicos/empresa'
import { tiposContratoService } from '@/servicos/tipos-contrato'
import { feriadosService } from '@/servicos/feriados'
import { regrasService } from '@/servicos/regras'
import { setoresService } from '@/servicos/setores'
import { colaboradoresService } from '@/servicos/colaboradores'
import { funcoesService } from '@/servicos/funcoes'
import { excecoesService } from '@/servicos/excecoes'
import { escalasService } from '@/servicos/escalas'

// ---------------------------------------------------------------------------
// StoreSnapshot — lightweight state for IA discovery (A11)
// ---------------------------------------------------------------------------

export interface StoreSnapshot {
  empresa?: { nome: string; grid_minutos: number }
  setor?: { id: number; nome: string; hora_abertura: string; hora_fechamento: string }
  colaboradores?: Array<{ id: number; nome: string; tipo_trabalhador: string; funcao_id: number | null }>
  postos?: Array<{ id: number; apelido: string; titular_id: number | null }>
  demanda?: { porDia: number[] }
  ciclo?: { N: number; K: number; semanas: number }
  ausentes?: Array<{ id: number; nome: string; tipo: string; data_inicio: string; data_fim: string }>
  proximosAusentes?: Array<{ id: number; nome: string; tipo: string; diasAte: number }>
  avisos?: Array<{ id: string; nivel: string; titulo: string }>
  escalaAtual?: { id: number; status: string; cobertura_percent: number | null; violacoes_hard: number | null }
}

// ---------------------------------------------------------------------------
// AppDataStore — Entidades globais (A1) + por setor (A2) + derivados (A3)
// ---------------------------------------------------------------------------

const DIAS_SEMANA = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'] as const

export interface AvisoEscala {
  id: string
  nivel: 'info' | 'aviso' | 'erro'
  titulo: string
  detalhe?: string
  /** Origem do aviso — permite separar na UI (setor=derivados, operacao=preflight/solver, escala=validador) */
  origem?: 'setor' | 'operacao' | 'escala'
}

export interface AusenteInfo {
  colaborador: Colaborador
  excecao: Excecao
  posto: Funcao | null
}

export interface ProximoAusenteInfo {
  colaborador: Colaborador
  excecao: Excecao
  diasAte: number
}

export interface Derivados {
  N: number              // postos elegiveis com titular (sem INTERMITENTE)
  K: number              // demanda domingo efetiva (capped por kMaxSemTT)
  kReal: number          // demanda domingo raw (antes do cap)
  kMaxSemTT: number      // floor(N/2) — maximo sem 2 domingos consecutivos
  cicloSemanas: number   // N / gcd(N, K)
  demandaPorDia: number[]  // [SEG..DOM] — max min_pessoas por dia
  avisos: AvisoEscala[]
  ausentes: AusenteInfo[]           // excecoes ativas HOJE
  proximosAusentes: ProximoAusenteInfo[]  // excecoes comecando em ate 7 dias
}

const DERIVADOS_VAZIO: Derivados = {
  N: 0,
  K: 0,
  kReal: 0,
  kMaxSemTT: 0,
  cicloSemanas: 0,
  demandaPorDia: [0, 0, 0, 0, 0, 0, 0],
  avisos: [],
  ausentes: [],
  proximosAusentes: [],
}

export interface AppDataStore {
  // --- Entidades globais (raramente mudam) ---
  empresa: Empresa | null
  tiposContrato: TipoContrato[]
  feriados: Feriado[]
  regras: RuleDefinition[]
  setores: Setor[]

  // --- Entidades por setor ativo ---
  setorAtivo: number | null
  setor: Setor | null
  colaboradores: Colaborador[]
  postos: Funcao[]
  demandas: Demanda[]
  regrasPadrao: RegraHorarioColaborador[]
  excecoes: Excecao[]
  escalas: Escala[]
  horarioSemana: SetorHorarioSemana[]

  // --- Derivados (A3) — recalculam automaticamente ---
  derivados: Derivados

  // --- Estado ---
  _inicializado: boolean
  carregando: boolean
  carregandoSetor: boolean

  // --- Ações ---
  init: () => Promise<void>
  setSetorAtivo: (id: number | null) => Promise<void>
  reloadEntidade: (nome: string) => Promise<void>
  invalidate: (entidades: string[], setor_id?: number) => void
  snapshot: () => StoreSnapshot | null
}

// ---------------------------------------------------------------------------
// Derivados — calculo puro a partir do estado atual
// ---------------------------------------------------------------------------

// Prioridade de tipo de excecao pra dedup (maior = mais relevante)
const TIPO_EXCECAO_PRIORIDADE: Record<string, number> = { FERIAS: 3, ATESTADO: 2, BLOQUEIO: 1 }

function calcularDerivados(
  postos: Funcao[],
  colaboradores: Colaborador[],
  demandas: Demanda[],
  excecoes: Excecao[],
): Derivados {
  // N: postos ativos com titular (excluindo INTERMITENTE)
  const postosElegiveis = postos
    .filter(f => f.ativo)
    .filter(f => {
      const titular = colaboradores.find(c => c.funcao_id === f.id)
      return titular && (titular.tipo_trabalhador ?? 'CLT') !== 'INTERMITENTE'
    })

  const N = postosElegiveis.length
  const kMaxSemTT = Math.floor(N / 2)

  // K: max min_pessoas de demandas DOM (ou null = padrão)
  const demandasDom = demandas.filter(d => d.dia_semana === 'DOM' || d.dia_semana === null)
  const kDom = demandasDom.length > 0
    ? Math.max(0, ...demandasDom.map(d => d.min_pessoas))
    : 0
  const kReal = kDom > 0 ? kDom : sugerirK(N)
  const K = Math.min(kReal, kMaxSemTT)

  // Ciclo
  const cicloSemanas = K > 0 ? N / gcd(N, K) : (N > 0 ? 1 : 0)

  // Demanda por dia da semana: max min_pessoas por dia
  const demandaPorDia = DIAS_SEMANA.map(dia => {
    const match = demandas.filter(d => d.dia_semana === dia || d.dia_semana === null)
    return match.length > 0 ? Math.max(0, ...match.map(d => d.min_pessoas)) : 0
  })

  // Avisos
  const avisos: AvisoEscala[] = []

  if (N < 2 && N > 0) {
    avisos.push({
      id: 'n_insuficiente',
      nivel: 'erro',
      titulo: `Apenas ${N} posto com titular — mínimo 2 para gerar ciclo`,
    })
  }

  if (N === 0) {
    avisos.push({
      id: 'sem_postos',
      nivel: 'erro',
      titulo: 'Nenhum posto com titular ativo (excluindo intermitentes)',
    })
  }

  if (kReal > kMaxSemTT && N >= 2) {
    avisos.push({
      id: 'k_limitado',
      nivel: 'aviso',
      titulo: `Demanda domingo = ${kReal}, mas máximo sem 2 domingos seguidos = ${kMaxSemTT} (com ${N} postos)`,
      detalhe: 'Cobertura de domingo pode ficar abaixo da demanda.',
    })
  }

  if (cicloSemanas > 7 && N >= 2) {
    avisos.push({
      id: 'ciclo_longo',
      nivel: 'aviso',
      titulo: `Ciclo de ${cicloSemanas} semanas é longo — pode dificultar gestão`,
      detalhe: 'Considere ajustar demanda de domingo ou número de postos.',
    })
  }

  // Dias com demanda > N (subdimensionamento)
  const diasSubdimensionados = DIAS_SEMANA.filter((_, i) => demandaPorDia[i] > N && N > 0)
  if (diasSubdimensionados.length > 0) {
    avisos.push({
      id: 'subdimensionamento',
      nivel: 'aviso',
      titulo: `Demanda excede postos em: ${diasSubdimensionados.join(', ')}`,
      detalhe: `${N} postos com titular, mas demanda pede mais em alguns dias.`,
    })
  }

  // Ausentes e próximos (excecoes ativas e futuras 7 dias)
  const hoje = new Date().toISOString().split('T')[0]
  const seteDiasMs = 7 * 86400000
  const hojeMs = Date.parse(hoje)
  const colabIds = new Set(colaboradores.map(c => c.id))

  // Dedup: 1 excecao por colaborador (maior prioridade)
  const excecoesPorColab = new Map<number, Excecao>()
  for (const exc of excecoes) {
    if (!colabIds.has(exc.colaborador_id)) continue
    const existente = excecoesPorColab.get(exc.colaborador_id)
    if (!existente || (TIPO_EXCECAO_PRIORIDADE[exc.tipo] ?? 0) > (TIPO_EXCECAO_PRIORIDADE[existente.tipo] ?? 0)) {
      excecoesPorColab.set(exc.colaborador_id, exc)
    }
  }

  const ausentes: AusenteInfo[] = []
  const proximosAusentes: ProximoAusenteInfo[] = []

  for (const [colabId, exc] of excecoesPorColab) {
    const colab = colaboradores.find(c => c.id === colabId)
    if (!colab) continue

    const inicioMs = Date.parse(exc.data_inicio)
    const isAtiva = exc.data_inicio <= hoje && exc.data_fim >= hoje
    const isProxima = exc.data_inicio > hoje && (inicioMs - hojeMs) <= seteDiasMs

    if (isAtiva) {
      ausentes.push({
        colaborador: colab,
        excecao: exc,
        posto: postos.find(p => p.id === colab.funcao_id) ?? null,
      })
    } else if (isProxima) {
      proximosAusentes.push({
        colaborador: colab,
        excecao: exc,
        diasAte: Math.ceil((inicioMs - hojeMs) / 86400000),
      })
    }
  }

  return { N, K, kReal, kMaxSemTT, cicloSemanas, demandaPorDia, avisos, ausentes, proximosAusentes }
}

// ---------------------------------------------------------------------------
// Setor vazio (limpa ao trocar/desativar)
// ---------------------------------------------------------------------------

type SetorFields = Pick<
  AppDataStore,
  'setor' | 'colaboradores' | 'postos' | 'demandas' | 'regrasPadrao' | 'excecoes' | 'escalas' | 'horarioSemana' | 'derivados'
>

const SETOR_VAZIO: SetorFields = {
  setor: null,
  colaboradores: [],
  postos: [],
  demandas: [],
  regrasPadrao: [],
  excecoes: [],
  escalas: [],
  horarioSemana: [],
  derivados: DERIVADOS_VAZIO,
}

// ---------------------------------------------------------------------------
// Carrega todas as entidades do setor ativo em paralelo
// ---------------------------------------------------------------------------

async function carregarSetor(setorId: number) {
  const [setor, colaboradores, postos, demandas, regrasPadrao, excecoes, escalas, horarioSemana] =
    await Promise.all([
      setoresService.buscar(setorId),
      colaboradoresService.listar({ setor_id: setorId, ativo: true }),
      funcoesService.listar(setorId),
      setoresService.listarDemandas(setorId),
      colaboradoresService.listarRegrasPadraoSetor(setorId),
      excecoesService.listarAtivas(),
      escalasService.listarPorSetor(setorId),
      setoresService.listarHorarioSemana(setorId),
    ])

  const derivados = calcularDerivados(postos, colaboradores, demandas, excecoes)

  return { setor, colaboradores, postos, demandas, regrasPadrao, excecoes, escalas, horarioSemana, derivados }
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

type SetFn = (partial: Partial<AppDataStore>) => void

const GLOBAL_LOADERS: Record<string, (set: SetFn) => Promise<void>> = {
  empresa: async (set) => set({ empresa: await empresaService.buscar() }),
  tipos_contrato: async (set) => set({ tiposContrato: await tiposContratoService.listar() }),
  feriados: async (set) => set({ feriados: await feriadosService.listar() }),
  regras: async (set) => set({ regras: await regrasService.listar() }),
  setores: async (set) => set({ setores: await setoresService.listar(true) }),
}

// Entidades que afetam derivados — recalcular após reload
const DERIVADOS_DEPS = new Set(['colaboradores', 'postos', 'funcoes', 'demandas', 'excecoes'])

const SETOR_LOADERS: Record<string, (set: SetFn, setorId: number) => Promise<void>> = {
  setor: async (set, id) => set({ setor: await setoresService.buscar(id) }),
  colaboradores: async (set, id) => set({ colaboradores: await colaboradoresService.listar({ setor_id: id, ativo: true }) }),
  postos: async (set, id) => set({ postos: await funcoesService.listar(id) }),
  funcoes: async (set, id) => set({ postos: await funcoesService.listar(id) }),
  demandas: async (set, id) => set({ demandas: await setoresService.listarDemandas(id) }),
  regras_padrao: async (set, id) => set({ regrasPadrao: await colaboradoresService.listarRegrasPadraoSetor(id) }),
  excecoes: async (set) => set({ excecoes: await excecoesService.listarAtivas() }),
  escalas: async (set, id) => set({ escalas: await escalasService.listarPorSetor(id) }),
  alocacoes: async (set, id) => set({ escalas: await escalasService.listarPorSetor(id) }),
  horario_semana: async (set, id) => set({ horarioSemana: await setoresService.listarHorarioSemana(id) }),
}

// Aliases: tools/tipc emitem nomes variados
const ENTITY_ALIASES: Record<string, string> = {
  empresa: 'empresa',
  tipos_contrato: 'tipos_contrato',
  tiposContrato: 'tipos_contrato',
  feriados: 'feriados',
  regras: 'regras',
  regra_empresa: 'regras',
  regra_definicao: 'regras',
  setores: 'setores',
  setor: 'setor',
  colaboradores: 'colaboradores',
  postos: 'postos',
  funcoes: 'funcoes',
  demandas: 'demandas',
  regras_padrao: 'regras_padrao',
  colaborador_regra_horario: 'regras_padrao',
  excecoes: 'excecoes',
  escalas: 'escalas',
  alocacoes: 'alocacoes',
  horario_semana: 'horario_semana',
  setor_horario_semana: 'horario_semana',
  empresa_horario_semana: 'horario_semana',
  demandas_excecao_data: 'demandas',
  colaborador_regra_horario_excecao_data: 'regras_padrao',
  contrato_perfis_horario: 'tipos_contrato',
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAppDataStore = create<AppDataStore>((set, get) => ({
  // Globais
  empresa: null,
  tiposContrato: [],
  feriados: [],
  regras: [],
  setores: [],

  // Por setor
  setorAtivo: null,
  ...SETOR_VAZIO,

  // Estado
  _inicializado: false,
  carregando: false,
  carregandoSetor: false,

  init: async () => {
    if (get()._inicializado) return
    set({ _inicializado: true, carregando: true })

    try {
      const [empresa, tiposContrato, feriados, regras, setores] = await Promise.all([
        empresaService.buscar(),
        tiposContratoService.listar(),
        feriadosService.listar(),
        regrasService.listar(),
        setoresService.listar(true),
      ])
      set({ empresa, tiposContrato, feriados, regras, setores })
    } catch (err) {
      console.error('[AppDataStore] init falhou:', err)
    } finally {
      set({ carregando: false })
    }
  },

  setSetorAtivo: async (id: number | null) => {
    const prev = get().setorAtivo
    if (prev === id) return

    if (id === null) {
      set({ setorAtivo: null, ...SETOR_VAZIO })
      return
    }

    set({ setorAtivo: id, carregandoSetor: true })

    try {
      const dados = await carregarSetor(id)
      if (get().setorAtivo !== id) return
      set({ ...dados, carregandoSetor: false })
    } catch (err) {
      console.error(`[AppDataStore] carregarSetor(${id}) falhou:`, err)
      set({ carregandoSetor: false })
    }
  },

  reloadEntidade: async (nome: string) => {
    const key = ENTITY_ALIASES[nome] ?? nome

    // Tenta loader global
    const globalLoader = GLOBAL_LOADERS[key]
    if (globalLoader) {
      try {
        await globalLoader(set)
      } catch (err) {
        console.error(`[AppDataStore] reload global ${key} falhou:`, err)
      }
      return
    }

    // Tenta loader por setor
    const setorId = get().setorAtivo
    if (!setorId) return

    const setorLoader = SETOR_LOADERS[key]
    if (setorLoader) {
      try {
        await setorLoader(set, setorId)
        // Recalcula derivados se a entidade afeta o ciclo
        if (DERIVADOS_DEPS.has(key)) {
          const { postos, colaboradores, demandas, excecoes } = get()
          set({ derivados: calcularDerivados(postos, colaboradores, demandas, excecoes) })
        }
      } catch (err) {
        console.error(`[AppDataStore] reload setor ${key} falhou:`, err)
      }
    }
  },

  invalidate: (entidades: string[], setor_id?: number) => {
    const { reloadEntidade, setorAtivo } = get()

    for (const e of entidades) {
      const key = ENTITY_ALIASES[e] ?? e

      if (key in GLOBAL_LOADERS) {
        reloadEntidade(e)
        continue
      }

      if (key in SETOR_LOADERS && setorAtivo && (!setor_id || setor_id === setorAtivo)) {
        reloadEntidade(e)
      }
    }
  },

  snapshot: () => {
    const state = get()
    if (!state._inicializado) return null

    const snap: StoreSnapshot = {}

    if (state.empresa) {
      snap.empresa = { nome: state.empresa.nome, grid_minutos: state.empresa.grid_minutos }
    }

    if (state.setor) {
      snap.setor = {
        id: state.setor.id,
        nome: state.setor.nome,
        hora_abertura: state.setor.hora_abertura,
        hora_fechamento: state.setor.hora_fechamento,
      }
      snap.colaboradores = state.colaboradores.map(c => ({
        id: c.id, nome: c.nome, tipo_trabalhador: c.tipo_trabalhador, funcao_id: c.funcao_id,
      }))
      snap.postos = state.postos.filter(p => p.ativo).map(p => ({
        id: p.id, apelido: p.apelido,
        titular_id: state.colaboradores.find(c => c.funcao_id === p.id)?.id ?? null,
      }))
      snap.demanda = { porDia: state.derivados.demandaPorDia }
      snap.ciclo = { N: state.derivados.N, K: state.derivados.K, semanas: state.derivados.cicloSemanas }
      snap.avisos = state.derivados.avisos.map(a => ({ id: a.id, nivel: a.nivel, titulo: a.titulo }))
      snap.ausentes = state.derivados.ausentes.map(a => ({
        id: a.colaborador.id, nome: a.colaborador.nome,
        tipo: a.excecao.tipo, data_inicio: a.excecao.data_inicio, data_fim: a.excecao.data_fim,
      }))
      snap.proximosAusentes = state.derivados.proximosAusentes.map(a => ({
        id: a.colaborador.id, nome: a.colaborador.nome, tipo: a.excecao.tipo, diasAte: a.diasAte,
      }))

      // Latest escala (prefer RASCUNHO > OFICIAL > ARQUIVADA)
      const latest = [...state.escalas]
        .sort((a, b) => {
          const statusOrder: Record<string, number> = { RASCUNHO: 0, OFICIAL: 1, ARQUIVADA: 2 }
          return (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9)
        })[0]
      if (latest) {
        snap.escalaAtual = {
          id: latest.id, status: latest.status,
          cobertura_percent: (latest as any).cobertura_percent ?? null,
          violacoes_hard: (latest as any).violacoes_hard ?? null,
        }
      }
    }

    return snap
  },
}))
