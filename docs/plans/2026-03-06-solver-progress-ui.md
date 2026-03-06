# Solver Progress UI — Logs Live + Cancelar

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Substituir o modal burro de "Gerando escala..." por um terminal de logs em tempo real com botão Cancelar.

**Architecture:** Python emite logs PT-BR no stderr → bridge streama via `onLog` callback → tipc envia via IPC `solver-log` → renderer escuta e renderiza em ScrollArea com auto-scroll. Cancelar: bridge expõe `cancelSolver()` que mata o child process, tipc expõe handler `escalas.cancelar`.

**Tech Stack:** Python stderr, Node child_process, Electron IPC, React useState/useEffect, shadcn ScrollArea

---

### Task 1: Python — Logs PT-BR

**Files:**
- Modify: `solver/solver_ortools.py`

Substituir ~15 chamadas `log()` por mensagens em PT-BR legíveis para humanos.

---

### Task 2: Bridge — cancelSolver()

**Files:**
- Modify: `src/main/motor/solver-bridge.ts`

Adicionar module-level ref `activeSolverChild` + export `cancelSolver()`.

---

### Task 3: tipc — handler escalas.cancelar

**Files:**
- Modify: `src/main/tipc.ts`

Adicionar handler `escalas.cancelar` que chama `cancelSolver()`. Adicionar no router.

---

### Task 4: Serviço renderer — cancelar + listener

**Files:**
- Modify: `src/renderer/src/servicos/escalas.ts`

Adicionar `cancelar()` e helper `onSolverLog(cb)` / `offSolverLog()`.

---

### Task 5: UI — SolverProgressOverlay

**Files:**
- Modify: `src/renderer/src/paginas/SetorDetalhe.tsx`

Substituir modal de loading por overlay com ScrollArea de logs, timer, status, botão Cancelar.

---
