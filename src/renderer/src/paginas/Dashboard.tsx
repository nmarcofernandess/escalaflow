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
  RefreshCw,
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
  const { data: dados, loading, error, reload } = useApiData<DashboardResumo>(
    () => dashboardService.resumo(),
    [],
  )

  if (loading && !dados) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader breadcrumbs={[{ label: 'Dashboard' }]} />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
      </div>
    )
  }

  if (error || !dados) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader breadcrumbs={[{ label: 'Dashboard' }]} />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <p className="text-sm text-destructive">
            {error ?? 'Nao foi possivel carregar o dashboard.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => reload()}>
            Tentar novamente
          </Button>
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
                          <Badge variant="outline" className={`${CORES_VIOLACAO.HARD.border} ${CORES_VIOLACAO.HARD.bg} ${CORES_VIOLACAO.HARD.text}`}>
                            {setor.violacoes_pendentes} {setor.violacoes_pendentes === 1 ? 'violacao' : 'violacoes'}
                          </Badge>
                        )}
                        {setor.escala_desatualizada && (
                          <Badge variant="outline" className="border-warning/20 bg-warning/10 text-warning">
                            <RefreshCw className="mr-1 size-3" /> Desatualizada
                          </Badge>
                        )}
                        <Button variant="outline" size="sm" asChild>
                          <Link to={`/setores/${setor.id}`}>
                            Abrir Setor
                          </Link>
                        </Button>
                        {(setor.escala_atual === 'OFICIAL' || setor.escala_atual === 'RASCUNHO') && (
                          <Button variant="ghost" size="sm" asChild>
                            <Link to={`/setores/${setor.id}/escala`}>
                              <CalendarDays className="mr-1 size-3" /> Detalhes
                            </Link>
                          </Button>
                        )}
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
                  <AlertTriangle className="size-4 text-warning" />
                  Alertas
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pb-4">
                {dados.alertas.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Nenhum alerta ativo
                  </p>
                ) : (
                  dados.alertas.map((alerta, i) => {
                    const isHard = alerta.tipo === 'VIOLACAO_HARD'
                    const borderCls = isHard
                      ? 'border-destructive/20 bg-destructive/5'
                      : 'border-warning/20 bg-warning/5'
                    const iconCls = isHard ? 'text-destructive' : 'text-warning'
                    const titleCls = isHard ? 'text-destructive' : 'text-warning'
                    const textCls = isHard ? 'text-destructive' : 'text-warning'
                    return (
                      <div
                        key={i}
                        className={`flex items-start gap-3 rounded-lg border p-3 ${borderCls}`}
                      >
                        <CircleAlert className={`mt-0.5 size-4 shrink-0 ${iconCls}`} />
                        <div className="flex-1">
                          <p className={`text-xs font-medium ${titleCls}`}>{alerta.setor_nome}</p>
                          <p className={`text-xs ${textCls}`}>{alerta.mensagem}</p>
                        </div>
                      </div>
                    )
                  })
                )}
              </CardContent>
            </Card>

          </div>
        </div>
      </div>
    </div>
  )
}
