import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export interface AiTerminalWrapper {
  path: string
  command: string
  cwd: string
}

export interface AiTerminalWrapperContent {
  extension: '.cmd' | '.sh'
  content: string
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function windowsQuote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function normalizeEnv(env?: Record<string, string | undefined>): Array<[string, string]> {
  return Object.entries(env ?? {})
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .filter(([key]) => /^[A-Z0-9_]+$/.test(key))
}

export function buildAiTerminalWrapperContent(input: {
  cwd: string
  command: string
  title?: string
  platform?: NodeJS.Platform
  env?: Record<string, string | undefined>
}): AiTerminalWrapperContent {
  const platform = input.platform ?? process.platform
  const title = input.title || 'EscalaFlow IA no Terminal'
  const envLines = normalizeEnv(input.env)

  if (platform === 'win32') {
    return {
      extension: '.cmd',
      content: [
        '@echo off',
        `title ${title}`,
        `cd /d ${windowsQuote(input.cwd)}`,
        ...envLines.map(([key, value]) => `set "${key}=${value.replace(/"/g, '""')}"`),
        `echo ${title}`,
        `echo CWD: ${input.cwd}`,
        `echo Comando: ${input.command}`,
        'echo.',
        input.command,
        '',
      ].join('\r\n'),
    }
  }

  return {
    extension: '.sh',
    content: [
      '#!/usr/bin/env zsh',
      'set -e',
      `cd ${shellQuote(input.cwd)}`,
      ...envLines.map(([key, value]) => `export ${key}=${shellQuote(value)}`),
      `printf '%s\\n' ${shellQuote(title)}`,
      `printf 'CWD: %s\\n' "$PWD"`,
      `printf 'Comando: %s\\n\\n' ${shellQuote(input.command)}`,
      `exec ${input.command}`,
      '',
    ].join('\n'),
  }
}

export async function writeAiTerminalWrapper(input: {
  cwd: string
  command: string
  title?: string
  env?: Record<string, string | undefined>
}): Promise<AiTerminalWrapper> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'escalaflow-ai-terminal-'))
  const wrapper = buildAiTerminalWrapperContent(input)
  const scriptPath = path.join(dir, `open-escalaflow-ai-terminal${wrapper.extension}`)

  if (wrapper.extension === '.cmd') {
    await writeFile(scriptPath, wrapper.content, 'utf-8')
    return { path: scriptPath, command: input.command, cwd: input.cwd }
  }

  await writeFile(scriptPath, wrapper.content, 'utf-8')
  await chmod(scriptPath, 0o700)

  return { path: scriptPath, command: input.command, cwd: input.cwd }
}
