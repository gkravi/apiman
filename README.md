# ApiMan

A Postman-style API client built with Electron, React and TypeScript.

## Run

```bash
npm install
npm run dev        # hot-reloading dev app
npm run build      # production build into out/
npm start          # run the production build
npm test           # core unit + integration tests
npm run typecheck
npm run cli -- run my.postman_collection.json -e dev.postman_environment.json
npm run dist       # installers for this OS into dist/ (macOS: .dmg + .zip)
npm run dist:dir   # unpacked app only — quickest way to try a packaged build
```

### Installers and signing

`electron-builder.config.cjs` builds a DMG/zip on macOS, an NSIS installer on Windows (x64 + arm64)
and AppImage/deb on Linux. Builds are unsigned unless credentials are in the environment:

- **macOS** — a Developer ID identity in the keychain, or `CSC_LINK` + `CSC_KEY_PASSWORD`;
  notarisation runs when `APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER`
  (or `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`) are set.
- **Windows** — `WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD`.

Unsigned macOS builds open with right-click → Open the first time.

### CI and releases (GitHub Actions)

- `.github/workflows/ci.yml` — on every push/PR: typecheck, tests and build on Ubuntu and macOS,
  typecheck + build on Windows (the TLS tests need openssl), plus a CLI smoke test.
- `.github/workflows/release.yml` — push a tag like `v0.5.0` to build macOS (arm64 + x64), Windows
  and Linux installers and attach them to a **draft** GitHub release.

Signing in CI is optional; add these repository secrets to turn it on:

| Secret | What |
|---|---|
| `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD` | base64 of a *Developer ID Application* `.p12` and its password |
| `APPLE_API_KEY_BASE64` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER` | App Store Connect API key (`.p8`, base64) for notarisation |
| `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` | base64 of a Windows code-signing `.pfx` and its password |

`base64 -i cert.p12 | pbcopy` produces the value for a `*_LINK` secret.

## CLI

`npm run build` also produces `out/cli/apiman.cjs` (exposed as the `apiman` bin), a Newman-style
runner that shares the app's core — same executor, sandbox, cookie jar and runner:

```bash
apiman run collection.json -e env.json -d data.csv -n 3 --folder Users \
  --env-var token=abc -r cli,json,junit --reporter-junit-export results.xml \
  --export-environment env.after.json --bail
```

`apiman docs collection.json -o api.html` writes the collection's HTML documentation page.

It accepts Postman collections and OpenAPI/Swagger specs, supports `--proxy`, `--ca-cert`,
`--ssl-client-cert/key/pfx`, `--insecure`, `--timeout-request`, `--delay-request`, and exits
`0` (all passed), `1` (failed tests or request errors) or `2` (bad input). Run `apiman --help` for all flags.

## Layout

```
src/
  core/        UI-free engine — reusable by a future CLI runner
    types.ts       data model (collections, requests, environments, responses)
    variables.ts   {{var}} resolution, scope priority, dynamic vars ({{$guid}}…)
    url.ts         URL bar <-> params table sync
    prepare.ts     editor request -> wire request (variables, inherited auth, body)
    executor.ts    Node http/https sender: redirects, gzip/br, timings, cancel (main process only)
    sandbox.ts     QuickJS (WASM) script sandbox with memory/CPU limits (main process only)
    sandbox-prelude.ts  the pm API + chai-style expect, evaluated inside the sandbox
    run.ts         request lifecycle (pre-request → send → tests) and the collection runner
    varsync.ts     script variable changes ↔ variable tables; CSV/JSON data files
    cookies.ts     RFC 6265 cookie jar (persisted in the workspace)
    digest.ts, awsv4.ts, oauth2.ts   Digest challenge, SigV4 signing, OAuth 2.0 grants (Node only)
    openapi.ts     OpenAPI 3 / Swagger 2 (JSON or YAML) → collection
    sandbox-libs.ts  crypto-js and lodash sources embedded for require() in scripts
    graphql.ts     introspection request + schema building for autocomplete
    realtime.ts, sse.ts   WebSocket and Server-Sent Events sessions (Node only, except the SSE parser)
    grpc.ts        .proto loading, example messages, unary/streaming calls (Node only)
    grpc-reflection.ts  server reflection client (v1, falling back to v1alpha) (Node only)
    markdown.ts, docs.ts   safe Markdown renderer and the HTML documentation generator
    mockRoutes.ts, mock.ts   saved-example routing and the mock HTTP server (server is Node only)
    curl.ts        cURL import/export
    postman.ts     Postman Collection v2.0/2.1 + environment import/export
    codegen.ts     snippets: cURL, fetch, axios, Python requests
    tree.ts        immutable collection-tree helpers
  cli/         apiman command-line runner and its cli/json/junit reporters
  main/        Electron main process: window, IPC, storage, OAuth sign-in, live sessions, mock servers
  preload/     contextBridge API exposed as window.api
  renderer/    React UI (zustand store, components)
```

Requests are sent from the main process, so there are no CORS or forbidden-header limits.
The workspace is saved to `workspace.json` in the Electron user-data directory.

## Phase 1 features (done)

- Request builder: methods, URL with two-way params sync, headers, body (raw JSON/XML/HTML/text/JS, form-data with files, urlencoded, binary, GraphQL)
- Auth: inherit, none, Basic, Bearer, API key (header/query), inherited through folders and collections
- Response viewer: pretty/raw/preview, headers, cookies, timing breakdown, redirect chain, image preview, copy, save to file
- Collections with nested folders (rename, duplicate, delete), collection variables and auth
- Environments, globals, secret values, unresolved-variable warnings
- Tabs with unsaved-change markers; history grouped by day
- Import: Postman collections/environments, cURL (also by pasting into the URL bar); export to Postman v2.1
- Code generation; shortcuts ⌘↵ send, ⌘S save, ⌘T new tab, ⌘O import

## Phase 2 features (done)

- Pre-request and post-response scripts on requests, folders and collections, run in Postman's order
  (collection → folder → request) inside a QuickJS sandbox: no Node, filesystem or network access,
  64 MB memory cap, 5 s CPU limit per step
- `pm` API: `pm.test`, `pm.expect` (chai-style), `pm.response` (`json()`, `text()`, `to.have.status`, `to.be.ok`, …),
  `pm.request` editing (URL, method, headers, raw body), `pm.environment` / `collectionVariables` / `globals` /
  `variables` / `iterationData`, `pm.sendRequest` (callback or promise), `pm.execution.setNextRequest` / `skipRequest`,
  `pm.info`, `console.*`, `atob`/`btoa`, and legacy `postman.*` helpers
- Variables set by scripts persist to the active environment, collection and globals
- Test Results tab, console panel with level filters, script snippets
- Collection/folder runner: request selection, iterations, delay, CSV/JSON data files, stop on failure,
  setNextRequest flow control, live results by iteration, JSON export
- Postman import/export now includes scripts

## Phase 3 features (done)

- Cookie jar (RFC 6265: domain/path/secure/expiry), applied on every redirect hop, shared by sends,
  runs and `pm.sendRequest`; `pm.cookies`; cookie manager to view, add and delete cookies
- Auth: Digest (MD5, MD5-sess, SHA-256; auth/auth-int), AWS Signature V4 (verified against AWS test
  vectors), OAuth 2.0 — authorization code with PKCE in a sign-in window, client credentials,
  password, refresh — with tokens stored on the request/folder/collection
- Settings: HTTP proxy with auth and bypass list (CONNECT tunnelling for HTTPS), extra CA certificates,
  per-host client certificates (CRT+KEY or PFX)
- OpenAPI 3.x / Swagger 2.0 import (JSON or YAML): folders per tag, `{{baseUrl}}`, path params as
  variables, example bodies generated from schemas, collection auth from security schemes
- Script libraries: `require('crypto-js')`, `require('lodash')`, `require('uuid')`, plus the `CryptoJS` and
  `_` globals and a secure `crypto.getRandomValues`
- `apiman` CLI runner (see above)

Not yet supported: `setTimeout` delays in scripts, `pm.cookies.jar()`.

## Phase 4 features (done)

- **GraphQL**: fetch the schema by introspection (using the request's auth, cookies and proxy), then
  schema-aware autocomplete and validation in the query editor, plus Prettify
- **WebSocket**: connect with headers, auth, cookies and sub-protocols, through the proxy and client
  certificates; send text/JSON messages; full message log
- **Server-Sent Events**: GET or POST streams (e.g. LLM streaming APIs), named events and ids
- **gRPC**: load .proto files, pick service and method, generated example messages; unary,
  server-streaming, client-streaming and bidirectional calls with metadata, TLS and deadlines
- Message log for live connections: sent/received filters, search, expandable pretty JSON
- **Saved examples**: save any response as an example; included in Postman import/export
- **Mock servers**: serve a collection's examples locally with method + path matching, `{{var}}`/`:param`
  wildcards, `x-mock-response-name` / `x-mock-response-code` selection, dynamic variables, CORS, and
  live reload as you edit
- **Packaging**: electron-builder installers with an app icon, hardened-runtime entitlements and
  optional signing/notarisation

Collection runs and the CLI skip WebSocket, SSE and gRPC requests (they need a live session).

## Phase 5 features (done)

- **gRPC server reflection**: discover services and messages from the server (including imported
  and well-known types) instead of loading .proto files
- **Saved messages** for WebSocket and gRPC streams: save, load, or send with one click
- **Documentation**: Markdown descriptions on requests, folders and collections (kept through
  Postman import/export, filled from OpenAPI descriptions); export a self-contained HTML docs page
  from the app or with `apiman docs`
- **Monitors**: run a collection against an environment on a schedule while the app is open, with
  run history, pass rate, failure details and desktop notifications. Monitor runs never change your
  variables or cookies
- Links clicked inside the app open in the system browser instead of replacing the app window

## Next ideas

Team sync and shared workspaces (needs a hosted backend), Socket.IO, OAuth 2.0 device/implicit
grants, request chaining visualiser, and CI templates for `apiman run`.
