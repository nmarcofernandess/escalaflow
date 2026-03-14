# BACKLOG — Geracao de escala com e sem info (validacao Gracinha)

> A mae do Marco (Gracinha) questiona: "pra que cadastrar tudo se o ciclo sempre
> fica igual depois?" Este backlog documenta a prova de conceito e o que falta
> pra demonstrar visualmente a diferenca.

---

## 1. A pergunta

"Se eu gero o ciclo de escala, ele sempre vai ser igual depois.
Pra que cadastrar demanda, horario, tudo isso?"

## 2. A resposta (prova de conceito)

Doc: `docs/backlog/PROVA_CONCEITO_GRACINHA.md`

Mostra com numeros reais:
- **Sem info (p%6):** 4 dias com deficit — folgas caem em dias criticos por acaso
- **Com info (auto inteligente):** 2 dias com deficit — concentra folgas onde demanda e baixa
- **Solver (OR-Tools):** 1-2 dias com deficit — otimizado

Conclusao: "O ciclo sem cadastrar e como receita de bolo sem saber os ingredientes.
Funciona, mas nao e o melhor bolo possivel."

## 3. O que falta pra demonstrar na UI

- [ ] Modo comparativo: preview "sem info" ao lado de preview "com info"
  - Mostrar cobertura de cada um
  - Mostrar deficit de cada um
  - RH ve a diferenca visual
- [ ] autoFolgaInteligente implementado (hoje e p%6)
  - Sem ele, "com info" e igual a "sem info" (mesma formula cega)
- [ ] Linha DEMANDA embaixo da COBERTURA no grid
  - Sem essa linha, o RH nao ve o deficit

## 4. Quando fazer
Depois do Painel Unico estar funcionando (depende de Context + autoFolgaInteligente).
