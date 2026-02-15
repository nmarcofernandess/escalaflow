# Checklist E2E — User Journey (CA5)

> **Objetivo:** Validar fluxo completo do usuário. Executar manualmente no app em execução.

---

## Pré-requisitos

- `npm run dev` rodando (API + Electron)
- Banco com seed (`npm run db:seed` ou primeira execução)

---

## Passos

| # | Ação | Verificação |
|---|------|-------------|
| 1 | Abrir app | Dashboard carrega com resumos dos setores |
| 2 | Navegar Setores > Caixa > Escala | Página de escala abre |
| 3 | Clicar "Gerar Escala" (datas padrão) | Indicadores aparecem: pontuação > 80, cobertura > 90%, 0 HARD |
| 4 | Clicar célula TRABALHO | Toggle para FOLGA, indicadores atualizam em < 1s |
| 5 | Clicar célula FOLGA | Toggle para TRABALHO com horários, indicadores atualizam |
| 6 | Verificar célula alterada | Célula manualmente alterada preservada (não sobrescrita pelo recalc) |
| 7 | Clicar "Oficializar" | Escala oficializada |
| 8 | Aba "Oficial" | Escala oficial aparece |
| 9 | Gerar nova escala | Escala anterior vai para Histórico |
| 10 | Aba "Histórico" | Escala arquivada listada |
| 11 | Sidebar > Tema | Alternar Claro/Escuro/Sistema funciona |
| 12 | Clicar "Imprimir" | Export/impressão funciona |

---

## Status

- [ ] Todos os 12 passos executados
- [ ] 0 falhas
