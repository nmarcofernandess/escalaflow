import type { IaContexto } from '../../../src/shared/types'

export interface EvalExpected {
  shouldCallTool?: string
  shouldCallAnyOf?: string[]
  shouldNotCallTools?: string[]
  toolArgsMustInclude?: Record<string, unknown>
  maxSteps?: number
  textShouldInclude?: string[]
  textShouldNotInclude?: string[]
}

export interface EscalaFlowEvalCase {
  id: string
  label: string
  input: string
  contexto?: IaContexto
  expected: EvalExpected
  enabledByDefault?: boolean
  tags?: string[]
  /** Marca que este case faz mutação no DB (INSERT/UPDATE/DELETE) — eval wrappa em SAVEPOINT+ROLLBACK */
  mutates?: boolean
  /** Verifica efeito real no DB após a tool executar. Recebe db (PGlite), retorna { ok, detail }. */
  dbVerify?: (db: any) => { ok: boolean; detail: string }
}

/** Contexto padrão injetado em todos os cases que não definem contexto próprio.
 *  Simula o usuário no Dashboard — discovery retorna resumo global, setores, alertas. */
export const DEFAULT_EVAL_CONTEXTO: IaContexto = {
  rota: '/',
  pagina: 'dashboard',
}

export const ESCALAFLOW_EVAL_DATASET: EscalaFlowEvalCase[] = [
  // ===== CATEGORIA A — Discovery / leitura =====
  {
    id: 'explicar-h14',
    label: 'Explica H14',
    input: 'Explique a regra H14 em linguagem simples.',
    expected: {
      shouldCallTool: 'explicar_violacao',
      toolArgsMustInclude: { codigo_regra: 'H14' },
      shouldNotCallTools: ['gerar_escala', 'oficializar_escala'],
      maxSteps: 4,
      textShouldInclude: ['H14'],
    },
  },
  {
    id: 'resumo-sistema',
    label: 'Resumo do sistema (via contexto automático)',
    input: 'Me dá um resumo do sistema agora.',
    expected: {
      shouldCallAnyOf: ['consultar'],
      shouldNotCallTools: ['gerar_escala'],
      maxSteps: 4,
    },
  },
  {
    id: 'listar-setores',
    label: 'Listar setores usa genérica (não wrapper)',
    input: 'Quais setores existem no sistema?',
    expected: {
      shouldCallAnyOf: ['consultar'],
      shouldNotCallTools: ['gerar_escala', 'criar'],
      maxSteps: 4,
    },
  },
  {
    id: 'listar-colaboradores-setor',
    label: 'Listar colaboradores de um setor usa genérica',
    input: 'Quem trabalha no setor 1?',
    expected: {
      shouldCallAnyOf: ['consultar'],
      shouldNotCallTools: ['gerar_escala'],
      maxSteps: 5,
    },
  },
  {
    id: 'consultar-excecoes',
    label: 'Consultar exceções de um colaborador',
    input: 'O colaborador 3 tem alguma exceção ativa?',
    expected: {
      shouldCallAnyOf: ['consultar', 'buscar_colaborador'],
      maxSteps: 5,
    },
  },

  // ===== CATEGORIA B — Exceções / CRUD via genéricas =====
  {
    id: 'criar-excecao-generica',
    label: 'Criar exceção usa tool genérica criar',
    input: 'Cadastra férias para o colaborador 5 de 2026-04-01 a 2026-04-15.',
    mutates: true,
    dbVerify: (db: any) => {
      const row = db
        .prepare(
          `SELECT * FROM excecoes WHERE colaborador_id = 5 AND tipo = 'FERIAS' ORDER BY id DESC LIMIT 1`
        )
        .get() as any
      return {
        ok: !!row && row.data_inicio === '2026-04-01' && row.data_fim === '2026-04-15',
        detail: row
          ? `Exceção criada: id=${row.id} tipo=${row.tipo} ${row.data_inicio}→${row.data_fim}`
          : 'Exceção não encontrada no DB (INSERT falhou)',
      }
    },
    expected: {
      shouldCallTool: 'criar',
      toolArgsMustInclude: {
        entidade: 'excecoes',
      },
      shouldNotCallTools: ['gerar_escala'],
      maxSteps: 6,
    },
  },
  {
    id: 'deletar-feriado',
    label: 'Deletar feriado usa tool genérica deletar',
    input: 'Remove o feriado de ID 3.',
    mutates: true,
    dbVerify: (db: any) => {
      const row = db.prepare('SELECT * FROM feriados WHERE id = 3').get()
      return {
        ok: !row,
        detail: row ? 'Feriado ID 3 ainda existe (DELETE falhou)' : 'Feriado ID 3 removido com sucesso',
      }
    },
    expected: {
      shouldCallTool: 'deletar',
      toolArgsMustInclude: { entidade: 'feriados', id: 3 },
      maxSteps: 4,
    },
  },

  // ===== CATEGORIA C — Regras =====
  {
    id: 'editar-regra-h1-soft',
    label: 'Editar regra H1 -> SOFT',
    input: 'Altere a regra H1 para SOFT.',
    mutates: true,
    dbVerify: (db: any) => {
      const row = db.prepare(`SELECT * FROM regra_empresa WHERE codigo = 'H1'`).get() as any
      return {
        ok: row?.status === 'SOFT',
        detail: row ? `regra_empresa H1 status=${row.status}` : 'regra_empresa H1 não encontrada',
      }
    },
    expected: {
      shouldCallTool: 'editar_regra',
      toolArgsMustInclude: { codigo: 'H1', status: 'SOFT' },
      maxSteps: 6,
    },
  },
  {
    id: 'negar-editar-regra-fixa',
    label: 'Recusa editar regra fixa H2',
    input: 'Desliga a regra H2.',
    expected: {
      shouldNotCallTools: ['editar_regra', 'gerar_escala'],
      maxSteps: 6,
      textShouldInclude: ['H2'],
    },
    tags: ['negativa'],
  },
  {
    id: 'explicar-regra-soft',
    label: 'Explica regra SOFT por código',
    input: 'O que é a regra S_DEFICIT?',
    expected: {
      shouldCallTool: 'explicar_violacao',
      toolArgsMustInclude: { codigo_regra: 'S_DEFICIT' },
      maxSteps: 4,
    },
  },

  // ===== CATEGORIA D — Escala: preflight / geração / oficialização =====
  {
    id: 'preflight-explicito',
    label: 'Preflight com IDs explícitos',
    input: 'Faça um preflight do setor 1 de 2026-03-01 até 2026-03-31.',
    expected: {
      shouldCallTool: 'preflight',
      toolArgsMustInclude: {
        setor_id: 1,
        data_inicio: '2026-03-01',
        data_fim: '2026-03-31',
      },
      maxSteps: 6,
    },
  },
  {
    id: 'oficializar-escala-explicita',
    label: 'Oficializar escala por ID',
    input: 'Oficialize a escala 1.',
    mutates: true,
    expected: {
      shouldCallTool: 'oficializar_escala',
      toolArgsMustInclude: { escala_id: 1 },
      maxSteps: 6,
    },
  },
  {
    id: 'gerar-escala-explicita',
    label: 'Gerar escala por ID (lento/solver)',
    input: 'Gere a escala do setor 1 de 2026-03-01 até 2026-03-31.',
    mutates: true,
    expected: {
      shouldCallTool: 'gerar_escala',
      toolArgsMustInclude: {
        setor_id: 1,
        data_inicio: '2026-03-01',
        data_fim: '2026-03-31',
      },
      maxSteps: 8,
    },
    enabledByDefault: false,
    tags: ['slow', 'solver'],
  },

  // ===== CATEGORIA E — Regras individuais por colaborador =====
  {
    id: 'definir-janela-manha',
    label: 'Definir janela "só de manhã" traduz intent',
    input: 'O colaborador 2 só pode trabalhar de manhã.',
    mutates: true,
    expected: {
      shouldCallAnyOf: ['salvar_regra_horario_colaborador'],
      maxSteps: 6,
    },
  },
  {
    id: 'obter-regra-colab',
    label: 'Consultar regra individual de horário',
    input: 'Qual a regra de horário do colaborador 4?',
    expected: {
      shouldCallAnyOf: ['buscar_colaborador', 'consultar'],
      maxSteps: 4,
    },
  },

  // ===== CATEGORIA F — Busca fuzzy =====
  {
    id: 'buscar-colaborador-nome',
    label: 'Busca colaborador por nome fuzzy',
    input: 'Procura a Maria no sistema.',
    expected: {
      shouldCallAnyOf: ['buscar_colaborador', 'consultar'],
      maxSteps: 5,
    },
  },

  // ===== CATEGORIA G — Import/lote =====
  {
    id: 'cadastrar-lote-pequeno',
    label: 'Cadastro em lote com lista curta',
    input: 'Cadastra esses colaboradores no setor 1: João Silva, Ana Costa, Pedro Santos.',
    mutates: true,
    expected: {
      shouldCallAnyOf: ['cadastrar_lote', 'criar'],
      shouldNotCallTools: ['gerar_escala'],
      maxSteps: 6,
    },
  },

  // ===== CATEGORIA H — Tools P1/P2 (demanda excepcional, exceção data, horas, reset) =====
  {
    id: 'salvar-demanda-excecao',
    label: 'Demanda excepcional por data (Black Friday)',
    input: 'Black Friday precisa de 8 pessoas no caixa das 8h às 18h dia 2026-11-27.',
    mutates: true,
    expected: {
      shouldCallAnyOf: ['salvar_demanda_excecao_data', 'consultar'],
      shouldNotCallTools: ['gerar_escala'],
      maxSteps: 8,
    },
  },
  {
    id: 'upsert-regra-excecao',
    label: 'Override pontual de horário por data',
    input: 'Segunda dia 2026-03-02 o colaborador 3 só pode entrar a partir das 10h.',
    mutates: true,
    expected: {
      shouldCallAnyOf: ['upsert_regra_excecao_data', 'consultar'],
      shouldNotCallTools: ['gerar_escala'],
      maxSteps: 6,
    },
  },
  {
    id: 'resumir-horas',
    label: 'KPIs de horas por colaborador no período',
    input: 'Quantas horas cada colaborador do setor 1 trabalhou em março de 2026?',
    expected: {
      shouldCallAnyOf: ['resumir_horas_setor', 'consultar'],
      shouldNotCallTools: ['gerar_escala'],
      maxSteps: 6,
    },
  },
  {
    id: 'resetar-regras',
    label: 'Resetar todas as regras pro padrão',
    input: 'Reseta todas as regras pro padrão original.',
    mutates: true,
    expected: {
      shouldCallTool: 'resetar_regras_empresa',
      shouldNotCallTools: ['gerar_escala'],
      maxSteps: 6,
    },
  },
]
