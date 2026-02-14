import { useState, useEffect } from 'react'
import { Settings, Save, Shield } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PageHeader } from '@/componentes/PageHeader'
import { empresaService } from '@/servicos/empresa'
import { useApiData } from '@/hooks/useApiData'
import { toast } from 'sonner'
import type { Empresa } from '@escalaflow/shared'

const CLT_RULES = [
  { rule: 'Max 6 dias consecutivos de trabalho', code: 'CLT_MAX_DIAS_CONSECUTIVOS = 6' },
  { rule: 'Min 11h (660min) entre jornadas', code: 'CLT_MIN_DESCANSO_ENTRE_JORNADAS_MIN = 660' },
  { rule: 'Max 10h (600min) de jornada diaria', code: 'CLT_MAX_JORNADA_DIARIA_MIN = 600' },
  { rule: 'Mulher: max 1 domingo consecutivo', code: 'CLT_MAX_DOMINGOS_CONSECUTIVOS["F"] = 1' },
  { rule: 'Homem: max 2 domingos consecutivos', code: 'CLT_MAX_DOMINGOS_CONSECUTIVOS["M"] = 2' },
]

export function EmpresaConfig() {
  const { data: empresa, loading } = useApiData<Empresa>(
    () => empresaService.buscar(),
    [],
  )

  const [nome, setNome] = useState('')
  const [corteSemanal, setCorteSemanal] = useState('SEG_DOM')
  const [toleranciaSemanal, setToleranciaSemanal] = useState(30)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (empresa) {
      setNome(empresa.nome)
      setCorteSemanal(empresa.corte_semanal)
      setToleranciaSemanal(empresa.tolerancia_semanal_min)
    }
  }, [empresa])

  const handleSalvar = async () => {
    if (!nome.trim()) return
    setSalvando(true)
    try {
      await empresaService.atualizar({
        nome: nome.trim(),
        corte_semanal: corteSemanal,
        tolerancia_semanal_min: toleranciaSemanal,
      })
      toast.success('Empresa atualizada')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar empresa')
    } finally {
      setSalvando(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader breadcrumbs={[{ label: 'Empresa' }]} />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumbs={[{ label: 'Empresa' }]}
        actions={
          <Button size="sm" onClick={handleSalvar} disabled={salvando || !nome.trim()}>
            <Save className="mr-1 size-3.5" />
            {salvando ? 'Salvando...' : 'Salvar'}
          </Button>
        }
      />

      <div className="max-w-2xl flex-1 space-y-6 p-6">
        {/* Info basica */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Settings className="size-4" />
              Configuracao da Empresa
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Nome da empresa</Label>
              <Input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Nome do supermercado"
              />
              <p className="text-xs text-muted-foreground">
                Exibido nos relatorios e exportacoes.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Corte Semanal</Label>
                <Select value={corteSemanal} onValueChange={setCorteSemanal}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o corte" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SEG_DOM">Segunda a Domingo</SelectItem>
                    <SelectItem value="TER_SEG">Terca a Segunda</SelectItem>
                    <SelectItem value="QUA_TER">Quarta a Terca</SelectItem>
                    <SelectItem value="QUI_QUA">Quinta a Quarta</SelectItem>
                    <SelectItem value="SEX_QUI">Sexta a Quinta</SelectItem>
                    <SelectItem value="SAB_SEX">Sabado a Sexta</SelectItem>
                    <SelectItem value="DOM_SAB">Domingo a Sabado</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Define quando a semana de trabalho inicia e termina para
                  calculo de horas semanais.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Tolerancia Semanal (minutos)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={toleranciaSemanal}
                  onChange={(e) => setToleranciaSemanal(Number(e.target.value))}
                  placeholder="Ex: 30"
                />
                <p className="text-xs text-muted-foreground">
                  Margem aceitavel para desvio de horas semanais (0-100 min).
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Regras CLT (read-only) */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Shield className="size-4" />
              Regras CLT (Imutaveis)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-xs text-muted-foreground">
              Estas regras sao da legislacao trabalhista brasileira e nao podem
              ser alteradas. O motor de escala as aplica automaticamente.
            </p>
            <div className="space-y-2">
              {CLT_RULES.map((r, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg border bg-muted/30 p-3"
                >
                  <span className="text-sm text-foreground">{r.rule}</span>
                  <code className="rounded bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {r.code}
                  </code>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
