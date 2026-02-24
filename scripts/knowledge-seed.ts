/**
 * Knowledge Seed — Ingesta documentos .md de knowledge/ na base de conhecimento.
 *
 * Uso:
 *   npm run knowledge:seed              # Ingesta incrementalmente (apenas mudanças)
 *   npm run knowledge:seed -- --force   # Reingesta tudo (ignora hashes)
 *   npm run knowledge:seed -- --check   # Dry-run: mostra o que mudaria
 */

import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { initDb } from '../src/main/db/pglite'
import { createTables } from '../src/main/db/schema'
import { ingestKnowledge } from '../src/main/knowledge/ingest'
import { execute } from '../src/main/db/query'

const KNOWLEDGE_DIR = path.join(process.cwd(), 'knowledge')
const MANIFEST_PATH = path.join(KNOWLEDGE_DIR, '.manifest.json')

interface ManifestEntry {
  hash: string
  source_id: number
  last_seeded: string
}

type Manifest = Record<string, ManifestEntry>

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex')
}

function loadManifest(): Manifest {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'))
  } catch {
    return {}
  }
}

function saveManifest(manifest: Manifest): void {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf-8')
}

function findMarkdownFiles(dir: string, prefix = ''): { relativePath: string; fullPath: string }[] {
  const files: { relativePath: string; fullPath: string }[] = []
  if (!fs.existsSync(dir)) return files

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      files.push(...findMarkdownFiles(fullPath, relativePath))
    } else if (entry.name.endsWith('.md')) {
      files.push({ relativePath, fullPath })
    }
  }
  return files
}

async function main() {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const check = args.includes('--check')

  console.log('[knowledge:seed] Buscando .md em knowledge/...')

  const mdFiles = findMarkdownFiles(KNOWLEDGE_DIR)
  if (mdFiles.length === 0) {
    console.log('[knowledge:seed] Nenhum .md encontrado em knowledge/. Nada a fazer.')
    process.exit(0)
  }

  console.log(`[knowledge:seed] ${mdFiles.length} arquivo(s) encontrado(s)`)

  const manifest = force ? {} : loadManifest()
  const toIngest: { relativePath: string; fullPath: string; content: string; hash: string }[] = []

  for (const file of mdFiles) {
    const content = fs.readFileSync(file.fullPath, 'utf-8')
    const hash = sha256(content)
    const existing = manifest[file.relativePath]

    if (existing && existing.hash === hash) {
      console.log(`  ✓ ${file.relativePath} (sem mudança)`)
      continue
    }

    console.log(`  → ${file.relativePath} (${existing ? 'atualizado' : 'novo'})`)
    toIngest.push({ ...file, content, hash })
  }

  if (toIngest.length === 0) {
    console.log('[knowledge:seed] Tudo atualizado. Nada a ingestar.')
    process.exit(0)
  }

  if (check) {
    console.log(`[knowledge:seed] --check: ${toIngest.length} arquivo(s) seriam ingestados.`)
    process.exit(0)
  }

  // Inicializar banco
  console.log('[knowledge:seed] Inicializando banco...')
  await initDb()
  await createTables()

  const newManifest = { ...manifest }

  for (const file of toIngest) {
    const titulo = file.relativePath.replace(/\.md$/, '').replace(/\//g, ' — ')

    // Remove source anterior se existia
    const existingEntry = manifest[file.relativePath]
    if (existingEntry) {
      await execute('DELETE FROM knowledge_sources WHERE id = $1', existingEntry.source_id)
      console.log(`  🗑 Removido source anterior #${existingEntry.source_id}`)
    }

    console.log(`  📥 Ingestando: ${file.relativePath}...`)
    const result = await ingestKnowledge(titulo, file.content, 'high', {
      tipo: 'sistema',
      arquivo: file.relativePath,
    })

    newManifest[file.relativePath] = {
      hash: file.hash,
      source_id: result.source_id,
      last_seeded: new Date().toISOString(),
    }

    console.log(`  ✅ ${result.chunks_count} chunk(s) criado(s)`)
  }

  saveManifest(newManifest)
  console.log(`[knowledge:seed] Concluído: ${toIngest.length} arquivo(s) ingestado(s).`)
  process.exit(0)
}

main().catch((err) => {
  console.error('[knowledge:seed] ERRO:', err.message)
  process.exit(1)
})
