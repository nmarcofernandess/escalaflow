# Casos de Teste — Motor de Escalas

> **Objetivo:** Validar qualidade do motor com dados reais do seed. Período: Março 2026 (30 dias).

---

## 1. Caixa (setor_id=1)

| Aspecto | Valor |
|---------|-------|
| **Colaboradores** | 8 (7 CLT que trabalham domingo + 1 Estagiário 20h que NÃO trabalha domingo) |
| **Contratos** | CLT 44h (6), CLT 36h (1), Estagiário 20h (1) |
| **Demandas** | 4 faixas: 08-12 (4p), 12-18 (6p), 18-22 (4p) + SAB extra 08-22 (5p) |
| **Exceções em Março** | Maria Fernanda (id 3): FÉRIAS 01-15/03; Fernanda Costa (id 7): ATESTADO 10-12/03 |
| **Preferências** | Carlos: evitar SAB; Pedro: evitar SEG; Ana Julia, Juliana, Rafael: MANHA; Maria Fernanda, Lucas: TARDE |

### Resultados esperados

- **Max dias consecutivos:** ≤ 6 (R1)
- **Rodízio domingo:** Lucas (Estagiário) nunca trabalha domingo; M max 2 consec, F max 1 consec (R3)
- **Cobertura:** ≥ 90% das faixas (R8)
- **Preferências:** evitar_dia_semana e prefere_turno em > 80% dos casos (R6, R7)
- **Meta semanal:** Respeitar tolerância (R5)
- **Pontuação:** > 80
- **Violações HARD:** 0

---

## 2. Açougue (setor_id=2)

| Aspecto | Valor |
|---------|-------|
| **Colaboradores** | 3 (2 CLT 44h, 1 CLT 36h) |
| **Demandas** | 2 faixas: 08-12 (2p), 12-20 (3p) |
| **Exceções** | Nenhuma em Março |

### Resultados esperados

- **Staffing apertado:** 3 colabs para cobrir até 3 pessoas em pico
- **Max dias consecutivos:** ≤ 6
- **Rodízio domingo:** Equilibrado entre os 3 (todos trabalham domingo)
- **Cobertura:** ≥ 90%; pode haver déficit em picos — esperado em setor pequeno
- **Pontuação:** > 80 (ou próximo, dado staffing tight)
- **Violações HARD:** 0

---

## 3. Padaria (setor_id=3)

| Aspecto | Valor |
|---------|-------|
| **Colaboradores** | 3 (2 CLT 44h, 1 CLT 30h) |
| **Demandas** | 2 faixas: 06-10 (3p), 10-21 (2p) |
| **Exceções em Abril** | Lucia Ferreira (id 12): FÉRIAS 01-15/04 |

### Resultados esperados (Março)

- **Março:** Todos disponíveis — 3 colabs cobrindo 2 faixas
- **Max dias consecutivos:** ≤ 6
- **Cobertura:** ≥ 90%
- **Pontuação:** > 80
- **Violações HARD:** 0

> **Nota:** Exceção de Lucia é em ABRIL; em Março não impacta.

---

## 4. Hortifruti (setor_id=4)

| Aspecto | Valor |
|---------|-------|
| **Colaboradores** | 2 (1 CLT 44h, 1 CLT 36h) |
| **Demandas** | 2 faixas: 07-13 (2p), 13-20 (2p) |
| **Exceções** | Nenhuma |

### Resultados esperados

- **Muito apertado:** 2 colabs para 2p por faixa — cada um cobre uma faixa
- **Max dias consecutivos:** ≤ 6
- **Rodízio domingo:** 2 pessoas alternando
- **Cobertura:** Pode ficar em 80–90% por ser 2 pessoas
- **Pontuação:** > 70 (tolerância para setor mínimo)
- **Violações HARD:** 0

---

## Regras CLT (R1–R8)

| Código | Regra | Tipo |
|--------|-------|------|
| R1 | MAX_DIAS_CONSECUTIVOS ≤ 6 | HARD |
| R2 | MIN_DESCANSO_ENTRE_JORNADAS ≥ 11h | HARD |
| R3 | RODIZIO_DOMINGO: M max 2 consec, F max 1 consec | HARD |
| R4 | MAX_JORNADA_DIARIA ≤ 10h | HARD |
| R5 | META_SEMANAL (tolerância) | SOFT |
| R6 | PREFERENCIA_DIA (evitar_dia_semana) | SOFT |
| R7 | PREFERENCIA_TURNO (MANHA/TARDE) | SOFT |
| R8 | COBERTURA por faixa de demanda | SOFT |

---

## Critérios de sucesso (PRD)

- **RF17:** 0 violações HARD em todos os setores
- **RF18:** Pontuação > 80 por setor (Caixa, Açougue, Padaria); Hortifruti ≥ 70
- **RF19:** Cobertura ≥ 90% (exceto Hortifruti, aceitar ≥ 80%)

---

## Resultados da execução (Phase 6)

**Comando:** `npm run test:motor` (build + `electron . --test-motor`)

**Pré-requisitos:** 
- `npm run build` deve completar (requer `@rollup/rollup-darwin-arm64` em optionalDependencies)
- better-sqlite3 compilado para Electron (postinstall ou `npm rebuild`)

**Validação manual:** Execute o app (`npm run dev`), gere escala para cada setor, verifique indicadores no grid. Ou rode `npm run test:motor` em ambiente com Python/distutils para rebuild de módulos nativos.
