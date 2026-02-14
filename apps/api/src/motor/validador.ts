import type Database from 'better-sqlite3'
import { CLT, type DiaSemana } from '@escalaflow/shared'
import type { Alocacao, Violacao, Indicadores } from '@escalaflow/shared'

/**
 * Valida uma escala já persistida no banco.
 * Roda regras R1-R8 + calcula indicadores.
 * Usado por POST /ajustar e PUT /oficializar.
 */
export function validarEscala(
  escalaId: number,
  db: Database.Database,
  tolerancia_min = 30
): { violacoes: Violacao[]; indicadores: Indicadores } {
  // ═══════════════════════════════════════════════════════════════════════════
  // CARREGAR DADOS DO BANCO
  // ═══════════════════════════════════════════════════════════════════════════

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

  const demandas = db.prepare('SELECT * FROM demandas WHERE setor_id = ?').all(escala.setor_id) as {
    dia_semana: DiaSemana | null
    hora_inicio: string
    hora_fim: string
    min_pessoas: number
  }[]

  const excecoes = db.prepare('SELECT * FROM excecoes WHERE setor_id = ?').all(escala.setor_id) as {
    colaborador_id: number
    data: string
  }[]

  // ═══════════════════════════════════════════════════════════════════════════
  // PREPARAR ESTRUTURA (reutilizar lógica do gerador)
  // ═══════════════════════════════════════════════════════════════════════════

  const dias = getDias(escala.data_inicio, escala.data_fim)
  const domingos = dias.filter((d) => diaSemana(d) === 'DOM')

  // Reconstruir resultado Map<colaborador_id, Map<data, celula>>
  const resultado = new Map<number, Map<string, { status: string; hora_inicio: string | null; hora_fim: string | null; minutos: number | null }>>()

  for (const c of colaboradores) {
    const mapa = new Map<string, { status: string; hora_inicio: string | null; hora_fim: string | null; minutos: number | null }>()
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
        // Alocação não existe (raro, mas defensivo)
        mapa.set(d, { status: 'FOLGA', hora_inicio: null, hora_fim: null, minutos: null })
      }
    }
    resultado.set(c.id, mapa)
  }

  // Lookback (assumir zero — validação não considera histórico anterior à escala)
  const lookback = new Map<number, { diasConsec: number; domConsec: number }>()
  for (const c of colaboradores) {
    lookback.set(c.id, { diasConsec: 0, domConsec: 0 })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VALIDAÇÃO R1-R8 (copiar lógica exata do gerador.ts linhas 525-698)
  // ═══════════════════════════════════════════════════════════════════════════

  const violacoes: Violacao[] = []
  const TOLERANCIA_MIN = tolerancia_min

  for (const c of colaboradores) {
    const mapa = resultado.get(c.id)!
    const diasOrdered = [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0]))

    // R1: Max dias consecutivos
    let consec = lookback.get(c.id)!.diasConsec
    for (const [d, cel] of diasOrdered) {
      if (cel.status === 'TRABALHO') {
        consec++
        if (consec > CLT.MAX_DIAS_CONSECUTIVOS) {
          violacoes.push({
            severidade: 'HARD',
            regra: 'MAX_DIAS_CONSECUTIVOS',
            colaborador_id: c.id,
            colaborador_nome: c.nome,
            mensagem: `${c.nome} trabalhou ${consec} dias seguidos (max ${CLT.MAX_DIAS_CONSECUTIVOS})`,
            data: d,
          })
        }
      } else {
        consec = 0
      }
    }

    // R2: Min descanso entre jornadas
    let prevFim: number | null = null
    let prevData: string | null = null
    for (const [d, cel] of diasOrdered) {
      if (cel.status === 'TRABALHO' && cel.hora_fim) {
        if (prevFim !== null && prevData !== null) {
          const p = new Date(prevData + 'T12:00:00')
          const curr = new Date(d + 'T12:00:00')
          const daysDiff = Math.round((curr.getTime() - p.getTime()) / 86400000)
          if (daysDiff === 1) {
            const descanso = 1440 - prevFim + timeToMin(cel.hora_inicio!)
            if (descanso < CLT.MIN_DESCANSO_ENTRE_JORNADAS_MIN) {
              violacoes.push({
                severidade: 'HARD',
                regra: 'DESCANSO_ENTRE_JORNADAS',
                colaborador_id: c.id,
                colaborador_nome: c.nome,
                mensagem: `${c.nome}: so ${descanso}min entre ${prevData} e ${d} (min ${CLT.MIN_DESCANSO_ENTRE_JORNADAS_MIN}min)`,
                data: d,
              })
            }
          }
        }
        prevFim = timeToMin(cel.hora_fim)
        prevData = d
      } else {
        prevFim = null
        prevData = null
      }
    }

    // R3: Rodizio de domingo
    let domC = lookback.get(c.id)!.domConsec
    const maxDom = CLT.MAX_DOMINGOS_CONSECUTIVOS[c.sexo]
    for (const d of domingos) {
      const cel = mapa.get(d)
      if (cel && cel.status === 'TRABALHO') {
        domC++
        if (domC > maxDom) {
          violacoes.push({
            severidade: 'HARD',
            regra: 'RODIZIO_DOMINGO',
            colaborador_id: c.id,
            colaborador_nome: c.nome,
            mensagem: `${c.nome}: ${domC} domingos seguidos (max ${maxDom})`,
            data: d,
          })
        }
      } else {
        domC = 0
      }
    }

    // R4: Max jornada diaria
    for (const [d, cel] of diasOrdered) {
      if (cel.status === 'TRABALHO' && cel.minutos && cel.minutos > CLT.MAX_JORNADA_DIARIA_MIN) {
        violacoes.push({
          severidade: 'HARD',
          regra: 'MAX_JORNADA_DIARIA',
          colaborador_id: c.id,
          colaborador_nome: c.nome,
          mensagem: `${c.nome}: ${cel.minutos}min em ${d} (max ${CLT.MAX_JORNADA_DIARIA_MIN}min)`,
          data: d,
        })
      }
    }

    // R5: Meta semanal (SOFT)
    const weeks = getWeeks(dias)
    for (const week of weeks) {
      if (week.length < 4) continue

      let totalMin = 0
      for (const d of week) {
        const cel = mapa.get(d)
        if (cel && cel.status === 'TRABALHO' && cel.minutos) totalMin += cel.minutos
      }
      const weekRatio = week.length / 7
      const metaScaled = Math.round(c.horas_semanais * 60 * weekRatio)
      const tolScaled = Math.round(TOLERANCIA_MIN * (1 / weekRatio))
      if (Math.abs(totalMin - metaScaled) > tolScaled) {
        violacoes.push({
          severidade: 'SOFT',
          regra: 'META_SEMANAL',
          colaborador_id: c.id,
          colaborador_nome: c.nome,
          mensagem: `${c.nome}: ${Math.round(totalMin / 60)}h na semana (meta ~${Math.round(metaScaled / 60)}h)`,
          data: week[0],
        })
      }
    }

    // R6: Preferencia de dia (SOFT)
    if (c.evitar_dia_semana) {
      const count = diasOrdered.filter(
        ([d, cel]) => cel.status === 'TRABALHO' && diaSemana(d) === c.evitar_dia_semana
      ).length
      if (count > 0) {
        violacoes.push({
          severidade: 'SOFT',
          regra: 'PREFERENCIA_DIA',
          colaborador_id: c.id,
          colaborador_nome: c.nome,
          mensagem: `${c.nome} trabalhou ${count}x em ${c.evitar_dia_semana} (prefere folga)`,
          data: null,
        })
      }
    }

    // R7: Preferencia de turno (SOFT)
    if (c.prefere_turno) {
      for (const [d, cel] of diasOrdered) {
        if (cel.status !== 'TRABALHO' || !cel.hora_inicio) continue
        const hi = timeToMin(cel.hora_inicio)
        if (c.prefere_turno === 'MANHA' && hi >= 720) {
          violacoes.push({
            severidade: 'SOFT',
            regra: 'PREFERENCIA_TURNO',
            colaborador_id: c.id,
            colaborador_nome: c.nome,
            mensagem: `${c.nome}: alocado a tarde em ${d} (prefere manha)`,
            data: d,
          })
        } else if (c.prefere_turno === 'TARDE' && hi < 720) {
          violacoes.push({
            severidade: 'SOFT',
            regra: 'PREFERENCIA_TURNO',
            colaborador_id: c.id,
            colaborador_nome: c.nome,
            mensagem: `${c.nome}: alocado de manha em ${d} (prefere tarde)`,
            data: d,
          })
        }
      }
    }
  }

  // R8: Cobertura por faixa (SOFT)
  for (const d of dias) {
    const ds = diaSemana(d)
    const faixasDia = demandas.filter((dem) => dem.dia_semana === ds || dem.dia_semana === null)

    for (const faixa of faixasDia) {
      let alocados = 0
      for (const c of colaboradores) {
        const cel = resultado.get(c.id)!.get(d)!
        if (cel.status === 'TRABALHO' && cel.hora_inicio && cel.hora_fim) {
          const pIni = timeToMin(cel.hora_inicio)
          const pFim = timeToMin(cel.hora_fim)
          const fIni = timeToMin(faixa.hora_inicio)
          const fFim = timeToMin(faixa.hora_fim)
          if (pIni < fFim && pFim > fIni) alocados++
        }
      }
      if (alocados < faixa.min_pessoas) {
        violacoes.push({
          severidade: 'SOFT',
          regra: 'COBERTURA',
          colaborador_id: null,
          colaborador_nome: '',
          mensagem: `${d} ${faixa.hora_inicio}-${faixa.hora_fim}: ${alocados}/${faixa.min_pessoas} pessoas`,
          data: d,
        })
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SCORING (copiar lógica exata do gerador.ts linhas 700-746)
  // ═══════════════════════════════════════════════════════════════════════════

  // Cobertura %
  let totalFaixas = 0
  let faixasAtendidas = 0
  for (const d of dias) {
    const ds = diaSemana(d)
    for (const faixa of demandas.filter((dem) => dem.dia_semana === ds || dem.dia_semana === null)) {
      totalFaixas++
      let alocados = 0
      for (const c of colaboradores) {
        const cel = resultado.get(c.id)!.get(d)!
        if (cel.status === 'TRABALHO' && cel.hora_inicio && cel.hora_fim) {
          const pIni = timeToMin(cel.hora_inicio)
          const pFim = timeToMin(cel.hora_fim)
          if (pIni < timeToMin(faixa.hora_fim) && pFim > timeToMin(faixa.hora_inicio)) alocados++
        }
      }
      if (alocados >= faixa.min_pessoas) faixasAtendidas++
    }
  }
  const cobertura_percent = totalFaixas > 0 ? (faixasAtendidas / totalFaixas) * 100 : 100

  const violacoes_hard = violacoes.filter((v) => v.severidade === 'HARD').length
  const violacoes_soft = violacoes.filter((v) => v.severidade === 'SOFT').length

  // Equilibrio: desvio padrao de minutos totais entre colaboradores
  const minutosPerColab = colaboradores.map((c) => {
    let total = 0
    for (const d of dias) {
      const cel = resultado.get(c.id)!.get(d)!
      if (cel.minutos) total += cel.minutos
    }
    return total
  })
  const avg = minutosPerColab.reduce((s, v) => s + v, 0) / (minutosPerColab.length || 1)
  const variance = minutosPerColab.reduce((s, v) => s + (v - avg) ** 2, 0) / (minutosPerColab.length || 1)
  const equilibrio = Math.max(0, 100 - Math.sqrt(variance) * 0.5)

  const pontuacao = Math.round(
    cobertura_percent * 0.4 +
      (violacoes_hard === 0 ? 100 : 0) * 0.3 +
      equilibrio * 0.2 +
      Math.max(0, 100 - violacoes_soft * 10) * 0.1
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // RETORNO
  // ═══════════════════════════════════════════════════════════════════════════

  return {
    violacoes,
    indicadores: {
      cobertura_percent: Math.round(cobertura_percent * 10) / 10,
      violacoes_hard,
      violacoes_soft,
      equilibrio: Math.round(equilibrio * 10) / 10,
      pontuacao,
    },
  }
}

// ─── Helpers (copiar do gerador.ts) ─────────────────────────────────────────

function getDias(inicio: string, fim: string): string[] {
  const result: string[] = []
  const curr = new Date(inicio + 'T12:00:00')
  const end = new Date(fim + 'T12:00:00')
  while (curr <= end) {
    result.push(curr.toISOString().split('T')[0])
    curr.setDate(curr.getDate() + 1)
  }
  return result
}

function diaSemana(data: string): DiaSemana {
  const d = new Date(data + 'T12:00:00')
  return ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'][d.getDay()] as DiaSemana
}

function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function getWeeks(dias: string[]): string[][] {
  if (dias.length === 0) return []
  const weeks: string[][] = []
  let week: string[] = []
  for (let i = 0; i < dias.length; i++) {
    week.push(dias[i])
    if (diaSemana(dias[i]) === 'DOM' || i === dias.length - 1) {
      weeks.push(week)
      week = []
    }
  }
  return weeks
}
