/**
 * Dados mínimos reprodutíveis para testes E2E (Playwright + Electron).
 * Só roda quando ESCALAFLOW_E2E=1. Idempotente: não duplica Padaria/colaboradores E2E.
 */
import { queryOne, queryAll, execute, insertReturningId, transaction } from './query'

export const E2E_SETOR_PADARIA_NOME = 'Padaria'

const COLAB_E2E_1 = 'E2E Colaborador Alpha'
const COLAB_E2E_2 = 'E2E Colaborador Beta'

export async function seedE2eData(): Promise<void> {
  if (process.env.ESCALAFLOW_E2E !== '1') return

  const clt44 = await queryOne<{ id: number }>(`SELECT id FROM tipos_contrato WHERE nome = 'CLT 44h'`)
  if (!clt44) {
    console.warn('[SEED-E2E] CLT 44h não encontrado — seed core deve rodar antes.')
    return
  }

  await transaction(async () => {
    const empresaExiste = await queryOne<{ id: number }>('SELECT id FROM empresa LIMIT 1')
    if (!empresaExiste) {
      await execute(
        `INSERT INTO empresa (nome, cnpj, telefone, corte_semanal, tolerancia_semanal_min, min_intervalo_almoco_min, usa_cct_intervalo_reduzido)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        'E2E Demo Loja',
        '',
        '',
        'SEG_DOM',
        0,
        60,
        true,
      )
    }

    let setor = await queryOne<{ id: number }>('SELECT id FROM setores WHERE nome = ?', E2E_SETOR_PADARIA_NOME)
    if (!setor) {
      const sid = await insertReturningId(
        `
        INSERT INTO setores (nome, icone, hora_abertura, hora_fechamento, regime_escala, ativo)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
        E2E_SETOR_PADARIA_NOME,
        null,
        '06:00',
        '22:00',
        '5X2',
        true,
      )
      setor = { id: sid }
    }

    const setorId = setor.id
    const dias: Array<'SEG' | 'TER' | 'QUA' | 'QUI' | 'SEX' | 'SAB' | 'DOM'> = [
      'SEG',
      'TER',
      'QUA',
      'QUI',
      'SEX',
      'SAB',
      'DOM',
    ]
    const existHor = await queryOne<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM setor_horario_semana WHERE setor_id = ?',
      setorId,
    )
    if ((existHor?.n ?? 0) === 0) {
      for (const d of dias) {
        await execute(
          'INSERT INTO setor_horario_semana (setor_id, dia_semana, ativo, usa_padrao, hora_abertura, hora_fechamento) VALUES (?, ?, ?, ?, ?, ?)',
          setorId,
          d,
          true,
          true,
          '06:00',
          '22:00',
        )
      }
    }

    const nFunc = await queryOne<{ n: number }>('SELECT COUNT(*)::int AS n FROM funcoes WHERE setor_id = ?', setorId)
    let funcaoId1: number | undefined
    if ((nFunc?.n ?? 0) === 0) {
      funcaoId1 = await insertReturningId(
        `
        INSERT INTO funcoes (setor_id, apelido, tipo_contrato_id, ordem)
        VALUES (?, ?, ?, ?)
      `,
        setorId,
        'Atendimento',
        clt44.id,
        1,
      )
      await insertReturningId(
        `
        INSERT INTO funcoes (setor_id, apelido, tipo_contrato_id, ordem)
        VALUES (?, ?, ?, ?)
      `,
        setorId,
        'Producao',
        clt44.id,
        2,
      )
    } else {
      const f = await queryOne<{ id: number }>(
        'SELECT id FROM funcoes WHERE setor_id = ? ORDER BY ordem ASC LIMIT 1',
        setorId,
      )
      funcaoId1 = f?.id
    }

    const names = await queryAll<{ nome: string }>(
      'SELECT nome FROM colaboradores WHERE setor_id = ?',
      setorId,
    )
    const have = new Set(names.map((r) => r.nome))
    if (!have.has(COLAB_E2E_1)) {
      await insertReturningId(
        `
        INSERT INTO colaboradores (setor_id, tipo_contrato_id, nome, sexo, horas_semanais, rank, prefere_turno, evitar_dia_semana, tipo_trabalhador, funcao_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        setorId,
        clt44.id,
        COLAB_E2E_1,
        'M',
        44,
        1,
        'MANHA',
        null,
        'CLT',
        funcaoId1 ?? null,
      )
    }
    if (!have.has(COLAB_E2E_2)) {
      await insertReturningId(
        `
        INSERT INTO colaboradores (setor_id, tipo_contrato_id, nome, sexo, horas_semanais, rank, prefere_turno, evitar_dia_semana, tipo_trabalhador, funcao_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        setorId,
        clt44.id,
        COLAB_E2E_2,
        'F',
        44,
        0,
        'TARDE',
        null,
        'CLT',
        funcaoId1 ?? null,
      )
    }

    const nDem = await queryOne<{ n: number }>('SELECT COUNT(*)::int AS n FROM demandas WHERE setor_id = ?', setorId)
    if ((nDem?.n ?? 0) === 0) {
      await insertReturningId(
        `
        INSERT INTO demandas (setor_id, dia_semana, hora_inicio, hora_fim, min_pessoas)
        VALUES (?, ?, ?, ?, ?)
      `,
        setorId,
        'SAB',
        '08:00',
        '12:00',
        2,
      )
    }
  })

  await applyE2eIaConfigFromEnv()

  console.log('[SEED-E2E] Dataset Padaria + colaboradores E2E pronto.')
}

/** Injeta chaves de API do ambiente no DB para o chat IA funcionar nos testes E2E. */
async function applyE2eIaConfigFromEnv(): Promise<void> {
  const gemini = process.env.GEMINI_API_KEY?.trim()
  const openrouter = process.env.OPENROUTER_API_KEY?.trim()
  if (!gemini && !openrouter) return

  const row = await queryOne<{ id: number }>('SELECT id FROM configuracao_ia WHERE id = 1')
  if (gemini) {
    if (row) {
      await execute(
        `UPDATE configuracao_ia SET provider = 'gemini', api_key = ?, ativo = TRUE, atualizado_em = NOW() WHERE id = 1`,
        gemini,
      )
    } else {
      await execute(
        `INSERT INTO configuracao_ia (id, provider, api_key, modelo, provider_configs_json, ativo) VALUES (1, 'gemini', ?, 'gemini-3-flash-preview', '{}', TRUE)`,
        gemini,
      )
    }
    return
  }
  if (openrouter) {
    if (row) {
      await execute(
        `UPDATE configuracao_ia SET provider = 'openrouter', api_key = ?, ativo = TRUE, atualizado_em = NOW() WHERE id = 1`,
        openrouter,
      )
    } else {
      await execute(
        `INSERT INTO configuracao_ia (id, provider, api_key, modelo, provider_configs_json, ativo) VALUES (1, 'openrouter', ?, 'google/gemini-2.0-flash-001', '{}', TRUE)`,
        openrouter,
      )
    }
  }
}
