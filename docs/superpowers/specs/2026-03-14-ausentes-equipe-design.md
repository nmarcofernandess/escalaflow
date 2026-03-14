# Ausentes na Equipe — Design Spec

> Aprovado: 2026-03-14
> Dominio: A (Context/Store) + C (UI)
> Motivacao: RH nao ve quem esta de ferias/atestado no setor. Dashboard mostra 0 pra ferias futuras. Posto fica "normal" quando titular esta fora.

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
