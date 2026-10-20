# Changelog

All notable changes to ApiMan. Versions follow [semantic versioning](https://semver.org).

## 0.5.1 — 2026-10-19

### Fixed
- **macOS: "ApiMan is damaged and can't be opened."** The 0.5.0 macOS downloads had an invalid
  signature. Builds are now validly signed (ad-hoc until a Developer ID is configured), and the
  release workflow refuses to publish a macOS build whose signature doesn't verify.

### Security
- **Security audit** ([report](docs/security/audit.md)) with an
  [enterprise deployment guide](docs/security/enterprise.md) and a [security policy](SECURITY.md).
- **Credentials are encrypted at rest** with the OS keychain (passwords, tokens, client secrets,
  AWS keys, certificate passphrases, cookies, secret variables), and `workspace.json` is readable by
  your user only.
- **Imported collections can't upload your files**: file attachments are cleared on import. The
  CLI only uploads files inside the working directory (`--working-dir`, `--insecure-file-read`).
- **Mock servers** only allow CORS from local origins and reject non-local `Host` headers
  (DNS rebinding).
- A script that runs out of memory no longer disables scripting until restart.
- Hardened Electron: IPC only from the app's own page, exact-match navigation guard, no device
  permissions or `<webview>`, and fuses that switch off `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and
  `--inspect` and enforce ASAR integrity in packaged builds.
- CI: `npm audit` gate, CodeQL and Dependabot. Releases ship SHA-256 checksums and a CycloneDX SBOM.

### Changed
- **New brand.** A new logo (an "A" sending a request) and app icon, an iris → azure → cyan palette
  replacing the orange accent (which was Postman's brand colour), cooler ink-tinted dark surfaces,
  gradient primary buttons and active-tab indicators, and line icons in place of emoji throughout.
- The documentation site, README and exported HTML docs use the new brand; new hero banner and
  social preview image.

### Added
- **Managed policies** for enterprise deployments
  ([guide](docs/security/enterprise.md#managed-policies)). An administrator-only `policy.json`
  (or a macOS configuration profile) can turn off scripts, `pm.sendRequest` and mock servers,
  allow-list or block-list destination hosts (HTTP and every redirect, WebSocket, SSE, gRPC),
  require TLS verification, enforce a proxy and CA bundle, and set history retention. The policy is
  enforced in the main process; locked controls show **Managed by your organisation**. The CLI
  applies the same rules with `--policy <file>`.
- **macOS `.pkg` installer** for MDM deployment (Jamf, Intune, Kandji). The release pipeline signs
  and notarises it with a Developer ID Installer certificate when one is configured, and Windows
  builds can be signed with Azure Trusted Signing. The enterprise guide lists the
  [signing requirements](docs/security/enterprise.md#code-signing-and-compliance) managed fleets
  usually have.
- **Request chaining** (Insomnia/Yaak-style): `{{ $response('Login', '$.token') }}` inserts part of
  another request's response — body, JSONPath match, status or header — sending that request first
  when needed (`'if-missing'`, `'always'`, `'never'` or a max age in seconds), with its auth,
  scripts, variables and cookies. Cycles are detected. **Copy reference** in the JSON filter row
  builds one for you.
- **Template functions**: `$prompt`, `$base64`, `$urlEncode`, `$hash`, `$hmac`, `$uuid`, `$now`,
  `$random`, `$jsonPath`, `$lower`, `$upper`, `$trim` and more, nestable, in every request field and
  live-protocol message. They deliberately can't read files or environment variables.
- **Command palette** (⌘K / ⌘P): fuzzy search across requests, open tabs, environments, recent history
  and ~25 commands; `>` for commands only.
- **Light theme**, with System / Light / Dark switching from the top bar, Settings or the palette.
- **Bulk edit** for params, headers and URL-encoded bodies (`key: value` per line, `//` to disable).
- **JSONPath response filter** for JSON bodies (filters, recursion, slices, regex; jq-style paths too).
- Comprehensive documentation in [`docs/`](docs/README.md): user guide, scripting API and CLI
  references, architecture, contributing and release guides, with screenshots.
- Scripts can use top-level `await` (e.g. `const res = await pm.sendRequest(…)`), as in Postman.

### Fixed
- The Preview tab showed non-HTML bodies as light grey text on white; it's now readable.
- `pm.variables.replaceIn()` now supports every dynamic variable, not just five.
- The CLI creates missing folders for report and export paths (e.g. `reports/junit.xml`).
- Unknown CLI options print a short usage error (exit code 2) instead of a stack trace.
- The collection runner, mock server and monitor dialogs close with Escape.
- A monitor run with no failures shows "Everything passed." in green instead of red.
- Spacing under the OAuth 2.0 "Use PKCE" option.

### Changed
- The version number lives only in `package.json`; the CLI and `User-Agent` read it at build time.

## 0.5.0 — 2026-10-16

### Added
- gRPC server reflection (v1 with v1alpha fallback): discover services without `.proto` files.
- Saved message templates for WebSocket and gRPC streams.
- Markdown docs on requests, folders and collections; HTML documentation export from the app and
  `apiman docs`.
- Scheduled monitors with run history, pass rate and desktop notifications.
- GitHub Actions CI (Ubuntu, macOS, Windows) and a release workflow that builds macOS, Windows and
  Linux installers, with optional signing and notarisation.

### Fixed
- OAuth 2.0 token refresh no longer re-sends the scope, which strict providers rejected with
  `invalid_scope` (RFC 6749 §6).
- Links clicked inside the app open in the system browser instead of replacing the app window.

## 0.4.0

### Added
- GraphQL schema introspection with autocomplete and validation.
- WebSocket and Server-Sent Events, with a live message log.
- gRPC with `.proto` files: unary, server-, client- and bidirectional streaming.
- Saved response examples and local mock servers.
- Installers via electron-builder, app icon, hardened-runtime entitlements.

## 0.3.0

### Added
- Cookie jar (RFC 6265) shared by requests, runs and scripts, with a cookie manager.
- Auth: Digest, AWS Signature V4, OAuth 2.0 (authorization code + PKCE, client credentials, password, refresh).
- Proxy with bypass list and CONNECT tunnelling; extra CA and per-host client certificates.
- OpenAPI 3 / Swagger 2 import (JSON and YAML).
- `require('crypto-js')`, `require('lodash')`, `require('uuid')` in scripts.
- `apiman` command-line runner with cli, json and junit reporters.

## 0.2.0

### Added
- Pre-request and post-response scripts in a QuickJS sandbox with the Postman-compatible `pm` API.
- Test results, console panel, script snippets.
- Collection runner with iterations, delay, CSV/JSON data files and `setNextRequest`.

## 0.1.0

### Added
- HTTP request builder: params, headers, all body types, settings.
- Response viewer with pretty/raw/preview, headers, cookies and timing breakdown.
- Collections, folders, environments, globals, history, tabs.
- Basic, Bearer and API key auth with inheritance.
- Postman v2.x and cURL import; Postman export; code snippets.
