import { useState, useEffect, useMemo } from 'react'
import { Loader2, Download, Search, Filter, X, FileText, FileSpreadsheet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { toast } from 'sonner'
import { PageHeader } from '@/componentes/PageHeader'
import { EscalaViewToggle, useEscalaViewMode } from '@/componentes/EscalaViewToggle'
import { SetorEscalaSection, type EscalaResumo } from '@/componentes/SetorEscalaSection'
import { ExportModal, type SetorExportItem } from '@/componentes/ExportModal'
import { ExportarEscala } from '@/componentes/ExportarEscala'
import { useExportController } from '@/hooks/useExportController'
import { useSetorSelection } from '@/hooks/useSetorSelection'
import { BulkActionBar } from '@/componentes/BulkActionBar'
import { gerarHTMLFuncionario } from '@/lib/gerarHTMLFuncionario'
import { setoresService } from '@/servicos/setores'
import { escalasService } from '@/servicos/escalas'
import { colaboradoresService } from '@/servicos/colaboradores'
import { exportarService } from '@/servicos/exportar'
import { tiposContratoService } from '@/servicos/tipos-contrato'
import { gerarCSVAlocacoes, gerarCSVViolacoes, gerarCSVComparacaoDemanda, CSV_BOM } from '@/lib/gerarCSV'
import type { Setor, Colaborador, EscalaCompletaV3, TipoContrato } from '@shared/index'

interface SetorComEscala {
  setor: Setor
  escalaResumo: EscalaResumo | null
}

// Hook de debounce simples
function useDebouncedValue(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export function EscalasHub() {
  const [setoresComEscala, setSetoresComEscala] = useState<SetorComEscala[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useEscalaViewMode()
  const [exportOpen, setExportOpen] = useState(false)
  const exportCtrl = useExportController({ context: 'hub' })

  // --- Selection mode ---
  const {
    selectedSetores,
    selectionMode,
    selectedCount,
    toggleSelection,
    selectAll,
    clearSelection,
    isSelected,
    enterSelectionMode,
    exitSelectionMode,
    getCheckboxState,
  } = useSetorSelection()

  // --- Busca + Filtros state ---
  const [searchInput, setSearchInput] = useState('')
  const searchQuery = useDebouncedValue(searchInput, 300)
  const [filtroSetores, setFiltroSetores] = useState<Set<number>>(new Set())
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'OFICIAL' | 'RASCUNHO'>('todos')
  const [todosColabs, setTodosColabs] = useState<Colaborador[]>([])

  async function handleCSVExport(overrideSetorIds?: Set<number>) {
    // Use override (from bulk) or fall back to modal selection
    const targetIds = overrideSetorIds ?? new Set(exportSetores.filter((s) => s.checked && s.temEscala).map((s) => s.id))
    const comEscala = setoresComEscala.filter((s) => s.escalaResumo && targetIds.has(s.setor.id))
    if (comEscala.length === 0) return

    // Load escalas completas (reuse cached when available)
    const escalasCompletas: EscalaCompletaV3[] = []
    for (const s of comEscala) {
      const cached = exportEscalas.get(s.setor.id)
      if (cached) {
        escalasCompletas.push(cached)
      } else {
        escalasCompletas.push(await escalasService.buscar(s.escalaResumo!.id))
      }
    }

    const setores = comEscala.map((s) => s.setor)

    const csvAloc = gerarCSVAlocacoes(escalasCompletas, setores, todosColabs)
    const csvViol = gerarCSVViolacoes(escalasCompletas, setores)
    const csvDelta = gerarCSVComparacaoDemanda(escalasCompletas, setores)

    const combined = CSV_BOM + csvAloc + '\n\n' + csvViol + '\n\n' + csvDelta
    await exportCtrl.handleCSV(combined, 'escalas.csv')
  }

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [setores, colabs] = await Promise.all([
          setoresService.listar(true),
          colaboradoresService.listar({ ativo: true }),
        ])
        setTodosColabs(colabs)

        // For each setor, get the best escala (OFICIAL first, then RASCUNHO)
        const results = await Promise.all(
          setores.map(async (setor): Promise<SetorComEscala> => {
            try {
              // Try OFICIAL first
              let escalas = await escalasService.listarPorSetor(setor.id, { status: 'OFICIAL' })
              if (escalas.length === 0) {
                escalas = await escalasService.listarPorSetor(setor.id, { status: 'RASCUNHO' })
              }
              if (escalas.length > 0) {
                const e = escalas[0] // Most recent (ordered by data_inicio DESC)
                return {
                  setor,
                  escalaResumo: {
                    id: e.id,
                    data_inicio: e.data_inicio,
                    data_fim: e.data_fim,
                    status: e.status,
                    pontuacao: e.pontuacao,
                  },
                }
              }
            } catch {
              // Setor without escalas
            }
            return { setor, escalaResumo: null }
          }),
        )

        // Sort: setores with escala first, then by name
        results.sort((a, b) => {
          if (a.escalaResumo && !b.escalaResumo) return -1
          if (!a.escalaResumo && b.escalaResumo) return 1
          return a.setor.nome.localeCompare(b.setor.nome)
        })

        setSetoresComEscala(results)
        // Inicializar filtro com todos os setores selecionados
        setFiltroSetores(new Set(setores.map((s) => s.id)))
      } catch {
        // Silently fail
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // --- Filtrar setores ---
  const setoresFiltrados = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()
    return setoresComEscala.filter((s) => {
      // Filtro por setor selecionado
      if (filtroSetores.size > 0 && !filtroSetores.has(s.setor.id)) return false
      // Filtro por status
      if (filtroStatus !== 'todos') {
        if (!s.escalaResumo || s.escalaResumo.status !== filtroStatus) return false
      }
      // Filtro por busca no nome do colaborador
      if (q) {
        const colabs = todosColabs.filter((c) => c.setor_id === s.setor.id)
        return colabs.some((c) => c.nome.toLowerCase().includes(q))
      }
      return true
    })
  }, [setoresComEscala, filtroSetores, filtroStatus, searchQuery, todosColabs])

  // Contar filtros ativos (desconsiderando "todos selecionados" e "todos status")
  const filtrosAtivos = useMemo(() => {
    let count = 0
    if (filtroSetores.size > 0 && filtroSetores.size < setoresComEscala.length) count++
    if (filtroStatus !== 'todos') count++
    return count
  }, [filtroSetores, filtroStatus, setoresComEscala.length])

  // Matched colaboradores por setor (pra highlight)
  const matchedColabsPorSetor = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()
    if (!q) return new Map<number, { id: number; nome: string }[]>()
    const map = new Map<number, { id: number; nome: string }[]>()
    for (const s of setoresComEscala) {
      const matches = todosColabs
        .filter((c) => c.setor_id === s.setor.id && c.nome.toLowerCase().includes(q))
        .map((c) => ({ id: c.id, nome: c.nome }))
      if (matches.length > 0) map.set(s.setor.id, matches)
    }
    return map
  }, [searchQuery, setoresComEscala, todosColabs])

  function handleToggleSetorFiltro(setorId: number) {
    setFiltroSetores((prev) => {
      const next = new Set(prev)
      if (next.has(setorId)) {
        next.delete(setorId)
      } else {
        next.add(setorId)
      }
      return next
    })
  }

  function handleLimparFiltros() {
    setFiltroSetores(new Set(setoresComEscala.map((s) => s.setor.id)))
    setFiltroStatus('todos')
    setSearchInput('')
  }

  // --- Export state ---
  const [exportSetores, setExportSetores] = useState<SetorExportItem[]>([])
  const [exportColabs, setExportColabs] = useState<{ id: number; nome: string }[]>([])
  const [exportEscalas, setExportEscalas] = useState<Map<number, EscalaCompletaV3>>(new Map())
  const [tiposContrato, setTiposContrato] = useState<TipoContrato[]>([])

  // Abrir export modal com contexto inteligente
  async function handleOpenExport(overrideSetorIds?: Set<number>) {
    // Use bulk-selected setores or all filtrados
    const targetIds = overrideSetorIds ?? new Set(setoresFiltrados.filter((s) => s.escalaResumo).map((s) => s.setor.id))
    const comEscala = setoresComEscala.filter((s) => s.escalaResumo && targetIds.has(s.setor.id))
    if (comEscala.length === 0) return

    const setoresExp = comEscala.map((s) => ({
      id: s.setor.id,
      nome: s.setor.nome,
      checked: true,
      temEscala: !!s.escalaResumo,
    }))
    setExportSetores(setoresExp)

    // Carregar escalas completas + tipos contrato para export
    const [escalas, tcs] = await Promise.all([
      Promise.all(comEscala.map((s) => escalasService.buscar(s.escalaResumo!.id))),
      tiposContratoService.listar(),
    ])
    const escMap = new Map<number, EscalaCompletaV3>()
    for (let i = 0; i < comEscala.length; i++) {
      escMap.set(comEscala[i].setor.id, escalas[i])
    }
    setExportEscalas(escMap)
    setTiposContrato(tcs)

    // Se 1 setor, pre-carregar colaboradores dele
    if (comEscala.length === 1) {
      const colabs = todosColabs.filter((c) => c.setor_id === comEscala[0].setor.id)
      setExportColabs(colabs.map((c) => ({ id: c.id, nome: c.nome })))
      exportCtrl.setFormato('completa')
    } else {
      setExportColabs([])
      exportCtrl.setFormato('completa')
    }

    setExportOpen(true)
  }

  // Gerar HTML per-funcionario
  function renderFuncHTML(colabId: number, setorId: number): string {
    const ec = exportEscalas.get(setorId)
    const s = setoresComEscala.find((x) => x.setor.id === setorId)
    if (!ec || !s) return ''
    const colab = todosColabs.find((c) => c.id === colabId)
    if (!colab) return ''
    const tc = tiposContrato.find((t) => t.id === colab.tipo_contrato_id)
    return gerarHTMLFuncionario({
      nome: colab.nome,
      contrato: tc?.nome ?? '',
      horasSemanais: tc?.horas_semanais ?? colab.horas_semanais,
      setor: s.setor.nome,
      periodo: { inicio: ec.escala.data_inicio, fim: ec.escala.data_fim },
      alocacoes: ec.alocacoes.filter((a) => a.colaborador_id === colabId),
      violacoes: ec.violacoes.filter((v) => v.colaborador_id === colabId),
    })
  }

  // Export HTML handler (principal)
  async function handleHubExportHTML() {
    const checkedSetores = exportSetores.filter((s) => s.checked && s.temEscala)
    if (checkedSetores.length === 0) return

    if (exportCtrl.formato === 'funcionario' && exportCtrl.funcionarioId) {
      // Per-func: gera HTML mobile-first de 1 funcionario
      const setorId = checkedSetores[0].id
      const html = renderFuncHTML(exportCtrl.funcionarioId, setorId)
      const colab = todosColabs.find((c) => c.id === exportCtrl.funcionarioId)
      const fname = colab ? colab.nome.replace(/\s+/g, '_') : 'funcionario'
      const result = await exportarService.salvarHTML(html, `escala-${fname}.html`)
      if (result) toast.success('HTML salvo com sucesso')
    } else if (exportCtrl.formato === 'batch') {
      // Batch: todos funcionarios de 1 setor
      const setorId = checkedSetores[0].id
      const colabs = todosColabs.filter((c) => c.setor_id === setorId)
      await exportCtrl.handleBatch(
        colabs.map((c) => ({ id: c.id, nome: c.nome })),
        (colabId) => renderFuncHTML(colabId, setorId),
      )
    } else if (exportCtrl.formato === 'batch-geral') {
      // Batch geral: todos funcionarios de todos setores selecionados
      const allColabs: { id: number; nome: string }[] = []
      const colabSetorMap = new Map<number, number>()
      for (const s of checkedSetores) {
        const colabs = todosColabs.filter((c) => c.setor_id === s.id)
        for (const c of colabs) {
          allColabs.push({ id: c.id, nome: c.nome })
          colabSetorMap.set(c.id, s.id)
        }
      }
      await exportCtrl.handleBatch(allColabs, (colabId) =>
        renderFuncHTML(colabId, colabSetorMap.get(colabId) ?? 0),
      )
    } else {
      // Completa (RH) — captura preview HTML
      await exportCtrl.handleExportHTML('escalas.html')
    }
  }

  // Print handler
  async function handleHubPrint() {
    const checkedSetores = exportSetores.filter((s) => s.checked && s.temEscala)
    if (checkedSetores.length === 0) return

    if (exportCtrl.formato === 'funcionario' && exportCtrl.funcionarioId) {
      const setorId = checkedSetores[0].id
      const html = renderFuncHTML(exportCtrl.funcionarioId, setorId)
      const colab = todosColabs.find((c) => c.id === exportCtrl.funcionarioId)
      const fname = colab ? colab.nome.replace(/\s+/g, '_') : 'funcionario'
      const result = await exportarService.imprimirPDF(html, `escala-${fname}.pdf`)
      if (result) toast.success('PDF salvo com sucesso')
    } else {
      await exportCtrl.handlePrint('escalas.pdf')
    }
  }

  // Atalho da busca: exportar escala de 1 funcionario direto
  function handleExportFunc(colabId: number, setorId: number) {
    const s = setoresComEscala.find((x) => x.setor.id === setorId)
    if (!s?.escalaResumo) return

    exportCtrl.setFormato('funcionario')
    exportCtrl.setFuncionarioId(colabId)
    setExportSetores([{ id: s.setor.id, nome: s.setor.nome, checked: true, temEscala: true }])
    const colabs = todosColabs.filter((c) => c.setor_id === setorId)
    setExportColabs(colabs.map((c) => ({ id: c.id, nome: c.nome })))

    // Carregar escala completa + tiposContrato pra gerar HTML
    Promise.all([
      escalasService.buscar(s.escalaResumo.id),
      tiposContratoService.listar(),
    ]).then(([ec, tcs]) => {
      setExportEscalas(new Map([[setorId, ec as EscalaCompletaV3]]))
      setTiposContrato(tcs)
      setExportOpen(true)
    })
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          { label: 'Escalas' },
        ]}
      />

      <div className="flex-1 space-y-4 p-6">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Escalas</h1>
          <p className="text-sm text-muted-foreground">
            Visualize e exporte escalas de todos os setores
          </p>
        </div>

        {/* Busca + Filtros toolbar */}
        {!loading && setoresComEscala.length > 0 && (
          <div className="flex items-center gap-2">
            {/* Input de busca */}
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar colaborador..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-8 h-9"
              />
              {searchInput && (
                <button
                  onClick={() => setSearchInput('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            {/* Popover de filtros */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Filter className="size-4" />
                  Filtros
                  {filtrosAtivos > 0 && (
                    <Badge variant="secondary" className="ml-0.5 size-5 p-0 text-[10px] justify-center rounded-full">
                      {filtrosAtivos}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-64 space-y-4">
                {/* Filtro por setor */}
                <div className="space-y-2">
                  <p className="text-sm font-medium">Setores</p>
                  {setoresComEscala.map(({ setor, escalaResumo }) => (
                    <div key={setor.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`setor-${setor.id}`}
                        checked={filtroSetores.has(setor.id)}
                        onCheckedChange={() => handleToggleSetorFiltro(setor.id)}
                      />
                      <Label htmlFor={`setor-${setor.id}`} className="text-sm font-normal cursor-pointer flex-1">
                        {setor.nome}
                        {!escalaResumo && (
                          <span className="text-muted-foreground ml-1 text-xs">(sem escala)</span>
                        )}
                      </Label>
                    </div>
                  ))}
                </div>

                {/* Filtro por status */}
                <div className="space-y-2">
                  <p className="text-sm font-medium">Status</p>
                  <RadioGroup
                    value={filtroStatus}
                    onValueChange={(v) => setFiltroStatus(v as 'todos' | 'OFICIAL' | 'RASCUNHO')}
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="todos" id="st-todos" />
                      <Label htmlFor="st-todos" className="text-sm font-normal cursor-pointer">Todos</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="OFICIAL" id="st-oficial" />
                      <Label htmlFor="st-oficial" className="text-sm font-normal cursor-pointer">Oficial</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="RASCUNHO" id="st-rascunho" />
                      <Label htmlFor="st-rascunho" className="text-sm font-normal cursor-pointer">Rascunho</Label>
                    </div>
                  </RadioGroup>
                </div>

                {/* Limpar filtros */}
                {(filtrosAtivos > 0 || searchInput) && (
                  <Button variant="ghost" size="sm" className="w-full" onClick={handleLimparFiltros}>
                    Limpar filtros
                  </Button>
                )}
              </PopoverContent>
            </Popover>

            {/* Count de setores filtrados */}
            {(filtrosAtivos > 0 || searchQuery) && (
              <span className="text-xs text-muted-foreground">
                {setoresFiltrados.length} de {setoresComEscala.length} setores
              </span>
            )}

            {/* Spacer */}
            <div className="flex-1" />

            {/* View mode toggle */}
            <EscalaViewToggle mode={viewMode} onChange={setViewMode} />

            {/* Export / selection mode toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={selectionMode ? 'default' : 'outline'}
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    if (selectionMode) {
                      exitSelectionMode()
                    } else {
                      enterSelectionMode()
                    }
                  }}
                >
                  <Download className="size-4" />
                  Exportar
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {selectionMode ? 'Sair do modo exportacao' : 'Selecionar setores para exportar'}
              </TooltipContent>
            </Tooltip>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : setoresComEscala.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">Nenhum setor encontrado.</p>
          </div>
        ) : setoresFiltrados.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">
              {searchQuery
                ? `Nenhum colaborador encontrado para "${searchQuery}".`
                : 'Nenhum setor corresponde aos filtros.'}
            </p>
            <Button variant="link" size="sm" onClick={handleLimparFiltros} className="mt-2">
              Limpar filtros
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {setoresFiltrados.map(({ setor, escalaResumo }) => (
              <SetorEscalaSection
                key={setor.id}
                setor={setor}
                escalaResumo={escalaResumo}
                viewMode={viewMode}
                searchHighlight={searchQuery || undefined}
                matchedColabs={matchedColabsPorSetor.get(setor.id)}
                onExportFunc={handleExportFunc}
                selectionMode={selectionMode}
                isSelected={isSelected(setor.id)}
                onToggleSelection={() => toggleSelection(setor.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Bulk Action Bar */}
      {selectionMode && (
        <BulkActionBar
          selectedCount={selectedCount}
          totalCount={setoresFiltrados.filter((s) => s.escalaResumo).length}
          checkboxState={getCheckboxState(setoresFiltrados.filter((s) => s.escalaResumo).length)}
          onToggleAll={() => {
            const eligible = setoresFiltrados.filter((s) => s.escalaResumo).map((s) => s.setor.id)
            if (selectedCount >= eligible.length) {
              clearSelection()
            } else {
              selectAll(eligible)
            }
          }}
          onExportHTML={() => handleOpenExport(selectedSetores)}
          onExportCSV={() => handleCSVExport(selectedSetores)}
          onClose={exitSelectionMode}
        />
      )}

      {/* Export Modal */}
      <ExportModal
        open={exportOpen}
        onOpenChange={setExportOpen}
        context="hub"
        titulo="Exportar Escalas"
        formato={exportCtrl.formato}
        onFormatoChange={exportCtrl.setFormato}
        opcoes={exportCtrl.opcoes}
        onOpcoesChange={exportCtrl.setOpcoes}
        setoresExport={exportSetores}
        onSetoresExportChange={setExportSetores}
        colaboradores={exportColabs}
        funcionarioId={exportCtrl.funcionarioId}
        onFuncionarioChange={exportCtrl.setFuncionarioId}
        onExportHTML={handleHubExportHTML}
        onPrint={handleHubPrint}
        onCSV={handleCSVExport}
        loading={exportCtrl.loading}
        progress={exportCtrl.progress}
      >
        {/* Preview: renderizar ExportarEscala por setor selecionado */}
        {exportSetores
          .filter((s) => s.checked && s.temEscala)
          .map((s) => {
            const ec = exportEscalas.get(s.id)
            const setorObj = setoresComEscala.find((x) => x.setor.id === s.id)?.setor
            if (!ec || !setorObj) return null
            const colabs = todosColabs.filter((c) => c.setor_id === s.id)
            return (
              <ExportarEscala
                key={s.id}
                escala={ec.escala}
                alocacoes={ec.alocacoes}
                colaboradores={colabs}
                setor={setorObj}
                violacoes={ec.violacoes}
                tiposContrato={tiposContrato}
                opcoes={exportCtrl.opcoes}
              />
            )
          })}
      </ExportModal>
    </div>
  )
}
