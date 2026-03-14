import type { Alocacao, Violacao } from '@shared/index'

interface FuncionarioExportInput {
  nome: string
  contrato: string
  horasSemanais: number
  setor: string
  periodo: { inicio: string; fim: string }
  alocacoes: Alocacao[]
  violacoes: Violacao[]
  regra?: { folga_fixa_dia_semana: string | null; folga_variavel_dia_semana: string | null }
  /** Versão do app para o rodapé (ex: "1.4.0"). Se omitido, usa fallback. */
  version?: string
}

const DIAS = ['Domingo', 'Segunda', 'Terca', 'Quarta', 'Quinta', 'Sexta', 'Sabado']
const DIAS_CURTO = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB']

function fmtDate(d: string): string {
  const [y, m, dd] = d.split('-')
  return `${dd}/${m}/${y}`
}

function fmtTime(t: string | null): string {
  if (!t) return ''
  return t.slice(0, 5)
}

function fmtMinutos(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Gera HTML self-contained para 1 funcionario.
 * Mobile-first, card-per-day, navegacao semanal, dark mode auto.
 */
export function gerarHTMLFuncionario(input: FuncionarioExportInput): string {
  const { nome, contrato, horasSemanais, setor, periodo, alocacoes, violacoes, regra, version } = input

  // Build date range
  const allDates: string[] = []
  const d = new Date(periodo.inicio + 'T00:00:00')
  const end = new Date(periodo.fim + 'T00:00:00')
  while (d <= end) {
    allDates.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    )
    d.setDate(d.getDate() + 1)
  }

  // Group into weeks
  const weeks: string[][] = []
  let week: string[] = []
  for (const dt of allDates) {
    week.push(dt)
    if (week.length === 7) {
      weeks.push(week)
      week = []
    }
  }
  if (week.length > 0) weeks.push(week)

  // Alocacao map
  const alocMap = new Map<string, Alocacao>()
  for (const a of alocacoes) {
    alocMap.set(a.data, a)
  }

  // Calculate hours per week
  function weekMinutes(weekDates: string[]): number {
    let total = 0
    for (const dt of weekDates) {
      const a = alocMap.get(dt)
      if (a?.status === 'TRABALHO' && a.minutos != null) total += a.minutos
    }
    return total
  }

  // Bar position: map time to percentage (6:00=0%, 23:00=100%)
  function timeToPercent(t: string): number {
    const [hh, mm] = t.split(':').map(Number)
    const totalMin = hh * 60 + mm
    const start = 6 * 60 // 06:00
    const end = 23 * 60  // 23:00
    return Math.max(0, Math.min(100, ((totalMin - start) / (end - start)) * 100))
  }

  // Generate day cards for a week
  function renderWeekCards(weekDates: string[]): string {
    return weekDates
      .map((dt) => {
        const dateObj = new Date(dt + 'T00:00:00')
        const dow = dateObj.getDay()
        const a = alocMap.get(dt)
        const status = a?.status ?? 'FOLGA'
        const isSunday = dow === 0

        let statusClass = 'folga'
        let statusLabel = 'Folga'
        let barHtml = ''
        let badgeHtml = ''

        if (status === 'FOLGA' && regra) {
          const dayLabel = DIAS_CURTO[dow]
          if (regra.folga_fixa_dia_semana === dayLabel) badgeHtml = ' <span class="badge-f">[F]</span>'
          else if (regra.folga_variavel_dia_semana === dayLabel) badgeHtml = ' <span class="badge-v">(V)</span>'
        }

        if (status === 'TRABALHO') {
          statusClass = isSunday ? 'trabalho-dom' : 'trabalho'
          statusLabel = `${fmtTime(a?.hora_inicio ?? null)} - ${fmtTime(a?.hora_fim ?? null)}`
          if (a?.hora_inicio && a?.hora_fim) {
            const left = timeToPercent(a.hora_inicio)
            const right = timeToPercent(a.hora_fim)
            const width = Math.max(right - left, 2)
            barHtml = `<div class="bar-track"><div class="bar-fill ${isSunday ? 'bar-dom' : ''}" style="left:${left}%;width:${width}%"></div></div>`
          }
          if (a?.hora_almoco_inicio && a?.hora_almoco_fim) {
            statusLabel += ` | Almoço ${fmtTime(a.hora_almoco_inicio)}-${fmtTime(a.hora_almoco_fim)}`
          }
          if (a?.minutos != null) {
            statusLabel += ` (${fmtMinutos(a.minutos)})`
          }
        } else if (status === 'INDISPONIVEL') {
          statusClass = 'indisponivel'
          statusLabel = 'Indisponivel'
        }

        return `
        <div class="day-card ${statusClass}">
          <div class="day-header">
            <span class="day-name">${DIAS_CURTO[dow]}</span>
            <span class="day-date">${fmtDate(dt)}</span>
          </div>
          <div class="day-body">
            <span class="day-status">${escapeHtml(statusLabel)}${badgeHtml}</span>
            ${barHtml}
          </div>
        </div>`
      })
      .join('\n')
  }

  // Week navigation data
  const weeksJson = JSON.stringify(
    weeks.map((w, i) => ({
      label: `Semana ${i + 1} - ${fmtDate(w[0])} a ${fmtDate(w[w.length - 1])}`,
      real: fmtMinutos(weekMinutes(w)),
      meta: fmtMinutos(horasSemanais * 60),
    })),
  )

  // Weeks HTML
  const weeksHtml = weeks
    .map(
      (w, i) => `
    <div class="week" data-week="${i}" ${i > 0 ? 'style="display:none"' : ''}>
      ${renderWeekCards(w)}
    </div>`,
    )
    .join('\n')

  // Violacoes section
  let violacoesHtml = ''
  if (violacoes.length > 0) {
    const hard = violacoes.filter((v) => v.severidade === 'HARD')
    const soft = violacoes.filter((v) => v.severidade === 'SOFT')
    violacoesHtml = `
    <div class="section avisos">
      <h3>Avisos (${violacoes.length})</h3>
      ${hard.map((v) => `<div class="aviso hard">${escapeHtml(v.mensagem || v.regra)}${v.data ? ` <small>(${fmtDate(v.data)})</small>` : ''}</div>`).join('\n')}
      ${soft.map((v) => `<div class="aviso soft">${escapeHtml(v.mensagem || v.regra)}${v.data ? ` <small>(${fmtDate(v.data)})</small>` : ''}</div>`).join('\n')}
    </div>`
  }

  // Rotatividade section
  const DIA_LABEL: Record<string, string> = { DOM: 'Domingo', SEG: 'Segunda', TER: 'Terca', QUA: 'Quarta', QUI: 'Quinta', SEX: 'Sexta', SAB: 'Sabado' }
  let rotatividadeHtml = ''
  if (regra) {
    const domTrabalhados = allDates.filter(dt => {
      const dow = new Date(dt + 'T00:00:00').getDay()
      return dow === 0 && alocMap.get(dt)?.status === 'TRABALHO'
    }).length
    const domTotal = allDates.filter(dt => new Date(dt + 'T00:00:00').getDay() === 0).length

    rotatividadeHtml = `
    <div class="section rotatividade">
      <h3>Rotatividade</h3>
      <div class="rot-row"><span class="rot-label">Folga fixa:</span> ${regra.folga_fixa_dia_semana ? `<span class="badge-f">[F]</span> ${DIA_LABEL[regra.folga_fixa_dia_semana] ?? regra.folga_fixa_dia_semana}` : '<span style="color:var(--muted)">—</span>'}</div>
      <div class="rot-row"><span class="rot-label">Folga variavel:</span> ${regra.folga_variavel_dia_semana ? `<span class="badge-v">(V)</span> ${DIA_LABEL[regra.folga_variavel_dia_semana] ?? regra.folga_variavel_dia_semana}` : '<span style="color:var(--muted)">—</span>'}</div>
      <div class="rot-row"><span class="rot-label">Domingos trabalhados:</span> ${domTrabalhados} / ${domTotal}</div>
      ${regra.folga_variavel_dia_semana ? '<p class="rot-note">(V) ativa quando trabalhou domingo nesta semana</p>' : ''}
    </div>`
  }

  // Print-only: all weeks visible, compact list
  const printWeeksHtml = weeks
    .map(
      (w, i) => `
    <div class="print-week">
      <h4>Semana ${i + 1} - ${fmtDate(w[0])} a ${fmtDate(w[w.length - 1])} | ${fmtMinutos(weekMinutes(w))} / ${fmtMinutos(horasSemanais * 60)}</h4>
      <table class="print-table">
        <tr>${w.map((dt) => { const dow = new Date(dt + 'T00:00:00').getDay(); return `<th>${DIAS_CURTO[dow]} ${fmtDate(dt)}</th>` }).join('')}</tr>
        <tr>${w.map((dt) => {
          const a = alocMap.get(dt)
          const st = a?.status ?? 'FOLGA'
          if (st === 'TRABALHO') {
            const almoco = a?.hora_almoco_inicio && a?.hora_almoco_fim ? `<br><small>Alm ${fmtTime(a.hora_almoco_inicio)}-${fmtTime(a.hora_almoco_fim)}</small>` : ''
            return `<td class="print-work">${fmtTime(a?.hora_inicio ?? null)}-${fmtTime(a?.hora_fim ?? null)}${almoco}</td>`
          }
          if (st === 'INDISPONIVEL') return `<td class="print-off">I</td>`
          const dayLabel = DIAS_CURTO[new Date(dt + 'T00:00:00').getDay()]
          if (regra?.folga_fixa_dia_semana === dayLabel) return `<td class="print-off">[F]</td>`
          if (regra?.folga_variavel_dia_semana === dayLabel) return `<td class="print-off">(V)</td>`
          return `<td class="print-off">F</td>`
        }).join('')}</tr>
      </table>
    </div>`,
    )
    .join('\n')

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Escala - ${escapeHtml(nome)}</title>
<style>
  :root {
    --bg: #ffffff; --fg: #111827; --muted: #6b7280; --border: #e5e7eb;
    --card: #f9fafb; --work: #d1fae5; --work-fg: #065f46; --work-bar: #10b981;
    --dom: #dbeafe; --dom-fg: #1e40af; --dom-bar: #3b82f6;
    --off: #f3f4f6; --off-fg: #9ca3af;
    --indis: #fef3c7; --indis-fg: #92400e;
    --hard: #fef2f2; --hard-fg: #991b1b; --hard-border: #fecaca;
    --soft: #fffbeb; --soft-fg: #78350f; --soft-border: #fde68a;
    --accent: #6366f1;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #111827; --fg: #f9fafb; --muted: #9ca3af; --border: #374151;
      --card: #1f2937; --work: #064e3b; --work-fg: #a7f3d0; --work-bar: #34d399;
      --dom: #1e3a5f; --dom-fg: #93c5fd; --dom-bar: #60a5fa;
      --off: #1f2937; --off-fg: #6b7280;
      --indis: #78350f; --indis-fg: #fde68a;
      --hard: #450a0a; --hard-fg: #fca5a5; --hard-border: #7f1d1d;
      --soft: #451a03; --soft-fg: #fde68a; --soft-border: #78350f;
    }
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--fg); padding: 16px; max-width: 480px; margin: 0 auto; }
  .header { margin-bottom: 20px; padding-bottom: 12px; border-bottom: 2px solid var(--border); }
  .header h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
  .header .meta { font-size: 13px; color: var(--muted); }
  .header .meta span { margin-right: 12px; }
  .nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; padding: 8px 0; }
  .nav button { background: var(--card); border: 1px solid var(--border); color: var(--fg); padding: 10px 16px; border-radius: 8px; font-size: 18px; cursor: pointer; min-width: 48px; min-height: 48px; display: flex; align-items: center; justify-content: center; -webkit-tap-highlight-color: transparent; }
  .nav button:active { background: var(--border); }
  .nav .label { text-align: center; }
  .nav .label .week-label { font-size: 14px; font-weight: 600; }
  .nav .label .hours { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .day-card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; margin-bottom: 8px; }
  .day-card.trabalho { background: var(--work); border-color: var(--work-bar); }
  .day-card.trabalho-dom { background: var(--dom); border-color: var(--dom-bar); }
  .day-card.indisponivel { background: var(--indis); border-color: var(--indis-fg); }
  .day-card.folga { background: var(--off); }
  .day-header { display: flex; justify-content: space-between; margin-bottom: 6px; }
  .day-name { font-weight: 700; font-size: 13px; }
  .day-date { font-size: 12px; color: var(--muted); }
  .trabalho .day-name, .trabalho .day-status { color: var(--work-fg); }
  .trabalho-dom .day-name, .trabalho-dom .day-status { color: var(--dom-fg); }
  .indisponivel .day-name, .indisponivel .day-status { color: var(--indis-fg); }
  .folga .day-name, .folga .day-status { color: var(--off-fg); }
  .badge-f { display:inline-block; font-size:11px; font-weight:700; color:var(--off-fg); background:var(--border); border-radius:3px; padding:0 4px; margin-left:4px; }
  .badge-v { display:inline-block; font-size:11px; font-weight:700; color:var(--off-fg); border:1px dashed var(--off-fg); border-radius:3px; padding:0 4px; margin-left:4px; }
  .day-body { display: flex; flex-direction: column; gap: 6px; }
  .day-status { font-size: 14px; font-weight: 600; }
  .bar-track { height: 6px; background: var(--border); border-radius: 3px; position: relative; }
  .bar-fill { position: absolute; top: 0; height: 100%; background: var(--work-bar); border-radius: 3px; }
  .bar-dom { background: var(--dom-bar); }
  .section { margin-top: 20px; padding-top: 12px; border-top: 1px solid var(--border); }
  .section h3 { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
  .aviso { padding: 8px 10px; border-radius: 6px; margin-bottom: 6px; font-size: 13px; }
  .aviso.hard { background: var(--hard); color: var(--hard-fg); border: 1px solid var(--hard-border); }
  .aviso.soft { background: var(--soft); color: var(--soft-fg); border: 1px solid var(--soft-border); }
  .aviso small { opacity: 0.8; }
  .rotatividade .rot-row { display:flex; align-items:center; gap:6px; padding:4px 0; font-size:13px; }
  .rotatividade .rot-label { font-weight:600; min-width:130px; }
  .rotatividade .rot-note { font-size:11px; color:var(--muted); margin-top:6px; font-style:italic; }
  .footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid var(--border); font-size: 11px; color: var(--muted); text-align: center; }

  /* Print styles */
  .print-only { display: none; }
  @media print {
    body { max-width: 100%; padding: 10mm; }
    .nav, .week { display: none !important; }
    .print-only { display: block !important; }
    .print-week { margin-bottom: 16px; page-break-inside: avoid; }
    .print-week h4 { font-size: 11px; margin-bottom: 4px; }
    .print-table { width: 100%; border-collapse: collapse; font-size: 10px; }
    .print-table th, .print-table td { border: 1px solid #999; padding: 4px 6px; text-align: center; }
    .print-table th { background: #eee; font-weight: 600; }
    .print-work { background: #d1fae5; font-weight: 600; }
    .print-off { background: #f3f4f6; color: #999; }
    @page { size: A4 portrait; margin: 10mm; }
    body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  }
</style>
</head>
<body>

<div class="header">
  <h1>${escapeHtml(nome)}</h1>
  <div class="meta">
    <span><strong>${escapeHtml(setor)}</strong></span>
    <span>${escapeHtml(contrato)}</span>
    <span>${fmtDate(periodo.inicio)} a ${fmtDate(periodo.fim)}</span>
  </div>
</div>

<div class="nav">
  <button onclick="nav(-1)" aria-label="Semana anterior">&#9664;</button>
  <div class="label">
    <div class="week-label" id="wk-label"></div>
    <div class="hours" id="wk-hours"></div>
  </div>
  <button onclick="nav(1)" aria-label="Proxima semana">&#9654;</button>
</div>

${weeksHtml}

${violacoesHtml}

${rotatividadeHtml}

<div class="print-only">
  ${printWeeksHtml}
</div>

<div class="footer">
  EscalaFlow${version ? ` v${version}` : ''} | Gerado em ${new Date().toLocaleDateString('pt-BR')}
</div>

<script>
var weeks = ${weeksJson};
var cur = 0;
function show() {
  document.querySelectorAll('.week').forEach(function(el) { el.style.display = 'none'; });
  var el = document.querySelector('[data-week="' + cur + '"]');
  if (el) el.style.display = 'block';
  var w = weeks[cur];
  document.getElementById('wk-label').textContent = w.label;
  document.getElementById('wk-hours').textContent = w.real + ' / ' + w.meta;
}
function nav(dir) {
  cur = Math.max(0, Math.min(weeks.length - 1, cur + dir));
  show();
}
show();
</script>

</body>
</html>`
}
