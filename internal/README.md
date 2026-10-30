# GitDiagram Internal

A self-hosted code explorer for Bitbucket Cloud, source files, folders, and ZIP projects. Built in the GitDiagram repository using Next.js, React, Mermaid and its source sanitization rules. This entry point runs independently of the upstream public GitHub site: no Redis, R2, analytics, billing, or model-provider accounts are required.

## Start locally

Requires **Node.js 22.12+** (Node 24 recommended) and npm.

```sh
cd internal
npm ci
npm run dev
```

Open <http://127.0.0.1:3100>. Choose **Open sample project** for a map of C#, Python, and PowerBuilder fixtures, or upload your own code. No credentials are required for uploads.

To use private Bitbucket repositories, paste the repository URL and expand **Private repository access**. Supply an Atlassian email plus an API token with `read:repository:bitbucket`, or a repository access token without an email. Tokens are held in page memory, submitted only to this server and Bitbucket's API, cleared after successful analysis, and never put in local storage, graph output, or logs. Alternatively copy `.env.example` to `.env.local`, set `BITBUCKET_EMAIL` and `BITBUCKET_TOKEN`, and restart. The server-wide token gives all authorized tool users the same repository access: use a dedicated read-only account limited to the intended repositories.

The default branch is used unless a branch, tag, or commit is supplied. Every import pins to one commit before walking the tree, so a moving branch cannot produce a mixed snapshot. The connector performs GET requests only. It does not clone or execute the repository.

## Explore a map

- **Modules** groups files by directory. Select a module to drill into its files, then expand its neighboring connections with **Depth**.
- **Files** shows import, type, project, inheritance, and DataWindow dependencies. Selecting a file opens its source and focuses its neighborhood. Set **Depth** to one, two, or three connections.
- **Call flow** shows functions, methods, and events with incoming and outgoing calls. Select a symbol to open its definition and focus its calls; increasing **Depth** follows calls across files. Select an arrow to open the source line of the reference. Unresolved calls can be included explicitly.
- **Follow** chooses both directions, outgoing uses/calls, or incoming users/callers; **Depth** controls how many steps to follow. Arrows always point from the user/caller to its dependency, including separate arrows for reciprocal links. All relationships between reached nodes remain visible.
- The **Connections** inspector separates uses/calls from used-by/called-by references. Selecting a symbol narrows this to that function or event, including calls within the same file. Reciprocal links are marked.
- Arrow labels identify the relationship and the number of source references when grouped. Select an arrow to inspect every reference, its confidence, and exact source line; **Open target definition** jumps to the called function. Bitbucket source links use the pinned commit.
- **Start at…** suggests project documentation and functions with calls but no detected callers (one per file, up to eight). These are reading suggestions, not confirmed runtime entry points; framework-driven, isolated, and cyclic entry points may not be suggested.
- Use **Back** to return to a previous focus, or **Reset focus** to widen the view. The fullscreen control expands the diagram and source inspector; Escape exits. Embedded browsers without native fullscreen use the full tab. Close the source pane to give the diagram all the space.
- Search file paths or symbol names in the sidebar; drag to pan, scroll to zoom at the pointer, or use the zoom/fit controls. Keyboard users can select nodes and arrows with Enter/Space, zoom with +/- and reset with 0.
- Export the current view as SVG or Mermaid, or the complete analysis as JSON. JSON omits source text but still contains repository paths, names, symbols, and relationships.

Maps and source text live in the current browser session. Reloading clears them; nothing is written to a server database or browser storage. Exports are deliberate local downloads. There is no saved-map history or multi-repository federation.

## Language support and honest limits

| Language     | What is analyzed                                                                                                                                                     | Limits                                                                                                                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C# / .NET    | Syntax-tree classes, methods, constructors, fields/parameter types, imports inferred from type usage, method-call candidates, `.csproj` project and NuGet references | Not Roslyn/MSBuild: overload selection, DI registrations, conditional compilation, generated code, partial classes, newer syntax, and reflection may be incomplete. Ambiguous calls remain unresolved. |
| Python       | Syntax-tree definitions, imports, relative imports, aliases, and call candidates                                                                                     | Runtime rebinding, decorators, namespace packages, `sys.path` modifications, and dynamic imports are not executed.                                                                                     |
| PowerBuilder | Exported objects, inheritance, event scripts, functions/subroutines, object creation, member-call candidates, and DataWindow references                              | Text-pattern analysis, not a PowerScript compiler. Dynamic dispatch, inherited events, SQL, and library paths may need manual review.                                                                  |
| JS / TS      | TypeScript compiler syntax trees, imports/re-exports, relative paths, basic `tsconfig` aliases, workspace package entries, and statically bound calls                | Custom bundler aliases, conditional exports, full tsconfig inheritance, runtime resolution, and generated code are not modeled.                                                                        |
| Other source | Conservative patterns for imports, declarations, and calls; configuration and documentation are visible as source                                                    | Clearly marked heuristic or source-only.                                                                                                                                                               |

A solid line means a reference has a located source target. Dashed lines mean a candidate or external/unresolved target. These are **static relationships, not proof of runtime execution**. Cross-language API, database, and message-bus connections are not invented.

### PowerBuilder uploads

Export objects as `.srw`, `.sru`, `.srd`, `.srm`, `.srf`, `.srs`, or `.sra` from the Library painter, then ZIP the exported tree. `.pbt`, `.pbg`, `.pbs`, and `.srj` text are accepted too. UTF-8 and BOM-marked UTF-16 exports are supported. Binary `.pbl` and `.pbd` files cannot be analyzed directly and are excluded. A single exported object works, but a project export resolves more targets.

## Team deployment

The application is designed for a trusted internal workspace. Production requires `INTERNAL_ACCESS_TOKEN`; the interface asks users for that key. This is a shared workspace gate, not individual accounts, RBAC, or SSO. Put the service behind your existing authenticated HTTPS reverse proxy/VPN for organization access. Set `INTERNAL_ORIGIN` to the browser-visible origin if the reverse proxy changes it.

```sh
cp .env.example .env
# Edit .env: set a strong INTERNAL_ACCESS_TOKEN and optional Bitbucket credentials.
docker compose up --build -d
```

Compose binds to loopback on port 3100. Configure your internal reverse proxy to reach it and allow 25 MB request bodies. The container runs without root, drops capabilities, and uses a read-only filesystem. No production deployment is performed by the repository scripts.

Without Docker:

```sh
npm run build
# Set INTERNAL_ACCESS_TOKEN in .env.local or the process environment first.
npm start
```

`npm start` also binds to loopback. For a controlled container/network deployment use `next start --hostname 0.0.0.0 --port 3100` behind your access boundary.

## Limits and data handling

- 25 MB upload body; 20 MB expanded supported source; 512 KB per file; 800 source files.
- ZIPs are read in memory, never extracted to disk. Traversal, absolute paths, duplicate entries, symbolic links, encrypted archives, invalid UTF encodings, and excessive expansion are rejected or excluded.
- Common generated folders, binary files, `.env` variants, private-key files, and common credential files are excluded. This filter is not a comprehensive secret scanner.
- Bitbucket requests have deadlines, pagination validation, a fixed destination, a pinned revision, bounded concurrency, and request/file/byte limits. Credentials are never forwarded to redirect targets.
- At most two analysis requests per Node process run concurrently. A load-balanced deployment needs limits at the proxy as well.
- Views show at most 70 nodes for readability. The full map remains available in the sidebar and JSON export. Select a file and focus its neighborhood to explore the rest.
- There is no telemetry or AI request in the internal application. Next.js CLI telemetry can be disabled with `NEXT_TELEMETRY_DISABLED=1` in your environment.

## Verify and maintain

```sh
npm test
npm run typecheck
npm run build
```

Tests cover C#/Python/PowerBuilder/TypeScript resolution, ambiguity, ZIP/path/secret handling, UTF-16 exports, origin and workspace-key checks, Mermaid escaping, and mocked Bitbucket authentication/pagination/commit pinning. Live private-repository access requires your own credentials and is not covered by the fixtures.

`server/analyze.ts` builds the graph; `server/native-analysis.ts` handles C#, Python, and PowerBuilder; `server/bitbucket.ts` fetches read-only snapshots; `server/ingest.ts` validates uploads; `lib/graph.ts` derives views; `components/workspace.tsx` contains the explorer. `lib/mermaid-security.ts` is a copy of the upstream source sanitizer, retained under the repository's MIT license.

Primary integration references: [Bitbucket source API](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-source/), [Bitbucket authentication](https://developer.atlassian.com/cloud/bitbucket/rest/), [Tree-sitter WebAssembly bindings](https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web).
