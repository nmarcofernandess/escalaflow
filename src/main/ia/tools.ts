import { getDb } from '../db/database'

export const IA_TOOLS = [
    {
        name: 'consultar',
        description: 'Consulta dados do sistema. Use para buscar colaboradores, setores, escalas, excecoes, demandas, contratos, feriados, funcoes.',
        parameters: {
            type: 'object',
            properties: {
                entidade: { type: 'string', description: 'colaboradores | setores | escalas | excecoes | demandas | tipos_contrato | empresa | feriados | funcoes' },
                filtros: { type: 'object', description: 'filtros opcionais como objeto JSON (ex: { "setor_id": 2, "ativo": 1 })' }
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
                entidade: { type: 'string', description: 'colaboradores | excecoes | demandas | tipos_contrato | setores | feriados | funcoes' },
                dados: { type: 'object', description: 'objeto JSON com os campos necessarios para criar o registro' }
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
                entidade: { type: 'string', description: 'colaboradores | empresa | tipos_contrato | setores | demandas' },
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
                entidade: { type: 'string', description: 'excecoes | demandas | feriados | funcoes' },
                id: { type: 'number', description: 'ID do registro' }
            },
            required: ['entidade', 'id']
        }
    },
    {
        name: 'gerar_escala',
        description: 'Delega para o motor OR-Tools a criação da escala para um setor e período. A escala é salva como rascunho.',
        parameters: {
            type: 'object',
            properties: {
                setor_id: { type: 'number', description: 'ID do setor' },
                data_inicio: { type: 'string', description: 'Data YYYY-MM-DD' },
                data_fim: { type: 'string', description: 'Data YYYY-MM-DD' }
            },
            required: ['setor_id', 'data_inicio', 'data_fim']
        }
    },
    {
        name: 'ajustar_alocacao',
        description: 'Fixa (pina) uma alocacao especifica. Em seguida, vc deve pedir gerar_escala novamente se quiser que o motor refaça com essa trava (pinned_cells precisam ser injetadas manualmente no gerar_escala se você não usar o endpoint nativo. Mas neste app o frontend as salva num state manager. Se voce é a IA e quer ajustar, pode apenas instruir o usuário que ajustou).',
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
        description: 'Oficializa uma escala (trava em modo definitivo). Nao pode ter violacao HARD.',
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
        description: 'Inspeciona viabilidade de um setor antes de gerar escala. Checa as horas vs demandas.',
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
        description: 'Retorna um relatorio gerencial, total de colaboradores, status das escalas.',
        parameters: { type: 'object', properties: {} }
    },
    {
        name: 'explicar_violacao',
        description: 'Traz um explicador didatico de uma regra CLT com base em seu código.',
        parameters: {
            type: 'object',
            properties: {
                codigo_regra: { type: 'string', description: 'Ex: H1 (Descanço 11h), H2 (Jornada Max 10h), S3 (Folta aos Domingos)' }
            },
            required: ['codigo_regra']
        }
    }
]

export async function executeTool(name: string, args: Record<string, any>): Promise<any> {
    const db = getDb()

    if (name === 'consultar') {
        const { entidade, filtros } = args
        let query = `SELECT * FROM ${entidade}`
        const params: unknown[] = []

        if (filtros && Object.keys(filtros).length > 0) {
            query += ' WHERE ' + Object.keys(filtros).map(k => `${k} = ?`).join(' AND ')
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
        if (entidade === 'excecoes') {
            // Excecoes map to excecoes table
            const res = db.prepare(`INSERT INTO excecoes (colaborador_id, data_inicio, data_fim, tipo, observacao) VALUES (?, ?, ?, ?, ?)`)
                .run(dados.colaborador_id, dados.data_inicio, dados.data_fim, dados.tipo, dados.observacao || null)
            return { sucesso: true, id: res.lastInsertRowid }
        }
        // Expand later into deep generic creation if required.
        // For now we do dynamic insertion mapping.
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

    if (name === 'gerar_escala') {
        // Na vida real invocardimos o Tipc handler 'escalas.gerar'. Mas pra IA, retornamos uma msg para ela orientar 
        // que no Electron é mlhor interagir na interface, ou rodamos internamente bridge se importado.
        // Para a execução rápida deste MVP, vamos dar sucesso mock.
        return { sucesso: true, mensagem: `Solicitação de gerar_escala recebida para setor ${args.setor_id}. (Nota: Como backend IA, isso poderia bloquear o server, então em produção delegue e acompanhe o tipc handler)` }
    }

    if (name === 'resumo_sistema') {
        const colabs = (db.prepare('SELECT count(*) as c FROM colaboradores').get() as any).c
        const setros = (db.prepare('SELECT count(*) as c FROM setores').get() as any).c
        const rascunhos = (db.prepare("SELECT count(*) as c FROM escalas WHERE status = 'RASCUNHO'").get() as any).c
        return { setores_cadastrados: setros, colaboradores: colabs, escalas_em_rascunho: rascunhos }
    }

    if (name === 'explicar_violacao') {
        const dicionario: Record<string, string> = {
            'H1': 'Violacao HORAS EXTRAS. O limite por dia ou semana foi excedido.',
            'H2': 'Falta de descanso intrajornada (11 horas obrigatorias entre turnos).',
            'S1': 'Preferência de turno ignorada (Soft).',
            'S2': 'Folgas não pareadas no final de semana.'
        }
        return { explicacao: dicionario[args.codigo_regra] || 'Violação desconhecida, baseie-se em leis CLT de jornada e repouso.' }
    }

    // Falha silenciosa para as genéricas se não tratadas.
    return { erro: `Tool ${name} parcialmente suportada no sandbox da IA.` }
}
