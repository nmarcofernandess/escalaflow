# Ausentes na Equipe — Design Spec

> Aprovado: 2026-03-14
> Dominio: A (Context/Store) + C (UI)
> Escopo: Ausentes na Equipe + A11 (snapshot IA) + A12 (tools redundantes) + bugfix data_nascimento
> Motivacao: RH nao ve quem esta de ferias/atestado no setor. Dashboard mostra 0 pra ferias futuras. Posto fica "normal" quando titular esta fora. IA faz queries redundantes. Tool criar colaborador quebra.

---

## TL;DR

Quando um colaborador esta de ferias ou atestado, ele aparece numa secao "Ausentes" na Equipe do setor (card estilo drawer), seu nome fica laranja na tabela de postos, e 7 dias antes o sistema avisa com um icone sutil.

---

## 1. Problema

### 1.1 Dashboard mostra "0 Em Ferias"

A query do dashboard conta excecoes onde `data_inicio <= hoje AND data_fim >= hoje`. Ferias futuras (ex: 01/04-15/04 quando hoje e 14/03) nao aparecem. Isso e comportamento correto — o dashboard conta ausencias ATIVAS, nao futuras.

### 1.2 Setor nao mostra ausentes

A Equipe do SetorDetalhe ja tem logica de status por excecao (`getStatusColaborador`). Se uma excecao esta ativa, o badge muda de "Ativo" pra "Ferias"/"Atestado". Mas:
- A pessoa fica na mesma posicao na tabela (nao se destaca)
- Nao ha divisoria separada pra ausentes
- O posto nao indica visualmente que esta "livre"

### 1.3 Ferias futuras invisiveis

Nenhuma parte do sistema mostra ferias que vao comecar em breve. O RH nao tem aviso previo.

---

## 2. Solucao

### 2.1 Query de excecoes — retornar nao-expiradas

**Antes:** `WHERE data_inicio <= hoje AND data_fim >= hoje` (so ativas hoje)

**Depois:** `WHERE data_fim >= hoje` (todas nao-expiradas)

O frontend filtra em duas categorias:
- **Ativas:** `data_inicio <= hoje AND data_fim >= hoje`
- **Proximas (7 dias):** `data_inicio > hoje AND data_inicio <= hoje + 7 dias`

Handlers afetados:
- `excecoes.listarAtivas` em `tipc.ts` — mudar SQL

**ATENCAO:** O `excecaoMap` em SetorDetalhe.tsx (linha 517-526) usa o resultado cru de `excecoesAtivas` sem filtrar por data. Apos a mudanca SQL, excecoes FUTURAS entrariam no mapa e o badge mostraria "Ferias" antes da hora. **Fix obrigatorio:** filtrar `excecaoMap` pra incluir apenas excecoes onde `data_inicio <= hoje`.

### 2.2 Derivados no AppDataStore

Mudancas em `calcularDerivados()`:

1. **Adicionar `excecoes: Excecao[]` como 4o parametro** (hoje recebe so postos, colaboradores, demandas)
2. **Adicionar `'excecoes'` ao `DERIVADOS_DEPS`** (hoje so tem colaboradores, postos, funcoes, demandas)
3. **Adicionar defaults ao `DERIVADOS_VAZIO`:** `ausentes: []`, `proximosAusentes: []`

```typescript
interface Derivados {
  // ... existentes (N, K, cicloSemanas, etc.) ...

  // NOVOS
  ausentes: Array<{
    colaborador: Colaborador
    excecao: Excecao
    posto: Funcao | null  // postos.find(p => p.id === colaborador.funcao_id)
  }>
  proximosAusentes: Array<{
    colaborador: Colaborador
    excecao: Excecao
    diasAte: number  // dias ate a excecao comecar
  }>
}
```

Logica:
- Data de referencia: `new Date().toISOString().split('T')[0]`
- `ausentes`: colaboradores do setor com excecao onde `data_inicio <= hoje AND data_fim >= hoje`
- `proximosAusentes`: colaboradores do setor com excecao onde `data_inicio > hoje AND data_inicio <= hoje + 7`
- `diasAte`: calculo por subtracao de date strings (YYYY-MM-DD). `Math.ceil((Date.parse(exc.data_inicio) - Date.parse(hoje)) / 86400000)`
- **Dedup:** se um colaborador tem multiplas excecoes (ex: BLOQUEIO antigo + FERIAS nova), usa a de maior prioridade: FERIAS > ATESTADO > BLOQUEIO. Um colaborador aparece no maximo 1x em `ausentes` e 1x em `proximosAusentes`.

Recalcula automaticamente quando `excecoes`, `colaboradores`, `postos` ou `demandas` mudam.

### 2.3 Tabela POSTOS — titular ausente

Quando o titular de um posto esta em `ausentes`:
- Nome do titular renderizado em **cor warning (laranja/amber)**
- Badge de status mostra "Ferias" (laranja) ou "Atestado" (vermelho) — ja existe no `getStatusColaborador`
- Resto da linha inalterado

### 2.4 Tabela POSTOS — aviso 7 dias

Quando o titular de um posto esta em `proximosAusentes`:
- Icone warning sutil (AlertTriangle, ja importado) ao lado do nome
- Tooltip: "Ferias em X dias (01/04 - 15/04)"
- Nao muda cor, nao move a pessoa

### 2.5 Secao "Ausentes" — nova divisoria

Aparece entre POSTOS e BANCO DE ESPERA, so quando `ausentes.length > 0`.

Titulo: `AUSENTES (N)` com subtitulo `ferias e atestados ativos`

Cada ausente renderizado como card (estilo do TitularPicker/drawer de buscar pessoa):
- **Nome** (bold)
- **Posto • Contrato • Badge Ferias/Atestado**
- **Datas** e countdown: "01/04 - 15/04 (volta em 12 dias)"
- **Hover/tooltip** no card: mostra posto de origem

Cards usam cor de fundo sutil:
- **Ferias:** amber/8 (fundo) + badge laranja
- **Atestado:** red/8 (fundo) + badge vermelho
- **Bloqueio:** muted/8 (fundo) + badge cinza

### 2.6 Interacao — atribuir ausente a outro posto

Se o RH tentar atribuir um colaborador ausente (que ja tem posto) a outro posto via TitularPicker:
- Mesmo fluxo de swap que ja existe
- O colaborador ja tem `funcao_id != null`, entao o sistema ja pergunta sobre swap
- Nenhuma mudanca de logica necessaria

### 2.7 Dashboard

Nenhuma mudanca. O dashboard conta excecoes ativas (hoje dentro do periodo). Quando as ferias comecarem, o contador atualiza automaticamente.

---

## 3. O que NAO muda

| Item | Por que |
|------|---------|
| Tabela `excecoes` no banco | Estrutura suficiente |
| Motor/solver Python | Ja pula colaboradores com excecao no periodo |
| IA tools (criar excecao, etc.) | Ja funcionam, broadcast de invalidacao ja existe |
| Logica de escala/ciclo | Nao afetada por excecoes de display |
| Banco de Espera | Continua igual (postos com `ativo = false`) |
| Reserva Operacional | Continua igual (colaboradores com `funcao_id = null`) |

---

## 4. Arquivos a modificar

| Arquivo | Mudanca |
|---------|---------|
| `src/main/tipc.ts` → `excecoesListarAtivas` | SQL: `data_fim >= hoje` em vez de range |
| `src/renderer/src/store/appDataStore.ts` → `calcularDerivados` | Adicionar `ausentes` e `proximosAusentes` |
| `src/renderer/src/paginas/SetorDetalhe.tsx` | Tabela postos: nome laranja + warning 7d. Nova secao Ausentes |

---

## 5. Fluxo visual (estados)

```
ESTADO NORMAL (sem excecao):
  POSTOS: AC3 → Jose Luiz → Ativo (verde)

7 DIAS ANTES:
  POSTOS: AC3 → Jose Luiz → Ativo (verde) + ⚠ tooltip "ferias em 5 dias"

FERIAS ATIVAS:
  POSTOS: AC3 → "Jose Luiz" (texto laranja) → Ferias (badge laranja)
  AUSENTES (1):
    ┌──────────────────────────────────────┐
    │  Jose Luiz                           │
    │  AC3 • CLT 44h • Ferias             │
    │  01/04 - 15/04 (volta em 12 dias)   │
    └──────────────────────────────────────┘

FERIAS ACABAM:
  → Tudo volta ao normal automaticamente
  → Jose Luiz some dos Ausentes
  → AC3 volta a mostrar nome em cor normal
```

---

## 6. Criterios de sucesso

- [ ] Dashboard mostra contagem correta quando ferias estao ativas
- [ ] Setor mostra secao "Ausentes" com cards quando ha ausentes
- [ ] Titular ausente tem nome laranja na tabela de postos
- [ ] Warning 7 dias antes aparece como tooltip no posto
- [ ] Tudo reativo — criar excecao via IA ou UI atualiza imediatamente (broadcast A4-A6)
- [ ] Nenhuma mudanca no motor, solver, ou banco

---

## 7. Limitacoes conhecidas

- **Offline/desktop:** se o app ficar aberto alem da meia-noite, os estados de ausente/proximo nao atualizam sozinhos ate o proximo reload de excecoes (navegacao, mutacao, ou restart). Isso e inerente ao modelo offline — sem server push.
- **Hover no card mostra posto:** redundante se o card ja mostra "AC3 • CLT 44h" no corpo. Manter so no corpo, sem tooltip separado.

---

## 8. A11 — Snapshot do store no IaContexto

### Problema

A `discovery.ts` roda 15+ queries no PGlite a CADA mensagem do chat (feriados, setores, regras, alertas, memorias, etc.). O renderer ja tem esses dados no AppDataStore. A IA nao sabe o que o usuario esta VENDO — so o que ta no banco.

### Solucao

Incluir um `store_snapshot` no `IaContexto` que o renderer envia ao main process junto com cada mensagem:

```typescript
// No IaContexto (shared/types.ts ou discovery.ts)
store_snapshot?: {
  empresa: { nome: string; grid_minutos: number }
  setor?: { id: number; nome: string; hora_abertura: string; hora_fechamento: string }
  colaboradores?: Array<{ id: number; nome: string; tipo: string; funcao_id: number | null }>
  postos?: Array<{ id: number; apelido: string; titular_id: number | null }>
  ciclo?: { N: number; K: number; semanas: number }
  ausentes?: Array<{ nome: string; tipo: string; datas: string }>
  avisos?: Array<{ id: string; nivel: string; titulo: string }>
  escalaAtual?: { id: number; status: string; cobertura: number }
}
```

### Impacto no discovery.ts

- Se `store_snapshot` presente: pular queries de setores, feriados, regras, alertas que o snapshot ja cobre
- Economia: ~10 queries por mensagem quando setor ta aberto
- IA SABE o que o usuario ta vendo ("usuario ve cobertura 85% com 2 avisos")

### Arquivos a modificar

| Arquivo | Mudanca |
|---------|---------|
| `store/appDataStore.ts` | Metodo `snapshot()` que retorna objeto leve |
| `componentes/IaChatView.tsx` | Incluir snapshot no contexto enviado ao chat |
| `main/ia/discovery.ts` | Ler snapshot quando disponivel, pular queries redundantes |
| `shared/types.ts` ou `main/ia/discovery.ts` | Tipo `IaContexto` atualizado |

---

## 9. A12 — Eliminar tools redundantes da IA

### Problema

5 tools da IA fazem queries que o discovery ja injeta automaticamente em cada turno:

| Tool | O que faz | Discovery ja cobre? |
|------|-----------|---------------------|
| `listar_memorias` | Lista memorias IA | SIM — `_memorias()` injeta todas |
| `consultar("setores")` | Lista setores | SIM — `_listaSetores()` injeta |
| `consultar("feriados")` | Lista feriados proximos | SIM — `_feriadosProximos()` injeta |
| `consultar("regra_empresa")` | Lista overrides de regras | SIM — `_regrasCustom()` injeta |
| `obter_alertas` | Alertas do sistema | SIM — `_coreAlerts()` injeta |

### Solucao

Remover essas 5 tools do `IA_TOOLS` e `TOOL_SCHEMAS`. A IA ja recebe essas informacoes no system prompt via discovery. Com o snapshot do store (A11), a redundancia fica ainda mais evidente.

**NAO remover as tools de ESCRITA** (salvar_memoria, criar, editar_regra, etc.) — so as de leitura pura que o discovery substitui.

### Arquivos a modificar

| Arquivo | Mudanca |
|---------|---------|
| `main/ia/tools.ts` | Remover 5 entries de IA_TOOLS e TOOL_SCHEMAS |
| `main/ia/system-prompt.ts` | Atualizar referencia de "34 tools" pra "29 tools" |

---

## 10. Bugfix — campos fantasma `data_nascimento` no tools.ts

### Problema (ja corrigido)

A IA tool `criar` para colaboradores referenciava 3 campos que nao existem no banco:
- `data_nascimento` — no schema Zod, no CAMPOS_VALIDOS, e no applyColaboradorDefaults
- `hora_inicio_min` — no schema Zod e no CAMPOS_VALIDOS
- `hora_fim_max` — no schema Zod e no CAMPOS_VALIDOS

A funcao `applyColaboradorDefaults` gerava um `data_nascimento` aleatorio e injetava no INSERT, causando erro PostgreSQL 42703.

### Fix aplicado

- Removidos 3 campos do `CriarColaboradorSchema`
- Removidos do `CAMPOS_VALIDOS.colaboradores`
- Removida geracao de `data_nascimento` e defaults de horario do `applyColaboradorDefaults`
- Corrigido `tipo_trabalhador` default de `'regular'` para `'CLT'`
- Adicionado `funcao_id` ao CAMPOS_VALIDOS (campo real que faltava)
