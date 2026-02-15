import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'

interface BreadcrumbEntry {
  label: string
  href?: string
}

export function PageHeader({
  breadcrumbs,
  actions,
}: {
  breadcrumbs: BreadcrumbEntry[]
  actions?: React.ReactNode
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)

  // Track navigation history length to enable/disable buttons
  useEffect(() => {
    // window.history.length > 1 means there's somewhere to go back
    setCanGoBack(window.history.length > 1)
    // We can't reliably detect forward history in SPA,
    // but we track it via a session counter
    const fwd = sessionStorage.getItem('ef-nav-forward')
    setCanGoForward(fwd ? parseInt(fwd) > 0 : false)
  }, [location])

  const goBack = useCallback(() => {
    // Track that we went back (so forward becomes available)
    const fwd = parseInt(sessionStorage.getItem('ef-nav-forward') ?? '0')
    sessionStorage.setItem('ef-nav-forward', String(fwd + 1))
    navigate(-1)
  }, [navigate])

  const goForward = useCallback(() => {
    const fwd = parseInt(sessionStorage.getItem('ef-nav-forward') ?? '0')
    if (fwd > 0) {
      sessionStorage.setItem('ef-nav-forward', String(fwd - 1))
    }
    navigate(1)
  }, [navigate])

  // Reset forward counter on fresh navigation (not back/forward)
  useEffect(() => {
    const handleClick = () => {
      // Any link click resets forward stack
      sessionStorage.setItem('ef-nav-forward', '0')
    }
    // Listen for popstate to differentiate back/forward from link clicks
    // We clear forward on regular navigations via a flag
    window.addEventListener('escalaflow:nav-link', handleClick)
    return () => window.removeEventListener('escalaflow:nav-link', handleClick)
  }, [])

  return (
    <header className="flex h-14 shrink-0 items-center gap-1 border-b bg-background px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mx-1 !h-4" />

      {/* Navigation arrows */}
      <div className="flex items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={!canGoBack}
              onClick={goBack}
            >
              <ChevronLeft className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Voltar</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={!canGoForward}
              onClick={goForward}
            >
              <ChevronRight className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Avancar</TooltipContent>
        </Tooltip>
      </div>

      <Separator orientation="vertical" className="mx-1 !h-4" />

      <Breadcrumb className="flex-1">
        <BreadcrumbList>
          {breadcrumbs.map((item, i) => {
            const isLast = i === breadcrumbs.length - 1
            return (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <BreadcrumbSeparator />}
                <BreadcrumbItem>
                  {isLast ? (
                    <BreadcrumbPage>{item.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link to={item.href ?? '#'}>{item.label}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </span>
            )
          })}
        </BreadcrumbList>
      </Breadcrumb>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  )
}
