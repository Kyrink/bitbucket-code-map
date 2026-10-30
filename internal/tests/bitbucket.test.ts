import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchBitbucket, parseRepository } from '../server/bitbucket';
const sha = 'a'.repeat(40),
  base = 'https://api.bitbucket.org/2.0/repositories/team/repo';
test('repository parser accepts cloud and shorthand URLs and rejects credential/host injection', () => {
  assert.deepEqual(parseRepository('https://bitbucket.org/team/repo.git/src/main/'), {
    workspace: 'team',
    slug: 'repo',
  });
  assert.deepEqual(parseRepository('team/repo'), { workspace: 'team', slug: 'repo' });
  for (const value of [
    'https://evil.example/team/repo',
    'https://bitbucket.org.evil.example/team/repo',
    'https://user:secret@bitbucket.org/team/repo',
    'https://bitbucket.org:123/team/repo',
    '../repo',
  ])
    assert.throws(() => parseRepository(value));
});
test('Bitbucket uses read-only authenticated requests, pins the commit, and follows source pagination', async () => {
  const seen: { url: string; authorization: string | undefined }[] = [];
  const mock = async (url: string | URL | Request, options?: RequestInit) => {
    const address = String(url);
    seen.push({
      url: address,
      authorization: (options?.headers as Record<string, string>)?.Authorization,
    });
    assert.equal(options?.redirect, 'error');
    assert.equal(options?.method, undefined);
    if (address === base) return Response.json({ mainbranch: { name: 'feature/work' } });
    if (address === base + '/commit/feature%2Fwork') return Response.json({ hash: sha });
    if (address === base + `/src/${sha}/?pagelen=100`)
      return Response.json({
        values: [{ path: 'main.py', type: 'commit_file', size: 22 }],
        next: base + `/src/${sha}/?page=2`,
      });
    if (address === base + `/src/${sha}/?page=2`)
      return Response.json({ values: [{ path: '.env', type: 'commit_file', size: 10 }] });
    if (address.endsWith('/main.py')) return new Response('def run():\n    return 1');
    throw new Error('unexpected request ' + address);
  };
  const result = await fetchBitbucket(
    { repository: 'team/repo', email: 'test@example.invalid', token: 'example-token' },
    undefined,
    mock as typeof fetch,
  );
  assert.equal(result.revision, sha);
  assert.equal(result.files.length, 1);
  assert.equal(result.skipped, 1);
  assert.ok(
    seen.every(
      (r) =>
        r.authorization ===
        `Basic ${Buffer.from('test@example.invalid:example-token').toString('base64')}`,
    ),
  );
  assert.ok(!JSON.stringify(result).includes('example-token'));
});
test('Bitbucket never follows pagination to another host', async () => {
  const seen: string[] = [];
  const mock = async (url: string | URL | Request) => {
    const address = String(url);
    seen.push(address);
    return Response.json(
      address === base
        ? { mainbranch: { name: 'main' } }
        : address.includes('/commit/')
          ? { hash: sha }
          : { values: [], next: 'https://evil.example/source' },
    );
  };
  await assert.rejects(() =>
    fetchBitbucket(
      { repository: 'team/repo', token: 'example-token' },
      undefined,
      mock as typeof fetch,
    ),
  );
  assert.ok(seen.every((u) => u.startsWith(base)));
});
test('Bitbucket authentication failures are actionable and never echo upstream responses', async () => {
  await assert.rejects(
    () =>
      fetchBitbucket(
        { repository: 'team/repo' },
        undefined,
        (async () => new Response('secret upstream error', { status: 401 })) as typeof fetch,
      ),
    /rejected the credentials/,
  );
});
