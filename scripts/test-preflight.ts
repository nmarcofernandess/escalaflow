import { execSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

// Force DB path
process.env.ESCALAFLOW_DB_PATH = process.env.ESCALAFLOW_DB_PATH || path.join(rootDir, 'data', 'escalaflow.db')

import { buildSolverInput } from '../src/main/motor/solver-bridge'
// Mocking the enrich method 

function minutesBetween(h1: string, h2: string): number {
  const [aH, aM] = h1.split(':').map(Number)
  const [bH, bM] = h2.split(':').map(Number)
  return Math.max(0, (bH * 60 + bM) - (aH * 60 + aM))
}

const input = buildSolverInput(1, '2026-03-01', '2026-03-31')
const blockers: any[] = []

for (const c of input.colaboradores) {
  if (c.tipo_trabalhador === 'ESTAGIARIO') continue;

  const horasSemanaisMinutos = c.horas_semanais * 60;
  const toleranciaMinutos = input.empresa.tolerancia_semanal_min;
  const limiteInferiorSemanal = Math.max(0, horasSemanaisMinutos - toleranciaMinutos);

  let maxJanelaDoColaborador = c.max_minutos_dia;

  const regras = input.regras_colaborador_dia?.filter(r => r.colaborador_id === c.id) || [];

  if (regras.length > 0) {
    const regraTipica = regras.find(r => r.inicio_min || r.fim_max);

    if (regraTipica) {
      let janelaMinutos = c.max_minutos_dia;

      let startToUse = regraTipica.inicio_min || input.empresa.hora_abertura;
      let endToUse = regraTipica.fim_max || input.empresa.hora_fechamento;

      const possibleMinutes = minutesBetween(startToUse, endToUse);
      if (possibleMinutes > 0 && possibleMinutes < janelaMinutos) {
        janelaMinutos = possibleMinutes;
      }

      maxJanelaDoColaborador = Math.min(janelaMinutos, c.max_minutos_dia);
    }
  }

  let capacidadeDiaria = maxJanelaDoColaborador;
  const metaDiariaMedia = horasSemanaisMinutos / c.dias_trabalho;

  if (metaDiariaMedia > 360) {
    capacidadeDiaria -= input.empresa.min_intervalo_almoco_min;
  }

  const capacidadeMaxSemanal = capacidadeDiaria * c.dias_trabalho;

  console.log(`Colab: ${c.nome} | Janela: ${maxJanelaDoColaborador}m | CapacidadeDiaria: ${capacidadeDiaria}m | CapSemanal: ${capacidadeMaxSemanal}m | ContratoMinimoLimit: ${limiteInferiorSemanal}m`)

  if (capacidadeMaxSemanal < limiteInferiorSemanal) {
    blockers.push({
      nome: c.nome,
      codigo: 'CAPACIDADE_INDIVIDUAL_INSUFICIENTE',
      severidade: 'BLOCKER',
      mensagem: `A janela de disponibilidade de ${c.nome} torna a carga horaria incompativel.`,
    });
  }
}

console.log('BLOCKERS:', blockers)
