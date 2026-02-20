import { useEffect, useMemo, useState } from 'react'
import { Split, MoveHorizontal, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import type { Setor, Demanda, SetorHorarioSemana, DiaSemana, SalvarTimelineDiaInput } from '@shared/index'
import { DIAS_SEMANA } from '@shared/constants'

interface Segmento {
  hora_inicio: string
  hora_fim: string
  min_pessoas: number
  override: boolean
}

interface DiaState {
  ativo: boolean
  usa_padrao: boolean
  hora_abertura: string
  hora_fechamento: string
  segmentos: Segmento[]
}

interface DemandaTimelineSingleLaneProps {
  setor: Setor
  demandas: Demanda[]
  horariosSemana: SetorHorarioSemana[]
  onSalvarDia: (data: SalvarTimelineDiaInput) => Promise<void>
}

const DIA_LABEL: Record<DiaSemana, string> = {
  SEG: 'Seg',
  TER: 'Ter',
  QUA: 'Qua',
  QUI: 'Qui',
  SEX: 'Sex',
  SAB: 'Sab',
  DOM: 'Dom',
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function toHHMM(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function buildDefaultSegment(setor: Setor, abertura: string, fechamento: string): Segmento {
  void setor
  return {
    hora_inicio: abertura,
    hora_fim: fechamento,
    min_pessoas: 1,
    override: false,
  }
}

export function DemandaTimelineSingleLane({
  setor,
  demandas,
  horariosSemana,
  onSalvarDia,
}: DemandaTimelineSingleLaneProps) {
  const [tab, setTab] = useState<'PADRAO' | DiaSemana>('PADRAO')
  const [diasState, setDiasState] = useState<Record<DiaSemana, DiaState>>(() => ({
    SEG: { ativo: true, usa_padrao: false, hora_abertura: setor.hora_abertura, hora_fechamento: setor.hora_fechamento, segmentos: [buildDefaultSegment(setor, setor.hora_abertura, setor.hora_fechamento)] },
    TER: { ativo: true, usa_padrao: true, hora_abertura: setor.hora_abertura, hora_fechamento: setor.hora_fechamento, segmentos: [buildDefaultSegment(setor, setor.hora_abertura, setor.hora_fechamento)] },
    QUA: { ativo: true, usa_padrao: true, hora_abertura: setor.hora_abertura, hora_fechamento: setor.hora_fechamento, segmentos: [buildDefaultSegment(setor, setor.hora_abertura, setor.hora_fechamento)] },
    QUI: { ativo: true, usa_padrao: true, hora_abertura: setor.hora_abertura, hora_fechamento: setor.hora_fechamento, segmentos: [buildDefaultSegment(setor, setor.hora_abertura, setor.hora_fechamento)] },
    SEX: { ativo: true, usa_padrao: true, hora_abertura: setor.hora_abertura, hora_fechamento: setor.hora_fechamento, segmentos: [buildDefaultSegment(setor, setor.hora_abertura, setor.hora_fechamento)] },
    SAB: { ativo: true, usa_padrao: true, hora_abertura: setor.hora_abertura, hora_fechamento: setor.hora_fechamento, segmentos: [buildDefaultSegment(setor, setor.hora_abertura, setor.hora_fechamento)] },
    DOM: { ativo: true, usa_padrao: true, hora_abertura: setor.hora_abertura, hora_fechamento: setor.hora_fechamento, segmentos: [buildDefaultSegment(setor, setor.hora_abertura, setor.hora_fechamento)] },
  }))
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    const next: Record<DiaSemana, DiaState> = {} as Record<DiaSemana, DiaState>
    const demandasPorDia = new Map<DiaSemana, Segmento[]>()

    for (const dia of DIAS_SEMANA) {
      const segs = demandas
        .filter((d) => d.dia_semana === dia)
        .sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio))
        .map((d) => ({
          hora_inicio: d.hora_inicio,
          hora_fim: d.hora_fim,
          min_pessoas: d.min_pessoas,
          override: Boolean(d.override),
        }))
      demandasPorDia.set(dia, segs)
    }

    for (const dia of DIAS_SEMANA) {
      const horario = horariosSemana.find((h) => h.dia_semana === dia)
      const abertura = horario?.hora_abertura ?? setor.hora_abertura
      const fechamento = horario?.hora_fechamento ?? setor.hora_fechamento
      const ativos = Boolean(horario?.ativo ?? true)
      const usaPadrao = dia === 'SEG' ? false : Boolean(horario?.usa_padrao ?? true)
      const segs = demandasPorDia.get(dia) ?? []

      next[dia] = {
        ativo: ativos,
        usa_padrao: usaPadrao,
        hora_abertura: abertura,
        hora_fechamento: fechamento,
        segmentos: segs.length > 0 ? segs : (ativos ? [buildDefaultSegment(setor, abertura, fechamento)] : []),
      }
    }

    setDiasState(next)
    setSelectedIdx(0)
  }, [demandas, horariosSemana, setor])

  const diaAtual: DiaSemana = tab === 'PADRAO' ? 'SEG' : tab
  const baseDia = diasState[diaAtual]
  const usandoPadrao = diaAtual !== 'SEG' && baseDia.usa_padrao
  const diaRender: DiaState = usandoPadrao ? { ...diasState.SEG, usa_padrao: true } : baseDia
  const podeEditarSegmento = diaAtual === 'SEG' || !baseDia.usa_padrao

  const totalMin = useMemo(() => {
    return Math.max(30, toMin(diaRender.hora_fechamento) - toMin(diaRender.hora_abertura))
  }, [diaRender.hora_abertura, diaRender.hora_fechamento])

  const selected = diaRender.segmentos[selectedIdx]

  function updateDia(dia: DiaSemana, updater: (cur: DiaState) => DiaState) {
    setDiasState((prev) => ({ ...prev, [dia]: updater(prev[dia]) }))
  }

  function splitSegment() {
    if (!podeEditarSegmento) return
    const seg = baseDia.segmentos[selectedIdx]
    if (!seg) return
    const ini = toMin(seg.hora_inicio)
    const fim = toMin(seg.hora_fim)
    if (fim - ini < 60) {
      toast.error('Segmento muito curto para dividir')
      return
    }
    const mid = ini + Math.floor((fim - ini) / 60) * 30
    const left: Segmento = { ...seg, hora_inicio: toHHMM(ini), hora_fim: toHHMM(mid) }
    const right: Segmento = { ...seg, hora_inicio: toHHMM(mid), hora_fim: toHHMM(fim) }
    updateDia(diaAtual, (cur) => {
      const segs = [...cur.segmentos]
      segs.splice(selectedIdx, 1, left, right)
      return { ...cur, segmentos: segs }
    })
  }

  function mergeWithNext() {
    if (!podeEditarSegmento) return
    if (selectedIdx >= baseDia.segmentos.length - 1) return
    updateDia(diaAtual, (cur) => {
      const segs = [...cur.segmentos]
      const atual = segs[selectedIdx]
      const prox = segs[selectedIdx + 1]
      segs.splice(selectedIdx, 2, {
        ...atual,
        hora_fim: prox.hora_fim,
      })
      return { ...cur, segmentos: segs }
    })
  }

  function moveBoundary(delta: -30 | 30) {
    if (!podeEditarSegmento) return
    if (selectedIdx >= baseDia.segmentos.length - 1) return
    updateDia(diaAtual, (cur) => {
      const segs = [...cur.segmentos]
      const left = segs[selectedIdx]
      const right = segs[selectedIdx + 1]
      const newBoundary = toMin(right.hora_inicio) + delta
      if (newBoundary <= toMin(left.hora_inicio) || newBoundary >= toMin(right.hora_fim)) return cur
      if (newBoundary - toMin(left.hora_inicio) < 30) return cur
      if (toMin(right.hora_fim) - newBoundary < 30) return cur
      left.hora_fim = toHHMM(newBoundary)
      right.hora_inicio = toHHMM(newBoundary)
      return { ...cur, segmentos: segs }
    })
  }

  function updatePessoas(delta: number) {
    if (!podeEditarSegmento) return
    updateDia(diaAtual, (cur) => {
      const segs = [...cur.segmentos]
      const seg = segs[selectedIdx]
      if (!seg) return cur
      seg.min_pessoas = Math.max(1, seg.min_pessoas + delta)
      return { ...cur, segmentos: segs }
    })
  }

  function updateOverride(value: boolean) {
    if (!podeEditarSegmento) return
    updateDia(diaAtual, (cur) => {
      const segs = [...cur.segmentos]
      const seg = segs[selectedIdx]
      if (!seg) return cur
      seg.override = value
      return { ...cur, segmentos: segs }
    })
  }

  function applyPadraoToDia(dia: DiaSemana) {
    updateDia(dia, (cur) => ({
      ...cur,
      hora_abertura: diasState.SEG.hora_abertura,
      hora_fechamento: diasState.SEG.hora_fechamento,
      segmentos: diasState.SEG.segmentos.map((s) => ({ ...s })),
    }))
  }

  async function salvarDia(targetDia: DiaSemana) {
    const diaData = diasState[targetDia]
    const payloadSource = targetDia !== 'SEG' && diaData.usa_padrao ? diasState.SEG : diaData

    setSalvando(true)
    try {
      await onSalvarDia({
        setor_id: setor.id,
        dia_semana: targetDia,
        ativo: diaData.ativo,
        usa_padrao: diaData.usa_padrao,
        hora_abertura: payloadSource.hora_abertura,
        hora_fechamento: payloadSource.hora_fechamento,
        segmentos: diaData.ativo
          ? payloadSource.segmentos.map((s) => ({
              hora_inicio: s.hora_inicio,
              hora_fim: s.hora_fim,
              min_pessoas: s.min_pessoas,
              override: s.override,
            }))
          : [],
      })
      toast.success(`Demanda ${targetDia} salva`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar timeline')
    } finally {
      setSalvando(false)
    }
  }

  async function salvarSemana() {
    for (const dia of DIAS_SEMANA) {
      // eslint-disable-next-line no-await-in-loop
      await salvarDia(dia)
    }
  }

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(v) => { setTab(v as 'PADRAO' | DiaSemana); setSelectedIdx(0) }}>
        <TabsList>
          <TabsTrigger value="PADRAO">Padrao</TabsTrigger>
          {DIAS_SEMANA.map((d) => (
            <TabsTrigger key={d} value={d}>
              {DIA_LABEL[d]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="grid gap-3 rounded-lg border p-3 md:grid-cols-2">
        <div className="flex items-center gap-2">
          <Switch
            checked={baseDia.ativo}
            onCheckedChange={(v) => updateDia(diaAtual, (cur) => ({ ...cur, ativo: v }))}
            disabled={diaAtual === 'SEG' && tab === 'PADRAO'}
          />
          <Label>Dia ativo</Label>
        </div>
        {diaAtual !== 'SEG' && (
          <div className="flex items-center gap-2">
            <Switch
              checked={baseDia.usa_padrao}
              onCheckedChange={(v) => {
                updateDia(diaAtual, (cur) => ({ ...cur, usa_padrao: v }))
                if (v) applyPadraoToDia(diaAtual)
              }}
            />
            <Label>Usa padrao semanal</Label>
          </div>
        )}
        <div>
          <Label>Hora abertura</Label>
          <Input
            type="time"
            value={diaRender.hora_abertura}
            disabled={!podeEditarSegmento || !baseDia.ativo}
            onChange={(e) => updateDia(diaAtual, (cur) => ({ ...cur, hora_abertura: e.target.value }))}
          />
        </div>
        <div>
          <Label>Hora fechamento</Label>
          <Input
            type="time"
            value={diaRender.hora_fechamento}
            disabled={!podeEditarSegmento || !baseDia.ativo}
            onChange={(e) => updateDia(diaAtual, (cur) => ({ ...cur, hora_fechamento: e.target.value }))}
          />
        </div>
      </div>

      {baseDia.ativo ? (
        <>
          <div className="space-y-2 rounded-lg border p-3">
            <div className="flex h-16 overflow-hidden rounded-md border bg-muted/20">
              {diaRender.segmentos.map((s, i) => {
                const dur = Math.max(30, toMin(s.hora_fim) - toMin(s.hora_inicio))
                const pct = (dur / totalMin) * 100
                return (
                  <button
                    key={`${s.hora_inicio}-${s.hora_fim}-${i}`}
                    type="button"
                    style={{ width: `${pct}%` }}
                    onClick={() => setSelectedIdx(i)}
                    className={`h-full border-r px-2 text-left text-xs ${selectedIdx === i ? 'bg-primary/20' : 'bg-background'} ${podeEditarSegmento ? 'cursor-pointer' : 'cursor-default'}`}
                  >
                    <p className="font-medium">{s.hora_inicio}-{s.hora_fim}</p>
                    <p>{s.min_pessoas} pessoas</p>
                    {s.override && <Badge variant="secondary" className="mt-1 text-[10px]">override</Badge>}
                  </button>
                )
              })}
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{diaRender.hora_abertura}</span>
              <span>{diaRender.hora_fechamento}</span>
            </div>
          </div>

          {selected && (
            <div className="grid gap-3 rounded-lg border p-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Segmento selecionado</Label>
                <p className="text-sm text-muted-foreground">{selected.hora_inicio} - {selected.hora_fim}</p>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => updatePessoas(-1)} disabled={!podeEditarSegmento}>-</Button>
                  <span className="min-w-12 text-center text-sm font-medium">{selected.min_pessoas}</span>
                  <Button size="sm" variant="outline" onClick={() => updatePessoas(1)} disabled={!podeEditarSegmento}>+</Button>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={selected.override} onCheckedChange={updateOverride} disabled={!podeEditarSegmento} />
                  <Label>Override quasi-hard</Label>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Acoes</Label>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={splitSegment} disabled={!podeEditarSegmento}>
                    <Split className="mr-1 size-3.5" /> Dividir
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => moveBoundary(-30)} disabled={!podeEditarSegmento || selectedIdx >= diaRender.segmentos.length - 1}>
                    <MoveHorizontal className="mr-1 size-3.5" /> Divisor -30
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => moveBoundary(30)} disabled={!podeEditarSegmento || selectedIdx >= diaRender.segmentos.length - 1}>
                    <MoveHorizontal className="mr-1 size-3.5" /> Divisor +30
                  </Button>
                  <Button size="sm" variant="outline" onClick={mergeWithNext} disabled={!podeEditarSegmento || selectedIdx >= diaRender.segmentos.length - 1}>
                    Unir com proximo
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Dia inativo: timeline fechada.</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => salvarDia(diaAtual)} disabled={salvando}>
          <Save className="mr-1 size-3.5" />
          Salvar dia
        </Button>
        <Button size="sm" variant="outline" onClick={salvarSemana} disabled={salvando}>
          Salvar semana inteira
        </Button>
      </div>
    </div>
  )
}
