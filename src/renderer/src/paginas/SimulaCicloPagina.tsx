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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PageHeader } from '@/componentes/PageHeader'
import { CicloViewToggle, useCicloViewMode } from '@/componentes/CicloViewToggle'
import {
  gerarCicloFase1,
  sugerirK,
  type SimulaCicloFase1Input,
  type SimulaCicloOutput,
  type DiaStatus,
} from '@shared/simula-ciclo'
import { cn } from '@/lib/utils'

const DIAS_ORDEM = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'] as const
const DIAS_CURTOS: Record<(typeof DIAS_ORDEM)[number], string> = {
  SEG: 'Seg',
  TER: 'Ter',
  QUA: 'Qua',
  QUI: 'Qui',
  SEX: 'Sex',
  SAB: 'Sab',
  DOM: 'Dom',
}

const DEFAULT_N = 5
const DEFAULT_K = 2

/** Classes alinhadas ao EscalaCicloResumo: T, FF, FV, DT, DF */
const CELULA_CLASSES: Record<string, string> = {
  T: 'bg-success/10 text-success font-medium',
  F: 'bg-slate-200 text-slate-700 font-semibold dark:bg-slate-700 dark:text-slate-200',
  FF: 'bg-slate-200 text-slate-700 font-semibold dark:bg-slate-700 dark:text-slate-200',
  FV: 'bg-warning/10 text-warning font-semibold',
  DT: 'bg-warning/10 text-warning font-semibold ring-1 ring-inset ring-warning/40',
  DF: 'bg-blue-100 text-blue-700 font-semibold ring-1 ring-inset ring-blue-400 dark:bg-blue-950 dark:text-blue-400 dark:ring-blue-600',
}

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

  // Modo tabela: só H semanas (ciclo repete); modo resumo: todas
  const semanasCount = resultado.sucesso ? resultado.cobertura_dia.length : 0
  const semanasTabela = resultado.sucesso && resultado.ciclo_semanas > 0 ? resultado.ciclo_semanas : 1
  const selectedWeekClamped =
    cicloMode === 'tabela'
      ? Math.min(selectedWeek, Math.max(0, semanasTabela - 1))
      : Math.min(selectedWeek, Math.max(0, semanasCount - 1))

  const resolveSimbolo = useCallback(
    (
      status: DiaStatus,
      dIdx: number,
      row: { folga_fixa_dia: number; folga_variavel_dia: number | null },
    ): string => {
      const isDomingo = dIdx === 6
      if (status === 'T') return isDomingo ? 'DT' : 'T'
      if (isDomingo) return 'DF'
      if (dIdx === row.folga_variavel_dia) return 'FV'
      if (dIdx === row.folga_fixa_dia) return 'FF'
      return 'F'
    },
    [],
  )

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
                {/* Controles: toggle + S1/S2 + info */}
                <div className="flex flex-wrap items-center gap-3">
                  <CicloViewToggle mode={cicloMode} onChange={setCicloMode} />
                  {cicloMode === 'tabela' && semanasTabela > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {Array.from({ length: semanasTabela }, (_, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className={cn(
                            'h-8 min-w-10 rounded-md border px-2 text-xs font-medium transition-colors',
                            idx === selectedWeekClamped
                              ? 'bg-secondary text-secondary-foreground'
                              : 'bg-background text-foreground hover:bg-muted',
                          )}
                          onClick={() => setSelectedWeek(idx)}
                        >
                          S{idx + 1}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {cicloMode === 'tabela' ? (
                  /* Modo semana: uma semana por vez */
                  <div className="overflow-x-auto rounded-md border print-colors">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/30">
                          <TableHead className="w-[100px]">Posto</TableHead>
                          <TableHead className="w-[70px] text-center">Variável</TableHead>
                          <TableHead className="w-[60px] text-center">Fixo</TableHead>
                          {DIAS_ORDEM.map((dia) => (
                            <TableHead
                              key={dia}
                              className={cn(
                                'w-[54px] text-center',
                                dia === 'DOM' && 'font-semibold text-warning',
                              )}
                            >
                              {dia}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {resultado.grid.map((row, pIdx) => {
                          const sem = row.semanas[selectedWeekClamped]
                          if (!sem) return null
                          return (
                            <TableRow key={pIdx} className="hover:bg-muted/20">
                              <TableCell className="font-medium">{row.posto}</TableCell>
                              <TableCell className="text-center text-xs text-muted-foreground">
                                {row.folga_variavel_dia != null ? DIAS_CURTOS[DIAS_ORDEM[row.folga_variavel_dia]] : '-'}
                              </TableCell>
                              <TableCell className="text-center text-xs text-muted-foreground">
                                {DIAS_CURTOS[DIAS_ORDEM[row.folga_fixa_dia]]}
                              </TableCell>
                              {sem.dias.map((status, dIdx) => {
                                const simbolo = resolveSimbolo(status, dIdx, row)
                                const hasViolation = sem.consecutivos_max > 6
                                const sigla = simbolo === 'DT' ? 'T' : simbolo === 'DF' ? 'F' : simbolo
                                return (
                                  <TableCell
                                    key={dIdx}
                                    className={cn(
                                      'text-center text-sm select-none',
                                      CELULA_CLASSES[simbolo] ?? CELULA_CLASSES.F,
                                      hasViolation && 'ring-1 ring-red-500',
                                    )}
                                    title={simbolo === 'DT' ? 'Dom trabalhado' : simbolo === 'DF' ? 'Dom folga' : simbolo === 'FV' ? 'Folga variável' : simbolo === 'FF' ? 'Folga fixa' : 'Trabalha'}
                                  >
                                    {sigla}
                                  </TableCell>
                                )
                              })}
                            </TableRow>
                          )
                        })}
                        <TableRow className="border-t-2 bg-muted/20">
                          <TableCell className="font-medium text-blue-600 dark:text-blue-400">COBERTURA</TableCell>
                          <TableCell colSpan={2} />
                          {resultado.cobertura_dia[selectedWeekClamped]?.cobertura.map((val, dIdx) => (
                            <TableCell
                              key={dIdx}
                              className={cn(
                                'text-center text-sm font-bold',
                                dIdx === 6 ? (val >= K ? 'text-blue-600 dark:text-blue-400' : 'text-red-500') : 'text-muted-foreground',
                              )}
                            >
                              {val}
                            </TableCell>
                          ))}
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  /* Modo resumo: ciclo completo (todas as semanas) */
                  <div className="overflow-x-auto rounded-md border print-colors">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/30">
                          <TableHead className="sticky left-0 z-20 w-[100px] min-w-[100px] bg-muted">Posto</TableHead>
                          <TableHead className="sticky left-[100px] z-20 w-[70px] min-w-[70px] border-r bg-muted text-center text-xs">Variável</TableHead>
                          <TableHead className="sticky left-[170px] z-20 w-[60px] min-w-[60px] border-r bg-muted text-center text-xs">Fixo</TableHead>
                          {resultado.cobertura_dia.map((_, wIdx) => {
                            const totalSemanas = resultado.cobertura_dia.length
                            const isCycleEnd =
                              resultado.ciclo_semanas > 0 &&
                              (wIdx + 1) % resultado.ciclo_semanas === 0 &&
                              wIdx < totalSemanas - 1
                            return (
                              <TableHead
                                key={wIdx}
                                colSpan={7}
                                className={cn(
                                  'text-center text-xs font-semibold',
                                  isCycleEnd && 'border-r-2 border-r-purple-400 dark:border-r-purple-500',
                                )}
                              >
                                S{wIdx + 1}
                              </TableHead>
                            )
                          })}
                        </TableRow>
                        <TableRow className="bg-muted/30">
                          <TableHead className="sticky left-0 z-20 w-[100px] min-w-[100px] bg-muted" />
                          <TableHead className="sticky left-[100px] z-20 w-[70px] min-w-[70px] border-r bg-muted" />
                          <TableHead className="sticky left-[170px] z-20 w-[60px] min-w-[60px] border-r bg-muted" />
                          {resultado.cobertura_dia.map((_, wIdx) =>
                            DIAS_ORDEM.map((dia, dIdx) => {
                              const isLastDay = dIdx === 6
                              const totalSemanas = resultado.cobertura_dia.length
                              const isCycleEnd =
                                resultado.ciclo_semanas > 0 &&
                                (wIdx + 1) % resultado.ciclo_semanas === 0 &&
                                wIdx < totalSemanas - 1
                              return (
                                <TableHead
                                  key={`${wIdx}-${dia}`}
                                  className={cn(
                                    'w-9 min-w-[36px] px-0 text-center text-[10px] font-medium',
                                    dia === 'DOM' && 'font-semibold text-warning',
                                    isLastDay && isCycleEnd && 'border-r-2 border-r-purple-400 dark:border-r-purple-500',
                                    isLastDay && !isCycleEnd && wIdx < totalSemanas - 1 && 'border-r',
                                  )}
                                >
                                  {dia[0]}
                                </TableHead>
                              )
                            }),
                          )}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {resultado.grid.map((row, pIdx) => (
                          <TableRow key={pIdx} className="hover:bg-muted/20">
                            <TableCell className="sticky left-0 z-10 w-[100px] min-w-[100px] truncate bg-background font-medium">
                              {row.posto}
                            </TableCell>
                            <TableCell className="sticky left-[100px] z-10 w-[70px] min-w-[70px] border-r bg-background text-center text-xs text-muted-foreground">
                              {row.folga_variavel_dia != null ? DIAS_CURTOS[DIAS_ORDEM[row.folga_variavel_dia]] : '-'}
                            </TableCell>
                            <TableCell className="sticky left-[170px] z-10 w-[60px] min-w-[60px] border-r bg-background text-center text-xs text-muted-foreground">
                              {DIAS_CURTOS[DIAS_ORDEM[row.folga_fixa_dia]]}
                            </TableCell>
                            {row.semanas.flatMap((sem, wIdx) =>
                              sem.dias.map((status, dIdx) => {
                                const simbolo = resolveSimbolo(status, dIdx, row)
                                const hasViolation = sem.consecutivos_max > 6
                                const isLastDay = dIdx === 6
                                const totalSemanas = resultado.cobertura_dia.length
                                const isCycleEnd =
                                  resultado.ciclo_semanas > 0 &&
                                  (wIdx + 1) % resultado.ciclo_semanas === 0 &&
                                  wIdx < totalSemanas - 1
                                const sigla = simbolo === 'DT' ? 'T' : simbolo === 'DF' ? 'F' : simbolo
                                return (
                                  <TableCell
                                    key={`${wIdx}-${dIdx}`}
                                    className={cn(
                                      'w-9 min-w-[36px] px-0 py-1 text-center text-xs select-none',
                                      CELULA_CLASSES[simbolo] ?? CELULA_CLASSES.F,
                                      hasViolation && 'ring-1 ring-red-500',
                                      isLastDay && isCycleEnd && 'border-r-2 border-r-purple-400 dark:border-r-purple-500',
                                      isLastDay && !isCycleEnd && wIdx < totalSemanas - 1 && 'border-r',
                                    )}
                                    title={simbolo === 'DT' ? 'Dom trabalhado' : simbolo === 'DF' ? 'Dom folga' : simbolo === 'FV' ? 'Folga variável' : simbolo === 'FF' ? 'Folga fixa' : 'Trabalha'}
                                  >
                                    {sigla}
                                  </TableCell>
                                )
                              }),
                            )}
                          </TableRow>
                        ))}
                        <TableRow className="border-t-2 bg-muted/20">
                          <TableCell className="sticky left-0 z-10 w-[100px] min-w-[100px] truncate bg-muted font-medium text-blue-600 dark:text-blue-400">
                            COBERTURA
                          </TableCell>
                          <TableCell colSpan={2} className="sticky left-[100px] z-10 border-r bg-muted" />
                          {resultado.cobertura_dia.flatMap((cob, wIdx) =>
                            cob.cobertura.map((val, dIdx) => {
                              const isLastDay = dIdx === 6
                              const totalSemanas = resultado.cobertura_dia.length
                              const isCycleEnd =
                                resultado.ciclo_semanas > 0 &&
                                (wIdx + 1) % resultado.ciclo_semanas === 0 &&
                                wIdx < totalSemanas - 1
                              return (
                                <TableCell
                                  key={`${wIdx}-${dIdx}`}
                                  className={cn(
                                    'w-9 min-w-[36px] px-0 py-1 text-center text-xs font-bold',
                                    dIdx === 6 ? (val >= K ? 'text-blue-600 dark:text-blue-400' : 'text-red-500') : 'text-muted-foreground',
                                    isLastDay && isCycleEnd && 'border-r-2 border-r-purple-400 dark:border-r-purple-500',
                                    isLastDay && !isCycleEnd && wIdx < totalSemanas - 1 && 'border-r',
                                  )}
                                >
                                  {val}
                                </TableCell>
                              )
                            }),
                          )}
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* Legenda */}
                <div className="flex flex-wrap items-center gap-4 pt-1 text-xs text-muted-foreground">
                  {(['T', 'FF', 'FV', 'DT', 'DF'] as const).map((simbolo) => (
                    <span key={simbolo} className="inline-flex items-center gap-1.5">
                      <span
                        className={cn(
                          'flex size-4 items-center justify-center rounded-sm text-[7px] font-bold',
                          CELULA_CLASSES[simbolo],
                        )}
                      >
                        {simbolo === 'DT' ? 'T' : simbolo === 'DF' ? 'F' : simbolo}
                      </span>
                      <span>
                        {simbolo === 'T' && 'Trabalho'}
                        {simbolo === 'FF' && 'Folga fixa'}
                        {simbolo === 'FV' && 'Folga variável'}
                        {simbolo === 'DT' && 'Dom trabalhado'}
                        {simbolo === 'DF' && 'Dom folga'}
                      </span>
                    </span>
                  ))}
                  {cicloMode === 'resumo' && resultado.ciclo_semanas > 0 && (
                    <span className="inline-flex items-center gap-1.5 border-l border-border pl-4">
                      <span className="h-3 w-0.5 rounded-full bg-purple-400 dark:bg-purple-500" />
                      <span>Fim do ciclo</span>
                    </span>
                  )}
                </div>
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
