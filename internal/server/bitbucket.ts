import type { IngestResult } from '../lib/types';
import { decodeSource, includePath, InputError, LIMITS, safePath } from './limits';
import { readBounded } from './ingest';

export function parseRepository(value: string): { workspace: string; slug: string } {
  let parts: string[];
  if (value.includes('://')) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new InputError('Enter a Bitbucket Cloud repository URL.');
    }
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'bitbucket.org' ||
      url.port ||
      url.username ||
      url.password
    )
      throw new InputError('Use an https://bitbucket.org/workspace/repository URL.');
    parts = url.pathname.split('/').filter(Boolean);
  } else parts = value.trim().split('/');
  const workspace = parts[0] ?? '',
    slug = (parts[1] ?? '').replace(/\.git$/, '');
  if (
    !/^[\w-]+$/.test(workspace) ||
    !/^[\w.-]+$/.test(slug) ||
    slug === '.' ||
    slug === '..' ||
    (!value.includes('://') && parts.length !== 2)
  )
    throw new InputError('Enter workspace/repository or its Bitbucket Cloud URL.');
  return { workspace, slug };
}

export async function fetchBitbucket(
  input: { repository: string; ref?: string; email?: string; token?: string },
  signal?: AbortSignal,
  fetcher = fetch,
): Promise<IngestResult & { name: string; revision: string; repositoryUrl: string }> {
  const { workspace, slug } = parseRepository(input.repository);
  const token = input.token?.trim() || process.env.BITBUCKET_TOKEN?.trim();
  const email = input.token?.trim() ? input.email?.trim() : process.env.BITBUCKET_EMAIL?.trim();
  const authorization = token
    ? email
      ? `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`
      : `Bearer ${token}`
    : undefined;
  const base = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(slug)}`;
  const deadline = AbortSignal.any([AbortSignal.timeout(150000), ...(signal ? [signal] : [])]);
  let requests = 0;
  const request = async (url: string, max = LIMITS.file): Promise<Buffer> => {
    const parsed = new URL(url);
    if (
      parsed.origin !== 'https://api.bitbucket.org' ||
      (!parsed.pathname.startsWith(new URL(base).pathname + '/') &&
        parsed.pathname !== new URL(base).pathname) ||
      parsed.username ||
      parsed.password
    )
      throw new InputError('Bitbucket returned an invalid pagination URL.', 502);
    if (++requests > LIMITS.requests)
      throw new InputError(
        'Repository exceeds the request limit. Upload a ZIP of a smaller part.',
        413,
      );
    const response = await fetcher(url, {
      headers: { ...(authorization ? { Authorization: authorization } : {}) },
      redirect: 'error',
      signal: deadline,
      cache: 'no-store',
    });
    if (!response.ok) {
      const messages: Record<number, string> = {
        401: 'Bitbucket rejected the credentials. Check your API token and email.',
        403: 'The token needs read:repository:bitbucket permission and access to this repository.',
        404: 'Repository or revision not found. Check the URL and private repository access.',
        429: 'Bitbucket rate limit reached. Try later or upload a project ZIP.',
      };
      throw new InputError(
        messages[response.status] ?? 'Bitbucket could not return the source. Please try again.',
        response.status === 429 ? 429 : 400,
      );
    }
    return readBounded(response.body, max);
  };
  const json = async (url: string) =>
    JSON.parse((await request(url, 2 * 1024 * 1024)).toString('utf8'));
  const repo = await json(base);
  const ref = input.ref?.trim() || repo.mainbranch?.name;
  if (!ref || ref.length > 200 || /[\x00-\x1f]/.test(ref))
    throw new InputError('No readable branch found. Enter a branch, tag, or commit.');
  const commit = await json(`${base}/commit/${encodeURIComponent(ref)}`);
  if (typeof commit.hash !== 'string' || !/^[a-f0-9]{40,64}$/i.test(commit.hash))
    throw new InputError('Bitbucket returned an invalid commit.', 502);
  const revision: string = commit.hash;
  const root = `${base}/src/${revision}/`;
  const queue = [root + '?pagelen=100'];
  const visited = new Set<string>(),
    paths = new Set<string>();
  const candidates: { path: string; size: number }[] = [];
  let skipped = 0,
    entries = 0;
  while (queue.length) {
    const url = queue.shift()!;
    if (visited.has(url) || !url.startsWith(root))
      throw new InputError('Bitbucket returned invalid or repeated source pagination.', 502);
    visited.add(url);
    const page = await json(url);
    if (!Array.isArray(page.values))
      throw new InputError('Bitbucket returned an invalid file listing.', 502);
    for (const entry of page.values) {
      if (++entries > LIMITS.entries)
        throw new InputError(
          'Repository contains too many entries. Upload a focused ZIP instead.',
          413,
        );
      const path = safePath(entry.path);
      if (entry.type === 'commit_directory') {
        if (
          !/(^|\/)(node_modules|vendor|\.git|dist|build|\.next|target|\.venv|venv|__pycache__)(\/|$)/.test(
            path,
          )
        )
          queue.push(root + path.split('/').map(encodeURIComponent).join('/') + '/?pagelen=100');
      } else if (entry.type === 'commit_file' && !paths.has(path)) {
        paths.add(path);
        if (
          !includePath(path) ||
          entry.size > LIMITS.file ||
          entry.attributes?.some((a: string) =>
            ['link', 'binary', 'subrepository', 'lfs'].includes(a),
          )
        ) {
          skipped++;
          continue;
        }
        if (candidates.length >= LIMITS.files)
          throw new InputError(
            `This repository has more than ${LIMITS.files} supported files. Upload a smaller ZIP.`,
            413,
          );
        candidates.push({ path, size: entry.size || 0 });
      }
    }
    if (page.next) queue.push(page.next);
  }
  if (candidates.reduce((sum, f) => sum + f.size, 0) > LIMITS.total)
    throw new InputError('Repository source exceeds 20 MB. Upload a smaller project ZIP.', 413);
  const result: IngestResult = { files: [], skipped, warnings: [] };
  let index = 0,
    total = 0;
  await Promise.all(
    Array.from({ length: Math.min(6, candidates.length) }, async () => {
      while (index < candidates.length) {
        const file = candidates[index++];
        const bytes = await request(root + file.path.split('/').map(encodeURIComponent).join('/'));
        total += bytes.length;
        if (total > LIMITS.total) throw new InputError('Source exceeds 20 MB.', 413);
        const content = decodeSource(bytes);
        if (content === null) result.skipped++;
        else result.files.push({ path: file.path, content });
      }
    }),
  );
  if (result.skipped)
    result.warnings.push(
      `${result.skipped} sensitive, generated, binary, unsupported, or oversized files were excluded.`,
    );
  return {
    ...result,
    name: `${workspace}/${slug}`,
    revision,
    repositoryUrl: `https://bitbucket.org/${workspace}/${slug}`,
  };
}
