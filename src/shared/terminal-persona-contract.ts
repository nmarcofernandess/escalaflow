export type TerminalIaPersona = 'rh_final' | 'admin' | 'dev' | 'support'

export const TERMINAL_IA_PERSONA_STORAGE_KEY = 'escalaflow.terminalIa.persona'

export const TERMINAL_IA_ENABLED_PERSONAS: TerminalIaPersona[] = ['admin', 'dev', 'support']

export interface TerminalIaAccess {
  persona: TerminalIaPersona
  enabled: boolean
  reason: string
}

export function normalizeTerminalIaPersona(value: string | null | undefined): TerminalIaPersona {
  if (value === 'admin' || value === 'dev' || value === 'support') return value
  return 'rh_final'
}

export function getTerminalIaAccess(personaInput?: string | null): TerminalIaAccess {
  const persona = normalizeTerminalIaPersona(personaInput)
  const enabled = TERMINAL_IA_ENABLED_PERSONAS.includes(persona)
  return {
    persona,
    enabled,
    reason: enabled
      ? 'Terminal IA habilitado para admin/dev/suporte.'
      : 'Terminal IA oculto para RH final.',
  }
}
