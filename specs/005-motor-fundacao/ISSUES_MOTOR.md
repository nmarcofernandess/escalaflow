# ISSUES & INSIGHTS — Motor de Escalas (pos-005)

> **Criado:** 2026-02-15 | **Fonte:** Implementacao 005-motor-fundacao
> **Audiencia:** Qualquer clone/sessao que for mexer no motor, validador, worker ou IPC de escalas
> **TL;DR:** Tudo que quase deu errado, tudo que e contra-intuitivo, e tudo que vai te morder se voce nao souber.

---

## 1. MAPA DE DEPENDENCIAS CRITICAS

### 1.1 ColabValidacao — O Gargalo de 3 Arquivos

A interface `ColabValidacao` (validacao-compartilhada.ts:6-16) e usada por **3 consumidores diferentes**, cada um com seu proprio SQL:

| Consumidor | Arquivo | SQL | Campos vindos de tipos_contrato |
|------------|---------|-----|---------------------------------|
| Motor (gerador) | gerador.ts:93-99 | `ColabComContrato` (superset) | `dias_trabalho`, `trabalha_domingo`, `max_minutos_dia` |
| Validador | validador.ts:29-46 | Tipo inline no `as` cast | `dias_trabalho`, `trabalha_domingo`, `max_minutos_dia` |
| Testes | test-motor.ts | Usa gerarProposta (indireto) | — |

**REGRA:** Se adicionar campo em `ColabValidacao`, DEVE atualizar:
1. A interface em `validacao-compartilhada.ts`
2. O SQL JOIN em `gerador.ts` (ColabComContrato)
3. O SQL JOIN em `validador.ts` (tipo inline)

TypeScript structural typing faz parecer que "funciona" quando na verdade o SQL nao retorna o campo. O tipo compila, mas o valor vem `undefined` em runtime.

### 1.2 Lookback — Codigo Duplicado (DIVIDA TECNICA)

O carregamento de lookback (escala OFICIAL anterior → diasConsec + domConsec) existe **duplicado**:
- `gerador.ts` linhas 118-163 (FASE 1)
- `validador.ts` linhas 79-124

Sao ~45 linhas quase identicas. Se mudar a logica em um, TEM que mudar no outro.

**Sugestao futura:** Extrair pra `loadLookback(db, setor_id, data_inicio, colaboradores)` em `validacao-compartilhada.ts`.

### 1.3 Empresa — Singleton Consultado N Vezes

A tabela `empresa` e singleton (LIMIT 1) e e consultada separadamente por:
- `gerador.ts` linha 115 (corte_semanal)
- `validador.ts` linha 74 (corte_semanal + tolerancia)
- `tipc.ts` linhas 465, 507, 603 (tolerancia)

Nao ha cache. Se alguem mudar `corte_semanal` durante uma geracao, o motor e o validador podem usar valores diferentes. Risco baixo (geracao e rapida), mas vale saber.

---

## 2. MOTOR — ARMADILHAS POR FASE

### 2.1 Ordem das Fases e NAO-NEGOCIAVEL

```
FASE 1 (prep + lookback)
  → FASE 2 (mapa disponibilidade)
    → FASE 3 (folgas SEG-SAB)
      → FASE 4 (rodizio domingo)
        → FASE 4.5 (repair consecutivos)
          → FASE 5 (alocacao horarios)
            → FASE 6+7 (validacao + scoring)
```

**Por que importa:** FASE 4.5 existe PORQUE FASE 3 + FASE 4 combinadas podem criar streaks >6 dias. Se voce mexer na logica de folgas (FASE 3) ou domingos (FASE 4), SEMPRE verifique que FASE 4.5 ainda resolve os edge cases.

### 2.2 FASE 3 — O Bug Fantasma do Estagiario no Domingo

**O que acontecia:** Linha 208 tinha `if (isDomingo(d) && mapa.get(d)!.status !== 'INDISPONIVEL')` sem checar `isPinned`. Resultado: se a gestora pinasse TRABALHO no domingo pra um estagiario, FASE 3 silenciosamente sobrescrevia pra FOLGA. A validacao R3b (ESTAGIARIO_DOMINGO) nunca via o problema porque ja tinha sido "corrigido" antes de chegar nela.

**Fix aplicado:** Adicionei `&& !isPinned(c.id, d)` no guard. Agora o motor PRESERVA o pin, e a validacao R3b FLAGGA a violacao HARD.

**Licao:** Qualquer fase que force status DEVE checar `isPinned()` primeiro. Se nao, voce esta quebrando o contrato de Smart Recalc.

### 2.3 FASE 4.5 Repair — Edge Case "All Pinned"

Se o usuario pinou 7 dias consecutivos de TRABALHO (streak inteiro), o repair NAO TEM candidato pra forcar FOLGA. O comportamento correto e:
- `unpinned.length === 0` → `continue` (skip repair)
- FASE 6 validation flagga R1 HARD violation
- A gestora decidiu, ela assume a responsabilidade

**NAO tente resolver isso automaticamente.** Se voce despinar um dia pra "salvar" a gestora, voce quebra o contrato do Smart Recalc.

### 2.4 FASE 5 — bandaCount e Stateful e Order-Dependent

`bandaCount` (Map) acumula cobertura ao longo do dia. Colabs sao processados em ordem de `rank DESC`. Rank mais alto = escolha melhor de horario = melhor cobertura.

**Implicacao:** Se mudar a ordenacao dos colaboradores, a distribuicao de cobertura muda. Nao e um bug, mas e comportamento que depende do rank.

### 2.5 FASE 5 — Pinned TRABALHO: Com vs Sem Horas

| Cenario | Comportamento | Linhas |
|---------|--------------|--------|
| Pinned TRABALHO com `hora_inicio` + `hora_fim` | FASE 5 PULA (so conta cobertura no bandaCount) | 472-485 |
| Pinned TRABALHO sem horas | FASE 5 atribui horario normalmente | cai no fluxo normal |

**O que isso significa pra UX:** "Quero fulano trabalhando na terca" (pin TRABALHO sem horas) = motor decide horario. "Quero fulano das 08:00 as 14:00 na terca" (pin TRABALHO com horas) = motor nao toca.

### 2.6 Motor e 100% Sincrono

`gerarProposta()` e uma funcao sincrona que roda ~640 linhas de logica pura. Nao tem await, nao tem I/O assincrono. O Worker thread so wrappa pra nao bloquear a UI do Electron.

**NAO adicione chamadas async dentro de gerarProposta.** Se precisar de I/O, faca antes (na FASE 1) e passe como parametro.

---

## 3. VALIDACAO — REGRAS QUE CONFUNDEM

### 3.1 R4 Merged com R4b (MUDANCA RECENTE)

Antes: R4 (MAX_JORNADA_DIARIA, CLT 600min) e R4b (CONTRATO_MAX_DIA, por contrato) eram checagens separadas. Podiam ambas disparar no mesmo dia pra o mesmo colab.

Agora: Unica checagem com `Math.min(CLT.MAX_JORNADA_DIARIA_MIN, c.max_minutos_dia)`. O `regra` field e dinamico:
- Se `max_minutos_dia < 600` → regra = `'CONTRATO_MAX_DIA'`
- Se `max_minutos_dia >= 600` → regra = `'MAX_JORNADA_DIARIA'`

**Frontend que filtra por `v.regra`:** Precisa tratar AMBOS os valores. Idealmente, UI agrupa violacoes por colaborador (cards), nao por regra.

### 3.2 R5 (META_SEMANAL) vs calcMetaDiariaMin — Formulas DIFERENTES de Proposito

| Funcao | Formula | Onde usa | Proposito |
|--------|---------|----------|-----------|
| R5 (validarRegras) | `horas_semanais * 60 / 7` | Tolerancia semanal | Compara total real vs meta proporcional (7 dias = semana civil) |
| calcMetaDiariaMin | `horas_semanais * 60 / dias_trabalho` | FASE 5 duracao turno | Define quanto tempo o colab trabalha por dia util |

**NAO "unifique" essas formulas.** CLT 44h/6 dias: metaDiaria = 440min (7h20), metaSemanal/7 = 377min/dia. Sao metricas diferentes pro mesmo contrato.

### 3.3 R8 (COBERTURA) e SEMPRE SOFT

Mesmo com 0 pessoas cobrindo uma faixa de demanda, a violacao e SOFT. Cobertura impossivel NAO bloqueia oficializacao. O motor faz o melhor possivel com os colabs disponiveis.

### 3.4 Lookback Afeta R1 e R3

- **R1 (MAX_DIAS_CONSECUTIVOS):** `consec` inicia com `lookback.diasConsec` (linha 112)
- **R3 (RODIZIO_DOMINGO):** `domC` inicia com `lookback.domConsec` (linha 154)

Se nao existe escala OFICIAL anterior, lookback e 0/0. Primeira escala de um setor comeca "limpa".

---

## 4. WORKER / IPC — GOTCHAS

### 4.1 Map Nao Serializa via workerData

`Map<string, PinnedCell>` vira `[string, PinnedCell][]` no WorkerInput (campo `pinnedCellsArr`). Worker reconverte com `toPinnedMap()`.

**Se adicionar novo parametro Map**, siga o padrao:
1. Campo `xyzArr?: [K, V][]` em WorkerInput
2. Funcao `toXyzMap()` no worker
3. Reconversao antes de chamar gerarProposta

### 4.2 Worker Abre Propria Conexao DB

Linha 24 do worker.ts: `new Database(input.dbPath)`. SQLite nao e thread-safe pra compartilhar conexoes entre threads. **NUNCA passe a instancia DB do main process pro worker.**

### 4.3 worker.terminate() e Brutal

No timeout (30s), o worker e killado com `terminate()`. Se o motor estivesse no meio de algo, para instantaneamente. Atualmente nao e problema porque `gerarProposta` so FAZ reads no banco (via prepared statements, sem writes). Mas se no futuro o motor precisar escrever em tabelas temporarias, esse terminate pode deixar lixo no DB.

### 4.4 withTimeout Limpa Timer Corretamente

Apos fix do GAP 3: `workerPromise.then(result => { clearTimeout(timer); return result })` garante que o setTimeout nao fica orfao quando o worker resolve rapido.

---

## 5. TESTES — COMO FUNCIONA E COMO EXPANDIR

### 5.1 Contexto de Execucao

`test-motor.ts` exporta `runMotorTest(db: Database.Database)`. NAO roda via `npx tsx`. Roda via Electron:
- `npm run test:motor` (script no package.json)
- Ou `electron . --test-motor` (apos build)

A instancia `db` e a real do Electron (main process). O teste usa o seed data que ja esta no banco.

### 5.2 Padrao pra Testes que Mutam DB

```typescript
function testX(db: Database.Database): TestResult {
  let originalValue: T | null = null
  try {
    // Salvar estado original
    originalValue = db.prepare('SELECT ...').get()
    // Mutar DB
    db.prepare('UPDATE ...').run(newValue)
    // Rodar motor
    const r = gerarProposta(...)
    // Asserts...
    return { name, passed: true, ... }
  } catch (err) {
    return { name, passed: false, error: ... }
  } finally {
    // SEMPRE restaurar — mesmo se assert falhou
    if (originalValue !== null) {
      db.prepare('UPDATE ...').run(originalValue)
    }
  }
}
```

**REGRA:** Todo teste que INSERT/UPDATE/DELETE no banco DEVE usar `try/finally` pra cleanup. Sem isso, testes subsequentes rodam com dados sujos.

### 5.3 Datas Fixas nos Testes

- `DATA_INICIO = '2026-03-01'` (domingo)
- `DATA_FIM = '2026-03-31'` (terca)
- Mes de marco 2026 tem 31 dias, 5 domingos

Se mudar o seed data ou precisar de cenarios com calendario diferente, crie constantes locais no teste (nao mude as globais).

### 5.4 Suite Atual: 10 Testes

| # | Nome | Tipo | Muta DB? |
|---|------|------|----------|
| 1 | basic-4-setores | Geracao simples | Nao |
| 2 | pinned-folga-basic | PinnedCells FOLGA | Nao |
| 3 | lookback-cross-escala | Cross-escala | Sim (INSERT escala + alocs) |
| 4 | estagiario-domingo | Contrato especial | Nao |
| 5 | r2-descanso-11h | Inter-jornada | Nao |
| 6 | pinned-conflito-7-consecutivos | Pin impossivel | Nao |
| 7 | partial-pinned-streak-5plus2 | Repair com pins | Nao |
| 8 | max-minutos-dia-contrato | Pin excede contrato | Nao |
| 9 | cobertura-impossivel | Demanda impossivel | Sim (UPDATE demanda) |
| 10 | corte-semanal-qui-qua | Corte alternativo | Sim (UPDATE empresa) |

### 5.5 Testes que FALTAM (Gaps Conhecidos)

| # | Cenario | Por que importa | Prioridade |
|---|---------|-----------------|------------|
| A | **Lookback + PinnedCells combinado** | 5 dias de lookback + pin TRABALHO dia 1-2 da nova escala = streaks crossados com pins | MEDIA |
| B | **Gerar → Persistir → Revalidar** | Testa se gerador e validador concordam apos persistencia no DB. Pega desync entre motor e validador. | ALTA |
| C | **Estagiario pinado TRABALHO no domingo** | Pin TRABALHO domingo pra colab com trabalha_domingo=false → espera R3b HARD | MEDIA |
| D | **FASE 4 domingo + R2 descanso** | Colab escalado no domingo FASE 4, mas FASE 5 nao consegue encaixar horario sem violar 11h de descanso. Edge case real. | MEDIA |
| E | **Multiplos setores paralelos** | Gerar escalas pra 4 setores em sequencia, verificar que lookback/enterprise config nao "vaza" entre setores | BAIXA |
| F | **Escala com excecao (ferias) cobrindo periodo inteiro** | Colab com ferias em TODO o periodo → INDISPONIVEL em todos os dias → cobertura cai | BAIXA |

---

## 6. DECISOES DE DESIGN — POR QUE FOI FEITO ASSIM

### 6.1 Por que R4/R4b foi mergeado (nao separado)

**Problema:** Dois checks separados podiam disparar 2 violacoes pro mesmo dia/colab ("jornada de 650min excede CLT 600min" E "jornada de 650min excede contrato 300min"). Redundante e confuso pra usuario nao-tecnico.

**Solucao:** `Math.min(CLT.MAX_JORNADA_DIARIA_MIN, c.max_minutos_dia)` — usa o mais restritivo. Se o contrato e menor que CLT, regra = CONTRATO_MAX_DIA. Se CLT e menor, regra = MAX_JORNADA_DIARIA. Uma violacao, a mais relevante.

### 6.2 Por que pinnedCells e Map<string, PinnedCell> (nao por colab+data separados)

Key do Map: `"${colaborador_id}-${data}"` (ex: `"1-2026-03-05"`).

**Vantagem:** O(1) lookup em qualquer fase do motor. `isPinned(colabId, date)` e uma chamada de Map.has().
**Desvantagem:** O formato da key e convencao, nao type-safe. Se alguem usar `"-"` no ID ou data, quebra.

### 6.3 Por que getWeeks usa primeiros 3 chars do corte_semanal

Formato DB: `'SEG_DOM'`, `'QUI_QUA'`, etc. O pattern e `{INICIO}_{FIM}`.
`corte_semanal.slice(0, 3)` → `'SEG'`, `'QUI'`, etc. Mapeia pro DiaSemana existente.

**Cuidado:** Se alguem inventar um formato como `'SEGUNDA_DOMINGO'`, o slice(0,3) retorna `'SEG'` por sorte. Mas `'DOM_SAB'` retorna `'DOM'` que e valido. O parsing e fragil mas funciona pros valores esperados.

### 6.4 Por que scoring usa pesos fixos

```typescript
pontuacao = Math.round(
  cobertura_percent * 0.4 +    // Cobertura e o mais importante (supermercado PRECISA de gente)
  (violacoes_hard === 0 ? 100 : 0) * 0.3 + // HARD = binario (tudo ou nada)
  equilibrio * 0.2 +           // Distribuicao justa entre colabs
  Math.max(0, 100 - violacoes_soft * 10) * 0.1  // Soft prejudica mas nao impede
)
```

Os pesos refletem a prioridade do negocio: cobertura > legalidade > equilibrio > preferencias. Se o produto mudar de opiniao, mexe aqui.

---

## 7. GOTCHAS PARA FRONTEND (PROXIMO ORCHESTRATE)

### 7.1 Violacoes por Colaborador, NAO por Regra

Os pais do Marco (usuarios finais) nao ligam pra "R1 MAX_DIAS_CONSECUTIVOS". Eles querem: "Ana tem problema na terca." UI deve agrupar violacoes por `colaborador_id` e mostrar cards/linhas por pessoa.

### 7.2 Campo `regra` Agora e Dinamico no R4

Antes: so `'MAX_JORNADA_DIARIA'`. Agora: `'MAX_JORNADA_DIARIA'` OU `'CONTRATO_MAX_DIA'`.
Se o frontend filtra por string exata, precisa tratar ambos.

### 7.3 `violacoes[].data` Pode Ser null

R6 (PREFERENCIA_DIA) retorna `data: null` (violacao agregada, nao por dia). Frontend que renderiza por data precisa de fallback.

### 7.4 `violacoes[].colaborador_id` Pode Ser null

R8 (COBERTURA) retorna `colaborador_id: null` + `colaborador_nome: ''` (violacao de faixa, nao de pessoa). Frontend precisa de categoria "Cobertura" separada dos cards por colaborador.

---

## 8. CHECKLIST — ANTES DE MEXER NO MOTOR

- [ ] Li este documento inteiro
- [ ] Entendi a ordem das 7 fases e por que importa
- [ ] Se adicionar campo em ColabValidacao: atualizei nos 3 locais (interface + gerador SQL + validador SQL)
- [ ] Se mudar logica de folgas (FASE 3/4): verifiquei que FASE 4.5 repair ainda funciona
- [ ] Se mudar qualquer fase: verifiquei que isPinned() e checado antes de forcar status
- [ ] Se adicionar parametro Map pro Worker: usei padrao Array serialization + reconversao
- [ ] Se adicionei teste que muta DB: usei try/finally pra cleanup
- [ ] Rodei `npx tsc --noEmit` → 0 erros
- [ ] Rodei `npm run build` → sucesso
- [ ] Rodei `npm run test:motor` → todos PASS

---

## 9. NUMEROS DE REFERENCIA (pos-005)

| Metrica | Valor |
|---------|-------|
| gerador.ts | 640 linhas |
| validacao-compartilhada.ts | 359 linhas |
| validador.ts | 131 linhas |
| worker.ts | 46 linhas |
| test-motor.ts | 699 linhas, 10 testes |
| tipc.ts (escalas section) | ~180 linhas |
| Regras de validacao | R1-R8 (6 HARD, 4 SOFT) |
| Correcoes aplicadas (005) | 13 bugs + 2 gaps |
| Cobertura de testes | 10 cenarios, 0 FAIL |
