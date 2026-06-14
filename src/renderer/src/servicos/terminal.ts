import { client } from './client'
import type { AiTerminalReadiness, TerminalHarnessConfig, TerminalOpenCliResult, TerminalSessionInfo, TerminalSessionSnapshot } from '@shared/index'

export const servicoTerminal = {
  config: () =>
    client['terminal.config.get']() as Promise<TerminalHarnessConfig>,

  salvarConfig: (config: Partial<TerminalHarnessConfig>) =>
    client['terminal.config.save'](config) as Promise<TerminalHarnessConfig>,

  abrirCli: (input?: { command?: string; cwd?: string }) =>
    client['terminal.openCli'](input) as Promise<TerminalOpenCliResult>,

  statusIa: (input?: { cwd?: string }) =>
    client['terminal.aiStatus'](input) as Promise<AiTerminalReadiness>,

  abrirIaNoTerminal: (input?: { cwd?: string }) =>
    client['terminal.openAiTerminal'](input) as Promise<TerminalOpenCliResult>,

  listarSessoes: () =>
    client['terminal.sessions.list']() as Promise<{ sessions: TerminalSessionInfo[] }>,

  iniciarSessao: (input?: { cwd?: string }) =>
    client['terminal.sessions.start'](input) as Promise<{ session: TerminalSessionSnapshot }>,

  obterSessao: (id: string) =>
    client['terminal.sessions.get']({ id }) as Promise<{ session: TerminalSessionSnapshot | null }>,

  escreverSessao: (id: string, data: string) =>
    client['terminal.sessions.write']({ id, data }) as Promise<{ session: TerminalSessionSnapshot }>,

  redimensionarSessao: (id: string, cols: number, rows: number) =>
    client['terminal.sessions.resize']({ id, cols, rows }) as Promise<{ session: TerminalSessionSnapshot }>,

  matarSessao: (id: string) =>
    client['terminal.sessions.kill']({ id }) as Promise<{ session: TerminalSessionSnapshot }>,
}
