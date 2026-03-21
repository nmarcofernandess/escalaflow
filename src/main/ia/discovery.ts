import { queryOne, queryAll } from '../db/query'
import { buildSolverInput, computeSolverScenarioHash } from '../motor/solver-bridge'
import { searchKnowledge } from '../knowledge/search'
import { gerarCicloFase1 } from '../../shared/simula-ciclo'
import type { IaContexto } from '../../shared/types'

// ─── Context Bundle Types ────────────────────────────────────────
export interface ContextBundle {
    rota: string
    memorias?: string
    rag?: string
    global: {
        setores: number
        colaboradores: number
        rascunhos: number
        oficiais: number
    }
    feriados_proximos: Array<{ data: string; nome: string; proibido: boolean }>
    regras_custom: Array<{ codigo: string; nome: string; de: string; para: string }>
    setores_lista: Array<{ id: number; nome: string; horario: string; colabs: number }>
    setor?: {
        info: string
        preview?: {
            ciclo_semanas: number
            cobertura_media: number
            cobertura_por_dia: Array<{ dia: string; cobertura: number; demanda: number }>
            deficit_max: number
            ff_distribuicao: Record<string, number>
            warnings: string[]
        }
        contratos_relevantes: Array<{
            id: number
            nome: string
            horas_semanais: number
            regime: string
            perfis: Array<{ id: number; nome: string; inicio: string; fim: string }>
        }>
        escala_resumida?: {
            id: number
            status: string
            cobertura_percent: number | null
            violacoes_hard: number
            violacoes_soft: number
            equilibrio: number | null
            pode_oficializar: boolean
            desatualizada: boolean
        }
    }
    colaborador?: string
    snapshot?: string
    alertas?: string
    alertas_backup?: string
    knowledge_catalogo: {
        total_fontes: number
        total_chunks: number
        titulos_top: string[]
    }
    dica_pagina: string
}

/**
 * Auto-discovery: dado o contexto da página atual do usuário,
 * busca dados relevantes do DB e monta um briefing de texto
 * que é injetado no system instruction do Gemini.
 *
 * O objetivo é que a IA NUNCA precise perguntar informações
 * básicas que já estão visíveis na tela do usuário.
 */

// =============================================================================
// buildContextBundle — monta o ContextBundle estruturado
// =============================================================================
export async function buildContextBundle(contexto?: IaContexto, mensagemUsuario?: string): Promise<ContextBundle | null> {
    if (!contexto) return null

    const snap = contexto.store_snapshot as Record<string, any> | undefined

    // ─── Global ─────────────────────────────────────────────────────
    const global = await _resumoGlobal()

    // ─── Memórias ───────────────────────────────────────────────────
    const memorias = await _memorias()

    // ─── Auto-RAG ───────────────────────────────────────────────────
    let rag: string | undefined
    if (mensagemUsuario && mensagemUsuario.trim().length > 10) {
        rag = (await _autoRag(mensagemUsuario)) ?? undefined
    }

    // ─── Feriados próximos ──────────────────────────────────────────
    const feriadosRows = await queryAll<{ data: string; nome: string; proibido_trabalhar: boolean }>(`
        SELECT data, nome, proibido_trabalhar
        FROM feriados
        WHERE data::date >= CURRENT_DATE AND data::date <= CURRENT_DATE + INTERVAL '30 days'
        ORDER BY data
    `)
    const feriados_proximos = feriadosRows.map(f => ({ data: f.data, nome: f.nome, proibido: f.proibido_trabalhar }))

    // ─── Regras custom ──────────────────────────────────────────────
    const regrasRows = await queryAll<{ codigo: string; status: string; nome: string; status_sistema: string }>(`
        SELECT re.codigo, re.status, rd.nome, rd.status_sistema
        FROM regra_empresa re
        JOIN regra_definicao rd ON re.codigo = rd.codigo
        WHERE re.status != rd.status_sistema
        ORDER BY re.codigo
    `)
    const regras_custom = regrasRows.map(r => ({ codigo: r.codigo, nome: r.nome, de: r.status_sistema, para: r.status }))

    // ─── Lista de setores ───────────────────────────────────────────
    const setoresRows = await queryAll<{ id: number; nome: string; hora_abertura: string; hora_fechamento: string }>('SELECT id, nome, hora_abertura, hora_fechamento FROM setores WHERE ativo = true ORDER BY nome')
    const setores_lista: ContextBundle['setores_lista'] = []
    for (const s of setoresRows) {
        let colabs: number
        if (snap?.setor?.id === s.id && Array.isArray(snap.colaboradores)) {
            colabs = snap.colaboradores.length
        } else {
            colabs = (await queryOne<{ c: number }>('SELECT COUNT(*)::int as c FROM colaboradores WHERE setor_id = ? AND ativo = true', s.id))?.c ?? 0
        }
        setores_lista.push({ id: s.id, nome: s.nome, horario: `${s.hora_abertura}–${s.hora_fechamento}`, colabs })
    }

    // ─── Contexto de SETOR específico ───────────────────────────────
    let setorBundle: ContextBundle['setor'] | undefined
    if (contexto.setor_id) {
        let info: string | null = null
        if (snap?.setor?.id === contexto.setor_id && snap.colaboradores) {
            const snapInfo = _infoSetorFromSnapshot(snap)
            const extraInfo = await _infoSetorExtras(contexto.setor_id, snap)
            info = [snapInfo, extraInfo].filter(Boolean).join('\n') || null
        } else {
            info = await _infoSetor(contexto.setor_id)
        }

        // Escala resumida
        const escalaRow = await queryOne<any>(`
            SELECT id, status, data_inicio, data_fim, cobertura_percent,
                   violacoes_hard, violacoes_soft, equilibrio, input_hash
            FROM escalas
            WHERE setor_id = ?
            ORDER BY CASE status WHEN 'RASCUNHO' THEN 0 WHEN 'OFICIAL' THEN 1 ELSE 2 END, id DESC
            LIMIT 1
        `, contexto.setor_id)

        type EscalaResumida = NonNullable<ContextBundle['setor']>['escala_resumida']
        let escala_resumida: EscalaResumida | undefined
        if (escalaRow) {
            let desatualizada = false
            if (escalaRow.input_hash) {
                try {
                    const currentInput = await buildSolverInput(contexto.setor_id, escalaRow.data_inicio, escalaRow.data_fim)
                    const currentHash = computeSolverScenarioHash(currentInput)
                    desatualizada = currentHash !== escalaRow.input_hash
                } catch { /* skip */ }
            }
            escala_resumida = {
                id: escalaRow.id,
                status: escalaRow.status,
                cobertura_percent: escalaRow.cobertura_percent ?? null,
                violacoes_hard: escalaRow.violacoes_hard ?? 0,
                violacoes_soft: escalaRow.violacoes_soft ?? 0,
                equilibrio: escalaRow.equilibrio ?? null,
                pode_oficializar: (escalaRow.violacoes_hard ?? 0) === 0 && escalaRow.status === 'RASCUNHO',
                desatualizada,
            }
        }

        // Preview de ciclo
        const preview = await _buildPreview(contexto.setor_id)

        // Contratos relevantes
        const contratos_relevantes = await _contratosRelevantes(contexto.setor_id)

        if (info) {
            setorBundle = {
                info,
                preview: preview ?? undefined,
                contratos_relevantes,
                escala_resumida,
            }
        }
    }

    // ─── Snapshot visual ────────────────────────────────────────────
    let snapshot: string | undefined
    if (snap) {
        snapshot = _snapshotBriefing(snap) ?? undefined
    }

    // ─── Colaborador específico ─────────────────────────────────────
    let colaborador: string | undefined
    if (contexto.colaborador_id) {
        colaborador = (await _infoColaborador(contexto.colaborador_id)) ?? undefined
    }

    // ─── Alertas proativos ──────────────────────────────────────────
    const alertas = (await _alertasProativos(contexto.setor_id)) ?? undefined

    // ─── Alerta de backup ───────────────────────────────────────────
    let alertas_backup: string | undefined
    try {
        const backupConfig = await queryOne<{ ultimo_backup: string | null }>('SELECT ultimo_backup FROM configuracao_backup WHERE id = 1')
        if (backupConfig) {
            const last = backupConfig.ultimo_backup ? new Date(backupConfig.ultimo_backup) : null
            const daysAgo = last ? Math.floor((Date.now() - last.getTime()) / 86400000) : null
            if (!last) {
                alertas_backup = '- O sistema NUNCA fez backup. Sugira ao RH fazer um backup (tool fazer_backup).'
            } else if (daysAgo !== null && daysAgo > 7) {
                alertas_backup = `- O ultimo backup foi ha ${daysAgo} dias. Sugira ao RH fazer um backup.`
            }
        }
    } catch { /* table might not exist yet */ }

    // ─── Knowledge catálogo ─────────────────────────────────────────
    const knowledge_catalogo = await _statsKnowledgeBundle()

    // ─── Dica de página ─────────────────────────────────────────────
    const dica_pagina = _dicaPagina(contexto.pagina)

    return {
        rota: contexto.rota,
        memorias: memorias ?? undefined,
        rag,
        global,
        feriados_proximos,
        regras_custom,
        setores_lista,
        setor: setorBundle,
        colaborador,
        snapshot,
        alertas,
        alertas_backup,
        knowledge_catalogo,
        dica_pagina,
    }
}

// =============================================================================
// renderContextBriefing — converte ContextBundle em markdown (mesmo formato antigo + novas seções)
// =============================================================================
export function renderContextBriefing(bundle: ContextBundle): string {
    const sections: string[] = []

    sections.push(`## CONTEXTO AUTOMÁTICO — PÁGINA ATUAL DO USUÁRIO`)
    sections.push(`Rota: ${bundle.rota}`)

    if (bundle.memorias) sections.push(bundle.memorias)
    if (bundle.rag) sections.push(bundle.rag)

    sections.push(`\n### Resumo do sistema`)
    sections.push(`- Setores ativos: ${bundle.global.setores}`)
    sections.push(`- Colaboradores ativos: ${bundle.global.colaboradores}`)
    sections.push(`- Escalas RASCUNHO: ${bundle.global.rascunhos} | OFICIAL: ${bundle.global.oficiais}`)

    if (bundle.feriados_proximos.length > 0) {
        sections.push(`\n### Feriados nos próximos 30 dias`)
        for (const f of bundle.feriados_proximos) {
            const flag = f.proibido ? ' (PROIBIDO TRABALHAR)' : ''
            sections.push(`- ${f.data}: ${f.nome}${flag}`)
        }
    }

    if (bundle.regras_custom.length > 0) {
        sections.push(`\n### Regras com override da empresa`)
        for (const r of bundle.regras_custom) {
            sections.push(`- **${r.codigo}** (${r.nome}): padrão ${r.de} → empresa ${r.para}`)
        }
    }

    if (bundle.setores_lista.length > 0) {
        sections.push(`\n### Setores disponíveis`)
        for (const s of bundle.setores_lista) {
            sections.push(`- **${s.nome}** (ID: ${s.id}) — ${s.horario}, ${s.colabs} colaboradores`)
        }
    }

    if (bundle.setor) {
        sections.push(bundle.setor.info)

        if (bundle.setor.preview) {
            const p = bundle.setor.preview
            sections.push(`\n### Preview de Ciclo`)
            sections.push(`- Ciclo: ${p.ciclo_semanas} semanas | Cobertura média: ${(p.cobertura_media * 100).toFixed(0)}%`)
            sections.push(`- Déficit máximo: ${p.deficit_max} pessoa(s)`)
            for (const d of p.cobertura_por_dia) {
                sections.push(`- ${d.dia}: cobertura ${d.cobertura}/${d.demanda}`)
            }
            if (p.ff_distribuicao && Object.keys(p.ff_distribuicao).length > 0) {
                const ffStr = Object.entries(p.ff_distribuicao).map(([dia, qt]) => `${dia}:${qt}`).join(', ')
                sections.push(`- Folgas fixas por dia: ${ffStr}`)
            }
            if (p.warnings.length > 0) {
                for (const w of p.warnings) sections.push(`- AVISO: ${w}`)
            }
        }

        if (bundle.setor.contratos_relevantes.length > 0) {
            sections.push(`\n### Contratos Relevantes no Setor`)
            for (const c of bundle.setor.contratos_relevantes) {
                sections.push(`- **${c.nome}** (ID: ${c.id}) — ${c.horas_semanais}h/sem, ${c.regime}`)
                for (const p of c.perfis) {
                    sections.push(`  - Perfil: ${p.nome} (${p.inicio}–${p.fim})`)
                }
            }
        }

        if (bundle.setor.escala_resumida) {
            const e = bundle.setor.escala_resumida
            const desatStr = e.desatualizada ? ' [DESATUALIZADA]' : ''
            const podeStr = e.pode_oficializar ? ' — pode oficializar' : ''
            sections.push(`\n### Escala Resumida${desatStr}`)
            sections.push(`- Status: ${e.status} (ID: ${e.id})${podeStr}`)
            sections.push(`- Cobertura: ${e.cobertura_percent ?? 'N/A'}% | Equilíbrio: ${e.equilibrio ?? 'N/A'}%`)
            sections.push(`- Violações HARD: ${e.violacoes_hard} | SOFT: ${e.violacoes_soft}`)
        }
    }

    if (bundle.snapshot) sections.push(bundle.snapshot)
    if (bundle.colaborador) sections.push(bundle.colaborador)
    if (bundle.alertas) sections.push(bundle.alertas)

    if (bundle.alertas_backup) {
        sections.push('\n### Alerta: Backup')
        sections.push(bundle.alertas_backup)
    }

    // Base de Conhecimento (expandida com títulos)
    const kc = bundle.knowledge_catalogo
    if (kc.total_fontes > 0) {
        sections.push(`\n### Base de Conhecimento`)
        sections.push(`- ${kc.total_fontes} fonte(s) | ${kc.total_chunks} chunks indexados`)
        if (kc.titulos_top.length > 0) {
            sections.push(`- Fontes recentes: ${kc.titulos_top.join(', ')}`)
        }
    }

    sections.push(bundle.dica_pagina)

    return sections.join('\n')
}

// =============================================================================
// buildContextBriefing — wrapper mantendo assinatura original
// =============================================================================
export async function buildContextBriefing(contexto?: IaContexto, mensagemUsuario?: string): Promise<string> {
    const bundle = await buildContextBundle(contexto, mensagemUsuario)
    if (!bundle) return ''
    return renderContextBriefing(bundle)
}

// =============================================================================
// HELPERS INTERNOS
// =============================================================================

async function _resumoGlobal() {
    return {
        setores: (await queryOne<{ c: number }>('SELECT COUNT(*)::int as c FROM setores WHERE ativo = true'))?.c ?? 0,
        colaboradores: (await queryOne<{ c: number }>('SELECT COUNT(*)::int as c FROM colaboradores WHERE ativo = true'))?.c ?? 0,
        rascunhos: (await queryOne<{ c: number }>("SELECT COUNT(*)::int as c FROM escalas WHERE status = 'RASCUNHO'"))?.c ?? 0,
        oficiais: (await queryOne<{ c: number }>("SELECT COUNT(*)::int as c FROM escalas WHERE status = 'OFICIAL'"))?.c ?? 0,
    }
}

async function _infoSetor(setor_id: number): Promise<string | null> {
    const setor = await queryOne<any>('SELECT * FROM setores WHERE id = ?', setor_id)
    if (!setor) return null

    const lines: string[] = []
    lines.push(`\n### 🎯 Setor em foco: ${setor.nome} (ID: ${setor.id})`)
    lines.push(`- Horário: ${setor.hora_abertura} – ${setor.hora_fechamento}`)
    lines.push(`- Ativo: ${setor.ativo ? 'sim' : 'não'}`)

    // Colaboradores do setor
    const colabs = await queryAll<{ id: number; nome: string; tipo_trabalhador: string; contrato_nome: string; horas_semanais: number; funcao_id: number | null }>(`
        SELECT c.id, c.nome, c.tipo_trabalhador, t.nome as contrato_nome, t.horas_semanais, c.funcao_id
        FROM colaboradores c
        JOIN tipos_contrato t ON c.tipo_contrato_id = t.id
        WHERE c.setor_id = ? AND c.ativo = true
        ORDER BY c.nome
    `, setor_id)

    if (colabs.length > 0) {
        lines.push(`\n#### Colaboradores (${colabs.length} ativos):`)
        for (const c of colabs) {
            lines.push(`- ${c.nome} (ID: ${c.id}) — ${c.contrato_nome} ${c.horas_semanais}h`)
        }
    } else {
        lines.push(`\n⚠️ Setor sem colaboradores ativos.`)
    }

    const postos = await queryAll<{
        id: number
        apelido: string
        tipo_contrato_nome: string | null
        titular_id: number | null
        titular_nome: string | null
    }>(`
        SELECT
          f.id,
          f.apelido,
          t.nome AS tipo_contrato_nome,
          c.id AS titular_id,
          c.nome AS titular_nome
        FROM funcoes f
        LEFT JOIN tipos_contrato t ON t.id = f.tipo_contrato_id
        LEFT JOIN colaboradores c ON c.funcao_id = f.id AND c.ativo = true
        WHERE f.setor_id = ?
        ORDER BY f.ordem, f.apelido
    `, setor_id)

    if (postos.length > 0) {
        const postosVazios = postos.filter((posto) => posto.titular_id == null)
        const reservaOperacional = colabs.filter((colab) => colab.funcao_id == null)

        lines.push(`\n#### Postos do setor (${postos.length}):`)
        lines.push(`- ${postosVazios.length} posto(s) sem titular = reserva de postos`)
        lines.push(`- ${reservaOperacional.length} colaborador(es) sem funcao_id = reserva operacional`)

        for (const posto of postos) {
            const contratoNome = posto.tipo_contrato_nome ?? 'Contrato'
            const titularTexto = posto.titular_nome
              ? `${posto.titular_nome} (ID: ${posto.titular_id})`
              : 'vazio'
            lines.push(`- ${posto.apelido} (ID: ${posto.id}) — ${contratoNome} — titular: ${titularTexto}`)
        }
    } else {
        lines.push(`\n#### Postos do setor`)
        lines.push(`- Nenhum posto cadastrado ainda.`)
        lines.push(`- Posto sem titular = reserva de postos.`)
    }

    // Exceções ativas do setor (férias/atestados que impactam escalas)
    const excecoes = await queryAll<{ tipo: string; data_inicio: string; data_fim: string; colab_nome: string }>(`
        SELECT e.tipo, e.data_inicio, e.data_fim, c.nome as colab_nome
        FROM excecoes e
        JOIN colaboradores c ON e.colaborador_id = c.id
        WHERE c.setor_id = ? AND c.ativo = true
          AND e.data_fim::date >= CURRENT_DATE
        ORDER BY e.data_inicio
        LIMIT 10
    `, setor_id)

    if (excecoes.length > 0) {
        lines.push(`\n#### Exceções ativas (férias/atestados):`)
        for (const e of excecoes) {
            lines.push(`- ${e.colab_nome}: ${e.tipo} ${e.data_inicio} a ${e.data_fim}`)
        }
    }

    // Regras de horário individuais do setor
    const regrasSetor = await queryAll<{
        colab_nome: string; colaborador_id: number;
        dia_semana_regra: string | null; folga_fixa_dia_semana: string | null;
        inicio: string | null; fim: string | null;
    }>(`
        SELECT c.nome as colab_nome, r.colaborador_id, r.dia_semana_regra,
               r.folga_fixa_dia_semana, r.inicio, r.fim
        FROM colaborador_regra_horario r
        JOIN colaboradores c ON c.id = r.colaborador_id
        WHERE c.setor_id = ? AND c.ativo = true AND r.ativo = true
        ORDER BY c.nome, r.dia_semana_regra NULLS FIRST
    `, setor_id)

    if (regrasSetor.length > 0) {
        lines.push(`\n#### Regras de horário individuais:`)
        // Agrupar por colaborador
        const porColab = new Map<number, { nome: string; regras: typeof regrasSetor }>()
        for (const r of regrasSetor) {
            if (!porColab.has(r.colaborador_id)) porColab.set(r.colaborador_id, { nome: r.colab_nome, regras: [] })
            porColab.get(r.colaborador_id)!.regras.push(r)
        }
        for (const [, { nome, regras }] of porColab) {
            const partes = regras.map(r => {
                const label = r.dia_semana_regra ?? 'padrão'
                const parts: string[] = []
                if (r.inicio) parts.push(`entrada:${r.inicio}`)
                if (r.fim) parts.push(`saída:${r.fim}`)
                const janela = parts.join(' ')
                const folga = !r.dia_semana_regra && r.folga_fixa_dia_semana ? `folga ${r.folga_fixa_dia_semana}` : ''
                return [label, janela, folga].filter(Boolean).join(' ')
            })
            lines.push(`- ${nome}: ${partes.join(', ')}`)
        }

        // Detectar conflitos de folga fixa
        const folgasPorDia = new Map<string, string[]>()
        for (const r of regrasSetor) {
            if (r.folga_fixa_dia_semana && !r.dia_semana_regra) {
                const arr = folgasPorDia.get(r.folga_fixa_dia_semana) ?? []
                arr.push(r.colab_nome)
                folgasPorDia.set(r.folga_fixa_dia_semana, arr)
            }
        }
        for (const [dia, nomes] of folgasPorDia) {
            if (nomes.length > 1) {
                lines.push(`- CONFLITO folga fixa ${dia}: ${nomes.join(', ')}`)
            }
        }
    }

    // Quem NÃO tem regra individual
    const colabsSemRegra = colabs.filter(c => !regrasSetor.some(r => r.colaborador_id === c.id))
    if (colabsSemRegra.length > 0 && regrasSetor.length > 0) {
        lines.push(`- Sem regra individual: ${colabsSemRegra.map(c => c.nome).join(', ')}`)
    }

    // Demandas
    const demandas = await queryAll<{ dia_semana: string | null; hora_inicio: string; hora_fim: string; min_pessoas: number }>('SELECT dia_semana, hora_inicio, hora_fim, min_pessoas FROM demandas WHERE setor_id = ? ORDER BY dia_semana, hora_inicio', setor_id)
    if (demandas.length > 0) {
        lines.push(`\n#### Demanda planejada:`)
        for (const d of demandas) {
            const dia = d.dia_semana ?? 'TODOS'
            lines.push(`- ${dia}: ${d.hora_inicio}–${d.hora_fim} → mín ${d.min_pessoas} pessoa(s)`)
        }
    }

    // Escala mais recente (RASCUNHO ou OFICIAL)
    const escala = await queryOne<any>(`
        SELECT id, status, data_inicio, data_fim, pontuacao, cobertura_percent,
               violacoes_hard, violacoes_soft, equilibrio
        FROM escalas
        WHERE setor_id = ?
        ORDER BY CASE status WHEN 'RASCUNHO' THEN 0 WHEN 'OFICIAL' THEN 1 ELSE 2 END, id DESC
        LIMIT 1
    `, setor_id)

    if (escala) {
        lines.push(`\n#### Escala atual: ${escala.status} (ID: ${escala.id})`)
        lines.push(`- Período: ${escala.data_inicio} a ${escala.data_fim}`)
        lines.push(`- Score: ${escala.pontuacao}/100 | Cobertura: ${escala.cobertura_percent}%`)
        lines.push(`- Violações HARD: ${escala.violacoes_hard} | SOFT: ${escala.violacoes_soft}`)
        lines.push(`- Equilíbrio: ${escala.equilibrio}%`)

        // Amostra de alocações recentes (para dar contexto sobre a distribuição)
        if (escala.violacoes_hard > 0) {
            lines.push(`\n⚠️ ATENÇÃO: Esta escala tem ${escala.violacoes_hard} violação(ões) HARD — não pode ser oficializada até resolver.`)
        }

        // Contagem de dias TRABALHO vs FOLGA
        const alocStats = await queryAll<{ status: string; total: number }>(`
            SELECT status, COUNT(*)::int as total
            FROM alocacoes WHERE escala_id = ?
            GROUP BY status
        `, escala.id)

        if (alocStats.length > 0) {
            lines.push(`\n#### Distribuição de alocações:`)
            for (const a of alocStats) {
                lines.push(`- ${a.status}: ${a.total}`)
            }
        }
    } else {
        lines.push(`\n📋 Nenhuma escala encontrada para este setor.`)
    }

    return lines.join('\n')
}

async function _infoColaborador(colaborador_id: number): Promise<string | null> {
    const colab = await queryOne<any>(`
        SELECT c.*, t.nome as contrato_nome, t.horas_semanais, t.regime_escala, t.dias_trabalho,
               s.nome as setor_nome
        FROM colaboradores c
        JOIN tipos_contrato t ON c.tipo_contrato_id = t.id
        JOIN setores s ON c.setor_id = s.id
        WHERE c.id = ?
    `, colaborador_id)

    if (!colab) return null

    const lines: string[] = []
    lines.push(`\n### 👤 Colaborador em foco: ${colab.nome} (ID: ${colab.id})`)
    lines.push(`- Setor: ${colab.setor_nome} (ID: ${colab.setor_id})`)
    lines.push(`- Contrato: ${colab.contrato_nome} (${colab.horas_semanais}h/sem, ${colab.regime_escala})`)
    lines.push(`- Tipo: ${colab.tipo_trabalhador}`)
    if (colab.prefere_turno) lines.push(`- Preferência turno: ${colab.prefere_turno}`)

    // Regras de horário (padrão + por dia da semana)
    const regrasHorario = await queryAll<{
        dia_semana_regra: string | null; inicio: string | null; fim: string | null;
        folga_fixa_dia_semana: string | null;
        domingo_ciclo_trabalho: number; domingo_ciclo_folga: number;
    }>('SELECT dia_semana_regra, inicio, fim, folga_fixa_dia_semana, domingo_ciclo_trabalho, domingo_ciclo_folga FROM colaborador_regra_horario WHERE colaborador_id = ? AND ativo = true ORDER BY dia_semana_regra NULLS FIRST', colaborador_id)

    if (regrasHorario.length > 0) {
        lines.push(`\n#### Regras de horário:`)
        for (const r of regrasHorario) {
            const label = r.dia_semana_regra ?? 'PADRÃO'
            const parts: string[] = []
            if (r.inicio) parts.push(`entrada:${r.inicio}`)
            if (r.fim) parts.push(`saída:${r.fim}`)
            const janela = parts.length > 0 ? parts.join(' ') : 'sem restrição'
            const extras: string[] = []
            if (!r.dia_semana_regra) {
                if (r.folga_fixa_dia_semana) extras.push(`folga fixa ${r.folga_fixa_dia_semana}`)
                extras.push(`ciclo dom ${r.domingo_ciclo_trabalho}/${r.domingo_ciclo_folga}`)
            }
            lines.push(`- ${label}: ${janela}${extras.length > 0 ? ` (${extras.join(', ')})` : ''}`)
        }
    }

    // Exceções ativas
    const excecoes = await queryAll<{ tipo: string; data_inicio: string; data_fim: string; observacao: string | null }>(`
        SELECT tipo, data_inicio, data_fim, observacao
        FROM excecoes WHERE colaborador_id = ? AND data_fim::date >= CURRENT_DATE
        ORDER BY data_inicio
    `, colaborador_id)

    if (excecoes.length > 0) {
        lines.push(`\n#### Exceções ativas:`)
        for (const e of excecoes) {
            lines.push(`- ${e.tipo}: ${e.data_inicio} a ${e.data_fim}${e.observacao ? ` (${e.observacao})` : ''}`)
        }
    }

    return lines.join('\n')
}

// =============================================================================
// SNAPSHOT-BASED HELPERS — skip DB queries when renderer already has the data
// =============================================================================

/**
 * Builds setor header + colaboradores + postos from store snapshot.
 * Skips: setor query, colaboradores query, postos query (3 DB queries saved).
 */
function _infoSetorFromSnapshot(snap: Record<string, any>): string | null {
    if (!snap.setor) return null

    const lines: string[] = []
    lines.push(`\n### Setor em foco: ${snap.setor.nome} (ID: ${snap.setor.id})`)
    lines.push(`- Horario: ${snap.setor.hora_abertura} – ${snap.setor.hora_fechamento}`)

    const colabs = snap.colaboradores as Array<{ id: number; nome: string; tipo_trabalhador: string; funcao_id: number | null }> | undefined
    if (colabs && colabs.length > 0) {
        lines.push(`\n#### Colaboradores (${colabs.length} ativos):`)
        for (const c of colabs) {
            lines.push(`- ${c.nome} (ID: ${c.id}) — ${c.tipo_trabalhador}`)
        }
    } else {
        lines.push(`\nSetor sem colaboradores ativos.`)
    }

    const postos = snap.postos as Array<{ id: number; apelido: string; titular_id: number | null }> | undefined
    if (postos && postos.length > 0) {
        const postosVazios = postos.filter(p => p.titular_id == null)
        const reservaOp = colabs ? colabs.filter(c => c.funcao_id == null) : []
        lines.push(`\n#### Postos do setor (${postos.length}):`)
        lines.push(`- ${postosVazios.length} posto(s) sem titular = reserva de postos`)
        lines.push(`- ${reservaOp.length} colaborador(es) sem funcao_id = reserva operacional`)
        for (const p of postos) {
            const titular = colabs?.find(c => c.id === p.titular_id)
            const titularTexto = titular ? `${titular.nome} (ID: ${titular.id})` : 'vazio'
            lines.push(`- ${p.apelido} (ID: ${p.id}) — titular: ${titularTexto}`)
        }
    }

    return lines.join('\n')
}

/**
 * Queries only the parts that the snapshot doesn't cover for a setor:
 * excecoes detail (with dates), regras horario, demandas detail, escala detail.
 */
async function _infoSetorExtras(setor_id: number, snap: Record<string, any>): Promise<string | null> {
    const lines: string[] = []

    // Exceções ativas do setor (snapshot has ausentes but not all excecoes with dates)
    const excecoes = await queryAll<{ tipo: string; data_inicio: string; data_fim: string; colab_nome: string }>(`
        SELECT e.tipo, e.data_inicio, e.data_fim, c.nome as colab_nome
        FROM excecoes e
        JOIN colaboradores c ON e.colaborador_id = c.id
        WHERE c.setor_id = ? AND c.ativo = true
          AND e.data_fim::date >= CURRENT_DATE
        ORDER BY e.data_inicio
        LIMIT 10
    `, setor_id)

    if (excecoes.length > 0) {
        lines.push(`\n#### Excecoes ativas (ferias/atestados):`)
        for (const e of excecoes) {
            lines.push(`- ${e.colab_nome}: ${e.tipo} ${e.data_inicio} a ${e.data_fim}`)
        }
    }

    // Regras de horário individuais do setor — snapshot doesn't cover
    const regrasSetor = await queryAll<{
        colab_nome: string; colaborador_id: number;
        dia_semana_regra: string | null; folga_fixa_dia_semana: string | null;
        inicio: string | null; fim: string | null;
    }>(`
        SELECT c.nome as colab_nome, r.colaborador_id, r.dia_semana_regra,
               r.folga_fixa_dia_semana, r.inicio, r.fim
        FROM colaborador_regra_horario r
        JOIN colaboradores c ON c.id = r.colaborador_id
        WHERE c.setor_id = ? AND c.ativo = true AND r.ativo = true
        ORDER BY c.nome, r.dia_semana_regra NULLS FIRST
    `, setor_id)

    if (regrasSetor.length > 0) {
        lines.push(`\n#### Regras de horario individuais:`)
        const porColab = new Map<number, { nome: string; regras: typeof regrasSetor }>()
        for (const r of regrasSetor) {
            if (!porColab.has(r.colaborador_id)) porColab.set(r.colaborador_id, { nome: r.colab_nome, regras: [] })
            porColab.get(r.colaborador_id)!.regras.push(r)
        }
        for (const [, { nome, regras }] of porColab) {
            const partes = regras.map(r => {
                const label = r.dia_semana_regra ?? 'padrao'
                const parts: string[] = []
                if (r.inicio) parts.push(`entrada:${r.inicio}`)
                if (r.fim) parts.push(`saida:${r.fim}`)
                const janela = parts.join(' ')
                const folga = !r.dia_semana_regra && r.folga_fixa_dia_semana ? `folga ${r.folga_fixa_dia_semana}` : ''
                return [label, janela, folga].filter(Boolean).join(' ')
            })
            lines.push(`- ${nome}: ${partes.join(', ')}`)
        }

        // Detectar conflitos de folga fixa
        const folgasPorDia = new Map<string, string[]>()
        for (const r of regrasSetor) {
            if (r.folga_fixa_dia_semana && !r.dia_semana_regra) {
                const arr = folgasPorDia.get(r.folga_fixa_dia_semana) ?? []
                arr.push(r.colab_nome)
                folgasPorDia.set(r.folga_fixa_dia_semana, arr)
            }
        }
        for (const [dia, nomes] of folgasPorDia) {
            if (nomes.length > 1) {
                lines.push(`- CONFLITO folga fixa ${dia}: ${nomes.join(', ')}`)
            }
        }

        // Quem NÃO tem regra individual
        const colabIds = snap.colaboradores as Array<{ id: number; nome: string }> | undefined
        if (colabIds) {
            const colabsSemRegra = colabIds.filter(c => !regrasSetor.some(r => r.colaborador_id === c.id))
            if (colabsSemRegra.length > 0) {
                lines.push(`- Sem regra individual: ${colabsSemRegra.map(c => c.nome).join(', ')}`)
            }
        }
    }

    // Demandas detail — snapshot only has porDia aggregation, not full segments
    const demandas = await queryAll<{ dia_semana: string | null; hora_inicio: string; hora_fim: string; min_pessoas: number }>('SELECT dia_semana, hora_inicio, hora_fim, min_pessoas FROM demandas WHERE setor_id = ? ORDER BY dia_semana, hora_inicio', setor_id)
    if (demandas.length > 0) {
        lines.push(`\n#### Demanda planejada:`)
        for (const d of demandas) {
            const dia = d.dia_semana ?? 'TODOS'
            lines.push(`- ${dia}: ${d.hora_inicio}–${d.hora_fim} → min ${d.min_pessoas} pessoa(s)`)
        }
    }

    // Escala detail — snapshot has basic info but not scores/alocacao stats
    const escala = await queryOne<any>(`
        SELECT id, status, data_inicio, data_fim, pontuacao, cobertura_percent,
               violacoes_hard, violacoes_soft, equilibrio
        FROM escalas
        WHERE setor_id = ?
        ORDER BY CASE status WHEN 'RASCUNHO' THEN 0 WHEN 'OFICIAL' THEN 1 ELSE 2 END, id DESC
        LIMIT 1
    `, setor_id)

    if (escala) {
        lines.push(`\n#### Escala atual: ${escala.status} (ID: ${escala.id})`)
        lines.push(`- Periodo: ${escala.data_inicio} a ${escala.data_fim}`)
        lines.push(`- Score: ${escala.pontuacao}/100 | Cobertura: ${escala.cobertura_percent}%`)
        lines.push(`- Violacoes HARD: ${escala.violacoes_hard} | SOFT: ${escala.violacoes_soft}`)
        lines.push(`- Equilibrio: ${escala.equilibrio}%`)

        if (escala.violacoes_hard > 0) {
            lines.push(`\nATENCAO: Esta escala tem ${escala.violacoes_hard} violacao(oes) HARD — nao pode ser oficializada ate resolver.`)
        }

        const alocStats = await queryAll<{ status: string; total: number }>(`
            SELECT status, COUNT(*)::int as total
            FROM alocacoes WHERE escala_id = ?
            GROUP BY status
        `, escala.id)

        if (alocStats.length > 0) {
            lines.push(`\n#### Distribuicao de alocacoes:`)
            for (const a of alocStats) {
                lines.push(`- ${a.status}: ${a.total}`)
            }
        }
    } else {
        lines.push(`\nNenhuma escala encontrada para este setor.`)
    }

    return lines.length > 0 ? lines.join('\n') : null
}

/**
 * Builds a "what the user sees now" section from the store snapshot.
 * Gives the IA immediate awareness of the UI state without any DB query.
 */
function _snapshotBriefing(snap: Record<string, any>): string | null {
    const lines: string[] = []

    if (snap.setor) {
        const ciclo = snap.ciclo as { N: number; K: number; semanas: number } | undefined
        const header = ciclo
            ? `${snap.setor.nome} (N=${ciclo.N} postos, K=${ciclo.K} domingo, ciclo ${ciclo.semanas} semanas)`
            : snap.setor.nome
        lines.push(`\n### O que o usuario esta vendo agora`)
        lines.push(`- Setor: ${header}`)
    }

    const ausentes = snap.ausentes as Array<{ id: number; nome: string; tipo: string; data_inicio: string; data_fim: string }> | undefined
    if (ausentes && ausentes.length > 0) {
        for (const a of ausentes) {
            lines.push(`- Ausente: ${a.nome} (${a.tipo} ${a.data_inicio}–${a.data_fim})`)
        }
    }

    const prox = snap.proximosAusentes as Array<{ id: number; nome: string; tipo: string; diasAte: number }> | undefined
    if (prox && prox.length > 0) {
        for (const p of prox) {
            lines.push(`- Em ${p.diasAte} dia(s): ${p.nome} (${p.tipo})`)
        }
    }

    const avisos = snap.avisos as Array<{ id: string; nivel: string; titulo: string }> | undefined
    if (avisos && avisos.length > 0) {
        for (const a of avisos) {
            lines.push(`- Aviso ${a.nivel}: ${a.titulo}`)
        }
    }

    const escala = snap.escalaAtual as { id: number; status: string; cobertura_percent: number | null; violacoes_hard: number | null } | undefined
    if (escala) {
        const cob = escala.cobertura_percent != null ? ` | cobertura ${escala.cobertura_percent}%` : ''
        const viol = escala.violacoes_hard != null && escala.violacoes_hard > 0 ? ` | ${escala.violacoes_hard} violacoes HARD` : ''
        lines.push(`- Escala: ${escala.status} (ID: ${escala.id})${cob}${viol}`)
    }

    return lines.length > 0 ? lines.join('\n') : null
}

// =============================================================================
// ALERTAS ESTRUTURADOS — injetados automaticamente pelo discovery no contexto de cada mensagem
// =============================================================================

export interface AlertaCore {
    tipo: string
    severidade: 'CRITICAL' | 'WARNING' | 'INFO'
    codigo?: string
    mensagem: string
    setor_id?: number
    setor_nome?: string
    escala_id?: number
}

export async function coreAlerts(setor_id?: number): Promise<AlertaCore[]> {
    const alertas: AlertaCore[] = []

    // 1) Setores com poucos colaboradores ou sem escala
    const setoresQ = setor_id
        ? await queryAll<{ id: number; nome: string }>('SELECT id, nome FROM setores WHERE ativo = true AND id = ?', setor_id)
        : await queryAll<{ id: number; nome: string }>('SELECT id, nome FROM setores WHERE ativo = true')

    for (const s of setoresQ) {
        const colabCount = (await queryOne<{ c: number }>('SELECT COUNT(*)::int as c FROM colaboradores WHERE setor_id = ? AND ativo = true', s.id))!.c
        if (colabCount < 2) {
            alertas.push({ tipo: 'POUCOS_COLABORADORES', severidade: 'WARNING', setor_id: s.id, setor_nome: s.nome, mensagem: `${s.nome}: apenas ${colabCount} colaborador(es) ativo(s).` })
        }

        const temEscala = (await queryOne<{ c: number }>("SELECT COUNT(*)::int as c FROM escalas WHERE setor_id = ? AND status IN ('RASCUNHO', 'OFICIAL')", s.id))!
        if (temEscala.c === 0) {
            alertas.push({ tipo: 'SEM_ESCALA', severidade: 'INFO', setor_id: s.id, setor_nome: s.nome, mensagem: `${s.nome}: nenhuma escala gerada.` })
        }
    }

    // 2) Escalas RASCUNHO com violações HARD
    const violQuery = setor_id
        ? "SELECT e.id, e.setor_id, s.nome as setor_nome, e.violacoes_hard, e.data_inicio, e.data_fim FROM escalas e JOIN setores s ON e.setor_id = s.id WHERE e.status = 'RASCUNHO' AND e.violacoes_hard > 0 AND e.setor_id = ?"
        : "SELECT e.id, e.setor_id, s.nome as setor_nome, e.violacoes_hard, e.data_inicio, e.data_fim FROM escalas e JOIN setores s ON e.setor_id = s.id WHERE e.status = 'RASCUNHO' AND e.violacoes_hard > 0"
    const violacoes = setor_id
        ? await queryAll<{ id: number; setor_id: number; setor_nome: string; violacoes_hard: number; data_inicio: string; data_fim: string }>(violQuery, setor_id)
        : await queryAll<{ id: number; setor_id: number; setor_nome: string; violacoes_hard: number; data_inicio: string; data_fim: string }>(violQuery)
    for (const v of violacoes) {
        alertas.push({ tipo: 'VIOLACOES_HARD_PENDENTES', severidade: 'CRITICAL', setor_id: v.setor_id, setor_nome: v.setor_nome, escala_id: v.id, mensagem: `${v.setor_nome}: escala ${v.data_inicio}–${v.data_fim} tem ${v.violacoes_hard} violação(ões) HARD — não pode oficializar.` })
    }

    // 3) Escalas desatualizadas (input_hash diverge)
    const hashQuery = setor_id
        ? "SELECT e.id, e.setor_id, s.nome as setor_nome, e.input_hash, e.data_inicio, e.data_fim FROM escalas e JOIN setores s ON e.setor_id = s.id WHERE e.status = 'RASCUNHO' AND e.input_hash IS NOT NULL AND e.setor_id = ?"
        : "SELECT e.id, e.setor_id, s.nome as setor_nome, e.input_hash, e.data_inicio, e.data_fim FROM escalas e JOIN setores s ON e.setor_id = s.id WHERE e.status = 'RASCUNHO' AND e.input_hash IS NOT NULL"
    const rascunhos = setor_id
        ? await queryAll<{ id: number; setor_id: number; setor_nome: string; input_hash: string; data_inicio: string; data_fim: string }>(hashQuery, setor_id)
        : await queryAll<{ id: number; setor_id: number; setor_nome: string; input_hash: string; data_inicio: string; data_fim: string }>(hashQuery)
    for (const e of rascunhos) {
        try {
            const currentInput = await buildSolverInput(e.setor_id, e.data_inicio, e.data_fim)
            const currentHash = computeSolverScenarioHash(currentInput)
            if (currentHash !== e.input_hash) {
                alertas.push({ tipo: 'ESCALA_DESATUALIZADA', severidade: 'WARNING', setor_id: e.setor_id, setor_nome: e.setor_nome, escala_id: e.id, mensagem: `${e.setor_nome}: escala ${e.data_inicio}–${e.data_fim} está desatualizada — dados mudaram desde a geração.` })
            }
        } catch { /* skip */ }
    }

    // 4) Exceções expirando em 7 dias
    const expQuery = setor_id
        ? `SELECT e.tipo, e.data_fim, c.nome as colab_nome, c.setor_id, s.nome as setor_nome
           FROM excecoes e JOIN colaboradores c ON e.colaborador_id = c.id JOIN setores s ON c.setor_id = s.id
           WHERE c.ativo = true AND e.data_fim::date >= CURRENT_DATE AND e.data_fim::date <= CURRENT_DATE + INTERVAL '7 days' AND c.setor_id = ?
           ORDER BY e.data_fim LIMIT 10`
        : `SELECT e.tipo, e.data_fim, c.nome as colab_nome, c.setor_id, s.nome as setor_nome
           FROM excecoes e JOIN colaboradores c ON e.colaborador_id = c.id JOIN setores s ON c.setor_id = s.id
           WHERE c.ativo = true AND e.data_fim::date >= CURRENT_DATE AND e.data_fim::date <= CURRENT_DATE + INTERVAL '7 days'
           ORDER BY e.data_fim LIMIT 10`
    const expirando = setor_id
        ? await queryAll<{ tipo: string; data_fim: string; colab_nome: string; setor_id: number; setor_nome: string }>(expQuery, setor_id)
        : await queryAll<{ tipo: string; data_fim: string; colab_nome: string; setor_id: number; setor_nome: string }>(expQuery)
    for (const ex of expirando) {
        alertas.push({ tipo: 'EXCECAO_EXPIRANDO', severidade: 'INFO', setor_id: ex.setor_id, setor_nome: ex.setor_nome, mensagem: `${ex.colab_nome} (${ex.setor_nome}): ${ex.tipo} termina em ${ex.data_fim}.` })
    }

    return alertas
}

async function _alertasProativos(setor_id?: number): Promise<string | null> {
    const alertas = await coreAlerts(setor_id)
    if (alertas.length === 0) return null

    const lines = alertas.map(a => `- ${a.severidade}: ${a.mensagem}`)
    return `\n### Alertas ativos\n${lines.join('\n')}`
}

async function _autoRag(query: string): Promise<string | null> {
    try {
        const result = await searchKnowledge(query, { limite: 3 })
        if (result.chunks.length === 0) return null

        const bestScore = Math.max(...result.chunks.map(c => c.score))

        // Sobe pro nível da source: só título + context_hint (leve, ~300 chars total)
        // O search roda nos chunks (onde moram embeddings), mas o prompt recebe só o ponteiro
        const sourceIds = [...new Set(result.chunks.map(c => c.source_id))]
        const sources = await queryAll<{ id: number; titulo: string; metadata: string }>(
            `SELECT id, titulo, metadata::text as metadata FROM knowledge_sources WHERE id = ANY($1)`,
            sourceIds,
        )
        if (sources.length === 0) return null

        const lines = sources.map(s => {
            let hint = ''
            try {
                const meta = JSON.parse(s.metadata)
                hint = meta.context_hint ?? ''
            } catch { /* */ }
            return hint
                ? `- **${s.titulo}**: ${hint}`
                : `- **${s.titulo}**`
        })

        const confianca = Math.round(bestScore * 100)
        const header = confianca >= 60
            ? `### Conhecimento relevante (confiança: ${confianca}%)`
            : `### Conhecimento relevante (confiança baixa: ${confianca}% — use buscar_conhecimento com query reformulada para melhores resultados)`

        return `\n${header}\n${lines.join('\n')}`
    } catch {
        return null
    }
}

async function _memorias(): Promise<string | null> {
    try {
        const rows = await queryAll<{ id: number; conteudo: string }>('SELECT id, conteudo FROM ia_memorias ORDER BY atualizada_em DESC LIMIT 50')
        if (rows.length === 0) return null
        const lines = rows.map(m => `- ${m.conteudo}`)
        return `\n### Memórias do RH (${rows.length}/50)\n${lines.join('\n')}`
    } catch {
        return null
    }
}

async function _statsKnowledge(): Promise<string | null> {
    try {
        const sources = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM knowledge_sources')
        if (!sources?.count) return null
        const chunks = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM knowledge_chunks')
        // Knowledge Graph não implementado (entities_count sempre 0) — não exibir para não confundir a IA
        return `\n### Base de Conhecimento\n- ${sources.count} fonte(s) | ${chunks?.count ?? 0} chunks indexados`
    } catch {
        return null
    }
}

async function _statsKnowledgeBundle(): Promise<ContextBundle['knowledge_catalogo']> {
    try {
        const sources = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM knowledge_sources')
        const chunks = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM knowledge_chunks')
        const titulosRows = await queryAll<{ titulo: string }>('SELECT titulo FROM knowledge_sources ORDER BY atualizada_em DESC LIMIT 5')
        return {
            total_fontes: sources?.count ?? 0,
            total_chunks: chunks?.count ?? 0,
            titulos_top: titulosRows.map(r => r.titulo),
        }
    } catch {
        return { total_fontes: 0, total_chunks: 0, titulos_top: [] }
    }
}

// ─── DIA_PARA_IDX: mapeia string → índice 0-6 (SEG-DOM) ──────────────────────
const DIA_PARA_IDX: Record<string, number> = { SEG: 0, TER: 1, QUA: 2, QUI: 3, SEX: 4, SAB: 5, DOM: 6 }
const IDX_PARA_DIA = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM']

type SetorPreview = NonNullable<NonNullable<ContextBundle['setor']>['preview']>
type ContratosRelevantes = NonNullable<ContextBundle['setor']>['contratos_relevantes']

async function _buildPreview(setor_id: number): Promise<SetorPreview | null> {
    try {
        // 1. Colaboradores do setor com regras
        const colabs = await queryAll<{
            id: number
            tipo_trabalhador: string
            funcao_id: number | null
            folga_fixa_dia_semana: string | null
            folga_variavel_dia_semana: string | null
        }>(`
            SELECT c.id, c.tipo_trabalhador, c.funcao_id,
                   r.folga_fixa_dia_semana, r.folga_variavel_dia_semana
            FROM colaboradores c
            LEFT JOIN colaborador_regra_horario r
                ON r.colaborador_id = c.id AND r.ativo = true AND r.dia_semana_regra IS NULL
            WHERE c.setor_id = ? AND c.ativo = true
        `, setor_id)

        // 2. Demandas do setor
        const demandasRows = await queryAll<{ dia_semana: string | null; min_pessoas: number }>('SELECT dia_semana, min_pessoas FROM demandas WHERE setor_id = ? ORDER BY dia_semana', setor_id)

        // 3. Calcular demanda por dia [SEG..DOM] — usa max de registros globais (dia_semana=null) e por dia
        const demanda_por_dia: number[] = new Array(7).fill(0)
        const globalDemanda = demandasRows.filter(d => d.dia_semana === null)
        const globalMax = globalDemanda.length > 0 ? Math.max(...globalDemanda.map(d => d.min_pessoas)) : 0
        for (let i = 0; i < 7; i++) demanda_por_dia[i] = globalMax
        for (const d of demandasRows) {
            if (d.dia_semana && d.dia_semana in DIA_PARA_IDX) {
                const idx = DIA_PARA_IDX[d.dia_semana]
                demanda_por_dia[idx] = Math.max(demanda_por_dia[idx], d.min_pessoas)
            }
        }

        // 4. Identificar titulares e intermitentes Tipo B
        // Titular = tem funcao_id. Intermitente Tipo B = tipo_trabalhador=INTERMITENTE e folga_variavel != null
        const titulares = colabs.filter(c => c.funcao_id !== null && c.tipo_trabalhador !== 'INTERMITENTE')
        const intermediosB = colabs.filter(c => c.tipo_trabalhador === 'INTERMITENTE' && c.folga_variavel_dia_semana !== null)
        const N = titulares.length + intermediosB.length
        if (N < 1) return null

        // 5. Calcular K: quantos trabalham domingo
        // Cobertura garantida de DOM por Tipo A (intermitente com regra DOM e folga_variavel = null)
        const tiposA = colabs.filter(c => c.tipo_trabalhador === 'INTERMITENTE' && c.folga_variavel_dia_semana === null)
        // Tipo A com regra DOM = conta como 1 no domingo (cobertura garantida)
        const tiposAComDom = await queryAll<{ colaborador_id: number }>(`
            SELECT r.colaborador_id
            FROM colaborador_regra_horario r
            JOIN colaboradores c ON c.id = r.colaborador_id
            WHERE c.setor_id = ? AND c.ativo = true AND r.ativo = true
              AND r.dia_semana_regra = 'DOM' AND c.tipo_trabalhador = 'INTERMITENTE'
        `, setor_id)
        const tiposAComDomIds = new Set(tiposAComDom.map(r => r.colaborador_id))
        const coberturaGarantidaDom = tiposA.filter(c => tiposAComDomIds.has(c.id)).length

        const demandaDom = demanda_por_dia[6]
        const K = Math.max(0, demandaDom - coberturaGarantidaDom)

        // 6. Montar folgas_forcadas por pessoa (apenas titulares + intermitentes B na ordem)
        const pool = [...titulares, ...intermediosB]
        const folgas_forcadas = pool.map(c => ({
            folga_fixa_dia: c.folga_fixa_dia_semana ? (DIA_PARA_IDX[c.folga_fixa_dia_semana] ?? null) : null,
            folga_variavel_dia: c.folga_variavel_dia_semana ? (DIA_PARA_IDX[c.folga_variavel_dia_semana] ?? null) : null,
            folga_fixa_dom: c.folga_fixa_dia_semana === 'DOM',
        }))

        // 7. Chamar gerarCicloFase1
        const resultado = gerarCicloFase1({
            num_postos: N,
            trabalham_domingo: Math.min(K, N),
            folgas_forcadas,
            demanda_por_dia,
        })

        if (!resultado.sucesso || resultado.grid.length === 0) return null

        // 8. Montar preview
        const ciclo_semanas = resultado.ciclo_semanas

        // Cobertura por dia: média das semanas do ciclo
        const DIAS_NOMES = IDX_PARA_DIA
        const cobertura_por_dia: SetorPreview['cobertura_por_dia'] = []
        let totalCob = 0
        let deficitMax = 0

        for (let d = 0; d < 7; d++) {
            // Média de quantos trabalham nesse dia nas semanas do ciclo
            const semanas = resultado.cobertura_dia
            const cobDia = semanas.length > 0
                ? semanas.reduce((acc, sem) => acc + (sem.cobertura[d] ?? 0), 0) / semanas.length
                : 0
            const cobArredondado = Math.round(cobDia * 10) / 10
            const dem = demanda_por_dia[d]
            const deficit = Math.max(0, dem - cobArredondado)
            if (deficit > deficitMax) deficitMax = deficit
            totalCob += cobArredondado
            cobertura_por_dia.push({ dia: DIAS_NOMES[d], cobertura: cobArredondado, demanda: dem })
        }
        const cobertura_media = 7 > 0 ? totalCob / 7 / Math.max(1, Math.max(...demanda_por_dia)) : 0

        // Distribuição de folgas fixas
        const ff_distribuicao: Record<string, number> = {}
        for (const f of folgas_forcadas) {
            if (f.folga_fixa_dia !== null) {
                const diaStr = IDX_PARA_DIA[f.folga_fixa_dia] ?? 'desconhecido'
                ff_distribuicao[diaStr] = (ff_distribuicao[diaStr] ?? 0) + 1
            }
        }

        // Warnings
        const warnings: string[] = []
        if (resultado.folga_warnings && resultado.folga_warnings.length > 0) {
            for (const w of resultado.folga_warnings) {
                const tipo = w.tipo === 'FF_CONFLITO' ? 'Conflito folga fixa' : 'Conflito folga variável'
                warnings.push(`${tipo} em ${IDX_PARA_DIA[w.dia] ?? w.dia}: cobertura ${w.coberturaRestante}/${w.demandaDia}`)
            }
        }

        return {
            ciclo_semanas,
            cobertura_media: Math.min(1, cobertura_media),
            cobertura_por_dia,
            deficit_max: Math.round(deficitMax * 10) / 10,
            ff_distribuicao,
            warnings,
        }
    } catch {
        return null
    }
}

async function _contratosRelevantes(setor_id: number): Promise<ContratosRelevantes> {
    try {
        const contratos = await queryAll<{ id: number; nome: string; horas_semanais: number; regime_escala: string }>(`
            SELECT DISTINCT tc.id, tc.nome, tc.horas_semanais, tc.regime_escala
            FROM colaboradores c
            JOIN tipos_contrato tc ON c.tipo_contrato_id = tc.id
            WHERE c.setor_id = ? AND c.ativo = true
            ORDER BY tc.nome
        `, setor_id)

        const result: ContratosRelevantes = []
        for (const tc of contratos) {
            const perfisRows = await queryAll<{ id: number; nome: string; inicio: string | null; fim: string | null }>(`
                SELECT id, nome, inicio, fim FROM contrato_perfis_horario
                WHERE tipo_contrato_id = ? AND ativo = true
                ORDER BY ordem, id
            `, tc.id)
            result.push({
                id: tc.id,
                nome: tc.nome,
                horas_semanais: tc.horas_semanais,
                regime: tc.regime_escala,
                perfis: perfisRows.map(p => ({ id: p.id, nome: p.nome, inicio: p.inicio ?? '', fim: p.fim ?? '' })),
            })
        }
        return result
    } catch {
        return []
    }
}

function _dicaPagina(pagina: string): string {
    const dicas: Record<string, string> = {
        dashboard: '\n💡 O usuário está no Dashboard — visão geral do sistema. Pode querer saber status geral, alertas, ou começar a trabalhar em algum setor.',
        setor_lista: '\n💡 O usuário está vendo a lista de setores. Pode querer ajuda para escolher um setor ou comparar entre eles.',
        setor_detalhe: '\n💡 O usuário está na página de detalhe do setor. Pode querer saber sobre os colaboradores, demandas, ou gerar escala.',
        escala: '\n💡 O usuário está na página de ESCALA — vendo o grid de alocações. Use os dados acima (escala, indicadores, colaboradores) para responder SEM perguntar informações básicas. O setor e a escala já estão identificados.',
        escalas_hub: '\n💡 O usuário está no hub de escalas — vendo todas as escalas do sistema.',
        colaborador_lista: '\n💡 O usuário está vendo a lista de colaboradores.',
        colaborador_detalhe: '\n💡 O usuário está no detalhe de um colaborador. Pode querer saber sobre regras, exceções, ou escala.',
        contratos: '\n💡 O usuário está na página de tipos de contrato.',
        empresa: '\n💡 O usuário está na configuração da empresa.',
        feriados: '\n💡 O usuário está na página de feriados.',
        configuracoes: '\n💡 O usuário está nas configurações do sistema.',
        regras: '\n💡 O usuário está na página de regras do motor (CLT, SOFT, Antipadrões).',
        externo: '\n💡 Contexto externo (MCP/terminal). Sem página visual — resolva nomes e IDs via tools.',
    }
    return dicas[pagina] || ''
}
