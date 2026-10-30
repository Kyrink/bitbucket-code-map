import { createHash, timingSafeEqual } from 'node:crypto';
import { InputError } from './limits';
export function authorize(request: Request) {
  const origin = request.headers.get('origin');
  const requestUrl = new URL(request.url);
  let external: URL;
  try {
    external = new URL(`${requestUrl.protocol}//${request.headers.get('host') || requestUrl.host}`);
  } catch {
    throw new InputError('Invalid request host.', 403);
  }
  if (
    external.username ||
    external.password ||
    external.pathname !== '/' ||
    external.search ||
    external.hash
  )
    throw new InputError('Invalid request host.', 403);
  const expected = process.env.INTERNAL_ORIGIN || external.origin;
  if (
    !process.env.INTERNAL_ACCESS_TOKEN &&
    !['localhost', '127.0.0.1', '[::1]'].includes(external.hostname)
  )
    throw new InputError('Configure a workspace access key before using a non-local host.', 403);
  if (request.method !== 'GET' && origin !== expected)
    throw new InputError('This request must come from the application.', 403);
  if (request.headers.get('sec-fetch-site') === 'cross-site')
    throw new InputError('Cross-site requests are not allowed.', 403);
  const required = process.env.INTERNAL_ACCESS_TOKEN;
  if (!required && process.env.NODE_ENV === 'production')
    throw new InputError(
      'The administrator must configure INTERNAL_ACCESS_TOKEN before serving this app.',
      503,
    );
  if (required) {
    const received = request.headers.get('x-internal-token') ?? '';
    const digest = (value: string) => createHash('sha256').update(value).digest();
    if (!timingSafeEqual(digest(received), digest(required)))
      throw new InputError('Enter the internal workspace access key to continue.', 401);
  }
}
