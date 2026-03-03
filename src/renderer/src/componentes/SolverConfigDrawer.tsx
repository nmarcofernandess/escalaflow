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
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { useApiData } from '@/hooks/useApiData'
import { regrasService } from '@/servicos/regras'
import type { RuleDefinition, RuleStatus, RuleConfig } from '@shared/index'

export interface SolverSessionConfig {
  solveMode: 'rapido' | 'balanceado' | 'otimizado' | 'maximo'
  maxTimeSeconds: number
  rulesOverride: RuleConfig
}

interface SolverConfigDrawerProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  config: SolverSessionConfig
  onConfigChange: (c: SolverSessionConfig) => void
}

export function SolverConfigDrawer({
  open,
  onOpenChange,
  config,
  onConfigChange,
}: SolverConfigDrawerProps) {
  const { data: regrasData } = useApiData<RuleDefinition[]>(
    () => regrasService.listar(),
    [],
  )

  const [localOverride, setLocalOverride] = useState<RuleConfig>(config.rulesOverride)
  const [solveMode, setSolveMode] = useState(config.solveMode)
  const [maxTime, setMaxTime] = useState(config.maxTimeSeconds)

  useEffect(() => {
    setLocalOverride(config.rulesOverride)
    setSolveMode(config.solveMode)
    setMaxTime(config.maxTimeSeconds)
  }, [config])

  const handleSave = () => {
    onConfigChange({ solveMode, maxTimeSeconds: maxTime, rulesOverride: localOverride })
    onOpenChange(false)
  }

  const handleRegraChange = (codigo: string, status: string) => {
    setLocalOverride((prev) => ({ ...prev, [codigo]: status as RuleStatus }))
  }

  const handleBulkChange = (categoria: string, status: string) => {
    if (!regrasData) return
    const updates: RuleConfig = {}
    regrasData
      .filter((r) => r.categoria === categoria)
      .forEach((r) => {
        if (r.codigo === 'H10' && status === 'OFF') return
        updates[r.codigo] = status as RuleStatus
      })
    setLocalOverride((prev) => ({ ...prev, ...updates }))
  }

  const handleRestaurarEmpresa = () => {
    if (!regrasData) return
    const override: RuleConfig = {}
    regrasData.forEach((r) => {
      override[r.codigo] = r.status_efetivo
    })
    setLocalOverride(override)
  }

  const handleRestaurarSistema = () => {
    if (!regrasData) return
    const override: RuleConfig = {}
    regrasData.forEach((r) => {
      override[r.codigo] = r.status_sistema
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
      <div className="space-y-2">
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
                {bulkOptions.map((opt) => (
                  <SelectItem key={opt} value={opt} className="text-xs">
                    {opt === 'OFF' ? 'Desativado' : opt}
                  </SelectItem>
                ))}
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
                      <Badge variant="secondary" className="text-[10px] px-1 py-0">
                        •
                      </Badge>
                    )}
                  </div>
                </div>
                <Select
                  value={status}
                  onValueChange={(val) => handleRegraChange(r.codigo, val)}
                >
                  <SelectTrigger className="h-7 w-[100px] text-xs shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statusOptions.map((opt) => {
                      if (r.codigo === 'H10' && opt.value === 'OFF') return null
                      return (
                        <SelectItem key={opt.value} value={opt.value} className="text-xs">
                          {opt.label}
                        </SelectItem>
                      )
                    })}
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
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="px-6 py-4 space-y-6">
            {/* Estrategia */}
            <div className="space-y-3">
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Estrategia
              </p>
              <RadioGroup
                value={solveMode}
                onValueChange={(v) => setSolveMode(v as SolverSessionConfig['solveMode'])}
                className="space-y-2"
              >
                <div className="flex items-start gap-3 rounded-md border p-3">
                  <RadioGroupItem value="rapido" id="mode-rapido" className="mt-0.5" />
                  <div>
                    <Label htmlFor="mode-rapido" className="font-medium cursor-pointer">
                      Rapido
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Primeira solucao valida (~45s)
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-md border p-3">
                  <RadioGroupItem value="balanceado" id="mode-balanceado" className="mt-0.5" />
                  <div>
                    <Label htmlFor="mode-balanceado" className="font-medium cursor-pointer">
                      Balanceado
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Equilibrio velocidade/qualidade (~3min)
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-md border p-3">
                  <RadioGroupItem value="otimizado" id="mode-otimizado" className="mt-0.5" />
                  <div>
                    <Label htmlFor="mode-otimizado" className="font-medium cursor-pointer">
                      Otimizado
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Alta qualidade (~10min)
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-md border p-3">
                  <RadioGroupItem value="maximo" id="mode-maximo" className="mt-0.5" />
                  <div className="flex-1">
                    <Label htmlFor="mode-maximo" className="font-medium cursor-pointer">
                      Maximo
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Otimizacao maxima (~30min)
                    </p>
                    {solveMode === 'maximo' && (
                      <div className="flex items-center gap-2 mt-2">
                        <Label className="text-xs">Limite (s):</Label>
                        <Input
                          type="number"
                          min={60}
                          max={3600}
                          value={maxTime}
                          onChange={(e) => setMaxTime(Number(e.target.value))}
                          className="h-7 w-20 text-xs"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </RadioGroup>
            </div>

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
            <div className="space-y-2">
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
                  <RotateCcw className="mr-1 size-3.5" />
                  Empresa
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={handleRestaurarSistema}
                >
                  <RotateCcw className="mr-1 size-3.5" />
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
