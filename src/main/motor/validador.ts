import type Database from 'better-sqlite3'
import type { DiaSemana } from '../../shared'
import type { Alocacao, Violacao, Indicadores, Demanda } from '../../shared'
import {
  dateRange, isDomingo,
  validarRegras, calcularIndicadores,
  type CelulaValidacao, type LookbackData,
} from './validacao-compartilhada'

/**
 * Valida uma escala ja persistida no banco.
 * Roda regras R1-R8 + calcula indicadores.
 */
export function validarEscala(
  escalaId: number,
  db: Database.Database,
  tolerancia_min = 30
): { violacoes: Violacao[]; indicadores: Indicadores } {
  const escala = db.prepare('SELECT * FROM escalas WHERE id = ?').get(escalaId) as
    | { setor_id: number; data_inicio: string; data_fim: string }
    | undefined

  if (!escala) throw new Error(`Escala ${escalaId} nao encontrada`)

  const alocacoes = db
    .prepare('SELECT * FROM alocacoes WHERE escala_id = ? ORDER BY data')
    .all(escalaId) as Alocacao[]

  const colaboradores = db
    .prepare(
      `SELECT c.*, tc.dias_trabalho, tc.trabalha_domingo, tc.max_minutos_dia
       FROM colaboradores c
       JOIN tipos_contrato tc ON c.tipo_contrato_id = tc.id
       WHERE c.setor_id = ? AND c.ativo = 1`
    )
    .all(escala.setor_id) as {
    id: number
    nome: string
    sexo: 'M' | 'F'
    horas_semanais: number
    prefere_turno: 'MANHA' | 'TARDE' | null
    evitar_dia_semana: DiaSemana | null
    dias_trabalho: number
    trabalha_domingo: boolean
    max_minutos_dia: number
  }[]

  const demandas = db.prepare('SELECT * FROM demandas WHERE setor_id = ?').all(escala.setor_id) as Demanda[]

  const dias = dateRange(escala.data_inicio, escala.data_fim)

  // Montar mapa de resultado a partir das alocacoes persistidas
  const resultado = new Map<number, Map<string, CelulaValidacao>>()

  for (const c of colaboradores) {
    const mapa = new Map<string, CelulaValidacao>()
    for (const d of dias) {
      const aloc = alocacoes.find((a) => a.colaborador_id === c.id && a.data === d)
      if (aloc) {
        mapa.set(d, {
          status: aloc.status,
          hora_inicio: aloc.hora_inicio,
          hora_fim: aloc.hora_fim,
          minutos: aloc.minutos,
        })
      } else {
        mapa.set(d, { status: 'FOLGA', hora_inicio: null, hora_fim: null, minutos: null })
      }
    }
    resultado.set(c.id, mapa)
  }

  // Empresa config: corte_semanal
  const empresa = db.prepare('SELECT corte_semanal, tolerancia_semanal_min FROM empresa LIMIT 1').get() as
    | { corte_semanal: string; tolerancia_semanal_min: number }
    | undefined
  const corteSemanal = empresa?.corte_semanal ?? 'SEG_DOM'

  // Lookback: escala OFICIAL anterior (mesma logica do gerador.ts FASE 1)
  const escalaAnterior = db.prepare(`
    SELECT * FROM escalas
    WHERE setor_id = ? AND status = 'OFICIAL' AND data_fim < ?
    ORDER BY data_fim DESC LIMIT 1
  `).get(escala.setor_id, escala.data_inicio) as { id: number } | undefined

  const lookback = new Map<number, LookbackData>()

  if (escalaAnterior) {
    const lb = new Date(escala.data_inicio + 'T12:00:00')
    lb.setDate(lb.getDate() - 7)
    const lbStr = lb.toISOString().split('T')[0]

    const prevAlocs = db.prepare(`
      SELECT * FROM alocacoes
      WHERE escala_id = ? AND data >= ?
      ORDER BY data DESC
    `).all(escalaAnterior.id, lbStr) as Alocacao[]

    for (const c of colaboradores) {
      const mine = prevAlocs
        .filter(a => a.colaborador_id === c.id)
        .sort((a, b) => b.data.localeCompare(a.data))

      let diasConsec = 0
      for (const a of mine) {
        if (a.status === 'TRABALHO') diasConsec++
        else break
      }

      let domConsec = 0
      for (const a of mine.filter(a => isDomingo(a.data))) {
        if (a.status === 'TRABALHO') domConsec++
        else break
      }

      lookback.set(c.id, { diasConsec, domConsec })
    }
  }

  for (const c of colaboradores) {
    if (!lookback.has(c.id)) {
      lookback.set(c.id, { diasConsec: 0, domConsec: 0 })
    }
  }

  const violacoes = validarRegras(colaboradores, resultado, demandas, dias, lookback, tolerancia_min, corteSemanal)
  const indicadores = calcularIndicadores(colaboradores, resultado, demandas, dias, violacoes)

  return { violacoes, indicadores }
}
