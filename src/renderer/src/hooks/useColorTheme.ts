import { useState, useEffect, useCallback } from 'react'

export type ColorTheme = 'zinc' | 'blue' | 'violet'

const STORAGE_KEY = 'escalaflow-color-theme'
const VALID_THEMES: ColorTheme[] = ['zinc', 'blue', 'violet']

export function useColorTheme() {
  const [colorTheme, setColorThemeState] = useState<ColorTheme>('zinc')

  // Apply theme to DOM
  const applyTheme = useCallback((theme: ColorTheme) => {
    if (theme === 'zinc') {
      document.documentElement.removeAttribute('data-color-theme')
    } else {
      document.documentElement.setAttribute('data-color-theme', theme)
    }
  }, [])

  // Initialize theme from localStorage on mount (migrate legacy 'green' → 'zinc' to avoid primary/success overlap)
  useEffect(() => {
    let savedTheme = localStorage.getItem(STORAGE_KEY)
    if (savedTheme === 'green') savedTheme = 'zinc'
    if (savedTheme && VALID_THEMES.includes(savedTheme as ColorTheme)) {
      const theme = savedTheme as ColorTheme
      setColorThemeState(theme)
      applyTheme(theme)
      if (savedTheme === 'zinc') localStorage.removeItem(STORAGE_KEY)
    }
  }, [applyTheme])

  // Set theme with persistence
  const setColorTheme = useCallback(
    (theme: ColorTheme) => {
      applyTheme(theme)
      setColorThemeState(theme)
      if (theme === 'zinc') {
        localStorage.removeItem(STORAGE_KEY)
      } else {
        localStorage.setItem(STORAGE_KEY, theme)
      }
    },
    [applyTheme]
  )

  return { colorTheme, setColorTheme }
}
