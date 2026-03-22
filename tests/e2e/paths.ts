import path from 'node:path'

/** Diretório PGlite isolado para E2E (alinhado ao global-setup). */
export const E2E_PGLITE_DIR = path.join(process.cwd(), 'tmp/e2e-pglite')

/** userData Chromium/Electron isolado para E2E. */
export const E2E_USER_DATA_DIR = path.join(process.cwd(), 'tmp/e2e-user-data')

/** Main compilado pelo electron-vite (`npm run build`). */
export function pathToMainJs(): string {
  return path.join(process.cwd(), 'out/main/index.js')
}
