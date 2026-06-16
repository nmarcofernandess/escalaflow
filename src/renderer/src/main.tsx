import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { ThemeProvider } from 'next-themes'
import './index.css'
// Streamdown (AI Elements): animações de streaming (data-sd-animate) + CSS do KaTeX (math).
import 'streamdown/styles.css'
import 'katex/dist/katex.min.css'
import { router } from './App'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" storageKey="escalaflow-theme">
      <TooltipProvider delayDuration={0}>
        <RouterProvider router={router} />
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
)
