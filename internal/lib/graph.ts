import type { CodeMap, GraphEdge, GraphNode } from './types';
export type ViewMode = 'modules' | 'files' | 'flow';
export type Direction = 'both' | 'outgoing' | 'incoming';
export interface GraphConnection extends GraphEdge {
  references: GraphEdge[];
}
export interface GraphView {
  nodes: GraphNode[];
  edges: GraphConnection[];
  hidden: number;
}
const folder = (value: string) => {
  const parts = value.split('/');
  return parts.length === 1
    ? '(root)'
    : parts.slice(0, parts[0] === 'src' && parts.length > 2 ? 2 : 1).join('/');
};
function neighborhood(
  seeds: Iterable<string>,
  edges: GraphEdge[],
  depth: number,
  direction: Direction,
) {
  const keep = new Set(seeds);
  for (let i = 0; i < depth; i++) {
    const next = new Set(keep);
    for (const edge of edges) {
      if (direction !== 'incoming' && keep.has(edge.from)) next.add(edge.to);
      if (direction !== 'outgoing' && keep.has(edge.to)) next.add(edge.from);
    }
    for (const id of next) keep.add(id);
  }
  return keep;
}
export function groupConnections(edges: (GraphEdge | GraphConnection)[]): GraphConnection[] {
  const unique = new Map<string, GraphConnection>();
  for (const edge of edges) {
    const key = `${edge.from}\0${edge.to}`;
    const references = 'references' in edge ? edge.references : [edge];
    const existing = unique.get(key);
    if (existing) {
      existing.references.push(...references);
      if (edge.confidence === 'resolved') existing.confidence = 'resolved';
      existing.label = [...new Set(existing.references.map((r) => r.label))].join(', ');
    } else unique.set(key, { ...edge, references: [...references] });
  }
  return [...unique.values()];
}
export function callGraph(map: CodeMap, external = true) {
  const symbols = new Map<string, GraphNode>();
  for (const file of map.files) {
    symbols.set(`${file.path}#module`, {
      id: `${file.path}#module`,
      label: `${file.path.split('/').pop()} (top level)`,
      path: file.path,
      kind: 'symbol',
      detail: 'Top-level code',
      line: 1,
    });
    for (const symbol of file.symbols)
      symbols.set(symbol.id, {
        id: symbol.id,
        label: symbol.name,
        path: file.path,
        kind: 'symbol',
        detail: symbol.kind,
        line: symbol.line,
      });
  }
  const edges: GraphEdge[] = [];
  for (const file of map.files)
    for (const call of file.calls) {
      if (!call.target && !external) continue;
      const target = call.target ?? `external:${call.callee}`;
      if (!symbols.has(target))
        symbols.set(target, {
          id: target,
          label: call.callee,
          kind: 'external',
          detail: 'Source unavailable',
        });
      edges.push({
        from: call.caller,
        to: target,
        label: 'calls',
        path: file.path,
        line: call.line,
        confidence: call.confidence,
      });
    }
  return { nodes: [...symbols.values()], edges };
}
export function startingPoints(map: CodeMap) {
  const calls = callGraph(map);
  const incoming = new Set(calls.edges.filter((e) => e.from !== e.to).map((e) => e.to));
  const outgoing = new Map<string, number>();
  for (const edge of calls.edges) outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1);
  const roots = calls.nodes
    .filter(
      (n) =>
        n.path &&
        outgoing.has(n.id) &&
        !incoming.has(n.id) &&
        n.detail !== 'class' &&
        n.detail !== 'constructor',
    )
    .sort(
      (a, b) => (outgoing.get(b.id) ?? 0) - (outgoing.get(a.id) ?? 0) || a.id.localeCompare(b.id),
    );
  const seen = new Set<string>();
  const points = roots
    .filter((n) => {
      if (seen.has(n.path!)) return false;
      seen.add(n.path!);
      return true;
    })
    .slice(0, 8)
    .map((node) => ({
      ...node,
      reason: `${outgoing.get(node.id)} call site${outgoing.get(node.id) === 1 ? '' : 's'} · no callers found`,
    }));
  const readme = map.files.find((f) => /^readme(?:\.[^/]+)?$/i.test(f.path));
  if (readme)
    points.unshift({
      id: readme.path,
      path: readme.path,
      label: readme.path,
      kind: 'file',
      detail: 'Documentation',
      line: 1,
      reason: 'Project documentation',
    });
  return points;
}
export function selectGraph(
  map: CodeMap,
  mode: ViewMode,
  selected: string,
  external: boolean,
  depth: number,
  focus = '',
  directory = '',
  direction: Direction = 'both',
): GraphView {
  let nodes = map.nodes.filter((n) => external || n.kind !== 'external');
  let edges = map.edges;
  if (mode === 'modules') {
    const groups = new Map<string, GraphNode>();
    const key = (id: string) => (id.startsWith('external:') ? id : folder(id));
    for (const node of nodes) {
      const id = key(node.id);
      if (!groups.has(id))
        groups.set(id, {
          id,
          label: node.kind === 'external' ? node.label : id,
          kind: node.kind === 'external' ? 'external' : 'group',
          detail:
            node.kind === 'external'
              ? node.detail
              : `${map.files.filter((f) => folder(f.path) === id).length} files`,
        });
    }
    nodes = [...groups.values()];
    edges = edges
      .map((e) => ({ ...e, from: key(e.from), to: key(e.to), references: [e] }))
      .filter((e) => e.from !== e.to);
  } else if (mode === 'flow') {
    const file = map.files.find((f) => f.path === selected) ?? map.files[0];
    if (!file) return { nodes: [], edges: [], hidden: 0 };
    const calls = callGraph(map, external);
    edges = calls.edges;
    const seeds =
      focus && depth > 0
        ? [focus]
        : calls.nodes.filter((n) => n.path === file.path).map((n) => n.id);
    const keep = neighborhood(seeds, edges, depth || 1, direction);
    nodes = calls.nodes.filter((n) => keep.has(n.id));
  } else if (directory) {
    const seeds = nodes.filter((n) => n.path && folder(n.path) === directory).map((n) => n.id);
    const keep = neighborhood(seeds, edges, depth, direction);
    nodes = nodes.filter((n) => keep.has(n.id));
  } else if ((focus || selected) && depth > 0) {
    const keep = neighborhood([focus || selected], edges, depth, direction);
    nodes = nodes.filter((n) => keep.has(n.id));
  }
  const count = nodes.length;
  if (nodes.length > 70) {
    const degree = new Map<string, number>();
    for (const e of edges)
      for (const id of [e.from, e.to]) degree.set(id, (degree.get(id) ?? 0) + 1);
    const anchor = focus || selected;
    nodes = [...nodes]
      .sort((a, b) =>
        a.id === anchor
          ? -1
          : b.id === anchor
            ? 1
            : (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0),
      )
      .slice(0, 70);
  }
  const visible = new Set(nodes.map((n) => n.id));
  return {
    nodes,
    edges: groupConnections(edges.filter((e) => visible.has(e.from) && visible.has(e.to))),
    hidden: count - nodes.length,
  };
}
function escapeLabel(value: string) {
  // Labels are quoted Mermaid text. Typographic replacements keep them readable
  // without allowing quotes, directives, HTML, or entity sequences to escape it.
  const replacements: Record<string, string> = {
    '"': '”',
    '<': '‹',
    '>': '›',
    '&': '＆',
    '#': '＃',
    '`': '’',
    '\\': '/',
  };
  return value
    .slice(0, 110)
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/["<>&#`\\]/g, (c) => replacements[c]);
}
export function toMermaid(graph: GraphView, selected = ''): string {
  const ids = new Map(graph.nodes.map((n, i) => [n.id, `n${i}`]));
  const lines = ['flowchart LR'];
  for (const node of graph.nodes)
    lines.push(
      `${ids.get(node.id)}["${escapeLabel(node.label)}"]:::${node.id === selected ? 'selected' : node.kind === 'external' ? 'external' : node.kind === 'group' ? 'group' : 'file'}`,
    );
  for (const edge of graph.edges)
    lines.push(
      `${ids.get(edge.from)} ${edge.confidence === 'resolved' ? '-->' : '-.->'}|"${escapeLabel(edge.label)}${edge.references.length > 1 ? ` · ${edge.references.length}` : ''}"| ${ids.get(edge.to)}`,
    );
  lines.push(
    'classDef file fill:#fff,stroke:#000,color:#000,rx:7,ry:7',
    'classDef group fill:#fff,stroke:#000,stroke-width:2px,color:#000,rx:7,ry:7',
    'classDef selected fill:#000,stroke:#000,stroke-width:2px,color:#fff,rx:7,ry:7',
    'classDef external fill:#fff,stroke:#000,stroke-dasharray:4 3,color:#000,rx:7,ry:7',
  );
  return lines.join('\n');
}
