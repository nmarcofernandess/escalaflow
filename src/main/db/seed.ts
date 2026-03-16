import { queryOne, queryAll, execute, transaction } from './query'

// ============================================================================
// Paleta fixa de cores (15 cores — PRD v4)
// ============================================================================

const PALETA_CORES = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6',
  '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16',
  '#06B6D4', '#D946EF', '#78716C', '#0EA5E9', '#A3E635',
]

// ============================================================================
// SEED — Dados de SISTEMA (versionado no git)
// ============================================================================

export async function seedCoreData(): Promise<void> {
  // -- 1. Tipos de Contrato --
  // Checa por CLT 44h (não usa COUNT(*) pois migration v17 pode já ter criado Intermitente)
  const clt44 = await queryOne<{ id: number }>(`SELECT id FROM tipos_contrato WHERE nome = 'CLT 44h'`)
  if (!clt44) {
    const tipos: [string, number, string, number, number, boolean][] = [
      ['CLT 44h', 44, '5X2', 5, 585, true],
      ['CLT 36h', 36, '5X2', 5, 585, true],
      ['Estagiario', 20, '5X2', 5, 360, true],
      ['Intermitente', 0, '6X1', 6, 585, true],
    ]

    await transaction(async () => {
      for (const tipo of tipos) {
        const existe = await queryOne<{ id: number }>('SELECT id FROM tipos_contrato WHERE nome = $1', tipo[0])
        if (existe) continue
        await execute(
          'INSERT INTO tipos_contrato (nome, horas_semanais, regime_escala, dias_trabalho, max_minutos_dia, protegido_sistema) VALUES ($1, $2, $3, $4, $5, $6)',
          ...tipo,
        )
      }
    })
    console.log('[SEED] 4 tipos de contrato criados (CLT 44h, CLT 36h, Estagiario, Intermitente)')
  }

  // -- 2. Perfis de Horario por Contrato --
  const perfisExistem = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM contrato_perfis_horario')
  if ((perfisExistem?.count ?? 0) === 0) {
    const tiposRows = await queryAll<{ id: number; nome: string }>('SELECT id, nome FROM tipos_contrato')
    const tipoByNome = new Map(tiposRows.map((t) => [t.nome, t.id]))

    const perfis = [
      {
        contrato: 'Estagiario', nome: 'MANHA_08_12',
        inicio: '08:00', fim: '12:00',
        turno: 'MANHA', ordem: 1,
        horas_semanais: 20, max_minutos_dia: 240,
      },
      {
        contrato: 'Estagiario', nome: 'TARDE_1330_PLUS',
        inicio: '13:30', fim: '20:00',
        turno: 'TARDE', ordem: 2,
        horas_semanais: 30, max_minutos_dia: 360,
      },
      {
        contrato: 'Estagiario', nome: 'ESTUDA_NOITE_08_14',
        inicio: '08:00', fim: '14:00',
        turno: 'MANHA', ordem: 3,
        horas_semanais: 30, max_minutos_dia: 360,
      },
    ] as const

    await transaction(async () => {
      for (const p of perfis) {
        const tipoId = tipoByNome.get(p.contrato)
        if (!tipoId) {
          console.warn(`[SEED] Contrato '${p.contrato}' nao encontrado. Perfil '${p.nome}' ignorado.`)
          continue
        }
        await execute(
          'INSERT INTO contrato_perfis_horario (tipo_contrato_id, nome, ativo, inicio, fim, preferencia_turno_soft, ordem, horas_semanais, max_minutos_dia) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
          tipoId, p.nome, true, p.inicio, p.fim, p.turno, p.ordem, p.horas_semanais, p.max_minutos_dia,
        )
      }
    })
    console.log('[SEED] 3 perfis de horario criados (MANHA_08_12, TARDE_1330_PLUS, ESTUDA_NOITE_08_14)')
  }

  // -- 3. Feriados --
  await seedFeriados()

  // -- 4. Regras do Motor (v6) --
  await seedRegrasDefinicao()

  // -- 5. Migration helper: cores em funcoes sem cor_hex --
  const funcoesSemCor = await queryAll<{ id: number; ordem: number }>('SELECT id, ordem FROM funcoes WHERE cor_hex IS NULL')
  if (funcoesSemCor.length > 0) {
    await transaction(async () => {
      for (const f of funcoesSemCor) {
        await execute(
          'UPDATE funcoes SET cor_hex = $1 WHERE id = $2',
          PALETA_CORES[(f.ordem - 1) % PALETA_CORES.length], f.id,
        )
      }
    })
    console.log(`[SEED] ${funcoesSemCor.length} funcoes atualizadas com cor_hex`)
  }

  // Configuracao backup (Maquina do Tempo) — default row
  const backupConfig = await queryOne<{ id: number }>('SELECT id FROM configuracao_backup WHERE id = 1')
  if (!backupConfig) {
    await execute('INSERT INTO configuracao_backup (id) VALUES (1) ON CONFLICT DO NOTHING')
    console.log('[SEED] Configuracao backup criada (auto-backup ativo)')
  }

  console.log('[SEED] Seed core concluido')
}

export async function seedData(): Promise<void> {
  await seedCoreData()

  // -- 6. Knowledge base seed (docs de sistema) --
  await seedKnowledgeBase()

  // -- 7. Graph seed (entidades pre-extraidas — sem LLM) --
  await seedGraphSistema()

  console.log('[SEED] Seed sistema concluido')
}

// ============================================================================
// Knowledge Base Seed — Documentação de sistema
// ============================================================================

async function seedKnowledgeBase(): Promise<void> {
  const kbCount = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM knowledge_sources')
  if ((kbCount?.count ?? 0) > 0) return // Já tem conteúdo

  try {
    const { ingestKnowledge } = await import('../knowledge/ingest')
    const path = await import('node:path')
    const fs = await import('node:fs')

    const knowledgeDir = resolveKnowledgeDir()
    if (!fs.existsSync(knowledgeDir)) {
      console.log('[SEED] Diretório knowledge/ não encontrado — seed KB ignorado')
      return
    }

    const mdFiles = findMdFiles(knowledgeDir)
    if (mdFiles.length === 0) {
      console.log('[SEED] Nenhum .md em knowledge/ — seed KB ignorado')
      return
    }

    console.log(`[SEED] Ingestando ${mdFiles.length} docs de conhecimento...`)
    let totalChunks = 0

    for (const file of mdFiles) {
      const content = fs.readFileSync(file.fullPath, 'utf-8')
      const titulo = file.relativePath.replace(/\.md$/, '').replace(/\//g, ' — ')
      const result = await ingestKnowledge(titulo, content, 'high', {
        tipo: 'sistema',
        arquivo: file.relativePath,
      })
      totalChunks += result.chunks_count
    }

    console.log(`[SEED] Knowledge base: ${mdFiles.length} doc(s), ${totalChunks} chunk(s) criados`)
  } catch (err) {
    console.warn('[SEED] Erro no seed KB (não-crítico):', (err as Error).message)
  }
}

function resolveKnowledgeDir(): string {
  const path = require('node:path') as typeof import('node:path')
  try {
    const electron = require('electron') as { app?: { isPackaged?: boolean } }
    if (electron.app?.isPackaged) {
      return path.join(process.resourcesPath, 'knowledge')
    }
  } catch { /* fallback */ }
  return path.join(__dirname, '../../knowledge')
}

function findMdFiles(dir: string, prefix = ''): { relativePath: string; fullPath: string }[] {
  const path = require('node:path') as typeof import('node:path')
  const fs = require('node:fs') as typeof import('node:fs')
  const files: { relativePath: string; fullPath: string }[] = []

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      files.push(...findMdFiles(fullPath, relativePath))
    } else if (entry.name.endsWith('.md')) {
      files.push({ relativePath, fullPath })
    }
  }
  return files
}

// ============================================================================
// Graph Seed — Entidades pre-extraidas do sistema (sem LLM)
// ============================================================================

async function seedGraphSistema(): Promise<void> {
  try {
    const { importGraphSeed } = await import('../knowledge/graph')
    const path = await import('node:path')
    const fs = await import('node:fs')

    const knowledgeDir = resolveKnowledgeDir()
    const seedPath = path.join(knowledgeDir, 'sistema', 'graph-seed.json')

    if (!fs.existsSync(seedPath)) return

    const raw = fs.readFileSync(seedPath, 'utf-8')
    const seed = JSON.parse(raw) as {
      entities: Array<{ nome: string; tipo: string }>
      relations: Array<{ from_nome: string; to_nome: string; tipo_relacao: string; peso: number }>
    }

    if (seed.entities.length === 0) return

    const result = await importGraphSeed(seed, 'sistema')
    console.log(`[SEED] Graph sistema: ${result.entities_count} entidades, ${result.relations_count} relacoes`)
  } catch (err) {
    console.warn('[SEED] Graph seed ignorado (nao-critico):', (err as Error).message)
  }
}

// ============================================================================
// Seed local (dados de exemplo — gitignored)
// ============================================================================

export async function seedLocalData(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createRequire } = await import('node:module')
    const require = createRequire(import.meta.url)
    const local = require('./seed-local')
    if (typeof local.seedLocalData === 'function') {
      await local.seedLocalData()
    }
  } catch (e) {
    // seed-local.ts nao existe — app abre vazio (usuario cadastra do zero)
    if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'MODULE_NOT_FOUND') return
    console.error('[SEED-LOCAL] Erro no seed local:', e)
  }
}

// ============================================================================
// Regras do Motor — Catalogo (v6 SPEC-02B)
// ============================================================================

async function seedRegrasDefinicao(): Promise<void> {
  const regras: [string, string, string, string, string, boolean, string | null, number][] = [
    // -- CLT --
    ['H1', 'Maximo 6 dias consecutivos', 'Nenhum colaborador pode trabalhar mais de 6 dias seguidos sem folga (CLT Art. 67).', 'CLT', 'HARD', true, 'Desligar pode afetar o controle da meta semanal de horas.', 1],
    ['H2', 'Descanso minimo de 11h entre jornadas', 'Intervalo minimo obrigatorio de 11 horas entre o fim de uma jornada e o inicio da proxima (CLT Art. 66).', 'CLT', 'HARD', false, null, 2],
    ['H3_DOM_CICLO_EXATO', 'Ciclo exato de domingos', 'Mantem o ciclo configurado de domingos por colaborador (padrao 2 domingos trabalhados para 1 de folga).', 'CLT', 'SOFT', true, 'Endurecer essa regra trava o ciclo exato; relaxar permite cobrir mais domingos.', 8],
    ['H3_DOM_MAX_CONSEC_M', 'Max domingos consecutivos (homens)', 'Homem: maximo 2 domingos consecutivos trabalhados (convencao/jurisprudencia).', 'CLT', 'HARD', true, 'Desligar pode permitir homens acima do limite configurado de domingos consecutivos.', 9],
    ['H3_DOM_MAX_CONSEC_F', 'Max domingos consecutivos (mulheres)', 'Mulher: maximo 1 domingo consecutivo trabalhado (Art. 386 CLT).', 'CLT', 'HARD', true, 'Desligar pode permitir mulheres acima do limite configurado de domingos consecutivos.', 10],
    ['H4', 'Jornada maxima diaria de 10h', 'Nenhuma jornada pode ultrapassar 10 horas por dia incluindo hora extra (CLT Art. 59).', 'CLT', 'HARD', false, null, 3],
    ['H5', 'Ferias, atestados e bloqueios', 'Colaboradores em ferias, atestado ou bloqueio cadastrado nao recebem alocacao de trabalho.', 'CLT', 'HARD', false, null, 4],
    ['H6', 'Human blocks — almoco e estrutura de jornada', 'Garante que cada jornada tenha intervalo de almoco e estrutura minima de blocos (CLT Art. 71).', 'CLT', 'HARD', true, 'Sem human blocks, o motor pode gerar jornadas sem intervalo de almoco.', 5],
    ['H10', 'Meta semanal de horas', 'Cada colaborador deve atingir a meta semanal de horas conforme seu contrato (CLT Art. 58).', 'CLT', 'HARD', true, 'Desligar H10 quebra todo o calculo de horas semanais.', 6],
    ['H15', 'Estagiario — max 6h/dia e 30h/sem', 'Estagiario tem jornada maxima de 6h/dia e 30h/semana (Lei 11.788/2008 Art. 10).', 'CLT', 'HARD', false, null, 7],
    ['H16', 'Estagiario — nunca hora extra', 'Estagiario nao pode realizar horas extras.', 'CLT', 'HARD', false, null, 12],
    ['H17', 'Feriado proibido — 25/12 (Natal)', 'Trabalho proibido em 25 de dezembro conforme CCT FecomercioSP.', 'CLT', 'HARD', false, null, 13],
    ['H18', 'Feriado proibido — 01/01 (Ano Novo)', 'Trabalho proibido em 1 de janeiro conforme CCT FecomercioSP.', 'CLT', 'HARD', false, null, 14],
    ['DIAS_TRABALHO', 'Dias de trabalho por semana (5x2 / 6x1)', 'Cada colaborador deve trabalhar o numero correto de dias conforme regime do contrato.', 'CLT', 'HARD', true, 'Desligar pode gerar semanas com numero incorreto de dias trabalhados.', 15],
    ['MIN_DIARIO', 'Jornada minima diaria (4h)', 'Jornadas abaixo de 4h sao microturenos sem valor economico (CLT Art. 58-A ss4).', 'CLT', 'HARD', true, 'Desligar pode gerar microturnos inuteis de poucos minutos.', 16],

    // -- SOFT --
    ['S_DEFICIT', 'Deficit de cobertura', 'Penaliza slots abaixo da demanda minima planejada.', 'SOFT', 'ON', true, null, 101],
    ['S_SURPLUS', 'Excesso de cobertura', 'Penaliza slots com mais pessoas do que a demanda maxima.', 'SOFT', 'ON', true, null, 102],
    ['S_DOMINGO_CICLO', 'Rodizio justo de domingos', 'Distribui domingos de trabalho de forma equitativa entre a equipe quando o ciclo exato estiver relaxado.', 'SOFT', 'ON', true, null, 103],
    ['S_TURNO_PREF', 'Preferencia de turno por colaborador', 'Tenta acomodar a preferencia de turno (manha/tarde) de cada colaborador.', 'SOFT', 'ON', true, null, 104],
    ['S_CONSISTENCIA', 'Consistencia de horarios entre dias', 'Penaliza variacoes bruscas de horario do mesmo colaborador ao longo da semana.', 'SOFT', 'ON', true, null, 105],
    ['S_SPREAD', 'Equilibrio de carga entre a equipe', 'Distribui horas de trabalho de forma equilibrada entre os colaboradores.', 'SOFT', 'ON', true, null, 106],
    ['S_AP1_EXCESS', 'Penalidade por jornada acima de 8h', 'Penaliza jornadas que ultrapassam 8 horas mesmo dentro do limite legal de 10h.', 'SOFT', 'ON', true, null, 107],
    ['S_CYCLE_CONSISTENCY', 'Consistencia entre ciclos', 'Penaliza quando dias correspondentes em ciclos diferentes tem horarios divergentes. Faz a escala repetir padroes.', 'SOFT', 'ON', true, null, 108],

    // -- ANTIPATTERN --
    ['AP1', 'Clopening — fechar e abrir no dia seguinte', 'Colaborador fecha o estabelecimento e abre no dia seguinte (intervalo critico).', 'ANTIPATTERN', 'ON', true, null, 201],
    ['AP2', 'Instabilidade de horarios (ioio)', 'Horarios que variam drasticamente de um dia para o outro sem justificativa.', 'ANTIPATTERN', 'ON', true, null, 202],
    ['AP3', 'Almoco simultaneo de mais de 50% da equipe', 'Muitos colaboradores em almoco ao mesmo tempo deixa o setor descoberto.', 'ANTIPATTERN', 'ON', true, null, 203],
    ['AP4', 'Desequilibrio de carga entre colaboradores', 'Distribuicao injusta de horas — alguns trabalham muito mais do que outros.', 'ANTIPATTERN', 'ON', true, null, 204],
    ['AP5', 'Folga isolada — ilhada entre dias de trabalho', 'Folga unica no meio de uma sequencia longa de trabalho sem descanso real.', 'ANTIPATTERN', 'ON', true, null, 205],
    ['AP6', 'Inequidade de turnos (indice abaixo de 40%)', 'Colaboradores sempre escalados no mesmo turno sem rotacao justa.', 'ANTIPATTERN', 'ON', true, null, 206],
    ['AP7', 'Fome de fim de semana (>5 sem folga sab/dom)', 'Colaborador fica mais de 5 semanas sem folga em sabado ou domingo.', 'ANTIPATTERN', 'ON', true, null, 207],
    ['AP8', 'Almoco fora da janela ideal (11h30-14h30)', 'Almoco programado muito cedo ou muito tarde em relacao a janela ideal.', 'ANTIPATTERN', 'ON', true, null, 208],
    ['AP9', 'Hora morta — microturno + gap + microturno', 'Jornada fragmentada com dois blocos pequenos e um gap no meio sem sentido operacional.', 'ANTIPATTERN', 'ON', true, null, 209],
    ['AP10', 'Overstaffing — 2+ pessoas quando meta e 1', 'Escala com excesso de pessoas em slots de baixa demanda.', 'ANTIPATTERN', 'ON', true, null, 210],
    ['AP15', 'Clustering de dias de pico na mesma equipe', 'Os dias de maior demanda concentram sempre os mesmos colaboradores.', 'ANTIPATTERN', 'ON', true, null, 211],
    ['AP16', 'Junior sozinho em slot de alta demanda', 'Colaborador junior (rank 0) escalonado sem apoio em horario de pico.', 'ANTIPATTERN', 'ON', true, null, 212],
  ]

  let inserted = 0
  await transaction(async () => {
    for (const r of regras) {
      const result = await execute(
        'INSERT INTO regra_definicao (codigo, nome, descricao, categoria, status_sistema, editavel, aviso_dependencia, ordem) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING',
        ...r,
      )
      inserted += result.changes
    }
  })

  if (inserted > 0) {
    console.log(`[SEED] ${inserted} regra(s) do motor inserida(s) no catalogo`)
  }
}

// ============================================================================
// Feriados nacionais (RFC ss12.2)
// ============================================================================

async function seedFeriados(): Promise<void> {
  const feriadosExistem = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM feriados')
  if ((feriadosExistem?.count ?? 0) > 0) return

  const currentYear = new Date().getFullYear()

  const gerarFeriadosAno = (ano: number): [string, string, string, boolean, boolean][] => [
    [`${ano}-01-01`, 'Confraternizacao Universal', 'NACIONAL', true, false],
    [`${ano}-04-21`, 'Tiradentes', 'NACIONAL', false, true],
    [`${ano}-05-01`, 'Dia do Trabalho', 'NACIONAL', false, true],
    [`${ano}-09-07`, 'Independencia do Brasil', 'NACIONAL', false, true],
    [`${ano}-10-12`, 'Nossa Senhora Aparecida', 'NACIONAL', false, true],
    [`${ano}-11-02`, 'Finados', 'NACIONAL', false, true],
    [`${ano}-11-15`, 'Proclamacao da Republica', 'NACIONAL', false, true],
    [`${ano}-12-25`, 'Natal', 'NACIONAL', true, false],
  ]

  const toIso = (d: Date): string =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`

  const addDays = (base: Date, days: number): Date => {
    const d = new Date(base.getTime())
    d.setUTCDate(d.getUTCDate() + days)
    return d
  }

  const calcularPascoa = (ano: number): Date => {
    const a = ano % 19
    const b = Math.floor(ano / 100)
    const c = ano % 100
    const d = Math.floor(b / 4)
    const e = b % 4
    const f = Math.floor((b + 8) / 25)
    const g = Math.floor((b - f + 1) / 3)
    const h = (19 * a + b - d - g + 15) % 30
    const i = Math.floor(c / 4)
    const k = c % 4
    const l = (32 + 2 * e + 2 * i - h - k) % 7
    const m = Math.floor((a + 11 * h + 22 * l) / 451)
    const month = Math.floor((h + l - 7 * m + 114) / 31)
    const day = ((h + l - 7 * m + 114) % 31) + 1
    return new Date(Date.UTC(ano, month - 1, day))
  }

  const gerarFeriadosMoveis = (ano: number): [string, string, string, boolean, boolean][] => {
    const pascoa = calcularPascoa(ano)
    const carnavalSeg = addDays(pascoa, -48)
    const carnavalTer = addDays(pascoa, -47)
    const sextaSanta = addDays(pascoa, -2)
    const corpusChristi = addDays(pascoa, 60)
    return [
      [toIso(carnavalSeg), 'Carnaval (ponto facultativo)', 'NACIONAL', false, true],
      [toIso(carnavalTer), 'Carnaval (ponto facultativo)', 'NACIONAL', false, true],
      [toIso(sextaSanta), 'Sexta-feira Santa', 'NACIONAL', false, true],
      [toIso(corpusChristi), 'Corpus Christi', 'NACIONAL', false, true],
    ]
  }

  await transaction(async () => {
    for (const ano of [currentYear, currentYear + 1]) {
      for (const f of gerarFeriadosAno(ano)) {
        await execute(
          'INSERT INTO feriados (data, nome, tipo, proibido_trabalhar, cct_autoriza) VALUES ($1, $2, $3, $4, $5)',
          ...f,
        )
      }
      for (const f of gerarFeriadosMoveis(ano)) {
        await execute(
          'INSERT INTO feriados (data, nome, tipo, proibido_trabalhar, cct_autoriza) VALUES ($1, $2, $3, $4, $5)',
          ...f,
        )
      }
    }
  })

  const total = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM feriados')
  console.log(`[SEED] ${total?.count ?? 0} feriados nacionais criados (${currentYear}-${currentYear + 1})`)
}
