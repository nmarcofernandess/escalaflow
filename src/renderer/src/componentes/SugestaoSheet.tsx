import { CheckCircle2, Lightbulb, Loader2, MinusCircle, PlusCircle, XCircle, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type {
  AdvisoryCriterion,
  AdvisoryDiffItem,
  DiaSemana,
  EscalaAdvisoryOutput,
} from '@shared/index'
import { DIAS_CURTOS } from '@/lib/ciclo-grid-types'
import { cn } from '@/lib/utils'

/* ─── Props ─────────────────────────────────────────────────── */

interface SugestaoSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  loading: boolean
  advisory: EscalaAdvisoryOutput | null
  onAceitar: () => void
  onDescartar: () => void
}

/* ─── Helpers ───────────────────────────────────────────────── */

const STATUS_SUBTITLE: Record<EscalaAdvisoryOutput['status'], string> = {
  CURRENT_VALID: 'O arranjo atual esta valido.',
  PROPOSAL_VALID: 'O sistema encontrou uma proposta melhor.',
  CURRENT_INVALID: 'O arranjo atual tem problemas.',
  PROPOSAL_INVALID: 'A proposta encontrada ainda tem pendencias.',
  NO_PROPOSAL: 'O solver nao encontrou solucao viavel.',
}

function fmtDia(dia: DiaSemana | null): string {
  return dia ? DIAS_CURTOS[dia] : '-'
}

/* ─── CriterionRow ──────────────────────────────────────────── */

const CRITERION_CONFIG = {
  PASS: { icon: CheckCircle2, className: 'text-success' },
  FAIL: { icon: XCircle, className: 'text-destructive' },
  NOT_EVALUATED: { icon: MinusCircle, className: 'text-muted-foreground' },
} as const

function CriterionRow({ criterion }: { criterion: AdvisoryCriterion }) {
  const config = CRITERION_CONFIG[criterion.status]
  const Icon = config.icon

  return (
    <div data-status={criterion.status} className="flex items-center gap-2 text-sm">
      <Icon className={cn('size-4 shrink-0', config.className)} />
      <span className={config.className}>{criterion.title}</span>
    </div>
  )
}

/* ─── DiffCell ──────────────────────────────────────────────── */

function DiffCell({ atual, proposta }: { atual: DiaSemana | null; proposta: DiaSemana | null }) {
  if (atual === proposta) {
    return <span className="text-muted-foreground">{fmtDia(atual)}</span>
  }
  if (!atual && proposta) {
    return (
      <span className="font-semibold text-success">
        - &rarr; {fmtDia(proposta)} <PlusCircle className="ml-0.5 inline size-3" />
      </span>
    )
  }
  return (
    <span>
      <span className="text-muted-foreground">{fmtDia(atual)}</span>
      <span className="mx-1 text-muted-foreground">&rarr;</span>
      <span className="font-semibold text-warning">
        {fmtDia(proposta)} <Zap className="ml-0.5 inline size-3" />
      </span>
    </span>
  )
}

/* ─── DiffTable ─────────────────────────────────────────────── */

function DiffTable({ diff }: { diff: AdvisoryDiffItem[] }) {
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Colaborador</TableHead>
            <TableHead>Variavel</TableHead>
            <TableHead>Fixo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {diff.map((d) => (
            <TableRow key={d.colaborador_id}>
              <TableCell className="font-medium">{d.nome}</TableCell>
              <TableCell>
                <DiffCell atual={d.variavel_atual} proposta={d.variavel_proposta} />
              </TableCell>
              <TableCell>
                <DiffCell atual={d.fixa_atual} proposta={d.fixa_proposta} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Legenda */}
      <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
        <span>sem icone = manteve</span>
        <span className="text-warning">
          <Zap className="mr-0.5 inline size-3" /> mudou
        </span>
        <span className="text-success">
          <PlusCircle className="mr-0.5 inline size-3" /> adicionou
        </span>
      </div>
    </>
  )
}

/* ─── CriteriaBlock ─────────────────────────────────────────── */

function CriteriaBlock({ title, criteria }: { title: string; criteria: AdvisoryCriterion[] }) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-muted-foreground">{title}</h4>
      <div className="space-y-1">
        {criteria.map((c) => (
          <CriterionRow key={c.code} criterion={c} />
        ))}
      </div>
    </div>
  )
}

/* ─── Main component ────────────────────────────────────────── */

export function SugestaoSheet({
  open,
  onOpenChange,
  loading,
  advisory,
  onAceitar,
  onDescartar,
}: SugestaoSheetProps) {
  const subtitle =
    advisory ? STATUS_SUBTITLE[advisory.status] : 'Analisando...'

  const hasProposal = !!advisory?.proposal

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[70vh] overflow-y-auto">
        {/* ── 1. Header ─────────────────────────────────── */}
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Lightbulb className="size-5" />
            Sugestao do Sistema
          </SheetTitle>
          <SheetDescription>{loading ? 'Analisando...' : subtitle}</SheetDescription>
        </SheetHeader>

        {/* ── Loading state ─────────────────────────────── */}
        {loading && (
          <div className="flex flex-col items-center justify-center gap-3 py-12">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Analisando...</span>
          </div>
        )}

        {/* ── Content (only when not loading and advisory exists) */}
        {!loading && advisory && (
          <div className="space-y-6 py-4">
            {/* ── 2. Estado Atual ─────────────────────────── */}
            <CriteriaBlock title="Estado atual" criteria={advisory.current.criteria} />

            {/* ── 3. Proposta ─────────────────────────────── */}
            {advisory.proposal && (
              <div className="space-y-4">
                <h4 className="text-sm font-medium text-muted-foreground">Proposta de ajuste</h4>
                <DiffTable diff={advisory.proposal.diff} />
                <div className="mt-4 space-y-1">
                  {advisory.proposal.criteria.map((c) => (
                    <CriterionRow key={c.code} criterion={c} />
                  ))}
                </div>
              </div>
            )}

            {/* ── Fallback message ────────────────────────── */}
            {advisory.status === 'NO_PROPOSAL' && advisory.fallback && (
              <p className="text-sm text-muted-foreground">
                {advisory.fallback.reason || 'O sistema nao encontrou solucao. Use a IA para diagnostico.'}
              </p>
            )}
          </div>
        )}

        {/* ── 4. Footer ──────────────────────────────────── */}
        <SheetFooter className="flex-row gap-2 sm:justify-start">
          <Button
            onClick={onAceitar}
            disabled={!hasProposal || loading}
            className="bg-success text-success-foreground hover:bg-success/90"
          >
            Aceitar sugestao
          </Button>
          <Button variant="outline" onClick={onDescartar}>
            Descartar
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">
            {!hasProposal && !loading
              ? 'O sistema nao encontrou solucao. Use a IA para diagnostico.'
              : 'Aceitar aplica a proposta so na simulacao'}
          </span>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
