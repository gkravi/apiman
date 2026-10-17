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
```

## CLI

`npm run build` also produces `out/cli/apiman.cjs` (exposed as the `apiman` bin), a Newman-style
runner that shares the app's core — same executor, sandbox, cookie jar and runner:

```bash
apiman run collection.json -e env.json -d data.csv -n 3 --folder Users \
  --env-var token=abc -r cli,json,junit --reporter-junit-export results.xml \
  --export-environment env.after.json --bail
```

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
    curl.ts        cURL import/export
    postman.ts     Postman Collection v2.0/2.1 + environment import/export
    codegen.ts     snippets: cURL, fetch, axios, Python requests
    tree.ts        immutable collection-tree helpers
  cli/         apiman command-line runner and its cli/json/junit reporters
  main/        Electron main process: window, IPC, JSON workspace storage, OAuth sign-in window
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

Not yet supported: `setTimeout` delays in scripts, `pm.cookies.jar()`, WebSocket/GraphQL schema/gRPC.

## Next (Phase 4)

GraphQL schema introspection and autocomplete, WebSocket and Server-Sent Events, gRPC,
mock servers from saved examples, and app packaging (signed installers).
