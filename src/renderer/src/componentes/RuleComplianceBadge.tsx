import { Shield } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { DiagnosticoSolver } from '@shared/index'

interface RuleComplianceBadgeProps {
  diagnostico: DiagnosticoSolver
}

interface CategoryCount {
  label: string
  ativas: number
  total: number
}

function categorizarRegras(regrasAtivas: string[], regrasOff: string[]): CategoryCount[] {
  const todas = [...regrasAtivas, ...regrasOff]
  const ativasSet = new Set(regrasAtivas)

  const categorias: Record<string, { label: string; ativas: number; total: number }> = {
    CLT: { label: 'CLT', ativas: 0, total: 0 },
    SOFT: { label: 'SOFT', ativas: 0, total: 0 },
    AP: { label: 'AP', ativas: 0, total: 0 },
  }

  for (const regra of todas) {
    let cat: string
    if (regra.startsWith('H') && /^H\d/.test(regra)) {
      cat = 'CLT'
    } else if (regra.startsWith('S') || regra.startsWith('SOFT')) {
      cat = 'SOFT'
    } else if (regra.startsWith('AP')) {
      cat = 'AP'
    } else {
      // Regras sem prefixo reconhecido — agrupar como CLT (fallback conservador)
      cat = 'CLT'
    }

    categorias[cat].total++
    if (ativasSet.has(regra)) {
      categorias[cat].ativas++
    }
  }

  return Object.values(categorias).filter((c) => c.total > 0)
}

export function RuleComplianceBadge({ diagnostico }: RuleComplianceBadgeProps) {
  const categorias = categorizarRegras(diagnostico.regras_ativas, diagnostico.regras_off)

  if (categorias.length === 0) return null

  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2">
      <Shield className="size-4 text-muted-foreground shrink-0" />
      <span className="text-xs font-medium text-muted-foreground">Regras</span>
      <div className="flex items-center gap-1.5">
        {categorias.map((cat) => {
          const full = cat.ativas === cat.total
          return (
            <Badge
              key={cat.label}
              variant="outline"
              className={cn(
                'text-[10px] font-semibold tabular-nums gap-1 px-1.5 py-0',
                full
                  ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                  : 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300',
              )}
            >
              {cat.label} {cat.ativas}/{cat.total}
            </Badge>
          )
        })}
      </div>
    </div>
  )
}
