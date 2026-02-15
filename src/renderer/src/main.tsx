import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { ThemeProvider } from 'next-themes'
import './index.css'
import { App } from './App'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" storageKey="escalaflow-theme">
      <HashRouter>
        <TooltipProvider delayDuration={0}>
          <App />
          <Toaster />
        </TooltipProvider>
      </HashRouter>
    </ThemeProvider>
  </StrictMode>,
)
