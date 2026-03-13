import { queryAll, queryOne } from '../db/query'
import type {
  GenerationMode,
  RuleConfig,
  RuleDefinition,
  RulePolicyAdjustment,
  RuleStatus,
} from '../../shared'

interface RuleRow extends RuleDefinition {}

export interface EffectiveRulePolicy {
  generationMode: GenerationMode
  solverRules: RuleConfig
  validatorRules: RuleConfig
  adjustments: RulePolicyAdjustment[]
}

const OFFICIAL_LOCKED_HARD_RULES = new Set([
  'H1',
  'H2',
  'H4',
  'H5',
  'H6',
  'H11',
  'H12',
  'H13',
  'H14',
  'H15',
  'H16',
  'H17',
  'H18',
])

const VALIDATOR_ONLY_HARD_RULES: ReadonlyArray<string> = [
  'H2B',
  'H7',
  'H8',
  'H9',
  'H19',
  'H20',
  'JANELA_COLABORADOR',
]

const FALLBACK_BASE_RULES: RuleConfig = {
  H1: 'HARD',
  H3: 'SOFT',
  H6: 'HARD',
  H10: 'HARD',
  DIAS_TRABALHO: 'HARD',
  MIN_DIARIO: 'HARD',
}

async function loadRuleRows(): Promise<RuleRow[]> {
  try {
    const tableCheck = await queryOne<{ c: number }>(
      "SELECT COUNT(*)::int as c FROM information_schema.tables WHERE table_name = 'regra_definicao'"
    )
    const tableExists = (tableCheck?.c ?? 0) > 0
    if (!tableExists) return []

    return await queryAll<RuleRow>(`
      SELECT
        rd.codigo,
        rd.nome,
        rd.descricao,
        rd.categoria,
        rd.status_sistema,
        rd.editavel,
        rd.aviso_dependencia,
        rd.ordem,
        COALESCE(re.status, rd.status_sistema) AS status_efetivo
      FROM regra_definicao rd
      LEFT JOIN regra_empresa re ON rd.codigo = re.codigo
      ORDER BY rd.ordem, rd.codigo
    `)
  } catch {
    return []
  }
}

function pushAdjustment(
  adjustments: RulePolicyAdjustment[],
  codigo: string,
  from: RuleStatus | null,
  to: RuleStatus,
  reason: string,
): void {
  adjustments.push({ codigo, from, to, reason })
}

function applyOfficialLocks(
  generationMode: GenerationMode,
  codigo: string,
  currentStatus: RuleStatus,
  adjustments: RulePolicyAdjustment[],
): RuleStatus {
  let nextStatus = currentStatus

  if (generationMode === 'OFFICIAL' && OFFICIAL_LOCKED_HARD_RULES.has(codigo) && nextStatus !== 'HARD') {
    pushAdjustment(
      adjustments,
      codigo,
      nextStatus,
      'HARD',
      'modo OFFICIAL: regra legal nao pode ser relaxada',
    )
    nextStatus = 'HARD'
  }

  return nextStatus
}

function isHardRuleRelaxation(currentStatus: RuleStatus | undefined, requestedStatus: RuleStatus | undefined): boolean {
  if (!currentStatus || !requestedStatus) return false
  return currentStatus === 'HARD' && requestedStatus !== 'HARD'
}

export async function buildEffectiveRulePolicy(options: {
  generationMode?: GenerationMode
  rulesOverride?: Record<string, string>
} = {}): Promise<EffectiveRulePolicy> {
  const generationMode = options.generationMode ?? 'OFFICIAL'
  const rows = await loadRuleRows()
  const adjustments: RulePolicyAdjustment[] = []

  if (rows.length === 0) {
    const solverRules: RuleConfig = {}
    for (const [codigo, status] of Object.entries(FALLBACK_BASE_RULES)) {
      solverRules[codigo] = applyOfficialLocks(generationMode, codigo, status, adjustments)
    }

    const validatorRules: RuleConfig = { ...solverRules }
    for (const codigo of VALIDATOR_ONLY_HARD_RULES) {
      validatorRules[codigo] = 'HARD'
    }

    return {
      generationMode,
      solverRules,
      validatorRules,
      adjustments,
    }
  }

  const solverRules: RuleConfig = {}

  for (const row of rows) {
    let nextStatus = row.status_efetivo
    const override = options.rulesOverride?.[row.codigo] as RuleStatus | undefined

    if (override !== undefined) {
      if (!row.editavel) {
        pushAdjustment(
          adjustments,
          row.codigo,
          override,
          row.status_efetivo,
          'override ignorado: regra nao editavel',
        )
      } else {
        nextStatus = override
      }
    }

    solverRules[row.codigo] = applyOfficialLocks(generationMode, row.codigo, nextStatus, adjustments)
  }

  const validatorRules: RuleConfig = { ...solverRules }
  for (const codigo of VALIDATOR_ONLY_HARD_RULES) {
    validatorRules[codigo] = 'HARD'
  }

  return {
    generationMode,
    solverRules,
    validatorRules,
    adjustments,
  }
}

export async function inferGenerationModeForOverrides(
  rulesOverride?: Record<string, string>,
): Promise<GenerationMode> {
  if (!rulesOverride || Object.keys(rulesOverride).length === 0) {
    return 'OFFICIAL'
  }

  const officialPolicy = await buildEffectiveRulePolicy({ generationMode: 'OFFICIAL' })

  for (const [codigo, status] of Object.entries(rulesOverride)) {
    if (isHardRuleRelaxation(officialPolicy.solverRules[codigo], status as RuleStatus)) {
      return 'EXPLORATORY'
    }
  }

  return 'OFFICIAL'
}
