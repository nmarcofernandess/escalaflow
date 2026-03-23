import { useEffect } from 'react'
import { useTour, type TourStep } from './Tour'
import { TOUR_STEP_IDS, TOUR_NAVIGATE_EVENT } from '@/lib/tour-constants'

function navigateTo(path: string) {
  window.dispatchEvent(
    new CustomEvent(TOUR_NAVIGATE_EVENT, { detail: { path } }),
  )
}

const tourSteps: TourStep[] = [
  // 1. Welcome
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
  // 2. Menu Principal
  {
    targetId: TOUR_STEP_IDS.NAV_PRINCIPAL,
    position: 'right',
    content: (
      <>
        <h3 className="font-semibold">Menu Principal</h3>
        <p className="text-sm text-muted-foreground mt-1">
          O fluxo recomendado para comecar:
        </p>
        <ol className="text-sm text-muted-foreground mt-1 list-decimal pl-4 flex flex-col gap-0.5">
          <li>Cadastre os <strong>Setores</strong> (departamentos)</li>
          <li>Cadastre os <strong>Colaboradores</strong></li>
          <li>Gere a <strong>Escala</strong> dentro de cada setor</li>
          <li>Use o <strong>Hub de Escalas</strong> quando precisar de export em lote</li>
        </ol>
      </>
    ),
  },
  // 3. Setores nav
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
  // 4. Content Setores
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
  // 5. Colaboradores nav
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
  // 6. Content Colaboradores (EDITADO — regras individuais expandidas)
  {
    targetId: TOUR_STEP_IDS.CONTENT_AREA,
    position: 'bottom',
    content: (
      <>
        <h3 className="font-semibold">Perfil Individual</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Cada colaborador tem um perfil configuravel. Dentro dele voce pode:
        </p>
        <ul className="text-sm text-muted-foreground mt-1 list-disc pl-4 flex flex-col gap-0.5">
          <li>Registrar <strong>ferias e atestados</strong> como excecoes</li>
          <li>Definir <strong>horario de trabalho</strong> por dia da semana (arraste a barra)</li>
          <li>Configurar <strong>ciclo de domingo</strong> (1 a cada N semanas)</li>
          <li>Marcar <strong>folga fixa</strong> em dia especifico da semana</li>
          <li>Criar <strong>excecoes por data</strong> (overrides pontuais)</li>
        </ul>
      </>
    ),
  },
  // 7. Hub de escalas (acesso avancado)
  {
    targetId: TOUR_STEP_IDS.FOOTER_MENU,
    position: 'right',
    onEnter: () => navigateTo('/configuracoes'),
    content: (
      <>
        <h3 className="font-semibold">Hub de Escalas</h3>
        <p className="text-sm text-muted-foreground mt-1">
          O Hub continua disponivel como recurso avancado para visao
          consolidada e exportacao em lote de varios setores.
        </p>
      </>
    ),
  },
  // 8. Content Escalas
  {
    targetId: TOUR_STEP_IDS.CONTENT_AREA,
    position: 'bottom',
    content: (
      <>
        <h3 className="font-semibold">Gerar, Ajustar e Exportar</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Dentro de cada escala voce gera, ajusta manualmente na
          timeline, exporta (PDF, HTML, CSV) e oficializa.
        </p>
        <ul className="text-sm text-muted-foreground mt-1 list-disc pl-4 flex flex-col gap-0.5">
          <li>
            <strong>Badge de compliance</strong> mostra aderencia por
            categoria (CLT, Otimização, Boas Práticas)
          </li>
          <li>
            <strong>Config por geracao</strong> (botao &#9881;&#65039;) — estrategia,
            tempo limite e quais regras aplicar
          </li>
        </ul>
      </>
    ),
  },
  // 9. Feriados nav
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
  // 10. Footer Menu
  {
    targetId: TOUR_STEP_IDS.FOOTER_MENU,
    position: 'right',
    content: (
      <>
        <h3 className="font-semibold">Menu Inferior</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Aqui voce acessa:
        </p>
        <ul className="text-sm text-muted-foreground mt-1 list-disc pl-4 flex flex-col gap-0.5">
          <li><strong>Empresa</strong> — dados cadastrais e horarios de funcionamento</li>
          <li><strong>Configuracoes</strong> — chave de IA, provedor, tema e backup</li>
          <li><strong>Tema</strong> — alterne entre claro e escuro</li>
        </ul>
      </>
    ),
  },
  // 11. IA Toggle
  {
    targetId: TOUR_STEP_IDS.IA_TOGGLE,
    position: 'bottom',
    content: (
      <>
        <h3 className="font-semibold">Assistente IA</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Use <strong>Cmd+J</strong> ou clique aqui para abrir o chat.
          A IA conhece todo o contexto do seu supermercado e pode:
        </p>
        <ul className="text-sm text-muted-foreground mt-1 list-disc pl-4 flex flex-col gap-0.5">
          <li>Gerar escalas e explicar violacoes</li>
          <li>Cadastrar ferias, atestados e excecoes</li>
          <li>Ajustar horarios e alocacoes</li>
          <li>Tirar duvidas sobre regras CLT</li>
        </ul>
        <p className="text-sm text-muted-foreground mt-1">
          O historico de conversas fica salvo automaticamente.
        </p>
      </>
    ),
  },
  // 12. Encerramento
  {
    targetId: TOUR_STEP_IDS.CONTENT_AREA,
    position: 'bottom',
    content: (
      <>
        <h3 className="font-semibold">Pronto!</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Voce pode revisitar esse tour a qualquer momento pelo menu
          inferior. Se tiver duvidas, a IA esta ali pra ajudar.
          Bom trabalho!
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
