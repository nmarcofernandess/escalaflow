import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface Props {
  tokens: number
  limit: number | null
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function IaContextBadge({ tokens, limit }: Props) {
  const pct = limit ? (tokens / limit) * 100 : 0
  const color = !limit
    ? 'text-muted-foreground'
    : pct > 80
      ? 'text-red-500'
      : pct > 60
        ? 'text-yellow-500'
        : 'text-green-500'

  const circumference = 2 * Math.PI * 7
  const dashOffset = limit ? circumference * (1 - Math.min(pct / 100, 1)) : circumference

  const tooltipText = limit
    ? `~${formatTokens(tokens)} / ${formatTokens(limit)} tokens (${pct.toFixed(1)}%)`
    : `~${formatTokens(tokens)} tokens`

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={`flex items-center justify-center size-6 ${color}`}>
            <svg width="20" height="20" viewBox="0 0 20 20" className="rotate-[-90deg]">
              <circle
                cx="10" cy="10" r="7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeOpacity="0.2"
              />
              <circle
                cx="10" cy="10" r="7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
              />
            </svg>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {tooltipText}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
