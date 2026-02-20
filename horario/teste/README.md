# Teste Cego: Motor v3 (TS) vs OR-Tools (Python)

Benchmark de dois solvers independentes contra o ground truth manual da Rita.

## Estrutura

```
horario/teste/
  fixture/
    caixa_rita.json          # Legado (fixture unico, mantido por compat)
  extrator/
    extrair_pdf.py           # Validador do fixture
  solver_python/
    constraints.py           # Constraints CLT para CP-SAT
    solver_ortools.py        # Solver OR-Tools
    resultado_python.json    # Output
  adapter_ts/
    adapter.ts               # Adapter que roda o motor v3
    resultado_ts.json        # Output
  comparador/
    comparar.py              # Comparador cego
    relatorio.md             # Relatorio gerado
  requirements.txt

data/comparacao/
  caixa_rita_referencia.json # Arquivo unico de referencia da Rita (escala + demanda por horario)
```

## Pre-requisitos

```bash
# Opcao recomendada: usar venv local isolado (script abaixo faz tudo)
python3 --version
```

## Rodar

```bash
cd horario/teste

# 0. (Opcional) Regerar o JSON de referencia da Rita
cd ../..
python scripts/build_caixa_comparison_data.py
cd horario/teste

# 1. Rodar solver Python (OR-Tools CP-SAT) com input direto do DB do sistema
./run_python.sh solver

# 2. Rodar motor TS (do root do escalaflow)
cd ../..
npx tsx horario/teste/adapter_ts/adapter.ts
cd horario/teste

# 3. Comparar resultados (usa DB do sistema + referencia Rita)
./run_python.sh compare
# ou tudo em sequencia:
./run_python.sh both
# -> Gera comparador/relatorio.md
```

## Ground Truth / Input

- Input do solver: `data/escalaflow.db` (lido diretamente pelo Python/TS).
- Referencia: `data/comparacao/caixa_rita_referencia.json`
  (escala real da Rita + curva de pessoas por horario derivada da escala dela).

| Nome | Contrato | Horas/sem |
|------|----------|-----------|
| CLEONICE | CLT | conforme input sistema |
| GABRIEL | CLT | conforme input sistema |
| ANA JULIA | CLT 44h | 44h |
| YASMIN | CLT | conforme input sistema |
| MAYUMI | CLT 30h | 30h |
| HELOISA | CLT 30h | 30h |

## Criterios de Sucesso

- Ambos solvers com 0 violacoes hard
- Cobertura >= 80% em ambos
- Horas semanais dentro da tolerancia (+-30min)
- Similaridade com GT > 30% (multiplas solucoes validas)
