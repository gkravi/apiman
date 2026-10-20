# Security policy

## Supported versions

Security fixes go into the latest release. Please update before reporting an issue.

| Version | Supported |
|---|---|
| Latest release | Yes |
| Older releases | No — update to the latest |

## Reporting a vulnerability

**Please don't open a public issue.** Report privately through GitHub:
[Security → Report a vulnerability](https://github.com/gkravi/apiman/security/advisories/new).

Include:

- the ApiMan version and operating system,
- what an attacker controls (a collection file, a server response, a website, local access…),
- steps to reproduce, ideally with a minimal collection or server,
- the impact you observed.

What to expect:

| Step | Target |
|---|---|
| Acknowledgement | within 3 working days |
| Assessment and severity | within 10 working days |
| Fix for critical/high issues | as soon as possible, normally within 30 days |
| Public advisory and credit | when the fix is released, unless you prefer not to be named |

Please give us a reasonable time to release a fix before disclosing publicly.

## Scope

In scope: the desktop app, the `apiman` CLI, the script sandbox, mock servers, and the release
pipeline. Particularly interesting:

- escaping the script sandbox, or a collection/response that runs code or reads files,
- leaking credentials from `workspace.json` or between requests/hosts,
- reaching mock servers or the app's internal APIs from a website.

Out of scope: problems that require an attacker who already controls your user account, and
requests you deliberately send to a malicious server (ApiMan sends what you tell it to).

## How ApiMan is secured

See [Data, privacy and security](docs/data-and-security.md), the
[security audit](docs/security/audit.md) and the
[enterprise deployment guide](docs/security/enterprise.md).
