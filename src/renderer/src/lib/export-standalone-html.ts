interface BuildStandaloneHtmlOptions {
  title?: string
  extraCss?: string
}

function collectDocumentCss(): string {
  const cssRules: string[] = []

  for (const sheet of Array.from(document.styleSheets)) {
    try {
      if (!sheet.cssRules) continue
      for (const rule of Array.from(sheet.cssRules)) {
        cssRules.push(rule.cssText)
      }
    } catch {
      // Skip protected or inaccessible stylesheet entries.
    }
  }

  return cssRules.join('\n')
}

export function buildStandaloneHtml(
  innerHtml: string,
  options: BuildStandaloneHtmlOptions = {},
): string {
  const appCss = collectDocumentCss()
  const htmlClass = document.documentElement.className || ''
  const colorTheme = document.documentElement.getAttribute('data-color-theme')
  const htmlThemeAttr = colorTheme ? ` data-color-theme="${colorTheme}"` : ''
  const title = options.title ?? 'EscalaFlow - Exportacao'
  const extraCss = options.extraCss ?? ''

  return `<!DOCTYPE html>
<html lang="pt-BR" class="${htmlClass}"${htmlThemeAttr}>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
${appCss}
  </style>
  <style>
    body {
      margin: 0;
      padding: 0;
    }
    @media print {
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
${extraCss}
  </style>
</head>
<body>
  ${innerHtml}
</body>
</html>`
}
