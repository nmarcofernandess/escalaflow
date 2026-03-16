import { useState } from 'react'
import {
  ShoppingCart, Snowflake, UtensilsCrossed, Fish, Beef,
  Croissant, Apple, Leaf, Wheat, Salad, Carrot, Grape, Cherry,
  Coffee, Wine, Beer, Milk, GlassWater, Pizza, Sandwich, Cookie,
  Egg, Ham, IceCreamCone,
  Package, Box, Truck, Banknote, Store, Sparkles, SprayCan,
  Users, Tag, Building2, Flame, Scissors, Shirt,
  type LucideIcon,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface IconEntry {
  name: string
  icon: LucideIcon
  label: string
}

export const SETOR_ICONS: IconEntry[] = [
  // Departamentos de alimentos
  { name: 'shopping-cart', icon: ShoppingCart, label: 'Mercado' },
  { name: 'banknote', icon: Banknote, label: 'Caixa' },
  { name: 'store', icon: Store, label: 'Loja' },
  { name: 'utensils-crossed', icon: UtensilsCrossed, label: 'Cozinha' },
  { name: 'beef', icon: Beef, label: 'Carnes' },
  { name: 'ham', icon: Ham, label: 'Frios' },
  { name: 'snowflake', icon: Snowflake, label: 'Congelados' },
  { name: 'fish', icon: Fish, label: 'Peixaria' },
  { name: 'croissant', icon: Croissant, label: 'Padaria' },
  { name: 'wheat', icon: Wheat, label: 'Cereais' },
  { name: 'apple', icon: Apple, label: 'Frutas' },
  { name: 'leaf', icon: Leaf, label: 'Hortifruti' },
  { name: 'salad', icon: Salad, label: 'Salada' },
  { name: 'carrot', icon: Carrot, label: 'Legumes' },
  { name: 'grape', icon: Grape, label: 'Uvas' },
  { name: 'cherry', icon: Cherry, label: 'Frutas' },
  { name: 'egg', icon: Egg, label: 'Ovos' },
  { name: 'milk', icon: Milk, label: 'Laticinios' },
  { name: 'coffee', icon: Coffee, label: 'Cafe' },
  { name: 'wine', icon: Wine, label: 'Vinhos' },
  { name: 'beer', icon: Beer, label: 'Bebidas' },
  { name: 'glass-water', icon: GlassWater, label: 'Agua' },
  { name: 'pizza', icon: Pizza, label: 'Rotisseria' },
  { name: 'sandwich', icon: Sandwich, label: 'Lanches' },
  { name: 'cookie', icon: Cookie, label: 'Doces' },
  { name: 'ice-cream-cone', icon: IceCreamCone, label: 'Sorvetes' },
  // Operacoes
  { name: 'flame', icon: Flame, label: 'Quente' },
  { name: 'sparkles', icon: Sparkles, label: 'Limpeza' },
  { name: 'spray-can', icon: SprayCan, label: 'Higiene' },
  { name: 'package', icon: Package, label: 'Estoque' },
  { name: 'box', icon: Box, label: 'Deposito' },
  { name: 'truck', icon: Truck, label: 'Logistica' },
  { name: 'scissors', icon: Scissors, label: 'Fatiados' },
  { name: 'shirt', icon: Shirt, label: 'Textil' },
  { name: 'users', icon: Users, label: 'Equipe' },
  { name: 'tag', icon: Tag, label: 'Precos' },
]

const ICON_MAP: Record<string, LucideIcon> = Object.fromEntries(
  SETOR_ICONS.map((i) => [i.name, i.icon]),
)

export function SetorIcon({ name, className }: { name: string | null; className?: string }) {
  const Icon = name ? ICON_MAP[name] ?? Building2 : Building2
  return <Icon className={className} />
}

interface IconPickerProps {
  value: string | null
  onChange: (name: string | null) => void
}

export function IconPicker({ value, onChange }: IconPickerProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={cn('size-9 shrink-0', value && 'border-primary/50')}
        onClick={() => setOpen(true)}
      >
        <SetorIcon name={value} className="size-4 text-muted-foreground" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Escolher Icone</DialogTitle>
            <DialogDescription>Selecione um icone para o setor.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-6 gap-1">
            {SETOR_ICONS.map(({ name: iconName, icon: Icon, label }) => (
              <Tooltip key={iconName}>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn('size-10', value === iconName && 'bg-accent ring-2 ring-primary')}
                    onClick={() => {
                      onChange(iconName)
                      setOpen(false)
                    }}
                  >
                    <Icon className="size-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {label}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
          {value && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={() => {
                onChange(null)
                setOpen(false)
              }}
            >
              Remover icone
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
