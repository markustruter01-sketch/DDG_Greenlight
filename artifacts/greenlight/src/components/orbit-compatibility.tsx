import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { AssessmentRun } from '@workspace/api-client-react';
import { layout, linkedIds } from '../orbit/model.js';
import { orbitItems, orbitThemes } from '@/lib/greenlight';

const colors: Record<string, string> = {
  C: '#4FD99A', L: '#4FD99A', P: '#FFA62B', N: '#FF5C6E', UN: '#CFE3EE', NA: '#6e8490',
};

/** SVG fallback for browsers where WebGL is unavailable; it uses the same requirement layout. */
export function OrbitCompatibility({
  run, statuses, onPick, angle, setAngle, zoom, setZoom, focusKey, emphasis, layers, onDragStart, onDragEnd, onWheel,
}: {
  run: AssessmentRun;
  statuses: Record<string, string>;
  onPick: (key: string | null) => void;
  angle: number;
  setAngle: Dispatch<SetStateAction<number>>;
  zoom: number;
  setZoom: Dispatch<SetStateAction<number>>;
  focusKey: string | null;
  emphasis: string | null;
  layers: Record<string, boolean>;
  onDragStart: () => void;
  onDragEnd: () => void;
  onWheel: () => void;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const { nodes } = useMemo(() => layout(orbitItems(run, statuses)), [run, statuses]);
  const byKey = useMemo(() => new Map(run.findings.map((f) => [f.key, f])), [run.findings]);
  const nodeByKey = useMemo(() => new Map((nodes as any[]).map((node) => [node.id, node])), [nodes]);
  const themes = useMemo(() => orbitThemes(run), [run]);
  const links = useMemo(() => {
    const edges: Array<[string, string]> = [];
    const seen = new Set<string>();
    for (const node of nodes as any[]) {
      for (const other of linkedIds(themes, node.id)) {
        if (node.id === other) continue;
        const key = [node.id, other].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push([node.id, other]);
      }
    }
    return edges;
  }, [nodes, themes]);
  const rawProject = (v: number[]) => {
    const x = v[0] * Math.cos(angle) - v[2] * Math.sin(angle);
    const z = v[0] * Math.sin(angle) + v[2] * Math.cos(angle);
    return [300 + x * 26, 220 + (z * 0.42 - v[1] * 0.92) * 26];
  };
  const focusNode = focusKey ? nodes.find((node: any) => node.id === focusKey) : undefined;
  const rawFocus = focusNode ? rawProject(focusNode.position) : [300, 220];
  const project = (v: number[]) => {
    const [x, y] = rawProject(v);
    return [
      300 + (x - 300) * zoom - (rawFocus[0] - 300) * zoom,
      220 + (y - 220) * zoom - (rawFocus[1] - 220) * zoom,
    ];
  };
  const finding = run.findings.find((f) => f.key === hover);
  const visibleOpacity = (node: any, status: string) => {
    const layer = node.blocking && (status === 'N' || status === 'P') ? 'mustfix'
      : ['C', 'L'].includes(status) ? 'passing' : 'gaps';
    if (!layers[layer]) return 0.04;
    if (emphasis && node.ring !== emphasis && layer !== emphasis) return 0.2;
    return status === 'NA' ? 0.2 : status === 'C' || status === 'L' ? 0.6 : 1;
  };
  return (
    <div className="relative h-full min-h-0 w-full" data-testid="orbit-compatibility">
      <svg viewBox="0 0 600 440" className="h-full w-full touch-none" role="img" aria-label="Assessment orbit compatibility view. Drag to rotate. Select a requirement for evidence."
        onPointerDown={(e) => { setDrag(e.clientX); onDragStart(); e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerUp={() => { setDrag(null); onDragEnd(); }} onPointerCancel={() => { setDrag(null); onDragEnd(); }}
        onPointerMove={(e) => { if (drag !== null) { setAngle((a) => a + (e.clientX - drag) * 0.008); setDrag(e.clientX); } }}
        onWheel={(e) => { onWheel(); setZoom((z) => Math.max(0.6, Math.min(1.2, z - e.deltaY * 0.0006))); }}>
        <defs>
          <radialGradient id="planet-glass"><stop stopColor="#7CC9E8" stopOpacity=".07" /><stop offset=".85" stopColor="#00E5FF" stopOpacity=".07" /><stop offset="1" stopColor="#7CC9E8" stopOpacity=".28" /></radialGradient>
        </defs>
        {[{ radius: 3.73, base: 0, color: '#7CC9E8', key: 'saf' }, { radius: 6.53, base: -0.4, color: '#00E5FF', key: 'sec' }, { radius: 9.2, base: -0.8, color: '#F7FBFF', key: 'ai' }].map((ring) => (
          <polyline key={ring.radius} points={Array.from({ length: 97 }, (_, i) => project([Math.cos(i / 96 * Math.PI * 2) * ring.radius, ring.base, Math.sin(i / 96 * Math.PI * 2) * ring.radius]).join(',')).join(' ')}
            fill="none" stroke={ring.color} strokeOpacity={emphasis === ring.key ? '.95' : emphasis ? '.08' : '.5'} strokeWidth={emphasis === ring.key ? '1.5' : '.8'} />
        ))}
        <circle cx={project([0, 0, 0])[0]} cy={project([0, 0, 0])[1]} r={38 * zoom} fill="url(#planet-glass)" stroke="#7CC9E8" strokeOpacity=".55" />
        {[0.25, 0.55, 0.8].map((n) => <ellipse key={n} cx={project([0, 0, 0])[0]} cy={project([0, 0, 0])[1]} rx={38 * n * zoom} ry={38 * zoom} fill="none" stroke="#7CC9E8" strokeOpacity=".3" transform={`rotate(${angle * 30} ${project([0, 0, 0])[0]} ${project([0, 0, 0])[1]})`} />)}
        {[-.6, -.3, 0, .3, .6].map((n) => <ellipse key={n} cx={project([0, 0, 0])[0]} cy={project([0, 0, 0])[1] + n * 34 * zoom} rx={Math.sqrt(1 - n * n) * 38 * zoom} ry={8 * zoom} fill="none" stroke="#7CC9E8" strokeOpacity=".3" />)}
        {layers.links && links.map(([a, b]) => {
          const first = nodeByKey.get(a) as any;
          const second = nodeByKey.get(b) as any;
          if (!first || !second) return null;
          const from = project(first.position), to = project(second.position);
          const highlighted = [hover, focusKey].some((key) => key && (key === a || key === b));
          return <line key={`${a}-${b}`} x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} stroke={highlighted ? '#00E5FF' : '#7CC9E8'} strokeWidth={highlighted ? '1.2' : '.7'} strokeOpacity={highlighted ? '.9' : '.03'} />;
        })}
        {nodes.map((node: any) => {
          const f = byKey.get(node.id);
          const status = statuses[node.id] || f?.status || 'UN';
          const color = colors[status] || colors.UN;
          const position = project(node.position), base = project(node.base);
          const blocking = node.blocking && (status === 'N' || status === 'P');
          const opacity = visibleOpacity(node, status);
          return <g key={node.id} tabIndex={0} role="button" aria-label={`${f?.id}: ${f?.title}. ${status}`}
            onClick={(e) => { e.stopPropagation(); onPick(node.id); }} onKeyDown={(e) => { if (e.key === 'Enter') onPick(node.id); }}
            onPointerEnter={() => setHover(node.id)} onPointerLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
            <title>{f?.id}: {f?.title} · {f?.statusText}</title>
            {blocking && <line x1={base[0]} y1={base[1]} x2={position[0]} y2={position[1]} stroke={color} strokeWidth="1" strokeOpacity=".8" />}
            <circle cx={position[0]} cy={position[1]} r={hover === node.id ? 5 : blocking ? 2.8 : 1.7}
              fill={color} opacity={opacity} />
          </g>;
        })}
      </svg>
      <div className="lbl absolute bottom-3 left-4 !text-[#CFE3EE]">Compatibility view · WebGL unavailable · Drag to rotate · Select a dot</div>
      {finding && <div className="glass pointer-events-none absolute left-4 top-12 max-w-xs p-3 text-xs"><span className="lbl text-[#00E5FF]">{finding.id}</span><p>{finding.title}</p></div>}
    </div>
  );
}
