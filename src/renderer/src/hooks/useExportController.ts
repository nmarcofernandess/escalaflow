import { useState } from 'react'
import { toast } from 'sonner'
import { captureExportHTML } from '@/lib/captureExportHTML'
import { exportarService } from '@/servicos/exportar'

interface UseExportControllerProps {
  context: 'escala' | 'hub'
}

export function useExportController({ context }: UseExportControllerProps) {
  const [formato, setFormato] = useState('completa')
  const [opcoes, setOpcoes] = useState({ avisos: true, horas: false })
  const [funcionarioId, setFuncionarioId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)

  async function handleExportHTML(filename?: string) {
    setLoading(true)
    try {
      const html = captureExportHTML()
      const result = await exportarService.salvarHTML(html, filename || 'escala.html')
      if (result) {
        toast.success('HTML salvo com sucesso')
      }
    } catch (err) {
      toast.error('Erro ao exportar HTML')
    } finally {
      setLoading(false)
    }
  }

  async function handlePrint(filename?: string) {
    setLoading(true)
    try {
      const html = captureExportHTML()
      const result = await exportarService.imprimirPDF(html, filename || 'escala.pdf')
      if (result) {
        toast.success('PDF salvo com sucesso')
      }
    } catch (err) {
      toast.error('Erro ao gerar PDF')
    } finally {
      setLoading(false)
    }
  }

  async function handleBatch(
    colaboradores: { id: number; nome: string }[],
    renderHTML: (colabId: number) => string,
  ) {
    setLoading(true)
    setProgress(0)
    try {
      const arquivos: { nome: string; html: string }[] = []
      for (let i = 0; i < colaboradores.length; i++) {
        const c = colaboradores[i]
        const html = renderHTML(c.id)
        arquivos.push({ nome: c.nome.replace(/\s+/g, '_'), html })
        setProgress(((i + 1) / colaboradores.length) * 100)
      }
      const result = await exportarService.batchHTML(arquivos)
      if (result) {
        toast.success(`${result.count} arquivos salvos em ${result.pasta}`)
      }
    } catch (err) {
      toast.error('Erro na exportacao em lote')
    } finally {
      setLoading(false)
      setProgress(0)
    }
  }

  async function handleCSV(csvContent: string, filename?: string) {
    setLoading(true)
    try {
      const result = await exportarService.salvarCSV(csvContent, filename || 'escalas.csv')
      if (result) {
        toast.success('CSV salvo com sucesso')
      }
    } catch (err) {
      toast.error('Erro ao exportar CSV')
    } finally {
      setLoading(false)
    }
  }

  return {
    formato,
    setFormato,
    opcoes,
    setOpcoes,
    funcionarioId,
    setFuncionarioId,
    loading,
    setLoading,
    progress,
    setProgress,
    handleExportHTML,
    handlePrint,
    handleBatch,
    handleCSV,
  }
}
