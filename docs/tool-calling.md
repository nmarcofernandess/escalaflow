# Tool Calling — De 30 Tools para 5

> **Visualizacao interativa:** abra `docs/tool-calling-playground.html` no browser.

---

## Por que fizemos isso

A IA do EscalaFlow tinha **30 tools atomicas** expostas ao LLM. Cada tool era 1:1 com uma operacao de banco: `criar`, `atualizar`, `deletar`, `salvar_posto_setor`, `salvar_regra_horario_colaborador`, etc.

Isso causava tres problemas concretos:

### 1. O LLM nao via o preview

O motor de ciclo (`simula-ciclo.ts`) calcula cobertura por dia, deficit, distribuicao de folgas. Mas o discovery nao injetava isso no contexto. Resultado: a IA respondia "ta tudo ok" quando o preview mostrava 2/4 de cobertura.

**Exemplo real:**
```
Usuario: "a distribuicao de folgas da padaria ta boa?"

ANTES: IA chamava consultar() 3x tentando descobrir algo que o preview ja sabia.
AGORA: IA le o contexto e responde direto — "Cobertura 100%, deficit 0,
       mas tem conflito de folga variavel na segunda com 3/4 de cobertura."
```

### 2. Tools redundantes compensavam contexto pobre

`listar_perfis_horario` existia porque o contexto nao trazia perfis de contrato. `listar_conhecimento` existia porque o catalogo nao estava no briefing. Cada tool dessas era um round-trip desnecessario.

### 3. O LLM errava na escolha entre 30 opcoes

Com 30 tools, o LLM gastava tokens decidindo qual chamar. `salvar_regra_horario_colaborador` vs `upsert_regra_excecao_data` vs `configurar_horario_funcionamento` — nomes parecidos, semanticas diferentes. O LLM confundia.

---

## O que mudamos

### Context-first

O discovery (`discovery.ts`) agora injeta no briefing:

| Secao | O que a IA ve | Antes |
|-------|---------------|-------|
| Preview de ciclo | Cobertura por dia, deficit, warnings, ciclo | Nao existia |
| Contratos + perfis | Contratos do setor com perfis embutidos | Era tool separada |
| Equipe completa | Colaboradores, postos, titulares, regras individuais | Parcial |
| Escala atual | Status, violacoes, pode oficializar | Parcial |
| Knowledge catalogo | Stats + titulos top | Era tool separada |
| Alertas | Poucos colabs, hard violations, drift | Parcial |

**Budget:** ~1500 tokens para contexto de setor. Cabe no prompt sem problemas.

### 5 Familias

| Tool publica | O que faz | Absorve |
|--------------|-----------|---------|
| `consultar_contexto` | Leitura sob demanda | consultar, buscar_colaborador, preflight, diagnosticar_*, explicar_violacao, resumir_horas |
| `editar_ficha` | CRUD schema-driven | criar, atualizar, deletar, salvar_posto, salvar_regra_horario, salvar_demanda_excecao, salvar_perfil, configurar_horario, editar_regra |
| `executar_acao` | Comandos de dominio | gerar_escala, oficializar, ajustar_celula, ajustar_horario, backup, resetar_regras, cadastrar_lote |
| `salvar_memoria` | Memoria curta RH | (passthrough) |
| `remover_memoria` | Remove memoria | (passthrough) |

### Adapter transparente

Os **30 handlers internos nao mudaram**. O adapter (`tool-families.ts`) roteia:

```
LLM chama editar_ficha({ entidade: 'regra_horario', dados: {...} })
    |
    v
routeFamilyTool() mapeia para 'salvar_regra_horario_colaborador'
    |
    v
executeTool('salvar_regra_horario_colaborador', args)  // mesmo handler de antes
```

Se der merda, reverter = trocar 1 import em `cliente.ts`.

---

## Resultado

| Metrica | Antes | Depois |
|---------|-------|--------|
| Tools expostas ao LLM | 30 | 5 |
| Preview no contexto | Nao | Sim |
| Round-trips para "tem deficit?" | 3+ tool calls | 0 (contexto basta) |
| E2E tests passando | - | 7/7 |
| Parity test (30→5) | - | 31/31 |
| Routing unit tests | - | 38/38 |

### Tools removidas da surface (por design)

| Tool | Razao |
|------|-------|
| `buscar_conhecimento` | RAG roda como auto-discovery pre-LLM |
| `salvar_conhecimento` | Backoffice, nao chat RH |
| `explorar_relacoes` | Admin/debug, nao chat RH |

Os handlers dessas tools continuam no codigo para uso interno.

---

## Arquitetura

```
                    ┌─────────────────────────┐
                    │   System Prompt (5 tools) │
                    │   + Context Briefing      │
                    │   (preview, equipe, etc)  │
                    └────────────┬──────────────┘
                                 │
                    ┌────────────▼──────────────┐
                    │         LLM               │
                    │  Gemini / OpenRouter /     │
                    │  Local (node-llama-cpp)    │
                    └────────────┬──────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
     consultar_contexto    editar_ficha      executar_acao
              │                  │                  │
              └──────────────────┼──────────────────┘
                                 │
                    ┌────────────▼──────────────┐
                    │   tool-families.ts         │
                    │   routeFamilyTool()        │
                    │   executeFamilyTool()      │
                    └────────────┬──────────────┘
                                 │
                    ┌────────────▼──────────────┐
                    │   tools.ts                │
                    │   executeTool()            │
                    │   30 handlers internos     │
                    │   (intactos, nao mudaram)  │
                    └───────────────────────────┘
```

## Arquivos chave

| Arquivo | Papel |
|---------|-------|
| `src/main/ia/tool-families.ts` | Schemas Zod + routing + execute das 5 familias |
| `src/main/ia/tools.ts` | 30 handlers internos + `IA_TOOLS_PUBLIC` + `getVercelAiFamilyTools()` |
| `src/main/ia/discovery.ts` | Context bundle com preview, equipe, demanda, alertas |
| `src/main/ia/system-prompt.ts` | Prompt reescrito para 5 familias |
| `src/main/ia/cliente.ts` | Usa `getVercelAiFamilyTools()` nos paths streaming e non-streaming |
| `tests/ia/tool-families.test.ts` | 38 unit tests de routing |
| `tests/ia/tool-families-parity.test.ts` | 31 tests provando cobertura 30→5 |
| `tests/e2e/ia-chat-tool-calls.spec.ts` | 7 E2E tests no Electron real |

## Referencia

- **Spec de design:** `docs/superpowers/specs/2026-03-21-context-tools-reduction-design.md`
- **Plano de implementacao:** `docs/superpowers/plans/2026-03-22-5-tools-implementation-plan.md`
- **Playground visual:** `docs/tool-calling-playground.html`
