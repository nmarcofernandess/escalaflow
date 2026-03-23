import { useState, useEffect } from 'react'
import { RotateCcw } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { useApiData } from '@/hooks/useApiData'
import { regrasService } from '@/servicos/regras'
import type { EscalaPeriodoPreset } from '@/lib/escala-periodo-preset'
import type { RuleDefinition, RuleStatus, RuleConfig } from '@shared/index'

export interface SolverSessionConfig {
  solveMode: 'rapido' // kept for backward compat — solver ignores this, uses 30s patience
  maxTimeSeconds?: number
  rulesOverride: RuleConfig
}

interface SolverConfigDrawerProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  config: SolverSessionConfig
  onConfigChange: (c: SolverSessionConfig) => void
  periodoPreset: EscalaPeriodoPreset
  onPeriodoPresetChange: (preset: EscalaPeriodoPreset) => void
}

export function SolverConfigDrawer({
  open,
  onOpenChange,
  config,
  onConfigChange,
  periodoPreset,
  onPeriodoPresetChange,
}: SolverConfigDrawerProps) {
  const { data: regrasData } = useApiData<RuleDefinition[]>(
    () => regrasService.listar(),
    [],
  )

  const [localOverride, setLocalOverride] = useState<RuleConfig>(config.rulesOverride)
  const [localPeriodoPreset, setLocalPeriodoPreset] = useState<EscalaPeriodoPreset>(periodoPreset)

  useEffect(() => {
    if (!open) return
    setLocalOverride(config.rulesOverride)
    setLocalPeriodoPreset(periodoPreset)
  }, [config, open, periodoPreset])

  const handleSave = () => {
    onConfigChange({ ...config, rulesOverride: localOverride })
    onPeriodoPresetChange(localPeriodoPreset)
    onOpenChange(false)
  }

  const handleRegraChange = (regra: RuleDefinition, status: string) => {
    if (!regra.editavel) return
    setLocalOverride((prev) => {
      const next = { ...prev }
      if (status === regra.status_efetivo) {
        delete next[regra.codigo]
      } else {
        next[regra.codigo] = status as RuleStatus
      }
      return next
    })
  }

  const handleBulkChange = (categoria: string, status: string) => {
    if (!regrasData) return
    setLocalOverride((prev) => {
      const next = { ...prev }
      regrasData
        .filter((r) => r.categoria === categoria && r.editavel)
        .forEach((r) => {
          if (r.codigo === 'H10' && status === 'OFF') return
          if (status === r.status_efetivo) {
            delete next[r.codigo]
          } else {
            next[r.codigo] = status as RuleStatus
          }
        })
      return next
    })
  }

  const handleRestaurarEmpresa = () => {
    setLocalOverride({})
  }

  const handleRestaurarSistema = () => {
    if (!regrasData) return
    const override: RuleConfig = {}
    regrasData.forEach((r) => {
      if (r.status_sistema !== r.status_efetivo) {
        override[r.codigo] = r.status_sistema
      }
    })
    setLocalOverride(override)
  }

  const getStatus = (r: RuleDefinition): RuleStatus => {
    return (localOverride[r.codigo] ?? r.status_efetivo) as RuleStatus
  }

  const renderSection = (titulo: string, categoria: 'CLT' | 'SOFT' | 'ANTIPATTERN') => {
    const regras = (regrasData ?? []).filter((r) => r.categoria === categoria)
    if (regras.length === 0) return null
    const isCLT = categoria === 'CLT'
    const bulkOptions = isCLT ? ['HARD', 'SOFT', 'OFF'] : ['ON', 'OFF']
    const statusOptions = isCLT
      ? [
          { value: 'HARD', label: 'HARD' },
          { value: 'SOFT', label: 'SOFT' },
          { value: 'OFF', label: 'Off' },
        ]
      : [
          { value: 'ON', label: 'Ativo' },
          { value: 'OFF', label: 'Off' },
        ]

    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {titulo}
          </p>
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">Todos:</span>
            <Select onValueChange={(val) => handleBulkChange(categoria, val)}>
              <SelectTrigger className="h-7 w-[100px] text-xs">
                <SelectValue placeholder="..." />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {bulkOptions.map((opt) => (
                    <SelectItem key={opt} value={opt} className="text-xs">
                      {opt === 'OFF' ? 'Desativado' : opt}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="rounded-md border divide-y">
          {regras.map((r) => {
            const status = getStatus(r)
            const mudou = status !== r.status_sistema
            return (
              <div key={r.codigo} className="flex items-center justify-between px-3 py-2 gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-medium truncate">{r.nome}</span>
                    {mudou && (
                      <Badge variant="secondary" className="text-xs px-1 py-0">
                        •
                      </Badge>
                    )}
                    {!r.editavel && (
                      <Badge variant="outline" className="text-[10px] px-1 py-0 text-muted-foreground">
                        fixo
                      </Badge>
                    )}
                  </div>
                  {r.codigo === 'H10' && (
                    <p className="text-[11px] text-muted-foreground">
                      Quando HARD, respeita a tolerancia semanal configurada em /Regras.
                    </p>
                  )}
                </div>
                <Select
                  value={status}
                  onValueChange={(val) => handleRegraChange(r, val)}
                  disabled={!r.editavel}
                >
                  <SelectTrigger className="h-7 w-[100px] text-xs shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {statusOptions.map((opt) => {
                        if (r.codigo === 'H10' && opt.value === 'OFF') return null
                        return (
                          <SelectItem key={opt.value} value={opt.value} className="text-xs">
                            {opt.label}
                          </SelectItem>
                        )
                      })}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-3/4 max-w-xl sm:max-w-xl flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b">
          <SheetTitle>Configuracoes de Geracao</SheetTitle>
          <p className="text-sm text-muted-foreground">
            Ajuste a estrategia de geracao e as regras temporarias desta escala sem mexer nas regras salvas da empresa.
          </p>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-6 px-6 py-4">
            <div className="flex flex-col gap-3">
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Periodo
              </p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="solver-periodo-preset">Quantidade de meses</Label>
                <Select
                  value={localPeriodoPreset}
                  onValueChange={(value) => setLocalPeriodoPreset(value as EscalaPeriodoPreset)}
                >
                  <SelectTrigger id="solver-periodo-preset" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="3_MESES">3 meses</SelectItem>
                      <SelectItem value="6_MESES">6 meses</SelectItem>
                      <SelectItem value="1_ANO">1 ano</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Define o periodo da proxima geracao e do preview exibido nesta aba.
                </p>
              </div>
            </div>

            {/* Estrategia removida — solver usa estabilizacao de cobertura (patience 30s fixo) */}

            <Separator />

            {/* Regras */}
            {regrasData ? (
              <>
                {renderSection('Regras CLT', 'CLT')}
                <Separator />
                {renderSection('Preferencias', 'SOFT')}
                <Separator />
                {renderSection('Antipadroes', 'ANTIPATTERN')}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Carregando regras...</p>
            )}

            <Separator />

            {/* Reset */}
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Reset
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={handleRestaurarEmpresa}
                >
                  <RotateCcw />
                  Empresa
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={handleRestaurarSistema}
                >
                  <RotateCcw />
                  Sistema
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                &quot;Empresa&quot; restaura os padroes salvos em /Regras. &quot;Sistema&quot;
                restaura os defaults de fabrica.
              </p>
            </div>
          </div>
        </ScrollArea>

        <div className="border-t px-6 py-4">
          <Button className="w-full" onClick={handleSave}>
            Aplicar e Fechar
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
