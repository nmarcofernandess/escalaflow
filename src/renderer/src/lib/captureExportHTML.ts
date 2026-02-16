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

  // Collect all CSS rules from document stylesheets
  const cssRules: string[] = []

  for (const sheet of Array.from(document.styleSheets)) {
    try {
      if (!sheet.cssRules) continue
      for (const rule of Array.from(sheet.cssRules)) {
        cssRules.push(rule.cssText)
      }
    } catch {
      // CORS or access error on external stylesheets — skip silently
    }
  }

  const allCSS = cssRules.join('\n')
  const innerHTML = container.innerHTML

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EscalaFlow - Exportacao</title>
  <style>
${allCSS}
  </style>
  <style>
    @media print {
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
    body {
      margin: 0;
      padding: 0;
    }
  </style>
</head>
<body>
  ${innerHTML}
</body>
</html>`
}
