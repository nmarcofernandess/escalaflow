# REVISAO DE DECISOES — Auditoria pos-implementacao

## CONTEXTO

Durante sessoes de prototipagem e planejamento, o Marco toma decisoes comigo que muitas vezes NAO chegam no codigo. Isso acontece porque:
1. Decisoes verbais nao foram registradas na spec
2. Agents que implementaram nao tinham o contexto da conversa
3. Detalhes se perderam entre prototipo → spec → plano → execucao

**Resultado: o Marco tem que repetir a mesma coisa varias vezes. Inaceitavel.**

---

## SUA TAREFA

Voce vai revisar TUDO que voce implementou nesta sessao e comparar com TUDO que o Marco pediu, decidiu ou aprovou. O objetivo e encontrar coisas que o Marco falou e voce nao fez.

### PASSO 1: LEVANTAR DECISOES

Releia TODA a conversa desta sessao do inicio ao fim. Para cada momento em que o Marco:
- Pediu algo ("tira isso", "muda pra X", "nao quero Y")
- Deu feedback ("ta errado", "faltou", "nao era assim")
- Aprovou algo ("beleza", "perfeito", "fechou")
- Rejeitou algo ("nao", "horrivel", "tira")

Anote como uma decisao:
```
DN: [descricao curta]
- O que o Marco disse: [citacao ou parafraseado]
- O que deveria estar no codigo: [comportamento esperado]
```

### PASSO 2: VERIFICAR CADA DECISAO NO CODIGO

Para CADA decisao levantada:
1. Defina um comando de busca (grep, glob, ou leitura direta do arquivo)
2. Execute a busca
3. Compare o resultado com o esperado
4. Marque: OK ou VIOLACAO

### PASSO 3: CORRIGIR VIOLACOES

Para cada VIOLACAO encontrada:
1. Liste TODAS as ocorrencias (arquivo:linha)
2. Corrija CADA uma
3. Rode a busca de novo pra confirmar zero restantes
4. `npm run typecheck` apos cada correcao

### PASSO 4: REPORTAR

Preencha o checklist:
```
D1  [descricao]:  [OK] ou [VIOLACAO → corrigido em arquivo:linha]
D2  [descricao]:  [OK] ou [VIOLACAO → corrigido em arquivo:linha]
...
```

---

## REGRAS

1. **NAO PULE NENHUMA DECISAO.** Mesmo que pareça trivial.
2. **NAO ASSUMA QUE ESTA IMPLEMENTADO.** Verifique com grep/leitura.
3. **CORRIGE TUDO ANTES DE REPORTAR.** Nao reporte violacao sem corrigir.
4. **SE NAO TEM CERTEZA, LEIA O ARQUIVO.** Grep e pra encontrar. Read e pra confirmar.
5. **SALVE AS DECISOES IMPORTANTES NA MEMORIA** do projeto pra nao perder em sessoes futuras.

---

## ANTI-PATTERNS

| Errado | Certo |
|--------|-------|
| "Acho que ja fiz isso" | Rodar grep e confirmar |
| Corrigir 1 ocorrencia e parar | Buscar TODAS as ocorrencias |
| Handler vazio `() => {}` | Implementar o comportamento real |
| Registrar na spec mas nao no codigo | Codigo e a fonte de verdade |
| "Vou deixar como TODO" | Se o Marco pediu, FACA |
