import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['typescript', 'yauzl', 'web-tree-sitter', 'tree-sitter-wasms'],
  outputFileTracingIncludes: {
    '/api/**': [
      './node_modules/tree-sitter-wasms/out/tree-sitter-c_sharp.wasm',
      './node_modules/tree-sitter-wasms/out/tree-sitter-python.wasm',
      './node_modules/web-tree-sitter/*.wasm',
    ],
  },
  turbopack: { root: process.cwd() },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'no-store' },
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
          },
        ],
      },
    ];
  },
};
export default config;
