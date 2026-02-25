import { useRef, useCallback, useEffect, useMemo } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { ENTITY_TYPE_COLORS } from '@/lib/cores'

export interface GraphNode {
  id: number
  nome: string
  tipo: string
}

export interface GraphLink {
  source: number
  target: number
  tipo_relacao: string
  peso: number
}

interface GraphVisualizerProps {
  nodes: GraphNode[]
  links: GraphLink[]
  onNodeClick?: (node: GraphNode) => void
  selectedNodeId?: number | null
  width?: number
  height?: number
}

export function GraphVisualizer({
  nodes,
  links,
  onNodeClick,
  selectedNodeId,
  width,
  height = 500,
}: GraphVisualizerProps) {
  const fgRef = useRef<any>(null)

  // Memoize graph data to prevent re-renders
  const graphData = useMemo(() => ({
    nodes: nodes.map(n => ({ ...n })),
    links: links.map(l => ({ ...l })),
  }), [nodes, links])

  // Set de IDs vizinhos do node selecionado (pra destaque)
  const neighborSet = useMemo(() => {
    if (!selectedNodeId) return new Set<number>()
    const s = new Set<number>([selectedNodeId])
    for (const l of links) {
      if (l.source === selectedNodeId) s.add(l.target)
      if (l.target === selectedNodeId) s.add(l.source)
    }
    return s
  }, [selectedNodeId, links])

  const handleNodeClick = useCallback(
    (node: any) => {
      if (onNodeClick && node.id != null) {
        onNodeClick(node as GraphNode)
      }
    },
    [onNodeClick],
  )

  // Zoom to fit on load
  useEffect(() => {
    const timer = setTimeout(() => {
      fgRef.current?.zoomToFit(400, 40)
    }, 500)
    return () => clearTimeout(timer)
  }, [nodes.length])

  const nodeColor = useCallback(
    (node: any) => {
      const color = ENTITY_TYPE_COLORS[node.tipo] ?? '#6b7280'
      if (selectedNodeId && !neighborSet.has(node.id)) {
        return color + '33' // dim non-neighbors
      }
      return color
    },
    [selectedNodeId, neighborSet],
  )

  const nodeLabel = useCallback(
    (node: any) => `${node.nome} (${node.tipo})`,
    [],
  )

  const linkColor = useCallback(
    (link: any) => {
      if (!selectedNodeId) return '#94a3b844'
      const src = typeof link.source === 'object' ? link.source.id : link.source
      const tgt = typeof link.target === 'object' ? link.target.id : link.target
      if (neighborSet.has(src) && neighborSet.has(tgt)) return '#94a3b8'
      return '#94a3b822'
    },
    [selectedNodeId, neighborSet],
  )

  const nodeCanvasObject = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const label = node.nome as string
      const fontSize = Math.max(12 / globalScale, 1.5)
      const isSelected = node.id === selectedNodeId
      const isNeighbor = neighborSet.has(node.id)
      const dimmed = selectedNodeId != null && !isNeighbor

      // Node circle
      const r = isSelected ? 6 : 4
      ctx.beginPath()
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false)
      const baseColor = ENTITY_TYPE_COLORS[node.tipo] ?? '#6b7280'
      ctx.fillStyle = dimmed ? baseColor + '33' : baseColor
      ctx.fill()

      if (isSelected) {
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }

      // Label
      if (globalScale > 0.6 || isSelected || isNeighbor) {
        ctx.font = `${fontSize}px Inter, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillStyle = dimmed ? '#94a3b844' : '#e2e8f0'
        ctx.fillText(label, node.x, node.y + r + 2)
      }
    },
    [selectedNodeId, neighborSet],
  )

  if (nodes.length === 0) return null

  return (
    <div className="overflow-hidden rounded-lg border bg-muted/20">
      <ForceGraph2D
        ref={fgRef}
        graphData={graphData}
        width={width}
        height={height}
        nodeId="id"
        nodeLabel={nodeLabel}
        nodeColor={nodeColor}
        nodeCanvasObject={nodeCanvasObject}
        nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
          const r = 6
          ctx.beginPath()
          ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false)
          ctx.fillStyle = color
          ctx.fill()
        }}
        linkColor={linkColor}
        linkDirectionalArrowLength={3}
        linkDirectionalArrowRelPos={0.9}
        linkWidth={1}
        onNodeClick={handleNodeClick}
        backgroundColor="transparent"
        cooldownTicks={100}
        enableNodeDrag={true}
        enableZoomInteraction={true}
        enablePanInteraction={true}
      />
    </div>
  )
}
