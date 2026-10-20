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

Credentials are **encrypted at rest** with your operating system's keychain — the macOS Keychain,
Windows DPAPI, or the Secret Service (GNOME Keyring / KWallet) on Linux:

- passwords, bearer tokens, API-key values, OAuth client secrets and access/refresh tokens, AWS keys,
- client-certificate passphrases,
- cookie values,
- variables marked secret (lock icon).

Everything else — collections, URLs, plain variables — stays readable, so the file is still easy to
back up and diff. `workspace.json` is created readable by your user account only.

Good to know:

- Encrypted values can only be decrypted by the same user on the same computer. **To move to another
  computer**, export collections and environments rather than copying `workspace.json`; if you do
  copy it, encrypted values come back empty and you re-enter them.
- On Linux without a keyring service, Electron can't encrypt securely, so values are stored in plain
  text as before. Install `gnome-keyring` or KWallet to get encryption.
- Exports (Postman v2.1 collections and environments) contain secrets in plain text, as Postman's
  do. Review them before sharing, or keep secrets in an environment you don't share.

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
- Only the app's own page can call into the main process; other frames are refused.
- Web content (for example an OAuth sign-in page) can't open new windows, embed `<webview>`s, or
  ask for camera, microphone, location or other device permissions.
- Packaged builds disable `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect`, and refuse to start
  if the app archive has been modified.

### Collections from other people

- **File attachments are cleared on import.** A shared collection could otherwise point a form field
  at `~/.ssh/id_rsa` and upload it the first time you send the request. The fields stay; you pick the
  files again. The [CLI](cli.md#input-files) only uploads files inside the working directory.
- Scripts and [template functions](request-chaining.md) can't read files or environment variables.

### Network safety

- TLS certificates are verified by default. Turning verification off is per request.
- `Authorization` headers are dropped when a redirect goes to another host.
- Cookies follow browser rules, so one site can't set cookies for another.
- Mock servers listen on `127.0.0.1` only, answer only requests addressed to a local hostname
  (DNS-rebinding protection), and only allow CORS from local origins.
- OAuth 2.0 uses PKCE and a `state` check by default.

## Security review

The [security audit](security/audit.md) describes the threat model, what was tested and every
finding with its fix. IT and security teams evaluating ApiMan should start with the
[enterprise deployment guide](security/enterprise.md).

## Reporting a security issue

Please don't open a public issue for vulnerabilities. Use GitHub's
[private vulnerability reporting](https://github.com/gkravi/apiman/security/advisories/new) — see
[SECURITY.md](https://github.com/gkravi/apiman/blob/master/SECURITY.md) for what to include and what
to expect.
