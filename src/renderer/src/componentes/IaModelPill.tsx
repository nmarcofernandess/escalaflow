import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import type { IaProviderId } from '@shared/index'
import { cn } from '@/lib/utils'

type ProviderOption = {
  provider: IaProviderId
  label: string
  disabled: boolean
  reason?: string
}

type ModelOption = {
  id: string
  label: string
  disabled: boolean
  reason?: string
}

interface Props {
  provider: IaProviderId
  providerOptions: ProviderOption[]
  modelo: string
  modeloLabel: string
  modelOptions: ModelOption[]
  variant?: 'popover' | 'inline'
  modelSelectDisabled?: boolean
  onProviderChange: (p: IaProviderId) => Promise<void>
  onModeloChange: (m: string) => Promise<void>
}

export function IaModelPill({
  provider,
  providerOptions,
  modelo,
  modeloLabel,
  modelOptions,
  variant = 'popover',
  modelSelectDisabled = false,
  onProviderChange,
  onModeloChange,
}: Props) {
  const compact = variant === 'popover'

  const content = (
    <div className={cn('flex flex-col gap-4', !compact && 'rounded-2xl border bg-card p-6 shadow-sm')}>
      <div className="flex flex-col gap-2">
        <Label className={cn(compact ? 'text-xs' : 'text-sm')}>Provedor</Label>
        <Select value={provider} onValueChange={(value) => onProviderChange(value as IaProviderId)}>
          <SelectTrigger className={cn(compact ? 'h-8 text-xs' : 'h-12 text-sm')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {providerOptions.map((option) => (
                <SelectItem key={option.provider} value={option.provider} disabled={option.disabled} className={cn(compact ? 'text-xs' : 'text-sm')}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label className={cn(compact ? 'text-xs' : 'text-sm')}>Modelo</Label>
        <Select value={modelo} onValueChange={onModeloChange} disabled={modelSelectDisabled}>
          <SelectTrigger className={cn(compact ? 'h-8 text-xs' : 'h-12 text-sm')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {modelOptions.length > 0 ? (
                modelOptions.map((model) => (
                  <SelectItem key={model.id} value={model.id} disabled={model.disabled} className={cn(compact ? 'text-xs' : 'text-sm')}>
                    {model.label}
                  </SelectItem>
                ))
              ) : modelo ? (
                <SelectItem value={modelo} className={cn(compact ? 'text-xs' : 'text-sm')} disabled>
                  {modeloLabel || modelo}
                </SelectItem>
              ) : null}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </div>
  )

  if (variant === 'inline') return content

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-auto gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
          <span className="truncate max-w-[160px]">{modeloLabel || modelo || 'Modelo'}</span>
          <ChevronDown className="size-3 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="end" sideOffset={8}>
        {content}
      </PopoverContent>
    </Popover>
  )
}
