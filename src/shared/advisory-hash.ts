import type { EscalaAdvisoryInput } from './advisory-types'

/**
 * Deterministic hash of advisory input for change detection.
 * Works in both Node (main) and browser (renderer).
 * NOT cryptographic — just consistent change detection.
 */
export function computeAdvisoryInputHash(input: EscalaAdvisoryInput): string {
  const hashPayload = {
    setor_id: input.setor_id,
    data_inicio: input.data_inicio,
    data_fim: input.data_fim,
    pinned_folga_externo: [...input.pinned_folga_externo].sort(
      (a, b) => a.c - b.c || a.d - b.d || a.band - b.band,
    ),
    current_folgas: [...input.current_folgas]
      .sort((a, b) => a.colaborador_id - b.colaborador_id)
      .map((f) => ({
        colaborador_id: f.colaborador_id,
        fixa: f.fixa,
        variavel: f.variavel,
      })),
    demanda_preview: input.demanda_preview ?? null,
  }
  return hashString(JSON.stringify(hashPayload))
}

/** FNV-1a inspired 64-bit hash, returned as 16-char hex string. */
function hashString(str: string): string {
  let h1 = 0x811c9dc5 | 0
  let h2 = 0x01000193 | 0
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193)
    h2 = Math.imul(h2 ^ (c >>> 1), 0x811c9dc5)
  }
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0')
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0')
  return hex1 + hex2
}
