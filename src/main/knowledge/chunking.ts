// ---------------------------------------------------------------------------
// Conversation Chunking
// ---------------------------------------------------------------------------

export interface ConversationChunk {
  text: string
  conversationId: string
  conversationTitle: string
  position: number
}

/**
 * Chunks a conversation into blocks of user+assistant turns.
 * Each block: "User: {text}\nAssistant: {text}"
 * If a block exceeds maxChars, it gets split with overlap (same as chunkText).
 */
export function chunkConversation(
  conversation: { id: string; title: string; messages: Array<{ role: string; content: string }> },
  maxChars = 1500,
  overlap = 200,
): ConversationChunk[] {
  const { id, title, messages } = conversation
  if (!messages || messages.length === 0) return []

  // Group messages into user+assistant turn blocks
  const blocks: string[] = []
  let currentBlock = ''
  let hasAssistantInBlock = false

  for (const msg of messages) {
    const role = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : null
    if (!role) continue // skip system/tool messages

    const line = `${role}: ${msg.content}`

    if (currentBlock && msg.role === 'user' && hasAssistantInBlock) {
      // New turn pair starting — flush the current block
      blocks.push(currentBlock.trim())
      currentBlock = line
      hasAssistantInBlock = false
    } else {
      currentBlock = currentBlock ? `${currentBlock}\n${line}` : line
      if (msg.role === 'assistant') hasAssistantInBlock = true
    }
  }

  // Flush remaining
  if (currentBlock.trim()) {
    blocks.push(currentBlock.trim())
  }

  // Now chunk each block (split large blocks with overlap)
  const chunks: ConversationChunk[] = []
  let position = 0

  for (const block of blocks) {
    if (block.length <= maxChars) {
      chunks.push({ text: block, conversationId: id, conversationTitle: title, position })
      position++
    } else {
      // Block too large — use chunkText to split
      const subChunks = chunkText(block, maxChars, overlap)
      for (const sub of subChunks) {
        chunks.push({ text: sub, conversationId: id, conversationTitle: title, position })
        position++
      }
    }
  }

  return chunks
}

// ---------------------------------------------------------------------------
// Text Chunking
// ---------------------------------------------------------------------------

/**
 * Recursive text splitter: quebra texto em chunks com overlap.
 * Prioridade de separadores: \n\n → \n → . → fallback por tamanho.
 *
 * @param text - Texto a ser chunkeado
 * @param maxChars - Tamanho máximo de cada chunk (default 1500)
 * @param overlap - Overlap entre chunks consecutivos (default 200)
 * @returns Array de strings prontas para embedding
 */
export function chunkText(text: string, maxChars = 1500, overlap = 200): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.length <= maxChars) return [trimmed]

  const chunks: string[] = []
  const separators = ['\n\n', '\n', '. ']

  let remaining = trimmed

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining.trim())
      break
    }

    let splitAt = -1

    // Tenta cada separador na ordem de prioridade
    for (const sep of separators) {
      // Procura o último separador dentro do limite
      const searchArea = remaining.slice(0, maxChars)
      const lastIdx = searchArea.lastIndexOf(sep)
      if (lastIdx > maxChars * 0.3) {
        // Só aceita se não for muito no início (pelo menos 30% do chunk)
        splitAt = lastIdx + sep.length
        break
      }
    }

    // Fallback: corta no limite exato
    if (splitAt === -1) {
      splitAt = maxChars
    }

    const chunk = remaining.slice(0, splitAt).trim()
    if (chunk) {
      chunks.push(chunk)
    }

    // Avança com overlap
    const advance = Math.max(splitAt - overlap, 1)
    remaining = remaining.slice(advance)
  }

  return chunks.filter(c => c.length > 0)
}
