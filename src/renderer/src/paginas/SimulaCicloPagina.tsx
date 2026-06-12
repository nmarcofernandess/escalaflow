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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { PageHeader } from '@/componentes/PageHeader'
import { CicloGrid } from '@/componentes/CicloGrid'
import { simulacaoParaCicloGrid } from '@/lib/ciclo-grid-converters'
import {
  gerarCicloFase1,
  sugerirK,
  type SimulaCicloFase1Input,
  type SimulaCicloOutput,
} from '@shared/simula-ciclo'
import { cn } from '@/lib/utils'

const DEFAULT_N = 5
const MAX_N = 30
const DEFAULT_REGIME = '5X2'

type RegimeEscala = '5X2' | '6X1'

export function SimulaCicloPagina() {
  const kSugerido = useMemo(() => sugerirK(DEFAULT_N, 7), [])
  const [N, setN] = useState(DEFAULT_N)
  const [K, setK] = useState(kSugerido)
  const [rawN, setRawN] = useState(String(DEFAULT_N))
  const [rawK, setRawK] = useState(String(kSugerido))
  const [regime, setRegime] = useState<RegimeEscala>(DEFAULT_REGIME)
  const is6x1 = regime === '6X1'
  // K controla apenas a cadência de domingo (N/gcd(N,K)); 5x2 vs 6x1 muda a folga
  // dos dias úteis, não a matemática do rodízio dominical. A sugestão segue única.
  const kSugeridoAtual = useMemo(() => sugerirK(N, 7), [N])
  const numMeses = 3
  const SEMANAS_POR_MES = 4.33
  const semanasExibidas = Math.max(1, Math.round(SEMANAS_POR_MES * numMeses))
  const regimeLabel = is6x1 ? '6x1' : '5x2'

  const input: SimulaCicloFase1Input = useMemo(
    () => ({
      num_postos: N,
      trabalham_domingo: K,
      num_meses: numMeses,
      preflight: true,
      regime,
    }),
    [N, K, numMeses, regime],
  )

  const resultado: SimulaCicloOutput = useMemo(() => gerarCicloFase1(input), [input])

  const cicloGridData = useMemo(() => {
    if (!resultado.sucesso) return null
    return simulacaoParaCicloGrid(resultado)
  }, [resultado])

  const handleNChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    setRawN(raw)
    if (raw === '') return
    const val = parseInt(raw, 10)
    if (!isNaN(val) && val >= 1) {
      const bounded = Math.min(val, MAX_N)
      if (bounded !== val) setRawN(String(bounded))
      setN(bounded)
      const kNovo = sugerirK(bounded, 7)
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
      const bounded = Math.min(val, N)
      if (bounded !== val) setRawK(String(bounded))
      setK(bounded)
    }
  }, [N])

  const aplicarSugerido = useCallback(() => {
    const k = sugerirK(N, 7)
    setK(k)
    setRawK(String(k))
  }, [N])

  const handleRegimeChange = useCallback((value: string) => {
    if (value === '5X2' || value === '6X1') {
      setRegime(value)
    }
  }, [])

  const resetar = useCallback(() => {
    const k = sugerirK(DEFAULT_N, 7)
    setN(DEFAULT_N)
    setK(k)
    setRawN(String(DEFAULT_N))
    setRawK(String(k))
    setRegime(DEFAULT_REGIME)
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
            <RotateCcw />
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
              {is6x1
                ? 'Simule folga única semanal: quem trabalha domingo folga em um dia variável; quem folga domingo trabalha de segunda a sábado.'
                : 'Defina quantas pessoas trabalham no domingo e veja a escala rotativa 5x2 para 3 meses.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Regime</Label>
                <ToggleGroup
                  type="single"
                  value={regime}
                  onValueChange={handleRegimeChange}
                  size="sm"
                  className="justify-start rounded-md border bg-muted/40 p-0.5"
                >
                  <ToggleGroupItem value="5X2" className="h-8 px-3 text-xs">
                    5x2
                  </ToggleGroupItem>
                  <ToggleGroupItem value="6X1" className="h-8 px-3 text-xs">
                    6x1
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="n">Pessoas no setor</Label>
                <Input
                  id="n"
                  type="number"
                  min={1}
                  max={MAX_N}
                  value={rawN}
                  onChange={handleNChange}
                  className="w-28"
                />
              </div>
              <div className="flex flex-col gap-1.5">
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
                    title="Recomendado: ~40% no domingo em ambos os regimes"
                  >
                    Sugerido: {kSugeridoAtual}
                  </Button>
                </div>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {is6x1
                ? '6x1: 1 folga por semana. Ate 6 dias consecutivos e cobertura diaria N-1 pessoas sao comportamento normal no 6x1.'
                : '5x2: 2 folgas por semana. O simulador preserva o rodizio de domingos sem dois domingos trabalhados seguidos.'}
            </p>
          </CardContent>
        </Card>

        {/* Erro */}
        {!resultado.sucesso && (
          <Card className="border-red-500/30">
            <CardContent className="flex items-start gap-3 pt-6">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
              <div>
                <p className="font-medium text-destructive">{resultado.erro}</p>
                {resultado.sugestao && (
                  <p className="mt-1 text-sm text-muted-foreground">{resultado.sugestao}</p>
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
                    resultado.stats.sem_TT ? 'text-emerald-600 dark:text-emerald-500' : 'text-amber-600 dark:text-amber-500',
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
                    : is6x1
                      ? 'border-amber-500/30'
                      : 'border-red-500/30',
                )}
              >
                <p className="text-xs text-muted-foreground">
                  {is6x1 && resultado.stats.h1_violacoes > 0
                    ? 'Reparos de transicao'
                    : is6x1
                      ? 'Dias consecutivos normais'
                      : 'Dias consecutivos'}
                </p>
                <p
                  className={cn(
                    'mt-0.5 text-lg font-semibold',
                    resultado.stats.sem_H1_violation
                      ? 'text-emerald-600 dark:text-emerald-500'
                      : is6x1
                        ? 'text-amber-600 dark:text-amber-500'
                        : 'text-red-600 dark:text-red-500',
                  )}
                >
                  {resultado.stats.h1_violacoes === 0
                    ? (is6x1 ? 'Até 6 (normal no 6x1)' : 'Até 6')
                    : is6x1
                      ? `${resultado.stats.h1_violacoes} ajustes`
                      : `${resultado.stats.h1_violacoes} reparos`}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">
                  {is6x1 ? 'Cobertura diaria (N-1 pessoas)' : 'Cobertura diária'}
                </p>
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
                  {is6x1
                    ? 'No 6x1, a coluna Var mostra o dia de folga variável usado nas semanas em que a pessoa trabalha domingo; Fixo fica vazio quando não há folga fixa.'
                    : 'Mesmo layout do sistema: Tabela (uma semana) ou Resumo (ciclo completo).'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {cicloGridData && <CicloGrid data={cicloGridData} mode="edit" />}
              </CardContent>
            </Card>

            {/* Info */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Info className="size-4 shrink-0" />
              <span>
                Exibindo {semanasExibidas} semanas (3 meses) no regime {regimeLabel}. Padrão repete a cada {resultado.ciclo_semanas} semanas.
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
