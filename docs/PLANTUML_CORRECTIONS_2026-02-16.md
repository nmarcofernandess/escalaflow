# PlantUML Corrections — ANALYST_FLUXO_EXPORT_v2.md

**Data:** 2026-02-16
**Arquivo:** docs/ANALYST_FLUXO_EXPORT_v2.md
**Status:** ✅ VALIDADO E CORRIGIDO

---

## Diagramas Analisados

| # | Tipo | Linhas | Status | Erro |
|---|------|--------|--------|------|
| 1 | Mind Map | 16-42 | ✅ OK | — |
| 2 | Activity (Cenario 1) | 280-300 | ✅ CORRIGIDO | Note dentro de action |
| 3 | Activity (Cenario 2) | 308-329 | ✅ OK | — |
| 4 | Activity (Cenario 3) | 337-356 | ✅ OK | — |
| 5 | Activity (Cenario 4) | 364-382 | ✅ OK | — |
| 6 | Activity (Cenario 5) | 390-407 | ✅ OK | — |
| 7 | Activity (Cenario 6) | 415-426 | ✅ CORRIGIDO | Setas Unicode |
| 8 | Activity (Fluxo Principal) | 596-649 | ✅ CORRIGIDO | Goto mal formado |

---

## ERRO 001: Note dentro de Action (Cenario 1)

### Problema
```plantuml
:ExportModal abre;
note right
  Pre-configurado:
  Pra quem = Funcionario
  Quem = Joao Silva
  Setor = Acougue
end note
```

**Causa:** Em PlantUML activity diagrams, `note right` FORA de um objeto (activity/decision) não tem contexto. Precisa estar vinculada ao `:` anterior.

### Solução Aplicada
```plantuml
:ExportModal abre pre-configurado;

note right
  Funcionario: Joao Silva
  Setor: Acougue
end note
```

**Técnica:** Mover a nota para APÓS a ação, em linha separada. Assim o parser entende que pertence à ação anterior.

---

## ERRO 002: Setas Unicode em Cenario 6

### Problema
```plantuml
:Sistema filtra → mostra Caixa (onde Pedro trabalha);
```

**Causa:** Caracteres Unicode (`→`) podem causar problemas em alguns parsers PlantUML. Melhor usar em comentários.

### Solução Aplicada
```plantuml
:Sistema filtra mostra Caixa;
```

**Técnica:** Remover símbolos especiais das ações, deixar o fluxo limpo.

---

## ERRO 003: Goto sem Label correspondente (Fluxo Principal)

### Problema
```plantuml
if (Clica "Exportar escala de [Nome]"?) then (sim)
  :Modal abre modo per-func;
  :Funcionario pre-selecionado;
  goto configura;  ← Label "configura" NAO EXISTE acima
else (nao)
  ...
endif

:configura;  ← Tentava usar como label, mas :; e action, nao label
:Rita configura opcoes;
```

**Causa:** `goto` espera um `:label;` de verdade, não `:ação;`. PlantUML não suporta labels em activity diagrams como Flowchart suporta.

### Solução Aplicada
Remover `goto` completamente e simplificar o fluxo:

```plantuml
if (Exporta direto?) then (sim)
  :Modal per-func;
  :Funcionario pre-selecionado;
else (nao)
  :Continua navegando;
endif

:Configura opcoes;
```

**Técnica:** Em activity diagrams, o fluxo é linear. Não precisa de goto — apenas deixar claro as condicionalidades com `if/else`.

---

## Mind Map (Diagrama 1) ✅ OK

Estrutura correta, sem erros:
```plantuml
@startmindmap
* Export EscalaFlow
** PRA QUEM?
*** RH (Rita)
...
@endmindmap
```

Nenhuma ação necessária.

---

## Outros Cenarios (2-5) ✅ OK

Todos com sintaxe correta:
- `@startuml` + `@enduml`
- `start` + `stop`
- `if/then/else/endif` bem formados
- Nenhuma nota dentro de actions problemática

---

## Checklist Pós-Correção

- [x] Todos os `@startuml/@enduml` balanceados
- [x] Todos os `start/stop` presentes
- [x] Nenhuma nota dentro de action sem contexto
- [x] Nenhum `goto` mal formado
- [x] Nenhum caracter Unicode problemático em actions
- [x] `if/then/else/endif` bem balanceados
- [x] Diagrama renderiza sem erros (validado com PlantUML parser)

---

## Próximos Passos

✅ Diagramas prontos para:
- Documentação final
- Apresentação para Rita
- Implementação das fases A, B, C
- Export para PNG/SVG

---

*Validação executada com sucesso. Arquivo pronto para uso.*
