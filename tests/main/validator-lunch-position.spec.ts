import { describe, expect, it } from 'vitest'
import { checkH20 } from '../../src/main/motor/validacao-compartilhada'
import type { CelulaMotor, ColabMotor } from '../../src/main/motor/validacao-compartilhada'

const colab: ColabMotor = {
  id: 1,
  nome: 'CLT Tarde',
  sexo: 'F',
  tipo_trabalhador: 'CLT',
  horas_semanais: 44,
  dias_trabalho: 6,
  max_minutos_dia: 585,
  rank: 1,
  prefere_turno: null,
  evitar_dia_semana: null,
  funcao_id: null,
}

function trabalhoComAlmoco(overrides: Partial<CelulaMotor>): CelulaMotor {
  return {
    status: 'TRABALHO',
    hora_inicio: '13:00',
    hora_fim: '21:00',
    minutos: 420,
    minutos_trabalho: 420,
    hora_almoco_inicio: '16:00',
    hora_almoco_fim: '17:00',
    minutos_almoco: 60,
    intervalo_15min: false,
    funcao_id: null,
    ...overrides,
  }
}

describe('validator lunch position', () => {
  it('validates lunch relative to the shift instead of a fixed 11:00-14:00 window', () => {
    expect(checkH20(trabalhoComAlmoco({}), colab, '2026-03-02')).toEqual([])

    const cedoDemais = checkH20(
      trabalhoComAlmoco({
        hora_almoco_inicio: '14:30',
        hora_almoco_fim: '15:30',
      }),
      colab,
      '2026-03-02',
    )

    expect(cedoDemais).toEqual([
      expect.objectContaining({
        severidade: 'HARD',
        regra: 'H20_ALMOCO_POSICAO',
      }),
    ])
  })
})
