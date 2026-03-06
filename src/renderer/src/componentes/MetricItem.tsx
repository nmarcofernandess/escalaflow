import type { LucideIcon } from 'lucide-react'

interface MetricItemProps {
  icon: LucideIcon
  value: React.ReactNode
  label: string
}

export function MetricItem({ icon: Icon, value, label }: MetricItemProps) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-muted/50 px-2.5 py-1.5">
      <Icon className="size-3.5 text-muted-foreground" />
      <div>
        <p className="text-xs font-medium text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}
