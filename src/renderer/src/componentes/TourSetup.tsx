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
          horario de funcionamento e demandas de cobertura.
        </p>
      </>
    ),
  },
  {
    targetId: TOUR_STEP_IDS.CONTENT_AREA,
    position: 'bottom',
    content: (
      <>
        <h3 className="font-semibold">Area de Conteudo</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Aqui ficam seus setores. Dentro de cada um, voce define quantas
          pessoas precisa por horario em cada dia da semana.
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
          Cadastre os funcionarios com nome, setor e tipo de contrato.
        </p>
      </>
    ),
  },
  {
    targetId: TOUR_STEP_IDS.CONTENT_AREA,
    position: 'bottom',
    content: (
      <>
        <h3 className="font-semibold">Contratos e Excecoes</h3>
        <p className="text-sm text-muted-foreground mt-1">
          O tipo de contrato define as regras da CLT (horas semanais,
          folgas obrigatorias). Voce pode configurar os tipos em{' '}
          <strong>Tipos de Contrato</strong> no menu de Configuracao, e
          registrar ferias e atestados como excecoes.
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
          Visao geral de todas as escalas geradas. Aqui voce acompanha
          todos os setores de uma vez — sem precisar entrar em cada um.
        </p>
      </>
    ),
  },
  {
    targetId: TOUR_STEP_IDS.CONTENT_AREA,
    position: 'bottom',
    content: (
      <>
        <h3 className="font-semibold">Escalas, Export e Avisos</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Cada escala tem abas de <strong>Horas</strong> e{' '}
          <strong>Avisos</strong>. Voce pode exportar em PDF, HTML ou CSV,
          alternar entre visualizacao em grade e linha do tempo, e
          selecionar varios setores para exportar de uma vez.
        </p>
      </>
    ),
  },
  {
    targetId: TOUR_STEP_IDS.FOOTER_MENU,
    position: 'top',
    content: (
      <>
        <h3 className="font-semibold">Menu Rapido</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Aqui voce muda o tema (claro/escuro), acessa configuracoes da
          empresa, e pode repetir este tour a qualquer hora em
          &quot;Como Funciona?&quot;.
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
