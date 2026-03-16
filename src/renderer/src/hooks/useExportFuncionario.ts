import { useState, useCallback } from 'react'
import { escalasService } from '@/servicos/escalas'
import { colaboradoresService } from '@/servicos/colaboradores'
import { setoresService } from '@/servicos/setores'
import { useAppDataStore } from '@/store/appDataStore'
import type {
  Colaborador,
  Setor,
  Escala,
  Alocacao,
  Violacao,
  TipoContrato,
  RegraHorarioColaborador,
} from '@shared/index'

// ---------------------------------------------------------------------------
// useExportFuncionario — lazy-loads all data needed to export a single
// employee's schedule (Mode B of the export system).
// ---------------------------------------------------------------------------

export interface FuncionarioExportData {
  colaborador: Colaborador
  setor: Setor
  escala: Escala
  alocacoes: Alocacao[]
  violacoes: Violacao[]
  tipoContrato: TipoContrato
  regra?: RegraHorarioColaborador
}

export function useExportFuncionario() {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<FuncionarioExportData | null>(null)
  const [hasOficial, setHasOficial] = useState<boolean | null>(null)

  const tiposContrato = useAppDataStore((s) => s.tiposContrato)

  // Quick check: does this setor have an OFICIAL escala?
  const verificar = useCallback(async (setorId: number) => {
    try {
      const escalas = await escalasService.listarPorSetor(setorId, { status: 'OFICIAL' })
      const found = escalas.length > 0
      setHasOficial(found)
      return found
    } catch {
      setHasOficial(false)
      return false
    }
  }, [])

  // Full load: escala completa + filter for collaborator
  const carregar = useCallback(
    async (colabId: number, setorId: number) => {
      setLoading(true)
      setData(null)
      try {
        // 1. Find the most recent OFICIAL escala for the setor
        const escalas = await escalasService.listarPorSetor(setorId, { status: 'OFICIAL' })
        const oficial = escalas
          .sort((a, b) => b.id - a.id)
          .find((e) => e.status === 'OFICIAL')

        if (!oficial) {
          setHasOficial(false)
          return null
        }

        setHasOficial(true)

        // 2. Load full escala + collaborator details + setor + regras in parallel
        const [completa, colaborador, setor, regras] = await Promise.all([
          escalasService.buscar(oficial.id),
          colaboradoresService.buscar(colabId),
          setoresService.buscar(setorId),
          colaboradoresService.buscarRegraHorario(colabId),
        ])

        // 3. Filter alocacoes and violacoes for this collaborator
        const alocacoes = completa.alocacoes.filter(
          (a) => a.colaborador_id === colabId,
        )
        const violacoes = completa.violacoes.filter(
          (v) => v.colaborador_id === colabId,
        )

        // 4. Resolve tipo contrato from cached store data
        const tipoContrato = tiposContrato.find(
          (tc) => tc.id === colaborador.tipo_contrato_id,
        )

        if (!tipoContrato) {
          console.error(
            `[useExportFuncionario] tipo_contrato_id=${colaborador.tipo_contrato_id} not found`,
          )
          return null
        }

        // 5. Get the padrao regra (dia_semana_regra === null)
        const regraPadrao = regras.find((r) => r.dia_semana_regra === null)

        const result: FuncionarioExportData = {
          colaborador,
          setor,
          escala: completa.escala,
          alocacoes,
          violacoes,
          tipoContrato,
          regra: regraPadrao,
        }

        setData(result)
        return result
      } catch (err) {
        console.error('[useExportFuncionario] carregar falhou:', err)
        return null
      } finally {
        setLoading(false)
      }
    },
    [tiposContrato],
  )

  return { loading, data, hasOficial, verificar, carregar }
}
