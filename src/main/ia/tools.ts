import { getDb } from '../db/database'
import { buildSolverInput, runSolver, persistirSolverResult } from '../motor/solver-bridge'

export const IA_TOOLS = [
    {
        name: 'consultar',
        description: 'Consulta dados do banco de dados. Use SEMPRE que precisar de informação. Nunca pergunte ao usuário — busque aqui. Exemplos: consultar("setores") para listar todos os setores, consultar("alocacoes", {"escala_id": 15}) para ver alocações de uma escala, consultar("colaboradores", {"setor_id": 3}) para colaboradores de um setor. Filtros de texto são case-insensitive.',
        parameters: {
            type: 'object',
            properties: {
                entidade: {
                    type: 'string',
                    description: 'A tabela para consultar: colaboradores | setores | escalas | alocacoes | excecoes | demandas | tipos_contrato | empresa | feriados | funcoes | regra_definicao | regra_empresa'
                },
                filtros: {
                    type: 'object',
                    description: 'Filtros opcionais (ex: {"setor_id": 3, "ativo": 1}). Para resolver nomes, chame SEM filtros e procure na lista. Filtros de texto são case-insensitive.'
                }
            },
            required: ['entidade']
        }
    },
    {
        name: 'criar',
        description: 'Cria um novo registro no sistema.',
        parameters: {
            type: 'object',
            properties: {
                entidade: {
                    type: 'string',
                    description: 'colaboradores | excecoes | demandas | tipos_contrato | setores | feriados | funcoes'
                },
                dados: { type: 'object', description: 'objeto JSON com os campos necessários para criar o registro' }
            },
            required: ['entidade', 'dados']
        }
    },
    {
        name: 'atualizar',
        description: 'Atualiza um registro existente.',
        parameters: {
            type: 'object',
            properties: {
                entidade: {
                    type: 'string',
                    description: 'colaboradores | empresa | tipos_contrato | setores | demandas'
                },
                id: { type: 'number', description: 'ID do registro' },
                dados: { type: 'object', description: 'objeto JSON com campos e valores para atualizar' }
            },
            required: ['entidade', 'id', 'dados']
        }
    },
    {
        name: 'deletar',
        description: 'Remove um registro.',
        parameters: {
            type: 'object',
            properties: {
                entidade: {
                    type: 'string',
                    description: 'excecoes | demandas | feriados | funcoes'
                },
                id: { type: 'number', description: 'ID do registro' }
            },
            required: ['entidade', 'id']
        }
    },
    {
        name: 'editar_regra',
        description: 'Altera o status de uma regra do motor OR-Tools. Apenas regras marcadas como editavel=1 podem ser alteradas. Regras fixas por lei (H2, H4, H5, H11-H18) são imutáveis.',
        parameters: {
            type: 'object',
            properties: {
                codigo: { type: 'string', description: 'Código da regra (ex: H1, H6, AP3, S_DEFICIT)' },
                status: { type: 'string', description: 'Novo status: HARD | SOFT | OFF | ON' }
            },
            required: ['codigo', 'status']
        }
    },
    {
        name: 'gerar_escala',
        description: 'Roda o motor OR-Tools CP-SAT para gerar uma escala. Salva como RASCUNHO. Use o setor_id do auto-contexto. Exemplo: gerar_escala({"setor_id": 3, "data_inicio": "2026-03-01", "data_fim": "2026-03-31"}). Retorna escala_id, indicadores e diagnostico.',
        parameters: {
            type: 'object',
            properties: {
                setor_id: { type: 'number', description: 'ID do setor (pegue do auto-contexto ou da lista de setores)' },
                data_inicio: { type: 'string', description: 'Data YYYY-MM-DD' },
                data_fim: { type: 'string', description: 'Data YYYY-MM-DD' },
                rules_override: {
                    type: 'object',
                    description: 'Override opcional de regras para este run (ex: {"H1": "SOFT", "AP3": "OFF"}). Não persiste no banco.'
                }
            },
            required: ['setor_id', 'data_inicio', 'data_fim']
        }
    },
    {
        name: 'ajustar_alocacao',
        description: 'Fixa uma alocação específica de uma pessoa em um dia. O motor respeita essa fixação ao regerar.',
        parameters: {
            type: 'object',
            properties: {
                escala_id: { type: 'number' },
                colaborador_id: { type: 'number' },
                data: { type: 'string', description: 'YYYY-MM-DD' },
                status: { type: 'string', description: 'TRABALHO | FOLGA | INDISPONIVEL' }
            },
            required: ['escala_id', 'colaborador_id', 'data', 'status']
        }
    },
    {
        name: 'oficializar_escala',
        description: 'Trava a escala como OFICIAL. Só é possível quando violacoes_hard = 0.',
        parameters: {
            type: 'object',
            properties: {
                escala_id: { type: 'number' }
            },
            required: ['escala_id']
        }
    },
    {
        name: 'preflight',
        description: 'Verifica viabilidade ANTES de gerar escala. Retorna blockers e warnings. Use o setor_id do auto-contexto. Exemplo: preflight({"setor_id": 3, "data_inicio": "2026-03-01", "data_fim": "2026-03-31"}).',
        parameters: {
            type: 'object',
            properties: {
                setor_id: { type: 'number' },
                data_inicio: { type: 'string' },
                data_fim: { type: 'string' }
            },
            required: ['setor_id', 'data_inicio', 'data_fim']
        }
    },
    {
        name: 'resumo_sistema',
        description: 'Relatório gerencial rápido: total de setores, colaboradores, escalas por status. Use quando o usuário quer visão geral ou quando não tem auto-contexto suficiente.',
        parameters: { type: 'object', properties: {} }
    },
    {
        name: 'explicar_violacao',
        description: 'Explica uma regra CLT/CCT ou antipadrão pelo código (ex: H1, H2, H14, S_DEFICIT, AP3).',
        parameters: {
            type: 'object',
            properties: {
                codigo_regra: { type: 'string', description: 'Ex: H1, H2, H14, S_DEFICIT, AP3, S_DOMINGO_CICLO' }
            },
            required: ['codigo_regra']
        }
    }
]

const ENTIDADES_LEITURA_PERMITIDAS = new Set([
    'colaboradores', 'setores', 'escalas', 'alocacoes', 'excecoes',
    'demandas', 'tipos_contrato', 'empresa', 'feriados', 'funcoes',
    'regra_definicao', 'regra_empresa',
])

const ENTIDADES_CRIACAO_PERMITIDAS = new Set([
    'colaboradores', 'excecoes', 'demandas', 'tipos_contrato', 'setores', 'feriados', 'funcoes',
])

const ENTIDADES_ATUALIZACAO_PERMITIDAS = new Set([
    'colaboradores', 'empresa', 'tipos_contrato', 'setores', 'demandas',
])

const ENTIDADES_DELECAO_PERMITIDAS = new Set([
    'excecoes', 'demandas', 'feriados', 'funcoes',
])

const DICIONARIO_VIOLACOES: Record<string, string> = {
    'H1': 'Máximo de dias consecutivos sem folga. Por padrão, limite de 6 dias (CLT Art. 67). Colaborador trabalhou mais dias seguidos do que o permitido pela regra H1.',
    'H2': 'Descanso interjornada mínimo de 11 horas obrigatório entre o fim de um turno e o início do próximo (CLT Art. 66). Esta regra é FIXA por lei e não pode ser desativada.',
    'H3': 'Descanso semanal remunerado mínimo de 24h consecutivas (CLT Art. 67). No EscalaFlow esta regra é SOFT — não bloqueia oficialização, mas penaliza a pontuação.',
    'H4': 'Jornada máxima diária incluindo horas extras (CLT Art. 59). Regra FIXA por lei.',
    'H5': 'Limite de horas extras semanais (CLT Art. 59). Regra FIXA por lei.',
    'H6': 'Horas semanais abaixo do mínimo do contrato. O colaborador está sendo escalado com menos horas do que previsto em seu contrato de trabalho.',
    'H10': 'Janela de horário do colaborador violada. O turno atribuído está fora da janela permitida (início mínimo/máximo ou fim mínimo/máximo configurados na regra individual do colaborador).',
    'H11': 'Menor aprendiz trabalhando em domingo ou feriado proibido. Vedado pelo ECA Art. 67.',
    'H12': 'Menor aprendiz em período noturno (entre 22h e 5h). Vedado pelo ECA Art. 67.',
    'H13': 'Estagiário excedendo limite de 6h/dia ou 30h/semana. Vedado pela Lei 11.788/2008.',
    'H14': 'Trabalho em feriado proibido por CCT. Os dias 25/12 (Natal) e 01/01 (Ano Novo) são hard-blocked por CCT FecomercioSP × FECOMERCIARIOS. Nenhum colaborador pode trabalhar nesses dias.',
    'H15': 'Restrição de tipo de trabalhador especial (regime diferenciado, noturno ou aprendiz).',
    'H16': 'Restrição de jornada para tipo de contrato com limite especial.',
    'H17': 'Restrição de hora extra para tipo de trabalhador não elegível a horas extras.',
    'H18': 'Restrição de feriado para tipo de trabalhador com proteção legal adicional.',
    'S_DEFICIT': 'Déficit de cobertura de demanda. A escala não atende o número mínimo de pessoas planejado em um ou mais slots de horário. Cada slot abaixo do mínimo penaliza a pontuação.',
    'S_DOMINGO_CICLO': 'Ciclo de domingos irregular. A meta padrão é 2 domingos trabalhados para cada 1 de folga. Desvios do ciclo configurado geram penalidade soft.',
    'S_TURNO_PREF': 'Preferência de turno do colaborador ignorada. O colaborador tem preferência de turno configurada (manhã/tarde/noite) e foi escalado fora dela.',
    'S_CONSISTENCIA': 'Inconsistência de horários entre dias da mesma semana. O colaborador tem horários muito variados ao longo da semana.',
    'S_SPREAD': 'Spread de jornada semanal desigual entre colaboradores do mesmo setor.',
    'AP1': 'Antipadrão: excesso de horas em um único dia (mais de 8h de trabalho efetivo).',
    'AP2': 'Antipadrão: almoços simultâneos — muitos colaboradores do mesmo setor almoçando no mesmo slot de horário.',
    'AP3': 'Antipadrão: almoço muito cedo ou muito tarde (fora da janela ideal 11h–14h).',
    'DIAS_TRABALHO': 'Dias de trabalho por semana abaixo ou acima do previsto no contrato (regime 5X2 ou 6X1).',
    'MIN_DIARIO': 'Jornada diária abaixo do mínimo configurado para o tipo de contrato.',
}

export async function executeTool(name: string, args: Record<string, any>): Promise<any> {
    const db = getDb()

    if (name === 'consultar') {
        const { entidade, filtros } = args

        if (!ENTIDADES_LEITURA_PERMITIDAS.has(entidade)) {
            return { erro: `Entidade '${entidade}' não permitida. Use: ${[...ENTIDADES_LEITURA_PERMITIDAS].join(' | ')}` }
        }

        let query = `SELECT * FROM ${entidade}`
        const params: unknown[] = []

        if (filtros && Object.keys(filtros).length > 0) {
            const conditions = Object.entries(filtros).map(([k, v]) => {
                if (typeof v === 'string') return `${k} = ? COLLATE NOCASE`
                return `${k} = ?`
            })
            query += ' WHERE ' + conditions.join(' AND ')
            params.push(...Object.values(filtros))
        }

        try {
            return db.prepare(query).all(...params)
        } catch (e: any) {
            return { erro: e.message }
        }
    }

    if (name === 'criar') {
        const { entidade, dados } = args

        if (!ENTIDADES_CRIACAO_PERMITIDAS.has(entidade)) {
            return { erro: `Criação não permitida para '${entidade}'.` }
        }

        const keys = Object.keys(dados)
        const placeholders = keys.map(() => '?').join(', ')
        const values = Object.values(dados)

        try {
            const res = db.prepare(`INSERT INTO ${entidade} (${keys.join(', ')}) VALUES (${placeholders})`).run(...values)
            return { sucesso: true, id: res.lastInsertRowid }
        } catch (e: any) {
            return { erro: e.message }
        }
    }

    if (name === 'atualizar') {
        const { entidade, id, dados } = args

        if (!ENTIDADES_ATUALIZACAO_PERMITIDAS.has(entidade)) {
            return { erro: `Atualização não permitida para '${entidade}'. Para alterar regras, use a tool editar_regra.` }
        }

        const sets = Object.keys(dados).map((k: string) => `${k} = ?`).join(', ')
        const values = [...Object.values(dados), id]

        try {
            db.prepare(`UPDATE ${entidade} SET ${sets} WHERE id = ?`).run(...values)
            return { sucesso: true }
        } catch (e: any) {
            return { erro: e.message }
        }
    }

    if (name === 'deletar') {
        const { entidade, id } = args

        if (!ENTIDADES_DELECAO_PERMITIDAS.has(entidade)) {
            return { erro: `Deleção não permitida para '${entidade}'.` }
        }

        try {
            db.prepare(`DELETE FROM ${entidade} WHERE id = ?`).run(id)
            return { sucesso: true }
        } catch (e: any) {
            return { erro: e.message }
        }
    }

    if (name === 'editar_regra') {
        const { codigo, status } = args

        const validStatuses = ['HARD', 'SOFT', 'OFF', 'ON']
        if (!validStatuses.includes(status)) {
            return { erro: `Status '${status}' inválido. Use: HARD, SOFT, OFF ou ON.` }
        }

        const regra = db.prepare('SELECT codigo, nome, editavel FROM regra_definicao WHERE codigo = ?').get(codigo) as { codigo: string; nome: string; editavel: number } | undefined
        if (!regra) {
            return { erro: `Regra '${codigo}' não encontrada. Use consultar com entidade 'regra_definicao' para ver todas as regras disponíveis.` }
        }

        if (!regra.editavel) {
            return { erro: `Regra '${codigo}' (${regra.nome}) é fixa por lei (CLT/CCT) e não pode ser alterada. Regras editáveis incluem: H1, H6, H10, DIAS_TRABALHO, MIN_DIARIO e todas SOFT/ANTIPATTERN.` }
        }

        db.prepare(`INSERT OR REPLACE INTO regra_empresa (codigo, status) VALUES (?, ?)`).run(codigo, status)
        return {
            sucesso: true,
            mensagem: `Regra ${codigo} (${regra.nome}) alterada para ${status}. A próxima geração de escala usará esta configuração.`
        }
    }

    if (name === 'gerar_escala') {
        const { setor_id, data_inicio, data_fim, rules_override } = args

        try {
            const solverInput = buildSolverInput(setor_id, data_inicio, data_fim, undefined, {
                rulesOverride: rules_override,
            })
            const solverResult = await runSolver(solverInput, 60_000)

            if (!solverResult.sucesso || !solverResult.alocacoes || !solverResult.indicadores) {
                return {
                    sucesso: false,
                    status: solverResult.status,
                    diagnostico: solverResult.diagnostico,
                    erro: solverResult.erro?.mensagem ?? `Solver retornou ${solverResult.status}: impossível gerar escala com as restrições atuais.`,
                }
            }

            const escalaId = persistirSolverResult(setor_id, data_inicio, data_fim, solverResult)
            return {
                sucesso: true,
                escala_id: escalaId,
                status: solverResult.status,
                indicadores: solverResult.indicadores,
                violacoes_hard: solverResult.indicadores.violacoes_hard,
                violacoes_soft: solverResult.indicadores.violacoes_soft,
                cobertura_percent: solverResult.indicadores.cobertura_percent,
                pontuacao: solverResult.indicadores.pontuacao,
                diagnostico: solverResult.diagnostico,
            }
        } catch (e: any) {
            return { sucesso: false, erro: e.message }
        }
    }

    if (name === 'ajustar_alocacao') {
        const { escala_id, colaborador_id, data, status } = args

        const statusValidos = ['TRABALHO', 'FOLGA', 'INDISPONIVEL']
        if (!statusValidos.includes(status)) {
            return { erro: `Status '${status}' inválido. Use: TRABALHO | FOLGA | INDISPONIVEL` }
        }

        const existing = db.prepare(
            'SELECT id FROM alocacoes WHERE escala_id = ? AND colaborador_id = ? AND data = ?'
        ).get(escala_id, colaborador_id, data)

        if (!existing) {
            return { erro: `Alocação não encontrada para escala ${escala_id}, colaborador ${colaborador_id}, data ${data}.` }
        }

        try {
            db.prepare(
                'UPDATE alocacoes SET status = ? WHERE escala_id = ? AND colaborador_id = ? AND data = ?'
            ).run(status, escala_id, colaborador_id, data)
            return {
                sucesso: true,
                mensagem: `Alocação ajustada: colaborador ${colaborador_id} em ${data} → ${status}. Regenere a escala para que o motor respeite este ajuste.`
            }
        } catch (e: any) {
            return { erro: e.message }
        }
    }

    if (name === 'oficializar_escala') {
        const { escala_id } = args

        const escala = db.prepare('SELECT id, status, violacoes_hard FROM escalas WHERE id = ?').get(escala_id) as { id: number; status: string; violacoes_hard: number } | undefined
        if (!escala) {
            return { erro: `Escala ${escala_id} não encontrada.` }
        }
        if (escala.status === 'OFICIAL') {
            return { aviso: `Escala ${escala_id} já está OFICIAL.` }
        }
        if (escala.violacoes_hard > 0) {
            return {
                erro: `Não é possível oficializar: a escala tem ${escala.violacoes_hard} violação(ões) HARD. Corrija as violações antes de oficializar.`
            }
        }

        db.prepare("UPDATE escalas SET status = 'OFICIAL' WHERE id = ?").run(escala_id)
        return { sucesso: true, mensagem: `Escala ${escala_id} oficializada com sucesso. Ela está travada definitivamente.` }
    }

    if (name === 'preflight') {
        const { setor_id, data_inicio, data_fim } = args
        const blockers: Array<{ codigo: string; severidade: string; mensagem: string; detalhe?: string }> = []
        const warnings: Array<{ codigo: string; severidade: string; mensagem: string; detalhe?: string }> = []

        const setor = db.prepare('SELECT id, ativo FROM setores WHERE id = ?').get(setor_id) as { id: number; ativo: number } | undefined
        if (!setor || setor.ativo !== 1) {
            blockers.push({
                codigo: 'SETOR_INVALIDO',
                severidade: 'BLOCKER',
                mensagem: `Setor ${setor_id} não encontrado ou inativo.`
            })
        }

        const colabsAtivos = (
            db.prepare('SELECT COUNT(*) as count FROM colaboradores WHERE setor_id = ? AND ativo = 1').get(setor_id) as { count: number }
        ).count
        if (colabsAtivos === 0) {
            blockers.push({
                codigo: 'SEM_COLABORADORES',
                severidade: 'BLOCKER',
                mensagem: 'Setor não tem colaboradores ativos.',
                detalhe: 'Cadastre ao menos 1 colaborador para gerar escala.'
            })
        }

        const demandasCount = (
            db.prepare('SELECT COUNT(*) as count FROM demandas WHERE setor_id = ?').get(setor_id) as { count: number }
        ).count
        if (demandasCount === 0) {
            warnings.push({
                codigo: 'SEM_DEMANDA',
                severidade: 'WARNING',
                mensagem: 'Setor sem demanda planejada cadastrada.',
                detalhe: 'O motor vai considerar demanda zero — todos os slots serão de livre distribuição.'
            })
        }

        const feriadosNoPeriodo = (
            db.prepare('SELECT COUNT(*) as count FROM feriados WHERE data BETWEEN ? AND ?').get(data_inicio, data_fim) as { count: number }
        ).count

        return {
            ok: blockers.length === 0,
            blockers,
            warnings,
            summary: {
                setor_id,
                data_inicio,
                data_fim,
                colaboradores_ativos: colabsAtivos,
                demandas_cadastradas: demandasCount,
                feriados_no_periodo: feriadosNoPeriodo,
            },
        }
    }

    if (name === 'resumo_sistema') {
        const colabs = (db.prepare('SELECT count(*) as c FROM colaboradores WHERE ativo = 1').get() as any).c
        const setores = (db.prepare('SELECT count(*) as c FROM setores WHERE ativo = 1').get() as any).c
        const rascunhos = (db.prepare("SELECT count(*) as c FROM escalas WHERE status = 'RASCUNHO'").get() as any).c
        const oficiais = (db.prepare("SELECT count(*) as c FROM escalas WHERE status = 'OFICIAL'").get() as any).c
        const regrasCustomizadas = (db.prepare('SELECT count(*) as c FROM regra_empresa').get() as any).c
        return {
            setores_ativos: setores,
            colaboradores_ativos: colabs,
            escalas_rascunho: rascunhos,
            escalas_oficiais: oficiais,
            regras_customizadas_pela_empresa: regrasCustomizadas,
        }
    }

    if (name === 'explicar_violacao') {
        const { codigo_regra } = args
        const explicacao = DICIONARIO_VIOLACOES[codigo_regra]
        if (explicacao) {
            return { codigo: codigo_regra, explicacao }
        }
        const regra = db.prepare('SELECT nome, descricao FROM regra_definicao WHERE codigo = ?').get(codigo_regra) as { nome: string; descricao: string } | undefined
        if (regra) {
            return { codigo: codigo_regra, explicacao: `${regra.nome}: ${regra.descricao}` }
        }
        return { codigo: codigo_regra, explicacao: 'Regra não encontrada no dicionário. Consulte o MOTOR_V3_RFC.md para a lista completa de regras CLT/CCT aplicáveis.' }
    }

    return { erro: `Tool '${name}' não reconhecida.` }
}
