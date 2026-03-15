import { CalendarDays } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { Colaborador, Alocacao, RegraHorarioColaborador } from '@shared/index'

const DOW_INDEX_TO_SIGLA: Record<number, string> = {
  0: 'DOM', 1: 'SEG', 2: 'TER', 3: 'QUA', 4: 'QUI', 5: 'SEX', 6: 'SAB',
}

interface ResumoFolgasProps {
  colaboradores: Colaborador[]
  alocacoes: Alocacao[]
  regrasMap: Map<number, RegraHorarioColaborador>
}

export function ResumoFolgas({ colaboradores, alocacoes, regrasMap }: ResumoFolgasProps) {
  // Só renderiza se pelo menos 1 colab tem folga configurada
  const colabsComRegra = colaboradores.filter((c) => {
    const r = regrasMap.get(c.id)
    return r?.folga_fixa_dia_semana || r?.folga_variavel_dia_semana
  })

  if (colabsComRegra.length === 0) return null

  // Contar domingos trabalhados por pessoa no período
  const domingosTrabalhados = new Map<number, number>()
  for (const a of alocacoes) {
    if (a.status !== 'TRABALHO') continue
    const d = new Date(a.data + 'T00:00:00')
    if (d.getDay() !== 0) continue
    domingosTrabalhados.set(a.colaborador_id, (domingosTrabalhados.get(a.colaborador_id) ?? 0) + 1)
  }

  // Total de domingos no período
  const totalDomingos = (() => {
    const datas = alocacoes.map((a) => a.data)
    if (datas.length === 0) return 0
    const unicas = new Set(datas)
    let count = 0
    for (const ds of unicas) {
      if (new Date(ds + 'T00:00:00').getDay() === 0) count++
    }
    return count
  })()

  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-1 rounded-lg border bg-muted/20 px-3 py-2">
      <div className="flex items-center gap-1.5 shrink-0">
        <CalendarDays className="size-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Folgas</span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {colabsComRegra.map((c) => {
          const r = regrasMap.get(c.id)!
          const nome = c.nome.split(' ').slice(0, 2).join(' ')
          const domTrab = domingosTrabalhados.get(c.id) ?? 0
          return (
            <span key={c.id} className="text-xs text-muted-foreground whitespace-nowrap">
              {nome}
              {r.folga_fixa_dia_semana && (
                <span className="ml-1 font-semibold text-foreground">FF {r.folga_fixa_dia_semana}</span>
              )}
              {r.folga_variavel_dia_semana && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="ml-1 opacity-60 italic">FV {r.folga_variavel_dia_semana}</span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs max-w-[200px]">
                    Folga variável: aplicada nos domingos em que trabalha.
                    DOM trabalhados: {domTrab}/{totalDomingos}
                  </TooltipContent>
                </Tooltip>
              )}
            </span>
          )
        })}
      </div>
    </div>
  )
}
