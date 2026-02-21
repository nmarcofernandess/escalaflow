# Prompt: Visualizacao Timeline/Gantt para Escalas

## Contexto do Projeto

EscalaFlow e um app desktop Electron para gerar escalas de trabalho de supermercado. Stack: React 19 + Vite + Tailwind + shadcn/ui + Zustand. Backend: IPC via @egoist/tipc + better-sqlite3.

O sistema ja gera escalas automaticas com um motor que respeita regras CLT. Cada escala tem alocacoes (colaborador + dia + hora_inicio + hora_fim). Hoje a visualizacao da escala e uma **grade tabular** (EscalaGrid) — linhas = colaboradores, colunas = dias da semana, celulas = horario alocado.

## O Pedido

Quero avaliar e projetar uma **visualizacao estilo timeline/Gantt** para as escalas. A ideia e que, em vez de (ou alem de) uma grade tabular, o usuario veja barras horizontais representando os turnos de cada colaborador ao longo do dia, tipo:

```
06:00  08:00  10:00  12:00  14:00  16:00  18:00  20:00  22:00
  |      |      |      |      |      |      |      |      |
  Maria  ████████████████░░░░░████████████████
  Joao          ░░░░░░░░████████████████████████
  Carlos ████████████████████████
```

Cada barra = um turno alocado. Cor pode indicar setor, tipo de contrato, ou status. O eixo X e o horario de funcionamento do setor. O eixo Y sao os colaboradores.

## O que Preciso de Voce

### 1. Analise de Mercado (Red Pill)
- Como apps de escala (When I Work, Deputy, Sling, Homebase) fazem a timeline?
- Existe padrao UI consolidado pra esse tipo de visualizacao?
- Libs React relevantes pra isso (react-big-calendar, vis-timeline, custom com CSS grid)?

### 2. Analise Tecnica
- Dado que os dados ja existem (Alocacao[]), qual a melhor forma de renderizar?
- CSS Grid puro vs lib externa? Trade-offs
- Performance: quantos colaboradores/dias antes de travar?
- Responsividade: como funciona em tela menor?

### 3. Proposta de Implementacao
- Arquitetura do componente (props, state, interacoes)
- Como integrar com EscalaPagina existente (tab extra? substituicao?)
- Interacoes: hover pra detalhes? click pra editar? drag pra mover turno?
- Dark mode (o sistema ja usa dark mode completo)

### 4. Mockup Conceitual
- Descreva o layout visual em detalhe (ou gere um ASCII/diagrama)
- Quais informacoes mostrar no hover/tooltip
- Como lidar com intervalos (almoco, folga)

## Dados Disponíveis

```typescript
interface Alocacao {
  id: number
  escala_id: number
  colaborador_id: number
  dia: string          // "2026-03-01"
  hora_inicio: string  // "08:00"
  hora_fim: string     // "14:00"
  tipo: 'GERADA' | 'MANUAL' | 'PINNED'
}

interface Colaborador {
  id: number
  nome: string
  sexo: 'M' | 'F'
  setor_id: number
  tipo_contrato_id: number
  prefere_turno: 'MANHA' | 'TARDE' | null
}

interface Setor {
  id: number
  nome: string
  hora_abertura: string  // "06:00"
  hora_fechamento: string // "22:00"
}
```

## Restricoes
- Electron desktop (nao web responsivo mobile)
- shadcn/ui + Tailwind (sem Material UI, Chakra, etc)
- Pode usar lib externa se justificado, mas prefiro CSS Grid puro se viavel
- Dark mode obrigatorio
- Usuarios nao-tecnicos (pais do dono — RH de supermercado)

## Entregavel Esperado
Um documento `/analyst` completo com: analise de mercado, proposta tecnica, mockup, e plano de implementacao passo a passo. Nao precisa codar — so a spec.
