import { Parser, Language, type Node as SyntaxNode } from 'web-tree-sitter';
import path from 'node:path';
import type { AnalyzedFile, ImportInfo, SymbolInfo } from '../lib/types';
import { LIMITS } from './limits';
let languages: Promise<{ python: Language; csharp: Language }> | undefined;
function grammars() {
  return (languages ??= (async () => {
    await Parser.init();
    return {
      python: await Language.load(
        path.join(process.cwd(), 'node_modules/tree-sitter-wasms/out/tree-sitter-python.wasm'),
      ),
      csharp: await Language.load(
        path.join(process.cwd(), 'node_modules/tree-sitter-wasms/out/tree-sitter-c_sharp.wasm'),
      ),
    };
  })());
}
const children = (n: SyntaxNode | null | undefined): SyntaxNode[] =>
  n?.namedChildren.filter((c): c is SyntaxNode => c !== null) ?? [];
const named = (n: SyntaxNode, key: string): SyntaxNode[] =>
  n.childrenForFieldName(key).filter((c): c is SyntaxNode => c !== null);
const field = (n: SyntaxNode, key: string) => n.childForFieldName(key);
const text = (n: SyntaxNode, key: string) => field(n, key)?.text ?? '';
function walk(node: SyntaxNode, fn: (node: SyntaxNode) => void) {
  fn(node);
  for (const child of children(node)) walk(child, fn);
}
function ancestor(node: SyntaxNode, types: string[]) {
  let p = node.parent;
  while (p) {
    if (types.includes(p.type)) return p;
    p = p.parent;
  }
  return null;
}
const classTypes = [
  'class_declaration',
  'interface_declaration',
  'struct_declaration',
  'record_declaration',
  'class_definition',
];
const functionTypes = [
  'method_declaration',
  'constructor_declaration',
  'local_function_statement',
  'function_definition',
];
function nameOf(node: SyntaxNode) {
  const parents: string[] = [];
  let p = node.parent;
  while (p) {
    if ([...classTypes, ...functionTypes].includes(p.type)) parents.unshift(text(p, 'name'));
    p = p.parent;
  }
  return [...parents, text(node, 'name')].filter(Boolean).join('.');
}
const namespace = (node: SyntaxNode) => {
  const ns = ancestor(node, ['namespace_declaration', 'file_scoped_namespace_declaration']);
  return ns ? text(ns, 'name') : '';
};
interface Definition {
  file: AnalyzedFile;
  symbol: SymbolInfo;
  namespace: string;
  simple: string;
  owner: string;
}
interface PendingCall {
  file: AnalyzedFile;
  caller: string;
  callee: string;
  line: number;
  owner: string;
  namespace: string;
  imports: Map<string, { module: string; name: string }>;
  types: Map<string, string>;
}
export async function enrichNativeFiles(files: AnalyzedFile[], warnings: string[]) {
  const native = files.filter((f) => ['Python', 'C#'].includes(f.language));
  const definitions: Definition[] = [];
  const pending: PendingCall[] = [];
  const pythonImports = new Map<string, Map<string, { module: string; name: string }>>();
  const csharpTypes = new Map<
    string,
    { name: string; namespace: string; imports: string[]; line: number }[]
  >();
  if (native.length) {
    const grammar = await grammars();
    for (const file of native) {
      const parser = new Parser();
      parser.setLanguage(file.language === 'Python' ? grammar.python : grammar.csharp);
      const tree = parser.parse(file.source)!;
      file.parser = 'ast';
      file.symbols = [];
      file.imports = [];
      file.calls = [];
      const bindings = new Map<string, { module: string; name: string }>();
      const symbols = new Map<number, SymbolInfo>();
      const using: string[] = [];
      const typeRefs: { name: string; namespace: string; imports: string[]; line: number }[] = [];
      try {
        if (tree.rootNode.hasError)
          warnings.push(
            `${file.path}: syntax is partially unsupported or incomplete; the map may miss relationships.`,
          );
        walk(tree.rootNode, (node) => {
          if (
            [...classTypes, ...functionTypes].includes(node.type) &&
            file.symbols.length < LIMITS.symbols
          ) {
            const name = nameOf(node);
            const symbol: SymbolInfo = {
              id: `${file.path}#${node.startPosition.row + 1}:${name}`,
              name,
              kind: classTypes.includes(node.type)
                ? 'class'
                : node.type === 'constructor_declaration'
                  ? 'constructor'
                  : 'function',
              line: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
              exported:
                file.language === 'Python'
                  ? !text(node, 'name').startsWith('_')
                  : children(node).some((c) => c.type === 'modifier' && c.text === 'public'),
            };
            file.symbols.push(symbol);
            symbols.set(node.id, symbol);
            const cls = ancestor(node, classTypes);
            definitions.push({
              file,
              symbol,
              namespace: namespace(node),
              simple: text(node, 'name'),
              owner: cls ? text(cls, 'name') : '',
            });
          }
          if (node.type === 'import_from_statement') {
            const module = text(node, 'module_name');
            file.imports.push({
              specifier: module,
              line: node.startPosition.row + 1,
              names: named(node, 'name').map((n) => n.text),
            });
            for (const n of named(node, 'name')) {
              const name = n.type === 'aliased_import' ? text(n, 'name') : n.text;
              bindings.set(n.type === 'aliased_import' ? text(n, 'alias') : name, { module, name });
            }
          }
          if (node.type === 'import_statement')
            for (const n of named(node, 'name')) {
              const module = n.type === 'aliased_import' ? text(n, 'name') : n.text;
              file.imports.push({ specifier: module, line: node.startPosition.row + 1, names: [] });
              bindings.set(n.type === 'aliased_import' ? text(n, 'alias') : module.split('.')[0], {
                module,
                name: '',
              });
            }
          if (node.type === 'using_directive') {
            const value = children(node).at(-1)?.text ?? '';
            using.push(value);
          }
          if (file.language === 'C#') {
            const type = field(node, 'type');
            if (
              type &&
              !['predefined_type', 'implicit_type'].includes(type.type) &&
              !/^(void|bool|byte|sbyte|short|ushort|int|uint|long|ulong|float|double|decimal|string|char|object|dynamic|var)[?\[\]]*$/.test(
                type.text,
              )
            )
              typeRefs.push({
                name: type.text.replace(/<.*>|\[.*\]|\?/g, ''),
                namespace: namespace(node),
                imports: using,
                line: type.startPosition.row + 1,
              });
            if (node.type === 'base_list')
              for (const child of children(node))
                typeRefs.push({
                  name: child.text,
                  namespace: namespace(node),
                  imports: using,
                  line: child.startPosition.row + 1,
                });
          }
        });
        pythonImports.set(file.path, bindings);
        csharpTypes.set(file.path, typeRefs);
        walk(tree.rootNode, (node) => {
          if (
            !['call', 'invocation_expression', 'object_creation_expression'].includes(node.type) ||
            pending.length > LIMITS.files * LIMITS.calls
          )
            return;
          const calleeNode = field(node, 'function') ?? field(node, 'type');
          if (!calleeNode) return;
          const fn = ancestor(node, functionTypes),
            cls = ancestor(node, classTypes);
          const types = new Map<string, string>();
          if (file.language === 'C#') {
            // Field and parameter types narrow possible targets without claiming Roslyn-level resolution.
            if (cls)
              for (const child of children(field(cls, 'body')).filter(
                (c) => c.type === 'field_declaration',
              ))
                walk(child, (declaration) => {
                  if (declaration.type === 'variable_declaration')
                    for (const variable of children(declaration).filter(
                      (c) => c.type === 'variable_declarator',
                    ))
                      types.set(children(variable)[0]?.text ?? '', text(declaration, 'type'));
                });
            if (fn)
              walk(fn, (declaration) => {
                if (declaration.type === 'parameter')
                  types.set(text(declaration, 'name'), text(declaration, 'type'));
                if (declaration.type === 'variable_declaration')
                  for (const variable of children(declaration).filter(
                    (c) => c.type === 'variable_declarator',
                  )) {
                    let type = text(declaration, 'type');
                    if (type === 'var') {
                      const created = variable.descendantsOfType('object_creation_expression')[0];
                      if (created) type = text(created, 'type');
                    }
                    types.set(children(variable)[0]?.text ?? '', type);
                  }
              });
          }
          pending.push({
            file,
            caller: fn ? (symbols.get(fn.id)?.id ?? `${file.path}#module`) : `${file.path}#module`,
            callee: calleeNode.text.slice(0, 160),
            line: node.startPosition.row + 1,
            owner: cls ? text(cls, 'name') : '',
            namespace: namespace(node),
            imports: bindings,
            types,
          });
        });
      } finally {
        tree.delete();
        parser.delete();
      }
    }
  }
  const resolvePython = (from: string, specifier: string) => {
    const dots = specifier.match(/^\.+/)?.[0].length ?? 0;
    const prefix = dots
      ? path.posix.join(path.posix.dirname(from), ...Array(Math.max(0, dots - 1)).fill('..'))
      : '';
    const name = path.posix.join(prefix, specifier.slice(dots).replaceAll('.', '/'));
    return files.find((f) =>
      [
        name + '.py',
        name + '/__init__.py',
        !dots ? 'src/' + name + '.py' : '',
        !dots ? 'src/' + name + '/__init__.py' : '',
      ].includes(f.path),
    )?.path;
  };
  for (const file of native) {
    if (file.language === 'Python')
      for (const imp of file.imports) {
        imp.target = resolvePython(file.path, imp.specifier);
        if (!imp.target)
          for (const value of pythonImports.get(file.path)?.values() ?? [])
            if (value.module === imp.specifier) {
              const separator = imp.specifier.endsWith('.') ? '' : '.';
              const target = resolvePython(file.path, imp.specifier + separator + value.name);
              if (target) {
                imp.target = target;
                break;
              }
            }
      }
    if (file.language === 'C#')
      for (const ref of csharpTypes.get(file.path) ?? []) {
        const matches = definitions.filter(
          (d) =>
            d.file.language === 'C#' &&
            d.symbol.kind === 'class' &&
            ((d.namespace ? `${d.namespace}.${d.simple}` === ref.name : false) ||
              (d.simple === ref.name &&
                (d.namespace === ref.namespace || ref.imports.includes(d.namespace)))),
        );
        const candidates = matches.length
          ? matches
          : definitions.filter(
              (d) => d.file.language === 'C#' && d.symbol.kind === 'class' && d.simple === ref.name,
            );
        const target = candidates.length === 1 ? candidates[0].file.path : undefined;
        if (target === file.path) continue;
        if (!file.imports.some((i) => i.specifier === ref.name && i.target === target))
          file.imports.push({
            specifier: ref.name,
            line: ref.line,
            names: [],
            target,
            relationship: 'uses type',
            confidence: matches.length === 1 ? 'resolved' : 'candidate',
          });
      }
  }
  for (const call of pending) {
    if (call.file.calls.length >= LIMITS.calls) continue;
    const bits = call.callee.split('.');
    const simple = bits.at(-1)!;
    let candidates: Definition[] = [];
    if (call.file.language === 'Python') {
      const binding = call.imports.get(bits[0]);
      if (binding) {
        const targetFile = resolvePython(call.file.path, binding.module);
        candidates = definitions.filter(
          (d) => d.file.path === targetFile && d.simple === (binding.name || simple),
        );
      } else if (bits.length === 1 || bits[0] === 'self' || bits[0] === 'cls')
        candidates = definitions.filter(
          (d) =>
            d.file.path === call.file.path &&
            d.simple === simple &&
            (!d.owner || d.owner === call.owner),
        );
    } else {
      const receiver = bits.length > 1 ? bits[bits.length - 2] : 'this';
      const owner =
        receiver === 'this' || receiver === 'base'
          ? call.owner
          : (call.types.get(receiver) ?? receiver);
      candidates = definitions.filter(
        (d) =>
          d.file.language === 'C#' &&
          d.simple === simple &&
          (d.owner === owner || (d.symbol.kind === 'class' && d.simple === owner)),
      );
    }
    const target = candidates.length === 1 ? candidates[0].symbol.id : undefined;
    call.file.calls.push({
      caller: call.caller,
      callee: call.callee,
      line: call.line,
      target,
      confidence: 'candidate',
    });
    const dependency = candidates.length === 1 ? candidates[0].file.path : undefined;
    if (
      dependency &&
      dependency !== call.file.path &&
      !call.file.imports.some((i) => i.target === dependency)
    )
      call.file.imports.push({
        specifier: call.callee,
        target: dependency,
        names: [],
        line: call.line,
        relationship: 'calls (candidate)',
        confidence: 'candidate',
      });
  }
  analyzePowerBuilder(files);
  for (const file of files.filter((f) => f.language === '.NET project')) {
    for (const match of file.source.matchAll(
      /<(ProjectReference|PackageReference)\b[^>]*\bInclude\s*=\s*["']([^"']+)["']/g,
    )) {
      const specifier = match[2].replaceAll('\\', '/');
      const target =
        match[1] === 'ProjectReference'
          ? path.posix.normalize(path.posix.join(path.posix.dirname(file.path), specifier))
          : undefined;
      file.imports.push({
        specifier,
        names: [],
        target: files.some((f) => f.path === target) ? target : undefined,
        line: file.source.slice(0, match.index).split('\n').length,
        relationship: match[1] === 'ProjectReference' ? 'project reference' : 'NuGet package',
      });
    }
  }
  if (native.length)
    warnings.push(
      'C# and Python use syntax trees. Call targets are candidates: overloads, dependency injection, reflection, and dynamic rebinding are not compiler/runtime verified.',
    );
  if (files.some((f) => f.language === 'PowerBuilder'))
    warnings.push(
      'PowerBuilder uses exported-text analysis. Event routing, inherited behavior, dynamic calls, and embedded SQL require review. Binary PBL/PBD libraries must be exported first.',
    );
}

function analyzePowerBuilder(files: AnalyzedFile[]) {
  const pb = files.filter((f) => f.language === 'PowerBuilder');
  const objects = new Map<string, string[]>();
  for (const f of pb) {
    const name = path.posix
      .basename(f.path)
      .replace(/\.[^.]+$/, '')
      .toLowerCase();
    objects.set(name, [...(objects.get(name) ?? []), f.path]);
    const declared = f.source.match(/^(?:global\s+)?type\s+(\w+)\s+from\s+/im)?.[1].toLowerCase();
    if (declared && declared !== name)
      objects.set(declared, [...(objects.get(declared) ?? []), f.path]);
  }
  const objectTarget = (name: string) => {
    const matches = objects.get(name.toLowerCase());
    return matches?.length === 1 ? matches[0] : undefined;
  };
  const variablesByFile = new Map<string, Map<string, string>>();
  for (const file of pb) {
    file.parser = 'heuristic';
    if (/\.srd$/i.test(file.path)) {
      file.symbols.push({
        id: `${file.path}#1:datawindow`,
        name: path.posix.basename(file.path).replace(/\.srd$/i, ''),
        kind: 'DataWindow',
        line: 1,
        endLine: file.lines,
        exported: true,
      });
      for (const match of file.source.matchAll(/\b(?:FROM|JOIN)\s+["\[]?([\w.]+)/gi))
        file.imports.push({
          specifier: `database:${match[1]}`,
          names: [],
          line: file.source.slice(0, match.index).split('\n').length,
          relationship: 'reads table',
          confidence: 'candidate',
        });
      continue;
    }
    const lines = file.source.split('\n');
    let prototypes = false,
      blockComment = false,
      current: SymbolInfo | undefined;
    const variables = new Map<string, string>();
    variablesByFile.set(file.path, variables);
    const addReference = (name: string, line: number, relationship: string) => {
      const target = objectTarget(name);
      if (
        target === file.path ||
        file.imports.some(
          (i) =>
            i.specifier.toLowerCase() === name.toLowerCase() && i.relationship === relationship,
        )
      )
        return;
      file.imports.push({
        specifier: name,
        line,
        names: [],
        target,
        relationship,
        confidence: target ? 'resolved' : 'candidate',
      });
    };
    lines.forEach((raw, index) => {
      let value = raw.trim();
      if (blockComment) {
        if (!value.includes('*/')) return;
        value = value.slice(value.indexOf('*/') + 2);
        blockComment = false;
      }
      if (value.startsWith('/*')) {
        blockComment = !value.includes('*/');
        return;
      }
      if (value.startsWith('//')) return;
      value = value.replace(/\/\/.*$/, '');
      if (/^(forward|type)\s+prototypes/i.test(value)) {
        prototypes = true;
        return;
      }
      if (/^end\s+prototypes/i.test(value)) {
        prototypes = false;
        return;
      }
      const inherited = value.match(/^(?:global\s+)?type\s+(\w+)\s+from\s+(\w+)/i);
      if (inherited) {
        if (file.symbols.length < LIMITS.symbols)
          file.symbols.push({
            id: `${file.path}#${index + 1}:${inherited[1]}`,
            name: inherited[1],
            kind: 'object',
            line: index + 1,
            endLine: index + 1,
            exported: /^global/i.test(value),
          });
        addReference(inherited[2], index + 1, 'inherits');
      }
      if (prototypes) return;
      const definition =
        value.match(
          /^(?:(?:global|public|private|protected)\s+)?(?:function\s+[\w.]+|subroutine)\s+(\w+)\s*\(/i,
        ) ??
        value.match(/^event\s+(?:(?:type\s+\w+\s+))?(\w+)\s*(?:\([^;]*\))?\s*;/i) ??
        value.match(/^on\s+\w+\.(\w+)/i);
      if (definition && file.symbols.length < LIMITS.symbols) {
        current = {
          id: `${file.path}#${index + 1}:${definition[1]}`,
          name: definition[1],
          kind: /^event|^on/i.test(value) ? 'event' : 'function',
          line: index + 1,
          endLine: lines.length,
          exported: /^(global|public)/i.test(value),
        };
        file.symbols.push(current);
        return;
      }
      if (/^end\s+(function|subroutine|event|on)\b/i.test(value)) {
        if (current) current.endLine = index + 1;
        current = undefined;
        return;
      }
      const variable = value.match(/^(\w+)\s+(\w+)\s*(?:$|=)/);
      if (variable && objectTarget(variable[1])) {
        variables.set(variable[2].toLowerCase(), variable[1]);
        addReference(variable[1], index + 1, 'object type');
      }
      for (const created of value.matchAll(/\bcreate\s+(?!using\b)(\w+)/gi))
        addReference(created[1], index + 1, 'creates');
      const dataWindow = value.match(/\bdataobject\s*=\s*["']([^"']+)["']/i);
      if (dataWindow) addReference(dataWindow[1], index + 1, 'DataWindow');
      const stripped = value.replace(/"(?:~.|[^"~])*"|'(?:~.|[^'~])*'/g, '""');
      for (const call of stripped.matchAll(/\b([a-z_]\w*(?:\.[a-z_]\w*)?)\s*\(/gi)) {
        if (
          ['if', 'for', 'while', 'choose', 'function', 'subroutine'].includes(
            call[1].toLowerCase(),
          ) ||
          file.calls.length >= LIMITS.calls
        )
          continue;
        file.calls.push({
          caller: current?.id ?? `${file.path}#module`,
          callee: call[1],
          line: index + 1,
          confidence: 'candidate',
        });
      }
    });
    // Case-insensitive object/member lookup; dynamic event and dispatch targets stay candidates.
    for (const call of file.calls) {
      const [receiver, member] = call.callee.toLowerCase().split('.');
      const targetPath = member
        ? receiver === 'this'
          ? file.path
          : objectTarget(variables.get(receiver) ?? receiver)
        : file.path;
      if (targetPath) {
        const other = files.find((f) => f.path === targetPath);
        const candidates = other?.symbols.filter(
          (s) => s.name.toLowerCase() === (member ?? receiver),
        );
        if (candidates?.length === 1) call.target = candidates[0].id;
      }
    }
  }
  // Resolve member calls again after all objects have been parsed, independent of file order.
  for (const file of pb)
    for (const call of file.calls.filter((c) => !c.target && c.callee.includes('.'))) {
      const [receiver, member] = call.callee.toLowerCase().split('.');
      const targetPath =
        receiver === 'this'
          ? file.path
          : objectTarget(variablesByFile.get(file.path)?.get(receiver) ?? receiver);
      const candidates = pb
        .find((f) => f.path === targetPath)
        ?.symbols.filter((s) => s.name.toLowerCase() === member);
      if (candidates?.length === 1) call.target = candidates[0].id;
    }
  // Cross-file symbols are complete only after all objects have been parsed.
  for (const file of pb)
    for (const call of file.calls.filter((c) => !c.target && !c.callee.includes('.'))) {
      const candidates = pb.flatMap((f) =>
        f.symbols
          .filter((s) => s.exported && s.name.toLowerCase() === call.callee.toLowerCase())
          .map((s) => ({ f, s })),
      );
      if (candidates.length === 1) {
        call.target = candidates[0].s.id;
        if (candidates[0].f.path !== file.path)
          file.imports.push({
            specifier: call.callee,
            names: [],
            line: call.line,
            target: candidates[0].f.path,
            relationship: 'calls (candidate)',
            confidence: 'candidate',
          });
      }
    }
}
