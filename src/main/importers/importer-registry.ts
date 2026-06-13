import fs from 'fs'
import path from 'path'
import type { DetectedFormat, ImportResult } from '../../shared/importer-types'
import { importText } from './text-importer'
import { importPdf } from './pdf-importer'
import { importChatGptFromString } from './chatgpt-importer'
import { importClaudeFromString } from './claude-importer'
import { importZip } from './zip-importer'

/**
 * Sniff the first N chars of a JSON string to decide if it's ChatGPT or Claude format.
 */
export function detectJsonFormat(sample: string): 'chatgpt' | 'claude' | 'unknown' {
  if (sample.includes('"mapping"')) return 'chatgpt'
  if (sample.includes('"chat_messages"')) return 'claude'
  return 'unknown'
}

export function detectFormat(filePath: string): DetectedFormat {
  const ext = path.extname(filePath).toLowerCase()

  if (ext === '.pdf') return 'pdf'
  if (ext === '.zip') return 'zip'

  if (ext === '.json') {
    const sample = fs.readFileSync(filePath, 'utf-8').substring(0, 1000)
    const jsonFormat = detectJsonFormat(sample)
    if (jsonFormat !== 'unknown') return jsonFormat
    return 'text' // JSON but unknown format — treat as text
  }

  // .md, .txt, .html, anything else → text
  return 'text'
}

export async function importFile(filePath: string): Promise<ImportResult> {
  const format = detectFormat(filePath)

  try {
    switch (format) {
      case 'text':
        return { type: 'text', data: importText(filePath) }
      case 'pdf':
        return { type: 'text', data: await importPdf(filePath) }
      case 'chatgpt': {
        const content = fs.readFileSync(filePath, 'utf-8')
        return { type: 'conversations', data: importChatGptFromString(content, path.basename(filePath)) }
      }
      case 'claude': {
        const content = fs.readFileSync(filePath, 'utf-8')
        return { type: 'conversations', data: importClaudeFromString(content, path.basename(filePath)) }
      }
      case 'zip':
        return await importZip(filePath)
      default:
        return { type: 'error', error: `Formato nao suportado: ${format}` }
    }
  } catch (err) {
    return { type: 'error', error: `Falha ao importar: ${(err as Error).message}` }
  }
}
