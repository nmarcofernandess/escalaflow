# BACKLOG — Intermitente

> Pendencias relacionadas ao tipo trabalhador INTERMITENTE.
> Nao implementado. Pra resolver DEPOIS do Painel Unico.

---

## 1. Intermitente basico funcionando

### Estado atual
- tipo_trabalhador='INTERMITENTE' existe no sistema
- Bridge exclui do ciclo domingo (calcularCicloDomingo)
- Bridge marca dias sem regra como blocked (folga_fixa=true)
- dias_trabalho = count de dias com toggle ON
- Guard H10: horas_semanais=0 pula validacao
- Seed: Manoel corrigido (tipo_trabalhador='INTERMITENTE', ativo=false)

### Pendencias
- [ ] Verificar se Manoel no banco REAL tem tipo_trabalhador correto
- [ ] Guard: tipo_trabalhador deve ser derivado do contrato automaticamente
  - Se contrato.nome contem 'Intermitente', forcar tipo_trabalhador='INTERMITENTE'
  - Prevenir situacao de intermitente com tipo_trabalhador='CLT'
- [ ] UI: toggle de dias disponiveis no ColaboradorDetalhe funciona?
- [ ] Solver: intermitente com 0 dias ativos — como o solver lida? Ignora ou INFEASIBLE?

---

## 2. Intermitente 2 Perfis (FUTURO)

### Conceito
Dois perfis distintos de intermitente no Supermercado Fernandes:

**Tampao (Manoel):**
- Trabalha quase todo dia
- Constante, previsivel
- NAO afeta escala dos colegas (nao entra no rodizio)
- Exemplo: cobre ferias, atestados

**Ciclica (Maria Clara):**
- Trabalha a cada 15 dias (quinzenal)
- AFETA escala dos colegas (quando ela ta, sobra gente; quando nao, falta)
- Precisa de alternancia: S1 trabalha, S2 nao, S3 trabalha...

### Decisoes pendentes
- Bridge resolve sozinha (alternando semanas) ou solver precisa saber?
- Como representar no banco? Campo novo? Regra especial?
- UI: como o RH configura "a cada 15 dias"?
- Spec existente: `docs/ANALYST_INTERMITENTE_DOIS_PERFIS.md`

---

## 3. Docs relacionados
- `docs/ANALYST_INTERMITENTE_DOIS_PERFIS.md` — spec pra pensar
- `docs/ANALYST_INTERMITENTE_DIAS_DISPONIVEIS.md` — dias disponiveis
- `memory/feedback_tipos_trabalhador.md` — APRENDIZ nao existe, so CLT/ESTAGIARIO/INTERMITENTE
