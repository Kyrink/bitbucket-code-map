import { analyze } from '@/server/analyze';
import { authorize } from '@/server/auth';
import { fetchBitbucket } from '@/server/bitbucket';
import { ingestUploads, readBounded } from '@/server/ingest';
import { InputError, LIMITS } from '@/server/limits';
export const runtime = 'nodejs';
export const maxDuration = 180;
let active = 0;
export async function POST(request: Request) {
  let admitted = false;
  try {
    authorize(request);
    if (active >= 2) throw new InputError('The analyzer is busy. Try again shortly.', 429);
    active++;
    admitted = true;
    const type = request.headers.get('content-type') ?? '';
    const body = await readBounded(
      request.body,
      type.includes('multipart/form-data') ? LIMITS.upload : 16000,
    );
    if (type.includes('multipart/form-data')) {
      const form = await new Response(new Uint8Array(body), {
        headers: { 'content-type': type },
      }).formData();
      const files = form.getAll('files').filter((f): f is File => typeof f !== 'string');
      const ingested = await ingestUploads(files);
      return Response.json(
        await analyze(ingested.files, {
          name:
            files.length === 1
              ? files[0].name.replace(/\.zip$/i, '')
              : `Uploaded project · ${ingested.files.length} files`,
          origin: 'upload',
          skipped: ingested.skipped,
          warnings: ingested.warnings,
        }),
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (!type.includes('application/json')) throw new InputError('Unsupported content type.', 415);
    let input: unknown;
    try {
      input = JSON.parse(body.toString('utf8'));
    } catch {
      throw new InputError('Invalid request JSON.');
    }
    if (
      !input ||
      typeof input !== 'object' ||
      !('repository' in input) ||
      typeof input.repository !== 'string'
    )
      throw new InputError('Enter a repository URL.');
    const data = input as Record<string, unknown>;
    for (const key of ['repository', 'ref', 'email', 'token'])
      if (
        data[key] !== undefined &&
        (typeof data[key] !== 'string' ||
          (data[key] as string).length > (key === 'token' ? 5000 : 500))
      )
        throw new InputError('Invalid repository connection input.');
    const ingested = await fetchBitbucket(
      {
        repository: data.repository as string,
        ref: data.ref as string,
        email: data.email as string,
        token: data.token as string,
      },
      request.signal,
    );
    return Response.json(await analyze(ingested.files, { ...ingested, origin: 'bitbucket' }), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const timedOut = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
    return Response.json(
      {
        error:
          error instanceof InputError
            ? error.message
            : timedOut
              ? 'Analysis timed out or was cancelled. Try a smaller project.'
              : 'Analysis failed. Check the input and connection, then try again.',
      },
      {
        status: error instanceof InputError ? error.status : timedOut ? 408 : 500,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } finally {
    if (admitted) active--;
  }
}
