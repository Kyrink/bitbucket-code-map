import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../server/analyze';
import { demoFiles } from '../server/demo';
import { selectGraph, startingPoints, toMermaid } from '../lib/graph';
const meta = { name: 'test', origin: 'upload' as const };
test('C# finds namespaces, field types, same-class and cross-file method candidates', async () => {
  const map = await analyze(demoFiles, meta);
  const service = map.files.find((f) => f.path === 'domain/OrderService.cs')!;
  assert.equal(service.parser, 'ast');
  assert.ok(service.symbols.some((s) => s.name === 'OrderService.Create'));
  assert.ok(
    service.calls
      .find((c) => c.callee === 'repository.Save')
      ?.target?.startsWith('data/OrderRepository.cs#'),
  );
  assert.ok(
    service.calls.find((c) => c.callee === 'Validate')?.target?.includes('OrderService.Validate'),
  );
  assert.ok(
    map.edges.some(
      (e) =>
        e.from === 'api/OrdersController.cs' &&
        e.to === 'domain/OrderService.cs' &&
        e.label === 'uses type' &&
        e.confidence === 'resolved',
    ),
  );
  assert.ok(
    map.edges.some(
      (e) =>
        e.from === 'api/Orders.Api.csproj' &&
        e.to === 'domain/Orders.Domain.csproj' &&
        e.label === 'project reference',
    ),
  );
  assert.equal(service.calls.find((c) => c.callee === 'repository.Save')?.confidence, 'candidate');
});
test('C# overloads and duplicate types remain unresolved rather than guessing', async () => {
  const map = await analyze(
    [
      {
        path: 'A.cs',
        content:
          'public class A { public void Run() { Save(1); } public void Save(int n) {} public void Save(string n) {} }',
      },
    ],
    meta,
  );
  assert.equal(map.files[0].calls.find((c) => c.callee === 'Save')?.target, undefined);
});
test('Python resolves relative imports and aliases with source evidence, ignores comments and strings', async () => {
  const map = await analyze(
    [
      {
        path: 'app/main.py',
        content:
          'from .store import save as persist\n# ghost()\ntext = "fiction()"\ndef run(x):\n    return persist(x)\n',
      },
      { path: 'app/store.py', content: 'def save(x):\n    return x\n' },
    ],
    meta,
  );
  const main = map.files.find((f) => f.path === 'app/main.py')!;
  assert.equal(main.parser, 'ast');
  assert.equal(main.calls.length, 1);
  assert.equal(main.calls[0].line, 5);
  assert.equal(main.calls[0].target, 'app/store.py#1:save');
  assert.equal(main.imports[0].target, 'app/store.py');
});
test('PowerBuilder maps inheritance, DataWindows, prototypes, event and member calls independent of order', async () => {
  const map = await analyze(
    [
      {
        path: 'a_window.srw',
        content:
          'global type a_window from z_base\nend type\nz_service inv_service\nevent ue_save;\ninv_service.of_save()\ndw.DataObject = "d_orders"\nend event\n',
      },
      {
        path: 'z_service.sru',
        content:
          'global type z_service from nonvisualobject\nend type\nforward prototypes\npublic function integer of_save ()\nend prototypes\npublic function integer of_save ();\nreturn 1\nend function\n',
      },
      { path: 'z_base.srw', content: 'global type z_base from window\nend type\n' },
      { path: 'd_orders.srd', content: 'datawindow()' },
    ],
    meta,
  );
  const win = map.files.find((f) => f.path === 'a_window.srw')!;
  assert.ok(map.edges.some((e) => e.to === 'z_base.srw' && e.label === 'inherits'));
  assert.ok(map.edges.some((e) => e.to === 'd_orders.srd' && e.label === 'DataWindow'));
  assert.ok(win.symbols.some((s) => s.kind === 'event' && s.name === 'ue_save'));
  assert.equal(
    map.files.find((f) => f.path === 'z_service.sru')?.symbols.filter((s) => s.name === 'of_save')
      .length,
    1,
  );
  assert.ok(
    win.calls.find((c) => c.callee === 'inv_service.of_save')?.target?.startsWith('z_service.sru#'),
  );
});
test('TypeScript aliases and imported calls resolve with compiler bindings', async () => {
  const map = await analyze(
    [
      { path: 'tsconfig.json', content: '{"compilerOptions":{"paths":{"@/*":["src/*"]}}}' },
      {
        path: 'src/main.ts',
        content:
          "import { save as persist } from '@/store';\nexport function run(){ return persist(); }",
      },
      { path: 'src/store.ts', content: 'export function save(){return 1;}' },
    ],
    meta,
  );
  const main = map.files.find((f) => f.path === 'src/main.ts')!;
  assert.equal(main.imports[0].target, 'src/store.ts');
  assert.equal(main.calls[0].confidence, 'resolved');
  assert.ok(main.calls[0].target?.includes('src/store.ts#'));
});
test('single file reports missing context; flow graph includes incoming calls and filters external nodes', async () => {
  const single = await analyze(
    [{ path: 'alone.py', content: 'import missing\ndef run():\n    return missing.work()' }],
    meta,
  );
  assert.ok(single.warnings.some((w) => w.startsWith('Single-file')));
  const map = await analyze(demoFiles, meta);
  const flow = selectGraph(map, 'flow', 'jobs/store.py', false, 0);
  assert.ok(flow.edges.some((e) => e.path === 'jobs/main.py'));
  assert.ok(flow.nodes.every((n) => n.kind !== 'external'));
});
test('Mermaid compiler escapes arbitrary labels and preserves structural node ids', () => {
  const result = toMermaid({
    nodes: [
      { id: 'unsafe', label: 'a"]\nclick n0 "javascript:alert(1)"', kind: 'file', detail: '' },
    ],
    edges: [],
    hidden: 0,
  });
  assert.equal(result.split('\n').filter((l) => /^click/.test(l)).length, 0);
  assert.ok(result.includes('”'));
  assert.ok(result.includes('n0['));
});

test('focused calls expand across files one connection at a time without unrelated symbols', async () => {
  const map = await analyze(
    [
      { path: 'a.py', content: 'from b import next_step\ndef start():\n    next_step()' },
      { path: 'b.py', content: 'from c import finish\ndef next_step():\n    finish()' },
      { path: 'c.py', content: 'def finish():\n    return 1' },
      { path: 'unrelated.py', content: 'def unrelated():\n    return 2' },
    ],
    meta,
  );
  const start = map.files.find((f) => f.path === 'a.py')!.symbols.find((s) => s.name === 'start')!;
  const one = selectGraph(map, 'flow', 'a.py', false, 1, start.id);
  assert.deepEqual(new Set(one.nodes.map((n) => n.path)), new Set(['a.py', 'b.py']));
  assert.equal(one.edges[0].path, 'a.py');
  assert.equal(one.edges[0].line, 3);
  const two = selectGraph(map, 'flow', 'a.py', false, 2, start.id);
  assert.deepEqual(new Set(two.nodes.map((n) => n.path)), new Set(['a.py', 'b.py', 'c.py']));
  const finish = two.nodes.find((n) => n.path === 'c.py')!;
  assert.equal(finish.line, 1);
  const incoming = selectGraph(map, 'flow', 'c.py', false, 2, finish.id);
  assert.ok(incoming.nodes.some((n) => n.id === start.id));
  assert.ok(!incoming.nodes.some((n) => n.path === 'unrelated.py'));
});

test('module drilldown scopes the graph and expands only connected files', async () => {
  const map = await analyze(demoFiles, meta);
  const directory = selectGraph(map, 'files', '', false, 0, '', 'domain');
  assert.ok(directory.nodes.length > 1);
  assert.ok(directory.nodes.every((n) => n.path?.startsWith('domain/')));
  const expanded = selectGraph(map, 'files', '', false, 1, '', 'domain');
  assert.ok(expanded.nodes.some((n) => n.path === 'api/OrdersController.cs'));
  assert.ok(!expanded.nodes.some((n) => n.path?.startsWith('jobs/')));
  const root = selectGraph(map, 'files', '', false, 0, '', '(root)');
  assert.ok(root.nodes.every((n) => !n.path?.includes('/')));
});

test('directional traversal handles cycles, follows depth, and preserves every call site', async () => {
  const map = await analyze(
    [
      { path: 'a.py', content: 'from b import beta\ndef alpha():\n    beta()' },
      {
        path: 'b.py',
        content:
          'from a import alpha\nfrom c import finish\ndef beta():\n    alpha()\n    finish()\n    finish()',
      },
      { path: 'c.py', content: 'from e import end\ndef finish():\n    end()' },
      { path: 'd.py', content: 'from a import alpha\ndef start():\n    alpha()' },
      { path: 'e.py', content: 'def end():\n    pass' },
      { path: 'README.md', content: '# Project' },
    ],
    meta,
  );
  const beta = map.files.find((f) => f.path === 'b.py')!.symbols[0].id;
  const outgoing = selectGraph(map, 'flow', 'b.py', false, 2, beta, '', 'outgoing');
  assert.deepEqual(
    new Set(outgoing.nodes.map((n) => n.path)),
    new Set(['a.py', 'b.py', 'c.py', 'e.py']),
  );
  const incoming = selectGraph(map, 'flow', 'b.py', false, 2, beta, '', 'incoming');
  assert.deepEqual(new Set(incoming.nodes.map((n) => n.path)), new Set(['a.py', 'b.py', 'd.py']));
  const both = selectGraph(map, 'flow', 'b.py', false, 2, beta);
  assert.equal(both.nodes.length, 5);
  const repeated = outgoing.edges.find((e) => e.to.startsWith('c.py#'))!;
  assert.deepEqual(
    repeated.references.map((r) => r.line),
    [5, 6],
  );
  const reciprocal = outgoing.edges.find((e) => e.from === beta && e.to.startsWith('a.py#'))!;
  assert.ok(outgoing.edges.some((e) => e.from === reciprocal.to && e.to === beta));
  assert.ok(toMermaid(outgoing).includes('calls · 2'));
  const fileIncoming = selectGraph(map, 'files', 'a.py', false, 1, 'a.py', '', 'incoming');
  assert.deepEqual(new Set(fileIncoming.nodes.map((n) => n.id)), new Set(['a.py', 'b.py', 'd.py']));
  const starts = startingPoints(map);
  assert.equal(starts[0].path, 'README.md');
  assert.ok(starts.some((n) => n.label === 'start' && n.line === 2));
  assert.ok(!starts.some((n) => n.label === 'alpha' || n.label === 'beta' || n.label === 'finish'));
});

test('module arrows retain the original files and all evidence, including mixed confidence', async () => {
  const map = await analyze(demoFiles, meta);
  const original = map.edges.find((e) => e.from.startsWith('api/') && e.to.startsWith('domain/'))!;
  map.edges.push({ ...original, confidence: 'candidate' });
  const modules = selectGraph(map, 'modules', '', false, 0);
  const dependency = modules.edges.find((e) => e.from === 'api' && e.to === 'domain')!;
  assert.ok(dependency.references.length > 1);
  assert.ok(
    dependency.references.every((r) => r.from.startsWith('api/') && r.to.startsWith('domain/')),
  );
  assert.ok(dependency.references.some((r) => r.label === 'project reference'));
  assert.ok(dependency.references.some((r) => r.confidence === 'candidate'));
});
