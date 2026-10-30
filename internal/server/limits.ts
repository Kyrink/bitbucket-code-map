export const LIMITS = {
  upload: 25 * 1024 * 1024,
  total: 20 * 1024 * 1024,
  file: 512 * 1024,
  files: 800,
  entries: 10000,
  requests: 1800,
  symbols: 300,
  calls: 1000,
};
export class InputError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const ignored =
  /(^|\/)(node_modules|vendor|\.git|\.svn|\.hg|\.next|dist|build|coverage|__pycache__|\.venv|venv|target|bin|obj|__MACOSX)(\/|$)/;
const secrets =
  /(^|\/)(\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|id_rsa|id_ed25519|credentials(?:\.json)?|secrets?\.(?:json|ya?ml))$|\.(pem|key|p12|pfx|keystore)$/i;
const extensions =
  /\.(tsx?|jsx?|mjs|cjs|mts|cts|py|java|kt|kts|cs|go|rs|rb|php|vue|svelte|c|h|cpp|hpp|swift|scala|sql|graphql|gql|json|ya?ml|toml|md|css|scss|html|csproj|sln|props|targets|sru|srw|srd|srm|srf|srs|sra|srj|pbt|pbg|pbs)$/i;
export function safePath(input: string): string {
  const path = input.replaceAll('\\', '/');
  if (
    !path ||
    path.length > 500 ||
    path.startsWith('/') ||
    /^[a-z]:/i.test(path) ||
    /[\x00-\x1f\x7f]/.test(path) ||
    path.split('/').some((p) => p === '..' || p === '.')
  )
    throw new InputError('An input contains an unsafe file path.');
  return path;
}
export function includePath(path: string) {
  return (
    !ignored.test(path) &&
    !secrets.test(path) &&
    extensions.test(path) &&
    !/(?:\.min\.js|\.map|(?:package-lock|bun\.lock|yarn\.lock|pnpm-lock)\.?(?:json|yaml)?)$/i.test(
      path,
    )
  );
}
export function decodeSource(bytes: Uint8Array): string | null {
  const encoding =
    bytes[0] === 255 && bytes[1] === 254
      ? 'utf-16le'
      : bytes[0] === 254 && bytes[1] === 255
        ? 'utf-16be'
        : 'utf-8';
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    return text.includes('\0') ? null : text;
  } catch {
    return null;
  }
}
