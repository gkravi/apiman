# Data, privacy and security

## Where your data lives

ApiMan has no account and no cloud sync. Everything stays on your machine, in one file:

| OS | Location |
|---|---|
| macOS | `~/Library/Application Support/ApiMan/workspace.json` |
| Windows | `%APPDATA%\ApiMan\workspace.json` |
| Linux | `~/.config/ApiMan/workspace.json` |

It holds your collections, environments, globals, cookies, settings, monitors and request history.
It's written atomically (to a temporary file, then renamed), so a crash can't leave it half-written.

**Back up** by copying that file while ApiMan is closed. **Move to another computer** by copying it
to the same place there, or export collections and environments and import them.

The OAuth 2.0 sign-in window keeps its own browser session (cookies of the identity provider) in the
same folder, separate from the main app.

### Secrets

Values marked secret (lock icon), tokens, passwords and client-certificate passphrases are **stored in plain
text** in `workspace.json` — the secret flag only masks them in the interface. Protect the file as
you would any credentials file: full-disk encryption (FileVault/BitLocker), and don't commit or share
it. When you share work, export collections and environments instead, and review them for secrets first.

## What leaves your machine

Only the requests you send, to the servers you send them to, and:

- OAuth 2.0 sign-in pages and token requests to the providers you configure,
- `pm.sendRequest` calls your scripts make.

There's no telemetry, analytics or update check.

## How ApiMan protects you

### Scripts run in a sandbox

Collections can contain JavaScript, and you may import collections you didn't write. ApiMan runs
scripts in a separate JavaScript interpreter (QuickJS compiled to WebAssembly) rather than in Node.js
or the app window:

- no file system, process, environment-variable or OS access, and no Node modules;
- network access only through `pm.sendRequest`, which goes through the normal request pipeline;
- CPU (5 s per step), memory (64 MB) and request-count (25 per script) limits, so a hostile or buggy
  script can't hang the app.

### The app window is locked down

- The interface runs with Electron's context isolation and sandboxing; it can't use Node.js
  directly and talks to the main process through a small, fixed set of functions.
- A Content Security Policy blocks remote scripts.
- HTML responses are previewed in a sandboxed frame with scripts disabled.
- Links never navigate the app window; web links open in your default browser.
- Markdown documentation is HTML-escaped and only allows http, https, mailto and in-page links.

### Network safety

- TLS certificates are verified by default. Turning verification off is per request.
- `Authorization` headers are dropped when a redirect goes to another host.
- Cookies follow browser rules, so one site can't set cookies for another.
- Mock servers listen on `127.0.0.1` only.
- OAuth 2.0 uses PKCE and a `state` check by default.

## Reporting a security issue

Please don't open a public issue for vulnerabilities. Contact the maintainer privately through the
repository owner's GitHub profile.
