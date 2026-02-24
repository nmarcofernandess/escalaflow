import { queryOne, queryAll } from '../db/query'
import { buildSolverInput, computeSolverScenarioHash } from '../motor/solver-bridge'
import type { IaContexto } from '../../shared/types'

/**
 * Auto-discovery: dado o contexto da página atual do usuário,
 * busca dados relevantes do DB e monta um briefing de texto
 * que é injetado no system instruction do Gemini.
 *
 * O objetivo é que a IA NUNCA precise perguntar informações
 * básicas que já estão visíveis na tela do usuário.
 */
export async function buildContextBriefing(contexto?: IaContexto): Promise<string> {
    if (!contexto) return ''

    const sections: string[] = []

    sections.push(`## CONTEXTO AUTOMÁTICO — PÁGINA ATUAL DO USUÁRIO`)
    sections.push(`Rota: ${contexto.rota}`)

    // ─── Resumo global (sempre) ──────────────────────────────────────
    const resumo = await _resumoGlobal()
    sections.push(`\n### Resumo do sistema`)
    sections.push(`- Setores ativos: ${resumo.setores}`)
    sections.push(`- Colaboradores ativos: ${resumo.colaboradores}`)
    sections.push(`- Escalas RASCUNHO: ${resumo.rascunhos} | OFICIAL: ${resumo.oficiais}`)

    // ─── Feriados próximos (30 dias) ───────────────────────────────
    const feriadosProximos = await queryAll<{ data: string; nome: string; proibido_trabalhar: boolean }>(`
        SELECT data, nome, proibido_trabalhar
        FROM feriados
        WHERE data >= CURRENT_DATE AND data <= CURRENT_DATE + INTERVAL '30 days'
        ORDER BY data
    `)
    if (feriadosProximos.length > 0) {
        sections.push(`\n### Feriados nos próximos 30 dias`)
        for (const f of feriadosProximos) {
            const flag = f.proibido_trabalhar ? ' (PROIBIDO TRABALHAR)' : ''
            sections.push(`- ${f.data}: ${f.nome}${flag}`)
        }
    }

    // ─── Regras customizadas (empresa overrides ativos) ────────────
    const regrasCustom = await queryAll<{ codigo: string; status: string; nome: string; status_sistema: string }>(`
        SELECT re.codigo, re.status, rd.nome, rd.status_sistema
        FROM regra_empresa re
        JOIN regra_definicao rd ON re.codigo = rd.codigo
        WHERE re.status != rd.status_sistema
        ORDER BY re.codigo
    `)
    if (regrasCustom.length > 0) {
        sections.push(`\n### Regras com override da empresa`)
        for (const r of regrasCustom) {
            sections.push(`- **${r.codigo}** (${r.nome}): padrão ${r.status_sistema} → empresa ${r.status}`)
        }
    }

    // ─── Lista de setores (sempre — são poucos) ──────────────────────
    const setores = await queryAll<{ id: number; nome: string; hora_abertura: string; hora_fechamento: string; ativo: boolean }>('SELECT id, nome, hora_abertura, hora_fechamento, ativo FROM setores WHERE ativo = 1 ORDER BY nome')
    if (setores.length > 0) {
        sections.push(`\n### Setores disponíveis`)
        for (const s of setores) {
            const countRow = await queryOne<{ c: number }>('SELECT COUNT(*)::int as c FROM colaboradores WHERE setor_id = ? AND ativo = 1', s.id)
            const numColabs = countRow?.c ?? 0
            sections.push(`- **${s.nome}** (ID: ${s.id}) — ${s.hora_abertura}–${s.hora_fechamento}, ${numColabs} colaboradores`)
        }
    }

    // ─── Contexto de SETOR específico ────────────────────────────────
    if (contexto.setor_id) {
        const setorInfo = await _infoSetor(contexto.setor_id)
        if (setorInfo) sections.push(setorInfo)
    }

    // ─── Contexto de COLABORADOR específico ──────────────────────────
    if (contexto.colaborador_id) {
        const colabInfo = await _infoColaborador(contexto.colaborador_id)
        if (colabInfo) sections.push(colabInfo)
    }

    // ─── Alertas proativos (escalas desatualizadas, violações, exceções) ──
    const alertaLines = await _alertasProativos(contexto.setor_id)
    if (alertaLines) sections.push(alertaLines)

    // ─── Stats Knowledge Base ────────────────────────────────────────
    const knowledgeStats = await _statsKnowledge()
    if (knowledgeStats) sections.push(knowledgeStats)

    // ─── Dica de página ──────────────────────────────────────────────
    sections.push(_dicaPagina(contexto.pagina))

    return sections.join('\n')
}

// =============================================================================
// HELPERS INTERNOS
// =============================================================================

async function _resumoGlobal() {
    return {
        setores: (await queryOne<{ c: number }>('SELECT COUNT(*)::int as c FROM setores WHERE ativo = 1'))?.c ?? 0,
        colaboradores: (await queryOne<{ c: number }>('SELECT COUNT(*)::int as c FROM colaboradores WHERE ativo = 1'))?.c ?? 0,
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
    const colabs = await queryAll<{ id: number; nome: string; tipo_trabalhador: string; contrato_nome: string; horas_semanais: number }>(`
        SELECT c.id, c.nome, c.tipo_trabalhador, t.nome as contrato_nome, t.horas_semanais
        FROM colaboradores c
        JOIN tipos_contrato t ON c.tipo_contrato_id = t.id
        WHERE c.setor_id = ? AND c.ativo = 1
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

    // Exceções ativas do setor (férias/atestados que impactam escalas)
    const excecoes = await queryAll<{ tipo: string; data_inicio: string; data_fim: string; colab_nome: string }>(`
        SELECT e.tipo, e.data_inicio, e.data_fim, c.nome as colab_nome
        FROM excecoes e
        JOIN colaboradores c ON e.colaborador_id = c.id
        WHERE c.setor_id = ? AND c.ativo = 1
          AND e.data_fim >= CURRENT_DATE
        ORDER BY e.data_inicio
        LIMIT 10
    `, setor_id)

    if (excecoes.length > 0) {
        lines.push(`\n#### Exceções ativas (férias/atestados):`)
        for (const e of excecoes) {
            lines.push(`- ${e.colab_nome}: ${e.tipo} ${e.data_inicio} a ${e.data_fim}`)
        }
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

    // Exceções ativas
    const excecoes = await queryAll<{ tipo: string; data_inicio: string; data_fim: string; observacao: string | null }>(`
        SELECT tipo, data_inicio, data_fim, observacao
        FROM excecoes WHERE colaborador_id = ? AND data_fim >= CURRENT_DATE
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

async function _alertasProativos(setor_id?: number): Promise<string | null> {
    const lines: string[] = []

    // Escalas RASCUNHO com violações HARD (escopo: setor em foco ou todos)
    const violQuery = setor_id
        ? "SELECT e.id, s.nome as setor_nome, e.violacoes_hard, e.data_inicio, e.data_fim FROM escalas e JOIN setores s ON e.setor_id = s.id WHERE e.status = 'RASCUNHO' AND e.violacoes_hard > 0 AND e.setor_id = ?"
        : "SELECT e.id, s.nome as setor_nome, e.violacoes_hard, e.data_inicio, e.data_fim FROM escalas e JOIN setores s ON e.setor_id = s.id WHERE e.status = 'RASCUNHO' AND e.violacoes_hard > 0"
    const violacoes = setor_id
        ? await queryAll<{ id: number; setor_nome: string; violacoes_hard: number; data_inicio: string; data_fim: string }>(violQuery, setor_id)
        : await queryAll<{ id: number; setor_nome: string; violacoes_hard: number; data_inicio: string; data_fim: string }>(violQuery)
    for (const v of violacoes) {
        lines.push(`- CRITICAL: ${v.setor_nome} escala ${v.data_inicio}–${v.data_fim} tem ${v.violacoes_hard} violação(ões) HARD`)
    }

    // Escalas desatualizadas (input_hash diverge)
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
                lines.push(`- WARNING: ${e.setor_nome} escala ${e.data_inicio}–${e.data_fim} está DESATUALIZADA — dados mudaram desde a geração`)
            }
        } catch { /* skip — build pode falhar se dados mudaram drasticamente */ }
    }

    // Exceções expirando em 7 dias
    const expQuery = setor_id
        ? `SELECT e.tipo, e.data_fim, c.nome as colab_nome, s.nome as setor_nome
           FROM excecoes e JOIN colaboradores c ON e.colaborador_id = c.id JOIN setores s ON c.setor_id = s.id
           WHERE c.ativo = 1 AND e.data_fim >= CURRENT_DATE AND e.data_fim <= CURRENT_DATE + INTERVAL '7 days' AND c.setor_id = ?
           ORDER BY e.data_fim LIMIT 5`
        : `SELECT e.tipo, e.data_fim, c.nome as colab_nome, s.nome as setor_nome
           FROM excecoes e JOIN colaboradores c ON e.colaborador_id = c.id JOIN setores s ON c.setor_id = s.id
           WHERE c.ativo = 1 AND e.data_fim >= CURRENT_DATE AND e.data_fim <= CURRENT_DATE + INTERVAL '7 days'
           ORDER BY e.data_fim LIMIT 5`
    const expirando = setor_id
        ? await queryAll<{ tipo: string; data_fim: string; colab_nome: string; setor_nome: string }>(expQuery, setor_id)
        : await queryAll<{ tipo: string; data_fim: string; colab_nome: string; setor_nome: string }>(expQuery)
    for (const ex of expirando) {
        lines.push(`- INFO: ${ex.colab_nome} (${ex.setor_nome}) — ${ex.tipo} termina em ${ex.data_fim}`)
    }

    if (lines.length === 0) return null

    return `\n### Alertas ativos\n${lines.join('\n')}`
}

async function _statsKnowledge(): Promise<string | null> {
    try {
        const sources = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM knowledge_sources')
        if (!sources?.count) return null
        const chunks = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM knowledge_chunks')
        const entities = await queryOne<{ count: number }>(
            "SELECT COUNT(*)::int as count FROM knowledge_entities WHERE valid_to IS NULL"
        )
        return `\n### Base de Conhecimento\n- ${sources.count} fonte(s) | ${chunks?.count ?? 0} chunks indexados | ${entities?.count ?? 0} entidade(s) ativa(s)`
    } catch {
        return null
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
    }
    return dicas[pagina] || ''
}
