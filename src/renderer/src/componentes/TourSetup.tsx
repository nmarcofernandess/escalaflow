import { useEffect } from 'react'
import { useTour, type TourStep } from './Tour'
import { TOUR_STEP_IDS, TOUR_NAVIGATE_EVENT } from '@/lib/tour-constants'

function navigateTo(path: string) {
  window.dispatchEvent(
    new CustomEvent(TOUR_NAVIGATE_EVENT, { detail: { path } }),
  )
}

const tourSteps: TourStep[] = [
  {
    targetId: TOUR_STEP_IDS.SIDEBAR_HEADER,
    position: 'right',
    content: (
      <>
        <h3 className="font-semibold">Bem-vindo ao EscalaFlow!</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Seu assistente para criar escalas de trabalho automaticamente.
          O sistema propoe a escala ideal — voce so ajusta se quiser.
        </p>
      </>
    ),
  },
  {
    targetId: TOUR_STEP_IDS.NAV_PRINCIPAL,
    position: 'right',
    content: (
      <>
        <h3 className="font-semibold">Menu Principal</h3>
        <p className="text-sm text-muted-foreground mt-1">
          O fluxo recomendado para comecar:
        </p>
        <ol className="text-sm text-muted-foreground mt-1 list-decimal pl-4 space-y-0.5">
          <li>Cadastre os <strong>Setores</strong> (departamentos)</li>
          <li>Cadastre os <strong>Colaboradores</strong></li>
          <li>Gere a <strong>Escala</strong> dentro de cada setor</li>
          <li>Acompanhe tudo no <strong>Hub de Escalas</strong></li>
        </ol>
      </>
    ),
  },
  {
    targetId: TOUR_STEP_IDS.NAV_SETORES,
    position: 'right',
    onEnter: () => navigateTo('/setores'),
    content: (
      <>
        <h3 className="font-semibold">Setores</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Comece cadastrando os setores (departamentos). Cada setor tem
          horario de funcionamento e demandas de cobertura por faixa horaria.
        </p>
      </>
    ),
  },
  {
    targetId: TOUR_STEP_IDS.CONTENT_AREA,
    position: 'bottom',
    content: (
      <>
        <h3 className="font-semibold">Gerencie seus Setores</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Dentro de cada setor voce define horarios de funcionamento,
          postos de trabalho e quantas pessoas precisa em cada faixa
          horaria de cada dia da semana.
        </p>
      </>
    ),
  },
  {
    targetId: TOUR_STEP_IDS.NAV_COLABORADORES,
    position: 'right',
    onEnter: () => navigateTo('/colaboradores'),
    content: (
      <>
        <h3 className="font-semibold">Colaboradores</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Cadastre os funcionarios com nome, setor e tipo de contrato CLT.
          O contrato define automaticamente as regras de jornada.
        </p>
      </>
    ),
  },
  {
    targetId: TOUR_STEP_IDS.CONTENT_AREA,
    position: 'bottom',
    content: (
      <>
        <h3 className="font-semibold">Contratos, Excecoes e Regras</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Registre ferias e atestados como excecoes, configure janelas de
          horario preferidas e ciclos de domingo por colaborador. Os tipos
          de contrato ficam em <strong>Tipos de Contrato</strong> no menu
          de Configuracao.
        </p>
      </>
    ),
  },
  {
    targetId: TOUR_STEP_IDS.NAV_ESCALAS,
    position: 'right',
    onEnter: () => navigateTo('/escalas'),
    content: (
      <>
        <h3 className="font-semibold">Hub de Escalas</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Visao geral de todas as escalas geradas. Acompanhe todos os
          setores de uma vez — sem precisar entrar em cada um.
        </p>
      </>
    ),
  },
  {
    targetId: TOUR_STEP_IDS.CONTENT_AREA,
    position: 'bottom',
    content: (
      <>
        <h3 className="font-semibold">Gerar, Ajustar e Exportar</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Dentro de cada escala voce gera, ajusta manualmente, exporta
          (PDF, HTML, CSV) e oficializa. O botao{' '}
          <strong>⚙️</strong> abre as configuracoes do motor por geracao —
          estrategia, tempo limite e quais regras aplicar.
        </p>
      </>
    ),
  },
  {
    targetId: TOUR_STEP_IDS.NAV_FERIADOS,
    position: 'right',
    content: (
      <>
        <h3 className="font-semibold">Feriados</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Calendario de feriados integrado ao motor. Datas marcadas como
          bloqueadas pela CCT (25/12 e 01/01) impedem alocacao
          automaticamente.
        </p>
      </>
    ),
  },
  {
    targetId: TOUR_STEP_IDS.NAV_REGRAS,
    position: 'right',
    content: (
      <>
        <h3 className="font-semibold">Regras</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Controle granular do motor: ative, desative ou suavize cada
          regra CLT e antipadrao individualmente — sem precisar recompilar
          nada.
        </p>
      </>
    ),
  },
  {
    targetId: TOUR_STEP_IDS.IA_TOGGLE,
    position: 'bottom',
    content: (
      <>
        <h3 className="font-semibold">Assistente IA</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Clique aqui ou use <strong>Cmd+J</strong> para abrir o chat com
          a IA. Ela conhece o contexto das suas escalas e o historico de
          conversa fica salvo automaticamente.
        </p>
      </>
    ),
  },
]

export function TourSetup() {
  const { setSteps } = useTour()

  useEffect(() => {
    setSteps(tourSteps)
  }, [setSteps])

  return null
}
