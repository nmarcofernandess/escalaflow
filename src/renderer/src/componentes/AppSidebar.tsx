import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTheme } from 'next-themes'
import {
  LayoutDashboard,
  Building2,
  Users,
  CalendarDays,
  FileText,
  Settings,
  ShieldCheck,
  ChevronsUpDown,
  Sun,
  Moon,
  Monitor,
  Check,
  HelpCircle,
  Info,
  Palette,
} from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarSeparator,
  useSidebar,
} from '@/components/ui/sidebar'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { empresaService } from '@/servicos/empresa'
import { TOUR_STEP_IDS, TOUR_STORAGE_KEY } from '@/lib/tour-constants'
import { useTour } from './Tour'

const mainNav = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard },
  { label: 'Setores', to: '/setores', icon: Building2 },
  { label: 'Colaboradores', to: '/colaboradores', icon: Users },
  { label: 'Escalas', to: '/escalas', icon: CalendarDays },
]

const configNav = [
  { label: 'Tipos de Contrato', to: '/tipos-contrato', icon: FileText },
  { label: 'Feriados', to: '/feriados', icon: CalendarDays },
  { label: 'Regras', to: '/regras', icon: ShieldCheck },
]

const temaOpcoes = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Escuro', icon: Moon },
  { value: 'system', label: 'Sistema', icon: Monitor },
] as const

function extrairIniciais(nome: string): string {
  return nome
    .split(/\s+/)
    .filter((p) => p.length > 0)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('')
}

export function AppSidebar() {
  const { pathname } = useLocation()
  const { isMobile } = useSidebar()
  const { theme, setTheme } = useTheme()
  const { startTour } = useTour()
  const [empresaNome, setEmpresaNome] = useState('Empresa')

  useEffect(() => {
    empresaService.buscar().then((emp) => {
      if (emp?.nome) setEmpresaNome(emp.nome)
    }).catch(() => {
      // silently fallback to default
    })
  }, [])

  const iniciais = extrairIniciais(empresaNome)

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader id={TOUR_STEP_IDS.SIDEBAR_HEADER} className="p-4 group-data-[collapsible=icon]:p-2">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <CalendarDays className="size-4 shrink-0" />
          </div>
          <div className="flex flex-col group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold tracking-tight text-sidebar-foreground">
              EscalaFlow
            </span>
            <span className="text-[10px] text-sidebar-foreground/50">
              v2.0
            </span>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        <SidebarGroup id={TOUR_STEP_IDS.NAV_PRINCIPAL}>
          <SidebarGroupLabel>Principal</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNav.map((item) => {
                const tourId =
                  item.to === '/setores'
                    ? TOUR_STEP_IDS.NAV_SETORES
                    : item.to === '/colaboradores'
                      ? TOUR_STEP_IDS.NAV_COLABORADORES
                      : item.to === '/escalas'
                        ? TOUR_STEP_IDS.NAV_ESCALAS
                        : undefined
                return (
                  <SidebarMenuItem key={item.label} id={tourId}>
                    <SidebarMenuButton
                      asChild
                      isActive={
                        item.to === '/'
                          ? pathname === '/'
                          : pathname.startsWith(item.to)
                      }
                      tooltip={item.label}
                    >
                      <Link to={item.to}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Configuracao</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {configNav.map((item) => (
                <SidebarMenuItem
                  key={item.label}
                  id={
                    item.to === '/tipos-contrato' ? TOUR_STEP_IDS.NAV_CONTRATOS :
                    item.to === '/feriados' ? TOUR_STEP_IDS.NAV_FERIADOS :
                    item.to === '/regras' ? TOUR_STEP_IDS.NAV_REGRAS :
                    undefined
                  }
                >
                  <SidebarMenuButton
                    asChild
                    isActive={pathname.startsWith(item.to)}
                    tooltip={item.label}
                  >
                    <Link to={item.to}>
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

      </SidebarContent>

      <SidebarFooter id={TOUR_STEP_IDS.FOOTER_MENU}>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <Avatar className="size-8 rounded-lg">
                    <AvatarFallback className="rounded-lg bg-sidebar-primary text-sidebar-primary-foreground text-xs font-semibold">
                      {iniciais}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">
                      {empresaNome}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      EscalaFlow v2.0
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                side={isMobile ? 'bottom' : 'right'}
                align="end"
                sideOffset={4}
              >
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                    <Avatar className="size-8 rounded-lg">
                      <AvatarFallback className="rounded-lg bg-sidebar-primary text-sidebar-primary-foreground text-xs font-semibold">
                        {iniciais}
                      </AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold">
                        {empresaNome}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        Gestao de Escalas
                      </span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Palette className="size-4" />
                    <span>Tema</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="min-w-[140px]">
                    {temaOpcoes.map((opcao) => (
                      <DropdownMenuItem
                        key={opcao.value}
                        onClick={() => setTheme(opcao.value)}
                        className={cn(
                          'flex items-center gap-2',
                          theme === opcao.value && 'bg-accent',
                        )}
                      >
                        <opcao.icon className="size-4" />
                        <span>{opcao.label}</span>
                        {theme === opcao.value && (
                          <Check className="ml-auto size-3.5 text-muted-foreground" />
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuItem asChild>
                  <Link to="/empresa">
                    <Building2 className="size-4" />
                    <span>Empresa</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/configuracoes">
                    <Settings className="size-4" />
                    <span>Configuracoes</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    localStorage.removeItem(TOUR_STORAGE_KEY)
                    startTour()
                  }}
                >
                  <HelpCircle className="size-4" />
                  <span>Como Funciona?</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled className="flex flex-col items-start gap-0.5 opacity-70">
                  <div className="flex items-center gap-2">
                    <Info className="size-4" />
                    <span>Sobre</span>
                  </div>
                  <span className="pl-6 text-[10px] text-muted-foreground">
                    EscalaFlow v2.0 — Desktop
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
