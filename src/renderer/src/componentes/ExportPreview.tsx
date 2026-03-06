import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ExportPreviewProps {
  children: ReactNode
  loading?: boolean
  scale?: number
  className?: string
}

export function ExportPreview({
  children,
  loading = false,
  scale = 0.4,
  className,
}: ExportPreviewProps) {
  return (
    <div
      className={cn(
        'relative max-h-[500px] overflow-auto rounded-lg border bg-muted/50',
        className,
      )}
    >
      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/80 backdrop-blur-sm">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Scaled preview content — forced light for export fidelity */}
      <div
        data-export-preview
        className="light bg-white text-foreground"
        style={{
          zoom: scale,
          colorScheme: 'light',
        }}
      >
        {children}
      </div>
    </div>
  )
}
