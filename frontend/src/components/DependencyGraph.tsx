import React, { useRef, useEffect } from "react";
import * as d3 from "d3";

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  file?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  type?: string;
}

interface DependencyGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width?: number;
  height?: number;
}

const NODE_COLORS: Record<string, string> = {
  source: "#3b82f6",
  test: "#00ff88",
  database: "#f97316",
  config: "#6366f1",
};
const DEFAULT_COLOR = "#8892a4";

export function DependencyGraph({ nodes, edges, width = 720, height = 480 }: DependencyGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    if (nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const defs = svg.append("defs");
    defs.append("marker")
      .attr("id", "arrowhead")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 18)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#1e2d45");

    const container = svg.append("g").attr("class", "graph-container");

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        container.attr("transform", event.transform.toString());
      });

    svg.call(zoom as d3.ZoomBehavior<SVGSVGElement, unknown>);

    // Build degree map
    const degreeMap: Record<string, number> = {};
    nodes.forEach(n => { degreeMap[n.id] = 0; });
    edges.forEach(e => {
      const src = typeof e.source === "string" ? e.source : (e.source as GraphNode).id;
      const tgt = typeof e.target === "string" ? e.target : (e.target as GraphNode).id;
      degreeMap[src] = (degreeMap[src] ?? 0) + 1;
      degreeMap[tgt] = (degreeMap[tgt] ?? 0) + 1;
    });

    const nodeRadius = (id: string) => Math.max(8, Math.min(20, 8 + (degreeMap[id] ?? 0) * 2));

    // Deep copy for D3 mutation
    const simNodes: (GraphNode & d3.SimulationNodeDatum)[] = nodes.map(n => ({ ...n }));
    const simEdges: d3.SimulationLinkDatum<GraphNode & d3.SimulationNodeDatum>[] = edges.map(e => ({
      source: e.source,
      target: e.target,
      type: e.type,
    }));

    const simulation = d3.forceSimulation(simNodes)
      .force("link", d3.forceLink<GraphNode & d3.SimulationNodeDatum, d3.SimulationLinkDatum<GraphNode & d3.SimulationNodeDatum>>(simEdges)
        .id((d) => d.id)
        .distance(80))
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(30));

    const linkSel = container.append("g")
      .attr("class", "links")
      .selectAll("line")
      .data(simEdges)
      .enter()
      .append("line")
      .attr("stroke", "#1e2d45")
      .attr("stroke-width", 1.5)
      .attr("marker-end", "url(#arrowhead)");

    let selectedNodeId: string | null = null;

    const nodeSel = container.append("g")
      .attr("class", "nodes")
      .selectAll<SVGGElement, GraphNode & d3.SimulationNodeDatum>("g")
      .data(simNodes)
      .enter()
      .append("g")
      .attr("class", "node")
      .attr("tabindex", 0)
      .attr("aria-label", (d) => `Node: ${d.label}, type: ${d.type}`)
      .style("cursor", "pointer")
      .call(
        d3.drag<SVGGElement, GraphNode & d3.SimulationNodeDatum>()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    nodeSel.append("circle")
      .attr("r", (d) => nodeRadius(d.id))
      .attr("fill", (d) => NODE_COLORS[d.type] ?? DEFAULT_COLOR)
      .attr("stroke", "#0a0f1e")
      .attr("stroke-width", 2);

    nodeSel.append("text")
      .attr("dy", (d) => nodeRadius(d.id) + 12)
      .attr("text-anchor", "middle")
      .attr("font-size", "10px")
      .attr("font-family", "'DM Mono', monospace")
      .attr("fill", "#8892a4")
      .text((d) => d.label.length > 16 ? d.label.slice(0, 15) + "…" : d.label);

    function highlightNode(id: string | null) {
      selectedNodeId = id;
      if (!id) {
        nodeSel.select("circle").attr("opacity", 1);
        linkSel.attr("opacity", 1).attr("stroke", "#1e2d45");
        return;
      }
      const connectedIds = new Set<string>([id]);
      simEdges.forEach((e) => {
        const src = typeof e.source === "string" ? e.source : (e.source as GraphNode & d3.SimulationNodeDatum).id;
        const tgt = typeof e.target === "string" ? e.target : (e.target as GraphNode & d3.SimulationNodeDatum).id;
        if (src === id) connectedIds.add(tgt);
        if (tgt === id) connectedIds.add(src);
      });
      nodeSel.select("circle").attr("opacity", (d) => connectedIds.has(d.id) ? 1 : 0.2);
      linkSel
        .attr("opacity", (e) => {
          const src = typeof e.source === "string" ? e.source : (e.source as GraphNode & d3.SimulationNodeDatum).id;
          const tgt = typeof e.target === "string" ? e.target : (e.target as GraphNode & d3.SimulationNodeDatum).id;
          return src === id || tgt === id ? 1 : 0.1;
        })
        .attr("stroke", (e) => {
          const src = typeof e.source === "string" ? e.source : (e.source as GraphNode & d3.SimulationNodeDatum).id;
          const tgt = typeof e.target === "string" ? e.target : (e.target as GraphNode & d3.SimulationNodeDatum).id;
          return src === id || tgt === id ? "#00ff88" : "#1e2d45";
        });
    }

    nodeSel
      .on("click", (_event, d) => {
        highlightNode(selectedNodeId === d.id ? null : d.id);
      })
      .on("keydown", (event: KeyboardEvent, d) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          highlightNode(selectedNodeId === d.id ? null : d.id);
        }
      });

    simulation.on("tick", () => {
      linkSel
        .attr("x1", (d) => ((d.source as GraphNode & d3.SimulationNodeDatum).x ?? 0))
        .attr("y1", (d) => ((d.source as GraphNode & d3.SimulationNodeDatum).y ?? 0))
        .attr("x2", (d) => ((d.target as GraphNode & d3.SimulationNodeDatum).x ?? 0))
        .attr("y2", (d) => ((d.target as GraphNode & d3.SimulationNodeDatum).y ?? 0));

      nodeSel.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    return () => { simulation.stop(); };
  }, [nodes, edges, width, height]);

  if (nodes.length === 0) {
    return (
      <div style={{ border: "1px dashed var(--color-border)", borderRadius: "var(--radius-md)", padding: 40, textAlign: "center", color: "var(--color-text-secondary)" }}>
        No dependency data available for this analysis.
      </div>
    );
  }

  return (
    <div style={{ position: "relative", background: "var(--color-bg-secondary)", borderRadius: "var(--radius-md)", border: "1px solid var(--color-border)", overflow: "hidden" }}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        style={{ width: "100%", height: "auto", display: "block" }}
        aria-label="Dependency graph"
        role="img"
      />
      {/* Legend */}
      <div style={{ position: "absolute", bottom: 12, left: 12, display: "flex", gap: 16, background: "rgba(10,15,30,0.85)", padding: "8px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)" }}>
        {Object.entries(NODE_COLORS).map(([type, color]) => (
          <span key={type} style={{ display: "flex", alignItems: "center", gap: 6, font: "10px 'DM Mono', monospace", color: "var(--color-text-secondary)", textTransform: "capitalize" }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, display: "inline-block" }} />
            {type}
          </span>
        ))}
      </div>
    </div>
  );
}
