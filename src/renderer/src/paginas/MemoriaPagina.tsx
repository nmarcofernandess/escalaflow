import { useState } from 'react'
import {
  Brain,
  Database,
  FileText,
  Upload,
  Trash2,
  Loader2,
  BookOpen,
  User,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { PageHeader } from '@/componentes/PageHeader'
import { EmptyState } from '@/componentes/EmptyState'
import { useApiData } from '@/hooks/useApiData'
import { servicoConhecimento } from '@/servicos/conhecimento'
import { toast } from 'sonner'

type FonteComChunks = {
  id: number
  tipo: string
  titulo: string
  importance: string
  criada_em: string
  atualizada_em: string
  chunks_count: number
}

function formatarData(iso: string): string {
  try {
    const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z')
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch {
    return iso
  }
}

function badgeTipo(tipo: string, importance: string) {
  if (tipo === 'sistema') {
    return <Badge variant="secondary" className="text-xs">Sistema</Badge>
  }
  if (importance === 'LOW') {
    return <Badge variant="outline" className="text-xs">Auto</Badge>
  }
  return <Badge className="bg-green-600 text-xs hover:bg-green-700">Manual</Badge>
}

export function MemoriaPagina() {
  const { data, loading, reload } = useApiData(
    () => servicoConhecimento.stats(),
    [],
  )
  const [importando, setImportando] = useState(false)
  const [removendoId, setRemovendoId] = useState<number | null>(null)

  const handleImportar = async () => {
    setImportando(true)
    try {
      const caminho = await servicoConhecimento.escolherArquivo()
      if (!caminho) {
        setImportando(false)
        return
      }
      const result = await servicoConhecimento.importar(caminho)
      toast.success('Documento importado!', {
        description: `${result.chunks_count} chunks criados.`,
      })
      reload()
    } catch (err: any) {
      toast.error('Erro ao importar', { description: err?.message ?? 'Erro desconhecido' })
    } finally {
      setImportando(false)
    }
  }

  const handleRemover = async (id: number) => {
    setRemovendoId(id)
    try {
      await servicoConhecimento.removerFonte(id)
      toast.success('Documento removido.')
      reload()
    } catch (err: any) {
      toast.error('Erro ao remover', { description: err?.message ?? 'Erro desconhecido' })
    } finally {
      setRemovendoId(null)
    }
  }

  const fontes = data?.fontes ?? []
  const totais = data?.totais ?? { total_fontes: 0, total_chunks: 0, total_sistema: 0, total_usuario: 0 }
  const fontsSistema = fontes.filter((f) => f.tipo === 'sistema')
  const fontsUsuario = fontes.filter((f) => f.tipo !== 'sistema')

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Memoria' }]}
      />

      <div className="flex flex-col gap-6 p-6">
        {/* Visao Geral */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Brain className="size-4" />
                  Base de Conhecimento
                </CardTitle>
                <CardDescription>
                  Documentos que a IA usa como referencia para responder perguntas
                </CardDescription>
              </div>
              <Button
                size="sm"
                onClick={handleImportar}
                disabled={importando}
              >
                {importando ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <Upload className="mr-1.5 size-3.5" />
                )}
                Importar Documento
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-bold">{loading ? '...' : totais.total_fontes}</p>
                <p className="text-xs text-muted-foreground">Fontes</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-bold">{loading ? '...' : totais.total_chunks}</p>
                <p className="text-xs text-muted-foreground">Chunks</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-bold">{loading ? '...' : totais.total_sistema}</p>
                <p className="text-xs text-muted-foreground">Sistema</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-bold">{loading ? '...' : totais.total_usuario}</p>
                <p className="text-xs text-muted-foreground">Usuario</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Documentos do Sistema */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="size-4" />
              Documentos do Sistema
            </CardTitle>
            <CardDescription>
              CLT, CCT e regras do motor — protegidos, nao podem ser removidos
            </CardDescription>
          </CardHeader>
          <CardContent>
            {fontsSistema.length === 0 && !loading ? (
              <EmptyState
                icon={Database}
                title="Nenhum documento de sistema"
                description="A base de conhecimento sera populada na primeira inicializacao."
              />
            ) : (
              <div className="space-y-2">
                {fontsSistema.map((fonte) => (
                  <FonteItem key={fonte.id} fonte={fonte} protegido />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Documentos do Usuario */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="size-4" />
              Documentos do Usuario
            </CardTitle>
            <CardDescription>
              Documentos importados manualmente ou capturados automaticamente pelo chat
            </CardDescription>
          </CardHeader>
          <CardContent>
            {fontsUsuario.length === 0 && !loading ? (
              <EmptyState
                icon={FileText}
                title="Nenhum documento do usuario"
                description="Importe arquivos .md ou .txt para expandir a base de conhecimento da IA."
                action={
                  <Button size="sm" variant="outline" onClick={handleImportar} disabled={importando}>
                    <Upload className="mr-1.5 size-3.5" />
                    Importar
                  </Button>
                }
              />
            ) : (
              <div className="space-y-2">
                {fontsUsuario.map((fonte) => (
                  <FonteItem
                    key={fonte.id}
                    fonte={fonte}
                    onRemover={() => handleRemover(fonte.id)}
                    removendo={removendoId === fonte.id}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function FonteItem({
  fonte,
  protegido,
  onRemover,
  removendo,
}: {
  fonte: FonteComChunks
  protegido?: boolean
  onRemover?: () => void
  removendo?: boolean
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border px-4 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <FileText className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{fonte.titulo}</p>
          <p className="text-xs text-muted-foreground">
            {fonte.chunks_count} chunks · Atualizado em {formatarData(fonte.atualizada_em)}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {badgeTipo(fonte.tipo, fonte.importance)}
        {!protegido && onRemover && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-destructive"
                disabled={removendo}
              >
                {removendo ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remover documento?</AlertDialogTitle>
                <AlertDialogDescription>
                  O documento "{fonte.titulo}" e todos os seus chunks serao removidos permanentemente da base de conhecimento.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={onRemover}>
                  Remover
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  )
}
