import { queryOne, queryAll } from '../db/query'
import { buildSolverInput, computeSolverScenarioHash } from '../motor/solver-bridge'
import { searchKnowledge } from '../knowledge/search'
import type { IaContexto } from '../../shared/types'

/**
 * Auto-discovery: dado o contexto da página atual do usuário,
 * busca dados relevantes do DB e monta um briefing de texto
 * que é injetado no system instruction do Gemini.
 *
 * O objetivo é que a IA NUNCA precise perguntar informações
 * básicas que já estão visíveis na tela do usuário.
 */
export async function buildContextBriefing(contexto?: IaContexto, mensagemUsuario?: string): Promise<string> {
    if (!contexto) return ''

    const snap = contexto.store_snapshot as Record<string, any> | undefined
    const sections: string[] = []

    sections.push(`## CONTEXTO AUTOMÁTICO — PÁGINA ATUAL DO USUÁRIO`)
    sections.push(`Rota: ${contexto.rota}`)

    // ─── Memórias do RH (SEMPRE, todas) ────────────────────────────
    const memorias = await _memorias()
    if (memorias) sections.push(memorias)

    // ─── Auto-RAG: busca semântica no knowledge ─────────────────────
    if (mensagemUsuario && mensagemUsuario.trim().length > 10) {
        const ragContext = await _autoRag(mensagemUsuario)
        if (ragContext) sections.push(ragContext)
    }

    // ─── Resumo global (sempre) ──────────────────────────────────────
    // Snapshot doesn't have global counts for all setores — always query
    const resumo = await _resumoGlobal()
    sections.push(`\n### Resumo do sistema`)
    sections.push(`- Setores ativos: ${resumo.setores}`)
    sections.push(`- Colaboradores ativos: ${resumo.colaboradores}`)
    sections.push(`- Escalas RASCUNHO: ${resumo.rascunhos} | OFICIAL: ${resumo.oficiais}`)

    // ─── Feriados próximos (30 dias) — snapshot doesn't cover ───────
    const feriadosProximos = await queryAll<{ data: string; nome: string; proibido_trabalhar: boolean }>(`
        SELECT data, nome, proibido_trabalhar
        FROM feriados
        WHERE data::date >= CURRENT_DATE AND data::date <= CURRENT_DATE + INTERVAL '30 days'
        ORDER BY data
    `)
    if (feriadosProximos.length > 0) {
        sections.push(`\n### Feriados nos próximos 30 dias`)
        for (const f of feriadosProximos) {
            const flag = f.proibido_trabalhar ? ' (PROIBIDO TRABALHAR)' : ''
            sections.push(`- ${f.data}: ${f.nome}${flag}`)
        }
    }

    // ─── Regras customizadas (empresa overrides ativos) — snapshot doesn't cover ─
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
    const setores = await queryAll<{ id: number; nome: string; hora_abertura: string; hora_fechamento: string; ativo: boolean }>('SELECT id, nome, hora_abertura, hora_fechamento, ativo FROM setores WHERE ativo = true ORDER BY nome')
    if (setores.length > 0) {
        sections.push(`\n### Setores disponíveis`)
        for (const s of setores) {
            // If snapshot has this setor loaded, use its colaborador count to skip query
            if (snap?.setor?.id === s.id && snap.colaboradores) {
                sections.push(`- **${s.nome}** (ID: ${s.id}) — ${s.hora_abertura}–${s.hora_fechamento}, ${snap.colaboradores.length} colaboradores`)
            } else {
                const countRow = await queryOne<{ c: number }>('SELECT COUNT(*)::int as c FROM colaboradores WHERE setor_id = ? AND ativo = true', s.id)
                const numColabs = countRow?.c ?? 0
                sections.push(`- **${s.nome}** (ID: ${s.id}) — ${s.hora_abertura}–${s.hora_fechamento}, ${numColabs} colaboradores`)
            }
        }
    }

    // ─── Contexto de SETOR específico ────────────────────────────────
    if (contexto.setor_id) {
        // When snapshot covers this setor, use _infoSetorFromSnapshot (skips ~6 DB queries)
        if (snap?.setor?.id === contexto.setor_id && snap.colaboradores) {
            const snapInfo = _infoSetorFromSnapshot(snap)
            if (snapInfo) sections.push(snapInfo)
            // Still query the things snapshot doesn't cover: excecoes detail, regras horario, demandas detail, escala detail
            const extraInfo = await _infoSetorExtras(contexto.setor_id, snap)
            if (extraInfo) sections.push(extraInfo)
        } else {
            const setorInfo = await _infoSetor(contexto.setor_id)
            if (setorInfo) sections.push(setorInfo)
        }
    }

    // ─── Snapshot visual context — what the user is seeing now ──────
    if (snap) {
        const snapSection = _snapshotBriefing(snap)
        if (snapSection) sections.push(snapSection)
    }

    // ─── Contexto de COLABORADOR específico ──────────────────────────
    if (contexto.colaborador_id) {
        const colabInfo = await _infoColaborador(contexto.colaborador_id)
        if (colabInfo) sections.push(colabInfo)
    }

    // ─── Alertas proativos (escalas desatualizadas, violações, exceções) ──
    const alertaLines = await _alertasProativos(contexto.setor_id)
    if (alertaLines) sections.push(alertaLines)

    // ─── Alerta de backup desatualizado ──────────────────────────────
    try {
        const backupConfig = await queryOne<{ ultimo_backup: string | null }>('SELECT ultimo_backup FROM configuracao_backup WHERE id = 1')
        if (backupConfig) {
            const last = backupConfig.ultimo_backup ? new Date(backupConfig.ultimo_backup) : null
            const daysAgo = last ? Math.floor((Date.now() - last.getTime()) / 86400000) : null

            if (!last) {
                sections.push('\n### Alerta: Backup')
                sections.push('- O sistema NUNCA fez backup. Sugira ao RH fazer um backup (tool fazer_backup).')
            } else if (daysAgo !== null && daysAgo > 7) {
                sections.push('\n### Alerta: Backup')
                sections.push(`- O ultimo backup foi ha ${daysAgo} dias. Sugira ao RH fazer um backup.`)
            }
        }
    } catch { /* table might not exist yet */ }

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

        return `\n### Conhecimento relevante (use buscar_conhecimento para detalhes)\n${lines.join('\n')}`
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
