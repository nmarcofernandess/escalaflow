import { useState } from 'react'
import { CalendarDays, Plus, Trash2, Lock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/componentes/PageHeader'
import { feriadosService } from '@/servicos/feriados'
import { useApiData } from '@/hooks/useApiData'
import { toast } from 'sonner'
import type { Feriado } from '@shared/index'

const ANO_ATUAL = new Date().getFullYear()

const TIPO_FERIADO_LABEL: Record<string, string> = {
  NACIONAL: 'Nacional',
  ESTADUAL: 'Estadual',
  MUNICIPAL: 'Municipal',
}

function formatarDataFeriado(data: string): string {
  const [, mes, dia] = data.split('-')
  return `${dia}/${mes}`
}

export function FeriadosPagina() {
  const anoAtual = ANO_ATUAL
  const { data: feriados, reload: reloadFeriados } = useApiData<Feriado[]>(
    () => feriadosService.listar(anoAtual),
    [anoAtual],
  )

  const [showFeriadoDialog, setShowFeriadoDialog] = useState(false)
  const [novoFeriadoData, setNovoFeriadoData] = useState('')
  const [novoFeriadoNome, setNovoFeriadoNome] = useState('')
  const [novoFeriadoTipo, setNovoFeriadoTipo] = useState('NACIONAL')
  const [novoFeriadoProibido, setNovoFeriadoProibido] = useState(false)
  const [criandoFeriado, setCriandoFeriado] = useState(false)

  const handleCriarFeriado = async () => {
    if (!novoFeriadoData || !novoFeriadoNome) return
    setCriandoFeriado(true)
    try {
      await feriadosService.criar({
        data: novoFeriadoData,
        nome: novoFeriadoNome.trim(),
        tipo: novoFeriadoTipo as 'NACIONAL' | 'ESTADUAL' | 'MUNICIPAL',
        proibido_trabalhar: novoFeriadoProibido,
        cct_autoriza: true,
      })
      toast.success('Feriado adicionado')
      setShowFeriadoDialog(false)
      setNovoFeriadoData('')
      setNovoFeriadoNome('')
      setNovoFeriadoTipo('NACIONAL')
      setNovoFeriadoProibido(false)
      reloadFeriados()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao criar feriado')
    } finally {
      setCriandoFeriado(false)
    }
  }

  const handleDeletarFeriado = async (id: number) => {
    try {
      await feriadosService.deletar(id)
      toast.success('Feriado removido')
      reloadFeriados()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao remover feriado')
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Feriados' }]}
        actions={
          <Button variant="outline" size="sm" onClick={() => setShowFeriadoDialog(true)}>
            <Plus className="mr-1 size-3.5" />
            Novo Feriado
          </Button>
        }
      />

      <div className="flex flex-col gap-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="size-4" />
              Feriados {anoAtual}
            </CardTitle>
            <CardDescription>
              O motor nao escala trabalho em feriados proibidos. Adicione municipais se necessario.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(feriados ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nenhum feriado cadastrado. Clique em &quot;Novo Feriado&quot; para adicionar.
              </p>
            ) : (
              <div className="space-y-1">
                {(feriados ?? []).sort((a, b) => a.data.localeCompare(b.data)).map((f) => {
                  const isLocked = f.proibido_trabalhar
                  return (
                    <div
                      key={f.id}
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm text-muted-foreground w-12 shrink-0">
                          {formatarDataFeriado(f.data)}
                        </span>
                        <span className="text-sm font-medium">{f.nome}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {TIPO_FERIADO_LABEL[f.tipo] ?? f.tipo}
                        </Badge>
                        {isLocked && (
                          <div className="flex items-center gap-1 text-destructive">
                            <Lock className="size-3" />
                            <span className="text-[10px]">CCT proibe</span>
                          </div>
                        )}
                      </div>
                      {!isLocked && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDeletarFeriado(f.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={showFeriadoDialog} onOpenChange={setShowFeriadoDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar Feriado</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Data</Label>
              <Input
                type="date"
                value={novoFeriadoData}
                onChange={(e) => setNovoFeriadoData(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input
                placeholder="Ex: Aniversario da cidade"
                value={novoFeriadoNome}
                onChange={(e) => setNovoFeriadoNome(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={novoFeriadoTipo} onValueChange={setNovoFeriadoTipo}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NACIONAL">Nacional</SelectItem>
                  <SelectItem value="ESTADUAL">Estadual</SelectItem>
                  <SelectItem value="MUNICIPAL">Municipal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3 rounded-lg border p-3">
              <Switch
                checked={novoFeriadoProibido}
                onCheckedChange={setNovoFeriadoProibido}
              />
              <div>
                <p className="text-sm font-medium">Proibido trabalhar</p>
                <p className="text-xs text-muted-foreground">
                  CCT proibe escala neste dia (ex: Natal, Ano Novo)
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFeriadoDialog(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleCriarFeriado}
              disabled={criandoFeriado || !novoFeriadoData || !novoFeriadoNome}
            >
              {criandoFeriado ? 'Adicionando...' : 'Adicionar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
