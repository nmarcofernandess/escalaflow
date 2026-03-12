# Mapeamento de erros — Preflight e Solver

Documento gerado pelo plano `erros-e-precondicoes-escala`. Lista todos os pontos de falha no fluxo de geracao de escala e ajuste.

## 1. Preflight (tipc.ts `buildEscalaPreflight`)

| Codigo | Severidade | Mensagem | Tipo |
|--------|------------|----------|------|
| SETOR_INVALIDO | BLOCKER | Setor {id} nao encontrado ou inativo. | Precondicao |
| SEM_COLABORADORES | BLOCKER | Setor nao tem colaboradores ativos. | Precondicao |
| SEM_DEMANDA | WARNING | Setor sem demanda planejada cadastrada. | Aviso |
| PREFLIGHT_DIAGNOSTICO_INDISPONIVEL | WARNING | Nao foi possivel rodar o diagnostico de capacidade completo. | Erro interno |

## 2. Preflight-capacity (enrichPreflightWithCapacityChecks)

| Codigo | Severidade | Mensagem | Tipo |
|--------|------------|----------|------|
| DOMINGO_SEM_COLABORADORES | BLOCKER | Ha demanda no domingo (data), mas nenhum colaborador pode trabalhar domingo. | Precondicao |
| DEMANDA_EM_FERIADO_PROIBIDO | BLOCKER | Ha demanda no feriado proibido {data}. | Precondicao |
| CAPACIDADE_DIARIA_INSUFICIENTE | BLOCKER | Capacidade insuficiente em {data}: disponiveis=X, minimo requerido=Y. | Precondicao |
| CAPACIDADE_TOTAL_ESTOURADA | WARNING | Demanda total do periodo excede capacidade nominal da equipe. | Aviso |
| CAPACIDADE_INDIVIDUAL_INSUFICIENTE | BLOCKER | A janela de disponibilidade de {nome} torna a carga horaria incompativel. | Precondicao |

## 3. Solver Python (solver_ortools.py)

| status | erro.tipo | erro.mensagem | Tipo |
|--------|-----------|---------------|------|
| INFEASIBLE | CONSTRAINT | Solver retornou INFEASIBLE: impossivel satisfazer todas as restricoes simultaneamente | Solver |
| INFEASIBLE | PREFLIGHT | Nenhum colaborador ativo para gerar escala | Precondicao |
| INFEASIBLE | CONSTRAINT | Impossivel gerar escala mesmo com relaxamento maximo de regras | Solver |
| TIMEOUT | TIMEOUT | Solver atingiu o limite de Xs sem alcancar cobertura minima | Solver |
| ERROR | PREFLIGHT | Nenhum input recebido via stdin | Erro interno |
| ERROR | PREFLIGHT | JSON invalido: {e} | Erro interno |
| MODEL_INVALID | CONSTRAINT | (modelo invalido) | Erro interno |

## 4. tipc.ts — escalasGerar / escalasAjustar

| Origem | Condicao | Mensagem lancada |
|--------|----------|------------------|
| Preflight | !preflight.ok | blockers[0].mensagem ou "Preflight falhou" |
| Solver INFEASIBLE | status === INFEASIBLE | buildInfeasibleMessage(...) |
| Solver outro | !sucesso | solverResult.erro?.mensagem ?? "Erro ao gerar escala via solver" |

## 5. tipc.ts — outros erros relevantes

| Handler | Condicao | Mensagem |
|---------|----------|----------|
| escalasOficializar | escala nao encontrada | Escala nao encontrada |
| escalasOficializar | input_hash desatualizado | ESCALA_DESATUALIZADA: Houve mudancas no cenario... |
| escalasOficializar | violacoes_hard > 0 | Escala tem X violacoes criticas. Corrija antes de oficializar. |
| escalasAjustar | escala nao encontrada | Escala nao encontrada |
| escalasAjustar | status !== RASCUNHO | So e possivel ajustar escalas em rascunho |
| escalasAjustar | alocacoes vazias | Nenhuma alocacao fornecida para ajuste |

## 6. solver-bridge.ts

| Condicao | Mensagem |
|----------|----------|
| ESCALAFLOW_SOLVER_PATH inexistente | ESCALAFLOW_SOLVER_PATH aponta para arquivo inexistente |
| Solver nao encontrado | Solver nao encontrado. Em dev, certifique-se de que solver/solver_ortools.py existe. |

## 7. Inventario de toasts no frontend (SetorDetalhe e fluxo de escala)

| Ponto | Toast atual | Gap |
|-------|-------------|-----|
| handleGerar — data vazia | toast.error('Defina data inicial e final antes de gerar') | OK |
| handleGerar — data fim < inicio | toast.error('A data final precisa ser maior ou igual a data inicial') | OK |
| handleGerar — preflight blockers | toast.error(blockers.join) | Nao persistente; mensagens podem ser longas |
| handleGerar — preflight catch | toast.error(mapError \|\| 'Falha no preflight') | Nao persistente |
| handleGerar — sucesso | toast.success('Escala gerada') | OK |
| handleGerar — erro solver | toast.error(msg) | Nao persistente; usuario pode perder mensagem |
| handleGerar — cancelado | (nao mostra toast de erro) | OK |
| handleOficializar — sucesso | toast.success('Escala oficializada') | OK |
| handleOficializar — desatualizada | toast.error('Escala desatualizada — gere novamente.') | Nao persistente |
| handleOficializar — outro erro | toast.error(msg) | Nao persistente |
| handleDescartar | toast.success/error | OK |
| Salvar folga (regra horario) | toast.error(mapError \|\| 'Erro ao salvar folga') | OK |
| Atribuir posto | toast.error(mapError \|\| 'Erro ao atribuir posto') | OK |
| Carregar escala | toast.error(mapError \|\| 'Erro ao carregar escala') | OK |

**Gaps identificados:** Erros criticos (preflight bloqueou, INFEASIBLE, timeout, erro interno) usam toast.error padrao que some automaticamente. Usuario pode perder a mensagem antes de ler. Falta section "Antes de gerar" no empty state de simulacao.

## 8. Contrato de erros (backend → frontend)

O backend retorna erros via `throw new Error(msg)`. O frontend usa `mapError(err)` para traduzir. Para toasts persistentes, usamos mensagens amigaveis.

**Estrutura desejada (quando backend retornar objeto estruturado no futuro):**
```ts
interface ErroGeracaoEscala {
  status: 'INFEASIBLE' | 'INVALID_INPUT' | 'PREFLIGHT_BLOCKER' | 'TIMEOUT' | 'INTERNAL_ERROR'
  mensagem: string
  detalhe?: string
  sugestoes?: string[]
  codigo?: string  // ex: SEM_COLABORADORES, CAPACIDADE_DIARIA_INSUFICIENTE
}
```

**Mapeamento atual (msg string):**
- `INFEASIBLE:` no inicio → status INFEASIBLE; mensagem apos o prefixo
- `ESCALA_DESATUALIZADA:`
- `Preflight falhou` ou blockers[0].mensagem
- `Solver nao encontrado` | `ESCALAFLOW_SOLVER_PATH` → erro interno
- `timeout` | `demorou` → TIMEOUT
- `network` | `fetch` | `ipc` | `econnrefused` → erro de comunicacao

## 9. Integracao checklist e preflight (implementado)

- **Checklist "Antes de gerar"** no empty state de simulacao lista: Empresa configurada, Tipo de contrato, Colaboradores ativos, Demanda cadastrada.
- **Botao Gerar** desabilitado quando falta empresa, tipos de contrato ou colaboradores (precondicoes basicas).
- **Preflight** continua rodando em handleGerar antes de chamar o solver; se houver blockers, toast persistente.
- **Toast persistente** (`toastErroGeracaoEscala`) para erros de preflight, geracao e oficializacao.
