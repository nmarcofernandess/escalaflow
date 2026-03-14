import { Link } from 'react-router-dom'
import { CheckCircle2, CircleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface PreflightItem {
  ok: boolean
  label: string
  linkTo?: string
  hint?: string
}

interface PreflightChecklistProps {
  items: PreflightItem[]
}

export function PreflightChecklist({ items }: PreflightChecklistProps) {
  const allOk = items.every(i => i.ok)
  if (allOk) return null

  return (
    <div className="rounded-md border bg-muted/30 px-3 py-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Antes de gerar
      </p>
      <ul className="space-y-1">
        {items.map((item, idx) => {
          const Icon = item.ok ? CheckCircle2 : CircleAlert
          const content = (
            <span className="flex items-center gap-2 text-sm">
              <Icon
                className={cn(
                  'size-4 shrink-0',
                  item.ok ? 'text-success' : 'text-muted-foreground',
                )}
              />
              <span className={item.ok ? 'text-muted-foreground' : 'text-foreground'}>
                {item.label}
              </span>
              {item.hint && !item.ok && (
                <span className="text-xs text-muted-foreground">({item.hint})</span>
              )}
            </span>
          )

          if (item.linkTo && !item.ok) {
            return (
              <li key={idx}>
                <Link to={item.linkTo} className="hover:underline">
                  {content}
                </Link>
              </li>
            )
          }

          return <li key={idx}>{content}</li>
        })}
      </ul>
    </div>
  )
}
