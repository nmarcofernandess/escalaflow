import path from 'path'
import AdmZip from 'adm-zip'
import type { ImportResult, ImportedConversations, UnifiedConversation } from '../../shared/importer-types'
import { detectJsonFormat } from './importer-registry'

/**
 * ZIP Importer — extracts JSON files from a ZIP and routes each to
 * the appropriate importer (ChatGPT or Claude). Non-JSON entries are
 * silently skipped. All conversations are aggregated into a single result.
 */
export async function importZip(filePath: string): Promise<ImportResult> {
  const zip = new AdmZip(filePath)
  const entries = zip.getEntries()

  const allConversations: UnifiedConversation[] = []
  const errors: string[] = []

  for (const entry of entries) {
    // Skip directories and non-JSON files
    if (entry.isDirectory) continue
    const ext = path.extname(entry.entryName).toLowerCase()
    if (ext !== '.json') continue

    try {
      const content = entry.getData().toString('utf-8')
      const sample = content.substring(0, 1000)
      const format = detectJsonFormat(sample)

      let result: ImportedConversations | null = null

      if (format === 'chatgpt') {
        const { importChatGptFromString } = await import('./chatgpt-importer')
        result = importChatGptFromString(content, entry.entryName)
      } else if (format === 'claude') {
        const { importClaudeFromString } = await import('./claude-importer')
        result = importClaudeFromString(content, entry.entryName)
      }
      // else: unknown JSON format — skip silently

      if (result) {
        allConversations.push(...result.conversations)
      }
    } catch (err) {
      errors.push(`${entry.entryName}: ${(err as Error).message}`)
    }
  }

  if (allConversations.length === 0 && errors.length > 0) {
    return { type: 'error', error: `Nenhuma conversa extraida do ZIP. Erros: ${errors.join('; ')}` }
  }

  return {
    type: 'conversations',
    data: {
      conversations: allConversations,
      metadata: {
        fileName: path.basename(filePath),
        format: 'chatgpt', // Mixed, but we need one — use chatgpt as default
        conversationCount: allConversations.length,
      },
    },
  }
}
