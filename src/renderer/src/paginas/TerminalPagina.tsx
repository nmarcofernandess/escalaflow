import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  RefreshCw,
  Settings,
  Shield,
  SquareTerminal,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/componentes/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { servicoTerminal } from '@/servicos/terminal'
import {
  AI_RUNTIME_READINESS_COPY,
  AI_TERMINAL_COPY,
  TERMINAL_IA_PERSONA_STORAGE_KEY,
  buildAiTerminalCommand,
  getTerminalIaAccess,
  type AiRuntimeReadinessCode,
  type AiTerminalReadiness,
} from '@shared/index'

const MATRIX_CODES = Object.keys(AI_RUNTIME_READINESS_COPY) as AiRuntimeReadinessCode[]

function formatDate(value?: string): string {
  if (!value) return 'Ainda nao verificado'
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(value))
}

function getCurrentAccess() {
  return getTerminalIaAccess(
    typeof window !== 'undefined' ? window.localStorage.getItem(TERMINAL_IA_PERSONA_STORAGE_KEY) : null,
  )
}

export function TerminalPagina() {
  const navigate = useNavigate()
  const [access] = useState(getCurrentAccess)
  const [readiness, setReadiness] = useState<AiTerminalReadiness | null>(null)
  const [loading, setLoading] = useState(access.enabled)
  const [opening, setOpening] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)

  const command = readiness?.command || buildAiTerminalCommand()
  const currentCopy = readiness
    ? AI_RUNTIME_READINESS_COPY[readiness.code]
    : AI_RUNTIME_READINESS_COPY.configMissing

  const resolvedModel = useMemo(() => {
    const provider = readiness?.runtime.provider || 'sem provider'
    const model = readiness?.runtime.model || 'sem modelo'
    return `${provider} / ${model}`
  }, [readiness])

  useEffect(() => {
    if (access.enabled) void refreshStatus()
  }, [access.enabled])

  async function refreshStatus() {
    setLoading(true)
    try {
      const status = await servicoTerminal.statusIa()
      setReadiness(status)
    } catch (err: any) {
      toast.error('Nao foi possivel verificar a IA', { description: err?.message })
    } finally {
      setLoading(false)
    }
  }

  async function copyCommand() {
    await navigator.clipboard.writeText(command)
    toast.success('Comando copiado.')
  }

  async function openAiTerminal() {
    setOpening(true)
    setConfigOpen(false)
    try {
      const result = await servicoTerminal.abrirIaNoTerminal()
      if (result.readiness) setReadiness(result.readiness)

      if (result.status === 'blocked' || !result.opened) {
        setConfigOpen(true)
        toast.error('IA ainda nao esta pronta', {
          description: result.error_message || result.readiness?.message,
        })
        return
      }

      toast.success('Terminal do sistema aberto.', {
        description: result.command,
      })
    } catch (err: any) {
      toast.error('Erro ao abrir Terminal do sistema', { description: err?.message })
    } finally {
      setOpening(false)
    }
  }

  if (!access.enabled) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader
          breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Terminal IA' }]}
        />
        <div className="p-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Shield className="size-4" />
                Recurso restrito
              </CardTitle>
              <CardDescription>
                O Terminal IA fica oculto para a persona RH final. Perfis admin, dev e suporte podem habilitar o recurso.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Terminal IA' }]}
      />

      <div className="flex flex-col gap-6 p-6">
        <Card>
          <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <CardTitle className="flex items-center gap-2 text-base">
                <SquareTerminal className="size-4" />
                {AI_TERMINAL_COPY.title}
              </CardTitle>
              <CardDescription>
                {AI_TERMINAL_COPY.description}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={refreshStatus} disabled={loading || opening}>
                <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
                Verificar
              </Button>
              <Button onClick={openAiTerminal} disabled={opening || loading}>
                <ExternalLink className="size-4" />
                {opening ? 'Abrindo...' : AI_TERMINAL_COPY.primaryAction}
              </Button>
            </div>
          </CardHeader>

          <CardContent className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-md border bg-muted/20 p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge variant={readiness?.ok ? 'default' : 'destructive'}>
                  {readiness?.code ?? 'verificando'}
                </Badge>
                <span className="text-sm font-medium text-foreground">
                  {currentCopy.label}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {readiness?.message ?? currentCopy.message}
              </p>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border bg-background p-3">
                  <div className="text-xs font-medium uppercase text-muted-foreground">Provider/modelo</div>
                  <div className="mt-1 break-words font-mono text-sm">{resolvedModel}</div>
                </div>
                <div className="rounded-md border bg-background p-3">
                  <div className="text-xs font-medium uppercase text-muted-foreground">Ultima verificacao</div>
                  <div className="mt-1 text-sm">{formatDate(readiness?.runtime.validatedAt ?? undefined)}</div>
                </div>
                <div className="rounded-md border bg-background p-3 sm:col-span-2">
                  <div className="text-xs font-medium uppercase text-muted-foreground">Diretorio</div>
                  <div className="mt-1 break-all font-mono text-sm">{readiness?.cwd ?? 'Aguardando verificacao'}</div>
                </div>
              </div>
            </div>

            <div className="rounded-md border bg-background p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-sm font-medium">Comando real</div>
                <Button variant="outline" size="sm" onClick={copyCommand}>
                  <Copy className="size-4" />
                  {AI_TERMINAL_COPY.copyCommandAction}
                </Button>
              </div>
              <pre className="min-h-24 overflow-auto rounded-md border bg-black p-3 font-mono text-xs leading-5 text-green-100">
                {command}
              </pre>
              <div className="mt-3 text-xs text-muted-foreground">
                Este comando usa a mesma configuracao de IA do chat lateral e do CLI.
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Matriz de readiness</CardTitle>
            <CardDescription>
              Cada estado abaixo bloqueia ou libera o launcher antes de abrir o Terminal do sistema.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {MATRIX_CODES.map((code) => {
                const item = AI_RUNTIME_READINESS_COPY[code]
                const active = readiness?.code === code
                return (
                  <div
                    key={code}
                    className={cn(
                      'flex min-h-20 gap-3 rounded-md border p-3',
                      active && 'border-primary bg-primary/5',
                    )}
                  >
                    {item.ok ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                    ) : (
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                    )}
                    <div className="min-w-0">
                      <div className="break-words font-mono text-xs font-semibold">{code}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{item.label}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>IA ainda nao esta pronta</DialogTitle>
            <DialogDescription>
              {readiness?.message ?? currentCopy.message}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md border bg-muted/20 p-3">
            <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">Comando</div>
            <pre className="overflow-auto rounded-md border bg-black p-3 font-mono text-xs text-green-100">
              {command}
            </pre>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={copyCommand}>
              <Copy className="size-4" />
              Copiar comando
            </Button>
            <Button onClick={() => navigate('/configuracoes')}>
              <Settings className="size-4" />
              Abrir Configuracoes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
