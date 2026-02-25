import type { IaMensagem } from '@shared/index'

export function formatChatAsMarkdown(mensagens: IaMensagem[], titulo: string): string {
  const lines: string[] = []
  lines.push(`# ${titulo}`)
  lines.push(`*Exportado em ${new Date().toLocaleString('pt-BR')}*`)
  lines.push('')

  for (const m of mensagens) {
    if (m.papel === 'tool_result') continue

    const role = m.papel === 'usuario' ? '**Voce**' : '**IA**'
    lines.push(`### ${role}`)
    lines.push(m.conteudo)

    if (m.tool_calls?.length) {
      lines.push('')
      lines.push('<details><summary>Ferramentas utilizadas</summary>')
      lines.push('')
      for (const tc of m.tool_calls) {
        lines.push(`- **${tc.name}**${tc.args ? `: \`${JSON.stringify(tc.args)}\`` : ''}`)
      }
      lines.push('</details>')
    }

    if (m.anexos?.length) {
      lines.push('')
      for (const a of m.anexos) {
        lines.push(`> Anexo: ${a.nome} (${a.mime_type})`)
      }
    }

    lines.push('')
    lines.push('---')
    lines.push('')
  }

  return lines.join('\n')
}
