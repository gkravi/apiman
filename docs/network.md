# Cookies, proxies and certificates

## Cookies

ApiMan keeps a **cookie jar** like a browser does. Cookies that responses set with `Set-Cookie` are
stored and sent automatically on later requests to matching URLs — including cookies set on redirect
hops, so login flows that redirect work as expected.

![Cookie manager](images/cookies.png)

The jar follows the cookie rules browsers use (RFC 6265):

- **Domain** — a cookie set without `Domain` goes back only to that exact host; with
  `Domain=example.com` it also goes to subdomains. A server can't set cookies for unrelated domains.
- **Path** — sent only for matching paths; more specific paths are sent first.
- **Secure** — sent only over HTTPS (and to `localhost`).
- **Expires / Max-Age** — expired cookies are removed; cookies without either last until you delete them.

**Managing cookies:** click **Cookies** in the top bar (or next to **Code** in a request, which opens
straight to that request's domain). You can view cookies by domain, delete one, clear a domain, or
add one by typing it like a `Set-Cookie` header: `session=abc123; Path=/; Secure`.

A `Cookie` header you add to a request yourself is sent too, alongside cookies from the jar, but
only to the request's original host.

Scripts can read cookies for the current URL with `pm.cookies.get('session')`.

## Proxy

**⚙ Settings → Proxy**:

| Field | Example |
|---|---|
| Use a proxy for requests | On/off |
| Proxy URL | `http://proxy.corp.local:8080` or `http://user:pass@proxy.corp.local:8080` |
| Bypass for hosts | `localhost, 127.0.0.1, *.internal, api.dev:8443` |

- HTTPS and `wss://` traffic is tunnelled through the proxy with `CONNECT`, so TLS stays end-to-end.
- Plain HTTP requests are sent to the proxy with the full URL.
- Credentials in the proxy URL are sent as `Proxy-Authorization: Basic …`.
- Bypass entries can be exact hosts, `*.domain` wildcards, or include a port.

The proxy applies to requests, OAuth token calls, `pm.sendRequest`, the runner, monitors, WebSocket
and SSE. (gRPC connects directly.)

## Certificates

**⚙ Settings → Certificates**:

### Extra CA certificates

Point **Extra CA certificates** at a PEM file to trust a private or corporate certificate authority
(for example a company proxy that re-signs traffic, or an internal CA). It's trusted in addition to
the normal system roots, so public sites keep working.

Prefer this over turning off **Verify SSL certificates**, which disables checking entirely.

### Client certificates (mutual TLS)

For APIs that require a client certificate, **+ Add certificate**:

| Field | Notes |
|---|---|
| Host | `api.example.com`, `*.example.com`, or with a port: `api.example.com:8443` |
| CRT file + KEY file | PEM certificate and private key |
| PFX file | Instead of CRT + KEY, a PKCS#12 bundle |
| Passphrase | For an encrypted key or PFX |

The first certificate whose host matches the request is used. Certificate files are read once and
cached; restart ApiMan after replacing a file at the same path.
