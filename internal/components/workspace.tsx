'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  ArrowLeft,
  Maximize2,
  Minimize2,
  Files,
  FolderOpen,
  GitBranch,
  Layers,
  LoaderCircle,
  LockKeyhole,
  Network,
  Plus,
  Search,
  Upload,
  X,
  AlertTriangle,
  Workflow,
} from 'lucide-react';
import type { AnalyzedFile, CodeMap, GraphNode } from '@/lib/types';
import {
  callGraph,
  groupConnections,
  selectGraph,
  startingPoints,
  toMermaid,
  type Direction,
  type GraphConnection,
  type ViewMode,
} from '@/lib/graph';
import Diagram from './diagram';

const fileName = (path: string) => path.split('/').pop() ?? path;
function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function Workspace() {
  const [map, setMap] = useState<CodeMap | null>(null),
    [selected, setSelected] = useState(''),
    [mode, setMode] = useState<ViewMode>('modules');
  const [query, setQuery] = useState(''),
    [external, setExternal] = useState(false),
    [depth, setDepth] = useState(0);
  const [focus, setFocus] = useState(''),
    [directory, setDirectory] = useState('');
  const [direction, setDirection] = useState<Direction>('both');
  const [connection, setConnection] = useState<GraphConnection | null>(null);
  const [referenceIndex, setReferenceIndex] = useState(0);
  const [sourceOpen, setSourceOpen] = useState(false),
    [expanded, setExpanded] = useState(false);
  const explorer = useRef<HTMLDivElement>(null);
  const [history, setHistory] = useState<
    Array<{
      selected: string;
      mode: ViewMode;
      depth: number;
      focus: string;
      directory: string;
      line: number;
      query: string;
      direction: Direction;
      connection: GraphConnection | null;
      referenceIndex: number;
    }>
  >([]);
  const [modal, setModal] = useState(false),
    [sourceTab, setSourceTab] = useState<'bitbucket' | 'upload'>('bitbucket');
  const [repository, setRepository] = useState(''),
    [ref, setRef] = useState(''),
    [email, setEmail] = useState(''),
    [token, setToken] = useState('');
  const [accessKey, setAccessKey] = useState(''),
    [config, setConfig] = useState<{
      authRequired: boolean;
      configured: boolean;
      productionNeedsKey: boolean;
    } | null>(null);
  const [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [svg, setSvg] = useState(''),
    [exportMenu, setExportMenu] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<'details' | 'source'>('details'),
    [sourceLine, setSourceLine] = useState(1),
    [notice, setNotice] = useState('');
  const abort = useRef<AbortController | null>(null),
    fileInput = useRef<HTMLInputElement>(null),
    folderInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => setError('Could not reach the server. Reload to retry.'));
    return () => abort.current?.abort();
  }, []);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, select, summary, a[href]',
        ) ?? [],
      ).filter((el) => el.getClientRects().length);
    focusable()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setModal(false);
      }
      if (event.key !== 'Tab') return;
      const items = focusable(),
        first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      previous?.focus();
    };
  }, [modal]);
  useEffect(() => {
    if (inspectorTab !== 'source' || !sourceOpen) return;
    const panel = explorer.current?.querySelector<HTMLElement>('.inspector-content');
    const line = panel?.querySelector<HTMLElement>('.highlight-line');
    if (panel && line)
      panel.scrollTop +=
        line.getBoundingClientRect().top -
        panel.getBoundingClientRect().top -
        panel.clientHeight / 3;
  }, [inspectorTab, sourceLine, selected, sourceOpen]);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const exit = () => {
      if (!document.fullscreenElement) setExpanded(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
        setExpanded(false);
      }
    };
    document.addEventListener('fullscreenchange', exit);
    document.addEventListener('keydown', escape);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('fullscreenchange', exit);
      document.removeEventListener('keydown', escape);
    };
  }, [expanded]);
  async function toggleFullscreen() {
    if (expanded) {
      if (document.fullscreenElement) await document.exitFullscreen();
      setExpanded(false);
    } else {
      setExpanded(true);
      // Embedded browsers may deny native fullscreen; the expanded workspace still fills the tab.
      try {
        await explorer.current?.requestFullscreen?.();
      } catch {
        /* Keep the expanded view. */
      }
    }
  }
  const files = useMemo(
    () =>
      map?.files.filter(
        (f) =>
          f.path.toLowerCase().includes(query.toLowerCase()) ||
          f.symbols.some((s) => s.name.toLowerCase().includes(query.toLowerCase())),
      ) ?? [],
    [map, query],
  );
  const file = map?.files.find((f) => f.path === selected);
  const calls = useMemo(() => (map ? callGraph(map) : { nodes: [], edges: [] }), [map]);
  const starts = useMemo(() => (map ? startingPoints(map) : []), [map]);
  const describeNode = (id: string) =>
    calls.nodes.find((n) => n.id === id) ?? map?.nodes.find((n) => n.id === id);
  const reference = connection?.references[referenceIndex];
  const connectionTarget = reference ? describeNode(reference.to) : undefined;
  const graph = useMemo(
    () =>
      map ? selectGraph(map, mode, selected, external, depth, focus, directory, direction) : null,
    [map, mode, selected, external, depth, focus, directory, direction],
  );
  const chart = useMemo(
    () => (graph ? toMermaid(graph, focus || selected) : ''),
    [graph, focus, selected],
  );
  const remember = () =>
    setHistory((items) => [
      ...items.slice(-29),
      {
        selected,
        mode,
        depth,
        focus,
        directory,
        line: sourceLine,
        query,
        direction,
        connection,
        referenceIndex,
      },
    ]);
  const back = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setSelected(previous.selected);
    setMode(previous.mode);
    setDepth(previous.depth);
    setFocus(previous.focus);
    setDirectory(previous.directory);
    setSourceLine(previous.line);
    setQuery(previous.query);
    setDirection(previous.direction);
    setConnection(previous.connection);
    setReferenceIndex(previous.referenceIndex);
    setSourceOpen(!!previous.selected);
    setInspectorTab('source');
    setHistory((items) => items.slice(0, -1));
  };
  const selectFile = (path: string, line = 1, symbol = '') => {
    remember();
    setConnection(null);
    setSelected(path);
    setSourceLine(line);
    setInspectorTab('source');
    setSourceOpen(true);
    setDirectory('');
    setDepth(1);
    setFocus(symbol || (mode === 'flow' ? '' : path));
    if (symbol) setMode('flow');
    else if (mode === 'modules') setMode('files');
  };
  const inspectNode = (id: string) => {
    const node = graph?.nodes.find((n) => n.id === id);
    if (node?.path) selectFile(node.path, node.line, node.kind === 'symbol' ? node.id : '');
    else if (node?.kind === 'group') {
      remember();
      setDirectory(node.id);
      setQuery(node.id === '(root)' ? '' : node.id + '/');
      setMode('files');
      setSelected('');
      setFocus('');
      setDepth(0);
      setSourceOpen(false);
      setConnection(null);
    } else if (node) setNotice(`${node.label}: source is not included in this project.`);
  };
  const inspectEdge = (edge: GraphConnection) => {
    remember();
    setConnection(edge);
    setReferenceIndex(0);
    setSelected(edge.path);
    setSourceLine(edge.line);
    setInspectorTab('source');
    setSourceOpen(true);
    setDirectory('');
    const isCall = calls.nodes.some((n) => n.id === edge.from);
    const nextMode = isCall ? 'flow' : 'files';
    if (mode !== nextMode || !focus || depth === 0) {
      setFocus(isCall ? edge.from : edge.path);
      setDepth(1);
    }
    setMode(nextMode);
  };
  const changeMode = (next: ViewMode) => {
    remember();
    setMode(next);
    setDirectory('');
    setFocus('');
    setDepth(0);
    setQuery('');
    setConnection(null);
    setDirection('both');
    if (next === 'flow' && !selected) {
      const first = map?.files.find((f) => f.symbols.length) ?? map?.files[0];
      if (first) {
        setSelected(first.path);
        setSourceLine(1);
        setInspectorTab('source');
        setSourceOpen(true);
      }
    }
  };
  const resetFocus = () => {
    remember();
    setFocus('');
    setDirectory('');
    setDepth(0);
    setQuery('');
    setDirection('both');
    setConnection(null);
  };
  async function run(kind: 'demo' | 'bitbucket' | 'upload', uploaded?: File[]) {
    setError('');
    setNotice('');
    setBusy(
      kind === 'bitbucket'
        ? 'Reading Bitbucket source and mapping connections…'
        : 'Parsing source and mapping connections…',
    );
    abort.current = new AbortController();
    try {
      const headers: Record<string, string> = accessKey ? { 'x-internal-token': accessKey } : {};
      let body: BodyInit | undefined;
      if (kind === 'bitbucket') {
        headers['content-type'] = 'application/json';
        body = JSON.stringify({ repository, ref, email, token });
      }
      if (kind === 'upload') {
        const form = new FormData();
        for (const f of uploaded ?? []) form.append('files', f, f.webkitRelativePath || f.name);
        body = form;
      }
      const response = await fetch(kind === 'demo' ? '/api/demo' : '/api/analyze', {
        method: kind === 'demo' ? 'GET' : 'POST',
        headers,
        body,
        signal: abort.current.signal,
      });
      if (!response.headers.get('content-type')?.includes('application/json'))
        throw new Error('The analyzer is unavailable. Check the server and try again.');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Analysis failed. Try again.');
      const result = data as CodeMap;
      setMap(result);
      setSelected('');
      setQuery('');
      setMode('modules');
      setDepth(0);
      setFocus('');
      setDirectory('');
      setDirection('both');
      setConnection(null);
      setHistory([]);
      setSourceOpen(false);
      setModal(false);
      setToken('');
      setSvg('');
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') setError(err.message);
    } finally {
      setBusy('');
      abort.current = null;
      if (fileInput.current) fileInput.current.value = '';
      if (folderInput.current) folderInput.current.value = '';
    }
  }
  const upload = (items: FileList | null) => {
    if (items?.length) void run('upload', Array.from(items));
  };
  const exportMap = (format: string) => {
    if (!map) return;
    const name = map.name.replace(/[^a-z0-9_-]+/gi, '-');
    if (format === 'svg') download(name + '.svg', svg, 'image/svg+xml');
    if (format === 'mermaid') download(name + '.mmd', chart, 'text/plain');
    if (format === 'json')
      download(
        name + '.json',
        JSON.stringify({ ...map, files: map.files.map(({ source: _source, ...f }) => f) }, null, 2),
        'application/json',
      );
    setExportMenu(false);
  };
  const sourceForm = (
    <>
      <div className="source-tabs">
        <button
          className={sourceTab === 'bitbucket' ? 'active' : ''}
          onClick={() => setSourceTab('bitbucket')}
        >
          <GitBranch size={16} /> Bitbucket repository
        </button>
        <button
          className={sourceTab === 'upload' ? 'active' : ''}
          onClick={() => setSourceTab('upload')}
        >
          <Upload size={16} /> Upload source
        </button>
      </div>
      {config?.authRequired && (
        <label className="field">
          Workspace access key
          <input
            type="password"
            autoComplete="off"
            value={accessKey}
            onChange={(e) => setAccessKey(e.target.value)}
            placeholder="Provided by your administrator"
          />
        </label>
      )}
      {config?.productionNeedsKey && (
        <p className="error-banner">
          An administrator must configure the workspace access key before this deployment can
          analyze code.
        </p>
      )}
      {sourceTab === 'bitbucket' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run('bitbucket');
          }}
        >
          <label className="field">
            Repository URL
            <input
              required
              value={repository}
              onChange={(e) => setRepository(e.target.value)}
              placeholder="https://bitbucket.org/your-team/your-repo"
            />
          </label>
          <label className="field">
            Branch, tag, or commit <span>Optional</span>
            <input
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder="Default branch"
            />
          </label>
          <details className="credentials">
            <summary>
              <LockKeyhole size={14} />{' '}
              {config?.configured
                ? 'Server connection ready · use different credentials'
                : 'Private repository access'}
              <ChevronDown size={14} />
            </summary>
            <p>
              Use an API token with repository read permission. Credentials are sent to this server
              for this request and kept out of browser storage.
            </p>
            <label className="field">
              Atlassian email <span>For API tokens</span>
              <input
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </label>
            <label className="field">
              API token or repository access token
              <input
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste a read-only token"
              />
            </label>
            <p>For a repository access token, leave the email blank.</p>
          </details>
          <button
            className="primary full-width"
            disabled={!!busy || !!config?.productionNeedsKey}
            type="submit"
          >
            {busy ? <LoaderCircle size={17} className="spin" /> : <Network size={17} />} Map
            repository <ArrowRight size={16} />
          </button>
        </form>
      ) : (
        <div
          className="upload-panel"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (!busy) upload(e.dataTransfer.files);
          }}
        >
          <div className="upload-icon">
            <Upload size={24} />
          </div>
          <h3>Drop your code here</h3>
          <p>
            Source files or a ZIP project, up to 25 MB.
            <br />
            Upload the project for a more complete map.
          </p>
          <button className="primary" disabled={!!busy} onClick={() => fileInput.current?.click()}>
            Choose files <Plus size={15} />
          </button>
          <button
            className="text-button"
            disabled={!!busy}
            onClick={() => folderInput.current?.click()}
          >
            <FolderOpen size={14} /> Or choose a folder
          </button>
          <div className="file-formats">C# / .NET · Python · PowerBuilder · JS / TS</div>
        </div>
      )}
    </>
  );
  return (
    <div className="workspace">
      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        multiple
        onChange={(e) => upload(e.target.files)}
      />
      <input
        ref={folderInput}
        className="visually-hidden"
        type="file"
        multiple
        {...{ webkitdirectory: '' }}
        onChange={(e) => upload(e.target.files)}
      />
      {map && (
        <aside className="sidebar" aria-label="Source files">
          <div className="nav-heading files-heading">
            SOURCE FILES <span>{map.files.length}</span>
          </div>
          <label className="file-search">
            <Search size={14} />
            <input
              aria-label="Search files or symbols"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a file or symbol…"
            />
            {query && (
              <button aria-label="Clear search" onClick={() => setQuery('')}>
                <X size={12} />
              </button>
            )}
          </label>
          <div className="file-list">
            {files.map((f) => (
              <button
                key={f.path}
                className={`file-item ${selected === f.path ? 'active' : ''}`}
                onClick={() => {
                  const match =
                    query && !f.path.toLowerCase().includes(query.toLowerCase())
                      ? f.symbols.find((s) => s.name.toLowerCase().includes(query.toLowerCase()))
                      : undefined;
                  selectFile(f.path, match?.line, match?.id);
                }}
                title={f.path}
              >
                <span className="file-badge">
                  {f.language === 'C#'
                    ? 'C#'
                    : f.language === 'Python'
                      ? 'py'
                      : f.language === 'PowerBuilder'
                        ? 'PB'
                        : f.path.split('.').pop()?.slice(0, 3)}
                </span>
                <span>
                  {fileName(f.path)}
                  <small>
                    {query && !f.path.toLowerCase().includes(query.toLowerCase())
                      ? f.symbols
                          .filter((s) => s.name.toLowerCase().includes(query.toLowerCase()))
                          .map((s) => s.name)
                          .join(', ')
                      : f.path.includes('/')
                        ? f.path.slice(0, f.path.lastIndexOf('/'))
                        : 'root'}
                  </small>
                </span>
              </button>
            ))}
            {!files.length && <p className="empty-search">No matching files.</p>}
          </div>
        </aside>
      )}
      <main className="main">
        {error && (
          <div className="error-banner" role="alert">
            <AlertTriangle size={16} />
            <span>{error}</span>
            <button aria-label="Dismiss error" onClick={() => setError('')}>
              <X size={15} />
            </button>
          </div>
        )}
        {notice && (
          <div className="notice-banner" role="status">
            {notice}
            <button aria-label="Dismiss notice" onClick={() => setNotice('')}>
              <X size={15} />
            </button>
          </div>
        )}
        {busy && (
          <div className="busy-banner" role="status">
            <LoaderCircle size={17} className="spin" />
            <span>{busy}</span>
            <button onClick={() => abort.current?.abort()}>Cancel</button>
          </div>
        )}
        {!map ? (
          <section className="welcome">
            <h1>Open source</h1>
            <div className="source-card">{sourceForm}</div>
            <button className="text-button" disabled={!!busy} onClick={() => void run('demo')}>
              Open sample project
            </button>
          </section>
        ) : (
          <>
            <section className="map-header">
              <div>
                <h1>{map.name}</h1>
                {map.revision && (
                  <small title={map.revision}>Commit {map.revision.slice(0, 8)}</small>
                )}
              </div>
              <div className="header-actions">
                <button className="secondary" onClick={() => setModal(true)}>
                  <Plus size={15} /> New map
                </button>
                <div className="export-wrap">
                  <button className="secondary" onClick={() => setExportMenu((v) => !v)}>
                    <ArrowDownToLine size={15} /> Export <ChevronDown size={13} />
                  </button>
                  {exportMenu && (
                    <div className="export-menu">
                      <button disabled={!svg} onClick={() => exportMap('svg')}>
                        Diagram as SVG
                      </button>
                      <button onClick={() => exportMap('mermaid')}>Mermaid source</button>
                      <button onClick={() => exportMap('json')}>Graph JSON (no source text)</button>
                    </div>
                  )}
                </div>
              </div>
            </section>
            <label className="mobile-file-select">
              Inspect a file
              <select
                value={selected}
                onChange={(e) => {
                  selectFile(e.target.value);
                  if (mode === 'modules') setMode('files');
                }}
              >
                <option value="">Choose source file…</option>
                {map.files.map((f) => (
                  <option key={f.path} value={f.path}>
                    {f.path}
                  </option>
                ))}
              </select>
            </label>
            <div
              ref={explorer}
              className={`explorer ${sourceOpen && file ? 'with-source' : ''} ${expanded ? 'expanded' : ''}`}
            >
              <section className="map-pane">
                <div className="map-toolbar">
                  <div className="view-tabs">
                    <button
                      className={mode === 'modules' ? 'active' : ''}
                      onClick={() => changeMode('modules')}
                    >
                      <Layers size={15} /> Modules
                    </button>
                    <button
                      className={mode === 'files' ? 'active' : ''}
                      onClick={() => changeMode('files')}
                    >
                      <Files size={15} /> Files
                    </button>
                    <button
                      className={mode === 'flow' ? 'active' : ''}
                      onClick={() => changeMode('flow')}
                    >
                      <Workflow size={15} /> Call flow
                    </button>
                  </div>
                  <div className="toolbar-actions">
                    {!!starts.length && (
                      <select
                        className="starting-points"
                        aria-label="Starting points"
                        title="Suggested reading: documentation and functions with calls but no callers found in this source set. Runtime callers may be missing."
                        value=""
                        onChange={(e) => {
                          const point = starts.find((p) => p.id === e.target.value);
                          if (point?.path) {
                            setDirection('both');
                            selectFile(
                              point.path,
                              point.line,
                              point.kind === 'symbol' ? point.id : '',
                            );
                          }
                        }}
                      >
                        <option value="" disabled>
                          Start at…
                        </option>
                        {starts.map((point) => (
                          <option key={point.id} value={point.id}>
                            {point.label} · {point.path} · {point.reason}
                          </option>
                        ))}
                      </select>
                    )}
                    <label className="toggle-label">
                      <input
                        type="checkbox"
                        checked={external}
                        onChange={(e) => setExternal(e.target.checked)}
                      />{' '}
                      External / unresolved
                    </label>
                    <button
                      className="icon-button"
                      title={expanded ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
                      aria-label={expanded ? 'Exit fullscreen' : 'Fullscreen'}
                      onClick={() => void toggleFullscreen()}
                    >
                      {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                    </button>
                  </div>
                </div>
                <div className="map-subbar">
                  <button
                    className="icon-button"
                    aria-label="Back to previous view"
                    title="Back"
                    disabled={!history.length}
                    onClick={back}
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <span className="focus-label">
                    {directory ||
                      (focus
                        ? graph?.nodes.find((n) => n.id === focus)?.label || fileName(selected)
                        : mode === 'flow'
                          ? fileName(selected)
                          : 'All ' + mode)}
                  </span>
                  {(focus || directory) && (
                    <button className="text-button" onClick={resetFocus}>
                      Reset focus
                    </button>
                  )}
                  {mode !== 'modules' && (focus || selected || directory) && (
                    <label>
                      Follow
                      <select
                        aria-label="Connection direction"
                        value={direction}
                        onChange={(e) => {
                          remember();
                          setDirection(e.target.value as Direction);
                          if (depth === 0 && mode !== 'flow') setDepth(1);
                        }}
                      >
                        <option value="both">Both ways</option>
                        <option value="outgoing">{mode === 'flow' ? 'Calls →' : 'Uses →'}</option>
                        <option value="incoming">
                          {mode === 'flow' ? '← Called by' : '← Used by'}
                        </option>
                      </select>
                    </label>
                  )}
                  {mode !== 'modules' && (focus || selected || directory) && (
                    <label>
                      Depth
                      <select
                        aria-label="Connection depth"
                        value={depth}
                        onChange={(e) => {
                          remember();
                          setDepth(Number(e.target.value));
                          if (e.target.value === '0') setDirection('both');
                        }}
                      >
                        <option value={0}>
                          {mode === 'flow' ? 'File calls' : directory ? 'Folder only' : 'All files'}
                        </option>
                        <option value={1}>1 connection</option>
                        <option value={2}>2 connections</option>
                        <option value={3}>3 connections</option>
                      </select>
                    </label>
                  )}
                  {mode === 'files' && file && (
                    <button className="text-button" onClick={() => changeMode('flow')}>
                      Dive into calls <ArrowRight size={14} />
                    </button>
                  )}
                  {file && !sourceOpen && (
                    <button className="text-button" onClick={() => setSourceOpen(true)}>
                      Open source
                    </button>
                  )}
                </div>
                {graph && (
                  <Diagram
                    chart={chart}
                    graph={graph}
                    onSelect={inspectNode}
                    onEdgeSelect={inspectEdge}
                    onSvg={setSvg}
                  />
                )}
                <div className="map-footer">
                  <span>
                    {graph?.nodes.length} nodes · {graph?.edges.length} connections
                    {graph?.hidden
                      ? ` · ${graph.hidden} nodes hidden — use search and focus to explore`
                      : ''}
                  </span>
                  <span>Scroll to zoom · Drag to pan</span>
                </div>
              </section>
              {sourceOpen && file && (
                <aside className="inspector" aria-label="Source inspector">
                  <>
                    <div className="inspector-title">
                      <span className="file-badge">
                        {file.language === 'PowerBuilder'
                          ? 'PB'
                          : file.language === 'C#'
                            ? 'C#'
                            : file.path.split('.').pop()}
                      </span>
                      <div>
                        <h2>{fileName(file.path)}</h2>
                        <small>
                          {file.language} · {file.lines} lines
                        </small>
                      </div>
                      <button aria-label="Close source" onClick={() => setSourceOpen(false)}>
                        <X size={15} />
                      </button>
                    </div>
                    {connection && reference && (
                      <div className="connection-context">
                        <strong>
                          {describeNode(reference.from)?.label ?? reference.from} →{' '}
                          {describeNode(reference.to)?.label ?? reference.to}
                        </strong>
                        <label>
                          Reference ({connection.references.length})
                          <select
                            aria-label="Connection source reference"
                            value={referenceIndex}
                            onChange={(e) => {
                              const reference = connection.references[Number(e.target.value)];
                              setReferenceIndex(Number(e.target.value));
                              setSelected(reference.path);
                              setSourceLine(reference.line);
                              setInspectorTab('source');
                            }}
                          >
                            {connection.references.map((r, i) => (
                              <option key={i} value={i}>
                                {r.path}:{r.line} · {r.label} · {r.confidence}
                              </option>
                            ))}
                          </select>
                        </label>
                        {connectionTarget?.path ? (
                          <button
                            className="text-button"
                            onClick={() =>
                              selectFile(
                                connectionTarget.path!,
                                connectionTarget.line,
                                connectionTarget.kind === 'symbol' ? connectionTarget.id : '',
                              )
                            }
                          >
                            Open target{' '}
                            {connectionTarget.kind === 'symbol' ? 'definition' : 'source'}{' '}
                            <ArrowUpRight size={12} />
                          </button>
                        ) : (
                          <small>Target source is not included.</small>
                        )}
                        <button
                          className="icon-button"
                          aria-label="Dismiss connection details"
                          onClick={() => setConnection(null)}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    )}
                    <div className="inspector-tabs">
                      <button
                        className={inspectorTab === 'details' ? 'active' : ''}
                        onClick={() => setInspectorTab('details')}
                      >
                        Connections
                      </button>
                      <button
                        className={inspectorTab === 'source' ? 'active' : ''}
                        onClick={() => setInspectorTab('source')}
                      >
                        Source code
                      </button>
                    </div>
                    <div className="inspector-content">
                      {inspectorTab === 'source' ? (
                        <>
                          <p className="source-path">{file.path}</p>
                          <pre className="source-code">
                            {file.source.split('\n').map((line, i) => (
                              <div key={i} className={i + 1 === sourceLine ? 'highlight-line' : ''}>
                                <span>{i + 1}</span>
                                <code>{line || ' '}</code>
                              </div>
                            ))}
                          </pre>
                        </>
                      ) : (
                        <FileDetails
                          file={file}
                          map={map}
                          mode={mode}
                          focus={focus}
                          calls={calls}
                          onSelect={selectFile}
                          onEdge={inspectEdge}
                          onFlow={() => changeMode('flow')}
                        />
                      )}
                    </div>
                  </>
                </aside>
              )}
            </div>
            {!!map.warnings.length && (
              <details className="coverage-notes">
                <summary>Analysis warnings ({map.warnings.length})</summary>
                <ul>
                  {map.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </main>
      {modal && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setModal(false);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-map-title"
          >
            <div className="modal-heading">
              <div>
                <h2 id="new-map-title">Create a code map</h2>
                <p>Connect a repository or bring your source.</p>
              </div>
              <button aria-label="Close dialog" onClick={() => setModal(false)}>
                <X size={19} />
              </button>
            </div>
            {error && (
              <p className="error-banner" role="alert">
                {error}
              </p>
            )}
            {sourceForm}
            {busy && (
              <p className="modal-status">
                <LoaderCircle className="spin" size={15} />
                {busy}
                <button onClick={() => abort.current?.abort()}>Cancel</button>
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function FileDetails({
  file,
  map,
  mode,
  focus,
  calls,
  onSelect,
  onEdge,
  onFlow,
}: {
  file: AnalyzedFile;
  map: CodeMap;
  mode: ViewMode;
  focus: string;
  calls: ReturnType<typeof callGraph>;
  onSelect: (path: string, line?: number, symbol?: string) => void;
  onEdge: (edge: GraphConnection) => void;
  onFlow: () => void;
}) {
  const symbol =
    mode === 'flow' ? calls.nodes.find((n) => n.id === focus && n.path === file.path) : undefined;
  const nodes = mode === 'flow' ? calls.nodes : map.nodes;
  const edges = mode === 'flow' ? calls.edges : map.edges;
  const scope = new Set(
    symbol
      ? [symbol.id]
      : mode === 'flow'
        ? calls.nodes.filter((n) => n.path === file.path).map((n) => n.id)
        : [file.path],
  );
  const outgoing = groupConnections(edges.filter((e) => scope.has(e.from)));
  const incoming = groupConnections(edges.filter((e) => scope.has(e.to)));
  const reversePairs = new Set(edges.map((e) => `${e.to}\0${e.from}`));
  return (
    <>
      {symbol ? (
        <p className="focus-description">
          <strong>{symbol.label}</strong>
          <small>
            {symbol.detail} · {file.path}:{symbol.line}
          </small>
        </p>
      ) : (
        <button className="flow-button" onClick={onFlow}>
          <Workflow size={15} /> Explore file calls <ArrowRight size={14} />
        </button>
      )}
      {map.repositoryUrl && (
        <a
          className="text-link"
          target="_blank"
          rel="noopener noreferrer"
          href={`${map.repositoryUrl}/src/${map.revision}/${file.path.split('/').map(encodeURIComponent).join('/')}`}
        >
          Open in Bitbucket <ArrowUpRight size={13} />
        </a>
      )}
      <ConnectionList
        title={mode === 'flow' ? 'CALLS →' : 'USES →'}
        items={outgoing}
        nodes={nodes}
        reversePairs={reversePairs}
        onEdge={onEdge}
      />
      <ConnectionList
        title={mode === 'flow' ? '← CALLED BY' : '← USED BY'}
        items={incoming}
        nodes={nodes}
        reversePairs={reversePairs}
        incoming
        onEdge={onEdge}
      />
      <p className="empty-detail">
        Static references in the loaded source. Runtime dispatch and missing files can leave
        connections undetected.
      </p>
      <h3 className="detail-heading">
        SYMBOLS <span>{file.symbols.length}</span>
      </h3>
      {file.symbols.map((s) => (
        <button className="symbol-row" key={s.id} onClick={() => onSelect(file.path, s.line, s.id)}>
          <span className="symbol-kind">
            {s.kind === 'class' ? 'C' : s.kind === 'event' ? 'E' : 'ƒ'}
          </span>
          <span>
            {s.name}
            <small>
              {s.kind}
              {s.exported ? ' · exported' : ''}
            </small>
          </span>
          <span className="line-link">L{s.line}</span>
        </button>
      ))}
      {!file.symbols.length && (
        <p className="empty-detail">No function, method, or event definitions detected.</p>
      )}
    </>
  );
}

function ConnectionList({
  title,
  items,
  nodes,
  reversePairs,
  incoming = false,
  onEdge,
}: {
  title: string;
  items: GraphConnection[];
  nodes: GraphNode[];
  reversePairs: Set<string>;
  incoming?: boolean;
  onEdge: (edge: GraphConnection) => void;
}) {
  return (
    <>
      <h3 className="detail-heading">
        {title} <span>{items.length}</span>
      </h3>
      {items.map((edge) => {
        const target = nodes.find((n) => n.id === (incoming ? edge.from : edge.to));
        return (
          <button
            className="connection-row"
            key={`${edge.from}→${edge.to}`}
            onClick={() => onEdge(edge)}
          >
            <ArrowRight size={13} />
            <span>
              {target?.label ?? (incoming ? edge.from : edge.to)}
              <small>
                {target?.path ?? 'External / unresolved'}
                {reversePairs.has(`${edge.from}\0${edge.to}`) ? ' · reciprocal connection' : ''}
              </small>
              <small>
                {edge.label} · {edge.references.length} reference
                {edge.references.length === 1 ? '' : 's'} ·{' '}
                {edge.references.every((r) => r.confidence === 'resolved')
                  ? 'located'
                  : 'includes candidates'}
              </small>
            </span>
            <ArrowUpRight size={12} />
          </button>
        );
      })}
      {!items.length && (
        <p className="empty-detail">
          {incoming
            ? 'No incoming references found in the loaded source.'
            : 'No outgoing references found in the loaded source.'}
        </p>
      )}
    </>
  );
}
