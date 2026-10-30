FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3100
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# Explicit grammar assets avoid relying on opaque require/wasm tracing.
COPY --from=build --chown=node:node /app/node_modules/tree-sitter-wasms/out/tree-sitter-c_sharp.wasm ./node_modules/tree-sitter-wasms/out/tree-sitter-c_sharp.wasm
COPY --from=build --chown=node:node /app/node_modules/tree-sitter-wasms/out/tree-sitter-python.wasm ./node_modules/tree-sitter-wasms/out/tree-sitter-python.wasm
USER node
EXPOSE 3100
CMD ["node", "server.js"]
