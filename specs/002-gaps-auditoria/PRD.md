# PRD: Gaps de Auditoria — Backend Robusto + Export

> **Workflow:** standard
> **Criado em:** 2026-02-14
> **Fonte:** Auditoria cruzada ANALYST + BUILD docs vs codigo implementado
> **Referencia:** ANALYST_PROCESSO_USUARIO_MULTITENANCY.md + BUILD_V2_ESCALAFLOW.md

---

## Visao Geral

Auditoria revelou 6 gaps entre os docs de especificacao (ANALYST + BUILD) e a implementacao real. O motor de proposta (764 linhas) esta funcional e completo. O frontend tem 8 paginas prontas. Os gaps sao pontuais mas bloqueiam producao.

**Principio:** Corrigir sem reescrever. Todas as pecas existem — falta alinhar.

---

## Gap 1: Empresa — Schema Errado

### Problema

A tabela `empresa` no schema.ts tem `cidade TEXT, estado TEXT` mas os docs especificam `corte_semanal TEXT, tolerancia_semanal_min INTEGER`. O motor hardcoda tolerancia=30 em vez de ler do banco. O frontend (EmpresaConfig.tsx) renderiza campos que nao correspondem ao que o motor precisa.

### Fonte (BUILD doc secao 4.2 + 9.3)

```sql
CREATE TABLE IF NOT EXISTS empresa (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    corte_semanal TEXT NOT NULL DEFAULT 'SEG_DOM',
    tolerancia_semanal_min INTEGER NOT NULL DEFAULT 30
);
```

### O que fazer

1. **schema.ts**: Alterar DDL da tabela empresa — remover cidade/estado, adicionar corte_semanal e tolerancia_semanal_min
2. **seed.ts**: Alterar seed de empresa para `('Supermercado Fernandes', 'SEG_DOM', 30)`
3. **shared/types.ts**: Alterar interface Empresa — remover cidade/estado, adicionar corte_semanal e tolerancia_semanal_min
4. **routes/empresa.ts**: Ajustar GET/PUT para os novos campos
5. **motor/gerador.ts**: Ler tolerancia_semanal_min do banco em vez de hardcodar 30 (linha 525)
6. **web/paginas/EmpresaConfig.tsx**: Renderizar campos corretos (nome, corte_semanal, tolerancia_semanal_min)
7. **web/servicos/empresa.ts**: Ajustar se necessario (provavelmente nao — e generico)
8. **Deletar banco antigo** (ou fazer migration): Como e SQLite local sem dados reais, pode dropar e recriar

### Verificacao

- `npx tsc --noEmit` = 0 erros
- GET /api/empresa retorna `{ id, nome, corte_semanal, tolerancia_semanal_min }`
- PUT /api/empresa aceita os novos campos
- Motor le tolerancia do banco
- EmpresaConfig.tsx renderiza formulario correto

---

## Gap 2: Seed CLT — Dados Inconsistentes

### Problema

Os valores de seed dos tipos de contrato nao correspondem ao BUILD doc secao 4.4.

| Tipo | Campo | BUILD doc | Seed real | Correcao |
|------|-------|-----------|-----------|----------|
| CLT 44h | max_minutos_dia | 570 | 600 | Manter 600 (CLT max absoluto). BUILD doc tinha 570 como pratico mas 600 e mais seguro — o motor calcula o real a partir de horas_semanais/dias_trabalho |
| CLT 36h | dias_trabalho | 5 | 6 | **Corrigir para 5** |
| CLT 30h | max_minutos_dia | 360 | 480 | **Corrigir para 360** |
| CLT 30h | trabalha_domingo | true | false | **Corrigir para true (1)** |
| Estagiario 20h | max_minutos_dia | 240 | 360 | **Corrigir para 240** |

### O que fazer

1. **seed.ts**: Corrigir os 4 valores errados na array `tipos`
2. **Deletar banco** e rodar seed novamente (sem dados reais ainda)

### Verificacao

- Rodar seed, SELECT * FROM tipos_contrato — valores corretos
- Gerar escala com colaboradores de cada tipo — motor calcula turnos corretos

---

## Gap 3: EscalaCompleta — Adicionar Indicadores

### Problema

O BUILD doc define `EscalaCompleta` com campo `indicadores: Indicadores` contendo cobertura_percent, violacoes_hard, violacoes_soft, equilibrio, pontuacao. O motor JA calcula todos esses valores internamente (gerador.ts linhas 699-741) mas nao retorna na response. O frontend precisa deles para exibir os cards de indicadores na aba Simulacao.

### Fonte (BUILD doc secao 5.2)

```typescript
interface Indicadores {
  cobertura_percent: number      // 0-100
  violacoes_hard: number
  violacoes_soft: number
  equilibrio: number             // 0-100
  pontuacao: number              // 0-100
}

interface EscalaCompleta {
  escala: Escala
  alocacoes: Alocacao[]
  indicadores: Indicadores       // ← ADICIONAR
  violacoes: Violacao[]
}
```

### O que fazer

1. **shared/types.ts**: Adicionar interface `Indicadores` e campo `indicadores` em `EscalaCompleta`
2. **motor/gerador.ts**: Retornar indicadores no `MotorResultado` (ja calcula, so expor)
3. **routes/escalas.ts**: Incluir indicadores na response de gerar-escala
4. **routes/escalas.ts**: Incluir indicadores na response de GET /api/escalas/:id (recalcular ou persistir)
5. **web/paginas/EscalaPagina.tsx**: Consumir indicadores para exibir os 5 cards (pontuacao, cobertura, hard, soft, equilibrio)

### Decisao: persistir ou recalcular indicadores?

**Persistir** na tabela escalas (adicionar colunas cobertura, violacoes_hard, violacoes_soft, equilibrio) — mais simples que recalcular no GET.

### Verificacao

- POST gerar-escala retorna `{ escala, alocacoes, indicadores, violacoes }`
- GET /api/escalas/:id retorna indicadores
- EscalaPagina mostra 5 cards com valores reais

---

## Gap 4: Ajustar — Revalidar Apos Alteracao

### Problema

`POST /api/escalas/:id/ajustar` faz UPSERT das alocacoes mas NAO roda validacao nem recalcula pontuacao. Retorna `{ alocacoes }` sem violacoes. O BUILD doc (secao 7.2) diz: "Motor recalcula → retorna EscalaCompleta atualizada".

### O que fazer

1. **motor/gerador.ts ou motor/validador.ts**: Extrair funcao `validarEscala(escalaId, db)` que roda R1-R8 + scoring sobre alocacoes existentes no banco
2. **routes/escalas.ts**: Apos UPSERT, rodar validacao e retornar EscalaCompleta completa (com indicadores e violacoes)
3. **Atualizar pontuacao/indicadores na tabela escalas** apos ajuste

### Verificacao

- POST ajustar retorna `{ escala, alocacoes, indicadores, violacoes }` com dados atualizados
- Mudar TRABALHO→FOLGA em 7o dia consecutivo → violacao R1 desaparece
- Pontuacao atualiza apos ajuste
- `npx tsc --noEmit` = 0 erros

---

## Gap 5: Oficializar — Checar Violacoes HARD

### Problema

`PUT /api/escalas/:id/oficializar` tem `// TODO: checar violacoes HARD quando motor existir` (linha 98). O motor ja existe. O BUILD doc (secao 5.4) diz: 409 se tem violacao HARD.

### O que fazer

1. **routes/escalas.ts**: Antes de oficializar, rodar validacao. Se `violacoes_hard > 0`, retornar 409 com mensagem
2. Usar a mesma funcao `validarEscala()` do Gap 4

### Verificacao

- Tentar oficializar escala com violacao HARD → 409 "Escala tem N violacoes criticas. Corrija antes de oficializar."
- Oficializar escala sem HARD → 200 OK
- EscalaPagina.tsx: botao oficializar mostra toast de erro se 409

---

## Gap 6: ExportarEscala — Print HTML

### Problema

Nao existe funcionalidade de exportar escala para impressao. O BUILD doc marca como CRITICO (secao 10.3). O ANALYST doc diz: "colar na parede do supermercado" — e o output fisico do sistema.

### O que fazer

1. **web/componentes/ExportarEscala.tsx**: Componente que gera HTML self-contained (inline CSS, sem dependencias externas) com a grade da escala
2. Layout: tabela pessoa x dia com horarios, cores por status, header com setor + periodo + pontuacao, footer com legenda
3. **Botao "Imprimir"** na aba Oficial e na aba Simulacao da EscalaPagina
4. Usar `window.print()` com media query `@media print` ou gerar HTML e abrir em nova janela

### Wireframe do HTML exportado

```
┌──────────────────────────────────────────────────┐
│  ESCALA: CAIXA — 01/03 a 31/03/2026              │
│  Pontuacao: 87 | Status: OFICIAL                  │
├──────────┬─────┬─────┬─────┬─────┬─────┬─────┬──┤
│          │ SEG │ TER │ QUA │ QUI │ SEX │ SAB │DOM│
│          │ 01  │ 02  │ 03  │ 04  │ 05  │ 06  │07 │
├──────────┼─────┼─────┼─────┼─────┼─────┼─────┼──┤
│ Ana      │8-17 │8-17 │8-17 │8-17 │8-17 │8-13 │ F │
│ Carlos   │8-17 │10-19│8-17 │ F   │10-19│8-13 │8-13│
│ ...      │     │     │     │     │     │     │   │
├──────────┴─────┴─────┴─────┴─────┴─────┴─────┴──┤
│ Gerada em: 15/02/2026 | EscalaFlow v2             │
└──────────────────────────────────────────────────┘
```

### Verificacao

- Botao "Imprimir" visivel na aba Oficial
- Clicar abre preview de impressao OU nova janela com HTML
- HTML funciona offline (abrir no navegador sem internet)
- Tabela legivel em A4 paisagem
- `npx tsc --noEmit` = 0 erros

---

## Sequencia de Implementacao

| Fase | Gaps | Dependencia | Razao |
|------|------|-------------|-------|
| **Fase 0** | Gap 1 (Empresa schema) + Gap 2 (Seed) | — | Foundation: schema precisa estar correto antes de tudo |
| **Fase 1** | Gap 3 (Indicadores) | Fase 0 | Motor precisa expor dados que ja calcula |
| **Fase 2** | Gap 4 (Ajustar revalida) + Gap 5 (Oficializar checa HARD) | Fase 1 | Dependem de validarEscala() extraida |
| **Fase 3** | Gap 6 (ExportarEscala) | — | Independente, pode rodar em paralelo com Fase 1-2 |

**Estimativa:** ~12 subtasks, complexidade media.

---

## Criterios de Aceitacao

1. Schema empresa tem corte_semanal + tolerancia_semanal_min
2. Seed CLT correto (CLT 36h = 5 dias, CLT 30h = 360min + domingo=true, Estagiario = 240min)
3. POST gerar-escala retorna indicadores (5 campos)
4. POST ajustar retorna EscalaCompleta com violacoes recalculadas
5. PUT oficializar retorna 409 se tem HARD
6. Botao imprimir gera HTML legivel em A4
7. `npx tsc --noEmit` = 0 erros
8. `npx vite build` = 0 erros
9. Motor le tolerancia do banco, nao hardcoded

---

## Constraints

- NAO reescrever o motor (gerador.ts). Extrair funcao de validacao e reutilizar
- NAO mudar nomes de rotas existentes (frontend ja consome)
- NAO adicionar dependencias novas (print e window.print() nativo)
- Deletar banco SQLite e recriar (nao tem dados reais ainda)
- Manter snake_case ponta a ponta
- Manter todos os tipos em @escalaflow/shared
