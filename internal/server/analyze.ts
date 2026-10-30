import ts from 'typescript';
import { enrichNativeFiles } from './native-analysis';
import path from 'node:path';
import type { AnalyzedFile, CodeMap, SourceFile, SymbolInfo } from '../lib/types';
import { InputError, LIMITS } from './limits';

const extensions: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript',
  mts: 'TypeScript',
  cts: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  py: 'Python',
  java: 'Java',
  kt: 'Kotlin',
  cs: 'C#',
  go: 'Go',
  rs: 'Rust',
  rb: 'Ruby',
  php: 'PHP',
  vue: 'Vue',
  svelte: 'Svelte',
  c: 'C',
  cpp: 'C++',
  h: 'C/C++',
  hpp: 'C++',
  swift: 'Swift',
  scala: 'Scala',
  sql: 'SQL',
  json: 'JSON',
  yml: 'YAML',
  yaml: 'YAML',
  toml: 'TOML',
  md: 'Markdown',
  css: 'CSS',
  scss: 'SCSS',
  html: 'HTML',
  csproj: '.NET project',
  sln: '.NET solution',
  props: 'MSBuild',
  targets: 'MSBuild',
  sru: 'PowerBuilder',
  srw: 'PowerBuilder',
  srd: 'PowerBuilder',
  srm: 'PowerBuilder',
  srf: 'PowerBuilder',
  srs: 'PowerBuilder',
  sra: 'PowerBuilder',
  srj: 'PowerBuilder',
  pbt: 'PowerBuilder',
  pbg: 'PowerBuilder',
  pbs: 'PowerBuilder',
};
const jsFile = /\.(?:[cm]?[jt]sx?)$/i;
const join = (...parts: string[]) =>
  path.posix
    .normalize(path.posix.join(...parts))
    .replace(/^\.\//, '')
    .replace(/^\//, '');
const language = (p: string) => extensions[(p.split('.').pop() ?? '').toLowerCase()] ?? 'Text';
export async function analyze(
  files: SourceFile[],
  metadata: Pick<CodeMap, 'name' | 'origin'> &
    Partial<Pick<CodeMap, 'repositoryUrl' | 'revision' | 'warnings' | 'skipped'>>,
): Promise<CodeMap> {
  if (!files.length)
    throw new InputError('No supported source files found. Upload source code or a project ZIP.');
  files = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const sources = new Map(files.map((f) => [f.path, f.content]));
  const warnings = [...(metadata.warnings ?? [])];
  const resolveFile = (candidate: string): string | undefined => {
    const clean = join(candidate);
    const variants = [
      clean,
      clean.replace(/\.[cm]?jsx?$/, ''),
      ...['/index', '/__init__'].map((s) => clean + s),
    ];
    for (const v of variants)
      for (const ext of [
        '',
        '.ts',
        '.tsx',
        '.js',
        '.jsx',
        '.mjs',
        '.cjs',
        '.mts',
        '.cts',
        '.py',
        '.java',
        '.kt',
        '.cs',
        '.go',
        '.rs',
        '.rb',
        '.php',
        '.vue',
        '.svelte',
      ])
        if (sources.has(v + ext)) return v + ext;
  };
  const configs = files
    .filter((f) => /(^|\/)tsconfig(?:\.[^/]+)?\.json$/.test(f.path))
    .map((f) => ({
      directory: path.posix.dirname(f.path),
      config: ts.parseConfigFileTextToJson(f.path, f.content).config?.compilerOptions ?? {},
    }));
  const packages = files
    .filter((f) => /(^|\/)package\.json$/.test(f.path))
    .flatMap((f) => {
      try {
        const data = JSON.parse(f.content);
        return typeof data.name === 'string'
          ? [
              {
                name: data.name as string,
                directory: path.posix.dirname(f.path),
                entry: data.source || data.module || data.main || 'src/index',
              },
            ]
          : [];
      } catch {
        return [];
      }
    });
  const resolveImport = (from: string, specifier: string): string | undefined => {
    const dir = path.posix.dirname(from);
    if (specifier.startsWith('.')) {
      if (from.endsWith('.py')) {
        const dots = specifier.match(/^\.+/)?.[0].length ?? 1;
        return resolveFile(
          join(
            dir,
            ...Array(Math.max(0, dots - 1)).fill('..'),
            specifier.slice(dots).replaceAll('.', '/'),
          ),
        );
      }
      return resolveFile(join(dir, specifier));
    }
    for (const { directory, config } of configs
      .filter((c) => c.directory === '.' || from.startsWith(c.directory + '/'))
      .sort((a, b) => b.directory.length - a.directory.length)) {
      for (const [pattern, targets] of Object.entries(config.paths ?? {})) {
        if (!Array.isArray(targets)) continue;
        const [prefix, suffix = ''] = pattern.split('*');
        const matches = pattern.includes('*')
          ? specifier.startsWith(prefix) && specifier.endsWith(suffix)
          : pattern === specifier;
        if (!matches) continue;
        const middle = pattern.includes('*')
          ? specifier.slice(prefix.length, suffix ? -suffix.length : undefined)
          : '';
        for (const target of targets)
          if (typeof target === 'string') {
            const result = resolveFile(
              join(directory, config.baseUrl ?? '.', target.replace('*', middle)),
            );
            if (result) return result;
          }
      }
      if (typeof config.baseUrl === 'string') {
        const result = resolveFile(join(directory, config.baseUrl, specifier));
        if (result) return result;
      }
    }
    for (const pkg of packages) {
      if (specifier === pkg.name) {
        const result = resolveFile(join(pkg.directory, String(pkg.entry)));
        if (result) return result;
      }
      if (specifier.startsWith(pkg.name + '/')) {
        const suffix = specifier.slice(pkg.name.length + 1);
        const result =
          resolveFile(join(pkg.directory, suffix)) ??
          resolveFile(join(pkg.directory, 'src', suffix));
        if (result) return result;
      }
    }
    if (/^[@~]\//.test(specifier))
      return resolveFile('src/' + specifier.slice(2)) ?? resolveFile(specifier.slice(2));
    if (from.endsWith('.py'))
      return (
        resolveFile(specifier.replaceAll('.', '/')) ??
        resolveFile(join('src', specifier.replaceAll('.', '/')))
      );
    if (/\.(java|kt|cs)$/.test(from)) {
      const suffix = specifier.replaceAll('.', '/');
      return files.find(
        (f) =>
          f.path.replace(/\.(java|kt|cs)$/, '').endsWith('/' + suffix) ||
          f.path.replace(/\.(java|kt|cs)$/, '') === suffix,
      )?.path;
    }
    return undefined;
  };
  const jsPaths = files.filter((f) => jsFile.test(f.path)).map((f) => '/' + f.path);
  const options: ts.CompilerOptions = {
    allowJs: true,
    checkJs: true,
    noLib: true,
    noEmit: true,
    target: ts.ScriptTarget.Latest,
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
  };
  const host = ts.createCompilerHost(options);
  host.getCurrentDirectory = () => '/';
  host.fileExists = (name) => sources.has(join(name));
  host.readFile = (name) => sources.get(join(name));
  host.getSourceFile = (name, target) => {
    const content = sources.get(join(name));
    return content === undefined ? undefined : ts.createSourceFile(name, content, target, true);
  };
  host.resolveModuleNames = (names, containingFile) =>
    names.map((name) => {
      const resolved = resolveImport(join(containingFile), name);
      return resolved && jsFile.test(resolved)
        ? { resolvedFileName: '/' + resolved, isExternalLibraryImport: false }
        : undefined;
    });
  const program = ts.createProgram(jsPaths, options, host);
  const checker = program.getTypeChecker();
  const declarations = new Map<ts.Node, SymbolInfo>();
  const results: AnalyzedFile[] = files.map((f) => ({
    path: f.path,
    source: f.content,
    language: language(f.path),
    bytes: Buffer.byteLength(f.content),
    lines: f.content.split('\n').length,
    symbols: [],
    imports: [],
    calls: [],
    parser: jsFile.test(f.path) ? 'ast' : 'text',
  }));
  for (const file of results.filter((f) => jsFile.test(f.path))) {
    const source = program.getSourceFile('/' + file.path)!;
    const line = (node: ts.Node) =>
      source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const visit = (node: ts.Node, parentName = '') => {
      let scope = parentName;
      let name: string | undefined,
        kind = 'function';
      if (ts.isClassDeclaration(node) && node.name) {
        name = node.name.text;
        kind = 'class';
      } else if (
        (ts.isFunctionDeclaration(node) ||
          ts.isMethodDeclaration(node) ||
          ts.isGetAccessor(node) ||
          ts.isSetAccessor(node)) &&
        node.name
      )
        name = node.name.getText(source);
      else if (
        (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
        ts.isVariableDeclaration(node.parent)
      )
        name = node.parent.name.getText(source);
      else if (ts.isConstructorDeclaration(node)) name = 'constructor';
      if (name && file.symbols.length < LIMITS.symbols) {
        scope = parentName ? `${parentName}.${name}` : name;
        const symbol: SymbolInfo = {
          id: `${file.path}#${line(node)}:${scope}`,
          name: scope,
          kind,
          line: line(node),
          endLine: source.getLineAndCharacterOfPosition(node.end).line + 1,
          exported:
            /\bexport\b/.test(node.getFullText(source).slice(0, 100)) ||
            (!!node.parent && /\bexport\b/.test(node.parent.getFullText(source).slice(0, 60))),
        };
        file.symbols.push(symbol);
        declarations.set(node, symbol);
      }
      ts.forEachChild(node, (child) => visit(child, scope));
    };
    visit(source);
    const diagnostics =
      (source as ts.SourceFile & { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
    if (diagnostics.length)
      warnings.push(
        `${file.path}: parser found ${diagnostics.length} syntax issue(s); relationships may be incomplete.`,
      );
  }
  for (const file of results.filter((f) => jsFile.test(f.path))) {
    const source = program.getSourceFile('/' + file.path)!;
    const line = (node: ts.Node) =>
      source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const visit = (node: ts.Node, caller = `${file.path}#module`) => {
      const declaration = declarations.get(node);
      if (declaration && declaration.kind !== 'class') caller = declaration.id;
      let specifier: string | undefined;
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        specifier = node.moduleSpecifier.text;
      if (
        ts.isCallExpression(node) &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0]) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      )
        specifier = node.arguments[0].text;
      if (specifier && file.imports.length < LIMITS.calls)
        file.imports.push({
          specifier,
          line: line(node),
          names: ts.isImportDeclaration(node)
            ? (node.importClause
                ?.getText(source)
                .split(',')
                .map((v) => v.trim()) ?? [])
            : [],
          target: resolveImport(file.path, specifier),
        });
      if (
        (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
        file.calls.length < LIMITS.calls
      ) {
        const callee = node.expression.getText(source).slice(0, 160);
        const signature = checker.getResolvedSignature(node);
        const target = signature?.declaration ? declarations.get(signature.declaration) : undefined;
        if (callee !== 'require' && callee !== 'import')
          file.calls.push({
            caller,
            callee,
            line: line(node),
            target: target?.id,
            confidence: target ? 'resolved' : 'candidate',
          });
      }
      ts.forEachChild(node, (child) => visit(child, caller));
    };
    visit(source);
  }
  // Other languages use conservative syntax patterns. Candidate calls are never promoted to resolved edges.
  for (const file of results.filter(
    (f) =>
      !jsFile.test(f.path) &&
      ![
        'JSON',
        'YAML',
        'TOML',
        'Markdown',
        'CSS',
        'SCSS',
        'HTML',
        'Text',
        'C#',
        'Python',
        'PowerBuilder',
        '.NET project',
        '.NET solution',
        'MSBuild',
      ].includes(f.language),
  )) {
    file.parser = 'heuristic';
    const lines = file.source.split('\n');
    let inBlock = false;
    lines.forEach((raw, idx) => {
      const trimmed = raw.trim();
      if (trimmed.startsWith('/*')) inBlock = true;
      if (inBlock) {
        if (trimmed.includes('*/')) inBlock = false;
        return;
      }
      if (/^(#|\/\/|\*)/.test(trimmed)) return;
      const importMatch =
        file.language === 'Python'
          ? (trimmed.match(/^from\s+([.\w]+)\s+import\s+(.+)/) ??
            trimmed.match(/^import\s+([\w.]+)/))
          : trimmed.match(
              /^(?:import\s+(?:static\s+)?|using\s+|use\s+|require\s*\(?)["']?([\w./:@-]+)/,
            );
      if (importMatch && file.imports.length < LIMITS.calls)
        file.imports.push({
          specifier: importMatch[1],
          line: idx + 1,
          names: importMatch[2] ? [importMatch[2]] : [],
          target: resolveImport(file.path, importMatch[1]),
        });
      const definition =
        trimmed.match(
          /^(?:export\s+)?(?:async\s+)?(?:def|class|interface|fun|func|fn|function|struct|enum)\s+([\w]+)/,
        ) ??
        trimmed.match(
          /^(?:(?:public|private|protected|static|override|virtual|async|final|suspend)\s+)+(?:[\w<>?\[\].]+\s+)?([\w]+)\s*\(/,
        );
      if (definition && file.symbols.length < LIMITS.symbols)
        file.symbols.push({
          id: `${file.path}#${idx + 1}:${definition[1]}`,
          name: definition[1],
          kind: /\b(class|interface|struct|enum)\b/.test(trimmed) ? 'class' : 'function',
          line: idx + 1,
          endLine: lines.length,
          exported: /\b(public|export)\b/.test(trimmed),
        });
      if (!definition && !importMatch && file.calls.length < LIMITS.calls) {
        const withoutStrings = trimmed.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
        for (const call of withoutStrings.matchAll(/\b([a-zA-Z_]\w*(?:\.\w+)*)\s*\(/g)) {
          if (
            ['if', 'for', 'while', 'switch', 'catch', 'with'].includes(call[1]) ||
            file.calls.length >= LIMITS.calls
          )
            continue;
          file.calls.push({
            caller: file.symbols.at(-1)?.id ?? `${file.path}#module`,
            callee: call[1],
            line: idx + 1,
            confidence: 'candidate',
          });
        }
      }
    });
    file.symbols.forEach((symbol, i) => {
      symbol.endLine = (file.symbols[i + 1]?.line ?? lines.length + 1) - 1;
    });
  }
  await enrichNativeFiles(results, warnings);
  const nodes: CodeMap['nodes'] = results.map((f) => ({
    id: f.path,
    path: f.path,
    label: path.posix.basename(f.path),
    kind: 'file',
    detail: f.language,
  }));
  const edges: CodeMap['edges'] = [];
  const external = new Set<string>();
  for (const file of results)
    for (const imp of file.imports) {
      const target = imp.target ?? `external:${imp.specifier}`;
      if (!imp.target && !external.has(target)) {
        external.add(target);
        nodes.push({
          id: target,
          label: imp.specifier,
          kind: 'external',
          detail:
            imp.specifier.startsWith('.') || /^[@~]\//.test(imp.specifier)
              ? 'Unresolved local import'
              : 'External or unresolved module',
        });
      }
      edges.push({
        from: file.path,
        to: target,
        label: imp.relationship ?? 'imports',
        path: file.path,
        line: imp.line,
        confidence: imp.confidence ?? (imp.target ? 'resolved' : 'candidate'),
      });
    }
  const heuristic = results.filter((f) => f.parser === 'heuristic').length;
  if (heuristic)
    warnings.push(
      `${heuristic} file(s) use heuristic parsing. Their symbols and calls are candidates, not verified runtime behavior.`,
    );
  if (results.some((f) => f.symbols.length >= LIMITS.symbols || f.calls.length >= LIMITS.calls))
    warnings.push('Symbol or call limits reached in a large file; its details are partial.');
  if (files.length === 1)
    warnings.push(
      'Single-file analysis only: upload its project to resolve imports and find callers in other files.',
    );
  warnings.push(
    'Static analysis does not execute code. Reflection, dependency injection, runtime imports, and custom build aliases may be unresolved.',
  );
  return {
    ...metadata,
    files: results,
    nodes,
    edges,
    warnings,
    skipped: metadata.skipped ?? 0,
    createdAt: new Date().toISOString(),
  };
}
