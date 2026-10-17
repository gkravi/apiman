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
```

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
    curl.ts        cURL import/export
    postman.ts     Postman Collection v2.0/2.1 + environment import/export
    codegen.ts     snippets: cURL, fetch, axios, Python requests
    tree.ts        immutable collection-tree helpers
  main/        Electron main process: window, IPC, JSON workspace storage
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

Not yet supported in scripts: `require()` of libraries (lodash, CryptoJS, …), `pm.cookies`, `setTimeout` delays.

## Next (Phase 3)

Persistent cookie jar, OAuth 2.0 / Digest / AWS SigV4, proxy and client certificates, OpenAPI import,
bundled script libraries (CryptoJS, lodash), then a CLI runner built on `src/core`.
