export interface LocalModelUiInfo {
  id: string
  baixado: boolean
  usable?: boolean
  requires_validation?: boolean
  load_error?: string
  download_status?: 'idle' | 'downloading' | 'cancelled' | 'failed' | 'done'
}

export interface LocalModelAvailability {
  installedIds: Set<string>
  usableIds: Set<string>
  hasInstalled: boolean
  hasUsable: boolean
  selectedInstalled: boolean
  selectedUsable: boolean
  reason?: string
}

export function getLocalModelAvailability(
  models: LocalModelUiInfo[],
  selectedModelId?: string,
): LocalModelAvailability {
  const installedIds = new Set(models.filter((model) => model.baixado).map((model) => model.id))
  const usableIds = new Set(models.filter((model) => model.baixado && model.usable).map((model) => model.id))
  const selected = selectedModelId
    ? models.find((model) => model.id === selectedModelId)
    : undefined

  const reason = (() => {
    if (!installedIds.size) return 'Nenhum modelo local instalado.'
    if (selected?.load_error) return `Modelo local falhou ao carregar: ${selected.load_error}`
    if (selected?.requires_validation) return 'Modelo local instalado, mas precisa passar em Testar conexao.'
    if (!usableIds.size) return 'Modelo local instalado, mas ainda nao foi validado.'
    return undefined
  })()

  return {
    installedIds,
    usableIds,
    hasInstalled: installedIds.size > 0,
    hasUsable: usableIds.size > 0,
    selectedInstalled: selectedModelId ? installedIds.has(selectedModelId) : installedIds.size > 0,
    selectedUsable: selectedModelId ? usableIds.has(selectedModelId) : usableIds.size > 0,
    reason,
  }
}

export function getLocalModelCardState(model: LocalModelUiInfo): {
  label: string
  tone: 'ready' | 'warning' | 'error' | 'installed' | 'missing'
  detail?: string
} {
  if (model.download_status === 'downloading') return { label: 'Baixando', tone: 'installed' }
  if (model.download_status === 'failed') {
    return {
      label: 'Falhou',
      tone: 'error',
      detail: model.load_error || 'O download falhou. Tente baixar novamente.',
    }
  }
  if (!model.baixado) return { label: 'Nao instalado', tone: 'missing' }
  if (model.load_error) return { label: 'Erro', tone: 'error', detail: model.load_error }
  if (model.usable) return { label: 'Pronto', tone: 'ready' }
  if (model.requires_validation) {
    return {
      label: 'Precisa testar',
      tone: 'warning',
      detail: 'Clique em Testar conexao antes de usar chat ou CLI.',
    }
  }
  return { label: 'Instalado', tone: 'installed', detail: 'Ainda nao validado para chat.' }
}
