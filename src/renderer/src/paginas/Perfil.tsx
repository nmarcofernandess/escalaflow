import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Save, User } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from '@/components/ui/form'
import { PageHeader } from '@/componentes/PageHeader'
import { empresaService } from '@/servicos/empresa'
import { useApiData } from '@/hooks/useApiData'
import { iniciais } from '@/lib/formatadores'
import { toast } from 'sonner'
import type { Empresa } from '@shared/index'

const STORAGE_KEY = 'escalaflow-user-name'

const perfilSchema = z.object({
  nome_usuario: z.string().min(1, 'Nome e obrigatorio'),
})

type PerfilFormData = z.infer<typeof perfilSchema>

export function Perfil() {
  const { data: empresa } = useApiData<Empresa>(
    () => empresaService.buscar(),
    [],
  )

  const [salvando, setSalvando] = useState(false)

  const form = useForm<PerfilFormData>({
    resolver: zodResolver(perfilSchema),
    defaultValues: {
      nome_usuario: '',
    },
  })

  // Load from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      form.reset({ nome_usuario: saved })
    }
  }, [form])

  const nomeUsuario = form.watch('nome_usuario')

  const onSubmit = async (data: PerfilFormData) => {
    setSalvando(true)
    try {
      localStorage.setItem(STORAGE_KEY, data.nome_usuario.trim())
      toast.success('Perfil salvo')
    } catch {
      toast.error('Erro ao salvar perfil')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: 'Perfil' },
        ]}
        actions={
          <Button size="sm" onClick={form.handleSubmit(onSubmit)} disabled={salvando}>
            <Save className="mr-1 size-3.5" />
            {salvando ? 'Salvando...' : 'Salvar'}
          </Button>
        }
      />

      <div className="max-w-2xl flex-1 space-y-6 p-6">
        {/* Avatar */}
        <div className="flex items-center gap-6">
          <Avatar className="size-20">
            <AvatarFallback className="bg-primary/10 text-xl font-bold text-primary">
              {nomeUsuario ? iniciais(nomeUsuario) : <User className="size-8" />}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="text-lg font-semibold text-foreground">
              {nomeUsuario || 'Usuario'}
            </p>
            <p className="text-sm text-muted-foreground">
              {empresa?.nome ?? 'Carregando...'}
            </p>
          </div>
        </div>

        {/* Form */}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">
                  Dados do Usuario
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="nome_usuario"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Seu nome</FormLabel>
                      <FormControl>
                        <Input placeholder="Ex: Maria Fernandes" {...field} />
                      </FormControl>
                      <FormDescription>
                        Salvo localmente neste computador.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="space-y-2">
                  <FormLabel>Empresa</FormLabel>
                  <Input
                    value={empresa?.nome ?? ''}
                    readOnly
                    className="bg-muted/50"
                  />
                  <FormDescription>
                    Configuravel na pagina de Empresa.
                  </FormDescription>
                </div>
              </CardContent>
            </Card>
          </form>
        </Form>
      </div>
    </div>
  )
}
