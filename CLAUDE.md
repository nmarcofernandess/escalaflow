# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Quick Start

### Development Commands

```bash
# Start API + Web simultaneously (runs on different ports)
npm run dev

# Start API only (localhost:3000)
npm run dev:api

# Start Web only (localhost:5173 — Vite dev server)
npm run dev:web

# Build all packages
npm run build

# Seed database with initial data
npm run db:seed

# TypeScript check (all packages)
npx tsc --noEmit

# Build Web with Vite for production
npm run build --workspace=apps/web
```

### Database Commands

```bash
# Reset SQLite database and run seed
npm run db:seed

# Database file location: apps/api/data/escalaflow.db (SQLite)
```

### Individual Workspace Commands

```bash
# Work within a specific workspace
npm run dev -w packages/shared
npm run build -w apps/api
npm test -w apps/web  # (not yet implemented, but can be added)
```

---

## Architecture Overview

### Monorepo Structure

```
escalaflow/
├── apps/
│   ├── api/              # Backend: Hono + better-sqlite3
│   │   ├── src/
│   │   │   ├── db/       # Schema, seed, migrations
│   │   │   ├── motor/    # Core scheduling engine (gerador.ts, validador.ts)
│   │   │   ├── routes/   # HTTP endpoints (RESTful API)
│   │   │   └── index.ts  # Server entry point
│   │   └── package.json
│   └── web/              # Frontend: React + Vite + Tailwind
│       ├── src/
│       │   ├── componentes/  # Reusable UI components (shadcn/ui)
│       │   ├── paginas/      # Page components (SetorLista, EscalaPagina, etc.)
│       │   ├── servicos/     # API client services
│       │   ├── estado/       # Zustand global state management
│       │   ├── hooks/        # Custom React hooks
│       │   ├── lib/          # Utilities (cn, constants, etc.)
│       │   └── App.tsx       # Router setup
│       └── package.json
└── packages/
    └── shared/           # Shared TypeScript interfaces & constants
        ├── src/
        │   ├── types.ts      # Interfaces (Setor, Colaborador, Escala, etc.)
        │   └── constants.ts  # Business logic constants (contract templates, rules)
        └── package.json
```

### Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **API** | Hono (TypeScript) | Lightweight HTTP framework, edge-ready |
| **Database** | SQLite (better-sqlite3) | Local file-based, no server needed |
| **Frontend** | React 19 + Vite | Fast dev server, optimized build |
| **Styling** | Tailwind CSS + shadcn/ui | Utility-first CSS + accessible components |
| **State** | Zustand | Lightweight global state (Redux alternative) |
| **Routing** | React Router v7 | Client-side navigation |
| **Drag & Drop** | @dnd-kit | Reordering escalas (collaborators) |
| **Validation** | Zod | Type-safe runtime validation |
| **Shared** | TypeScript workspace | Single source of truth for types |

---

## Domain Model & Naming Conventions

### Critical Rule: Single Source of Truth for Field Names

**Database column = JSON key = TypeScript interface field**

```
corte_semanal  (DB) = corte_semanal (JSON) = corte_semanal (TS)
```

**NO camelCase ↔ snake_case conversion. NO adapters. NO mappers.**

What leaves the database is EXACTLY what arrives in the React component.

### Nomenclature by Layer

| Entity | DB Table | TS Interface | API Route | Notes |
|--------|----------|--------------|-----------|-------|
| Department | `setores` | `Setor` | `/api/setores` | Multiple departments per supermarket |
| Employee | `colaboradores` | `Colaborador` | `/api/colaboradores` | Assigned to one setor |
| Contract Type | `tipos_contrato` | `TipoContrato` | `/api/tipos-contrato` | Templates: CLT 44h, CLT 36h, Estagiario 20h |
| Demand (coverage) | `demandas` | `Demanda` | `/api/demandas` | Min people per time slot per day |
| Exception | `excecoes` | `Excecao` | `/api/excecoes` | Vacation, sick leave, blocking |
| Schedule | `escalas` | `Escala` | `/api/escalas` | Generated or official |
| Allocation | `alocacoes` | `Alocacao` | *via POST escalas* | One person-day assignment |
| Company Config | `empresa` | `Empresa` | `/api/empresa` | Singleton: tolerance, cut day |

### Field Naming Convention

- **Database/JSON:** `snake_case` (hora_inicio, setor_id, trabalha_domingo)
- **TypeScript variable:** `camelCase` (setorAtivo, escalaAtual)
- **React component:** `PascalCase` (SetorCard.tsx, EscalaGrid.tsx)
- **React hook:** `use + PascalCase` (useSetor, useEscala)
- **URL path:** `kebab-case` (/setores, /tipos-contrato)

---

## Core Business Logic: The Motor

### What the Motor Does

The **"motor"** (scheduling engine) lives in `apps/api/src/motor/`:

- **gerador.ts**: Generates an optimal schedule automatically
  - Respects CLT labor law constraints (R1-R8 validation rules)
  - Maximizes coverage per time slot
  - Balances workload across employees
  - Scores quality (0-100 where 100 = perfect)
  - Calculates indicators: cobertura_percent, violacoes_hard, violacoes_soft, equilibrio

- **validador.ts**: Re-validates schedule after manual adjustments
  - Recomputes violations (hard = law-breaking, soft = preference)
  - Updates score and indicators
  - Used by POST /ajustar and PUT /oficializar endpoints

### Constraints (R1-R8)

1. **R1:** No more than 7 consecutive work days
2. **R2:** Max hours per day (contract template `max_minutos_dia`)
3. **R3:** Min/max hours per week (contract template `horas_semanais`)
4. **R4:** Coverage minimum per time slot (`Demanda.min_pessoas`)
5. **R5:** Respect exceptions (vacation, sick leave)
6. **R6:** Gender balance for Sundays (soft: prefer equal M/F)
7. **R7:** Respect soft preferences (turno, evitar_dia_semana)
8. **R8:** Single setor assignment (employee works in one department)

### Schedule Lifecycle

```
RASCUNHO (Draft)
  ├─ System proposes via motor
  ├─ User adjusts (drag, swap) → motor recalculates
  └─ Repeat until happy
       ↓
    OFICIAL (Official)
       ├─ Locked for this setor/period
       ├─ Can export/print
       └─ Previous OFICIAL → ARQUIVADA
```

---

## API Design

### Endpoint Patterns

All endpoints are RESTful and return `snake_case` JSON:

```typescript
// GET list
GET /api/setores → Setor[]

// GET single
GET /api/setores/:id → Setor

// POST create
POST /api/setores → { nome: string; ... } → Setor

// PUT update
PUT /api/setores/:id → { nome?: string; ... } → Setor

// DELETE
DELETE /api/setores/:id → 204 No Content

// Special: Generate schedule
POST /api/escalas/gerar → { setor_id, data_inicio, data_fim } → EscalaCompleta

// Special: Adjust schedule (revalidate)
POST /api/escalas/:id/ajustar → { alocacoes: [...] } → EscalaCompleta

// Special: Finalize schedule (check hard violations)
PUT /api/escalas/:id/oficializar → 200 OK or 409 Conflict
```

### Response Structure

All responses include the entity + metadata:

```typescript
// Success (200/201)
{
  id: number;
  setor_id: number;
  nome: string;
  // ... all snake_case fields
  criada_em: string; // ISO timestamp
}

// Validation error (400)
{
  error: string;
  details?: Record<string, string[]>;
}

// Hard violation error (409 — used in PUT /oficializar)
{
  error: "Escala tem 2 violacoes criticas";
  violations: { violacoes_hard: 2; ... }
}
```

---

## Frontend Architecture

### Page Structure

Each page in `apps/web/src/paginas/` follows this pattern:

```typescript
export default function PageName() {
  // 1. Fetch data via service
  const [data, loading, error] = useData();

  // 2. Local state for UI (Zustand store)
  const { activeId, setActive } = useStore();

  // 3. Render components
  return (
    <PageHeader title="Titulo" />
    <Content>
      {data.map(item => <ItemCard key={item.id} {...item} />)}
    </Content>
  );
}
```

### Component Organization

- **componentes/**: Reusable UI building blocks (Button, Card, Dialog, etc.)
  - Most use shadcn/ui + Tailwind
  - Accept `props` (no API calls inside)
  - Example: `Badge.tsx`, `StatusBadge.tsx`, `PontuacaoBadge.tsx`

- **estado/**: Global state stores (Zustand)
  - `useSetorStore()` - active setor + filter
  - `useEscalaStore()` - draft vs official, indicators
  - Small, focused stores (one per domain entity)

- **servicos/**: API client functions
  - `servicoSetor.ts` - GET/POST/PUT /api/setores
  - `servicoEscala.ts` - POST gerar, POST ajustar, PUT oficializar
  - Uses `fetch()` with snake_case keys (zero transformation)

- **hooks/**: Custom React hooks
  - `useSetor(id)` - fetch single setor
  - `useEscala(id)` - fetch escala + alocacoes + indicadores
  - Handles loading/error states

### State Management

Zustand stores are in `apps/web/src/estado/`:

```typescript
// Example: useSetorStore.ts
import { create } from 'zustand';

interface SetorState {
  setores: Setor[];
  activeSetorId: number | null;
  setActive: (id: number) => void;
  fetchSetores: () => Promise<void>;
}

export const useSetorStore = create<SetorState>((set) => ({
  setores: [],
  activeSetorId: null,
  setActive: (id) => set({ activeSetorId: id }),
  fetchSetores: async () => {
    const data = await servicoSetor.listar();
    set({ setores: data });
  },
}));
```

---

## Database & Schema

### SQLite Structure

- **Location:** `apps/api/data/escalaflow.db` (created on first run)
- **Schema definition:** `apps/api/src/db/schema.ts`
- **Initial data:** `apps/api/src/db/seed.ts`

### Key Patterns

- **Soft delete:** `ativo BOOLEAN DEFAULT 1` (don't actually delete, just mark inactive)
- **Timestamps:** `criada_em DATETIME DEFAULT CURRENT_TIMESTAMP`
- **Foreign keys:** Always named `{entity}_id` (setor_id, colaborador_id)
- **Defaults:** Provide sensible defaults (empresa.tolerancia_semanal_min = 30)

### Schema Example (Setor)

```sql
CREATE TABLE IF NOT EXISTS setores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  hora_abertura TEXT NOT NULL,
  hora_fechamento TEXT NOT NULL,
  ativo BOOLEAN DEFAULT 1,
  criada_em DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## Shared Package (`@escalaflow/shared`)

This workspace contains **the single source of truth** for all types and constants.

### types.ts

Export all TypeScript interfaces that both API and frontend use:

```typescript
export interface Setor {
  id: number;
  nome: string;
  hora_abertura: string;
  hora_fechamento: string;
  ativo: boolean;
}

export interface Escalas {
  escala: Escala;
  alocacoes: Alocacao[];
  indicadores: Indicadores;
  violacoes: Violacao[];
}
```

### constants.ts

Export business constants:

```typescript
export const TIPOS_CONTRATO_SEED = [
  {
    nome: "CLT 44h",
    horas_semanais: 44,
    dias_trabalho: 6,
    max_minutos_dia: 570,
    trabalha_domingo: true,
  },
  // ...
];

export const REGRAS_CLT = {
  MAX_DIAS_CONSECUTIVOS: 7,
  MAX_HORAS_POR_SEMANA: 44,
  // ...
};
```

**Important:** When updating types/constants, rebuild with:
```bash
npm run build -w packages/shared
```

---

## Debugging & Development Tips

### 1. Check TypeScript Before Running

```bash
npx tsc --noEmit
```

This catches type errors across all workspaces before runtime.

### 2. Database Issues

- Delete `apps/api/data/escalaflow.db` to reset
- Run `npm run db:seed` to recreate
- SQLite file is local, no server needed

### 3. Frontend Not Picking Up Changes

- API might be caching. Restart `npm run dev:api`
- Check browser DevTools → Network → Preview tab for actual response
- Clear localStorage if state is stale

### 4. "Module not found" Errors

- Shared package changed? Run `npm run build -w packages/shared`
- Then restart dev servers

### 5. Visual Debugging

- Use React DevTools (browser extension) to inspect component state
- Check Zustand store with `useStore.getState()` in console
- Network tab shows all API calls and responses

---

## Key Files & Where They Matter

| File | Purpose | When to Edit |
|------|---------|-------------|
| `apps/api/src/db/schema.ts` | Database structure | Adding new tables or columns |
| `apps/api/src/motor/gerador.ts` | Schedule generation logic | Changing validation rules or scoring |
| `apps/api/src/routes/escalas.ts` | Schedule endpoints | New API endpoints or validation |
| `apps/shared/src/types.ts` | Type definitions | New entity, new field, or interface change |
| `apps/web/src/App.tsx` | Router configuration | Adding new pages/routes |
| `apps/web/src/paginas/SetorLista.tsx` | Example list page | Reference implementation |
| `apps/web/tailwind.config.js` | Tailwind config | Custom colors, spacing, plugins |

---

## Workflow for Adding a Feature

### 1. Add New Entity (e.g., "Bloqueio")

- Define in `packages/shared/src/types.ts`
- Add schema in `apps/api/src/db/schema.ts`
- Add seed data in `apps/api/src/db/seed.ts`
- Export from `apps/api/src/db/index.ts` if needed
- Build shared: `npm run build -w packages/shared`

### 2. Add API Endpoint

- Create route handler in `apps/api/src/routes/bloqueios.ts`
- Register route in `apps/api/src/index.ts`
- Use Zod for request validation
- Return typed response (uses TS types automatically)

### 3. Add Frontend Page

- Create component in `apps/web/src/paginas/BloqueioLista.tsx`
- Create service in `apps/web/src/servicos/servicoBloqueio.ts`
- Add route in `apps/web/src/App.tsx`
- Use Zustand store for state if needed

### 4. Test End-to-End

```bash
npm run dev        # Both servers
npm run db:seed    # Reset data
# Navigate in browser, check Network tab for API calls
```

---

## Production Checklist

Before committing:

- [ ] `npx tsc --noEmit` returns 0 errors
- [ ] `npm run build` completes without errors
- [ ] All snake_case in DB/JSON/TS (no camelCase mixing)
- [ ] Shared package rebuilt: `npm run build -w packages/shared`
- [ ] Database migrations applied (or seed updated)
- [ ] API endpoints follow RESTful pattern
- [ ] Frontend components accept `props` (no hardcoded data)
- [ ] Zustand stores properly typed
- [ ] Error handling for network failures

---

## Useful Links

- **BUILD_V2_ESCALAFLOW.md** - Complete architecture specification (business rules, schema, motor logic)
- **ANALYST_PROCESSO_USUARIO_MULTITENANCY.md** - User workflows and business process
- **specs/** - Task tracking and audit logs (task 001, 002, etc.)

