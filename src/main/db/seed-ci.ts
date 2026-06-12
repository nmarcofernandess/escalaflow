import { execute, insertReturningId, queryAll, queryOne, transaction } from './query'

export const CI_SETOR_5X2_NOME = 'CI Padaria 5x2'
export const CI_SETOR_6X1_DIFICIL_NOME = 'CI Mercearia 6x1 dificil'
export const CI_INTERMITENTE_6X1_NOME = 'CI Hellen Intermitente 6x1'

const DIAS_UTEIS = ['SEG', 'TER', 'QUA', 'QUI', 'SEX'] as const
const TODOS_DIAS = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'] as const

type DiaSemana = typeof TODOS_DIAS[number]

type ContratoRow = {
  id: number
  tipo_trabalhador: string
  regime_escala: string
  horas_semanais: number
}

async function ensureEmpresa(): Promise<void> {
  const empresa = await queryOne<{ id: number }>('SELECT id FROM empresa LIMIT 1')
  if (empresa) return

  await execute(
    `INSERT INTO empresa (nome, cnpj, telefone, corte_semanal, tolerancia_semanal_min, min_intervalo_almoco_min, usa_cct_intervalo_reduzido, grid_minutos)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    'CI EscalaFlow',
    '',
    '',
    'SEG_DOM',
    30,
    60,
    true,
    15,
  )
}

async function requireContrato(nome: string): Promise<ContratoRow> {
  const contrato = await queryOne<ContratoRow>(
    `SELECT id, tipo_trabalhador, regime_escala, horas_semanais
     FROM tipos_contrato
     WHERE nome = $1
     LIMIT 1`,
    nome,
  )
  if (!contrato) throw new Error(`Contrato obrigatorio ausente no seed core: ${nome}`)
  return contrato
}

async function ensureSetor(
  nome: string,
  regime: '5X2' | '6X1',
  abertura: string,
  fechamento: string,
): Promise<number> {
  const setor = await queryOne<{ id: number }>('SELECT id FROM setores WHERE nome = $1 LIMIT 1', nome)
  if (setor) {
    await execute(
      `UPDATE setores
       SET hora_abertura = $1,
           hora_fechamento = $2,
           regime_escala = $3,
           piso_operacional = 1,
           ativo = TRUE
       WHERE id = $4`,
      abertura,
      fechamento,
      regime,
      setor.id,
    )
    return setor.id
  }

  return insertReturningId(
    `INSERT INTO setores (nome, icone, hora_abertura, hora_fechamento, regime_escala, piso_operacional, ativo)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
    nome,
    null,
    abertura,
    fechamento,
    regime,
    1,
  )
}

async function ensureHorariosSetor(setorId: number, abertura: string, fechamento: string): Promise<void> {
  for (const dia of TODOS_DIAS) {
    const row = await queryOne<{ id: number }>(
      'SELECT id FROM setor_horario_semana WHERE setor_id = $1 AND dia_semana = $2',
      setorId,
      dia,
    )
    if (row) {
      await execute(
        `UPDATE setor_horario_semana
         SET ativo = TRUE, usa_padrao = TRUE, hora_abertura = $1, hora_fechamento = $2
         WHERE id = $3`,
        abertura,
        fechamento,
        row.id,
      )
      continue
    }
    await execute(
      `INSERT INTO setor_horario_semana (setor_id, dia_semana, ativo, usa_padrao, hora_abertura, hora_fechamento)
       VALUES ($1, $2, TRUE, TRUE, $3, $4)`,
      setorId,
      dia,
      abertura,
      fechamento,
    )
  }
}

async function ensureDemandas(
  setorId: number,
  demandas: Array<{ dia: DiaSemana; inicio: string; fim: string; pessoas: number }>,
): Promise<void> {
  const count = await queryOne<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM demandas WHERE setor_id = $1',
    setorId,
  )
  if ((count?.count ?? 0) > 0) return

  for (const demanda of demandas) {
    await execute(
      `INSERT INTO demandas (setor_id, dia_semana, hora_inicio, hora_fim, min_pessoas, override)
       VALUES ($1, $2, $3, $4, $5, FALSE)`,
      setorId,
      demanda.dia,
      demanda.inicio,
      demanda.fim,
      demanda.pessoas,
    )
  }
}

async function ensureFuncao(
  setorId: number,
  contratoId: number,
  apelido: string,
  ordem: number,
): Promise<number> {
  const funcao = await queryOne<{ id: number }>(
    'SELECT id FROM funcoes WHERE setor_id = $1 AND apelido = $2 LIMIT 1',
    setorId,
    apelido,
  )
  if (funcao) {
    await execute(
      `UPDATE funcoes
       SET tipo_contrato_id = $1, ordem = $2, ativo = TRUE
       WHERE id = $3`,
      contratoId,
      ordem,
      funcao.id,
    )
    return funcao.id
  }

  return insertReturningId(
    `INSERT INTO funcoes (setor_id, apelido, tipo_contrato_id, ativo, ordem)
     VALUES ($1, $2, $3, TRUE, $4)`,
    setorId,
    apelido,
    contratoId,
    ordem,
  )
}

async function ensureColaborador(input: {
  setorId: number
  contrato: ContratoRow
  funcaoId: number
  nome: string
  sexo: 'M' | 'F'
  rank: number
}): Promise<number> {
  const colab = await queryOne<{ id: number }>(
    'SELECT id FROM colaboradores WHERE setor_id = $1 AND nome = $2 LIMIT 1',
    input.setorId,
    input.nome,
  )
  if (colab) {
    await execute(
      `UPDATE colaboradores
       SET tipo_contrato_id = $1,
           funcao_id = $2,
           sexo = $3,
           horas_semanais = $4,
           rank = $5,
           tipo_trabalhador = $6,
           ativo = TRUE
       WHERE id = $7`,
      input.contrato.id,
      input.funcaoId,
      input.sexo,
      input.contrato.horas_semanais,
      input.rank,
      input.contrato.tipo_trabalhador,
      colab.id,
    )
    return colab.id
  }

  return insertReturningId(
    `INSERT INTO colaboradores (setor_id, tipo_contrato_id, funcao_id, nome, sexo, horas_semanais, rank, tipo_trabalhador, ativo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)`,
    input.setorId,
    input.contrato.id,
    input.funcaoId,
    input.nome,
    input.sexo,
    input.contrato.horas_semanais,
    input.rank,
    input.contrato.tipo_trabalhador,
  )
}

async function ensureIntermitenteDomingosAlternados(colaboradorId: number): Promise<void> {
  const padrao = await queryOne<{ id: number }>(
    'SELECT id FROM colaborador_regra_horario WHERE colaborador_id = $1 AND dia_semana_regra IS NULL',
    colaboradorId,
  )
  if (padrao) {
    await execute(
      `UPDATE colaborador_regra_horario
       SET ativo = TRUE,
           inicio = NULL,
           fim = NULL,
           folga_fixa_dia_semana = NULL,
           folga_variavel_dia_semana = NULL,
           recorrencia_semanas_trabalho = 1,
           recorrencia_semanas_folga = 1,
           recorrencia_ancora = '2026-06-15'
       WHERE id = $1`,
      padrao.id,
    )
  } else {
    await execute(
      `INSERT INTO colaborador_regra_horario (
         colaborador_id, dia_semana_regra, ativo, inicio, fim,
         folga_fixa_dia_semana, folga_variavel_dia_semana,
         recorrencia_semanas_trabalho, recorrencia_semanas_folga, recorrencia_ancora
       )
       VALUES ($1, NULL, TRUE, NULL, NULL, NULL, NULL, 1, 1, '2026-06-15')`,
      colaboradorId,
    )
  }

  const domingo = await queryOne<{ id: number }>(
    `SELECT id FROM colaborador_regra_horario
     WHERE colaborador_id = $1 AND dia_semana_regra = 'DOM'`,
    colaboradorId,
  )
  if (domingo) {
    await execute(
      `UPDATE colaborador_regra_horario
       SET ativo = TRUE,
           inicio = '07:00',
           fim = '12:45',
           folga_fixa_dia_semana = NULL,
           folga_variavel_dia_semana = NULL
       WHERE id = $1`,
      domingo.id,
    )
    return
  }

  await execute(
    `INSERT INTO colaborador_regra_horario (
       colaborador_id, dia_semana_regra, ativo, inicio, fim,
       folga_fixa_dia_semana, folga_variavel_dia_semana
     )
     VALUES ($1, 'DOM', TRUE, '07:00', '12:45', NULL, NULL)`,
    colaboradorId,
  )
}

async function seedCenario5x2(): Promise<void> {
  const contrato = await requireContrato('CLT 44h')
  const setorId = await ensureSetor(CI_SETOR_5X2_NOME, '5X2', '07:00', '18:00')
  await ensureHorariosSetor(setorId, '07:00', '18:00')
  await ensureDemandas(
    setorId,
    DIAS_UTEIS.map((dia) => ({ dia, inicio: '08:00', fim: '16:00', pessoas: 2 })),
  )

  for (let i = 1; i <= 4; i++) {
    const funcaoId = await ensureFuncao(setorId, contrato.id, `CI 5x2 Posto ${i}`, i)
    await ensureColaborador({
      setorId,
      contrato,
      funcaoId,
      nome: `CI 5x2 Colab ${i}`,
      sexo: i % 2 === 0 ? 'F' : 'M',
      rank: i,
    })
  }
}

async function seedCenario6x1Dificil(): Promise<void> {
  const clt6x1 = await requireContrato('CLT 44h 6x1')
  const intermitente = await requireContrato('Intermitente')
  const setorId = await ensureSetor(CI_SETOR_6X1_DIFICIL_NOME, '6X1', '07:00', '19:30')
  await ensureHorariosSetor(setorId, '07:00', '19:30')
  await ensureDemandas(setorId, [
    { dia: 'SEG', inicio: '07:00', fim: '15:00', pessoas: 4 },
    { dia: 'TER', inicio: '07:00', fim: '15:00', pessoas: 4 },
    { dia: 'QUA', inicio: '07:00', fim: '15:00', pessoas: 4 },
    { dia: 'QUI', inicio: '07:00', fim: '15:00', pessoas: 4 },
    { dia: 'SEX', inicio: '07:00', fim: '15:00', pessoas: 4 },
    { dia: 'SAB', inicio: '07:00', fim: '15:00', pessoas: 4 },
    { dia: 'DOM', inicio: '07:00', fim: '12:45', pessoas: 3 },
  ])

  for (let i = 1; i <= 5; i++) {
    const funcaoId = await ensureFuncao(setorId, clt6x1.id, `CI 6x1 Posto ${i}`, i)
    await ensureColaborador({
      setorId,
      contrato: clt6x1,
      funcaoId,
      nome: `CI 6x1 CLT ${i}`,
      sexo: i % 2 === 0 ? 'F' : 'M',
      rank: i,
    })
  }

  const funcaoIntermitente = await ensureFuncao(setorId, intermitente.id, 'CI 6x1 Apoio Domingo', 6)
  const intermitenteId = await ensureColaborador({
    setorId,
    contrato: intermitente,
    funcaoId: funcaoIntermitente,
    nome: CI_INTERMITENTE_6X1_NOME,
    sexo: 'F',
    rank: 6,
  })
  await ensureIntermitenteDomingosAlternados(intermitenteId)
}

/**
 * Seed versionado para CI e specs de regressao. Nao roda no bootstrap normal
 * do app; scripts/testes chamam explicitamente em DB temporario que pode ser
 * apagado e recriado a cada run.
 */
export async function seedCiData(): Promise<void> {
  await transaction(async () => {
    await ensureEmpresa()
    await seedCenario5x2()
    await seedCenario6x1Dificil()
  })
  const setores = await queryAll<{ nome: string }>(
    'SELECT nome FROM setores WHERE nome IN ($1, $2) ORDER BY nome',
    CI_SETOR_5X2_NOME,
    CI_SETOR_6X1_DIFICIL_NOME,
  )
  console.log(`[SEED-CI] ${setores.map((setor) => setor.nome).join(' + ')} pronto(s).`)
}
