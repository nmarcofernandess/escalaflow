# Bug: Ciclo vs Solver — Solver não respeita o ciclo e funcionários aparecem “trabalhando menos”

## Contexto para outra IA

Existem **dois fluxos distintos** de geração de escala no EscalaFlow. Eles **não** compartilham fonte de verdade: o solver **não** lê nem respeita o ciclo. Se o usuário “regera” pela UI, na maioria dos casos está chamando o **solver**, que **substitui** a escala (e ignora qualquer ciclo existente).

---

## 1. Os dois fluxos

### Fluxo A — Gerar **por ciclo** (template repetido)

- **Handler:** `escalasGerarPorCicloRotativo` (tipc.ts)
- **Entrada:** `ciclo_modelo_id`, `data_inicio`, `data_fim`
- **Fonte de verdade:** tabelas `escala_ciclo_modelos` e `escala_ciclo_itens` (quem trabalha em qual dia da semana em cada semana do ciclo)
- **O que faz:** Para cada data do período, calcula `semana_idx` e `dia_semana`, busca os itens do ciclo e faz **INSERT em alocacoes apenas com** `(escala_id, colaborador_id, data, status)` onde `status` = `'TRABALHO'` ou `'FOLGA'`.
- **O que NÃO grava:** `hora_inicio`, `hora_fim`, `minutos_trabalho`. Esses campos ficam **NULL/0**.
- **Consequência:** O validador (`validarEscalaV3`) lê as alocações e, para dias de TRABALHO sem horário, usa 0 minutos. Resultado: violações de **meta semanal (H10)** — “abaixo da meta” / “trabalhando menos” — mesmo que no ciclo a pessoa tenha vários dias de trabalho. Ou seja: o ciclo define **quem** trabalha **em qual dia**, mas **não** os horários; a validação de horas depende de `minutos_trabalho`/`hora_*`, que nesse fluxo não são preenchidos.

### Fluxo B — Gerar **pelo solver** (OR-Tools CP-SAT)

- **Handler:** `escalasGerar` (tipc) → `buildSolverInput` → `runSolver` (Python) → `persistirSolverResult`
- **Entrada:** `setor_id`, `data_inicio`, `data_fim` (e opções como `solve_mode`, `rules_override`)
- **Fonte de verdade:** Demanda, colaboradores, regras, exceções, feriados — **não** usa `escala_ciclo_modelos` nem `escala_ciclo_itens`.
- **O que faz:** O solver decide, do zero, quem trabalha em cada dia e em qual turno (hora_inicio, hora_fim, minutos_trabalho, etc.) e persiste escala + alocações completas.
- **Multi-pass:** Se não achar solução com todas as regras em HARD, relaxa (Pass 2/3): por exemplo H10 (meta semanal) vira “elástica” e pode gerar escala com pessoas **abaixo da meta** (“trabalhando menos”) para evitar INFEASIBLE.

---

## 2. O bug em palavras simples

- **Ciclo** = template “quem trabalha em qual dia” (sem horários). Ao gerar **por ciclo**, a escala fica com TRABALHO/FOLGA por dia mas **sem** `hora_*`/`minutos_trabalho` → validador acusa “abaixo da meta” / “trabalhando menos”.
- **Solver** = gera escala do zero, **sem** ler o ciclo. Se o usuário “gerou pelo ciclo” e depois clica **Regerar**, a UI normalmente chama o **solver**, que **sobrescreve** a escala. O resultado passa a ser o do solver (com possíveis relaxações de H10), não o do ciclo — e os funcionários podem continuar aparecendo “trabalhando menos” porque:
  1. O solver relaxou a meta semanal (H10) em algum pass, ou  
  2. O fluxo usado na “regeração” foi o do solver, que nunca usou o ciclo.

Ou seja: **o solver não “respeita” o ciclo porque não o utiliza**. Ciclo e solver são fontes de verdade separadas; “regerar” tipicamente significa “rodar o solver de novo”, não “repetir o ciclo”.

---

## 3. Onde está no código

| Aspecto | Ciclo | Solver |
|--------|--------|--------|
| Gerar escala | `tipc.ts`: `escalasGerarPorCicloRotativo` | `tipc.ts`: `escalasGerar` → `solver-bridge.ts`: `buildSolverInput`, `runSolver`, `persistirSolverResult` |
| INSERT alocacoes | Só `(escala_id, colaborador_id, data, status)` | Completo: `status`, `hora_inicio`, `hora_fim`, `minutos_trabalho`, almoco, etc. |
| Input do “motor” | `escala_ciclo_itens` (semana_idx, dia_semana, trabalha) | Demanda, colabs, regras, exceções — **sem** ciclo |
| Meta semanal (H10) | Sempre “abaixo” na validação (0 min por dia de trabalho) | Respeitada ou relaxada conforme o pass (H10 rígido vs elástico) |

---

## 4. Bug de semana no ciclo (já corrigido)

Havia um bug no mapeamento calendário → ciclo: `semanaOffset` começava em 0 e incrementava na **segunda-feira**, então o **primeiro dia** do período usava `semanaIdx = T-1` (última semana do ciclo). A primeira semana do calendário misturava segunda da semana T-1 com terça a domingo da semana 0, podendo gerar 7 dias seguidos de trabalho e violação H19 (folga compensatória). **Correção:** `semanaOffset` começa em 1 e incrementa ao **passar domingo** (fim da semana). Arquivo: `tipc.ts`, procedimento `escalasGerarPorCicloRotativo`.

---

## 5. O que fazer para “respeitar o ciclo”

- **Se a intenção é manter o ciclo como fonte de verdade:**  
  - Não usar “Regerar” que chama o solver.  
  - Usar apenas “Gerar por ciclo” para o período desejado.  
  - Para a meta semanal deixar de acusar “trabalhando menos” no fluxo por ciclo, é preciso **preencher horários** após o INSERT do ciclo (ex.: a partir de perfil/regra de cada colaborador) ou passar a gravar `hora_inicio`/`hora_fim`/`minutos_trabalho` nesse fluxo.

- **Se a intenção é usar o solver:**  
  - O solver não usa ciclo; para ele “respeitar” algo parecido com o ciclo seria necessário **alimentar o solver** com o ciclo (ex.: hints ou restrições derivadas de `escala_ciclo_itens`), o que hoje **não** está implementado.

---

## 6. Resumo em uma frase

**Ciclo e solver são dois fluxos separados; o solver não lê o ciclo. “Regerar” usa o solver e substitui a escala, podendo gerar “trabalhando menos” por relaxação de H10 ou por não usar o ciclo; no fluxo por ciclo, “trabalhando menos” vem do fato de não persistirmos horários, então o validador vê 0 minutos.**
