import { useMemo } from "react";

interface Node {
  id: string;
  label: string;
  type: 'target' | 'caller' | 'dependency';
}

interface Edge {
  source: string;
  target: string;
}

export function DependencyGraph({ capsule }: { capsule: any }) {
  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    // Target Node
    nodes.push({ id: 'target', label: capsule.target, type: 'target' });

    // Callers (left)
    if (capsule.callersInfo) {
      capsule.callersInfo.forEach((c: any, i: number) => {
        const id = `caller_${i}`;
        nodes.push({ id, label: c.name, type: 'caller' });
        edges.push({ source: id, target: 'target' });
      });
    }

    // Dependencies (right)
    if (capsule.dependenciesInfo) {
      capsule.dependenciesInfo.forEach((d: any, i: number) => {
        const id = `dep_${i}`;
        nodes.push({ id, label: d.name, type: 'dependency' });
        edges.push({ source: 'target', target: id });
      });
    }

    return { nodes, edges };
  }, [capsule]);

  const centerX = 300;
  const centerY = 150;
  
  const callers = nodes.filter(n => n.type === 'caller');
  const deps = nodes.filter(n => n.type === 'dependency');

  const getNodePos = (node: Node) => {
    if (node.type === 'target') return { x: centerX, y: centerY };
    
    if (node.type === 'caller') {
      const idx = callers.indexOf(node);
      const spacing = 40;
      const startY = centerY - ((callers.length - 1) * spacing) / 2;
      return { x: 100, y: startY + idx * spacing };
    }

    if (node.type === 'dependency') {
      const idx = deps.indexOf(node);
      const spacing = 40;
      const startY = centerY - ((deps.length - 1) * spacing) / 2;
      return { x: 500, y: startY + idx * spacing };
    }

    return { x: 0, y: 0 };
  };

  const svgHeight = Math.max(300, (Math.max(callers.length, deps.length) * 40) + 100);

  return (
    <div className="w-full bg-slate-900 border border-slate-800 rounded-lg p-4 overflow-x-auto">
      <svg width={600} height={svgHeight} className="min-w-[600px] mx-auto">
        {/* Draw Edges */}
        {edges.map((e, i) => {
          const sourceNode = nodes.find(n => n.id === e.source);
          const targetNode = nodes.find(n => n.id === e.target);
          if (!sourceNode || !targetNode) return null;
          
          const sPos = getNodePos(sourceNode);
          const tPos = getNodePos(targetNode);
          
          return (
            <path
              key={i}
              d={`M ${sPos.x} ${sPos.y} C ${(sPos.x + tPos.x)/2} ${sPos.y}, ${(sPos.x + tPos.x)/2} ${tPos.y}, ${tPos.x} ${tPos.y}`}
              fill="none"
              stroke="#334155"
              strokeWidth="2"
            />
          );
        })}

        {/* Draw Nodes */}
        {nodes.map(node => {
          const pos = getNodePos(node);
          const isTarget = node.type === 'target';
          const fill = isTarget ? '#2563eb' : node.type === 'caller' ? '#0f172a' : '#1e293b';
          const stroke = isTarget ? '#3b82f6' : node.type === 'caller' ? '#334155' : '#475569';
          
          return (
            <g key={node.id} transform={`translate(${pos.x}, ${pos.y})`}>
              <rect
                x={-60}
                y={-15}
                width={120}
                height={30}
                rx={6}
                fill={fill}
                stroke={stroke}
                strokeWidth="1.5"
                className="transition-colors hover:stroke-slate-300"
              />
              <text
                textAnchor="middle"
                dominantBaseline="middle"
                fill={isTarget ? '#ffffff' : '#94a3b8'}
                fontSize="10"
                fontFamily="monospace"
                className="pointer-events-none"
              >
                {node.label.length > 20 ? node.label.substring(0, 18) + '...' : node.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function BlastRadiusTree({ results }: { results: { target: string; dependents: { name: string; kind: string; path: string }[] } }) {
  const { target, dependents } = results;

  const nodeWidth = 140;
  const nodeHeight = 36;
  const verticalSpacing = 60;
  const horizontalSpacing = 160;

  const rootX = 300;
  const rootY = 40;

  const svgHeight = Math.max(300, (dependents.length * verticalSpacing) + 100);
  const startY = rootY + 100;

  return (
    <div className="w-full bg-slate-900 border border-slate-800 rounded-lg p-4 overflow-x-auto">
      <div className="mb-4 text-slate-300 font-medium text-sm flex items-center justify-between">
        <span>Impact Analysis: {target}</span>
        <span className="text-rose-400 bg-rose-400/10 px-2 py-1 rounded-md text-xs">
          {dependents.length} Impacted Locations
        </span>
      </div>
      <svg width={600} height={svgHeight} className="min-w-[600px] mx-auto">
        {/* Draw Edges */}
        {dependents.map((dep, i) => {
          const targetX = rootX;
          const targetY = startY + i * verticalSpacing;

          return (
            <path
              key={`edge-${i}`}
              d={`M ${rootX} ${rootY + nodeHeight / 2} C ${rootX} ${rootY + 50}, ${targetX} ${targetY - 30}, ${targetX} ${targetY - nodeHeight / 2}`}
              fill="none"
              stroke="#64748b"
              strokeWidth="2"
              strokeDasharray="4 2"
            />
          );
        })}

        {/* Draw Root Node */}
        <g transform={`translate(${rootX}, ${rootY})`}>
          <rect
            x={-nodeWidth / 2}
            y={-nodeHeight / 2}
            width={nodeWidth}
            height={nodeHeight}
            rx={8}
            fill="#1e1b4b"
            stroke="#6366f1"
            strokeWidth="2"
          />
          <text
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#a5b4fc"
            fontSize="12"
            fontFamily="monospace"
            className="pointer-events-none"
          >
            {target.length > 20 ? target.substring(0, 18) + '...' : target}
          </text>
        </g>

        {/* Draw Dependent Nodes */}
        {dependents.map((dep, i) => {
          const x = rootX;
          const y = startY + i * verticalSpacing;

          return (
            <g key={`node-${i}`} transform={`translate(${x}, ${y})`}>
              <rect
                x={-nodeWidth / 2}
                y={-nodeHeight / 2}
                width={nodeWidth}
                height={nodeHeight}
                rx={6}
                fill="#2a0a18"
                stroke="#f43f5e"
                strokeWidth="1.5"
                className="transition-colors hover:stroke-rose-300"
              />
              <text
                y="-4"
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#fda4af"
                fontSize="11"
                fontFamily="monospace"
                className="pointer-events-none"
              >
                {dep.name.length > 22 ? dep.name.substring(0, 20) + '...' : dep.name}
              </text>
              <text
                y="10"
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#881337"
                fontSize="9"
                fontFamily="sans-serif"
                className="pointer-events-none uppercase tracking-wider"
              >
                {dep.kind}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

