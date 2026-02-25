import { create } from 'zustand'
import type { IaMensagem, IaConversa, ToolCall, IaStreamEvent } from '@shared/index'

function gerarTitulo(conteudo: string): string {
  const truncado = conteudo.slice(0, 50).trim()
  if (conteudo.length <= 50) return truncado
  const ultimoEspaco = truncado.lastIndexOf(' ')
  return (ultimoEspaco > 0 ? truncado.slice(0, ultimoEspaco) : truncado) + '...'
}

interface IaStore {
  // Painel
  aberto: boolean
  setAberto: (v: boolean) => void
  toggleAberto: () => void

  // View interna
  tela: 'chat' | 'historico'
  setTela: (t: 'chat' | 'historico') => void

  // Conversa ativa
  conversa_ativa_id: string | null
  conversa_ativa_titulo: string
  mensagens: IaMensagem[]
  carregando: boolean
  setCarregando: (v: boolean) => void

  // Lista de conversas
  conversas: IaConversa[]
  busca_titulo: string
  setBuscaTitulo: (b: string) => void

  // Streaming (transient — nunca persistido)
  stream_id_ativo: string | null
  texto_parcial: string
  tool_calls_parciais: ToolCall[]
  tools_em_andamento: Record<string, { tool_name: string; args?: Record<string, unknown>; estimated_seconds?: number; started_at: number }>

  // Streaming actions
  iniciarStream: (streamId: string) => void
  processarStreamEvent: (event: IaStreamEvent) => void
  finalizarStream: () => void
  cancelarStream: () => void

  // Flag de inicialização (para não repetir ao reabrir)
  _inicializado: boolean

  // Ações
  inicializar: () => Promise<void>
  novaConversa: () => Promise<void>
  carregarConversa: (id: string) => Promise<void>
  adicionarMensagem: (msg: IaMensagem, options?: { mensagemPersistida?: IaMensagem }) => Promise<void>
  listarConversas: () => Promise<void>
  arquivarConversa: (id: string) => Promise<void>
  restaurarConversa: (id: string) => Promise<void>
  deletarConversa: (id: string) => Promise<void>
  renomearConversa: (id: string, titulo: string) => Promise<void>
  arquivarTodas: () => Promise<void>
  deletarArquivadas: () => Promise<void>
  editarEReenviar: (msgId: string, novoConteudo: string) => Promise<string | null>
}

const ipc = window.electron.ipcRenderer

export const useIaStore = create<IaStore>((set, get) => ({
  aberto: false,
  setAberto: (aberto) => set({ aberto }),
  toggleAberto: () => set((state) => ({ aberto: !state.aberto })),

  tela: 'chat',
  setTela: (tela) => set({ tela }),

  conversa_ativa_id: null,
  conversa_ativa_titulo: 'Nova conversa',
  mensagens: [],
  carregando: false,
  setCarregando: (carregando) => set({ carregando }),

  conversas: [],
  busca_titulo: '',
  setBuscaTitulo: (busca_titulo) => set({ busca_titulo }),

  // Streaming defaults
  stream_id_ativo: null,
  texto_parcial: '',
  tool_calls_parciais: [],
  tools_em_andamento: {},

  iniciarStream: (streamId) => set({
    stream_id_ativo: streamId,
    texto_parcial: '',
    tool_calls_parciais: [],
    tools_em_andamento: {},
    carregando: true,
  }),

  processarStreamEvent: (event) => {
    const { stream_id_ativo } = get()
    if (event.stream_id !== stream_id_ativo) return

    switch (event.type) {
      case 'text-delta':
        set((s) => ({ texto_parcial: s.texto_parcial + event.delta }))
        break

      case 'tool-call-start':
        set((s) => ({
          tools_em_andamento: {
            ...s.tools_em_andamento,
            [event.tool_call_id]: {
              tool_name: event.tool_name,
              args: event.args,
              estimated_seconds: event.estimated_seconds,
              started_at: Date.now(),
            },
          },
        }))
        break

      case 'tool-result': {
        set((s) => {
          const { [event.tool_call_id]: _removed, ...rest } = s.tools_em_andamento
          return {
            tools_em_andamento: rest,
            tool_calls_parciais: [
              ...s.tool_calls_parciais,
              {
                id: event.tool_call_id,
                name: event.tool_name,
                result: event.result,
              },
            ],
          }
        })
        break
      }

      case 'follow-up-start':
        // Reset text for follow-up — tools already captured
        set({ texto_parcial: '' })
        break

      case 'step-finish':
        // Informational — no state change needed
        break

      case 'finish':
      case 'error':
        // Handled by IaChatView's then/catch on the invoke
        break
    }
  },

  finalizarStream: () => set({
    stream_id_ativo: null,
    texto_parcial: '',
    tool_calls_parciais: [],
    tools_em_andamento: {},
    carregando: false,
  }),

  cancelarStream: () => set({
    stream_id_ativo: null,
    texto_parcial: '',
    tool_calls_parciais: [],
    tools_em_andamento: {},
    carregando: false,
  }),

  _inicializado: false,

  inicializar: async () => {
    if (get()._inicializado) return
    set({ _inicializado: true })

    const ativas = (await ipc.invoke('ia.conversas.listar', { status: 'ativo' })) as IaConversa[]
    set({ conversas: ativas })

    if (ativas.length > 0) {
      const mais_recente = ativas[0]
      const { conversa, mensagens } = (await ipc.invoke('ia.conversas.obter', {
        id: mais_recente.id,
      })) as { conversa: IaConversa; mensagens: IaMensagem[] }
      set({
        conversa_ativa_id: conversa.id,
        conversa_ativa_titulo: conversa.titulo,
        mensagens,
      })
    } else {
      await get().novaConversa()
    }
  },

  novaConversa: async () => {
    // Process previous conversation in background (session indexing + extraction)
    const { conversa_ativa_id, mensagens } = get()
    if (conversa_ativa_id && mensagens.length >= 2) {
      ipc.invoke('ia.sessao.processar', { conversa_id: conversa_ativa_id }).catch(() => {})
    }

    // Limpa conversa vazia atual silenciosamente
    if (conversa_ativa_id && mensagens.length === 0) {
      await ipc.invoke('ia.conversas.deletar', { id: conversa_ativa_id }).catch(() => {})
    }

    const conversa = (await ipc.invoke('ia.conversas.criar', {})) as IaConversa
    set({
      conversa_ativa_id: conversa.id,
      conversa_ativa_titulo: conversa.titulo,
      mensagens: [],
      tela: 'chat',
    })

    // Atualiza lista
    await get().listarConversas()
  },

  carregarConversa: async (id: string) => {
    // Process previous conversation in background (session indexing + extraction)
    const { conversa_ativa_id, mensagens } = get()
    if (conversa_ativa_id && conversa_ativa_id !== id && mensagens.length >= 2) {
      ipc.invoke('ia.sessao.processar', { conversa_id: conversa_ativa_id }).catch(() => {})
    }

    // Limpa conversa vazia atual silenciosamente
    if (conversa_ativa_id && conversa_ativa_id !== id && mensagens.length === 0) {
      await ipc.invoke('ia.conversas.deletar', { id: conversa_ativa_id }).catch(() => {})
    }

    const { conversa, mensagens: msgs } = (await ipc.invoke('ia.conversas.obter', { id })) as {
      conversa: IaConversa
      mensagens: IaMensagem[]
    }
    set({
      conversa_ativa_id: conversa.id,
      conversa_ativa_titulo: conversa.titulo,
      mensagens: msgs,
      tela: 'chat',
    })
  },

  adicionarMensagem: async (msg: IaMensagem, options?: { mensagemPersistida?: IaMensagem }) => {
    const { conversa_ativa_id, mensagens } = get()
    if (!conversa_ativa_id) return

    // Auto-título na 1ª mensagem do usuário
    if (msg.papel === 'usuario' && mensagens.filter((m) => m.papel === 'usuario').length === 0) {
      const titulo = gerarTitulo(msg.conteudo)
      await ipc.invoke('ia.conversas.renomear', { id: conversa_ativa_id, titulo })
      set({ conversa_ativa_titulo: titulo })
    }

    set((state) => ({ mensagens: [...state.mensagens, msg] }))
    // Allows renderer flows to show richer data in-memory than what is persisted (ex.: tool outputs).
    await ipc.invoke('ia.mensagens.salvar', {
      conversa_id: conversa_ativa_id,
      mensagem: options?.mensagemPersistida ?? msg,
    })
  },

  listarConversas: async () => {
    const { busca_titulo } = get()
    const ativas = (await ipc.invoke('ia.conversas.listar', {
      status: 'ativo',
      busca: busca_titulo || undefined,
    })) as IaConversa[]
    const arquivadas = (await ipc.invoke('ia.conversas.listar', {
      status: 'arquivado',
      busca: busca_titulo || undefined,
    })) as IaConversa[]
    set({ conversas: [...ativas, ...arquivadas] })
  },

  arquivarConversa: async (id: string) => {
    await ipc.invoke('ia.conversas.arquivar', { id })

    // Se arquivou a conversa ativa, cria nova automaticamente
    if (get().conversa_ativa_id === id) {
      set({ conversa_ativa_id: null, mensagens: [] })
      await get().novaConversa() // novaConversa já chama listarConversas internamente
    } else {
      await get().listarConversas()
    }
  },

  restaurarConversa: async (id: string) => {
    await ipc.invoke('ia.conversas.restaurar', { id })
    await get().listarConversas()
  },

  deletarConversa: async (id: string) => {
    await ipc.invoke('ia.conversas.deletar', { id })

    // Se deletou a ativa, cria nova
    if (get().conversa_ativa_id === id) {
      set({ conversa_ativa_id: null, mensagens: [] })
      await get().novaConversa() // novaConversa já chama listarConversas internamente
    } else {
      await get().listarConversas()
    }
  },

  renomearConversa: async (id: string, titulo: string) => {
    await ipc.invoke('ia.conversas.renomear', { id, titulo })
    if (get().conversa_ativa_id === id) {
      set({ conversa_ativa_titulo: titulo })
    }
    await get().listarConversas()
  },

  arquivarTodas: async () => {
    await ipc.invoke('ia.conversas.arquivarTodas')
    // Se havia conversa ativa (foi arquivada), cria nova automaticamente
    if (get().conversa_ativa_id) {
      set({ conversa_ativa_id: null, mensagens: [] })
      await get().novaConversa() // novaConversa já chama listarConversas internamente
    } else {
      await get().listarConversas()
    }
  },

  deletarArquivadas: async () => {
    await ipc.invoke('ia.conversas.deletarArquivadas')
    await get().listarConversas()
  },

  editarEReenviar: async (msgId: string, novoConteudo: string) => {
    const { mensagens, conversa_ativa_id } = get()
    const msgIndex = mensagens.findIndex(m => m.id === msgId)
    if (msgIndex < 0 || !conversa_ativa_id) return null

    const msg = mensagens[msgIndex]

    // 1. Deletar msgs posteriores no DB
    await ipc.invoke('ia.mensagens.deletarApos', {
      conversa_id: conversa_ativa_id,
      timestamp: msg.timestamp,
    })

    // 2. Atualizar conteudo da msg no DB
    await ipc.invoke('ia.mensagens.atualizar', {
      id: msgId,
      conteudo: novoConteudo,
    })

    // 3. Atualizar state local — cortar mensagens e atualizar conteudo
    const novasMensagens = mensagens.slice(0, msgIndex)
    novasMensagens.push({ ...msg, conteudo: novoConteudo })
    set({ mensagens: novasMensagens })

    return novoConteudo
  },
}))
