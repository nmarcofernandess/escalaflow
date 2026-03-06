interface BuildStandaloneHtmlOptions {
  title?: string
  extraCss?: string
  forceLight?: boolean
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
  let htmlClass = document.documentElement.className || ''
  let colorTheme = document.documentElement.getAttribute('data-color-theme')
  const title = options.title ?? 'EscalaFlow - Exportacao'
  const extraCss = options.extraCss ?? ''

  if (options.forceLight) {
    htmlClass = htmlClass.replace(/\bdark\b/g, '').trim()
    if (colorTheme === 'dark') colorTheme = null
  }

  const htmlThemeAttr = colorTheme ? ` data-color-theme="${colorTheme}"` : ''

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
