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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'
import { ExportPreview } from '@/componentes/ExportPreview'
import { Download, Printer, Loader2, FileSpreadsheet } from 'lucide-react'

export interface SetorExportItem {
  id: number
  nome: string
  checked: boolean
  temEscala: boolean
}

export interface EscalaExportContent {
  ciclo: boolean
  timeline: boolean
  funcionarios: boolean
  avisos: boolean
}

export interface ExportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  context: 'escala' | 'hub'
  titulo?: string
  children?: ReactNode
  formato: string
  onFormatoChange: (f: string) => void
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
  conteudoEscala?: EscalaExportContent
  onConteudoEscalaChange?: (next: EscalaExportContent) => void
}

export function ExportModal({
  open,
  onOpenChange,
  context,
  titulo,
  children,
  formato,
  onFormatoChange,
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
  conteudoEscala,
  onConteudoEscalaChange,
}: ExportModalProps) {
  const isEscala = context === 'escala'
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
            {isEscala ? (
              <EscalaContentOptions
                conteudo={conteudoEscala}
                onChange={onConteudoEscalaChange}
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
          </div>
        </div>

        {isEscala ? (
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancelar
            </Button>
            {onCSV && (
              <Button variant="outline" onClick={onCSV} disabled={loading}>
                {loading ? (
                  <Loader2 className="mr-1 size-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="mr-1 size-4" />
                )}
                CSV
              </Button>
            )}
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
          </DialogFooter>
        ) : (
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
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Escala Context Content Toggles ─────────────────────────────────────────

function EscalaContentOptions({
  conteudo,
  onChange,
}: {
  conteudo?: EscalaExportContent
  onChange?: (next: EscalaExportContent) => void
}) {
  const value: EscalaExportContent = conteudo ?? {
    ciclo: true,
    timeline: false,
    funcionarios: false,
    avisos: false,
  }
  const disabled = !onChange

  const toggle = (key: keyof EscalaExportContent, checked: boolean) => {
    if (!onChange) return
    onChange({ ...value, [key]: checked })
  }

  return (
    <div className="space-y-4">
      <Label className="text-sm font-medium">Conteudo da exportacao</Label>
      <div className="rounded-md border">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div>
            <p className="text-sm font-medium">Ciclo</p>
            <p className="text-[11px] text-muted-foreground">Tabela semanal da escala.</p>
          </div>
          <Switch checked={value.ciclo} onCheckedChange={(checked) => toggle('ciclo', checked)} disabled={disabled} />
        </div>
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div>
            <p className="text-sm font-medium">Timeline</p>
            <p className="text-[11px] text-muted-foreground">Visao por faixa horaria e cobertura.</p>
          </div>
          <Switch checked={value.timeline} onCheckedChange={(checked) => toggle('timeline', checked)} disabled={disabled} />
        </div>
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div>
            <p className="text-sm font-medium">Por funcionario</p>
            <p className="text-[11px] text-muted-foreground">Inclui todos os funcionarios do setor.</p>
          </div>
          <Switch checked={value.funcionarios} onCheckedChange={(checked) => toggle('funcionarios', checked)} disabled={disabled} />
        </div>
        <div className="flex items-center justify-between px-3 py-2">
          <div>
            <p className="text-sm font-medium">Avisos</p>
            <p className="text-[11px] text-muted-foreground">Inclui blocos de violacoes.</p>
          </div>
          <Switch checked={value.avisos} onCheckedChange={(checked) => toggle('avisos', checked)} disabled={disabled} />
        </div>
      </div>
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

  // Multi-setor mode (setores pre-selecionados via bulk selection nos cards)
  const selectedNames = setoresExport?.filter((s) => s.checked && s.temEscala).map((s) => s.nome) ?? []

  return (
    <div className="space-y-4">
      <Label className="text-sm font-medium">Formato</Label>
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

      {/* Show selected setores (read-only, selected via bulk actions) */}
      {selectedNames.length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            {selectedNames.length} setor{selectedNames.length > 1 ? 'es' : ''} selecionado{selectedNames.length > 1 ? 's' : ''}
          </Label>
          <p className="text-xs text-muted-foreground">
            {selectedNames.slice(0, 5).join(', ')}
            {selectedNames.length > 5 && ` e mais ${selectedNames.length - 5}`}
          </p>
        </div>
      )}
    </div>
  )
}
