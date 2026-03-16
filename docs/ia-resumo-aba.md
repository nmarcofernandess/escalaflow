# Aba Resumo (Ver tudo) — O que o usuário vê vs o que a IA usa

> **Objetivo:** Fonte de verdade para a IA do sistema saber o que o usuário vê na aba Resumo da escala (tela "Ver tudo") e o que deve permanecer interno. Usar o mesmo vocabulário ao falar com o usuário; usar os dados técnicos para raciocinar.

---

## 1. O que o usuário vê na aba Resumo (Ver tudo)

Na tela **Detalhes da Escala** (`/setores/:id/escala`), a primeira aba é **Resumo**. O usuário vê:

- **Cobertura dos horários:** uma porcentagem (ex.: "Cobertura dos horários: 96%"). Se houver tolerância em horários de café/almoço, uma segunda linha em texto menor: "Considerando tolerância em horários de café e almoço: X%".
- **Problemas que impedem oficializar:** frase única. Ou "Nenhum problema que impeça oficializar." ou "X problema(s) que precisam ser corrigidos antes de oficializar."
- **Avisos:** frase única. Ou "Nenhum aviso." ou "X aviso(s) (preferências ou metas)."
- **Qualidade da escala:** um número com badge colorido (verde/âmbar/vermelho), ex.: "Qualidade da escala: 85".
- **Por colaborador:** tabela com Colaborador, Real (horas), Meta, Delta e Avisos (texto amigável por violação).

Nenhum termo técnico é exibido: nem "cobertura_efetiva", nem "violacoes_hard", nem códigos de regra (R1, R4, etc.).

---

## 2. O que a IA recebe e NÃO deve replicar literalmente ao usuário

A IA tem acesso a estruturas completas da escala (ex.: `EscalaCompletaV3`). Os campos abaixo são **internos** — a IA pode usá-los para raciocinar e sugerir ações, mas ao falar com o usuário deve usar as mesmas frases curtas e amigáveis da aba Resumo (ou equivalente).

| Dado interno | Uso pela IA | Não dizer ao usuário |
|--------------|-------------|----------------------|
| `diagnostico` (status_cp_sat, pass_usado, motivo_infeasible, etc.) | Entender por que a escala falhou ou em qual pass foi gerada | Não expor "INFEASIBLE", "pass 3", etc. |
| `timing` (fase0_ms, total_ms, otimizacao_*) | Análise de performance, debug | Não expor milissegundos ou detalhes de otimização |
| `decisoes` (DecisaoMotor[]) | Entender decisões do motor | Não listar decisões técnicas |
| `comparacao_demanda` (SlotComparacao[]) | Entender gaps de demanda por slot | Não expor tabelas de slot/demanda |
| `antipatterns` | Detectar padrões problemáticos | Não citar antipatterns por nome técnico |
| Códigos de regra (R1, R4, MAX_DIAS_CONSECUTIVOS, etc.) | Validar e sugerir correções | Usar texto amigável (ex.: REGRAS_TEXTO ou as frases do Resumo) |
| `equilibrio` (número bruto) | Cálculos internos | Não exibir número cru; "qualidade" já é a pontuação |

---

## 3. Mapeamento Resumo ↔ técnico

Para a IA explicar o que está na tela ou relacionar pergunta do usuário com dados:

| O que o usuário vê (texto) | Campo(s) técnico(s) |
|----------------------------|----------------------|
| "Cobertura dos horários: X%" | `indicadores.cobertura_percent` |
| "Considerando tolerância em horários de café e almoço: Y%" | `indicadores.cobertura_efetiva_percent` |
| "Nenhum problema que impeça oficializar" / "X problemas que precisam ser corrigidos..." | `indicadores.violacoes_hard` |
| "Nenhum aviso" / "X avisos (preferências ou metas)" | `indicadores.violacoes_soft` |
| "Qualidade da escala: N" (badge) | `indicadores.pontuacao` |
| Tabela "Por colaborador" (Real, Meta, Delta, Avisos) | `alocacoes`, `violacoes` por `colaborador_id`, contratos para meta semanal |

Textos exatos do Resumo estão em \`src/shared/resumo-user.ts\` (usados por \`gerar_escala\`, \`diagnosticar_escala\` e pela UI em \`formatadores.ts\`).

---

## 4. Quando usar este doc

- **Fallback multi-turn:** ao responder sobre "como está minha escala" ou "posso oficializar?", usar o vocabulário da seção 1 e o mapeamento da seção 3. As tools \`gerar_escala\` e \`diagnosticar_escala\` devolvem \`resumo_user\` com as frases prontas — a IA deve usar esse bloco na resposta ao usuário.
- **Ferramentas que retornam escala:** se a tool devolver \`resumo_user\`, use-o na fala; senão (ex.: \`consultar("escalas")\`), resuma com as mesmas frases do Resumo a partir de \`indicadores\`/campos equivalentes.
- **Novas features na aba Resumo:** ao adicionar novo indicador visível, atualizar este doc (seção 1 e 3) e manter a regra: nada técnico na fala com o usuário.
