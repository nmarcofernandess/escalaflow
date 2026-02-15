import { Link } from 'react-router-dom'
import { MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/componentes/PageHeader'

export function NaoEncontrado() {
  return (
    <div className="flex flex-1 flex-col">
      <PageHeader breadcrumbs={[{ label: 'Pagina nao encontrada' }]} />
      <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
        <MapPin className="mb-4 size-12 text-muted-foreground/30" />
        <h2 className="text-lg font-semibold text-foreground">
          Pagina nao encontrada
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          O endereco que voce tentou acessar nao existe.
        </p>
        <Button className="mt-6" asChild>
          <Link to="/">Voltar ao Dashboard</Link>
        </Button>
      </div>
    </div>
  )
}
