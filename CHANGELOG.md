# Changelog

All notable changes to ApiMan. Versions follow [semantic versioning](https://semver.org).

## Unreleased

### Changed
- **New brand.** A new logo (an "A" sending a request) and app icon, an iris → azure → cyan palette
  replacing the orange accent (which was Postman's brand colour), cooler ink-tinted dark surfaces,
  gradient primary buttons and active-tab indicators, and line icons in place of emoji throughout.
- The documentation site, README and exported HTML docs use the new brand; new hero banner and
  social preview image.

### Added
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
