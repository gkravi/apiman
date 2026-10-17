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

## Next (Phase 2)

Pre-request/test scripts (`pm.*` API in an isolated sandbox), collection runner with data files,
persistent cookie jar, OAuth 2.0 / Digest / AWS SigV4, proxy and client certificates, OpenAPI import,
then a CLI runner built on `src/core`.
