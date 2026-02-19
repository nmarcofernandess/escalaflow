import { XCircle, AlertTriangle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { CORES_VIOLACAO } from '@/lib/cores'
import { formatarData, REGRAS_TEXTO, iniciais } from '@/lib/formatadores'
import type { Violacao } from '@shared/index'

export interface ViolacoesAgrupadasProps {
  violacoes: Violacao[]
}

export function ViolacoesAgrupadas({ violacoes }: ViolacoesAgrupadasProps) {
  // Agrupar por colaborador
  const porColaborador = violacoes.reduce(
    (acc, v) => {
      const key = v.colaborador_id ?? -1
      if (!acc[key]) {
        acc[key] = {
          colaborador_id: key,
          colaborador_nome: v.colaborador_nome || 'Setor',
          hard: [],
          soft: [],
        }
      }
      if (v.severidade === 'HARD') {
        acc[key].hard.push(v)
      } else {
        acc[key].soft.push(v)
      }
      return acc
    },
    {} as Record<
      number,
      { colaborador_id: number; colaborador_nome: string; hard: Violacao[]; soft: Violacao[] }
    >,
  )

  const grupos = Object.values(porColaborador)
  const comHard = grupos.filter((g) => g.hard.length > 0)
  const comSoft = grupos.filter((g) => g.soft.length > 0 && g.hard.length === 0)

  return (
    <div className="space-y-4">
      {/* HARD Violations */}
      {comHard.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-destructive flex items-center gap-2">
            <XCircle className="size-4" />
            Violacoes Criticas (HARD)
          </h3>
          {comHard.map((grupo) => (
            <Card
              key={grupo.colaborador_id}
              className={cn('border-2', CORES_VIOLACAO.HARD.border, CORES_VIOLACAO.HARD.bg)}
            >
              <CardContent className="p-4 space-y-3">
                {/* Avatar + Nome */}
                <div className="flex items-center gap-3">
                  <Avatar className="size-10">
                    <AvatarFallback className="bg-destructive/10 text-sm font-bold text-destructive">
                      {iniciais(grupo.colaborador_nome)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {grupo.colaborador_nome}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {grupo.hard.length} problema{grupo.hard.length > 1 ? 's' : ''} critico
                      {grupo.hard.length > 1 ? 's' : ''}
                    </p>
                  </div>
                </div>

                {/* Problemas por dia */}
                <div className="space-y-2">
                  {grupo.hard.map((v, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                      <div>
                        <p className="font-medium text-destructive">
                          {v.mensagem || REGRAS_TEXTO[v.regra] || v.regra}
                        </p>
                        {v.data && (
                          <p className="text-muted-foreground">Dia: {formatarData(v.data)}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Dica de acao */}
                <p className="text-xs text-muted-foreground italic border-t pt-2">
                  Clique em um dia de trabalho desse colaborador para trocar por folga
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* SOFT Violations */}
      {comSoft.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-2">
            <AlertTriangle className="size-4" />
            Alertas (SOFT)
          </h3>
          {comSoft.map((grupo) => (
            <Card
              key={grupo.colaborador_id}
              className={cn('border', CORES_VIOLACAO.SOFT.border, CORES_VIOLACAO.SOFT.bg)}
            >
              <CardContent className="p-3 space-y-2">
                {/* Avatar + Nome */}
                <div className="flex items-center gap-2">
                  <Avatar className="size-8">
                    <AvatarFallback className="bg-amber-100 dark:bg-amber-950/30 text-xs font-bold text-amber-700 dark:text-amber-300">
                      {iniciais(grupo.colaborador_nome)}
                    </AvatarFallback>
                  </Avatar>
                  <p className="text-sm font-medium text-foreground">{grupo.colaborador_nome}</p>
                </div>

                {/* Problemas */}
                <div className="space-y-1">
                  {grupo.soft.map((v, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-600 dark:text-amber-400" />
                      <p className="text-muted-foreground">
                        {v.mensagem || REGRAS_TEXTO[v.regra] || v.regra}
                        {v.data && ` (${formatarData(v.data)})`}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
