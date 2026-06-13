import fs from 'fs'
import path from 'path'
import type { ImportedText } from '../../shared/importer-types'

export function importText(filePath: string): ImportedText {
  const text = fs.readFileSync(filePath, 'utf-8')
  const fileName = path.basename(filePath)

  return {
    text,
    metadata: {
      fileName,
      charCount: text.length,
      format: 'text',
    },
  }
}
