import type { ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Progress } from '@/components/ui/progress'
import { Checkbox } from '@/components/ui/checkbox'
import { ExportPreview } from '@/componentes/ExportPreview'
import { Download, Printer, Loader2, FileSpreadsheet } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ExportOpcoes {
  avisos: boolean
  horas: boolean
}

export interface SetorExportItem {
  id: number
  nome: string
  checked: boolean
  temEscala: boolean
}

export interface ExportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  context: 'escala' | 'hub'
  titulo?: string
  children?: ReactNode
  formato: string
  onFormatoChange: (f: string) => void
  opcoes: ExportOpcoes
  onOpcoesChange: (o: ExportOpcoes) => void
  colaboradores?: { id: number; nome: string }[]
  funcionarioId?: number | null
  onFuncionarioChange?: (id: number) => void
  setoresExport?: SetorExportItem[]
  onSetoresExportChange?: (setores: SetorExportItem[]) => void
  onExportHTML: () => void
  onPrint: () => void
  onCSV?: () => void
  loading?: boolean
  progress?: number
}

export function ExportModal({
  open,
  onOpenChange,
  context,
  titulo,
  children,
  formato,
  onFormatoChange,
  opcoes,
  onOpcoesChange,
  colaboradores,
  funcionarioId,
  onFuncionarioChange,
  setoresExport,
  onSetoresExportChange,
  onExportHTML,
  onPrint,
  onCSV,
  loading = false,
  progress = 0,
}: ExportModalProps) {
  const isBatch = formato === 'batch' || formato === 'batch-geral'
  const isCSV = formato === 'csv'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{titulo || 'Exportar'}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 gap-6 overflow-hidden">
          {/* Left: Preview (~60%) */}
          <div className="flex-[3] min-w-0">
            <ExportPreview loading={loading && !isBatch}>
              {children}
            </ExportPreview>
          </div>

          {/* Right: Options (~40%) */}
          <div className="flex-[2] space-y-5 overflow-y-auto">
            {context === 'escala' ? (
              <EscalaOptions
                formato={formato}
                onFormatoChange={onFormatoChange}
                colaboradores={colaboradores}
                funcionarioId={funcionarioId}
                onFuncionarioChange={onFuncionarioChange}
              />
            ) : (
              <HubOptions
                formato={formato}
                onFormatoChange={onFormatoChange}
                setoresExport={setoresExport}
                onSetoresExportChange={onSetoresExportChange}
                colaboradores={colaboradores}
                funcionarioId={funcionarioId}
                onFuncionarioChange={onFuncionarioChange}
              />
            )}

            <Separator />

            {/* Shared toggles */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="sw-avisos" className="text-sm">Incluir avisos</Label>
                <Switch
                  id="sw-avisos"
                  checked={opcoes.avisos}
                  onCheckedChange={(checked) =>
                    onOpcoesChange({ ...opcoes, avisos: checked })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="sw-horas" className="text-sm">Incluir horas (Real vs Meta)</Label>
                <Switch
                  id="sw-horas"
                  checked={opcoes.horas}
                  onCheckedChange={(checked) =>
                    onOpcoesChange({ ...opcoes, horas: checked })
                  }
                />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {isBatch && loading ? (
            <div className="flex flex-1 items-center gap-3">
              <Progress value={progress} className="flex-1" />
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {Math.round(progress)}%
              </span>
            </div>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
                Cancelar
              </Button>
              {isCSV && onCSV ? (
                <Button onClick={onCSV} disabled={loading}>
                  {loading ? (
                    <Loader2 className="mr-1 size-4 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="mr-1 size-4" />
                  )}
                  Baixar CSV
                </Button>
              ) : (
                <>
                  <Button variant="outline" onClick={onExportHTML} disabled={loading}>
                    {loading ? (
                      <Loader2 className="mr-1 size-4 animate-spin" />
                    ) : (
                      <Download className="mr-1 size-4" />
                    )}
                    Baixar HTML
                  </Button>
                  <Button onClick={onPrint} disabled={loading}>
                    {loading ? (
                      <Loader2 className="mr-1 size-4 animate-spin" />
                    ) : (
                      <Printer className="mr-1 size-4" />
                    )}
                    Imprimir
                  </Button>
                </>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Escala Context Options ─────────────────────────────────────────────────

function EscalaOptions({
  formato,
  onFormatoChange,
  colaboradores,
  funcionarioId,
  onFuncionarioChange,
}: {
  formato: string
  onFormatoChange: (f: string) => void
  colaboradores?: { id: number; nome: string }[]
  funcionarioId?: number | null
  onFuncionarioChange?: (id: number) => void
}) {
  return (
    <div className="space-y-4">
      <Label className="text-sm font-medium">Formato</Label>
      <RadioGroup value={formato} onValueChange={onFormatoChange}>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="completa" id="fmt-completa" />
          <Label htmlFor="fmt-completa" className="text-sm font-normal">
            Escala Completa (RH)
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="funcionario" id="fmt-funcionario" />
          <Label htmlFor="fmt-funcionario" className="text-sm font-normal">
            Por Funcionario
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="batch" id="fmt-batch" />
          <Label htmlFor="fmt-batch" className="text-sm font-normal">
            Batch (todos individuais)
          </Label>
        </div>
      </RadioGroup>

      {formato === 'funcionario' && colaboradores && onFuncionarioChange && (
        <div className="space-y-2">
          <Label className="text-sm">Funcionario</Label>
          <Select
            value={funcionarioId?.toString() ?? ''}
            onValueChange={(v) => onFuncionarioChange(parseInt(v, 10))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione..." />
            </SelectTrigger>
            <SelectContent>
              {colaboradores.map((c) => (
                <SelectItem key={c.id} value={c.id.toString()}>
                  {c.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  )
}

// ─── Hub Context Options ────────────────────────────────────────────────────

function HubOptions({
  formato,
  onFormatoChange,
  setoresExport,
  onSetoresExportChange,
  colaboradores,
  funcionarioId,
  onFuncionarioChange,
}: {
  formato: string
  onFormatoChange: (f: string) => void
  setoresExport?: SetorExportItem[]
  onSetoresExportChange?: (setores: SetorExportItem[]) => void
  colaboradores?: { id: number; nome: string }[]
  funcionarioId?: number | null
  onFuncionarioChange?: (id: number) => void
}) {
  const isSingleSetor =
    setoresExport != null &&
    setoresExport.filter((s) => s.temEscala).length === 1

  if (isSingleSetor) {
    return (
      <div className="space-y-4">
        <Label className="text-sm font-medium">Pra quem?</Label>
        <RadioGroup value={formato} onValueChange={onFormatoChange}>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="completa" id="hub-fmt-completa" />
            <Label htmlFor="hub-fmt-completa" className="text-sm font-normal">
              RH (escala completa)
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="funcionario" id="hub-fmt-funcionario" />
            <Label htmlFor="hub-fmt-funcionario" className="text-sm font-normal">
              Funcionario (individual)
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="batch" id="hub-fmt-batch" />
            <Label htmlFor="hub-fmt-batch" className="text-sm font-normal">
              Todos funcionarios (batch)
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="csv" id="hub-fmt-csv" />
            <Label htmlFor="hub-fmt-csv" className="text-sm font-normal">
              CSV (dados brutos)
            </Label>
          </div>
        </RadioGroup>

        {formato === 'funcionario' && colaboradores && onFuncionarioChange && (
          <div className="space-y-2">
            <Label className="text-sm">Funcionario</Label>
            <Select
              value={funcionarioId?.toString() ?? ''}
              onValueChange={(v) => onFuncionarioChange(parseInt(v, 10))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent>
                {colaboradores.map((c) => (
                  <SelectItem key={c.id} value={c.id.toString()}>
                    {c.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    )
  }

  // Multi-setor mode
  return (
    <div className="space-y-4">
      <Label className="text-sm font-medium">Pra quem?</Label>
      <RadioGroup value={formato} onValueChange={onFormatoChange}>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="completa" id="hub-fmt-multi-completa" />
          <Label htmlFor="hub-fmt-multi-completa" className="text-sm font-normal">
            RH (todos os setores)
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="batch-geral" id="hub-fmt-batch-geral" />
          <Label htmlFor="hub-fmt-batch-geral" className="text-sm font-normal">
            Funcionarios (batch geral)
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="csv" id="hub-fmt-multi-csv" />
          <Label htmlFor="hub-fmt-multi-csv" className="text-sm font-normal">
            CSV (dados brutos)
          </Label>
        </div>
      </RadioGroup>

      {setoresExport && onSetoresExportChange && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Setores</Label>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={() =>
                  onSetoresExportChange(
                    setoresExport.map((s) => ({
                      ...s,
                      checked: s.temEscala ? true : s.checked,
                    }))
                  )
                }
              >
                Todos
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={() =>
                  onSetoresExportChange(
                    setoresExport.map((s) => ({ ...s, checked: false }))
                  )
                }
              >
                Nenhum
              </Button>
            </div>
          </div>
          {setoresExport.map((s) => (
            <div key={s.id} className="flex items-center space-x-2">
              <Checkbox
                id={`setor-export-${s.id}`}
                checked={s.checked}
                disabled={!s.temEscala}
                onCheckedChange={(checked) =>
                  onSetoresExportChange(
                    setoresExport.map((item) =>
                      item.id === s.id
                        ? { ...item, checked: checked === true }
                        : item
                    )
                  )
                }
              />
              <Label
                htmlFor={`setor-export-${s.id}`}
                className={cn(
                  'text-sm',
                  !s.temEscala && 'text-muted-foreground'
                )}
              >
                {s.nome}
                {!s.temEscala && ' (sem escala)'}
              </Label>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
