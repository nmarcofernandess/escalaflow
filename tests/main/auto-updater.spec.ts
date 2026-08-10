import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { setupAutoUpdater, type UpdaterLike } from '../../src/main/auto-updater'

class FakeUpdater implements UpdaterLike {
  autoDownload = false
  autoInstallOnAppQuit = false
  checkForUpdates = vi.fn(async () => undefined)
  quitAndInstall = vi.fn()
  listeners = new Map<string, (...args: unknown[]) => void>()

  on(event: string, listener: (...args: unknown[]) => void): this {
    this.listeners.set(event, listener)
    return this
  }

  emit(event: string, value?: unknown): void {
    this.listeners.get(event)?.(value)
  }
}

function harness(isDevelopment = false) {
  const updater = new FakeUpdater()
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const send = vi.fn()
  const schedule = vi.fn()
  const ipcMain = {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    },
  }
  const window = { webContents: { send } } as unknown as BrowserWindow

  setupAutoUpdater({
    ipcMain,
    getMainWindow: () => window,
    isDevelopment,
    updater,
    schedule,
  })

  return { handlers, schedule, send, updater }
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

describe('setupAutoUpdater', () => {
  it('does not materialize electron-updater in development when no updater is injected', async () => {
    vi.resetModules()

    let materialized = 0

    vi.doMock('electron-updater', () => ({
      default: {
        get autoUpdater() {
          materialized += 1

          return {
            autoDownload: false,
            autoInstallOnAppQuit: false,
            checkForUpdates: vi.fn(async () => undefined),
            quitAndInstall: vi.fn(),
            on: vi.fn(),
          }
        },
      },
    }))

    const { setupAutoUpdater: setupWithoutInjectedUpdater } = await import('../../src/main/auto-updater')
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      },
    }

    setupWithoutInjectedUpdater({
      ipcMain,
      getMainWindow: () => null,
      isDevelopment: true,
    })

    expect(materialized).toBe(0)
    expect(handlers.has('update:check')).toBe(true)
    expect(handlers.has('update:install')).toBe(true)

    await handlers.get('update:check')?.()

    expect(materialized).toBe(0)

    await handlers.get('update:install')?.()

    expect(materialized).toBe(0)

    vi.doUnmock('electron-updater')
    vi.resetModules()
  })

  it('registers only updater IPC handlers in development and production', async () => {
    const production = harness()
    const development = harness(true)

    expect(production.handlers.has('app:version')).toBe(false)
    expect(development.handlers.has('app:version')).toBe(false)
    expect(production.handlers.has('update:check')).toBe(true)
    expect(production.handlers.has('update:install')).toBe(true)
    expect(development.handlers.has('update:check')).toBe(true)
    expect(development.handlers.has('update:install')).toBe(true)
  })

  it('does not contact the updater or schedule checks in development', async () => {
    const { handlers, schedule, updater } = harness(true)

    await handlers.get('update:check')?.()

    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(schedule).not.toHaveBeenCalled()
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
  })

  it('uses the signed updater path for every production platform', () => {
    const { schedule, updater } = harness()

    expect(updater.autoDownload).toBe(true)
    expect(updater.autoInstallOnAppQuit).toBe(true)
    expect(schedule).toHaveBeenCalledOnce()
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 5000)
  })

  it('checks for updates manually and on the delayed startup schedule in production', async () => {
    const { handlers, schedule, updater } = harness()

    await handlers.get('update:check')?.()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)

    const scheduledCheck = schedule.mock.calls[0]?.[0]
    expect(scheduledCheck).toBeTypeOf('function')

    await scheduledCheck?.()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('installs only through quitAndInstall', () => {
    const { handlers, updater } = harness()
    handlers.get('update:install')?.()
    expect(updater.quitAndInstall).toHaveBeenCalledOnce()
  })

  it('forwards errors instead of swallowing them on macOS', () => {
    const { send, updater } = harness()
    updater.emit('error', new Error('signature mismatch'))
    expect(send).toHaveBeenCalledWith('update:error', 'signature mismatch')
  })

  it('maps every updater event to the existing renderer channels', () => {
    const { send, updater } = harness()
    const available = { version: '1.12.2' }
    const progress = { percent: 42 }

    updater.emit('checking-for-update')
    updater.emit('update-available', available)
    updater.emit('update-not-available')
    updater.emit('download-progress', progress)
    updater.emit('update-downloaded')
    updater.emit('error', new Error('network down'))

    expect(send.mock.calls).toEqual([
      ['update:checking'],
      ['update:available', available],
      ['update:not-available'],
      ['update:progress', progress],
      ['update:downloaded'],
      ['update:error', 'network down'],
    ])
  })

  it('contains no legacy self-install commands', () => {
    const index = fs.readFileSync(path.resolve(rootDir, 'src/main/index.ts'), 'utf8')
    expect(index).not.toMatch(/codesign --remove-signature|xattr -cr|installMacUpdate|downloadMacUpdate|pendingMacZipPath|execSync/)
  })
})
