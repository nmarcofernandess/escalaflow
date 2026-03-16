import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// ColaboradorCard — visual idêntico ao mockup card-v3.html (Opção B)
//
// Layout fixo 2 linhas:
//   L1: Nome (13px, medium, truncate)
//   L2: Posto · Contrato · Badge/Status (11px, flex, dot separators)
//
// Variantes:
//   - Férias: borda amber, bg amber sutil
//   - Atestado: borda red, bg red sutil
//   - Normal: borda zinc-800
//   - Com rightContent: flex between, badge à direita
// ---------------------------------------------------------------------------

export interface ColaboradorCardProps {
  nome: string
  posto?: string | null
  contrato?: string | null
  status?: 'Ativo' | 'Ferias' | 'Atestado' | 'Bloqueio'
  excecaoTipo?: 'FERIAS' | 'ATESTADO' | 'BLOQUEIO'
  extra?: string
  onClick?: () => void
  href?: string
  rightContent?: ReactNode
  disabled?: boolean
  className?: string
}

// Dot separator
function Dot() {
  return <span className="text-muted-foreground">·</span>
}

// Status badge — matches mockup .badge { font-size:9px; border-radius:9999px }
function StatusBadgeInline({ tipo }: { tipo: string }) {
  const styles: Record<string, string> = {
    FERIAS: 'border-amber-500/40 text-amber-600 dark:text-amber-500',
    ATESTADO: 'border-red-500/40 text-red-600 dark:text-red-500',
    BLOQUEIO: 'border-muted-foreground/40 text-muted-foreground',
  }
  const labels: Record<string, string> = {
    FERIAS: 'Férias',
    ATESTADO: 'Atestado',
    BLOQUEIO: 'Bloqueio',
  }
  return (
    <span className={cn(
      'inline-flex items-center text-[9px] font-medium px-1.5 py-px rounded-full border whitespace-nowrap',
      styles[tipo] ?? 'border-border text-muted-foreground',
    )}>
      {labels[tipo] ?? tipo}
    </span>
  )
}

export function ColaboradorCard({
  nome,
  posto,
  contrato,
  status,
  excecaoTipo,
  extra,
  onClick,
  href,
  rightContent,
  disabled,
  className,
}: ColaboradorCardProps) {
  const cardClass = cn(
    'rounded-lg border border-border px-3.5 py-2.5 text-left transition-colors',
    !excecaoTipo && 'hover:bg-accent',
    excecaoTipo === 'FERIAS' && 'border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10 dark:bg-amber-500/[0.03] dark:hover:bg-amber-500/[0.07]',
    excecaoTipo === 'ATESTADO' && 'border-red-500/30 bg-red-500/5 hover:bg-red-500/10 dark:bg-red-500/[0.03] dark:hover:bg-red-500/[0.07]',
    excecaoTipo === 'BLOQUEIO' && 'border-muted-foreground/20 bg-muted/50 hover:bg-muted',
    disabled && 'opacity-50 pointer-events-none',
    className,
  )

  // Build meta parts (L2) — dot-separated, no duplicates
  const metaParts: ReactNode[] = []

  if (posto) {
    metaParts.push(<span key="p">{posto}</span>)
  }
  if (contrato) {
    metaParts.push(<span key="c">{contrato}</span>)
  }
  if (excecaoTipo) {
    metaParts.push(<StatusBadgeInline key="b" tipo={excecaoTipo} />)
  } else if (status) {
    const isReserva = status === 'Ativo' && !posto
    const label = isReserva ? 'Reserva' : status
    metaParts.push(
      <span key="s" className={cn(
        status === 'Ativo' && !isReserva && 'text-emerald-600 dark:text-emerald-400',
        isReserva && 'text-muted-foreground',
        status === 'Ferias' && 'text-amber-600 dark:text-amber-500',
        status === 'Atestado' && 'text-red-600 dark:text-red-500',
        status === 'Bloqueio' && 'text-muted-foreground',
      )}>
        {label}
      </span>
    )
  }
  if (extra) {
    metaParts.push(<span key="e" className="text-muted-foreground">{extra}</span>)
  }

  const inner = (
    <div className={rightContent ? 'flex items-center justify-between gap-2' : undefined}>
      <div className="min-w-0 flex-1">
        {/* L1: Nome — 13px medium, truncate */}
        <p className="truncate text-[13px] font-medium text-foreground">{nome}</p>
        {/* L2: Meta — 11px, flex, dot-separated */}
        {metaParts.length > 0 && (
          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground overflow-hidden">
            {metaParts.map((part, i) => (
              <span key={i} className="contents">
                {i > 0 && <Dot />}
                {part}
              </span>
            ))}
          </div>
        )}
      </div>
      {rightContent && <div className="shrink-0 ml-2">{rightContent}</div>}
    </div>
  )

  if (href) {
    return (
      <Link to={href} className={cn(cardClass, 'block no-underline cursor-pointer')}>
        {inner}
      </Link>
    )
  }

  if (onClick) {
    return (
      <button type="button" className={cn(cardClass, 'w-full cursor-pointer')} onClick={onClick} disabled={disabled}>
        {inner}
      </button>
    )
  }

  return <div className={cardClass}>{inner}</div>
}
