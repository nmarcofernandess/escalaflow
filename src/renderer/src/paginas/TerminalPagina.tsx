import { useEffect, useRef, useState } from 'react'
import { Play, Square, SquareTerminal, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/componentes/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { servicoTerminal } from '@/servicos/terminal'
import { looksLikeChatMessage } from '@/lib/shell-input'
import type { TerminalSessionSnapshot } from '@shared/types'

export function TerminalPagina() {
  const [session, setSession] = useState<TerminalSessionSnapshot | null>(null)
  const [command, setCommand] = useState('')
  const [busy, setBusy] = useState(false)
  const outputRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (!session?.id || session.status !== 'running') return
    const timer = window.setInterval(async () => {
      try {
        const current = await servicoTerminal.obterSessao(session.id)
        if (current.session) setSession(current.session)
      } catch {
        // Polling must not spam the UI.
      }
    }, 500)
    return () => window.clearInterval(timer)
  }, [session?.id, session?.status])

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [session?.output])

  async function startSession() {
    setBusy(true)
    try {
      const result = await servicoTerminal.iniciarSessao()
      setSession(result.session)
    } catch (err: any) {
      toast.error('Erro ao iniciar terminal', { description: err?.message })
    } finally {
      setBusy(false)
    }
  }

  async function sendCommand() {
    const value = command.trim()
    if (!session || !value) return
    if (looksLikeChatMessage(value)) {
      toast.info('Isso parece mensagem para IA, não comando shell.', {
        description: 'Use Abrir chat IA para conversar pelo Terminal.',
      })
      return
    }
    setCommand('')
    try {
      await servicoTerminal.escreverSessao(session.id, `${value}\n`)
      const current = await servicoTerminal.obterSessao(session.id)
      if (current.session) setSession(current.session)
    } catch (err: any) {
      toast.error('Erro ao enviar comando', { description: err?.message })
    }
  }

  async function killSession() {
    if (!session) return
    try {
      const result = await servicoTerminal.matarSessao(session.id)
      setSession(result.session)
    } catch (err: any) {
      toast.error('Erro ao encerrar terminal', { description: err?.message })
    }
  }

  async function openCli() {
    try {
      await servicoTerminal.abrirCli({ command: 'npm run cli -- chat --attach' })
      toast.success('Chat CLI aberto no Terminal.')
    } catch (err: any) {
      toast.error('Erro ao abrir CLI', { description: err?.message })
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Terminal' }]}
      />

      <div className="flex flex-col gap-6 p-6">
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <SquareTerminal className="size-4" />
                Shell local
              </CardTitle>
              <CardDescription>
                Comandos do macOS. Para conversar, use o chat IA no Terminal.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={session?.status === 'running' ? 'default' : 'outline'}>
                {session?.status ?? 'sem sessão'}
              </Badge>
              <Button size="sm" variant="outline" onClick={openCli}>
                <ExternalLink />
                Abrir chat IA
              </Button>
              {session?.status === 'running' ? (
                <Button size="sm" variant="outline" onClick={killSession}>
                  <Square />
                  Encerrar
                </Button>
              ) : (
                <Button size="sm" onClick={startSession} disabled={busy}>
                  <Play />
                  Iniciar
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <pre
              ref={outputRef}
              className="h-[420px] overflow-auto rounded-md border bg-black p-4 font-mono text-xs leading-5 text-green-100"
            >
              {session?.output || 'Nenhuma sessão ativa.'}
            </pre>
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Esta caixa executa comandos como <span className="font-mono">pwd</span>, <span className="font-mono">ls</span> e <span className="font-mono">npm test</span>. Mensagens para IA devem ir pelo botão <span className="font-medium text-foreground">Abrir chat IA</span>.
            </div>
            <div className="flex gap-2">
              <Input
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void sendCommand()
                  }
                }}
                disabled={session?.status !== 'running'}
                placeholder="Comando shell: pwd, ls, npm test"
              />
              <Button onClick={sendCommand} disabled={session?.status !== 'running' || !command.trim()}>
                <Play />
                Enviar
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
