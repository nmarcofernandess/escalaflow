import { FileText, FileSpreadsheet, X } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import type { CheckboxState } from '@/hooks/useSetorSelection'

interface BulkActionBarProps {
  selectedCount: number
  totalCount: number
  checkboxState: CheckboxState
  onToggleAll: () => void
  onExportHTML: () => void
  onExportCSV: () => void
  onClose: () => void
}

export function BulkActionBar({
  selectedCount,
  totalCount,
  checkboxState,
  onToggleAll,
  onExportHTML,
  onExportCSV,
  onClose,
}: BulkActionBarProps) {
  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 animate-in slide-in-from-bottom-4 fade-in duration-200">
      <Card className="flex items-center gap-3 px-4 py-2.5 shadow-lg border-border/80 bg-background/95 backdrop-blur-sm">
        {/* Select all checkbox */}
        <Checkbox
          checked={checkboxState === 'all' ? true : checkboxState === 'indeterminate' ? 'indeterminate' : false}
          onCheckedChange={onToggleAll}
          aria-label="Selecionar todos"
        />

        {/* Count */}
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          <Badge variant="secondary" className="mr-1.5 tabular-nums">
            {selectedCount}
          </Badge>
          de {totalCount} setores
        </span>

        <Separator orientation="vertical" className="!h-5" />

        {/* Actions */}
        <Button variant="outline" size="sm" className="gap-1.5" onClick={onExportHTML} disabled={selectedCount === 0}>
          <FileText className="size-3.5" />
          Exportar HTML
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={onExportCSV} disabled={selectedCount === 0}>
          <FileSpreadsheet className="size-3.5" />
          Exportar CSV
        </Button>

        <Separator orientation="vertical" className="!h-5" />

        {/* Close */}
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </Card>
    </div>
  )
}
