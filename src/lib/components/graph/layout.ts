import dagre from '@dagrejs/dagre';
import { Position, type Node, type Edge } from '@xyflow/svelte';

const NODE_W = 220;
const NODE_H = 80;

export type GraphDirection = 'TB' | 'LR' | 'BT' | 'RL';
export type LayoutKind = 'dagre-TB' | 'dagre-LR' | 'radial';

export interface LayoutOpts {
  kind?: LayoutKind;
  focalId?: string; // required for radial
}

export function dagreLayout<T extends Node>(
  nodes: T[],
  edges: Edge[],
  direction: GraphDirection = 'TB',
): T[] {
  const isHorizontal = direction === 'LR' || direction === 'RL';
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: direction,
    nodesep: isHorizontal ? 20 : 30, // tighter for high-fan-out ranks
    ranksep: isHorizontal ? 110 : 90,
    marginx: 20,
    marginy: 20,
    ranker: 'tight-tree',
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of edges) g.setEdge(e.source, e.target);

  dagre.layout(g);

  const targetPos = isHorizontal ? Position.Left : Position.Top;
  const sourcePos = isHorizontal ? Position.Right : Position.Bottom;

  return nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
      targetPosition: targetPos,
      sourcePosition: sourcePos,
    };
  });
}

// Radial layout: focal in center, ancestors left arc, descendants right arc.
// Each BFS-distance ring gets its own angular wedge; better than dagre for 1-2 hop GO graphs.
export function radialLayout<T extends Node>(nodes: T[], edges: Edge[], focalId: string): T[] {
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const n of nodes) {
    incoming.set(n.id, []);
    outgoing.set(n.id, []);
  }
  for (const e of edges) {
    outgoing.get(e.source)?.push(e.target);
    incoming.get(e.target)?.push(e.source);
  }

  // BFS for ancestor and descendant distances from focal.
  function bfs(start: string, neighbours: (id: string) => string[]): Map<string, number> {
    const dist = new Map<string, number>();
    dist.set(start, 0);
    const queue: string[] = [start];
    while (queue.length) {
      const cur = queue.shift()!;
      const d = dist.get(cur)!;
      for (const nb of neighbours(cur)) {
        if (dist.has(nb)) continue;
        dist.set(nb, d + 1);
        queue.push(nb);
      }
    }
    return dist;
  }

  const upDist = bfs(focalId, (id) => incoming.get(id) ?? []);
  const downDist = bfs(focalId, (id) => outgoing.get(id) ?? []);

  // Assign each node to a side (up/down) and ring (BFS distance).
  type Bucket = { side: 'up' | 'down' | 'focal'; ring: number };
  const bucketFor = (id: string): Bucket => {
    if (id === focalId) return { side: 'focal', ring: 0 };
    const u = upDist.get(id);
    const d = downDist.get(id);
    if (u !== undefined && (d === undefined || u <= d)) return { side: 'up', ring: u };
    if (d !== undefined) return { side: 'down', ring: d };
    // Disconnected node: park as far descendant.
    return { side: 'down', ring: 1 };
  };

  const upRings = new Map<number, string[]>();
  const downRings = new Map<number, string[]>();
  for (const n of nodes) {
    if (n.id === focalId) continue;
    const b = bucketFor(n.id);
    const target = b.side === 'up' ? upRings : downRings;
    const arr = target.get(b.ring) ?? [];
    arr.push(n.id);
    target.set(b.ring, arr);
  }

  const positions = new Map<string, { x: number; y: number }>();
  positions.set(focalId, { x: 0, y: 0 });

  // Radius per ring: ensures arc length per node >= NODE_H + ARC_PAD.
  // r >= (NODE_H + ARC_PAD) * (count-1) / spread, also monotonically increasing.
  const ARC_PAD = 30; // vertical breathing room between adjacent nodes
  const BASE_RADIUS = 260;
  const RING_GAP = 220;

  const layHalfArc = (rings: Map<number, string[]>, side: 'up' | 'down') => {
    const centerAngle = side === 'up' ? Math.PI : 0;
    const sortedRings = [...rings.keys()].sort((a, b) => a - b);
    let prevOuterRadius = 0;
    for (const ring of sortedRings) {
      const ids = rings.get(ring)!;
      const count = ids.length;
      // Wider spread for crowded rings, narrower for sparse ones.
      const spread = Math.min(Math.PI * 0.95, Math.max(Math.PI / 6, count * 0.22));
      const perNode = NODE_H + ARC_PAD;
      const slots = Math.max(1, count - 1);
      const reqRadius = (perNode * slots) / spread;
      // Keep rings monotonically increasing to prevent outer-ring collisions.
      const r = Math.max(
        BASE_RADIUS + (ring - 1) * RING_GAP,
        reqRadius,
        prevOuterRadius + NODE_W * 0.8,
      );
      prevOuterRadius = r;

      const startAngle = centerAngle - spread / 2;
      const step = count === 1 ? 0 : spread / (count - 1);
      for (let i = 0; i < count; i++) {
        const angle = count === 1 ? centerAngle : startAngle + i * step;
        positions.set(ids[i], {
          x: r * Math.cos(angle),
          y: -r * Math.sin(angle), // negated: SVG y grows downward
        });
      }
    }
  };

  layHalfArc(upRings, 'up');
  layHalfArc(downRings, 'down');

  return nodes.map((n) => {
    const p = positions.get(n.id) ?? { x: 0, y: 0 };
    return {
      ...n,
      position: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 },
      targetPosition: Position.Left,
      sourcePosition: Position.Right,
    };
  });
}

export function applyLayout<T extends Node>(nodes: T[], edges: Edge[], opts: LayoutOpts = {}): T[] {
  const kind = opts.kind ?? 'dagre-TB';
  if (kind === 'dagre-LR') return dagreLayout(nodes, edges, 'LR');
  if (kind === 'radial') {
    if (!opts.focalId) return dagreLayout(nodes, edges, 'TB');
    return radialLayout(nodes, edges, opts.focalId);
  }
  return dagreLayout(nodes, edges, 'TB');
}
