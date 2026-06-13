import os from 'node:os'
import { execute, queryOne } from '../db/query'
import type { TerminalHarnessConfig } from '../../shared/types'

export const TERMINAL_CONFIG_KEY = 'terminal.harness'

const DEFAULT_TERMINAL_CONFIG: TerminalHarnessConfig = {
  default_cwd: os.homedir(),
  max_timeout_ms: 30_000,
  max_output_chars: 20_000,
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.max(min, Math.min(Math.floor(numberValue), max))
}

function normalizeConfig(value: unknown): TerminalHarnessConfig {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    default_cwd: typeof raw.default_cwd === 'string' && raw.default_cwd.trim()
      ? raw.default_cwd.trim()
      : DEFAULT_TERMINAL_CONFIG.default_cwd,
    max_timeout_ms: clampInt(raw.max_timeout_ms, DEFAULT_TERMINAL_CONFIG.max_timeout_ms, 100, 120_000),
    max_output_chars: clampInt(raw.max_output_chars, DEFAULT_TERMINAL_CONFIG.max_output_chars, 1_000, 200_000),
  }
}

export async function getTerminalHarnessConfig(): Promise<TerminalHarnessConfig> {
  try {
    const row = await queryOne<{ value: unknown }>(
      'SELECT value FROM config WHERE key = $1',
      TERMINAL_CONFIG_KEY,
    )
    return normalizeConfig(row?.value)
  } catch {
    return DEFAULT_TERMINAL_CONFIG
  }
}

export async function saveTerminalHarnessConfig(
  patch: Partial<TerminalHarnessConfig>,
): Promise<TerminalHarnessConfig> {
  const current = await getTerminalHarnessConfig()
  const next = normalizeConfig({ ...current, ...patch })
  await execute(
    `INSERT INTO config (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb`,
    TERMINAL_CONFIG_KEY,
    JSON.stringify(next),
  )
  return next
}
