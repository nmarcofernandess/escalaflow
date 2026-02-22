import { getDb } from '../db/database'
import type { IaContexto } from '../../shared/types'

/**
 * Auto-discovery: dado o contexto da página atual do usuário,
 * busca dados relevantes do DB e monta um briefing de texto
 * que é injetado no system instruction do Gemini.
 *
 * O objetivo é que a IA NUNCA precise perguntar informações
 * básicas que já estão visíveis na tela do usuário.
 */
export function buildContextBriefing(contexto?: IaContexto): string {
    if (!contexto) return ''

    const db = getDb()
    const sections: string[] = []

    sections.push(`## CONTEXTO AUTOMÁTICO — PÁGINA ATUAL DO USUÁRIO`)
    sections.push(`Rota: ${contexto.rota}`)

    // ─── Resumo global (sempre) ──────────────────────────────────────
    const resumo = _resumoGlobal(db)
    sections.push(`\n### Resumo do sistema`)
    sections.push(`- Setores ativos: ${resumo.setores}`)
    sections.push(`- Colaboradores ativos: ${resumo.colaboradores}`)
    sections.push(`- Escalas RASCUNHO: ${resumo.rascunhos} | OFICIAL: ${resumo.oficiais}`)

    // ─── Lista de setores (sempre — são poucos) ──────────────────────
    const setores = db.prepare('SELECT id, nome, hora_abertura, hora_fechamento, ativo FROM setores WHERE ativo = 1 ORDER BY nome').all() as Array<{ id: number; nome: string; hora_abertura: string; hora_fechamento: string; ativo: number }>
    if (setores.length > 0) {
        sections.push(`\n### Setores disponíveis`)
        for (const s of setores) {
            const numColabs = (db.prepare('SELECT COUNT(*) as c FROM colaboradores WHERE setor_id = ? AND ativo = 1').get(s.id) as { c: number }).c
            sections.push(`- **${s.nome}** (ID: ${s.id}) — ${s.hora_abertura}–${s.hora_fechamento}, ${numColabs} colaboradores`)
        }
    }

    // ─── Contexto de SETOR específico ────────────────────────────────
    if (contexto.setor_id) {
        const setorInfo = _infoSetor(db, contexto.setor_id)
        if (setorInfo) sections.push(setorInfo)
    }

    // ─── Contexto de COLABORADOR específico ──────────────────────────
    if (contexto.colaborador_id) {
        const colabInfo = _infoColaborador(db, contexto.colaborador_id)
        if (colabInfo) sections.push(colabInfo)
    }

    // ─── Dica de página ──────────────────────────────────────────────
    sections.push(_dicaPagina(contexto.pagina))

    return sections.join('\n')
}

// =============================================================================
// HELPERS INTERNOS
// =============================================================================

function _resumoGlobal(db: ReturnType<typeof getDb>) {
    return {
        setores: (db.prepare('SELECT COUNT(*) as c FROM setores WHERE ativo = 1').get() as any).c,
        colaboradores: (db.prepare('SELECT COUNT(*) as c FROM colaboradores WHERE ativo = 1').get() as any).c,
        rascunhos: (db.prepare("SELECT COUNT(*) as c FROM escalas WHERE status = 'RASCUNHO'").get() as any).c,
        oficiais: (db.prepare("SELECT COUNT(*) as c FROM escalas WHERE status = 'OFICIAL'").get() as any).c,
    }
}

function _infoSetor(db: ReturnType<typeof getDb>, setor_id: number): string | null {
    const setor = db.prepare('SELECT * FROM setores WHERE id = ?').get(setor_id) as any
    if (!setor) return null

    const lines: string[] = []
    lines.push(`\n### 🎯 Setor em foco: ${setor.nome} (ID: ${setor.id})`)
    lines.push(`- Horário: ${setor.hora_abertura} – ${setor.hora_fechamento}`)
    lines.push(`- Ativo: ${setor.ativo ? 'sim' : 'não'}`)

    // Colaboradores do setor
    const colabs = db.prepare(`
        SELECT c.id, c.nome, c.tipo_trabalhador, t.nome as contrato_nome, t.horas_semanais
        FROM colaboradores c
        JOIN tipos_contrato t ON c.tipo_contrato_id = t.id
        WHERE c.setor_id = ? AND c.ativo = 1
        ORDER BY c.nome
    `).all(setor_id) as Array<{ id: number; nome: string; tipo_trabalhador: string; contrato_nome: string; horas_semanais: number }>

    if (colabs.length > 0) {
        lines.push(`\n#### Colaboradores (${colabs.length} ativos):`)
        for (const c of colabs) {
            lines.push(`- ${c.nome} (ID: ${c.id}) — ${c.contrato_nome} ${c.horas_semanais}h`)
        }
    } else {
        lines.push(`\n⚠️ Setor sem colaboradores ativos.`)
    }

    // Demandas
    const demandas = db.prepare('SELECT dia_semana, hora_inicio, hora_fim, min_pessoas FROM demandas WHERE setor_id = ? ORDER BY dia_semana, hora_inicio').all(setor_id) as Array<{ dia_semana: string | null; hora_inicio: string; hora_fim: string; min_pessoas: number }>
    if (demandas.length > 0) {
        lines.push(`\n#### Demanda planejada:`)
        for (const d of demandas) {
            const dia = d.dia_semana ?? 'TODOS'
            lines.push(`- ${dia}: ${d.hora_inicio}–${d.hora_fim} → mín ${d.min_pessoas} pessoa(s)`)
        }
    }

    // Escala mais recente (RASCUNHO ou OFICIAL)
    const escala = db.prepare(`
        SELECT id, status, data_inicio, data_fim, pontuacao, cobertura_percent,
               violacoes_hard, violacoes_soft, equilibrio
        FROM escalas
        WHERE setor_id = ?
        ORDER BY CASE status WHEN 'RASCUNHO' THEN 0 WHEN 'OFICIAL' THEN 1 ELSE 2 END, id DESC
        LIMIT 1
    `).get(setor_id) as any

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
        const alocStats = db.prepare(`
            SELECT status, COUNT(*) as total
            FROM alocacoes WHERE escala_id = ?
            GROUP BY status
        `).all(escala.id) as Array<{ status: string; total: number }>

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

function _infoColaborador(db: ReturnType<typeof getDb>, colaborador_id: number): string | null {
    const colab = db.prepare(`
        SELECT c.*, t.nome as contrato_nome, t.horas_semanais, t.regime_escala, t.dias_trabalho,
               s.nome as setor_nome
        FROM colaboradores c
        JOIN tipos_contrato t ON c.tipo_contrato_id = t.id
        JOIN setores s ON c.setor_id = s.id
        WHERE c.id = ?
    `).get(colaborador_id) as any

    if (!colab) return null

    const lines: string[] = []
    lines.push(`\n### 👤 Colaborador em foco: ${colab.nome} (ID: ${colab.id})`)
    lines.push(`- Setor: ${colab.setor_nome} (ID: ${colab.setor_id})`)
    lines.push(`- Contrato: ${colab.contrato_nome} (${colab.horas_semanais}h/sem, ${colab.regime_escala})`)
    lines.push(`- Tipo: ${colab.tipo_trabalhador}`)
    if (colab.prefere_turno) lines.push(`- Preferência turno: ${colab.prefere_turno}`)

    // Exceções ativas
    const excecoes = db.prepare(`
        SELECT tipo, data_inicio, data_fim, observacao
        FROM excecoes WHERE colaborador_id = ? AND data_fim >= date('now')
        ORDER BY data_inicio
    `).all(colaborador_id) as Array<{ tipo: string; data_inicio: string; data_fim: string; observacao: string | null }>

    if (excecoes.length > 0) {
        lines.push(`\n#### Exceções ativas:`)
        for (const e of excecoes) {
            lines.push(`- ${e.tipo}: ${e.data_inicio} a ${e.data_fim}${e.observacao ? ` (${e.observacao})` : ''}`)
        }
    }

    return lines.join('\n')
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
