import type { EscalaCompleta, Setor, Colaborador } from '@shared/index'

const SEP = ';'

/** UTF-8 BOM para Excel reconhecer encoding. Adicionar no inicio do arquivo final. */
export const CSV_BOM = '\uFEFF'

function escapeCsv(val: string | number | null | undefined): string {
  if (val == null) return ''
  const s = String(val)
  if (s.includes(SEP) || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function row(fields: (string | number | null | undefined)[]): string {
  return fields.map(escapeCsv).join(SEP)
}

/**
 * Gera CSV de alocacoes (todas as escalas).
 * Colunas: Data, Colaborador, Setor, Status, Hora Inicio, Hora Fim, Minutos
 */
export function gerarCSVAlocacoes(
  escalas: EscalaCompleta[],
  setores: Setor[],
  colaboradores: Colaborador[],
): string {
  const setorMap = new Map(setores.map((s) => [s.id, s.nome]))
  const colabMap = new Map(colaboradores.map((c) => [c.id, c.nome]))

  const header = row(['Data', 'Colaborador', 'Setor', 'Status', 'Hora Inicio', 'Hora Fim', 'Minutos'])

  const lines: string[] = [header]

  for (const ec of escalas) {
    const setorNome = setorMap.get(ec.escala.setor_id) ?? `Setor ${ec.escala.setor_id}`
    for (const a of ec.alocacoes) {
      const colabNome = colabMap.get(a.colaborador_id) ?? `Colab ${a.colaborador_id}`
      lines.push(
        row([a.data, colabNome, setorNome, a.status, a.hora_inicio, a.hora_fim, a.minutos]),
      )
    }
  }

  return lines.join('\n')
}

/**
 * Gera CSV de violacoes (todas as escalas).
 * Colunas: Colaborador, Setor, Regra, Severidade, Data, Mensagem
 */
export function gerarCSVViolacoes(
  escalas: EscalaCompleta[],
  setores: Setor[],
): string {
  const setorMap = new Map(setores.map((s) => [s.id, s.nome]))

  const header = row(['Colaborador', 'Setor', 'Regra', 'Severidade', 'Data', 'Mensagem'])

  const lines: string[] = [header]

  for (const ec of escalas) {
    const setorNome = setorMap.get(ec.escala.setor_id) ?? `Setor ${ec.escala.setor_id}`
    for (const v of ec.violacoes) {
      lines.push(
        row([v.colaborador_nome, setorNome, v.regra, v.severidade, v.data, v.mensagem]),
      )
    }
  }

  return lines.join('\n')
}
