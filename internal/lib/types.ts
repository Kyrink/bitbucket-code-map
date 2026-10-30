export interface SourceFile {
  path: string;
  content: string;
}
export interface SymbolInfo {
  id: string;
  name: string;
  kind: string;
  line: number;
  endLine: number;
  exported: boolean;
}
export interface ImportInfo {
  specifier: string;
  line: number;
  names: string[];
  target?: string;
  relationship?: string;
  confidence?: 'resolved' | 'candidate';
}
export interface CallInfo {
  caller: string;
  callee: string;
  line: number;
  target?: string;
  confidence: 'resolved' | 'candidate';
}
export interface AnalyzedFile {
  path: string;
  language: string;
  lines: number;
  bytes: number;
  symbols: SymbolInfo[];
  imports: ImportInfo[];
  calls: CallInfo[];
  source: string;
  parser: 'ast' | 'heuristic' | 'text';
}
export interface GraphNode {
  id: string;
  label: string;
  path?: string;
  kind: 'file' | 'external' | 'symbol' | 'group';
  detail: string;
  line?: number;
}
export interface GraphEdge {
  from: string;
  to: string;
  label: string;
  path: string;
  line: number;
  confidence: 'resolved' | 'candidate';
}
export interface CodeMap {
  name: string;
  origin: 'bitbucket' | 'upload' | 'demo';
  repositoryUrl?: string;
  revision?: string;
  files: AnalyzedFile[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  warnings: string[];
  skipped: number;
  createdAt: string;
}
export interface IngestResult {
  files: SourceFile[];
  skipped: number;
  warnings: string[];
}
