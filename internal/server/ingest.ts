import yauzl from 'yauzl';
import type { IngestResult, SourceFile } from '../lib/types';
import { decodeSource, includePath, InputError, LIMITS, safePath } from './limits';

export async function readBounded(
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Buffer> {
  if (!stream) return Buffer.alloc(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit)
        throw new InputError(
          'Input exceeds the size limit. Use a smaller project or subdirectory.',
          413,
        );
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export function unzipProject(buffer: Buffer): Promise<IngestResult> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, zip) => {
        if (error || !zip) return reject(new InputError('This ZIP is invalid or unsupported.'));
        const files: SourceFile[] = [];
        const seen = new Set<string>();
        let entries = 0,
          total = 0,
          declared = 0,
          skipped = 0;
        let failed = false;
        const fail = (err: unknown) => {
          if (failed) return;
          failed = true;
          zip.close();
          reject(
            err instanceof InputError ? err : new InputError('Unable to read this ZIP archive.'),
          );
        };
        zip.on('error', fail);
        zip.on('entry', (entry: yauzl.Entry) => {
          if (failed) return;
          try {
            if (++entries > LIMITS.entries)
              throw new InputError('ZIP contains too many entries.', 413);
            const path = safePath(entry.fileName);
            if (path.endsWith('/')) return zip.readEntry();
            if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000)
              throw new InputError('ZIP symbolic links are not supported.');
            if (entry.isEncrypted())
              throw new InputError('Encrypted ZIP archives are not supported.');
            if (seen.has(path)) throw new InputError('ZIP contains duplicate file paths.');
            seen.add(path);
            // Count declared expansion before opening streams, including excluded entries.
            declared += entry.uncompressedSize;
            if (declared > LIMITS.total * 10)
              throw new InputError('ZIP expands beyond the archive safety limit.', 413);
            if (!includePath(path) || entry.uncompressedSize > LIMITS.file) {
              skipped++;
              return zip.readEntry();
            }
            if (files.length >= LIMITS.files)
              throw new InputError(`Use a project with at most ${LIMITS.files} source files.`, 413);
            zip.openReadStream(entry, (err, stream) => {
              if (err || !stream) return fail(err);
              const chunks: Buffer[] = [];
              let size = 0;
              stream.on('data', (chunk: Buffer) => {
                size += chunk.length;
                total += chunk.length;
                if (size > LIMITS.file || total > LIMITS.total) {
                  stream.destroy();
                  fail(new InputError('Expanded source exceeds the size limit.', 413));
                } else chunks.push(chunk);
              });
              stream.on('error', fail);
              stream.on('end', () => {
                if (failed) return;
                const content = decodeSource(Buffer.concat(chunks));
                if (content === null) skipped++;
                else files.push({ path, content });
                zip.readEntry();
              });
            });
          } catch (err) {
            fail(err);
          }
        });
        zip.on('end', () => {
          if (failed) return;
          const first = files[0]?.path.split('/')[0];
          if (
            first &&
            !['src', 'app', 'lib', 'tests'].includes(first) &&
            files.every((f) => f.path.startsWith(first + '/'))
          )
            files.forEach((f) => {
              f.path = f.path.slice(first.length + 1);
            });
          resolve({
            files,
            skipped,
            warnings: skipped
              ? [
                  `${skipped} generated, sensitive, binary, unsupported, or oversized files were excluded.`,
                ]
              : [],
          });
        });
        zip.readEntry();
      },
    );
  });
}

export async function ingestUploads(uploads: File[]): Promise<IngestResult> {
  if (!uploads.length) throw new InputError('Choose source files or a ZIP project first.');
  if (uploads.length > LIMITS.files)
    throw new InputError(`Select at most ${LIMITS.files} files.`, 413);
  if (uploads.some((f) => /\.zip$/i.test(f.name))) {
    if (uploads.length !== 1)
      throw new InputError('Upload one ZIP archive at a time, or select multiple source files.');
    const file = uploads[0];
    if (file.size > LIMITS.upload) throw new InputError('ZIP must be smaller than 25 MB.', 413);
    return unzipProject(Buffer.from(await file.arrayBuffer()));
  }
  const result: IngestResult = { files: [], skipped: 0, warnings: [] };
  const seen = new Set<string>();
  let total = 0;
  for (const file of uploads) {
    const path = safePath(file.name);
    if (seen.has(path))
      throw new InputError('Duplicate file names. Upload a folder or ZIP to preserve paths.');
    seen.add(path);
    total += file.size;
    if (total > LIMITS.total)
      throw new InputError('Combined source must be smaller than 20 MB.', 413);
    if (!includePath(path) || file.size > LIMITS.file) {
      result.skipped++;
      continue;
    }
    const content = decodeSource(new Uint8Array(await file.arrayBuffer()));
    if (content === null) result.skipped++;
    else result.files.push({ path, content });
  }
  if (result.skipped)
    result.warnings.push(
      `${result.skipped} sensitive, unsupported, binary, or oversized files were excluded.`,
    );
  return result;
}
