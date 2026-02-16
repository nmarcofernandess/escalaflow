import { client } from './client'

export const exportarService = {
  salvarHTML: (html: string, filename?: string) =>
    client['export.salvarHTML']({ html, filename }) as Promise<{ filepath: string } | null>,

  imprimirPDF: (html: string, filename?: string) =>
    client['export.imprimirPDF']({ html, filename }) as Promise<{ filepath: string } | null>,

  salvarCSV: (csv: string, filename?: string) =>
    client['export.salvarCSV']({ csv, filename }) as Promise<{ filepath: string } | null>,

  batchHTML: (arquivos: { nome: string; html: string }[]) =>
    client['export.batchHTML']({ arquivos }) as Promise<{ pasta: string; count: number } | null>,
}
