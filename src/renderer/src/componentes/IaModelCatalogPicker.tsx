import { useState, useMemo } from 'react'
import { Search, Star, Filter, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { IaModelCatalogItem } from '@shared/types'

interface IaModelCatalogPickerProps {
  models: IaModelCatalogItem[]
  value: string
  favorites: string[]
  onChange: (modelId: string) => void
  onToggleFavorite: (modelId: string) => void
}

function formatContextLength(length: number): string {
  if (length >= 1_000_000) {
    const val = (length / 1_000_000).toFixed(1).replace(/\.0$/, '')
    return `${val}M`
  }
  if (length >= 1_000) return `${Math.round(length / 1_000)}K`
  return String(length)
}

function formatPrice(model: IaModelCatalogItem): string {
  if (model.is_free) return 'Gratis'
  if (!model.pricing) return '-'
  return `$${model.pricing.prompt ?? '?'}/$${model.pricing.completion ?? '?'}`
}

export function IaModelCatalogPicker({
  models,
  value,
  favorites,
  onChange,
  onToggleFavorite,
}: IaModelCatalogPickerProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [filterToolCalling, setFilterToolCalling] = useState(false)
  const [filterFree, setFilterFree] = useState(false)
  const [filterAgentic, setFilterAgentic] = useState(false)
  const [filterFavorites, setFilterFavorites] = useState(false)

  const hasFilters = filterToolCalling || filterFree || filterAgentic || filterFavorites
  const filterCount = [filterToolCalling, filterFree, filterAgentic, filterFavorites].filter(Boolean).length

  const favSet = useMemo(() => new Set(favorites), [favorites])

  const filteredModels = useMemo(() => {
    return models.filter((model) => {
      if (searchQuery && !model.label.toLowerCase().includes(searchQuery.toLowerCase())) return false
      if (filterToolCalling && !model.supports_tools) return false
      if (filterFree && !model.is_free) return false
      if (filterAgentic && !model.is_agentic) return false
      if (filterFavorites && !favSet.has(model.id)) return false
      return true
    })
  }, [models, searchQuery, filterToolCalling, filterFree, filterAgentic, filterFavorites, favSet])

  const handleClearFilters = () => {
    setSearchQuery('')
    setFilterToolCalling(false)
    setFilterFree(false)
    setFilterAgentic(false)
    setFilterFavorites(false)
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filtrar modelos..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-8"
          />
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant={hasFilters ? 'secondary' : 'outline'} size="sm">
              <Filter className="mr-1.5 size-3.5" />
              Filtros
              {hasFilters && (
                <Badge variant="secondary" className="ml-1.5 h-5 min-w-5 px-1.5 text-xs font-semibold">
                  {filterCount}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56" align="start">
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground">Filtrar por</p>
              <div className="flex items-center gap-2">
                <Checkbox id="filter-tools" checked={filterToolCalling} onCheckedChange={(c) => setFilterToolCalling(c as boolean)} />
                <Label htmlFor="filter-tools" className="cursor-pointer text-sm font-normal">Tool Calling</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="filter-free" checked={filterFree} onCheckedChange={(c) => setFilterFree(c as boolean)} />
                <Label htmlFor="filter-free" className="cursor-pointer text-sm font-normal">Gratis</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="filter-agentic" checked={filterAgentic} onCheckedChange={(c) => setFilterAgentic(c as boolean)} />
                <Label htmlFor="filter-agentic" className="cursor-pointer text-sm font-normal">Agentico</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="filter-favorites" checked={filterFavorites} onCheckedChange={(c) => setFilterFavorites(c as boolean)} />
                <Label htmlFor="filter-favorites" className="cursor-pointer text-sm font-normal">Favoritos</Label>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={handleClearFilters}>
            <X className="mr-1 size-3.5" />
            Limpar
          </Button>
        )}
      </div>

      {/* Table */}
      <ScrollArea className="max-h-[400px] rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center">
                <span className="text-xs">★</span>
              </TableHead>
              <TableHead>Modelo</TableHead>
              <TableHead className="w-[200px]">Tags</TableHead>
              <TableHead className="w-[80px] text-right">Contexto</TableHead>
              <TableHead className="w-[90px] pr-3 text-right">Preco</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredModels.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                  Nenhum modelo encontrado.
                </TableCell>
              </TableRow>
            ) : (
              filteredModels.map((model) => (
                <TableRow
                  key={model.id}
                  data-state={value === model.id ? 'selected' : undefined}
                  className="cursor-pointer"
                  onClick={() => onChange(model.id)}
                >
                  <TableCell className="text-center">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggleFavorite(model.id)
                      }}
                      className="inline-flex items-center justify-center rounded transition-colors hover:text-foreground"
                    >
                      <Star
                        className={cn(
                          'size-4',
                          favSet.has(model.id)
                            ? 'fill-yellow-400 text-yellow-400'
                            : 'text-muted-foreground/30'
                        )}
                      />
                    </button>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm font-medium">{model.label}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1.5">
                      {model.is_free && <Badge variant="outline" className="text-xs">Free</Badge>}
                      {model.supports_tools && <Badge variant="outline" className="text-xs">Tools</Badge>}
                      {model.is_agentic && <Badge variant="outline" className="text-xs">Agent</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {model.context_length ? formatContextLength(model.context_length) : '-'}
                  </TableCell>
                  <TableCell className="pr-3 text-right text-xs text-muted-foreground">
                    {formatPrice(model)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </ScrollArea>

      {/* Footer count */}
      <p className="text-xs text-muted-foreground">
        {filteredModels.length} de {models.length} modelos
      </p>
    </div>
  )
}
