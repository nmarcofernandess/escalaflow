import { describe, expect, it } from 'vitest'
import { routeFamilyTool } from '../../src/main/ia/tool-families'

describe('tool-families routing', () => {
  // ==================== consultar_contexto ====================

  describe('consultar_contexto', () => {
    it('routes setor to consultar with setores table', () => {
      const route = routeFamilyTool('consultar_contexto', {
        entidade: 'setor',
        filtros: { ativo: true },
      })
      expect(route.internalTool).toBe('consultar')
      expect(route.internalArgs.entidade).toBe('setores')
      expect(route.internalArgs.filtros).toEqual({ ativo: true })
    })

    it('routes colaborador with id to buscar_colaborador', () => {
      const route = routeFamilyTool('consultar_contexto', {
        entidade: 'colaborador',
        id: 42,
      })
      expect(route.internalTool).toBe('buscar_colaborador')
      expect(route.internalArgs.id).toBe(42)
    })

    it('routes colaborador without id to consultar with colaboradores table', () => {
      const route = routeFamilyTool('consultar_contexto', {
        entidade: 'colaborador',
        filtros: { setor_id: 3 },
      })
      expect(route.internalTool).toBe('consultar')
      expect(route.internalArgs.entidade).toBe('colaboradores')
      expect(route.internalArgs.filtros).toEqual({ setor_id: 3 })
    })

    it('routes empresa to consultar', () => {
      const route = routeFamilyTool('consultar_contexto', {
        entidade: 'empresa',
      })
      expect(route.internalTool).toBe('consultar')
      expect(route.internalArgs.entidade).toBe('empresa')
    })

    it('routes escala with id to consultar with filtros.id', () => {
      const route = routeFamilyTool('consultar_contexto', {
        entidade: 'escala',
        id: 15,
      })
      expect(route.internalTool).toBe('consultar')
      expect(route.internalArgs.entidade).toBe('escalas')
      expect(route.internalArgs.filtros).toEqual({ id: 15 })
    })

    it('routes regras to regra_empresa table', () => {
      const route = routeFamilyTool('consultar_contexto', {
        entidade: 'regras',
      })
      expect(route.internalTool).toBe('consultar')
      expect(route.internalArgs.entidade).toBe('regra_empresa')
    })

    it('routes contrato to tipos_contrato table', () => {
      const route = routeFamilyTool('consultar_contexto', {
        entidade: 'contrato',
      })
      expect(route.internalTool).toBe('consultar')
      expect(route.internalArgs.entidade).toBe('tipos_contrato')
    })

    it('routes feriados to feriados table', () => {
      const route = routeFamilyTool('consultar_contexto', {
        entidade: 'feriados',
      })
      expect(route.internalTool).toBe('consultar')
      expect(route.internalArgs.entidade).toBe('feriados')
    })

    it('routes excecoes to excecoes table', () => {
      const route = routeFamilyTool('consultar_contexto', {
        entidade: 'excecoes',
        filtros: { colaborador_id: 5 },
      })
      expect(route.internalTool).toBe('consultar')
      expect(route.internalArgs.entidade).toBe('excecoes')
      expect(route.internalArgs.filtros).toEqual({ colaborador_id: 5 })
    })

    it('routes conhecimento to buscar_conhecimento', () => {
      const route = routeFamilyTool('consultar_contexto', {
        entidade: 'conhecimento',
        filtros: { consulta: 'CLT hora extra' },
      })
      expect(route.internalTool).toBe('buscar_conhecimento')
      expect(route.internalArgs.consulta).toBe('CLT hora extra')
    })

    it('routes conhecimento with query alias', () => {
      const route = routeFamilyTool('consultar_contexto', {
        entidade: 'conhecimento',
        filtros: { query: 'interjornada 11h' },
      })
      expect(route.internalTool).toBe('buscar_conhecimento')
      expect(route.internalArgs.consulta).toBe('interjornada 11h')
    })

    it('routes conhecimento with limite', () => {
      const route = routeFamilyTool('consultar_contexto', {
        entidade: 'conhecimento',
        filtros: { consulta: 'ferias', limite: 5 },
      })
      expect(route.internalTool).toBe('buscar_conhecimento')
      expect(route.internalArgs.consulta).toBe('ferias')
      expect(route.internalArgs.limite).toBe(5)
    })

    it('merges id into filtros for non-colaborador entities', () => {
      const route = routeFamilyTool('consultar_contexto', {
        entidade: 'setor',
        id: 7,
        filtros: { ativo: true },
      })
      expect(route.internalTool).toBe('consultar')
      expect(route.internalArgs.filtros).toEqual({ ativo: true, id: 7 })
    })
  })

  // ==================== editar_ficha ====================

  describe('editar_ficha', () => {
    it('routes new colaborador (no id) to criar', () => {
      const route = routeFamilyTool('editar_ficha', {
        entidade: 'colaborador',
        operacao: 'criar',
        dados: { nome: 'Maria', setor_id: 2 },
      })
      expect(route.internalTool).toBe('criar')
      expect(route.internalArgs.entidade).toBe('colaboradores')
      expect(route.internalArgs.dados).toEqual({ nome: 'Maria', setor_id: 2 })
    })

    it('routes existing colaborador (with id) to atualizar', () => {
      const route = routeFamilyTool('editar_ficha', {
        entidade: 'colaborador',
        id: 10,
        operacao: 'atualizar',
        dados: { nome: 'Maria Silva' },
      })
      expect(route.internalTool).toBe('atualizar')
      expect(route.internalArgs.entidade).toBe('colaboradores')
      expect(route.internalArgs.id).toBe(10)
      expect(route.internalArgs.dados).toEqual({ nome: 'Maria Silva' })
    })

    it('routes remover to deletar', () => {
      const route = routeFamilyTool('editar_ficha', {
        entidade: 'excecao',
        id: 5,
        operacao: 'remover',
        dados: {},
      })
      expect(route.internalTool).toBe('deletar')
      expect(route.internalArgs.entidade).toBe('excecoes')
      expect(route.internalArgs.id).toBe(5)
    })

    it('routes posto to salvar_posto_setor', () => {
      const route = routeFamilyTool('editar_ficha', {
        entidade: 'posto',
        operacao: 'criar',
        dados: { setor_id: 2, apelido: 'Caixa 1', tipo_contrato_id: 1 },
      })
      expect(route.internalTool).toBe('salvar_posto_setor')
      expect(route.internalArgs.setor_id).toBe(2)
      expect(route.internalArgs.apelido).toBe('Caixa 1')
    })

    it('routes posto with id to salvar_posto_setor with id', () => {
      const route = routeFamilyTool('editar_ficha', {
        entidade: 'posto',
        id: 3,
        operacao: 'atualizar',
        dados: { apelido: 'Caixa 2' },
      })
      expect(route.internalTool).toBe('salvar_posto_setor')
      expect(route.internalArgs.id).toBe(3)
      expect(route.internalArgs.apelido).toBe('Caixa 2')
    })

    it('routes posto remover to deletar funcoes', () => {
      const route = routeFamilyTool('editar_ficha', {
        entidade: 'posto',
        id: 5,
        operacao: 'remover',
        dados: {},
      })
      expect(route.internalTool).toBe('deletar')
      expect(route.internalArgs.entidade).toBe('funcoes')
      expect(route.internalArgs.id).toBe(5)
    })

    it('routes regra to editar_regra', () => {
      const route = routeFamilyTool('editar_ficha', {
        entidade: 'regra',
        id: 12,
        operacao: 'atualizar',
        dados: { ativo: false },
      })
      expect(route.internalTool).toBe('editar_regra')
      expect(route.internalArgs.id).toBe(12)
      expect(route.internalArgs.ativo).toBe(false)
    })

    it('routes regra_horario to salvar_regra_horario_colaborador', () => {
      const route = routeFamilyTool('editar_ficha', {
        entidade: 'regra_horario',
        operacao: 'criar',
        dados: { colaborador_id: 5, inicio: '08:00', fim: '17:00' },
      })
      expect(route.internalTool).toBe('salvar_regra_horario_colaborador')
      expect(route.internalArgs.colaborador_id).toBe(5)
      expect(route.internalArgs.inicio).toBe('08:00')
    })

    it('routes perfil_horario remover to deletar_perfil_horario', () => {
      const route = routeFamilyTool('editar_ficha', {
        entidade: 'perfil_horario',
        id: 8,
        operacao: 'remover',
        dados: {},
      })
      expect(route.internalTool).toBe('deletar_perfil_horario')
      expect(route.internalArgs.id).toBe(8)
    })

    it('routes perfil_horario criar/atualizar to salvar_perfil_horario', () => {
      const route = routeFamilyTool('editar_ficha', {
        entidade: 'perfil_horario',
        operacao: 'criar',
        dados: { tipo_contrato_id: 1, nome: 'Manha', inicio: '06:00', fim: '14:00' },
      })
      expect(route.internalTool).toBe('salvar_perfil_horario')
      expect(route.internalArgs.tipo_contrato_id).toBe(1)
      expect(route.internalArgs.nome).toBe('Manha')
    })

    it('routes horario_funcionamento to configurar_horario_funcionamento', () => {
      const route = routeFamilyTool('editar_ficha', {
        entidade: 'horario_funcionamento',
        operacao: 'atualizar',
        dados: { dia_semana: 'SAB', hora_fechamento: '20:00' },
      })
      expect(route.internalTool).toBe('configurar_horario_funcionamento')
      expect(route.internalArgs.dia_semana).toBe('SAB')
    })

    it('routes demanda with data_especifica to salvar_demanda_excecao_data', () => {
      const route = routeFamilyTool('editar_ficha', {
        entidade: 'demanda',
        operacao: 'criar',
        dados: { data_especifica: '2026-11-27', setor_id: 2, min_pessoas: 8 },
      })
      expect(route.internalTool).toBe('salvar_demanda_excecao_data')
      expect(route.internalArgs.data_especifica).toBe('2026-11-27')
    })

    it('routes excecao with data_especifica to upsert_regra_excecao_data', () => {
      const route = routeFamilyTool('editar_ficha', {
        entidade: 'excecao',
        operacao: 'criar',
        dados: { data_especifica: '2026-04-01', colaborador_id: 3, inicio: '10:00' },
      })
      expect(route.internalTool).toBe('upsert_regra_excecao_data')
      expect(route.internalArgs.data_especifica).toBe('2026-04-01')
    })

    it('routes generic demanda without data_especifica to criar', () => {
      const route = routeFamilyTool('editar_ficha', {
        entidade: 'demanda',
        operacao: 'criar',
        dados: { setor_id: 2, dia_semana: 'SEG', hora_inicio: '08:00', hora_fim: '12:00', min_pessoas: 3 },
      })
      expect(route.internalTool).toBe('criar')
      expect(route.internalArgs.entidade).toBe('demandas')
    })

    it('defaults operacao to atualizar when id is present', () => {
      const route = routeFamilyTool('editar_ficha', {
        entidade: 'colaborador',
        id: 10,
        dados: { nome: 'Test' },
      })
      // operacao defaults to 'atualizar', id present -> atualizar
      expect(route.internalTool).toBe('atualizar')
    })
  })

  // ==================== executar_acao ====================

  describe('executar_acao', () => {
    it('routes gerar_escala', () => {
      const route = routeFamilyTool('executar_acao', {
        acao: 'gerar_escala',
        args: { setor_id: 3, data_inicio: '2026-03-01', data_fim: '2026-03-31' },
      })
      expect(route.internalTool).toBe('gerar_escala')
      expect(route.internalArgs.setor_id).toBe(3)
    })

    it('routes oficializar to oficializar_escala', () => {
      const route = routeFamilyTool('executar_acao', {
        acao: 'oficializar',
        args: { escala_id: 15 },
      })
      expect(route.internalTool).toBe('oficializar_escala')
      expect(route.internalArgs.escala_id).toBe(15)
    })

    it('routes ajustar_celula to ajustar_alocacao', () => {
      const route = routeFamilyTool('executar_acao', {
        acao: 'ajustar_celula',
        args: { escala_id: 15, colaborador_id: 5, data: '2026-03-10', status: 'TRABALHA' },
      })
      expect(route.internalTool).toBe('ajustar_alocacao')
    })

    it('routes diagnosticar to diagnosticar_escala', () => {
      const route = routeFamilyTool('executar_acao', {
        acao: 'diagnosticar',
        args: { escala_id: 15 },
      })
      expect(route.internalTool).toBe('diagnosticar_escala')
    })

    it('routes preflight', () => {
      const route = routeFamilyTool('executar_acao', {
        acao: 'preflight',
        args: { setor_id: 3, data_inicio: '2026-03-01', data_fim: '2026-03-31' },
      })
      expect(route.internalTool).toBe('preflight')
    })

    it('routes backup to fazer_backup', () => {
      const route = routeFamilyTool('executar_acao', {
        acao: 'backup',
        args: {},
      })
      expect(route.internalTool).toBe('fazer_backup')
    })

    it('routes resetar_regras to resetar_regras_empresa', () => {
      const route = routeFamilyTool('executar_acao', {
        acao: 'resetar_regras',
        args: { confirmar: true },
      })
      expect(route.internalTool).toBe('resetar_regras_empresa')
      expect(route.internalArgs.confirmar).toBe(true)
    })

    it('routes cadastrar_lote', () => {
      const route = routeFamilyTool('executar_acao', {
        acao: 'cadastrar_lote',
        args: { entidade: 'colaboradores', registros: [] },
      })
      expect(route.internalTool).toBe('cadastrar_lote')
    })

    it('routes resumir_horas to resumir_horas_setor', () => {
      const route = routeFamilyTool('executar_acao', {
        acao: 'resumir_horas',
        args: { setor_id: 2, data_inicio: '2026-03-01', data_fim: '2026-03-31' },
      })
      expect(route.internalTool).toBe('resumir_horas_setor')
    })

    it('returns UNKNOWN for invalid action', () => {
      const route = routeFamilyTool('executar_acao', {
        acao: 'nao_existe',
        args: {},
      })
      expect(route.internalTool).toBe('UNKNOWN')
    })
  })

  // ==================== memoria via editar_ficha ====================

  describe('memoria via editar_ficha', () => {
    it('routes memoria criar to salvar_memoria', () => {
      const route = routeFamilyTool('editar_ficha', {
        entidade: 'memoria',
        operacao: 'criar',
        dados: { conteudo: 'Cleunice não pode sábado' },
      })
      expect(route.internalTool).toBe('salvar_memoria')
      expect(route.internalArgs.conteudo).toBe('Cleunice não pode sábado')
    })

    it('routes memoria remover to remover_memoria', () => {
      const route = routeFamilyTool('editar_ficha', {
        entidade: 'memoria',
        id: 5,
        operacao: 'remover',
        dados: {},
      })
      expect(route.internalTool).toBe('remover_memoria')
      expect(route.internalArgs.id).toBe(5)
    })

    it('routes memoria remover without dados to remover_memoria', () => {
      const route = routeFamilyTool('editar_ficha', {
        entidade: 'memoria',
        id: 5,
        operacao: 'remover',
      })
      expect(route.internalTool).toBe('remover_memoria')
      expect(route.internalArgs.id).toBe(5)
    })

    it('routes memoria atualizar to salvar_memoria with id', () => {
      const route = routeFamilyTool('editar_ficha', {
        entidade: 'memoria',
        id: 3,
        operacao: 'atualizar',
        dados: { conteudo: 'Updated memory' },
      })
      expect(route.internalTool).toBe('salvar_memoria')
      expect(route.internalArgs.id).toBe(3)
      expect(route.internalArgs.conteudo).toBe('Updated memory')
    })

    it('routes memoria default operacao to salvar_memoria', () => {
      const route = routeFamilyTool('editar_ficha', {
        entidade: 'memoria',
        dados: { conteudo: 'Joao prefere manha' },
      })
      expect(route.internalTool).toBe('salvar_memoria')
      expect(route.internalArgs.conteudo).toBe('Joao prefere manha')
    })
  })

  // ==================== unknown family ====================

  describe('unknown family', () => {
    it('returns UNKNOWN for unrecognized family', () => {
      const route = routeFamilyTool('nao_existe', { foo: 'bar' })
      expect(route.internalTool).toBe('UNKNOWN')
    })
  })
})
