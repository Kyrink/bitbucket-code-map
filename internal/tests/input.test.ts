import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { unzipProject, ingestUploads, readBounded } from '../server/ingest';
import { safePath, includePath, decodeSource } from '../server/limits';
import { authorize } from '../server/auth';
const fixture = (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url));
test('ZIP preserves code paths, strips wrapper, skips secrets and generated dependencies', async () => {
  const result = await unzipProject(await fixture('project.zip'));
  assert.deepEqual(
    result.files.map((f) => f.path),
    ['src/main.py', 'src/store.py'],
  );
  assert.equal(result.skipped, 2);
  assert.ok(!JSON.stringify(result).includes('should-not-appear'));
});
for (const kind of ['traversal', 'duplicate', 'symlink'])
  test(`ZIP rejects ${kind}`, async () =>
    assert.rejects(() => fixture(kind + '.zip').then(unzipProject)));
test('input rejects unsafe paths, binary contents and excludes common secrets', () => {
  for (const path of ['../a.py', '/root/a.py', 'C:\\x.py', 'a/../b.py', 'a\u0000.py'])
    assert.throws(() => safePath(path));
  for (const path of ['.env', 'x/.env.production', 'x/private.key', 'node_modules/x.js'])
    assert.equal(includePath(path), false);
  assert.equal(includePath('objects/window.srw'), true);
  assert.equal(includePath('domain/app.csproj'), true);
  assert.equal(decodeSource(new Uint8Array([0, 1, 2])), null);
  assert.equal(
    decodeSource(Buffer.concat([Buffer.from([255, 254]), Buffer.from('event open;', 'utf16le')])),
    'event open;',
  );
});
test('uploads reject duplicates and streaming bodies stop at actual byte limit', async () => {
  await assert.rejects(() =>
    ingestUploads([new File(['x=1'], 'main.py'), new File(['x=2'], 'main.py')]),
  );
  await assert.rejects(() => readBounded(new Response('abcde').body, 4));
});
test('API guard rejects cross-origin requests and enforces the configured workspace key', () => {
  const original = process.env.INTERNAL_ACCESS_TOKEN;
  process.env.INTERNAL_ACCESS_TOKEN = 'test-key';
  try {
    assert.throws(() =>
      authorize(
        new Request('http://localhost:3100/api/analyze', {
          method: 'POST',
          headers: { origin: 'https://elsewhere.example', 'x-internal-token': 'test-key' },
        }),
      ),
    );
    assert.throws(() =>
      authorize(
        new Request('http://localhost:3100/api/analyze', {
          method: 'POST',
          headers: { origin: 'http://localhost:3100' },
        }),
      ),
    );
    assert.doesNotThrow(() =>
      authorize(
        new Request('http://localhost:3100/api/analyze', {
          method: 'POST',
          headers: { origin: 'http://localhost:3100', 'x-internal-token': 'test-key' },
        }),
      ),
    );
  } finally {
    if (original === undefined) delete process.env.INTERNAL_ACCESS_TOKEN;
    else process.env.INTERNAL_ACCESS_TOKEN = original;
  }
});

test('origin checking accepts Next internal URL normalization while rejecting untrusted hosts', () => {
  assert.doesNotThrow(() =>
    authorize(
      new Request('http://localhost:3100/api/analyze', {
        method: 'POST',
        headers: { host: '127.0.0.1:3100', origin: 'http://127.0.0.1:3100' },
      }),
    ),
  );
  assert.throws(() =>
    authorize(
      new Request('http://localhost:3100/api/analyze', {
        method: 'POST',
        headers: { host: 'attacker.invalid', origin: 'http://attacker.invalid' },
      }),
    ),
  );
});
