# Resultado do Teste Cego -- Motor v3 vs OR-Tools

**Data:** 2026-02-20 00:02
**Periodo:** 2026-02-09 a 2026-02-14
**Setor:** CAIXA
**Input do solver:** `data/escalaflow.db`
**Referencia Rita:** `data/comparacao/caixa_rita_referencia.json` (escalas_trabalho-GPT.xlsx (ESCALA 8) + DOM E FOLGAS - CAIXA.xlsx)

## Resumo Executivo

| Metrica | Motor TS | OR-Tools | Rita (GT) |
|---------|----------|----------|-----------|
| Cobertura demanda % | 68.3% | 100.0% | 100.0% |
| Cobertura media % | 84.6% | 100.0% | 100.0% |
| Violacoes hard | 0 | 0 | 0 |
| Desvio semanal medio | 425.0min | 30.0min | 175.0min |
| Similaridade com GT % | 25.4% | 43.7% | 100.0% |
| Tempo de resolucao | 75ms | 120028ms | manual |

## Horas Semanais por Colaborador

| Colaborador | Contrato | Motor TS | OR-Tools | Rita (GT) |
|-------------|----------|----------|----------|-----------|
| Ana Julia | 2640min | 2550min | 2610min | 2640min |
| Cleonice | 2640min | 3000min | 2610min | 2640min |
| Gabriel | 2160min | 2280min | 2130min | 1890min |
| Heloisa | 1800min | 1890min | 1770min | 1530min |
| Mayumi | 1800min | 1890min | 1770min | 1530min |
| Yasmin | 1800min | 0min | 1770min | 1560min |

## Similaridade por Dia (Jaccard %)

| Dia | Motor TS | OR-Tools |
|-----|----------|----------|
| SEG | 28.3% | 35.0% |
| TER | 18.6% | 23.0% |
| QUA | 29.9% | 42.4% |
| QUI | 31.7% | 51.5% |
| SEX | 27.4% | 52.9% |
| SAB | 16.3% | 57.6% |

---
*Gerado automaticamente por `comparar.py` em 2026-02-20 00:02:06*