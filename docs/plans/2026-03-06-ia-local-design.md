# IA Local — Design Doc

**Data:** 2026-03-06
**Status:** Em design

---

## TL;DR

Adicionar IA offline ao EscalaFlow via `node-llama-cpp` (binding nativo) + download pós-instalação de modelo Qwen 3.5 9B GGUF. O usuário clica "Baixar", espera, e tem IA local funcionando — sem Ollama, sem API key, sem internet depois do download.

---

## Decisões Tomadas

| Decisão | Escolha | Alternativas descartadas | Motivo |
|---------|---------|--------------------------|--------|
| Runtime | `node-llama-cpp` (in-process) | llama-server (spawn), Ollama (externo) | Zero overhead de rede, 1 processo só, sem gestão de server, GPU auto-detect (Metal/Vulkan) |
| Modelo | Qwen 3.5 9B Q4_K_M (~5.5GB) | 0.8B, 2B, 4B, 27B, MoE 35B | Sweet spot: tool calling decente (66.1 BFCL-V4), roda em CPU, portugues ok |
| Download | Direto do HuggingFace | Catalogo multi-modelo, auto-detect | Um modelo curado, zero decisao pro RH. "Quer IA offline? Clica aqui." |
| Integração | Novo provider `local` no Vercel AI SDK | Provider custom, bypass SDK | SDK já abstrai providers; `node-llama-cpp` tem adapter compativel |

### Por que in-process e não spawn (como o solver Python)?

O solver Python usa OR-Tools — lib C++ do Google com bindings **só** pra Python/Java/C#. Não existe `node-ortools`. PyInstaller bundling Python inteiro era a única opção.

`llama.cpp` foi projetado pra ser embeddable. `node-llama-cpp` é binding nativo de primeira classe. Podemos rodar in-process no Electron main, eliminando spawn, portas, e toda a complexidade de gestão de processo.

---

## Arquitetura

```
ConfiguracoesPagina.tsx
  └─ Card "IA Local"
      ├─ Status: Não instalado / Baixando (43%) / Pronto / Rodando
      ├─ Botão: "Baixar Modelo (5.5 GB)"
      ├─ Info hardware: RAM disponivel, GPU detectada
      └─ PS: "Recomendado: 8GB RAM livres, Apple Silicon ou GPU dedicada"

Electron Main Process
  └─ src/main/ia/
      ├─ config.ts          ← +provider 'local', resolveModel pra local
      ├─ llama-engine.ts    ← NOVO: lifecycle do modelo (load/unload/status)
      ├─ llama-provider.ts  ← NOVO: adapter Vercel AI SDK (ou direto node-llama-cpp)
      ├─ model-download.ts  ← NOVO: download GGUF com progresso + resume
      └─ cliente.ts         ← sem mudança estrutural, buildModelFactory retorna local model
```

### Fluxo de Download

```
User clica "Baixar" em Configuracoes
  → IPC: ia.local.download.start
  → model-download.ts: fetch HuggingFace URL com streaming
  → Salva em: data/models/qwen3.5-9b-q4_k_m.gguf
  → Progresso via IPC: ia.local.download.progress (%, bytes, velocidade)
  → Pause/Resume: ia.local.download.pause / ia.local.download.resume
  → Completo: ia.local.download.done
  → Verifica integridade (sha256 do HuggingFace)
```

### Fluxo de Inferência

```
User manda mensagem no chat com provider = 'local'
  → cliente.ts → buildModelFactory(config) → provider === 'local'
  → llama-engine.ts: modelo já carregado? Se não, loadModel()
  → llama-provider.ts: generateText/streamText via node-llama-cpp
  → Mesmas 34 tools, mesmo system prompt, mesmo discovery
  → Response volta pelo mesmo pipeline
```

### Lifecycle do Modelo

```
App inicia → modelo NÃO carregado (economia de RAM)
  → User abre chat com provider 'local'
    → llama-engine.ts: loadModel() (~10-30s dependendo do hardware)
    → Status: "Carregando modelo..." (spinner no chat)
    → Modelo fica em RAM enquanto chat ativo
  → User fecha chat ou troca provider
    → Timeout 5min → unloadModel() (libera RAM)
  → User pode forçar unload em Configuracoes
```

---

## Mudanças por Camada

### 1. Dependencies

```
npm install node-llama-cpp
```

Build nativo via CMake no `postinstall` / `electron-rebuild`. CI precisa de CMake + toolchain C++ (já tem pra PyInstaller).

### 2. Schema / Types

```typescript
// types.ts
export interface IaConfiguracao {
  provider: 'gemini' | 'openrouter' | 'local'  // +local
  // ... resto igual
}

// Novo tipo
export interface IaLocalStatus {
  modelo_baixado: boolean
  modelo_carregado: boolean
  download_progresso?: number        // 0-100
  download_bytes_total?: number
  download_bytes_feitos?: number
  ram_modelo_mb?: number
  gpu_detectada?: string             // 'metal' | 'vulkan' | 'cpu-only'
  tokens_por_segundo?: number        // medido no último request
}
```

### 3. IPC Handlers (tipc.ts)

| Handler | Direção | O que faz |
|---------|---------|-----------|
| `ia.local.status` | renderer → main | Retorna IaLocalStatus |
| `ia.local.download.start` | renderer → main | Inicia download GGUF |
| `ia.local.download.pause` | renderer → main | Pausa download |
| `ia.local.download.resume` | renderer → main | Retoma download |
| `ia.local.download.cancel` | renderer → main | Cancela e deleta parcial |
| `ia.local.download.progress` | main → renderer | Evento: progresso (%) |
| `ia.local.unload` | renderer → main | Força descarregar modelo da RAM |

### 4. Arquivos Novos (main)

| Arquivo | Responsabilidade |
|---------|------------------|
| `src/main/ia/llama-engine.ts` | Load/unload modelo, status, GPU detection, lifecycle |
| `src/main/ia/llama-provider.ts` | Adapter pro Vercel AI SDK (ou wrapper direto) |
| `src/main/ia/model-download.ts` | Download HTTP streaming, sha256, pause/resume, progresso |

### 5. config.ts

```typescript
// Adicionar ao PROVIDER_DEFAULTS
local: 'qwen3.5-9b-q4_k_m'

// buildModelFactory: novo branch
if (provider === 'local') {
  return buildLocalModel(config)  // llama-engine.ts
}
```

### 6. Frontend (ConfiguracoesPagina.tsx)

Novo card "IA Local" com:
- Status badge (Nao instalado / Baixando / Pronto / Ativo)
- Botao download com barra de progresso
- Info: tamanho do modelo, RAM usada, GPU detectada, tok/s
- Botao "Descarregar" (libera RAM)
- PS hardware: "Recomendado: 8GB RAM livres. Melhor performance com Apple Silicon ou GPU dedicada."

### 7. Onboarding / Tour

Atualizar as instrucoes de inicio (tour/welcome) para:
- Refletir o estado atual do sistema (setores, demandas, escalas, IA)
- Adicionar passo sobre IA Local como opcao
- "Sem API key? Baixe a IA offline em Configuracoes > IA Local"

---

## Hardware — O Que Dizer pro Usuário

| Hardware | Experiencia |
|----------|-------------|
| Apple Silicon (M1+) 8GB+ | Excelente — Metal GPU, ~15-25 tok/s |
| Intel/AMD + 16GB RAM | Boa — CPU only, ~8-12 tok/s |
| Intel/AMD + 8GB RAM | Funcional — ~5-8 tok/s, pode ficar lento com outras apps |
| < 8GB RAM | Nao recomendado — modelo nao vai caber |

Mostrar isso como PS discreto no card, nao como gate. Deixa o cara tentar.

---

## Riscos

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Tool calling do 9B erra mais que Gemini | Medio | Eval comparativo antes de lançar; fallback pra API se frustrar |
| Build nativo falha em algum OS | Alto | CI testa Mac + Win; prebuild binaries como fallback |
| Modelo não cabe na RAM do PC do RH | Medio | Checar RAM antes do download; aviso claro |
| Download de 5.5GB demora/falha | Baixo | Pause/resume; verificação sha256; retry automático |
| node-llama-cpp breaking change | Baixo | Pinnar versão; atualizar no nosso ritmo |

---

## Fora de Escopo (v1)

- Catalogo de modelos (só 1 curado)
- Fine-tuning local
- Múltiplos modelos simultâneos
- Quantização customizada
- LoRA adapters

---

## Próximos Passos

1. Spike técnico: instalar `node-llama-cpp`, carregar um GGUF, chamar com tool calling
2. Eval: rodar os mesmos evals de IA (34 tools) com Qwen 3.5 9B local vs Gemini
3. Se eval OK → implementar download + lifecycle + UI
4. Atualizar onboarding/tour pro estado atual + IA local
