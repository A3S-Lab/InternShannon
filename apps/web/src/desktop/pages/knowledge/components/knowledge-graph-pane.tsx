import { useMemo, useState } from "react";
import { Link2, Network } from "lucide-react";
import type { WikiGraph } from "@/lib/api/assets";
import { cn } from "@/lib/utils";
import { pageTitle } from "../knowledge-page-utils";

function graphNodeColor(type: string | null) {
  const colors = ["#2563eb", "#059669", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#4d7c0f"];
  const value = type || "note";
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

function forceGraphLayout(nodes: WikiGraph["nodes"], edges: WikiGraph["edges"]) {
  const positions = new Map<string, { x: number; y: number }>();
  nodes.forEach((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(1, nodes.length);
    positions.set(node.path, { x: 50 + Math.cos(angle) * 32, y: 50 + Math.sin(angle) * 32 });
  });
  for (let iteration = 0; iteration < 90; iteration += 1) {
    const forces = new Map(nodes.map((node) => [node.path, { x: 0, y: 0 }]));
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const left = positions.get(nodes[leftIndex].path);
        const right = positions.get(nodes[rightIndex].path);
        if (!left || !right) continue;
        const dx = left.x - right.x || 0.01;
        const dy = left.y - right.y || 0.01;
        const distanceSquared = Math.max(8, dx * dx + dy * dy);
        const repulsion = 48 / distanceSquared;
        const leftForce = forces.get(nodes[leftIndex].path);
        const rightForce = forces.get(nodes[rightIndex].path);
        if (leftForce) {
          leftForce.x += dx * repulsion;
          leftForce.y += dy * repulsion;
        }
        if (rightForce) {
          rightForce.x -= dx * repulsion;
          rightForce.y -= dy * repulsion;
        }
      }
    }
    for (const edge of edges) {
      const source = positions.get(edge.source);
      const target = positions.get(edge.target);
      if (!source || !target) continue;
      const pull = 0.006 * Math.max(1, edge.weight);
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const sourceForce = forces.get(edge.source);
      const targetForce = forces.get(edge.target);
      if (sourceForce) {
        sourceForce.x += dx * pull;
        sourceForce.y += dy * pull;
      }
      if (targetForce) {
        targetForce.x -= dx * pull;
        targetForce.y -= dy * pull;
      }
    }
    const cooling = 1 - iteration / 110;
    for (const node of nodes) {
      const position = positions.get(node.path);
      const force = forces.get(node.path);
      if (!position || !force) continue;
      position.x = Math.max(8, Math.min(92, position.x + (force.x + (50 - position.x) * 0.002) * cooling));
      position.y = Math.max(8, Math.min(92, position.y + (force.y + (50 - position.y) * 0.002) * cooling));
    }
  }
  return positions;
}

export function GraphPane(props: { graph: WikiGraph | null }) {
  const nodes = props.graph?.nodes ?? [];
  const edges = props.graph?.edges ?? [];
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [tag, setTag] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);
  const matchingNodes = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return nodes.filter((node) => {
      if (normalized && !`${node.title} ${node.path}`.toLowerCase().includes(normalized)) return false;
      if (type && node.type !== type) return false;
      if (tag && !(node.tags ?? []).includes(tag)) return false;
      return true;
    });
  }, [nodes, query, tag, type]);
  const filteredNodes = useMemo(() => {
    const hasFilter = Boolean(query.trim() || type || tag);
    if (!hasFilter) return matchingNodes;
    const matchedPaths = new Set(matchingNodes.map((node) => node.path));
    const contextPaths = new Set(matchedPaths);
    for (const edge of edges) {
      if (matchedPaths.has(edge.source) || matchedPaths.has(edge.target)) {
        contextPaths.add(edge.source);
        contextPaths.add(edge.target);
      }
    }
    return nodes.filter((node) => contextPaths.has(node.path));
  }, [edges, matchingNodes, nodes, query, tag, type]);
  const matchingPaths = useMemo(() => new Set(matchingNodes.map((node) => node.path)), [matchingNodes]);
  const topNodes = useMemo(
    () =>
      filteredNodes
        .slice()
        .sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title, "zh-CN"))
        .slice(0, 120),
    [filteredNodes],
  );
  const visiblePaths = useMemo(() => new Set(topNodes.map((node) => node.path)), [topNodes]);
  const visibleEdges = useMemo(
    () => edges.filter((edge) => visiblePaths.has(edge.source) && visiblePaths.has(edge.target)),
    [edges, visiblePaths],
  );
  const positions = useMemo(() => forceGraphLayout(topNodes, visibleEdges), [topNodes, visibleEdges]);
  const selectedNode = nodes.find((node) => node.path === selectedPath) ?? null;
  const selectedEdges = selectedPath
    ? visibleEdges.filter((edge) => edge.source === selectedPath || edge.target === selectedPath)
    : visibleEdges;
  const edgeKey = (edge: WikiGraph["edges"][number]) =>
    `${edge.source}\u0000${edge.target}\u0000${edge.kind ?? "concept-link"}`;
  const selectedEdge = visibleEdges.find((edge) => edgeKey(edge) === selectedEdgeKey) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f7f7f5]">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-light px-3 py-2">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Network className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">关系图</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {nodes.length} 节点 / {edges.length} 连接
          </div>
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索节点"
          className="h-8 w-36 rounded-md border border-border bg-white px-2 text-xs"
        />
        <select
          value={type}
          onChange={(event) => setType(event.target.value)}
          className="h-8 max-w-40 rounded-md border border-border bg-white px-2 text-xs"
        >
          <option value="">全部类型</option>
          {(props.graph?.filters?.types ?? []).map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          value={tag}
          onChange={(event) => setTag(event.target.value)}
          className="h-8 max-w-40 rounded-md border border-border bg-white px-2 text-xs"
        >
          <option value="">全部标签</option>
          {(props.graph?.filters?.tags ?? []).map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_280px]">
        <div className="relative min-h-[360px] overflow-hidden bg-white">
          <svg
            className="absolute inset-0 size-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <marker
                id="knowledge-graph-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
                markerUnits="strokeWidth"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
              </marker>
            </defs>
            {visibleEdges.map((edge) => {
              const source = positions.get(edge.source);
              const target = positions.get(edge.target);
              if (!source || !target) return null;
              const isSelected = edgeKey(edge) === selectedEdgeKey;
              return (
                <line
                  key={edgeKey(edge)}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke={isSelected ? "#2563eb" : "#94a3b8"}
                  strokeWidth={isSelected ? 1.5 : Math.min(0.9, 0.25 + edge.weight * 0.12)}
                  vectorEffect="non-scaling-stroke"
                  markerEnd="url(#knowledge-graph-arrow)"
                />
              );
            })}
          </svg>
          {topNodes.map((node) => {
            const position = positions.get(node.path);
            if (!position) return null;
            const color = graphNodeColor(node.type);
            return (
              <button
                type="button"
                key={node.path}
                onClick={() => {
                  setSelectedPath(node.path);
                  setSelectedEdgeKey(null);
                }}
                className={cn(
                  "absolute z-10 flex max-w-[150px] -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-md border bg-white px-2 py-1 text-[11px] shadow-sm",
                  selectedPath === node.path || selectedEdge?.source === node.path || selectedEdge?.target === node.path
                    ? "border-primary ring-1 ring-primary/20"
                    : matchingPaths.has(node.path)
                      ? "border-border-light"
                      : "border-border-light opacity-55",
                )}
                style={{
                  left: `${position.x}%`,
                  top: `${position.y}%`,
                }}
                title={node.path}
              >
                <span
                  className="shrink-0 rounded-full"
                  style={{
                    backgroundColor: color,
                    width: 7 + Math.min(9, node.degree * 1.5),
                    height: 7 + Math.min(9, node.degree * 1.5),
                  }}
                />
                <span className="truncate">{node.title}</span>
              </button>
            );
          })}
        </div>
        <aside className="min-h-0 overflow-y-auto border-l border-border-light bg-white p-3">
          <div className="mb-2 text-[11px] font-semibold text-muted-foreground">
            {selectedNode ? `${selectedNode.title} · 社区 ${selectedNode.community ?? 0}` : "可见连接"}
          </div>
          <div className="space-y-1">
            {selectedEdges.slice(0, 64).map((edge) => (
              <button
                type="button"
                key={edgeKey(edge)}
                onClick={() => {
                  setSelectedEdgeKey(edgeKey(edge));
                  setSelectedPath(null);
                }}
                className={cn(
                  "block w-full rounded-md border px-2 py-1.5 text-left text-xs",
                  selectedEdgeKey === edgeKey(edge) ? "border-primary bg-primary/5" : "border-border-light",
                )}
                aria-label={`高亮关系：${pageTitle(edge.source)} 到 ${pageTitle(edge.target)}`}
              >
                <div className="truncate text-foreground">{pageTitle(edge.source)}</div>
                <div className="flex items-center gap-1 truncate text-[10px] text-muted-foreground">
                  <Link2 className="size-3 shrink-0" />
                  {pageTitle(edge.target)}
                </div>
                <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  {edge.kind || "concept-link"} · weight {edge.weight}
                </div>
              </button>
            ))}
            {selectedEdges.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground">
                暂无连接
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
