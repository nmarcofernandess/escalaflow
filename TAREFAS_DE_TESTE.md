# Tarefas de Teste — Painel Unico de Escala

> Data: 2026-03-15
> Testar com: `npm run dev` no banco real (nao seed)
> Setor recomendado: Acougue (5 postos CLT)

---

## COMO TESTAR

1. `git pull` pra pegar todos os commits
2. `npm run dev`
3. Ir pro setor Acougue
4. Seguir os cenarios abaixo

---

## DOMINIO A — Context Provider (CLAUDE A)

### A1-A2: AppDataStore funciona

- [ ] Abrir setor Acougue → dados carregam (colaboradores, postos, demandas aparecem)
- [ ] Navegar pra outro setor → dados trocam
- [ ] Voltar pro Acougue → dados recarregam

### A3: Derivados automaticos

- [ ] Na tab Simulacao: preview do ciclo aparece com S1..S5 (nao S3)
- [ ] Se tem aviso (K limitado, deficit, etc) → aparece na area de avisos
- [ ] Se nao tem aviso → area de avisos vazia (nao polui)

### A4-A6: Invalidacao reativa

- [ ] Editar F/V de um colaborador na tabela Equipe → preview ATUALIZA sozinho
- [ ] Criar novo posto → preview recalcula (N muda)
- [ ] Deletar posto → preview recalcula
- [ ] Mudar demanda (faixa horaria) → verificar se avisos mudam
- [ ] Abrir chat IA → pedir "crie colaborador Teste" → lista de colaboradores atualiza na pagina

### A7-A9: Migracao hooks

- [ ] SetorDetalhe funciona normalmente (sem erros no console)
- [ ] EscalaPagina ("Ver completo") funciona
- [ ] ColaboradorLista funciona

### A11: Snapshot IA

- [ ] Abrir chat IA no setor Acougue → IA sabe o nome do setor e quantos colaboradores tem
- [ ] Perguntar "quantas pessoas no Acougue?" → resposta correta

---

## DOMINIO B — Logica do Ciclo (CLAUDE B)

### B1-B3: Fix folga_fixa=DOM

- [ ] Colaborador com folga fixa = DOM → preview mostra ele com DOM sempre FOLGA
- [ ] Variavel desse colaborador = "-" (nao faz sentido)
- [ ] Ciclo dos OUTROS nao conta esse colaborador no N
- [ ] Gerar Escala → solver respeita (nao escala ele no domingo)

### B4: autoFolgaInteligente

- [ ] Remover TODAS as F/V dos colaboradores (deixar "-" em todos)
- [ ] Preview gera automaticamente com folgas distribuidas
- [ ] Folgas NAO ficam concentradas no mesmo dia (verifica cobertura na ultima linha)
- [ ] Se demanda de SAB e menor que SEG → mais folgas no SAB

### B6: Guard funcao_id=null

- [ ] Colaborador na reserva operacional (sem posto) → NAO aparece no preview
- [ ] NAO aparece na escala gerada

### B7: Guard tipo_trabalhador

- [ ] Intermitente → NAO aparece no preview do ciclo
- [ ] Intermitente → aparece na Equipe como "locked" (pontos no grid)

### B8-B9: Mensagens de erro

- [ ] Forcar erro: colocar demanda impossivel (ex: 10 pessoas por faixa com 5 postos)
- [ ] Clicar "Gerar Escala"
- [ ] Toast aparece com mensagem + botao "Analisar com IA"
- [ ] Clicar "Analisar com IA" → abre chat IA

### pinned_folga_externo

- [ ] Gerar Escala com preview visivel → solver usa padrao do preview (T/F iguais)
- [ ] Se solver descartou padrao (pass 2+) → diagnostico mostra isso

---

## DOMINIO C — UI/UX (CLAUDE C + Monday)

### C1: CicloGrid unificado

- [ ] Grid mostra todas as semanas do ciclo horizontalmente (scroll)
- [ ] Headers S1/S2/S3... sem fundo + dias com fundo
- [ ] Colunas Nome+Posto empilhadas, Var/Fixo sticky
- [ ] Legenda embaixo com simbolos (T, DT, F, FF, FV, I)
- [ ] Linha COBERTURA com cob/dem (ex: 3/4) — vermelho se deficit, verde se OK

### C2: Preflight itens minimos

- [ ] Remover empresa (Config → deletar empresa) → checklist aparece "Empresa ❌"
- [ ] Restaurar empresa → checklist some (allOk)
- [ ] Sem colaboradores → checklist mostra "Colaboradores ❌"
- [ ] Com tudo OK → checklist SOME (nao polui)

### C4: Siglas padronizadas

- [ ] No grid: FF (cinza), FV (amarelo), DT (amarelo+ring), DF (azul)
- [ ] Exportar escala (botao Exportar) → HTML usa FF e FV (nao [F] ou (V))
- [ ] Imprimir (Ctrl+P no export) → siglas iguais

### C6: Area de avisos

- [ ] Com problemas (deficit, K limitado, etc) → avisos aparecem EMBAIXO do grid
- [ ] Cada aviso tem icone (triangulo vermelho/amarelo, info azul)
- [ ] Botao "Pedir sugestao" aparece → abre drawer de baixo

### C7: SugestaoSheet (drawer de sugestao)

- [ ] Clicar "Pedir sugestao" → Sheet abre de baixo
- [ ] Mostra tabela diff: Colaborador | Variavel (atual → proposta) | Fixo (atual → proposta)
- [ ] Icones: manteve (muted), mudou (zap amarelo), adicionou (plus verde)
- [ ] Resultados: "Cobertura OK", "Sem TT", "H1 OK" (ou deficit se houver)
- [ ] Clicar "Aceitar sugestao" → toast "Sugestao aplicada" → F/V mudam no banco
- [ ] Preview recalcula com novos F/V
- [ ] Clicar "Descartar" → fecha sheet, nada muda

### Preview condicional

- [ ] Se derivados tem aviso com nivel='erro' → grid ESCONDE
- [ ] Mostra: "Resolva os problemas abaixo antes de visualizar o ciclo"
- [ ] Resolver o problema → grid APARECE

### Avisos de operacao

- [ ] Forcar preflight falhar (ex: deletar demandas)
- [ ] Clicar "Gerar Escala"
- [ ] Aviso de operacao aparece ACIMA do grid (borda vermelha)
- [ ] Recadastrar demandas → aviso some

---

## VIABILIDADE POR FAIXA HORARIA (NOVO)

- [ ] Configurar demanda: 1 faixa com 3 pessoas (ex: 07:00-08:00) + resto com 2
- [ ] Aviso INFO aparece: "Pico de 3 pessoas na faixa 07:00-08:00 (resto usa 2)"
- [ ] Mensagem sugere intermitente ou redistribuir

---

## TESTES AUTOMATIZADOS

```bash
npm run typecheck           # 0 erros
npm run solver:test:parity  # Acougue + Rotisseria passed
npx vitest run tests/main/rule-policy.spec.ts  # 3/3 passed
```

---

## BUGS CONHECIDOS (se encontrar)

- [ ] Dashboard e EscalasHub podem ter dados stale (A10 parcial — migracao pendente)
- [ ] Preview pode nao reagir imediatamente a mudancas de demanda (debounce do DemandaEditor)
- [ ] Manoel no banco real pode ter tipo_trabalhador='CLT' — verificar e corrigir se necessario

---

## NOTAS

- Todos os testes sao no banco REAL (nao seed)
- Se algo nao funciona, verificar console do DevTools (Cmd+Option+I)
- Se preview nao atualiza, matar app e rodar `npm run dev` de novo
- Specs completas: `docs/ANALYST_PAINEL_UNICO_ESCALA.md`
- Status: `specs/STATUS.md`
