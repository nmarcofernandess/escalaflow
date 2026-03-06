import type { LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

interface IndicatorCardProps {
  icon: LucideIcon
  value: React.ReactNode
  label: string
  colorClass?: string
}

export function IndicatorCard({ icon: Icon, value, label, colorClass }: IndicatorCardProps) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-3">
        {colorClass ? (
          <Avatar className="size-8">
            <AvatarFallback className={cn('bg-transparent', colorClass)}>
              <Icon className="size-4" />
            </AvatarFallback>
          </Avatar>
        ) : (
          <Icon className="size-4 text-primary" />
        )}
        <div>
          <p className="text-lg font-bold text-foreground">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  )
}
