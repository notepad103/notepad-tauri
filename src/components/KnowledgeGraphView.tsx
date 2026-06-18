import type { KnowledgeGraph } from "../types/knowledge";

interface KnowledgeGraphViewProps {
  graph: KnowledgeGraph;
}

export default function KnowledgeGraphView({ graph }: KnowledgeGraphViewProps) {
  const width = 760;
  const height = 360;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = 125;
  const nodes = graph.nodes.slice(0, 10);
  const center = nodes[0];
  const outerNodes = nodes.slice(1);
  const positions = new Map<string, { x: number; y: number }>();

  if (center) {
    positions.set(center.id, { x: centerX, y: centerY });
  }

  outerNodes.forEach((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(outerNodes.length, 1) - Math.PI / 2;
    positions.set(node.id, {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    });
  });

  return (
    <div className="knowledge-graph-wrap">
      <svg
        className="knowledge-graph"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="知识图谱"
      >
        <defs>
          <marker
            id="graph-arrow"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8 Z" fill="#94a3b8" />
          </marker>
        </defs>
        {graph.edges.map((edge, index) => {
          const source = positions.get(edge.source);
          const target = positions.get(edge.target);
          if (!source || !target) return null;
          const labelX = (source.x + target.x) / 2;
          const labelY = (source.y + target.y) / 2;
          return (
            <g key={`${edge.source}-${edge.target}-${index}`}>
              <line
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                markerEnd="url(#graph-arrow)"
              />
              <text x={labelX} y={labelY - 4} className="graph-edge-label">
                {edge.label}
              </text>
            </g>
          );
        })}
        {nodes.map((node) => {
          const position = positions.get(node.id);
          if (!position) return null;
          const isCenter = node.id === center?.id;
          return (
            <g key={node.id} className={isCenter ? "graph-node-center" : "graph-node"}>
              <circle cx={position.x} cy={position.y} r={isCenter ? 42 : 34} />
              <text x={position.x} y={position.y + 4}>
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="knowledge-edge-list">
        {graph.edges.map((edge, index) => (
          <li key={`${edge.source}-${edge.target}-desc-${index}`}>
            <strong>{edge.label}</strong>
            {edge.description}
          </li>
        ))}
      </ul>
    </div>
  );
}
