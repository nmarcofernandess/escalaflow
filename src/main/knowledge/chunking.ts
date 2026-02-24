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
