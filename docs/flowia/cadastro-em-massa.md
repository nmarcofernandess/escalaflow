# Cadastro em Massa via IA (CSV / Planilha)

## TL;DR

Usuario cola CSV ou tabela no chat da IA. A IA parseia, mapeia colunas, mostra plano, e cadastra tudo em 1 turno via `cadastrar_lote`.

## Gatilho

Usuario envia texto contendo dados tabulares (CSV, tabela colada do Excel, lista formatada).

## Fluxo

```
Usuario cola CSV/tabela no chat
        |
        v
[1] get_context()
    - Descobre setores existentes (nomes -> IDs)
    - Descobre tipos de contrato disponiveis
    - Descobre colaboradores ja cadastrados (evita duplicatas)
        |
        v
[2] IA parseia o conteudo
    - Identifica separador (virgula, tab, ponto-e-virgula)
    - Mapeia colunas para campos do sistema:
        Nome/Funcionario  -> nome
        Setor/Depto       -> setor_id (resolve via get_context)
        Contrato/Jornada  -> tipo_contrato_id (44h->CLT 44h, etc)
        Sexo              -> sexo (M/F)
        Funcao/Cargo      -> funcao_id (se existir)
    - Campos nao encontrados -> usa defaults inteligentes
        |
        v
[3] IA mostra plano (se > 10 registros)
    "Encontrei 40 colaboradores em 3 setores.
     Mapeamento: Nome->nome, Setor->setor_id, ...
     Setores novos a criar: Padaria, Frios
     Contrato padrao: CLT 44h (6x1)
     Posso prosseguir?"
        |
        v
[4] Cria dependencias (se necessario)
    - Setores novos -> cadastrar_lote("setores", [...])
    - Funcoes novas -> cadastrar_lote("funcoes", [...])
    - Tipos contrato -> cadastrar_lote("tipos_contrato", [...])
        |
        v
[5] Cadastra registros principais
    cadastrar_lote("colaboradores", [
      { nome: "Joao", setor_id: 3, tipo_contrato_id: 1, sexo: "M" },
      { nome: "Maria", setor_id: 3, tipo_contrato_id: 1, sexo: "F" },
      ...
    ])
        |
        v
[6] Feedback
    "Pronto! 38/40 cadastrados.
     2 erros: linha 12 (setor invalido), linha 35 (nome duplicado)"
```

## Tool: cadastrar_lote

**Arquivo:** `src/main/ia/tools.ts`

**Input:**
```json
{
  "entidade": "colaboradores",
  "registros": [
    { "nome": "Joao Silva", "setor_id": 3, "sexo": "M" },
    { "nome": "Maria Santos", "setor_id": 3, "sexo": "F", "tipo_contrato_id": 2 }
  ]
}
```

**Output:**
```json
{
  "sucesso": true,
  "total_enviado": 40,
  "total_criado": 38,
  "total_erros": 2,
  "ids_criados": [101, 102, 103, ...],
  "erros": [
    { "indice": 11, "sucesso": false, "erro": "setor_id 999 nao encontrado" },
    { "indice": 34, "sucesso": false, "erro": "UNIQUE constraint failed" }
  ]
}
```

**Limites:**
- Max 200 registros por chamada
- Entidades permitidas: colaboradores, excecoes, demandas, tipos_contrato, setores, feriados, funcoes

**Defaults automaticos (colaboradores):**
| Campo | Default |
|-------|---------|
| sexo | M |
| tipo_contrato_id | 1 (CLT 44h) |
| tipo_trabalhador | regular |
| data_nascimento | aleatorio 25-40 anos |
| hora_inicio_min | hora_abertura do setor |
| hora_fim_max | hora_fechamento do setor |
| horas_semanais | do tipo_contrato |
| ativo | 1 |

## System Prompt

A IA sabe fazer esse fluxo via secao "cadastrar_lote (IMPORTACAO EM MASSA)" no `src/main/ia/system-prompt.ts`.

Regras ensinadas:
- SEMPRE get_context() antes pra mapear nomes -> IDs
- Se CSV menciona setores inexistentes -> perguntar se cria
- Se faltam colunas -> usar defaults e avisar
- Mostrar plano antes de executar quando > 10 registros

## Exemplo Real

```
Usuario: "Cadastra esses funcionarios:
Nome,Setor,Sexo
Joao Silva,Caixa,M
Maria Santos,Caixa,F
Pedro Oliveira,Acougue,M
Ana Costa,Padaria,F"

IA: [get_context()] -> Caixa=id:3, Acougue=id:5, Padaria=NAO EXISTE

IA: "Encontrei 4 pessoas em 3 setores. Caixa e Acougue existem,
     mas 'Padaria' nao existe. Quer que eu crie o setor Padaria?"

Usuario: "Sim"

IA: [criar("setores", {nome: "Padaria", hora_abertura: "08:00", hora_fechamento: "22:00"})]
    -> Padaria criado, id=7

IA: [cadastrar_lote("colaboradores", [
      {nome: "Joao Silva", setor_id: 3, sexo: "M"},
      {nome: "Maria Santos", setor_id: 3, sexo: "F"},
      {nome: "Pedro Oliveira", setor_id: 5, sexo: "M"},
      {nome: "Ana Costa", setor_id: 7, sexo: "F"}
    ])]

IA: "Pronto! 4 colaboradores cadastrados:
     - Caixa: Joao Silva, Maria Santos
     - Acougue: Pedro Oliveira
     - Padaria: Ana Costa (setor criado agora)
     Todos com contrato CLT 44h (6x1) como padrao."
```
