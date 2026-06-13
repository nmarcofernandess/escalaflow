import fs from 'fs'
import path from 'path'
import type { ImportedText } from '../../shared/importer-types'

export async function importPdf(filePath: string): Promise<ImportedText> {
  // pdf-parse uses module.exports (CommonJS default export)
  const pdfParse = (await import('pdf-parse')).default
  const buffer = fs.readFileSync(filePath)
  const result = await pdfParse(buffer)
  const fileName = path.basename(filePath)

  return {
    text: result.text,
    metadata: {
      fileName,
      charCount: result.text.length,
      format: 'pdf',
      pageCount: result.numpages,
      author: typeof result.info?.Author === 'string' ? result.info.Author || undefined : undefined,
    },
  }
}
