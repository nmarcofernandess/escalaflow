import { Link } from 'react-router-dom'
import {
  Building2,
  Users,
  Palmtree,
  Stethoscope,
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CircleAlert,
} from 'lucide-react'
import { SetorIcon } from '@/componentes/IconPicker'
import { CORES_VIOLACAO } from '@/lib/cores'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/componentes/PageHeader'
import { StatusBadge } from '@/componentes/StatusBadge'
import { EmptyState } from '@/componentes/EmptyState'
import { dashboardService } from '@/servicos/dashboard'
import { useApiData } from '@/hooks/useApiData'
import type { DashboardResumo } from '@shared/index'

const statConfig = [
  { key: 'total_setores' as const, label: 'Setores Ativos', icon: Building2, color: 'text-primary', bgColor: 'bg-primary/10' },
  { key: 'total_colaboradores' as const, label: 'Colaboradores', icon: Users, color: 'text-chart-2', bgColor: 'bg-chart-2/10' },
  { key: 'total_em_ferias' as const, label: 'Em Ferias', icon: Palmtree, color: 'text-chart-3', bgColor: 'bg-chart-3/10' },
  { key: 'total_em_atestado' as const, label: 'Em Atestado', icon: Stethoscope, color: 'text-destructive', bgColor: 'bg-destructive/10' },
]

export function Dashboard() {
  const { data: dados, loading } = useApiData<DashboardResumo>(
    () => dashboardService.resumo(),
    [],
  )

  if (loading || !dados) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader breadcrumbs={[{ label: 'Dashboard' }]} />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader breadcrumbs={[{ label: 'Dashboard' }]} />

      <div className="flex-1 space-y-6 p-6">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {statConfig.map((stat) => (
            <Card key={stat.key}>
              <CardContent className="flex items-center gap-4 p-4">
                <div className={`flex size-10 items-center justify-center rounded-lg ${stat.bgColor}`}>
                  <stat.icon className={`size-5 ${stat.color}`} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{dados[stat.key]}</p>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Setores Overview */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base font-semibold">Setores</CardTitle>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/setores">
                    Ver todos <ArrowRight className="ml-1 size-3" />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent className="space-y-3 pb-4">
                {dados.setores.length === 0 ? (
                  <EmptyState
                    icon={Building2}
                    title="Nenhum setor cadastrado"
                    description="Crie um setor para comecar a gerar escalas"
                    action={
                      <Button size="sm" asChild>
                        <Link to="/setores">Criar Setor</Link>
                      </Button>
                    }
                  />
                ) : (
                  dados.setores.map((setor) => (
                    <div
                      key={setor.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                          <SetorIcon name={setor.icone} className="size-4" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{setor.nome}</p>
                          <p className="text-xs text-muted-foreground">
                            {setor.total_colaboradores} colaboradores
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusBadge status={setor.escala_atual} />
                        {setor.violacoes_pendentes > 0 && (
                          <Badge variant="outline" className={`${CORES_VIOLACAO.SOFT.border} ${CORES_VIOLACAO.SOFT.bg} ${CORES_VIOLACAO.SOFT.text}`}>
                            {setor.violacoes_pendentes} alertas
                          </Badge>
                        )}
                        {(setor.escala_atual === 'OFICIAL' || setor.escala_atual === 'RASCUNHO') && (
                          <Button variant="outline" size="sm" asChild>
                            <Link to={`/setores/${setor.id}/escala`}>
                              <CalendarDays className="mr-1 size-3" /> Ver Escala
                            </Link>
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={`/setores/${setor.id}`}>
                            <ArrowRight className="size-4" />
                          </Link>
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          {/* Alertas */}
          <div>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                  <AlertTriangle className="size-4 text-amber-500" />
                  Alertas
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pb-4">
                {dados.alertas.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Nenhum alerta ativo
                  </p>
                ) : (
                  dados.alertas.map((alerta, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-3 rounded-lg border border-amber-100 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/30 p-3"
                    >
                      <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
                      <div className="flex-1">
                        <p className="text-xs font-medium text-amber-800 dark:text-amber-300">{alerta.setor_nome}</p>
                        <p className="text-xs text-amber-700 dark:text-amber-300">{alerta.mensagem}</p>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

          </div>
        </div>
      </div>
    </div>
  )
}
