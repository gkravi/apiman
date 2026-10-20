# Security audit

| | |
|---|---|
| **Version audited** | 0.5.0 + unreleased changes (October 2026) |
| **Date** | 17 October 2026 |
| **Type** | Internal white-box review: source code review, threat modelling, automated tests and manual testing of a packaged-equivalent build |
| **Result** | 9 issues found (1 high, 3 medium, 4 low, 1 informational); all 9 fixed. Plus 3 items accepted or open for the roadmap |

!!! note "What this is, and isn't"
    This is a self-assessment by the project, done in the open with the code. It is **not** an
    independent third-party penetration test. Organisations that need one should treat this report
    as the starting point for their own review; an external assessment is on the
    [roadmap](#roadmap).

## Summary

ApiMan's architecture was already defensive. It runs scripts in a WebAssembly interpreter rather
than Node.js. The app window has context isolation, sandboxing and a strict Content Security
Policy. It has no accounts, no cloud and no telemetry.

The review found that the main risks come from **content written by someone else**: shared
collections, server responses and websites open in your browser while ApiMan runs. The most serious
issue was that an imported collection could make ApiMan upload a local file of the attacker's
choosing.

Every finding below has been fixed, and each fix has a regression test in
[`src/core/security.test.ts`](https://github.com/gkravi/apiman/blob/master/src/core/security.test.ts)
or was verified in the running app.

## Scope

| In scope | Out of scope |
|---|---|
| Electron main process, preload bridge and renderer | Servers you choose to send requests to |
| Script sandbox (`pm` API, `pm.sendRequest`, libraries) | The Electron/Chromium/Node.js runtimes themselves (kept up to date instead) |
| Request pipeline: HTTP, TLS, proxies, cookies, auth, redirects | Physical access or an attacker already running code as your user |
| Importers (Postman, OpenAPI, cURL) and exporters | Third-party identity providers used for OAuth |
| Mock servers, monitors, WebSocket/SSE/gRPC | |
| Local storage (`workspace.json`) | |
| `apiman` CLI | |
| Build and release pipeline | |

## Threat model

| Actor | Can control | Wants to |
|---|---|---|
| **Author of a shared collection** | Requests, scripts, file paths, docs, variables | Read local files or secrets; run code; send data to their server |
| **Malicious or compromised API server** | Responses, headers, cookies, redirects | Run code in the app; steal tokens for other hosts |
| **Website open in your browser** | Requests from the browser to `localhost` | Read mock server data; reach the app's internals |
| **Another local user or malware on a shared machine** | Read access to files | Harvest credentials from the workspace file |
| **Supply-chain attacker** | A dependency or the build | Ship modified code to users |

## Findings

| ID | Severity | Finding | Status |
|---|---|---|---|
| SEC-01 | **High** | Imported collections could upload arbitrary local files | Fixed |
| SEC-02 | Medium | Credentials stored in plain text, readable by other local users | Fixed |
| SEC-03 | Medium | Mock servers readable by any website (open CORS + DNS rebinding) | Fixed |
| SEC-04 | Medium | A script exhausting memory disabled scripting until restart | Fixed |
| SEC-05 | Low | Main-window navigation allowed any `file://` URL | Fixed |
| SEC-06 | Low | IPC handlers didn't verify which frame called them | Fixed |
| SEC-07 | Low | Web content could request device permissions | Fixed |
| SEC-08 | Low | Packaged app honoured `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect` | Fixed |
| SEC-09 | Info | No automated dependency, code-scanning or SBOM checks in CI | Fixed |
| SEC-10 | Info | Installers are not code-signed | Open — pipeline ready, needs certificates |
| SEC-11 | Info | No auto-update channel for security fixes | Open — roadmap |
| SEC-12 | Info | Moderate advisory in build-time tooling (`sprintf-js` via electron-builder) | Accepted — not shipped |

### SEC-01 · High · Imported collections could upload arbitrary local files

**Issue.** Postman collections store form-data file fields and binary bodies as absolute paths.
ApiMan imported them as they were and read the file when the request was sent. A collection shared
by an attacker could contain a request that posts `~/.ssh/id_rsa` or `~/.aws/credentials` to their
server, and that file would be uploaded the first time the victim clicked **Send** or ran the
collection, including in CI with the CLI.

**Fix.**

- The app clears every file path when a collection is imported. The fields are kept, and a notice
  tells the user to pick the files again (`detachFiles` in `src/core/security.ts`).
- The CLI resolves file paths against a working directory (default: the collection's folder) and
  refuses to start if any path leads outside it. `--working-dir` and `--insecure-file-read` are the
  explicit opt-outs.
- Scripts can't set file paths: `pm.sendRequest` only supports text bodies.

**Verified.** Unit tests cover both fixes. In the running app, importing a crafted collection
showed the notice, and the saved workspace contained no path.

### SEC-02 · Medium · Credentials stored in plain text

**Issue.** `workspace.json` held passwords, tokens, OAuth client secrets, AWS keys, certificate
passphrases, cookies and secret variables in plain text. It was created with default permissions,
typically `0644`, which on shared Linux and macOS machines is readable by other users. Backups
and sync tools copied the secrets too.

**Fix.**

- Credential fields are encrypted with Electron `safeStorage`, which is backed by the macOS
  Keychain, Windows DPAPI or the Linux Secret Service (`src/core/secretsAtRest.ts`,
  `src/main/storage.ts`). Existing plain-text files are migrated on the next save.
- The file is written with mode `0600`.
- If a value can't be decrypted (for example after a keychain reset), it is cleared instead of
  breaking the app.
- On Linux without a keyring, Electron only offers obfuscation, so ApiMan keeps plain text there
  and the documentation says so.

**Verified.** In the running app, the file on disk contained `apiman-enc:v1:…` in place of every
secret, had mode `-rw-------`, and the values loaded back correctly.

### SEC-03 · Medium · Mock servers readable by any website

**Issue.** Mock servers listen on `127.0.0.1`, but they echoed any `Origin` in
`Access-Control-Allow-Origin` with credentials allowed. Any website open in the user's browser
could therefore `fetch('http://localhost:<port>/…')` and read the responses. Mock responses are
often saved examples of real API data. The server also accepted any `Host` header, which allows
DNS rebinding.

**Fix.**

- CORS is only granted to local origins: `localhost`, `*.localhost`, `127.x` and `[::1]`.
- Requests whose `Host` isn't a local name are rejected with `421 Misdirected Request`.

**Verified.** Unit tests send requests with forged `Host` and `Origin` headers to a live mock
server.

### SEC-04 · Medium · Out-of-memory script disabled scripting

**Issue.** When a script hit the 64 MB sandbox memory limit, freeing the QuickJS runtime triggered
an internal assertion. That aborted the shared WebAssembly module. Every later script then failed
until the app restarted, so a single hostile script in a shared collection could break scripting,
monitors and the runner.

**Fix.** The sandbox catches a failed teardown, discards the broken module, and loads a fresh one
for the next script (`src/core/sandbox.ts`).

**Verified.** A regression test runs a memory bomb, then deep recursion, then a normal script,
which passes.

### SEC-05 · Low · Main-window navigation allowed any `file://` URL

**Issue.** The `will-navigate` guard allowed any URL beginning with `file://`. A link could
therefore navigate the privileged app window to another local HTML file, which would then run
with access to the preload API.

**Fix.** Navigation is allowed only to the app's own `index.html` (or the dev-server origin in
development). Everything else is blocked, and web links open in the system browser.

### SEC-06 · Low · IPC handlers didn't verify the caller

**Issue.** The main process answered IPC from any frame. Today only the app page has the preload
script, so this was defence in depth. Any future embedded content would otherwise have reached
file dialogs, the request executor and storage.

**Fix.** Every handler goes through `handle()` in `src/main/ipc.ts`. It requires the call to come
from the main frame of a window showing the app's own URL.

**Verified.** In the running app, IPC works from the app page, and the API is not present in
child frames.

### SEC-07 · Low · Web content could request device permissions

**Issue.** No permission handler was installed, so a page shown in the OAuth sign-in window could
prompt for camera, microphone, geolocation, notifications and similar permissions.

**Fix.** Permission requests are denied for the app and OAuth sessions, except sanitised clipboard
writes. `<webview>` is blocked in every web contents, and new windows are denied, with http(s)
links going to the system browser.

### SEC-08 · Low · Runtime switches usable on the packaged app

**Issue.** Electron apps honour `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect` by default.
Malware can use these to run arbitrary code under ApiMan's signature and permissions ("living off
the land").

**Fix.** The packaged app now sets Electron fuses (`electron-builder.config.cjs`):

- `RunAsNode`, `NodeOptions` and the `--inspect` arguments are off;
- cookie encryption is on;
- the embedded ASAR integrity check is on, and the app only loads from the ASAR.

### SEC-09 · Info · No automated supply-chain checks

**Fix.**

- CI runs `npm audit --omit=dev --audit-level=high` and fails on high or critical advisories in
  shipped dependencies.
- CodeQL (`security-extended` queries) runs on every push, every pull request, and weekly.
- Dependabot opens weekly update PRs for npm and GitHub Actions.
- Each release publishes SHA-256 checksums for every installer and a CycloneDX SBOM.

### SEC-10 · Info · Unsigned installers (open)

macOS Gatekeeper and Windows SmartScreen warn on unsigned builds, and users can't verify who
published them. The release pipeline already signs and notarises when certificates are provided
(see [Releasing](../development/releasing.md)). It covers the app, a signed and notarised `.pkg`
for MDM, and Azure Trusted Signing on Windows. This needs an Apple Developer ID ($99/year) and a
Windows code-signing certificate or Azure Trusted Signing account. Until then, verify downloads
with `SHA256SUMS-*.txt`.

**Related fix.** The v0.5.0 macOS release shipped with an invalid ad-hoc signature, so macOS
reported it as "damaged". Builds are now ad-hoc signed by the fuses step, and the release workflow
refuses to publish a macOS build whose signature doesn't verify. The signing requirements
enterprises ask for are in the
[enterprise guide](enterprise.md#code-signing-and-compliance).

### SEC-11 · Info · No auto-update (open)

Users only get security fixes by downloading new releases. A signed auto-update channel is on the
roadmap. It depends on SEC-10.

### SEC-12 · Info · Build-tool advisory (accepted)

`npm audit` reports a moderate denial-of-service advisory in `sprintf-js`. It is pulled in by
electron-builder's download tooling at build time and is not part of the shipped app. The only
available fix downgrades electron-builder. Dependabot tracks it.

## Controls verified

These were reviewed, and where possible tested, with no issues found:

| Area | Control | Evidence |
|---|---|---|
| Script sandbox | QuickJS in WebAssembly: no `process`, `require` of Node modules, filesystem, `fetch` or `XMLHttpRequest`; constructor-chain escapes return nothing | `security.test.ts`, `scripting.test.ts` |
| Script sandbox | 5 s CPU per step, 64 MB memory, 1 MB stack, 25 `pm.sendRequest` calls | `security.test.ts` |
| Template functions | No file or environment access by design | `src/core/templates.ts` |
| Renderer | `contextIsolation`, `sandbox`, no `nodeIntegration`; CSP `script-src 'self'` | `src/main/index.ts`, `index.html` |
| HTML preview | `<iframe sandbox="">` with no scripts, forms or same-origin access | `ResponseViewer.tsx` |
| Markdown docs | Escape-first renderer; only http(s), mailto and `#` links | `security.test.ts` |
| External links | Only `http`, `https` and `mailto` reach `shell.openExternal` | `src/main/index.ts` |
| TLS | Verification on by default; per-request opt-out; custom CA and client certificates | `network.test.ts` |
| Redirects | `Authorization` dropped on cross-host redirects | `security.test.ts` |
| Cookies | RFC 6265 domain and path rules; no cross-site cookie setting | `network.test.ts` |
| OAuth 2.0 | PKCE and `state` by default; sign-in in an isolated, sandboxed session | `network.test.ts`, `src/main/oauth.ts` |
| Mock servers | Bound to `127.0.0.1` | `mock.test.ts` |
| Privacy | No telemetry, analytics, crash reporting or update pings | Code review |
| Dependencies | `npm audit` of shipped dependencies: 0 vulnerabilities | CI |

## Residual risks

- **You send what you tell it to.** A request to a malicious server can leak whatever you put in
  it, as with any API client. Review shared collections before sending requests to hosts you
  don't know.
- **Scripts can make network requests.** `pm.sendRequest` can reach anything your machine can,
  including internal networks. This is intentional, as in Postman.
- **Exports contain secrets in plain text.** This matches the Postman file format; it is
  documented.
- **Linux without a keyring** stores secrets in plain text, protected only by file permissions.

## Roadmap

1. Code signing and notarisation for macOS and Windows (SEC-10).
2. A signed auto-update channel (SEC-11).
3. An independent third-party penetration test, with the report available under NDA.
4. ~~Opt-in policy controls for managed deployments~~ — **done**: administrators can turn off
   scripts, `pm.sendRequest` and mock servers, allow-list or block-list hosts, require TLS
   verification, enforce a proxy and CA bundle, and set history retention (see
   [managed policies](enterprise.md#managed-policies)). Still open: allowing only signed or
   allow-listed collections.
5. Optional encryption of the whole workspace with a user passphrase.

## How to reproduce

```bash
npm ci
npm test                       # includes src/core/security.test.ts
npm audit --omit=dev           # shipped dependencies
```
