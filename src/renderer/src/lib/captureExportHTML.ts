import { buildStandaloneHtml } from './export-standalone-html'

/**
 * Captures the rendered DOM of an element and produces a self-contained HTML string.
 * Used by the export flow to generate printable/saveable HTML files.
 *
 * @param selector - CSS selector for the container to capture (default: '[data-export-preview]')
 * @returns Complete HTML string ready to be saved as .html or opened in a print window
 */
export function captureExportHTML(selector: string = '[data-export-preview]'): string {
  const container = document.querySelector(selector)
  if (!container) {
    throw new Error(`Export container not found: "${selector}"`)
  }

  return buildStandaloneHtml(container.innerHTML, {
    title: 'EscalaFlow - Exportacao',
    forceLight: true,
  })
}
