# Troubleshooting

## Installing and opening

**macOS: "ApiMan can't be opened because Apple cannot check it for malicious software"**
The build isn't signed. Right-click ApiMan in Applications → **Open** → **Open**. You only need to do
this once.

**macOS: "ApiMan is damaged and can't be opened"**
macOS quarantined the download. Run `xattr -dr com.apple.quarantine /Applications/ApiMan.app`, then
open it normally.

**Windows: "Windows protected your PC"**
Click **More info → Run anyway**. This appears for installers without a code-signing certificate.

**Which Mac download do I need?**  → About This Mac. "Apple M…" → `arm64.dmg`; "Intel" → `x64.dmg`.
The Intel build also runs on Apple Silicon via Rosetta, just more slowly.

## Requests

**"Could not resolve host"** — the hostname doesn't exist or there's no network. Check for typos and
unresolved `{{variables}}` (they're listed under the URL bar; hover the URL to see it resolved).

**"Connection refused"** — nothing is listening on that host and port. Is the server running? Is it
`http` vs `https`, or a different port?

**"SSL error: self signed certificate…"** — the server's certificate isn't trusted. For a private CA,
add it under **⚙ Settings → Certificates → Extra CA certificates**. For a throwaway dev server, turn
off **Verify SSL certificates** on the request's Settings tab.

**"Request timed out after 30000 ms"** — the connection went quiet for the whole timeout. Raise
**Timeout** on the Settings tab for slow endpoints.

**A variable isn't replaced** — check the active environment (top right), the spelling, and whether
the row is enabled. Remember the [scope order](variables.md#where-variables-come-from): a local or
environment value hides a collection value with the same name.

**Works in the browser but not in ApiMan (or vice versa)** — browsers send cookies and some headers
automatically. Compare with the **Timeline** and the request headers in the **Console**, and check
the [cookie manager](network.md#cookies).

**Corporate network / proxy** — set the proxy under **⚙ Settings → Proxy**, and add the company's
root certificate as an extra CA if it inspects TLS traffic.

## Scripts and tests

**"ReferenceError: 'x' is not defined (line N)"** — a typo or missing variable on that line of the script.

**"Script timed out (possible infinite loop)"** — a script used more than 5 seconds of CPU. Look for
loops that never end.

**"Cannot find module 'fs'"** — scripts run in a sandbox without Node modules; only `crypto-js`,
`lodash`, `uuid`, `atob` and `btoa` can be required. See [Scripts and tests](scripting.md#libraries).

**My `pm.environment.set` didn't stick** — make sure an environment is active (otherwise there's
nowhere to save it), and in the runner that *Keep variable values set by scripts* is on.
Monitors never save variables, by design.

## OAuth 2.0

**The sign-in window shows an error page from the provider** — usually the **Callback URL** isn't
registered with the provider, or the client ID is wrong. Register the exact callback URL shown in ApiMan.

**"State mismatch"** — the redirect didn't come from the sign-in ApiMan started. Try again; if it
persists, check nothing else is handling that callback URL.

**"Token endpoint returned 401 — invalid_client"** — wrong client secret, or the provider expects the
other client authentication method: switch between *Send as Basic Auth header* and *Send client
credentials in body*.

**Refresh fails with invalid_grant** — the refresh token expired or was revoked. Click
**Get New Access Token** to sign in again.

## WebSocket, SSE and gRPC

**WebSocket "Handshake failed: 401"** — the server rejected the upgrade; usually missing auth. Check
the Authorization tab and headers — they're sent with the handshake.

**SSE: "Expected an event stream but got …"** — the endpoint answered with a normal response. The
log shows its status and body, which usually explains why (auth, wrong URL).

**gRPC: "This server does not support gRPC reflection"** — switch the Service tab to **Proto files**
and load the service's `.proto` files.

**gRPC: "Could not load proto files: … not found"** — an `import` can't be resolved. Add the folder
that contains the imported file under **Extra import paths**.

**gRPC: UNAVAILABLE** — the server isn't reachable, or TLS doesn't match: use `grpc://` for plain
text and `grpcs://` for TLS.

## Mock servers and monitors

**"Port 4010 is already in use"** — pick another port, or stop whatever is using it.

**The mock returns 404** — the JSON body lists the routes it knows. Is there a saved example on a
request with that method and path?

**A monitor didn't run overnight** — monitors run only while ApiMan is open. Use the
[CLI](cli.md) with cron or a CI schedule for 24/7 checks.

## Still stuck?

Open an issue on the repository with the ApiMan version, your OS, what you did and what happened.
Include the relevant lines from the **Console** (remove any secrets).
