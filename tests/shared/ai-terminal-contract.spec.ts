import { describe, expect, it } from 'vitest'
import {
  AI_RUNTIME_READINESS_COPY,
  AI_TERMINAL_COMMAND_ARGS,
  AI_TERMINAL_COPY,
  TERMINAL_IA_ENABLED_PERSONAS,
  TERMINAL_IA_PERSONA_STORAGE_KEY,
  buildAiTerminalCommand,
  getTerminalIaAccess,
  type AiRuntimeReadinessCode,
} from '../../src/shared'

const EXPECTED_CODES: AiRuntimeReadinessCode[] = [
  'configMissing',
  'credentialMissing',
  'credentialInvalid',
  'providerUnreachable',
  'rateLimited',
  'modelDownloadRequired',
  'modelDownloading',
  'modelDownloadCanceled',
  'modelLoadingFailed',
  'modelCorrupt',
  'cliMissing',
  'toolsUnavailable',
  'osUnsupported',
  'ready',
]

describe('AI terminal shared contract', () => {
  it('keeps the full readiness matrix explicit', () => {
    expect(Object.keys(AI_RUNTIME_READINESS_COPY).sort()).toEqual([...EXPECTED_CODES].sort())

    for (const code of EXPECTED_CODES) {
      expect(AI_RUNTIME_READINESS_COPY[code]).toMatchObject({
        code,
        label: expect.any(String),
        message: expect.any(String),
        action: expect.any(String),
        blocksLaunch: expect.any(Boolean),
      })
    }
  })

  it('builds the canonical CLI command and preserves paths with spaces', () => {
    expect(AI_TERMINAL_COMMAND_ARGS).toEqual(['chat', '--attach'])
    expect(buildAiTerminalCommand()).toBe('npm run cli -- chat --attach')
    expect(buildAiTerminalCommand({ projectCwd: "/tmp/Escala Flow's App" })).toBe(
      "npm --prefix '/tmp/Escala Flow'\\''s App' run cli -- chat --attach",
    )
    expect(AI_TERMINAL_COPY.primaryAction).toBe('Abrir IA no Terminal do Sistema')
    expect(AI_TERMINAL_COPY.copyCommandAction).toBe('Copiar comando')
  })

  it('hides Terminal IA for final HR and enables it only for operational personas', () => {
    expect(TERMINAL_IA_PERSONA_STORAGE_KEY).toBe('escalaflow.terminalIa.persona')
    expect(TERMINAL_IA_ENABLED_PERSONAS).toEqual(['admin', 'dev', 'support'])
    expect(getTerminalIaAccess()).toMatchObject({
      persona: 'rh_final',
      enabled: false,
    })
    expect(getTerminalIaAccess('rh_final')).toMatchObject({
      persona: 'rh_final',
      enabled: false,
    })
    expect(getTerminalIaAccess('admin')).toMatchObject({
      persona: 'admin',
      enabled: true,
    })
    expect(getTerminalIaAccess('dev')).toMatchObject({
      persona: 'dev',
      enabled: true,
    })
    expect(getTerminalIaAccess('support')).toMatchObject({
      persona: 'support',
      enabled: true,
    })
  })
})
