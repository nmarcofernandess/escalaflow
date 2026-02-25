<!-- quando_usar: regras individuais colaborador, janela horario, definir_janela, folga fixa, ciclo domingos, excecao por data, upsert_regra_excecao, hierarquia precedencia, inicio_min fim_max -->
# Regras Individuais de Colaborador no EscalaFlow

## O que são regras individuais

Cada colaborador pode ter regras de horário personalizadas que se sobrepõem ao padrão do contrato. O sistema aplica essas regras automaticamente ao gerar escalas, sem que o RH precise ajustar manualmente depois.

Exemplos de uso:
- "A Cleunice só pode trabalhar de manhã"
- "O João tem acordo de folga fixa toda quarta"
- "A Maria entra às 09:00 por questão médica"
- "O Pedro trabalha domingos em ciclo 2:1 (2 trabalha, 1 folga)"

## Hierarquia de precedência (mais específico ganha)

```
Exceção por data > Regra individual > Perfil do contrato > Padrão do contrato
```

Exemplo: Se o contrato padrão é CLT 44h (08:00–18:00) e a Maria tem regra individual `início_máx: 09:00`, o motor usa 09:00 para ela. Se na segunda-feira específica tem uma exceção de data `início: 10:00`, prevalece o 10:00.

---

## Janela de Horário (recorrente)

Limita quando o colaborador pode iniciar e terminar, em todos os dias úteis.

### Tool: `definir_janela_colaborador`

Wrapper semântico para definir limites de horário. Mais simples que `salvar_regra_horario_colaborador`.

**Campos disponíveis:**
- `inicio_min` — mais cedo que pode começar (HH:MM)
- `inicio_max` — mais tarde que pode começar (HH:MM)
- `fim_min` — mais cedo que pode terminar (HH:MM)
- `fim_max` — mais tarde que pode terminar (HH:MM)
- `ativo` — ativa a regra ao salvar (padrão: true)

Pelo menos um dos quatro campos de limite é obrigatório.

**Exemplos:**

"Só pode de manhã":
```
definir_janela_colaborador({ colaborador_id: 5, inicio_max: "09:00", fim_max: "14:00" })
```

"Entra às 09:00 em ponto todos os dias":
```
definir_janela_colaborador({ colaborador_id: 5, inicio_min: "09:00", inicio_max: "09:00" })
```

"Não pode ficar até tarde":
```
definir_janela_colaborador({ colaborador_id: 5, fim_max: "16:00" })
```

---

## Regra Completa Individual (recorrente)

Quando precisa configurar janela + ciclo de domingo + folga fixa tudo junto, use `salvar_regra_horario_colaborador`.

### Tool: `salvar_regra_horario_colaborador`

**Campos disponíveis:**
- `colaborador_id` — obrigatório
- `inicio_min`, `inicio_max`, `fim_min`, `fim_max` — janela de horário
- `domingo_ciclo_trabalho` — quantos domingos seguidos trabalha (0–10)
- `domingo_ciclo_folga` — quantos domingos seguidos folga (0–10)
- `folga_fixa_dia_semana` — folga fixa semanal: SEG, TER, QUA, QUI, SEX, SAB, DOM
- `preferencia_turno_soft` — preferência soft de turno: MANHA, TARDE, NOITE
- `perfil_horario_id` — vincula a um perfil de horário pré-definido do contrato
- `ativo` — ativa/desativa a regra

**Exemplos:**

Funcionária que só trabalha de manhã e tem folga fixa na quarta:
```
salvar_regra_horario_colaborador({
  colaborador_id: 5,
  inicio_max: "09:00",
  fim_max: "14:00",
  folga_fixa_dia_semana: "QUA"
})
```

Funcionário com ciclo de domingo 2:1 (trabalha 2 domingos, folga 1):
```
salvar_regra_horario_colaborador({
  colaborador_id: 8,
  domingo_ciclo_trabalho: 2,
  domingo_ciclo_folga: 1
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
  inicio_min: "09:00",
  inicio_max: "09:00"
})
```

"Na sexta (27/02) o Pedro pode sair mais cedo, até 15:00":
```
upsert_regra_excecao_data({
  colaborador_id: 8,
  data: "2026-02-27",
  fim_max: "15:00"
})
```

---

## Ciclo de Domingos

O sistema gerencia automaticamente o ciclo de trabalho nos domingos. Os parâmetros são:
- `domingo_ciclo_trabalho`: número de domingos consecutivos que o colaborador trabalha
- `domingo_ciclo_folga`: número de domingos consecutivos que o colaborador folga

**Padrões comuns:**
- CLT geral: 2:1 (2 trabalha, 1 folga)
- Proteção legal para alguns grupos: 1:1 (trabalha 1 domingo, folga o próximo)
- Exceção total: 0:0 (não configurado, motor decide livremente)

A CCT FecomercioSP garante que nenhum colaborador trabalhe mais de 2 domingos seguidos sem folga dominical.

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
| "A Maria só pode de manhã" (recorrente) | `definir_janela_colaborador` |
| "O João folga toda quarta" (recorrente) | `salvar_regra_horario_colaborador` com `folga_fixa_dia_semana` |
| "Ciclo de domingos do Pedro é 2:1" | `salvar_regra_horario_colaborador` com `domingo_ciclo_*` |
| "Na quinta-feira específica ela entra às 10h" (pontual) | `upsert_regra_excecao_data` com `data` |
| "O Carlos está de férias na semana do dia 10" | `criar` excecao com `tipo: FERIAS` |
