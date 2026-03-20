import { useState } from 'react'
import {
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Info,
  Lightbulb,
  Loader2,
  PlusCircle,
  Sparkles,
  XCircle,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type {
  AdvisoryDiffItem,
  AdvisoryPinViolation,
  AdvisoryStatus,
  DiaSemana,
  EscalaAdvisoryOutputV2,
  PreviewDiagnostic,
} from '@shared/index'
import { DIAS_CURTOS } from '@/lib/ciclo-grid-types'
import { cn } from '@/lib/utils'

/* ─── Props ─────────────────────────────────────────────────── */

interface SugestaoSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  loading: boolean
  advisory: EscalaAdvisoryOutputV2 | null
  onAceitarEGerar: () => void
  onGerarMesmoAssim: () => void
  onCancelar: () => void
  onAnalisarIa?: () => void
}

/* ─── Status config ────────────────────────────────────────── */

const STATUS_CONFIG: Record<AdvisoryStatus, {
  subtitle: string
  accent: string
  icon: typeof CheckCircle2
}> = {
  CURRENT_VALID: {
    subtitle: 'O arranjo de folgas esta OK para o periodo selecionado.',
    accent: 'text-emerald-500',
    icon: CheckCircle2,
  },
  PROPOSAL_VALID: {
    subtitle: 'Para que a escala funcione, o sistema sugere alguns ajustes.',
    accent: 'text-amber-500',
    icon: Lightbulb,
  },
  NO_PROPOSAL: {
    subtitle: 'Nao foi possivel encontrar um arranjo viavel.',
    accent: 'text-rose-500',
    icon: XCircle,
  },
}

/* ─── Helpers ───────────────────────────────────────────────── */

function fmtDia(dia: DiaSemana | null): string {
  return dia ? DIAS_CURTOS[dia] : '-'
}

/* ─── DiagnosticRow — renders a PreviewDiagnostic ─────────── */

const DIAG_VISUAL = {
  error: {
    icon: XCircle,
    iconClass: 'text-rose-500',
    bg: 'bg-rose-500/10 border-rose-500/20',
    textClass: 'text-rose-700 dark:text-rose-400',
  },
  warning: {
    icon: AlertTriangle,
    iconClass: 'text-amber-500',
    bg: 'bg-amber-500/10 border-amber-500/20',
    textClass: 'text-amber-700 dark:text-amber-400',
  },
  info: {
    icon: Info,
    iconClass: 'text-emerald-500',
    bg: 'bg-emerald-500/10 border-emerald-500/20',
    textClass: 'text-emerald-700 dark:text-emerald-400',
  },
} as const

function DiagnosticRow({ diag }: { diag: PreviewDiagnostic }) {
  const v = DIAG_VISUAL[diag.severity]
  const Icon = v.icon

  return (
    <div className={cn('flex items-center gap-3 rounded-lg border px-3 py-2', v.bg)}>
      <Icon className={cn('size-4 shrink-0', v.iconClass)} />
      <div className="flex-1 min-w-0">
        <span className={cn('text-sm font-medium', v.textClass)}>{diag.title}</span>
        {diag.severity !== 'info' && diag.detail && (
          <p className="text-xs opacity-70 mt-0.5">{diag.detail}</p>
        )}
      </div>
    </div>
  )
}

/* ─── Legacy DiffCell — kept for retrocompat when pin_violations is empty ── */

function DiffCell({ atual, proposta }: { atual: DiaSemana | null; proposta: DiaSemana | null }) {
  if (atual === proposta) {
    return <span className="text-muted-foreground">{fmtDia(atual)}</span>
  }
  if (!atual && proposta) {
    return (
      <span className="font-semibold text-emerald-500">
        {fmtDia(proposta)} <PlusCircle className="ml-0.5 inline size-3" />
      </span>
    )
  }
  if (atual && !proposta) {
    return (
      <span className="font-semibold text-rose-400">
        - <XCircle className="ml-0.5 inline size-3" />
      </span>
    )
  }
  return (
    <span className="font-semibold text-amber-500">
      {fmtDia(proposta)} <Zap className="ml-0.5 inline size-3" />
    </span>
  )
}

/* ─── Legacy ProposalSection — fallback when pin_violations empty ───── */

function LegacyProposalSection({ diff }: { diff: AdvisoryDiffItem[] }) {
  const changedItems = diff.filter((d) => d.fixa_atual !== d.fixa_proposta || d.variavel_atual !== d.variavel_proposta)
  const unchangedCount = diff.length - changedItems.length

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Zap className="size-4 text-amber-500" />
        <h4 className="text-sm font-semibold">Ajustes sugeridos</h4>
        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
          {changedItems.length} {changedItems.length === 1 ? 'alteracao' : 'alteracoes'}
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Nome</th>
              <th className="px-2 py-2 text-center font-medium text-muted-foreground" colSpan={2}>Atual</th>
              <th className="w-6" />
              <th className="px-2 py-2 text-center font-medium text-muted-foreground" colSpan={2}>Sugestao</th>
            </tr>
            <tr className="border-b bg-muted/20 text-xs text-muted-foreground">
              <th />
              <th className="px-2 py-1 text-center font-normal">FF</th>
              <th className="px-2 py-1 text-center font-normal">FV</th>
              <th />
              <th className="px-2 py-1 text-center font-normal">FF</th>
              <th className="px-2 py-1 text-center font-normal">FV</th>
            </tr>
          </thead>
          <tbody>
            {changedItems.map((d) => (
              <tr key={d.colaborador_id} className="border-b bg-amber-500/5">
                <td className="px-3 py-2 font-medium">{d.nome}</td>
                <td className="px-2 py-2 text-center text-muted-foreground">{fmtDia(d.fixa_atual)}</td>
                <td className="px-2 py-2 text-center text-muted-foreground">{fmtDia(d.variavel_atual)}</td>
                <td className="px-1 py-2 text-center">
                  <ArrowRight className="mx-auto size-3 text-amber-500" />
                </td>
                <td className="px-2 py-2 text-center">
                  <DiffCell atual={d.fixa_atual} proposta={d.fixa_proposta} />
                </td>
                <td className="px-2 py-2 text-center">
                  <DiffCell atual={d.variavel_atual} proposta={d.variavel_proposta} />
                </td>
              </tr>
            ))}
            {unchangedCount > 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-2 text-xs text-muted-foreground">
                  {unchangedCount} colaborador{unchangedCount > 1 ? 'es' : ''} sem alteracao
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ─── V2 Violations Section — grouped by person ──────────── */

function ViolationsSection({ violations }: { violations: AdvisoryPinViolation[] }) {
  const [autoExpanded, setAutoExpanded] = useState(false)

  const autoViolations = violations.filter(v => v.origin === 'auto')
  const userViolations = violations.filter(v => v.origin === 'manual' || v.origin === 'saved')

  return (
    <div className="space-y-4">
      {/* User section — expanded by default, highlighted */}
      {userViolations.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-500" />
            <h4 className="text-sm font-semibold">
              Mudancas nas suas escolhas ({userViolations.length})
            </h4>
          </div>
          <div className="space-y-1.5 pl-6">
            {userViolations.map((v, i) => (
              <div key={`user-${v.colaborador_id}-${v.dia}-${i}`} className="text-sm">
                <span className="font-medium">{v.nome}</span>
                <span className="text-muted-foreground">: {v.descricao}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Auto section — collapsed by default */}
      {autoViolations.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={() => setAutoExpanded(!autoExpanded)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="text-xs">{autoExpanded ? '\u25BE' : '\u25B8'}</span>
            <span>Ajustes automaticos ({autoViolations.length})</span>
          </button>
          {autoExpanded && (
            <div className="pl-6 space-y-1 text-sm text-muted-foreground">
              {autoViolations.map((v, i) => (
                <div key={`auto-${v.colaborador_id}-${v.dia}-${i}`}>
                  <span className="font-medium text-foreground/80">{v.nome}</span>: {v.descricao}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ─── Main component ────────────────────────────────────────── */

export function SugestaoSheet({
  open,
  onOpenChange,
  loading,
  advisory,
  onAceitarEGerar,
  onGerarMesmoAssim,
  onCancelar,
  onAnalisarIa,
}: SugestaoSheetProps) {
  const config = advisory ? STATUS_CONFIG[advisory.status] : null
  const StatusIcon = config?.icon ?? Lightbulb

  const hasErrors = advisory?.diagnostics.some((d) => d.severity === 'error') ?? false
  const diagnosticsToShow = advisory?.diagnostics.filter((d) => d.severity !== 'info') ?? []

  // V2: prefer pin_violations over legacy proposal diff
  const pinViolations = advisory?.pin_violations ?? []
  const hasPinViolations = pinViolations.length > 0
  const hasLegacyProposal = !hasPinViolations && !!advisory?.proposal
  const hasAnyChanges = hasPinViolations || hasLegacyProposal
  const pinCost = advisory?.pin_cost ?? 0

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[70vh] overflow-y-auto">
        {/* Header */}
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {loading ? (
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            ) : (
              <StatusIcon className={cn('size-5', config?.accent)} />
            )}
            Sugestao de ajuste
          </SheetTitle>
          <SheetDescription>
            {loading ? 'Analisando o arranjo...' : config?.subtitle ?? ''}
          </SheetDescription>
        </SheetHeader>

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center gap-3 py-12">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Analisando o arranjo...</span>
          </div>
        )}

        {/* Content */}
        {!loading && advisory && (
          <div className="space-y-6 py-4">
            {/* Diagnostics (errors + warnings only) */}
            {diagnosticsToShow.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Avisos
                </h4>
                <div className="space-y-1.5">
                  {diagnosticsToShow.map((d, idx) => (
                    <DiagnosticRow key={`${d.code}-${idx}`} diag={d} />
                  ))}
                </div>
              </div>
            )}

            {/* V2: Pin violations grouped by type */}
            {hasPinViolations && (
              <ViolationsSection violations={pinViolations} />
            )}

            {/* Legacy: Proposal diff fallback (retrocompat) */}
            {hasLegacyProposal && advisory.proposal && (
              <LegacyProposalSection diff={advisory.proposal.diff} />
            )}

            {/* Success message when no changes needed and no issues */}
            {!hasAnyChanges && !hasErrors && (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-6 py-5 text-center">
                <CheckCircle2 className="size-8 text-emerald-500" />
                <div>
                  <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                    Tudo certo!
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    O arranjo de folgas esta OK para o periodo selecionado.
                  </p>
                </div>
              </div>
            )}

            {/* Error state without changes — offer IA */}
            {!hasAnyChanges && hasErrors && onAnalisarIa && (
              <div className="flex flex-col gap-3 rounded-lg border border-rose-500/20 bg-rose-500/5 px-5 py-4">
                <p className="text-sm text-rose-700 dark:text-rose-400">
                  Nao foi possivel montar um arranjo viavel com a equipe e demanda atuais. Use a IA para entender melhor.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onAnalisarIa}
                  className="w-fit border-rose-500/30 text-rose-700 hover:bg-rose-500/10 dark:text-rose-400"
                >
                  <Sparkles className="size-4" />
                  Analisar com IA
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <SheetFooter className="flex-row gap-2 sm:justify-start">
          {pinCost > 0 && (
            <Button
              onClick={onAceitarEGerar}
              disabled={loading}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              Aceitar e Gerar
            </Button>
          )}
          <Button variant="secondary" onClick={onGerarMesmoAssim} disabled={loading}>
            Gerar mesmo assim
          </Button>
          <Button variant="ghost" onClick={onCancelar}>
            Cancelar
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
