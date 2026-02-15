import { client } from './client'
import type { DashboardResumo } from '@shared/index'

export const dashboardService = {
  resumo: () =>
    client['dashboard.resumo'](undefined as any) as Promise<DashboardResumo>,
}
