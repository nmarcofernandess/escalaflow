import { ChevronDown } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import type { IaProviderId, IaModelCatalogItem } from '@shared/index'

interface Props {
  provider: IaProviderId
  modelo: string
  modeloLabel: string
  modelOptions: IaModelCatalogItem[]
  onProviderChange: (p: IaProviderId) => Promise<void>
  onModeloChange: (m: string) => Promise<void>
}

export function IaModelPill({ provider, modelo, modeloLabel, modelOptions, onProviderChange, onModeloChange }: Props) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-md px-2 py-1 hover:bg-muted">
          <span className="truncate max-w-[160px]">{modeloLabel || modelo || 'Modelo'}</span>
          <ChevronDown className="size-3 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="end" sideOffset={8}>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Provedor</Label>
            <Select value={provider} onValueChange={(v) => onProviderChange(v as IaProviderId)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gemini">Gemini</SelectItem>
                <SelectItem value="openrouter">OpenRouter</SelectItem>
                <SelectItem value="local">IA Local (Offline)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Modelo</Label>
            <Select value={modelo} onValueChange={onModeloChange}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {modelOptions.length > 0 ? (
                  modelOptions.map(m => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">
                      {m.label}
                    </SelectItem>
                  ))
                ) : modelo ? (
                  <SelectItem value={modelo} className="text-xs">
                    {modeloLabel || modelo}
                  </SelectItem>
                ) : null}
              </SelectContent>
            </Select>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
