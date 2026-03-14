# Geração de ciclo — 3 formas e integração com solver

> Reconstrução assertiva a partir de transcrição (mensagem ao Claude que travou no terminal).  
> Inclui inferência do conteúdo dos trechos colados (Pasted text #4 a #8).  
> Data: 2026-03-13

---

## 1. Contexto

A geração de ciclo, o “analyst” que tínhamos para decidir se vale fazer o **gerar rápido do ciclo de escala** (sem passar pelo solver) ou passando pelo solver mas só a **fase 1** — com um porém: **não dá para usar a fase 1 do solver sem ter faixas de horário cadastradas**.  
O lance é **aceitar ou não** que funcione pela matemática do pré-flight; isso foi feito na página **Simular Ciclos**.

---

## 2. As 3 formas de fazer

### Nível 1 — Só N e K (gerar ciclo “de brinquedo”)

- **Entrada:** somente duas informações:
  - Quantas pessoas: **N** (ex.: 5)
  - Quantos trabalham por vez no domingo: **K** (ex.: 2)
- **Regras úteis:** tentar **não deixar ninguém trabalhar 2 domingos seguidos**. Não precisamos discernir mulher ou homem: **ninguém** trabalha 2 domingos seguidos. Usamos o padrão **T F F T F** por pessoa.

**[INFERIDO — Pasted text #4 (~25 linhas)]**  
Provável conteúdo: detalhamento do padrão T F F T F — que é o padrão **de cada pessoa** na sequência de domingos do ciclo (5 posições, 2 T’s, sem TT); rotação por pessoa (Pessoa 1 começa em T, Pessoa 2 em F, etc.); garantia de que não há TT; talvez exemplo para N=5, K=2 e ciclo de 5 semanas.

- **Onde está hoje:** página **Dashboard > Simular Ciclos**, com pré-flight ligado (sem TT, H1 ≤ 6), K sugerido ~40%, ciclo ≤ 7 semanas, exibição em 3 meses com linha roxa de fim de ciclo.

---

### Nível 2 — Pré-flight inteligente (dados reais do setor)

- **Base:** pré-flight **inteligente** a partir dos dados do **setor e dos colaboradores**.
- Extrair do setor real:
  - Demandas reais
  - Quantas pessoas precisam por dia (e no domingo): **D_dom**, **D_seg** … **D_sab**

**[INFERIDO — Pasted text #5 (~3 linhas)]**  
Provável: definição de **N_dom_legais** (quantos colaboradores podem trabalhar domingo por contrato/regra) e/ou como D_dom é obtido da demanda.

**Checagem de horário:** “Se bate o horário que precisamos incluindo o intermitente” (transcrição). Ou seja: validar que a demanda por dia/horário é cobertível com os contratos e perfis (incl. intermitente); fórmula do ciclo mínimo em cima de N_dom_legais e D_dom.

- **Ciclo mínimo real:**  
  `ciclo = N_dom_legais / gcd(N_dom_legais, D_dom)`  
  Responde, em cima de **dados reais** (não do brinquedo): “com esse setor você nunca vai ter 1/1; o ciclo é 5 e cada um pega 2 de 5”.
- **Bounds de horas semanais:**  
  Checagem rápida: “se eu cobrir toda a demanda, qual a faixa mínima/máxima de horas que cada contrato vai precisar?”. Se isso exige quebrar CLT (44h/36h), **já grita antes**.
- **Limites** de `max_consecutivos` e `dom_max_consecutivos` vêm das **regras reais**, não de “patifaria” de colaborador ou contrato; talvez o certo seja vir do solver.
  - **Mulher:** hard para **não** repetir (max 1 domingo consecutivo — Art. 386 CLT).
  - **Homem:** semi-hard; só em último caso aceita repetir (max 2 domingos consecutivos — convenção/jurisprudência).  
  (Hoje na regra do solver “esse lance da mulher” está off.)
- Colocando isso, **nem precisa** o usuário cadastrar ciclos 2/1 etc. de domingos em lugar nenhum.
- Se quisermos que **uma pessoa não trabalhe domingo**, colocamos **folga fixa no domingo** para ela. Pronto. O solver tem que ser inteligente para lidar com isso; talvez o pré-flight não dê conta dessa parte.
- **Nível 2 responde:** “Com a tua realidade de contratos, sexo, demanda e CLT, existe algum padrão de ciclo legal? De quantas semanas? Com que proporção de domingos por pessoa?” — **ainda sem slots de horário**.

---

### Nível 3 — Solver completo

- Na UI, essas opções podem aparecer **apenas em simulação**.
- Por **chips**, ativar ou desativar as verificações de **nível 1 e 2**. O do **solver** não tem como: é clicando em **Gerar** mesmo.
- O solver vai tentar usar o que temos, o que **passou no pré-flight**. Ele **tem que passar** pelos níveis 1 e 2 para rodar o solver. O **botão fica desativado** até conseguir.
- O que muda na prática é o **padrão de folgas**: se a gente **salvar**, ele usa o padrão de folgas que apareceu ali.

Duas alternativas:

- **A:** Deixar o solver calcular o próprio padrão de folga (Phase 1).
- **B:** Alimentar com um padrão **T/F** vindo do nível 1 ou 2 via **pinned_folga** (o **caminho B** descrito na spec do SimulaEscala).

A diferença está no **salvar ou não**: agora o “gerar simulação” já tem que gerar esses campos (folga fixa/variável) para as pessoas; “foda-se esse lance de só oficial que muda”. Como estamos fazendo isso o tempo todo, tá tudo bem. O **solver não sobrescreve** se as pessoas já tiverem isso, a não ser que na config do solver a gente coloque **bypass de horário fixo e variável**, ou a gente não tenha colocado. Se deu certo na parte 2, é difícil dar merda no solver.

**[INFERIDO — Pasted text #7 (~6 linhas)]**  
Provável: fluxo de “salvar padrão” vs “só simulação”; quando o solver usa pinned_folga vs Phase 1 própria; ou regra de “não sobrescrever folga já configurada”.

---

## 3. Não foder com número infinito de ciclos

Para não foder com número infinito de ciclos, usamos a **lógica refatorada** no **Dashboard > Simular Ciclos**. Ela funciona para a fase 1.

- **Travar** que **TT não pode acontecer** (ninguém com 2 domingos seguidos no nível 1).
- **Travar** que nunca pode **mais de 6 dias consecutivos** (H1 — Art. 67 CLT). No nosso modelo (folga fixa + folga variável quando trabalha domingo), **nunca dá 6 dias na mesma semana**: quem trabalha domingo tem a variável, quem não trabalha não tem — em ambos os casos ficam 2 folgas/semana, logo sempre **5 dias trabalhados por semana**. Então “nunca 6 na semana” é consequência do desenho, não só da CLT.
- **Travar** que o ciclo de semanas **nunca deve passar de 7**.
- **Lógica de K:** se 5 pessoas, a gente usa 2 no domingo — isso dá **por volta de 40%**.

**[INFERIDO — Pasted text #8 (~24 linhas)]**  
Provável: detalhe da heurística de K sugerido (40% alvo, ciclo ≤ 7, K ≤ floor(N/2) para sem TT); uso de gcd(N,K); que o ciclo exibido é “3 meses” (não ciclo×3); linha roxa de fim de ciclo; e/ou o restante da UI e fluxo da página Simular Ciclos (toggle pré-flight, badges Sem TT / H1 OK, cobertura, legenda FF/FV/DT/DF).

---

## 4. Resumo assertivo

| Nível | Entrada | Regras | Saída |
|-------|--------|--------|--------|
| **1** | N, K | Sem TT (T F F T F), H1 ≤ 6, ciclo ≤ 7 semanas, K ~40% | Grid T/F por pessoa, fixa/variável inferidas |
| **2** | Setor real: demanda (D_dom, D_seg…), N_dom_legais, contratos, sexo | Ciclo = N_dom_legais/gcd(N_dom_legais, D_dom); bounds de horas; max_consec e dom_max por regra; mulher max 1 domingo consec, homem max 2 | “Existe ciclo legal? Quantas semanas? Proporção de domingos?” — sem horários |
| **3** | O que passou em 1 e 2 | Solver completo (Phase 1 própria ou pinned_folga do 1/2) | Escala com horários; botão Gerar só habilitado se pré-flight passar |

---

## 5. Vacilos corrigidos (revisão 2026-03-13)

- **“Nunca 6 na semana”:** No nosso modelo (folga fixa + variável atrelada ao domingo) **nunca** acontece 6 dias na mesma semana — quem trabalha domingo tem a variável, então sempre 2 folgas/semana e 5 trabalhados. Mantemos essa trava; a CLT exige só **máx. 6 consecutivos** (H1). Texto ajustado para deixar explícito que “nunca 6 na semana” vem do desenho folga fixa+variável.
- **Lei 10.101/2000** para homem max 2 domingos: lei errada (10.101 é participação nos lucros). Substituído por “convenção/jurisprudência”.

---

## 6. Referências no código

- **Simular Ciclos (nível 1):** `src/shared/simula-ciclo.ts`, `src/renderer/src/paginas/SimulaCicloPagina.tsx`
- **Pré-flight setor:** `src/main/tipc.ts`, preflight
- **Validação H3 (domingos consecutivos):** `src/main/motor/validacao-compartilhada.ts` — H3 SOFT; mulher max 1, homem max 2
- **Caminho B (pinned_folga):** `docs/ANALYST_SIMULADOR_CICLO_RAPIDO.md` § 7.4; solver `solver_ortools.py` / `constraints.py` (domingo_ciclo_soft, domingo_ciclo_hard)

---

## 7. Conferência com transcrição original (2026-03-13)

Texto original (terminal): *"travar que TT nao pode acontecer, travar que nunca pode 6 na semana e nunca pode mais que 6 consecutivo, e que nunca deve passar de 7 o ciclo de semanas. E ai, ele usa a logica de se 5 pessoas a gente usa 2, isso da por volta de 40%."*  

Conferido: PRD mantém as três travas (TT, 6 na semana + 6 consecutivo, ciclo ≤ 7) e K ~40%. Esclarecido que “nunca 6 na semana” é consequência do modelo folga fixa + variável; “nunca mais que 6 consecutivo” é H1 (Art. 67). Nível 2: trecho “Se bate o horário que precisamos incluindo o intermitente” incorporado em § 2 (checagem de horário).
