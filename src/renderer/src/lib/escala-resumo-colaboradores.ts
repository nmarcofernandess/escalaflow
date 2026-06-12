import type { Alocacao, Colaborador, TipoContrato, Violacao } from '@shared/index'

const TOLERANCIA_POR_SEMANA = 15

export interface ResumoColaboradorRow {
  colab: Colaborador
  real: number
  meta: number
  delta: number
  ok: boolean
  contratoNome: string
  hard: Violacao[]
  soft: Violacao[]
  violacoes: Violacao[]
}

interface CalcularResumoInput {
  colaboradores: Colaborador[]
  alocacoes: Alocacao[]
  violacoes: Violacao[]
  tiposContrato: Array<Pick<TipoContrato, 'id' | 'nome' | 'horas_semanais' | 'tipo_trabalhador'>>
  dataInicio: string
  dataFim: string
}

function semanasEntre(dataInicio: string, dataFim: string): number {
  const start = new Date(dataInicio + 'T00:00:00')
  const end = new Date(dataFim + 'T00:00:00')
  const totalDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
  return Math.max(1, totalDays / 7)
}

function tipoLegal(colab: Colaborador, contrato?: Pick<TipoContrato, 'tipo_trabalhador'>): string {
  return colab.tipo_trabalhador ?? contrato?.tipo_trabalhador ?? 'CLT'
}

export function calcularResumoColaboradores({
  colaboradores,
  alocacoes,
  violacoes,
  tiposContrato,
  dataInicio,
  dataFim,
}: CalcularResumoInput): ResumoColaboradorRow[] {
  const semanas = semanasEntre(dataInicio, dataFim)
  const toleranciaTotal = Math.ceil(semanas) * TOLERANCIA_POR_SEMANA

  const minutosReais = new Map<number, number>()
  for (const a of alocacoes) {
    const minutos = a.minutos_trabalho ?? a.minutos
    if (a.status === 'TRABALHO' && minutos != null) {
      minutosReais.set(a.colaborador_id, (minutosReais.get(a.colaborador_id) ?? 0) + minutos)
    }
  }

  const violacoesPorColab = new Map<number, Violacao[]>()
  for (const v of violacoes) {
    if (v.colaborador_id != null) {
      const arr = violacoesPorColab.get(v.colaborador_id) ?? []
      arr.push(v)
      violacoesPorColab.set(v.colaborador_id, arr)
    }
  }

  return colaboradores.map((colab) => {
    const contrato = tiposContrato.find((t) => t.id === colab.tipo_contrato_id)
    const real = minutosReais.get(colab.id) ?? 0
    const isIntermitente = tipoLegal(colab, contrato) === 'INTERMITENTE'
    const meta = isIntermitente
      ? real
      : (contrato ? Math.round(contrato.horas_semanais * 60 * semanas) : 0)
    const delta = real - meta
    const ok = isIntermitente ? true : delta >= -toleranciaTotal
    const colabViolacoes = violacoesPorColab.get(colab.id) ?? []
    const hard = colabViolacoes.filter((v) => v.severidade === 'HARD')
    const soft = colabViolacoes.filter((v) => v.severidade !== 'HARD')

    return {
      colab,
      real,
      meta,
      delta,
      ok,
      contratoNome: contrato?.nome ?? '-',
      hard,
      soft,
      violacoes: colabViolacoes,
    }
  })
}
