import React from 'react'
import logoIcon from '@/assets/logo.png'

/**
 * Branding centralizado para EscalaFlow.
 * Usado pelo SetupWizard (pétreo copiado do FlowKit) e sidebar/onboarding.
 * Mantém zero hardcode de nome no código de onboarding genérico.
 */
export const APP_NAME = 'EscalaFlow'
export const APP_DESCRIPTION = 'Escalas CLT automáticas com IA e motor OR-Tools (100% offline)'
export const APP_INITIALS = 'EF'

export const AppLogo: React.FC<{ className?: string }> = ({ className }) => (
  <img
    src={logoIcon}
    alt="EscalaFlow"
    className={className}
    style={{ objectFit: 'contain' }}
  />
)

export const APP_ICON = AppLogo
