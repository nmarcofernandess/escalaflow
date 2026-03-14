import { useState, useMemo, useCallback } from 'react'
import {
  Zap,
  AlertTriangle,
  Info,
  RotateCcw,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/componentes/PageHeader'
import { CicloViewToggle, useCicloViewMode } from '@/componentes/CicloViewToggle'
import { SimuladorCicloGrid } from '@/componentes/SimuladorCicloGrid'
import {
  gerarCicloFase1,
  sugerirK,
  type SimulaCicloFase1Input,
  type SimulaCicloOutput,
} from '@shared/simula-ciclo'
import { cn } from '@/lib/utils'

const DEFAULT_N = 5

export function SimulaCicloPagina() {
  const kSugerido = useMemo(() => sugerirK(DEFAULT_N, 7), [])
  const [N, setN] = useState(DEFAULT_N)
  const [K, setK] = useState(kSugerido)
  const [rawN, setRawN] = useState(String(DEFAULT_N))
  const [rawK, setRawK] = useState(String(kSugerido))
  const [cicloMode, setCicloMode] = useCicloViewMode()
  const [selectedWeek, setSelectedWeek] = useState(0)

  const kSugeridoAtual = useMemo(() => sugerirK(N, 7), [N])
  const numMeses = 3
  const SEMANAS_POR_MES = 4.33
  const semanasExibidas = Math.max(1, Math.round(SEMANAS_POR_MES * numMeses))

  const input: SimulaCicloFase1Input = useMemo(
    () => ({
      num_postos: N,
      trabalham_domingo: K,
      num_meses: numMeses,
      preflight: true,
    }),
    [N, K, numMeses],
  )

  const resultado: SimulaCicloOutput = useMemo(() => gerarCicloFase1(input), [input])

  const handleNChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    setRawN(raw)
    if (raw === '') return
    const val = parseInt(raw, 10)
    if (!isNaN(val) && val >= 1) {
      setN(val)
      const kNovo = sugerirK(val, 7)
      setK(kNovo)
      setRawK(String(kNovo))
    }
  }, [])

  const handleKChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    setRawK(raw)
    if (raw === '') return
    const val = parseInt(raw, 10)
    if (!isNaN(val) && val >= 0) {
      setK(Math.min(val, N))
    }
  }, [N])

  const aplicarSugerido = useCallback(() => {
    const k = sugerirK(N, 7)
    setK(k)
    setRawK(String(k))
  }, [N])

  const resetar = useCallback(() => {
    const k = sugerirK(DEFAULT_N, 7)
    setN(DEFAULT_N)
    setK(k)
    setRawN(String(DEFAULT_N))
    setRawK(String(k))
    setSelectedWeek(0)
  }, [])

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          { label: 'Simular Ciclos' },
        ]}
        actions={
          <Button variant="outline" size="sm" onClick={resetar}>
            <RotateCcw className="mr-1 size-3.5" />
            Resetar
          </Button>
        }
      />

      <div className="flex flex-col gap-6 p-6">
        {/* Parametros — enxuto */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="size-5" />
              Simulador de Ciclo
            </CardTitle>
            <CardDescription>
              Defina quantas pessoas trabalham no domingo e veja a escala rotativa para 3 meses.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="n">Pessoas no setor</Label>
                <Input
                  id="n"
                  type="number"
                  min={1}
                  max={30}
                  value={rawN}
                  onChange={handleNChange}
                  className="w-28"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="k">Trabalham domingo</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="k"
                    type="number"
                    min={0}
                    max={N}
                    value={rawK}
                    onChange={handleKChange}
                    className="w-28"
                  />
                  <Button
                    variant={K === kSugeridoAtual && rawK !== '' ? 'ghost' : 'outline'}
                    size="sm"
                    onClick={aplicarSugerido}
                    title={`Recomendado: ~40% no domingo`}
                  >
                    Sugerido: {kSugeridoAtual}
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Erro */}
        {!resultado.sucesso && (
          <Card className="border-red-500/30">
            <CardContent className="flex items-start gap-3 pt-6">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-400" />
              <div>
                <p className="font-medium text-red-400">{resultado.erro}</p>
                {resultado.sugestao && (
                  <p className="mt-1 text-sm text-zinc-400">{resultado.sugestao}</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Resultado */}
        {resultado.sucesso && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Ciclo</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums">
                  {resultado.ciclo_semanas}{' '}
                  <span className="text-sm font-normal text-muted-foreground">
                    semana{resultado.ciclo_semanas > 1 ? 's' : ''}
                  </span>
                </p>
              </div>
              <div
                className={cn(
                  'rounded-lg border p-3',
                  resultado.stats.sem_TT ? 'border-emerald-500/30' : 'border-amber-500/30',
                )}
              >
                <p className="text-xs text-muted-foreground">Domingos seguidos</p>
                <p
                  className={cn(
                    'mt-0.5 text-lg font-semibold',
                    resultado.stats.sem_TT ? 'text-emerald-500' : 'text-amber-500',
                  )}
                >
                  {resultado.stats.sem_TT
                    ? 'Nenhum'
                    : `Até ${resultado.stats.domingos_consecutivos_max}`}
                </p>
              </div>
              <div
                className={cn(
                  'rounded-lg border p-3',
                  resultado.stats.sem_H1_violation
                    ? 'border-emerald-500/30'
                    : 'border-red-500/30',
                )}
              >
                <p className="text-xs text-muted-foreground">Dias consecutivos</p>
                <p
                  className={cn(
                    'mt-0.5 text-lg font-semibold',
                    resultado.stats.sem_H1_violation ? 'text-emerald-500' : 'text-red-500',
                  )}
                >
                  {resultado.stats.h1_violacoes === 0
                    ? 'Até 6'
                    : `${resultado.stats.h1_violacoes} reparos`}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Cobertura diária</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums">
                  {resultado.stats.cobertura_min}
                  <span className="text-sm font-normal text-muted-foreground"> a </span>
                  {resultado.stats.cobertura_max}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">pessoas</span>
                </p>
              </div>
            </div>

            {/* Grid — mesmo layout do ciclo completo / modo semana */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Ciclo Rotativo</CardTitle>
                <CardDescription>
                  Mesmo layout do sistema: Tabela (uma semana) ou Resumo (ciclo completo).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <CicloViewToggle mode={cicloMode} onChange={setCicloMode} />
                </div>
                <SimuladorCicloGrid
                  resultado={resultado}
                  viewMode={cicloMode}
                  selectedWeek={selectedWeek}
                  onSelectedWeekChange={setSelectedWeek}
                  domingoTarget={K}
                />
              </CardContent>
            </Card>

            {/* Info */}
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <Info className="size-4 shrink-0" />
              <span>
                Exibindo {semanasExibidas} semanas (3 meses). Padrão repete a cada {resultado.ciclo_semanas} semanas.
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
