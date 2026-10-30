'use client';
import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, Maximize, LoaderCircle, AlertCircle } from 'lucide-react';
import type { GraphConnection, GraphView } from '@/lib/graph';
import { zoomAt } from '@/lib/viewport';
import { sanitizeMermaidSourceForRender } from '@/lib/mermaid-security';
let renderQueue = Promise.resolve();
let renderId = 0;
export default function Diagram({
  chart,
  graph,
  onSelect,
  onEdgeSelect,
  onSvg,
}: {
  chart: string;
  graph: GraphView;
  onSelect: (id: string) => void;
  onEdgeSelect: (edge: GraphConnection) => void;
  onSvg: (svg: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onSelect, onEdgeSelect, onSvg });
  callbacks.current = { onSelect, onEdgeSelect, onSvg };
  const [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const drag = useRef<{
    x: number;
    y: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    callbacks.current.onSvg('');
    renderQueue = renderQueue
      .catch(() => {})
      .then(async () => {
        if (cancelled) return;
        try {
          const [{ default: mermaid }, { default: DOMPurify }] = await Promise.all([
            import('mermaid'),
            import('dompurify'),
          ]);
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            suppressErrorRendering: true,
            htmlLabels: false,
            theme: 'base',
            look: 'classic',
            fontFamily: 'Arial, sans-serif',
            flowchart: {
              htmlLabels: false,
              curve: 'basis',
              nodeSpacing: 28,
              rankSpacing: 55,
              padding: 15,
              wrappingWidth: 260,
            },
            themeVariables: {
              fontSize: '13px',
              lineColor: '#000',
              textColor: '#000',
              edgeLabelBackground: '#fff',
              primaryColor: '#fff',
              primaryTextColor: '#000',
              primaryBorderColor: '#000',
            },
          });
          const { svg } = await mermaid.render(
            `code-map-${++renderId}`,
            sanitizeMermaidSourceForRender(chart),
          );
          if (cancelled || !host.current) return;
          const safe = DOMPurify.sanitize(svg, {
            USE_PROFILES: { svg: true, svgFilters: true },
            FORBID_TAGS: ['script', 'foreignObject', 'a', 'image'],
          });
          host.current.innerHTML = safe;
          callbacks.current.onSvg(safe);
          host.current.querySelectorAll<SVGGElement>('g.node').forEach((node) => {
            const index = Number(node.id.match(/flowchart-n(\d+)-/)?.[1]);
            const item = graph.nodes[index];
            if (!item) return;
            node.setAttribute('tabindex', '0');
            node.setAttribute('role', 'button');
            node.setAttribute('aria-label', `Inspect ${item.label}`);
            node.style.cursor = 'pointer';
            const select = () => {
              if (!drag.current?.moved) callbacks.current.onSelect(item.id);
            };
            node.addEventListener('click', select);
            node.addEventListener('keydown', (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                callbacks.current.onSelect(item.id);
              }
            });
          });
          host.current.querySelectorAll<SVGPathElement>('path.flowchart-link').forEach((path) => {
            const match = path.id.match(/L_n(\d+)_n(\d+)_/);
            if (!match) return;
            const from = graph.nodes[Number(match[1])],
              to = graph.nodes[Number(match[2])];
            const edge = graph.edges.find((e) => e.from === from?.id && e.to === to?.id);
            if (!edge) return;
            const namespace = 'http://www.w3.org/2000/svg';
            const hit = document.createElementNS(namespace, 'g');
            hit.setAttribute('class', 'edge-hit');
            hit.setAttribute('tabindex', '0');
            hit.setAttribute('role', 'button');
            hit.setAttribute(
              'aria-label',
              `Open connection ${from.label} to ${to.label} at line ${edge.line}, ${edge.references.length} references`,
            );
            const stroke = document.createElementNS(namespace, 'path');
            stroke.setAttribute('d', path.getAttribute('d') ?? '');
            stroke.setAttribute('fill', 'none');
            stroke.setAttribute('stroke', 'transparent');
            stroke.setAttribute('stroke-width', '16');
            // A nonzero midpoint target makes straight edges focusable across browsers.
            const middle = path.getPointAtLength(path.getTotalLength() / 2);
            const target = document.createElementNS(namespace, 'circle');
            target.setAttribute('cx', String(middle.x));
            target.setAttribute('cy', String(middle.y));
            target.setAttribute('r', '8');
            target.setAttribute('fill', 'transparent');
            hit.append(stroke, target);
            hit.addEventListener('click', () => callbacks.current.onEdgeSelect(edge));
            hit.addEventListener('keydown', (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                callbacks.current.onEdgeSelect(edge);
              }
            });
            path.after(hit);
          });
          setView({ x: 0, y: 0, scale: 1 });
        } catch {
          if (!cancelled)
            setError(
              'The diagram could not be rendered. File details and exports are still available.',
            );
        } finally {
          if (!cancelled) setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [chart, graph]);
  const zoom = (factor: number) => setView((v) => zoomAt(v, factor));
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = element.getBoundingClientRect();
      const delta =
        event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
      setView((v) =>
        zoomAt(
          v,
          Math.exp(-Math.max(-300, Math.min(300, delta)) * 0.003),
          event.clientX - bounds.left - bounds.width / 2,
          event.clientY - bounds.top - bounds.height / 2,
        ),
      );
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  return (
    <div className="diagram-wrap">
      <div
        ref={canvas}
        className="diagram-canvas"
        aria-label="Code relationship map"
        role="region"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === '+' || e.key === '=') zoom(1.2);
          if (e.key === '-') zoom(1 / 1.2);
          if (e.key === '0') setView({ x: 0, y: 0, scale: 1 });
        }}
        onPointerDown={(e) => {
          if (e.button !== 0 || (e.target as Element).closest('g.node, .edge-hit')) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            originX: view.x,
            originY: view.y,
            moved: false,
          };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) d.moved = true;
          setView((v) => ({
            ...v,
            x: d.originX + e.clientX - d.x,
            y: d.originY + e.clientY - d.y,
          }));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <div
          className="diagram-transform"
          style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})` }}
        >
          <div ref={host} className="svg-host" />
        </div>
      </div>
      {loading && (
        <div className="canvas-message">
          <LoaderCircle className="spin" size={19} /> Arranging your map…
        </div>
      )}
      {error && (
        <div className="canvas-message error">
          <AlertCircle size={18} />
          {error}
        </div>
      )}
      {!graph.nodes.length && !loading && (
        <div className="canvas-message">
          No relationships in this view. Select another file or include unresolved calls.
        </div>
      )}
      <div className="zoom-controls">
        <button aria-label="Zoom out" onClick={() => zoom(1 / 1.2)}>
          <Minus size={16} />
        </button>
        <span>{Math.round(view.scale * 100)}%</span>
        <button aria-label="Zoom in" onClick={() => zoom(1.2)}>
          <Plus size={16} />
        </button>
        <i />
        <button aria-label="Fit diagram" onClick={() => setView({ x: 0, y: 0, scale: 1 })}>
          <Maximize size={16} />
        </button>
      </div>
      <div className="map-legend">
        <span>A → B: A uses B</span>
        <span>
          <i className="solid-line" />
          Has located reference
        </span>
        <span>
          <i className="dash-line" />
          Candidate / external
        </span>
      </div>
    </div>
  );
}
