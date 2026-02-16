import { useState, useEffect } from 'react'
import { Loader2, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/componentes/PageHeader'
import { EscalaViewToggle, useEscalaViewMode } from '@/componentes/EscalaViewToggle'
import { SetorEscalaSection, type EscalaResumo } from '@/componentes/SetorEscalaSection'
import { ExportModal } from '@/componentes/ExportModal'
import { useExportController } from '@/hooks/useExportController'
import { setoresService } from '@/servicos/setores'
import { escalasService } from '@/servicos/escalas'
import { colaboradoresService } from '@/servicos/colaboradores'
import { gerarCSVAlocacoes, gerarCSVViolacoes, CSV_BOM } from '@/lib/gerarCSV'
import type { Setor, Escala } from '@shared/index'

interface SetorComEscala {
  setor: Setor
  escalaResumo: EscalaResumo | null
}

export function EscalasHub() {
  const [setoresComEscala, setSetoresComEscala] = useState<SetorComEscala[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useEscalaViewMode()
  const [exportOpen, setExportOpen] = useState(false)
  const exportCtrl = useExportController({ context: 'hub' })

  async function handleCSVExport() {
    const comEscala = setoresComEscala.filter((s) => s.escalaResumo)
    if (comEscala.length === 0) return

    // Fetch all EscalaCompleta + all colaboradores
    const [escalasCompletas, todosColabs] = await Promise.all([
      Promise.all(comEscala.map((s) => escalasService.buscar(s.escalaResumo!.id))),
      colaboradoresService.listar({ ativo: true }),
    ])

    const setores = comEscala.map((s) => s.setor)

    // Generate CSV with both sheets concatenated
    const csvAloc = gerarCSVAlocacoes(escalasCompletas, setores, todosColabs)
    const csvViol = gerarCSVViolacoes(escalasCompletas, setores)

    // Combine: BOM + alocacoes, then blank line, then violacoes
    const combined = CSV_BOM + csvAloc + '\n\n' + csvViol
    await exportCtrl.handleCSV(combined, 'escalas.csv')
  }

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const setores = await setoresService.listar(true)

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
      } catch {
        // Silently fail
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          { label: 'Escalas' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExportOpen(true)}
              disabled={setoresComEscala.filter((s) => s.escalaResumo).length === 0}
            >
              <Download className="mr-1 size-4" />
              Exportar
            </Button>
            <EscalaViewToggle mode={viewMode} onChange={setViewMode} />
          </div>
        }
      />

      <div className="flex-1 space-y-4 p-6">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Escalas</h1>
          <p className="text-sm text-muted-foreground">
            Visualize e exporte escalas de todos os setores
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : setoresComEscala.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">Nenhum setor encontrado.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {setoresComEscala.map(({ setor, escalaResumo }) => (
              <SetorEscalaSection
                key={setor.id}
                setor={setor}
                escalaResumo={escalaResumo}
                viewMode={viewMode}
              />
            ))}
          </div>
        )}
      </div>

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
        onExportHTML={() => exportCtrl.handleExportHTML('escalas.html')}
        onPrint={() => exportCtrl.handlePrint('escalas.pdf')}
        onCSV={handleCSVExport}
        loading={exportCtrl.loading}
        progress={exportCtrl.progress}
      />
    </div>
  )
}
