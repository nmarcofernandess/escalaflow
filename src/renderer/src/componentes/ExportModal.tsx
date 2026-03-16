import { useState, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { ExportPreview } from '@/componentes/ExportPreview'
import { ExportarEscala } from '@/componentes/ExportarEscala'
import { Download, Printer, Loader2, FileSpreadsheet } from 'lucide-react'

import type {
  Escala,
  Alocacao,
  Colaborador,
  Setor,
  Violacao,
  TipoContrato,
  Funcao,
  SetorHorarioSemana,
  RegraHorarioColaborador,
} from '@shared/index'
import type { Aviso } from '@/componentes/AvisosSection'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EscalaExportData {
  escala: Escala
  alocacoes: Alocacao[]
  colaboradores: Colaborador[]
  setor: Setor
  violacoes: Violacao[]
  avisos: Aviso[]
  tiposContrato: TipoContrato[]
  funcoes: Funcao[]
  horariosSemana: SetorHorarioSemana[]
  regrasPadrao: RegraHorarioColaborador[]
}

export interface FuncionarioExportData {
  colaborador: Colaborador
  setor: Setor
  escala: Escala
  alocacoes: Alocacao[]
  violacoes: Violacao[]
  tipoContrato: TipoContrato
  regra?: RegraHorarioColaborador
}

export interface MassaExportData {
  setores: { id: number; nome: string; status: string | null }[]
}

/** Setor toggle state — internal to ExportModal, exposed via ref or callback if needed */
export interface ExportToggles {
  ciclo: boolean
  semanal: boolean
  timeline: boolean
  avisos: boolean
}

// ─── Deprecated Exports (backward compat until callers migrate in Task 9) ────

/** @deprecated Use ExportModalProps with mode='setor' */

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ExportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void

  // New API: mode-based
  mode?: 'setor' | 'funcionario' | 'massa'
  escalaData?: EscalaExportData
  funcionarioData?: FuncionarioExportData
  massaData?: MassaExportData
  onExportMassa?: (setorIds: number[], incluirAvisos: boolean) => void

  // Shared callbacks — new API passes current toggle state; legacy callers can ignore params
  onExportHTML?: (toggles?: ExportToggles, timelineMode?: 'barras' | 'grid') => void
  onPrint?: (toggles?: ExportToggles, timelineMode?: 'barras' | 'grid') => void
  onCSV?: (toggles?: ExportToggles, timelineMode?: 'barras' | 'grid') => void
  loading?: boolean
  progress?: number

}

// ─── Main Component ──────────────────────────────────────────────────────────

export function ExportModal(props: ExportModalProps) {
  const {
    open,
    onOpenChange,
    onExportHTML,
    onPrint,
    onCSV,
    loading = false,
    progress = 0,
  } = props

  const mode = props.mode ?? 'setor'
  const { escalaData, funcionarioData, massaData, onExportMassa } = props
  // ── Mode A state (setor) ─────────────────────────────────────────────────
  const [toggles, setToggles] = useState<ExportToggles>({
    ciclo: true,
    semanal: true,
    timeline: true,
    avisos: true,
  })
  const [timelineMode, setTimelineMode] = useState<'barras' | 'grid'>('barras')

  // ── Mode B state (funcionario) ───────────────────────────────────────────
  const [mostrarAvisosFuncionario, setMostrarAvisosFuncionario] = useState(true)

  // ── Mode C state (massa) ─────────────────────────────────────────────────
  const [selectedSetores, setSelectedSetores] = useState<Set<number>>(() => {
    if (!massaData) return new Set()
    return new Set(
      massaData.setores
        .filter((s) => s.status === 'OFICIAL')
        .map((s) => s.id),
    )
  })
  const [incluirAvisosMassa, setIncluirAvisosMassa] = useState(true)

  // ── Derived ──────────────────────────────────────────────────────────────
  const hasAnyToggleOn = toggles.ciclo || toggles.semanal || toggles.timeline || toggles.avisos
  const selectedCount = selectedSetores.size

  // Massa: compute which setores are OFICIAL
  const oficialSetores = useMemo(() => {
    if (!massaData) return []
    return massaData.setores.filter((s) => s.status === 'OFICIAL')
  }, [massaData])

  const allOficialSelected = oficialSetores.length > 0 && oficialSetores.every((s) => selectedSetores.has(s.id))
  const someOficialSelected = oficialSetores.some((s) => selectedSetores.has(s.id))
  const selectAllState: 'checked' | 'unchecked' | 'indeterminate' =
    allOficialSelected ? 'checked' : someOficialSelected ? 'indeterminate' : 'unchecked'

  // ── Handlers ─────────────────────────────────────────────────────────────
  const toggleSection = (key: keyof ExportToggles, checked: boolean) => {
    setToggles((prev) => ({ ...prev, [key]: checked }))
  }

  const handleSelectAll = () => {
    if (selectAllState === 'checked' || selectAllState === 'indeterminate') {
      setSelectedSetores(new Set())
    } else {
      setSelectedSetores(new Set(oficialSetores.map((s) => s.id)))
    }
  }

  const handleToggleSetor = (id: number, checked: boolean) => {
    setSelectedSetores((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  }

  const handleExportMassa = () => {
    onExportMassa?.(Array.from(selectedSetores), incluirAvisosMassa)
  }

  // ── Modal title ──────────────────────────────────────────────────────────
  const titulo = mode === 'setor' && escalaData
      ? `Exportar Escala — ${escalaData.setor.nome}`
      : mode === 'funcionario' && funcionarioData
        ? `Exportar Escala — ${funcionarioData.colaborador.nome}`
        : 'Exportar em Massa'

  // ── Render: Mode C (massa) — narrow, no preview ─────────────────────────
  if (mode === 'massa') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{titulo}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Selecione os setores com escala oficial.
            </p>

            {/* Select all */}
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={selectAllState === 'indeterminate' ? 'indeterminate' : selectAllState === 'checked'}
                  onCheckedChange={handleSelectAll}
                />
                <Label className="text-sm font-medium cursor-pointer" onClick={handleSelectAll}>
                  Selecionar todos
                </Label>
              </div>
              <span className="text-xs text-muted-foreground">
                {selectedCount} de {oficialSetores.length}
              </span>
            </div>

            {/* Setor list */}
            <div className="space-y-1 max-h-[300px] overflow-y-auto">
              {massaData?.setores.map((setor) => {
                const isOficial = setor.status === 'OFICIAL'
                const isChecked = selectedSetores.has(setor.id)
                const statusLabel = setor.status === 'OFICIAL'
                  ? 'OFICIAL'
                  : setor.status === 'RASCUNHO'
                    ? 'RASCUNHO'
                    : 'sem escala'

                return (
                  <div
                    key={setor.id}
                    className={`flex items-center justify-between rounded-md px-3 py-2 ${
                      isOficial ? '' : 'opacity-30'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={(checked) => handleToggleSetor(setor.id, !!checked)}
                        disabled={!isOficial}
                      />
                      <span className={`text-sm ${isOficial ? '' : 'text-muted-foreground'}`}>
                        {setor.nome}
                      </span>
                    </div>
                    <span className={`text-xs ${
                      isOficial ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-muted-foreground'
                    }`}>
                      {statusLabel}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Incluir avisos toggle */}
            <div className="flex items-center justify-between border-t pt-3">
              <Label className="text-sm">Incluir avisos</Label>
              <Switch
                checked={incluirAvisosMassa}
                onCheckedChange={setIncluirAvisosMassa}
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <div className="flex flex-1 items-center">
              <span className="text-xs text-muted-foreground">
                {selectedCount} setor{selectedCount !== 1 ? 'es' : ''} selecionado{selectedCount !== 1 ? 's' : ''}
              </span>
            </div>
            {loading ? (
              <div className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {Math.round(progress)}%
                </span>
              </div>
            ) : (
              <>
                <Button variant="ghost" onClick={() => onOpenChange(false)}>
                  Cancelar
                </Button>
                <Button
                  onClick={handleExportMassa}
                  disabled={selectedCount === 0}
                >
                  Exportar {selectedCount} setor{selectedCount !== 1 ? 'es' : ''}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  // ── Render: Mode A (setor) and Mode B (funcionario) — split layout ──────
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 gap-6 overflow-hidden">
          {/* Left: Preview (~60%) */}
          <div className="flex-[3] min-w-0">
            <ExportPreview scale={0.55}>
              {mode === 'setor' && escalaData && (
                <ExportarEscala
                  escala={escalaData.escala}
                  alocacoes={escalaData.alocacoes}
                  colaboradores={escalaData.colaboradores}
                  setor={escalaData.setor}
                  violacoes={escalaData.violacoes}
                  avisos={escalaData.avisos}
                  tiposContrato={escalaData.tiposContrato}
                  funcoes={escalaData.funcoes}
                  horariosSemana={escalaData.horariosSemana}
                  regrasPadrao={escalaData.regrasPadrao}
                  mode="setor"
                  mostrarCiclo={toggles.ciclo}
                  mostrarSemanal={toggles.semanal}
                  mostrarTimeline={toggles.timeline}
                  timelineMode={timelineMode}
                  mostrarAvisos={toggles.avisos}
                />
              )}
              {mode === 'funcionario' && funcionarioData && (
                <ExportarEscala
                  escala={funcionarioData.escala}
                  alocacoes={funcionarioData.alocacoes}
                  colaboradores={[funcionarioData.colaborador]}
                  setor={funcionarioData.setor}
                  violacoes={funcionarioData.violacoes}
                  tipoContrato={funcionarioData.tipoContrato}
                  regrasPadrao={funcionarioData.regra ? [funcionarioData.regra] : []}
                  mode="funcionario"
                  colaboradorId={funcionarioData.colaborador.id}
                  mostrarAvisos={mostrarAvisosFuncionario}
                />
              )}
            </ExportPreview>
          </div>

          {/* Right: Options */}
          <div className={`space-y-5 overflow-y-auto ${mode === 'funcionario' ? 'flex-[1.5]' : 'flex-[2]'}`}>
            {mode === 'setor' ? (
              <SetorOptions
                toggles={toggles}
                onToggle={toggleSection}
                timelineMode={timelineMode}
                onTimelineModeChange={setTimelineMode}
              />
            ) : (
              <FuncionarioInfo
                funcionarioData={funcionarioData}
                mostrarAvisos={mostrarAvisosFuncionario}
                onMostrarAvisosChange={setMostrarAvisosFuncionario}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        {mode === 'setor' ? (
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancelar
            </Button>
            {onCSV && (
              <Button
                variant="outline"
                onClick={() => onCSV(toggles, timelineMode)}
                disabled={loading || !hasAnyToggleOn}
              >
                {loading ? (
                  <Loader2 className="mr-1 size-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="mr-1 size-4" />
                )}
                CSV
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => onExportHTML?.(toggles, timelineMode)}
              disabled={loading || !hasAnyToggleOn}
            >
              {loading ? (
                <Loader2 className="mr-1 size-4 animate-spin" />
              ) : (
                <Download className="mr-1 size-4" />
              )}
              Baixar HTML
            </Button>
            <Button
              onClick={() => onPrint?.(toggles, timelineMode)}
              disabled={loading || !hasAnyToggleOn}
            >
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
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancelar
            </Button>
            <Button
              variant="outline"
              onClick={() => onExportHTML?.(toggles, timelineMode)}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="mr-1 size-4 animate-spin" />
              ) : (
                <Download className="mr-1 size-4" />
              )}
              Baixar HTML
            </Button>
            <Button
              onClick={() => onPrint?.(toggles, timelineMode)}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="mr-1 size-4 animate-spin" />
              ) : (
                <Printer className="mr-1 size-4" />
              )}
              Imprimir
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Mode A: Setor Toggle List ───────────────────────────────────────────────

function SetorOptions({
  toggles,
  onToggle,
  timelineMode,
  onTimelineModeChange,
}: {
  toggles: ExportToggles
  onToggle: (key: keyof ExportToggles, checked: boolean) => void
  timelineMode: 'barras' | 'grid'
  onTimelineModeChange: (mode: 'barras' | 'grid') => void
}) {
  return (
    <div className="space-y-4">
      <Label className="text-sm font-medium">Conteudo da exportacao</Label>
      <div className="rounded-md border">
        {/* Ciclo Rotativo */}
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <div>
            <p className="text-sm font-medium">Ciclo Rotativo</p>
            <p className="text-xs text-muted-foreground">
              Mapa de trabalho/folga por semana.
            </p>
          </div>
          <Switch
            checked={toggles.ciclo}
            onCheckedChange={(checked) => onToggle('ciclo', checked)}
          />
        </div>

        {/* Escala Semanal */}
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <div>
            <p className="text-sm font-medium">Escala Semanal</p>
            <p className="text-xs text-muted-foreground">
              Tabela detalhada por semana com horarios.
            </p>
          </div>
          <Switch
            checked={toggles.semanal}
            onCheckedChange={(checked) => onToggle('semanal', checked)}
          />
        </div>

        {/* Timeline Diaria + dropdown */}
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <div className="flex-1">
            <p className="text-sm font-medium">Timeline Diaria</p>
            <p className="text-xs text-muted-foreground">
              Visao por faixa horaria e cobertura.
            </p>
            {toggles.timeline && (
              <div className="mt-2">
                <Select value={timelineMode} onValueChange={(v) => onTimelineModeChange(v as 'barras' | 'grid')}>
                  <SelectTrigger className="h-7 w-[120px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="barras">Barras</SelectItem>
                    <SelectItem value="grid">Grid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <Switch
            checked={toggles.timeline}
            onCheckedChange={(checked) => onToggle('timeline', checked)}
          />
        </div>

        {/* Avisos */}
        <div className="flex items-center justify-between px-3 py-2.5">
          <div>
            <p className="text-sm font-medium">Avisos</p>
            <p className="text-xs text-muted-foreground">
              Violacoes e alertas operacionais.
            </p>
          </div>
          <Switch
            checked={toggles.avisos}
            onCheckedChange={(checked) => onToggle('avisos', checked)}
          />
        </div>
      </div>

      {/* Hint when all off */}
      {!toggles.ciclo && !toggles.semanal && !toggles.timeline && !toggles.avisos && (
        <p className="text-xs text-muted-foreground italic">
          Selecione ao menos um conteudo para exportar.
        </p>
      )}
    </div>
  )
}

// ─── Mode B: Funcionario Info Panel ──────────────────────────────────────────

function FuncionarioInfo({
  funcionarioData,
  mostrarAvisos,
  onMostrarAvisosChange,
}: {
  funcionarioData?: FuncionarioExportData
  mostrarAvisos: boolean
  onMostrarAvisosChange: (checked: boolean) => void
}) {
  if (!funcionarioData) return null

  const { colaborador, setor, escala, tipoContrato } = funcionarioData
  const periodo = `${formatDate(escala.data_inicio)} a ${formatDate(escala.data_fim)}`

  return (
    <div className="space-y-4">
      <Label className="text-sm font-medium">Escala de</Label>
      <div className="space-y-3">
        <div>
          <p className="text-base font-semibold">{colaborador.nome}</p>
          <p className="text-sm text-muted-foreground">
            {setor.nome}
          </p>
        </div>

        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Contrato</span>
            <span>{tipoContrato.nome}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Periodo</span>
            <span>{periodo}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Status</span>
            <span className="font-medium text-emerald-600 dark:text-emerald-400">
              {escala.status}
            </span>
          </div>
        </div>
      </div>

      <div className="border-t pt-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Avisos pessoais</p>
            <p className="text-xs text-muted-foreground">
              Violacoes deste funcionario.
            </p>
          </div>
          <Switch
            checked={mostrarAvisos}
            onCheckedChange={onMostrarAvisosChange}
          />
        </div>
      </div>
    </div>
  )
}


// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
