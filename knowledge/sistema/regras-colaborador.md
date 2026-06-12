<!-- quando_usar: regras individuais colaborador, janela horario, folga fixa, recorrencia semanas, intermitente NT, excecao por data, upsert_regra_excecao, hierarquia precedencia, inicio fim -->
# Regras Individuais de Colaborador no EscalaFlow

## O que são regras individuais

Cada colaborador pode ter regras de horário personalizadas que se sobrepõem ao padrão do contrato. O sistema aplica essas regras automaticamente ao gerar escalas, sem que o RH precise ajustar manualmente depois.

Exemplos de uso:
- "A Cleunice só pode trabalhar de manhã"
- "O João tem acordo de folga fixa toda quarta"
- "A Maria entra às 09:00 por questão médica"
- "A Hellen trabalha somente domingo, semana sim semana nao"

## Hierarquia de precedência (mais específico ganha)

```
Exceção por data > Regra individual > Perfil do contrato > Padrão do contrato
```

Exemplo: Se o contrato padrão é CLT 44h (08:00–18:00) e a Maria tem regra individual `início: 09:00`, o motor usa 09:00 para ela. Se na segunda-feira específica tem uma exceção de data `início: 10:00`, prevalece o 10:00.

---

## Regra Individual de Horário (recorrente)

Configura horario fixo de entrada/saida, regra por dia, recorrencia de semanas e folga fixa. Use `salvar_regra_horario_colaborador`.

### Tool: `salvar_regra_horario_colaborador`

**Campos disponíveis:**
- `colaborador_id` — obrigatório
- `dia_semana_regra` — dia especifico da regra: SEG..DOM. Se omitido/null, regra padrao.
- `inicio` — horário fixo de entrada (HH:MM)
- `fim` — horário máximo de saída (HH:MM)
- `folga_fixa_dia_semana` — folga fixa semanal: SEG, TER, QUA, QUI, SEX, SAB, DOM
- `folga_variavel_dia_semana` — dia condicional do XOR com domingo, apenas SEG..SAB; use so para rodizio real
- `recorrencia_semanas_trabalho` — semanas ON do ciclo
- `recorrencia_semanas_folga` — semanas OFF do ciclo
- `recorrencia_ancora` — data em uma semana ON
- `preferencia_turno_soft` — preferência soft de turno: MANHA, TARDE, NOITE
- `perfil_horario_id` — vincula a um perfil de horário pré-definido do contrato
- `ativo` — ativa/desativa a regra

### Intermitente e NT

Para intermitente, regras por dia definem convocacao. Dia sem regra ativa = **NT (Nao Trabalha)** na UI/export/IA. NT nao e folga fixa, folga variavel nem falta; e ausencia de convocacao.

- Tipo A: `folga_variavel_dia_semana = null`. Trabalha dias fixos/recorrentes. Para "domingo sim, domingo nao", use regra `DOM` + recorrencia 1/1.
- Tipo B: `folga_variavel_dia_semana != null`. Use apenas quando o intermitente participa do XOR domingo↔dia variavel.
- `folga_fixa_dia_semana` deve ficar null para intermitente.

**Exemplos:**

Funcionária que só trabalha de manhã e tem folga fixa na quarta:
```
salvar_regra_horario_colaborador({
  colaborador_id: 5,
  inicio: "09:00",
  fim: "14:00",
  folga_fixa_dia_semana: "QUA"
})
```

Intermitente que trabalha somente domingo, semana sim semana nao:
```
salvar_regra_horario_colaborador({
  colaborador_id: 8,
  dia_semana_regra: "DOM",
  inicio: "07:00",
  fim: "12:45",
  recorrencia_semanas_trabalho: 1,
  recorrencia_semanas_folga: 1,
  recorrencia_ancora: "2026-06-15",
  folga_variavel_dia_semana: null
})
```

---

## Override Pontual por Data

Para uma regra que vale em uma data específica (não recorrente), use `upsert_regra_excecao_data`.

### Tool: `upsert_regra_excecao_data`

Diferença crítica em relação à janela recorrente: esta regra só vale no dia informado.

**Exemplos:**

"Na quarta-feira (25/02) a Cleunice entra às 09:00":
```
upsert_regra_excecao_data({
  colaborador_id: 5,
  data: "2026-02-25",
  inicio: "09:00"
})
```

"Na sexta (27/02) o Pedro pode sair mais cedo, até 15:00":
```
upsert_regra_excecao_data({
  colaborador_id: 8,
  data: "2026-02-27",
  fim: "15:00"
})
```

---

## Domingos

O ciclo de domingos nao e mais configurado por campos `domingo_ciclo_*` na regra do colaborador. A bridge calcula o ciclo automaticamente a partir do setor, do regime, do sexo e da disponibilidade real do periodo.

Para CLT, o rodizio dominical e decidido pelo motor. Para intermitente Tipo A, domingo so entra quando existe regra `dia_semana_regra = DOM` e a recorrencia esta em semana ON. Para intermitente Tipo B, `folga_variavel_dia_semana` ativa o XOR domingo↔dia variavel e coloca a pessoa no pool rotativo.

A CCT FecomercioSP garante que nenhum colaborador trabalhe mais de 2 domingos seguidos sem folga dominical. Mulheres seguem protecao mais restritiva no motor atual.

---

## Folga Fixa Semanal

O campo `folga_fixa_dia_semana` garante que o colaborador sempre folga no dia configurado, independente da escala gerada.

Valores possíveis: SEG, TER, QUA, QUI, SEX, SAB, DOM

**Atenção:** Folga fixa reduz os dias disponíveis do colaborador na semana. Para um colaborador CLT 44h com folga fixa na quarta, o motor distribui as horas nos demais 6 dias (com no mínimo 1 domingo de folga obrigatório pela CLT).

---

## Verificar Regra Atual

Para consultar as regras configuradas de um colaborador:
```
obter_regra_horario_colaborador({ colaborador_id: 5 })
```

Retorna a regra individual ativa (se existir) e o perfil de horário vinculado (se houver).

---

## Quando Usar Cada Tool

| Situação | Tool correta |
|----------|-------------|
| "A Maria só pode de manhã" (recorrente) | `salvar_regra_horario_colaborador` com `fim: "14:00"` |
| "O João folga toda quarta" (recorrente) | `salvar_regra_horario_colaborador` com `folga_fixa_dia_semana` |
| "Hellen trabalha domingo sim, domingo nao" | `salvar_regra_horario_colaborador` com `dia_semana_regra: "DOM"` + recorrencia 1/1 |
| "Intermitente alterna domingo com segunda" | `salvar_regra_horario_colaborador` com regra DOM + regra SEG + `folga_variavel_dia_semana: "SEG"` |
| "Na quinta-feira específica ela entra às 10h" (pontual) | `upsert_regra_excecao_data` com `data` |
| "O Carlos está de férias na semana do dia 10" | `criar` excecao com `tipo: FERIAS` |
