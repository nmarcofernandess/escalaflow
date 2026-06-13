import { randomUUID } from 'node:crypto'
import fs from 'fs'
import path from 'path'
import type {
  ImportedConversations,
  UnifiedConversation,
  UnifiedMessage,
} from '../../shared/importer-types'

// ---------------------------------------------------------------------------
// ChatGPT Importer — DFS Tree Traversal
// ---------------------------------------------------------------------------
// ChatGPT exports use a `mapping` object where each node has parent/children
// pointers forming a tree. Conversations can branch (user edits create forks).
// We do a full DFS following ALL children to capture every branch.
//
// Supports two export formats:
//   - Array format: JSON is an array of conversation objects, each with `mapping`
//   - Single format: JSON IS a single conversation object with `mapping`
// ---------------------------------------------------------------------------

interface MappingNode {
  id: string
  message: ChatGptMessage | null
  parent: string | null
  children: string[]
}

interface ChatGptMessage {
  id?: string
  author: { role: string }
  content?: {
    parts?: unknown[]
    content_type?: string
    user_profile?: string
    user_instructions?: string
  }
  create_time?: number | null
  metadata?: {
    is_visually_hidden_from_conversation?: boolean
    [key: string]: unknown
  }
}

interface RawConversation {
  id?: string
  title?: string
  create_time?: number
  update_time?: number
  mapping?: Record<string, MappingNode>
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function importChatGpt(filePath: string): ImportedConversations {
  const raw = fs.readFileSync(filePath, 'utf-8')
  return importChatGptFromString(raw, path.basename(filePath))
}

/**
 * Parse ChatGPT JSON from a raw string (used by ZIP importer to avoid temp files).
 */
export function importChatGptFromString(raw: string, fileName: string): ImportedConversations {
  const data = JSON.parse(raw)

  const rawConversations: RawConversation[] = Array.isArray(data) ? data : [data]
  const conversations: UnifiedConversation[] = []

  for (const conv of rawConversations) {
    if (!conv.mapping) continue

    const messages = extractMessages(conv.mapping)
    if (messages.length === 0) continue

    conversations.push({
      id: conv.id || `gpt_${conv.create_time || Date.now()}`,
      title: conv.title || 'Sem titulo',
      messages,
      source: 'chatgpt',
      createdAt: conv.create_time,
      updatedAt: conv.update_time,
    })
  }

  return {
    conversations,
    metadata: {
      fileName,
      format: 'chatgpt',
      conversationCount: conversations.length,
    },
  }
}

// ---------------------------------------------------------------------------
// DFS Extraction
// ---------------------------------------------------------------------------

function extractMessages(mapping: Record<string, MappingNode>): UnifiedMessage[] {
  const roots = findRoots(mapping)
  if (roots.length === 0) return []

  const visited = new Set<string>()
  const messages: UnifiedMessage[] = []

  function dfs(nodeId: string): void {
    if (!nodeId || visited.has(nodeId)) return
    visited.add(nodeId)

    const node = mapping[nodeId]
    if (!node) return

    if (node.message) {
      const msg = processMessage(node.message)
      if (msg) messages.push(msg)
    }

    // Follow ALL children — captures every branch
    for (const childId of node.children ?? []) {
      dfs(childId)
    }
  }

  for (const rootId of roots) {
    dfs(rootId)
  }

  return messages
}

// ---------------------------------------------------------------------------
// Root Finding (resilient, multi-layered)
// ---------------------------------------------------------------------------

function findRoots(mapping: Record<string, MappingNode>): string[] {
  const nodeIds = Object.keys(mapping)
  if (nodeIds.length === 0) return []

  // Collect candidate roots: parent is null OR parent not in mapping
  const candidates: string[] = []
  for (const id of nodeIds) {
    const node = mapping[id]
    if (node.parent === null || node.parent === undefined || !(node.parent in mapping)) {
      candidates.push(id)
    }
  }

  if (candidates.length === 0) {
    // Fallback: use first node in mapping
    return [nodeIds[0]]
  }

  // Prefer 'client-created-root' convention if present
  const clientRoot = candidates.find(
    (id) => id === 'client-created-root' || mapping[id]?.id === 'client-created-root',
  )
  if (clientRoot) return [clientRoot]

  // Use the first candidate (most exports have a single root)
  return [candidates[0]]
}

// ---------------------------------------------------------------------------
// Message Processing
// ---------------------------------------------------------------------------

function processMessage(message: ChatGptMessage): UnifiedMessage | null {
  const role = message.author?.role
  if (!role) return null

  // Filter system messages hidden from conversation
  if (
    role === 'system' &&
    message.metadata?.is_visually_hidden_from_conversation === true
  ) {
    return null
  }

  const content = message.content
  let text = ''

  // Extract text from parts (multiple strategies)
  const parts = content?.parts ?? []
  for (const part of parts) {
    if (typeof part === 'string') {
      if (part.trim().length > 0) {
        text = text ? `${text}\n${part}` : part
      }
    } else if (typeof part === 'object' && part !== null) {
      const obj = part as Record<string, unknown>
      const candidate =
        (obj.text as string) ||
        (obj.value as string) ||
        (obj.content as string) ||
        (obj.raw_text as string)
      if (candidate && typeof candidate === 'string') {
        text = text ? `${text}\n${candidate}` : candidate
      }
    }
  }

  // Fallback: user_editable_context
  if (!text && content?.content_type === 'user_editable_context') {
    const pieces = [content.user_profile, content.user_instructions].filter(Boolean)
    text = pieces.join('\n\n')
  }

  // Skip empty messages
  if (!text.trim()) return null

  const mappedRole = mapRole(role)

  return {
    id: message.id || randomUUID(),
    role: mappedRole,
    content: text,
    timestamp: message.create_time ?? undefined,
  }
}

function mapRole(role: string): UnifiedMessage['role'] {
  switch (role) {
    case 'user':
      return 'user'
    case 'assistant':
      return 'assistant'
    case 'system':
      return 'system'
    case 'tool':
      return 'tool'
    default:
      return 'system'
  }
}
