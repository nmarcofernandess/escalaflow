import fs from 'fs'
import path from 'path'
import type { ImportedConversations, UnifiedConversation, UnifiedMessage } from '../../shared/importer-types'

function isoToEpoch(s: string | undefined): number | undefined {
  if (!s) return undefined
  const t = new Date(s).getTime()
  return isNaN(t) ? undefined : t / 1000
}

export function importClaude(filePath: string): ImportedConversations {
  const raw = fs.readFileSync(filePath, 'utf-8')
  return importClaudeFromString(raw, path.basename(filePath))
}

/**
 * Parse Claude JSON from a raw string (used by ZIP importer to avoid temp files).
 */
export function importClaudeFromString(raw: string, fileName: string): ImportedConversations {
  const data = JSON.parse(raw)

  // Claude exports can be array of conversations or single conversation
  const rawConversations = Array.isArray(data) ? data : [data]
  const conversations: UnifiedConversation[] = []

  for (const conv of rawConversations) {
    const chatMessages = conv.chat_messages
    if (!chatMessages || !Array.isArray(chatMessages)) continue

    const messages: UnifiedMessage[] = []

    for (const msg of chatMessages) {
      const role = normalizeRole(msg.sender)
      if (!role) continue

      const content = extractContent(msg)
      if (!content) continue

      messages.push({
        id: msg.uuid || `claude_${messages.length}`,
        role,
        content,
        timestamp: isoToEpoch(msg.created_at),
      })
    }

    if (messages.length === 0) continue

    conversations.push({
      id: conv.uuid || `claude_${Date.now()}`,
      title: conv.name || conv.title || 'Sem titulo',
      messages,
      source: 'claude',
      createdAt: isoToEpoch(conv.created_at),
      updatedAt: isoToEpoch(conv.updated_at),
    })
  }

  return {
    conversations,
    metadata: {
      fileName,
      format: 'claude',
      conversationCount: conversations.length,
    },
  }
}

function normalizeRole(sender: string): 'user' | 'assistant' | null {
  if (sender === 'human' || sender === 'user') return 'user'
  if (sender === 'assistant') return 'assistant'
  return null // skip system/tool
}

interface RawClaudeMessage {
  text?: string
  content?: Array<{ type: string; text?: string }>
}

function extractContent(msg: RawClaudeMessage): string | null {
  // Direct text field
  if (typeof msg.text === 'string' && msg.text.trim()) return msg.text

  // Content array format
  if (Array.isArray(msg.content)) {
    const textParts = msg.content
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => p.text as string)
    if (textParts.length > 0) return textParts.join('\n')
  }

  return null
}
