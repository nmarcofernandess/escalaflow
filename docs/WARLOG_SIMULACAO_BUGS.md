# WARLOG: Bugs e pendencias da tab Simulacao

> Data: 2026-03-14 01:50
> Status: EM GUERRA

## MISSAO

Fazer a tab Simulacao funcionar corretamente e parecer intencional.

## DASHBOARD

| ID | Bug/Task | Tipo | Viab. | Dep. | Est. |
|----|----------|------|-------|------|------|
| B1 | Nomes dos colaboradores sumiram (mostra AC1 ao inves de Alex) | Bug | G | - | P |
| B2 | Escala dos dias bugada (FF/FV em posicoes erradas, logica do gerarCicloFase1 folgasForcadas quebrando padroes) | Bug | G | - | G |
| B3 | Resetar nao funciona | Bug | G | - | P |
| B4 | Editar no modo Resumo (ciclo completo) nao permite mudar F/V | Bug | G | - | M |
| B5 | Badges "Sem TT", "H1 OK", "Cob 2-5" poluem — remover | Bug | G | - | P |
| B6 | Demanda DOM real vs Padrao: K ta sendo calculado errado quando dom tem demanda propria diferente do padrao | Bug | Y | - | M |
| B7 | 3 pessoas nunca aparece na cobertura de domingo (sempre 2 max) | Bug | Y | B6 | M |

## CAMINHO CRITICO

```
B1 (nomes) → independente, fix rapido
B5 (badges) → independente, fix rapido
B3 (resetar) → independente, investigar handler
B2 (logica dias) → CRITICO, o core do preview ta bugado
B4 (editar resumo) → depende de B2 funcionar
B6 (demanda K) → investigar se dom tem tab propria
B7 (cobertura) → consequencia de B6
```

## PROXIMO PASSO

Atacar B1 + B5 + B3 (rapidos) e depois B2 (o core).
