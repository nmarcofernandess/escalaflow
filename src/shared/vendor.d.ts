declare module 'pdf-parse' {
  interface PdfParseResult {
    text: string
    numpages?: number
    info?: Record<string, unknown>
    metadata?: unknown
    version?: string
  }

  export default function pdfParse(data: Buffer): Promise<PdfParseResult>
}
