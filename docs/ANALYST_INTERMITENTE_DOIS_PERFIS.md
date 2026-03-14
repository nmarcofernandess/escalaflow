# ANALYST — Intermitente: 2 Perfis Distintos

> Data: 2026-03-13 | Status: SPEC PARA PENSAR — nenhuma decisao tomada

---

## TL;DR

Existem dois tipos fundamentalmente diferentes de intermitente. O sistema precisa tratar cada um de forma distinta porque um AFETA a escala dos colegas e o outro NAO.

---

## OS 2 PERFIS

### Perfil 1 — "Tampao" (Manoel do Acougue)

```
Manoel — Intermitente Acougue
  DOM: trabalha 07:00-13:00 (todo domingo)
  SEG-SAB: nunca

Efeito na escala: NENHUM.
Manoel cobre um horario de domingo, mas a presenca dele
NAO permite que ninguem descanse mais.
Na semana seguinte, ele esta la de novo. Ele e uma constante.
Os CLT do acougue escalam entre si como se ele nao existisse.
```

**Caracteristicas:**
- Trabalha SEMPRE nos dias ativos (sem alternancia)
- Nao participa do ciclo domingo
- Nao altera o calculo de N_dom (excluido)
- E como um "slot fixo preenchido" — os demais nem sabem que ele existe
- Toggle ON/OFF estatico — o que implementamos hoje

### Perfil 2 — "Ciclica" (Maria Clara)

```
Maria Clara — Intermitente (setor X)
  DOM: trabalha 1 sim, 1 nao (quinzenal)
  SEG: trabalha 1 sim, 1 nao (quinzenal)
  TER-SAB: nunca

Semana 1 (Maria Clara PRESENTE):
  DOM: Maria Clara + 2 CLT trabalham (3 total)
       → 3 CLT descansam no domingo
  SEG: Maria Clara + equipe reduzida
       → 3 CLT que trabalharam dom descansam seg

Semana 2 (Maria Clara AUSENTE):
  DOM: as 3 CLT que descansaram semana passada voltam
       → 3 total no domingo SEM Maria Clara
  SEG: escala normal sem Maria Clara

Efeito na escala: DIRETO.
A presenca de Maria Clara na semana 1 PERMITE que 3 pessoas
descansem. Na semana 2, essas 3 voltam e cobrem a ausencia dela.
Ela e parte do FLUXO da escala — a escala dos CLT depende de
saber se ela esta ou nao naquela semana.
```

**Caracteristicas:**
- Trabalha em ALTERNANCIA (ciclo nos dias ativos)
- PARTICIPA do fluxo da escala — afeta folgas dos colegas
- Deveria entrar no calculo de alguma forma (como "meia pessoa"? como pessoa em semanas pares?)
- A escala dos CLT muda dependendo de ela estar ou nao
- Toggle ON/OFF NAO basta — precisa de recorrencia

---

## A DIFERENCA FUNDAMENTAL

| Aspecto | Tampao (Manoel) | Ciclica (Maria Clara) |
|---------|-----------------|----------------------|
| Presenca | Constante (todo domingo) | Alternada (quinzenal) |
| Efeito nos colegas | Nenhum | Direto — muda quem folga |
| Participa do ciclo | Nao | Sim — ela E o ciclo |
| Calculo N_dom | Excluida | Precisa entrar de alguma forma |
| O que o solver precisa saber | "Essa pessoa ta la todo domingo" | "Essa pessoa ta la ESTE domingo, mas nao o proximo" |
| Implementacao atual | Funciona (toggle + folga_fixa) | NAO funciona (sem recorrencia) |

**A sacada:** O Manoel e uma CONSTANTE na equacao. Maria Clara e uma VARIAVEL CICLICA. O solver precisa saber que em semanas pares tem +1 pessoa e em impares nao, e planejar as folgas dos CLT de acordo.

---

## PERGUNTAS ABERTAS (pra pensar)

1. **Maria Clara conta no N_dom?**
   - Hoje: NAO (intermitente excluido)
   - Deveria: PARCIALMENTE? Como "0.5 pessoa"? Ou conta inteira em semanas ativas e zero em inativas?
   - Ou: a bridge expande ela pra 2 "versoes" — uma com e outra sem?

2. **O solver precisa saber da alternancia ou a bridge resolve?**
   - Opcao A: bridge calcula quais semanas ela esta ativa e marca folga_fixa nas inativas (solver ve dias bloqueados, sem saber do ciclo)
   - Opcao B: solver recebe metadata de recorrencia e trata internamente
   - Intuicao: A e mais simples, mas o solver nao consegue otimizar as folgas dos CLT sabendo que Maria Clara vem e vai

3. **Como o solver planeja as folgas dos CLT sabendo da alternancia?**
   - Se Maria Clara ta la semana 1, o solver pode dar folga a 3 CLT
   - Se Maria Clara NAO ta la semana 2, o solver precisa ter essas 3 de volta
   - Isso e um ACOPLAMENTO entre o ciclo da Maria Clara e o ciclo dos CLT
   - O solver precisa "ver" as duas semanas juntas pra planejar

4. **UI: como o RH cadastra isso?**
   - Toggle ON pra DOM e SEG (quais dias) — ja temos
   - + Campo "Frequencia: toda semana / quinzenal / a cada 3 semanas"
   - + Campo "Semana de referencia" (quando comeca o ciclo)

5. **Isso se integra com o Ciclo V3 (BUILD_CICLO_V3_FONTE_UNICA)?**
   - O calculo automatico de ciclo na bridge precisaria considerar Maria Clara
   - Em semanas com ela: N_dom efetivo = N_clt + 1
   - Em semanas sem ela: N_dom efetivo = N_clt
   - O ciclo ideal pode ser DIFERENTE dependendo da semana

6. **Existe um terceiro perfil?**
   - Tampao constante (Manoel)
   - Ciclica quinzenal (Maria Clara)
   - E se alguem trabalha 1 semana sim, 2 nao? Ou so em semanas com feriado?
   - Ate onde generalizar sem over-engineering?

---

## REFERENCIA

| Documento | Relacao |
|-----------|---------|
| `docs/ANALYST_INTERMITENTE_DIAS_DISPONIVEIS.md` | Spec original do intermitente (Perfil 1 — Tampao) |
| `docs/BUILD_CICLO_V3_FONTE_UNICA.md` | Ciclo V3 — calculo automatico que precisaria integrar com Perfil 2 |
| `solver/solver_ortools.py` | Onde intermitente e excluido do ciclo (decisao pro Perfil 1, nao pro 2) |
| `src/main/motor/solver-bridge.ts` | Onde a bridge monta regras_colaborador_dia — ponto de integracao |

---

*"Manoel e uma constante. Maria Clara e uma variavel ciclica. O solver precisa saber a diferenca."*
