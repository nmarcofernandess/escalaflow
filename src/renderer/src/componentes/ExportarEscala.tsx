import type {
  Escala,
  Alocacao,
  Colaborador,
  Setor,
  Violacao,
  TipoContrato,
  Funcao,
  SetorHorarioSemana,
  RegraHorarioColaborador,
} from '@shared/index'
import { formatarData, REGRAS_TEXTO } from '@/lib/formatadores'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { EscalaCicloResumo } from '@/componentes/EscalaCicloResumo'
import { EscalaTimelineDiaria } from '@/componentes/EscalaTimelineDiaria'

interface ExportarEscalaProps {
  escala: Escala
  alocacoes: Alocacao[]
  colaboradores: Colaborador[]
  setor: Setor
  violacoes?: Violacao[]
  tiposContrato?: TipoContrato[]
  funcoes?: Funcao[]
  horariosSemana?: SetorHorarioSemana[]
  regrasPadrao?: RegraHorarioColaborador[]
  modo?: 'ciclo' | 'detalhado'
  incluirAvisos?: boolean
  incluirCiclo?: boolean
  incluirTimeline?: boolean
  modoRender?: 'view' | 'download'
}

const STATUS_BADGE: Record<string, string> = {
  RASCUNHO: 'border-warning/40 bg-warning/10 text-warning',
  OFICIAL: 'border-success/40 bg-success/10 text-success',
  ARQUIVADA: 'border-muted-foreground/30 bg-muted text-muted-foreground',
}

export function ExportarEscala({
  escala,
  alocacoes,
  colaboradores,
  setor,
  violacoes = [],
  tiposContrato = [],
  funcoes = [],
  horariosSemana = [],
  regrasPadrao = [],
  modo = 'ciclo',
  incluirAvisos,
  incluirCiclo,
  incluirTimeline,
}: ExportarEscalaProps) {
  const modoDetalhado = modo === 'detalhado'
  const mostrarCiclo = incluirCiclo ?? true
  const mostrarTimeline = incluirTimeline ?? modoDetalhado
  const deveIncluirAvisos = incluirAvisos ?? mostrarTimeline

  const violacoesHard = violacoes.filter((v) => v.severidade === 'HARD')
  const violacoesSoft = violacoes.filter((v) => v.severidade === 'SOFT')
  const violacoesResumo = violacoes.slice(0, 8)

  return (
    <div className="bg-white p-5 font-sans text-xs text-gray-900 print:p-0">
      {/* Header */}
      <div className="mb-4 border-b-2 border-gray-200 pb-3">
        <h1 className="mb-2 text-lg font-bold text-gray-900">
          ESCALA: {setor.nome.toUpperCase()}
        </h1>
        <div className="flex gap-4 text-xs text-gray-500">
          <span>
            <strong>Periodo:</strong> {formatarData(escala.data_inicio)} a {formatarData(escala.data_fim)}
          </span>
          {mostrarTimeline && (
            <span>
              <strong>Pontuacao:</strong> {escala.pontuacao ?? '-'}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <strong>Status:</strong>
            <Badge variant="outline" className={cn('text-[10px] py-0 px-1.5', STATUS_BADGE[escala.status])}>
              {escala.status}
            </Badge>
          </span>
        </div>
      </div>

      {/* Ciclo Rotativo */}
      {mostrarCiclo && (
        <div className="mb-6">
          <EscalaCicloResumo
            escala={escala}
            alocacoes={alocacoes}
            colaboradores={colaboradores}
            funcoes={funcoes}
            regrasPadrao={regrasPadrao}
            mostrarTodasSemanas
          />
        </div>
      )}

      {/* Timeline Diaria */}
      {mostrarTimeline && (
        <div className="mt-6">
          <EscalaTimelineDiaria
            escala={escala}
            alocacoes={alocacoes}
            colaboradores={colaboradores}
            setor={setor}
            tiposContrato={tiposContrato}
            funcoes={funcoes}
            horariosSemana={horariosSemana}
          />
        </div>
      )}

      {/* Summary warnings (cycle mode) */}
      {!mostrarTimeline && deveIncluirAvisos && violacoes.length > 0 && (
        <div className="mt-6 break-inside-avoid">
          <h2 className="mb-2.5 border-b border-gray-200 pb-1.5 text-sm font-semibold text-gray-900">
            Avisos ({violacoes.length})
          </h2>
          <p className="mb-2 text-[10px] text-gray-600">
            Criticas: {violacoesHard.length} | Alertas: {violacoesSoft.length}
          </p>
          {violacoesResumo.map((v, i) => (
            <div
              key={i}
              className={cn(
                'mb-1 rounded px-2.5 py-1.5 text-[10px]',
                v.severidade === 'HARD'
                  ? 'border border-red-200 bg-red-50 text-red-800'
                  : 'border border-amber-200 bg-amber-50 text-amber-800',
              )}
            >
              <strong>{v.colaborador_nome}</strong> — {v.mensagem || REGRAS_TEXTO[v.regra] || v.regra}
              {v.data && <span className="ml-2">({formatarData(v.data)})</span>}
            </div>
          ))}
          {violacoes.length > violacoesResumo.length && (
            <p className="mt-1 text-[10px] text-gray-500">
              ... e mais {violacoes.length - violacoesResumo.length} aviso(s).
            </p>
          )}
        </div>
      )}

      {/* Detailed violations */}
      {mostrarTimeline && deveIncluirAvisos && violacoes.length > 0 && (
        <div className="mt-6 break-inside-avoid">
          <h2 className="mb-2.5 border-b border-gray-200 pb-1.5 text-sm font-semibold text-gray-900">
            Violacoes ({violacoes.length})
          </h2>
          {violacoesHard.length > 0 && (
            <div className="mb-3">
              <h3 className="mb-1.5 text-xs font-semibold text-red-600">
                Criticas (HARD)
              </h3>
              {violacoesHard.map((v, i) => (
                <div key={i} className="mb-1 rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-[10px] text-red-800">
                  <strong>{v.colaborador_nome}</strong> — {v.mensagem || REGRAS_TEXTO[v.regra] || v.regra}
                  {v.data && <span className="ml-2 text-red-700">({formatarData(v.data)})</span>}
                </div>
              ))}
            </div>
          )}
          {violacoesSoft.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-xs font-semibold text-amber-800">
                Alertas (SOFT)
              </h3>
              {violacoesSoft.map((v, i) => (
                <div key={i} className="mb-1 rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] text-amber-800">
                  <strong>{v.colaborador_nome}</strong> — {v.mensagem || REGRAS_TEXTO[v.regra] || v.regra}
                  {v.data && <span className="ml-2 text-amber-700">({formatarData(v.data)})</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="mt-5 flex items-center justify-between border-t border-gray-200 pt-3 text-[10px] text-gray-400">
        <div>
          <strong>Legenda:</strong>{' '}
          {mostrarTimeline
            ? 'F = Folga | I = Indisponivel | ALM = almoco | Pausa = intervalo 15min (CLT Art. 71) | Posto = posicao no fluxo'
            : 'T = Trabalho | F = Folga fixa | V = Folga variavel | I = Indisponivel'}
        </div>
        <div>
          Gerada em {new Date().toLocaleDateString('pt-BR')} | <strong>EscalaFlow v2</strong>
        </div>
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          @page {
            size: A4 landscape;
            margin: 10mm;
          }
          body {
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }
        }
      `}</style>
    </div>
  )
}
