import { useState, useEffect } from 'react'
import {
  ChevronRight,
  ChevronLeft,
  CheckCircle,
  Eye,
  EyeOff,
  Sparkles,
  Loader2,
  BookOpen,
  MessageSquare,
  Share2,
  Download,
  WifiOff,
  FileText,
  PlayCircle,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { APP_NAME, APP_DESCRIPTION, APP_ICON } from '@/lib/app-info'
import { AdicionarConhecimentoDialog } from '@/componentes/AdicionarConhecimentoDialog'

const ipc = window.electron.ipcRenderer
const GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash'
const OPENROUTER_DEFAULT_MODEL = 'openai/gpt-oss-20b:free'
const TOTAL_STEPS = 4

type Provider = 'gemini' | 'openrouter'

/** Modelo local como o handler `ia.local.models` devolve (subset usado aqui). */
interface LocalModelInfo {
  id: string
  label: string
  size_bytes: number
  baixado?: boolean
  usable?: boolean
  requires_validation?: boolean
  load_error?: string
  download_status?: 'idle' | 'downloading' | 'cancelled' | 'failed' | 'done'
  download_progresso?: number
  download_bytes_total?: number
  download_bytes_feitos?: number
  download_error?: string
}

interface SetupWizardProps {
  onComplete: () => void
  /** Costura para o Chunk 2 (Tour). Se presente, o passo final oferece "Ver como funciona". */
  onStartTour?: () => void
}

/** Tamanho legível local — o helper de Configurações vive dentro daquela página, não exportado. */
function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 MB'
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  return `${Math.max(1, Math.round(bytes / 1_000_000))} MB`
}

export default function SetupWizard({ onComplete, onStartTour }: SetupWizardProps) {
  const [step, setStep] = useState(1)
  const [provider, setProvider] = useState<Provider>('gemini')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [geminiCloudEnabled, setGeminiCloudEnabled] = useState(false)
  // Só oferece IA local quando o binário llama-server do bundle existe neste host.
  const [localBinaryAvailable, setLocalBinaryAvailable] = useState(false)
  // Capacidade agregada: habilita metadados por IA no passo de Arquivos.
  const [iaDisponivel, setIaDisponivel] = useState(false)
  // Catálogo local (data-driven): vem de `ia.local.models`, refeito a cada
  // `ia:local:status-changed`. É a fonte da verdade de baixado/baixando/pronto.
  const [localModels, setLocalModels] = useState<LocalModelInfo[]>([])
  const [localBusy, setLocalBusy] = useState<string | null>(null)
  const [filesDialogOpen, setFilesDialogOpen] = useState(false)

  // Capabilities + provider default
  useEffect(() => {
    ipc
      .invoke('ia.capabilities.obter')
      .then((caps: {
        gemini_cloud_api_enabled?: boolean
        local_server_binary_available?: boolean
        has_any_available_provider?: boolean
      }) => {
        const on = caps.gemini_cloud_api_enabled === true
        setGeminiCloudEnabled(on)
        if (!on) setProvider('openrouter')
        setLocalBinaryAvailable(caps.local_server_binary_available === true)
        setIaDisponivel(caps.has_any_available_provider === true)
      })
      .catch(() => {
        setGeminiCloudEnabled(false)
        setLocalBinaryAvailable(false)
        setIaDisponivel(false)
      })
  }, [])

  // Catálogo local + assinatura de status. Mesmo padrão de ConfiguraçõesPagina:
  // `ia.local.models` no mount, refetch em `ia:local:status-changed`. Esse evento
  // (não o `ia:local:download-progress`) carrega baixado/usable/download_status,
  // que são o que distingue não-baixado → baixando → pronto.
  const reloadLocalModels = () => {
    ipc
      .invoke('ia.local.models')
      .then((models: LocalModelInfo[]) => setLocalModels(Array.isArray(models) ? models : []))
      .catch(() => setLocalModels([]))
  }

  const refreshCapabilities = () => {
    ipc
      .invoke('ia.capabilities.obter')
      .then((caps: { has_any_available_provider?: boolean }) =>
        setIaDisponivel(caps.has_any_available_provider === true),
      )
      .catch(() => {})
  }

  useEffect(() => {
    reloadLocalModels()
    const dispose = ipc.on('ia:local:status-changed', () => {
      reloadLocalModels()
      refreshCapabilities()
    })
    return dispose
  }, [])

  const markComplete = async () => {
    await ipc.invoke('config.set', {
      key: 'onboarding_complete',
      value: '"true"',
    })
  }

  const handleSkip = async () => {
    await markComplete()
    onComplete()
  }

  const handleSaveProvider = async () => {
    setSaving(true)
    try {
      const providerConfigs: Record<string, { token?: string; modelo?: string }> = {}
      const keyToSave = apiKey.trim() || ''
      const modelo = provider === 'gemini' ? GEMINI_DEFAULT_MODEL : OPENROUTER_DEFAULT_MODEL
      providerConfigs[provider] = { token: keyToSave, modelo }

      await ipc.invoke('ia.configuracao.salvar', {
        provider,
        api_key: keyToSave,
        modelo,
        provider_configs_json: JSON.stringify(providerConfigs),
      })
      window.dispatchEvent(new CustomEvent('ia-config-changed'))
      refreshCapabilities()
    } catch {
      // Non-blocking — Configurações pode corrigir depois.
    }
    setSaving(false)
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const keyToTest = apiKey.trim() || ''
      const modelo = provider === 'gemini' ? GEMINI_DEFAULT_MODEL : OPENROUTER_DEFAULT_MODEL
      const providerConfigs: Record<string, { token?: string; modelo?: string }> = {
        [provider]: { token: keyToTest, modelo },
      }
      const res = await ipc.invoke('ia.configuracao.testar', {
        provider,
        api_key: keyToTest,
        modelo,
        provider_configs_json: JSON.stringify(providerConfigs),
      })
      setTestResult({ ok: true, msg: (res as any)?.mensagem || 'Conectado!' })
    } catch (err: any) {
      setTestResult({ ok: false, msg: err?.message || 'Falha na conexao.' })
    } finally {
      setTesting(false)
    }
  }

  // Dispara o download (o clique É o consentimento — nunca auto-baixa). O
  // handler `ia.local.download` auto-valida ao concluir; o estado "Pronto"
  // chega via `ia:local:status-changed` → reloadLocalModels. Não revalidamos
  // aqui para não duplicar o que o main já faz.
  const handleDownloadLocal = async (modelId: string) => {
    setLocalBusy(modelId)
    reloadLocalModels()
    try {
      await ipc.invoke('ia.local.download', { model_id: modelId })
    } catch {
      // status-changed já reflete o erro no card (load_error/download_error).
    } finally {
      setLocalBusy(null)
      reloadLocalModels()
      refreshCapabilities()
    }
  }

  const handleFinish = async () => {
    if (apiKey.trim()) {
      await handleSaveProvider()
    }
    await markComplete()
    onComplete()
  }

  // ---- Step renderers ----

  const renderStep1 = () => (
    <div className="flex flex-col items-center gap-4 py-4 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
        <APP_ICON className="size-8" />
      </div>
      <div>
        <DialogTitle className="text-2xl font-bold">{APP_NAME}</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          {APP_DESCRIPTION}
        </DialogDescription>
      </div>
      <p className="max-w-sm text-sm text-muted-foreground">
        Vamos configurar o basico. Leva menos de um minuto.
      </p>
    </div>
  )

  const renderStep2 = () => (
    <div className="flex flex-col gap-5 py-2">
      <DialogHeader>
        <DialogTitle className="text-lg">Como voce quer rodar a IA?</DialogTitle>
        <DialogDescription>
          Escolha onde a inteligencia artificial vai rodar. Da pra trocar depois em Configuracoes.
        </DialogDescription>
      </DialogHeader>

      {/* LOCAL — em destaque, primeiro. Só com binário do bundle disponível. */}
      {localBinaryAvailable && (
        <div data-testid="wizard-local-section" className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <WifiOff className="size-4 text-muted-foreground" />
            <p className="text-sm font-medium">Local (offline)</p>
          </div>
          <div className="flex flex-col gap-2">
            {localModels.map((model) => (
              <LocalModelCard
                key={model.id}
                model={model}
                busy={localBusy === model.id}
                onDownload={() => handleDownloadLocal(model.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* NUVEM — 2ª via, abaixo. */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-muted-foreground" />
          <p className="text-sm font-medium">Nuvem (precisa de chave)</p>
        </div>

        <div className={cn('grid gap-3', geminiCloudEnabled ? 'grid-cols-2' : 'grid-cols-1')}>
          {geminiCloudEnabled && (
            <ProviderCard
              testid="wizard-cloud-gemini"
              selected={provider === 'gemini'}
              onSelect={() => {
                setProvider('gemini')
                setApiKey('')
                setTestResult(null)
              }}
              label="Google Gemini"
              description="Rapido e gratuito"
              icon={<Sparkles className="size-5" />}
            />
          )}
          <ProviderCard
            testid="wizard-cloud-openrouter"
            selected={provider === 'openrouter'}
            onSelect={() => {
              setProvider('openrouter')
              setApiKey('')
              setTestResult(null)
            }}
            label="OpenRouter"
            description="Multi-modelo"
            icon={<Share2 className="size-5" />}
          />
        </div>

        {/* API Key input */}
        <div className="flex flex-col gap-2">
          <label htmlFor="wizard-api-key" className="text-sm font-medium">
            API Key
          </label>
          <div className="relative">
            <Input
              id="wizard-api-key"
              type={showKey ? 'text' : 'password'}
              placeholder={provider === 'gemini' ? 'AIza...' : 'sk-or-...'}
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value)
                setTestResult(null)
              }}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
            >
              {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        {/* Test button + result */}
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={testing || !apiKey.trim()}
          >
            {testing ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 size-3.5" />
            )}
            Testar conexao
          </Button>
          {testResult && (
            <span
              className={cn(
                'text-sm',
                testResult.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500',
              )}
            >
              {testResult.msg}
            </span>
          )}
        </div>
      </div>
    </div>
  )

  const renderStep3 = () => (
    <div className="flex flex-col gap-5 py-2">
      <DialogHeader>
        <DialogTitle className="text-lg">Quer adicionar documentos agora?</DialogTitle>
        <DialogDescription>
          Opcional. Importe textos, PDFs ou exportacoes de chat para a IA consultar. Da pra fazer depois em Memoria.
        </DialogDescription>
      </DialogHeader>

      <button
        type="button"
        data-testid="wizard-open-files"
        onClick={() => setFilesDialogOpen(true)}
        className="flex items-center gap-3 rounded-lg border border-dashed border-muted-foreground/40 px-4 py-6 text-left transition-colors hover:border-muted-foreground/60 hover:bg-accent/50"
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <FileText className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Adicionar documentos</p>
          <p className="text-xs text-muted-foreground">.md, .txt, .pdf, .json (ChatGPT/Claude), .zip ou colar texto</p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>
    </div>
  )

  const renderStep4 = () => (
    <div className="flex flex-col items-center gap-5 py-4 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-green-500/10">
        <CheckCircle className="size-8 text-green-500" />
      </div>
      <div>
        <DialogTitle className="text-xl font-bold">Tudo pronto!</DialogTitle>
        <DialogDescription className="mt-1">Aqui vao algumas ideias pra comecar:</DialogDescription>
      </div>
      <div className="flex w-full flex-col gap-2 text-left">
        <NextStepItem icon={<BookOpen className="size-4 text-blue-400" />} text="Importe documentos em Memoria" />
        <NextStepItem icon={<MessageSquare className="size-4 text-purple-400" />} text="Converse com a IA em Assistente IA" />
        <NextStepItem icon={<Share2 className="size-4 text-amber-400" />} text="Explore conexoes no Grafo" />
      </div>
    </div>
  )

  // ---- Footer buttons per step ----

  const renderFooter = () => {
    if (step === 1) {
      return (
        <DialogFooter className="flex-row justify-between sm:justify-between">
          <Button variant="ghost" size="sm" onClick={handleSkip}>
            Pular setup
          </Button>
          <Button onClick={() => setStep(2)}>
            Comecar
            <ChevronRight className="ml-1 size-4" />
          </Button>
        </DialogFooter>
      )
    }

    if (step === 2 || step === 3) {
      return (
        <DialogFooter className="flex-row justify-between sm:justify-between">
          <Button variant="ghost" size="sm" onClick={() => setStep(step - 1)}>
            <ChevronLeft className="mr-1 size-4" />
            Voltar
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={handleSkip}>
              Pular
            </Button>
            <Button onClick={() => setStep(step + 1)}>
              Proximo
              <ChevronRight className="ml-1 size-4" />
            </Button>
          </div>
        </DialogFooter>
      )
    }

    return (
      <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
        <Button onClick={handleFinish} disabled={saving} className="w-full">
          {saving ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Sparkles className="mr-1.5 size-4" />}
          Comecar a usar
        </Button>
        {onStartTour && (
          <Button
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={async () => {
              // Conclui o setup ANTES de iniciar o tour: grava
              // onboarding_complete (senão o wizard reaparece no próximo boot) e
              // fecha o modal (senão o tour abriria atrás do dialog Radix, com a
              // sidebar inerte). O onStartTour fica só com "iniciar o tour".
              await handleFinish()
              onStartTour()
            }}
            className="w-full"
          >
            <PlayCircle className="mr-1.5 size-4" />
            Ver como funciona
          </Button>
        )}
      </DialogFooter>
    )
  }

  return (
    <>
      <Dialog open onOpenChange={() => handleSkip()}>
        <DialogContent className="max-w-md gap-0 [&>button:last-child]:hidden">
          {/* Step indicator */}
          <div className="mb-4 flex items-center justify-center gap-1.5">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((s) => (
              <div
                key={s}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  s === step ? 'w-6 bg-primary' : 'w-1.5 bg-muted-foreground/30',
                )}
              />
            ))}
          </div>

          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 3 && renderStep3()}
          {step === 4 && renderStep4()}

          {renderFooter()}
        </DialogContent>
      </Dialog>

      {/* Passo de Arquivos: reuso direto do dialog de import. Dialog próprio, com
          onOpenChange próprio — fechar aqui NÃO dispara o skip do wizard externo. */}
      <AdicionarConhecimentoDialog
        open={filesDialogOpen}
        onOpenChange={setFilesDialogOpen}
        onSaved={() => setFilesDialogOpen(false)}
        iaDisponivel={iaDisponivel}
      />
    </>
  )
}

// ---- Sub-components ----

function LocalModelCard({
  model,
  busy,
  onDownload,
}: {
  model: LocalModelInfo
  busy: boolean
  onDownload: () => void
}) {
  const isDownloading = model.download_status === 'downloading'
  const progress = Math.max(
    0,
    Math.min(
      1,
      model.download_progresso ??
        (model.download_bytes_total ? (model.download_bytes_feitos ?? 0) / model.download_bytes_total : 0),
    ),
  )

  // Verde-honesto: "Pronto" só com usable=true. load_error nunca vira Pronto.
  const badge = isDownloading
    ? { label: `Baixando ${Math.round(progress * 100)}%`, variant: 'outline' as const }
    : model.usable
      ? { label: 'Pronto', variant: 'default' as const }
      : model.load_error
        ? { label: 'Falhou', variant: 'destructive' as const }
        : model.baixado
          ? { label: 'Validando…', variant: 'outline' as const }
          : null

  return (
    <div
      data-testid={`wizard-local-model-${model.id}`}
      className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium">{model.label}</p>
            {badge && (
              <Badge variant={badge.variant} className="text-xs">
                {badge.label}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatBytes(model.size_bytes)} · Roda offline, sem chave, privada.
          </p>
          {model.load_error && (
            <p className="mt-1 text-xs text-destructive">Falhou ao carregar: {model.load_error}</p>
          )}
        </div>

        <div className="shrink-0">
          {isDownloading ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : model.usable ? (
            <CheckCircle className="size-5 text-green-500" />
          ) : model.baixado ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : (
            <Button type="button" variant="default" size="sm" disabled={busy} onClick={onDownload}>
              {busy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Download className="mr-1.5 size-3.5" />}
              Baixar
            </Button>
          )}
        </div>
      </div>

      {isDownloading && (
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
    </div>
  )
}

function ProviderCard({
  selected,
  onSelect,
  label,
  description,
  icon,
  testid,
}: {
  selected: boolean
  onSelect: () => void
  label: string
  description: string
  icon: React.ReactNode
  testid?: string
}) {
  return (
    <Card
      role="button"
      tabIndex={0}
      data-testid={testid}
      onClick={onSelect}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
      className={cn(
        'cursor-pointer transition-colors',
        selected ? 'border-primary bg-primary/5 ring-1 ring-primary/50' : 'hover:border-muted-foreground/40',
      )}
    >
      <CardContent className="flex flex-col items-center gap-2 p-4 text-center">
        <div
          className={cn(
            'flex size-10 items-center justify-center rounded-lg',
            selected ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
          )}
        >
          {icon}
        </div>
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function NextStepItem({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
      {icon}
      <span className="text-sm">{text}</span>
    </div>
  )
}
