# Enterprise deployment guide

This page is for IT, security and procurement teams evaluating ApiMan. It covers how ApiMan
handles data, how to deploy and harden it, and what evidence is available for a security review.

## At a glance

| Question | Answer |
|---|---|
| Does data leave the machine? | Only the requests users send, to the hosts they choose. There is no ApiMan cloud. |
| Accounts or sign-in? | None. Nothing to provision or de-provision. |
| Telemetry, analytics, crash reports? | None. No update checks either. |
| Works offline / air-gapped? | Yes. |
| Where is data stored? | One file per user, in the OS user-data folder ([locations](../data-and-security.md#where-your-data-lives)). |
| Are credentials encrypted at rest? | Yes, with the OS keychain: Keychain, DPAPI or Secret Service. ([details](../data-and-security.md#secrets)) |
| Can imported collections run code? | Only in a WebAssembly sandbox with no file, process or OS access. |
| Licence | MIT: free for commercial use, source available for review. |
| Source code | [github.com/gkravi/apiman](https://github.com/gkravi/apiman) |
| Security contact | [SECURITY.md](https://github.com/gkravi/apiman/blob/master/SECURITY.md) |

## Evidence for a security review

| Artefact | Where |
|---|---|
| Security audit and threat model | [Security audit](audit.md) |
| Vulnerability disclosure policy | [SECURITY.md](https://github.com/gkravi/apiman/blob/master/SECURITY.md) |
| SBOM (CycloneDX) | `apiman-sbom.cdx.json` on every [release](https://github.com/gkravi/apiman/releases) |
| Installer checksums | `SHA256SUMS-*.txt` on every release |
| Static analysis | CodeQL `security-extended` on every change (repository **Security** tab) |
| Dependency scanning | `npm audit` gate in CI and weekly Dependabot updates |
| Security regression tests | [`src/core/security.test.ts`](https://github.com/gkravi/apiman/blob/master/src/core/security.test.ts) |
| Architecture | [Architecture](../development/architecture.md) |

## Data flows

```text
 User ─▶ ApiMan window ──(IPC: fixed API, own page only)──▶ Main process
                                                             │
          workspace.json ◀── secrets sealed with OS keychain ─┤
                                                             ├──▶ APIs the user calls (HTTP/WS/SSE/gRPC)
          Script sandbox (QuickJS/WASM) ◀── pm API ─────────┤      via the configured proxy / CA / client certs
                                                             ├──▶ OAuth providers the user configures
          Mock servers on 127.0.0.1 only ◀──────────────────┘
```

No other network connections are made.

## Deploying

Installers for macOS (`.dmg`, `.zip`), Windows (NSIS `.exe`) and Linux (`.AppImage`, `.deb`) are on
the [releases page](https://github.com/gkravi/apiman/releases).

1. **Verify the download** against `SHA256SUMS-<OS>.txt` from the same release:

    ```bash
    shasum -a 256 ApiMan-0.5.0-arm64.dmg
    ```

2. **Distribute** it with your usual tooling: Jamf, Intune, SCCM, Munki or an internal apt
   repository. On macOS, use `ApiMan-<version>-<arch>.pkg`, which installs to `/Applications`
   silently. On Windows, the NSIS installer installs silently with `/S`, per machine with
   `/S /allusers`.
3. **Build from source** if your policy requires it. Build any tagged commit with
   `npm ci && npm run dist`. You can also sign with your organisation's own certificates (see
   [Releasing](../development/releasing.md)).

!!! warning "Code signing"
    Public releases are not yet signed with an Apple Developer ID or Windows Authenticode
    certificate ([SEC-10](audit.md#findings)). Most managed fleets need signed builds; see
    [Code signing and compliance](#code-signing-and-compliance). Until signed releases are
    available, build and sign internally with your organisation's certificates.

## Code signing and compliance

Endpoint security on managed laptops (Gatekeeper, SmartScreen, Defender, CrowdStrike, Santa,
Intune and Jamf allow-listing) decides whether to trust an app from its **publisher signature**.
These are the signatures enterprises usually require, and where ApiMan stands:

| Platform | What enterprises require | Who issues it | ApiMan public releases | Build pipeline |
|---|---|---|---|---|
| macOS app | **Developer ID Application** signature with the hardened runtime | Apple Developer Program ($99/year) | Ad-hoc signature only | Supported; signs when the certificate secret is set |
| macOS app | **Notarisation** with a stapled ticket (Apple's malware scan; Gatekeeper opens the app without warnings, even offline) | Apple notary service | Not notarised | Supported; notarises with an App Store Connect API key |
| macOS `.pkg` (MDM) | **Developer ID Installer** signature, notarised and stapled. Intune requires a signed package for macOS line-of-business apps. | Apple Developer Program | Unsigned | Supported; signs, notarises and staples when the installer certificate is set |
| Windows `.exe` | **Authenticode** signature with an RFC 3161 timestamp. An OV or EV certificate on a hardware token or cloud HSM, or **Azure Trusted Signing**. | A public CA (DigiCert, Sectigo…) or Microsoft (Azure Trusted Signing) | Unsigned | Supported: a `.pfx` or Azure Trusted Signing |
| Linux `.deb` / AppImage | A GPG-signed apt repository, or checksums | Your organisation | SHA-256 checksums | Checksums and SBOM on every release |
| All | Checksums and a software bill of materials | — | `SHA256SUMS-*.txt` and a CycloneDX SBOM on every release | Yes |

What signing gives an IT team:

- **Allow-listing by publisher.** With a Developer ID, the app's Team ID can be allowed in Santa,
  Jamf Protect or an MDM system-extension or PPPC policy. On Windows, the Authenticode publisher can
  be allowed in WDAC or AppLocker.
- **No warnings on first launch.** Notarised apps open without the "could not verify" prompt, and
  signed Windows installers build SmartScreen reputation.
- **Tamper evidence.** Combined with ApiMan's ASAR integrity fuse, any modification to the
  installed app invalidates the signature.

**Verify a signed build** before allow-listing it:

```bash
codesign --verify --deep --strict --verbose=2 /Applications/ApiMan.app
spctl --assess --type execute --verbose=2 /Applications/ApiMan.app   # "accepted, source=Notarized Developer ID"
xcrun stapler validate /Applications/ApiMan.app
pkgutil --check-signature ApiMan-<version>-arm64.pkg
```

On Windows, check the publisher in the installer's **Properties → Digital Signatures**, or run
`Get-AuthenticodeSignature .\ApiMan-Setup-<version>-x64.exe` in PowerShell.

**If you need signed builds before public releases are signed**, build ApiMan from a tagged
commit with your organisation's own Apple Developer ID and Authenticode certificate (see
[Releasing → Code signing](../development/releasing.md#code-signing-and-notarisation)). Your
security team then controls the signing identity, which many organisations prefer for internally
distributed tools anyway.

ApiMan is not certified under a formal scheme such as Common Criteria or FIPS 140. It uses the
operating system's TLS roots and keychain, and Node.js/Chromium cryptography; the
[security audit](audit.md) is a self-assessment.

## Hardening checklist

| Recommendation | Why |
|---|---|
| Keep full-disk encryption on (FileVault, BitLocker, LUKS) | Protects the workspace and keychain at rest |
| On Linux, make sure a Secret Service keyring is installed (`gnome-keyring` or KWallet) | Without it, credentials are stored in plain text |
| Route traffic through your corporate proxy (**Settings → Proxy**) and add your internal CA (**Settings → Certificates**) | Requests are inspected and logged like other traffic |
| Restrict which hosts users can reach with [managed policies](#managed-policies) and your proxy or firewall | Without a policy, ApiMan can call any host the machine can |
| Encourage environment variables marked **secret** for credentials | They are encrypted and masked in the interface |
| Treat collections from outside the organisation like code | Their scripts can make network requests |
| In CI, run the CLI without `--insecure-file-read` and pass secrets with `--env-var` from the CI secret store | Keeps uploads inside the checkout and secrets out of the repository |
| Keep ApiMan updated | Security fixes ship in new releases only |

## Data retention and removal

- **History** keeps recent requests and responses. Users can clear it from the History view, and
  administrators can cap it with [`historyRetentionDays`](#managed-policies).
- **Uninstalling** removes the app but not user data. To remove data, delete the user-data folder
  ([locations](../data-and-security.md#where-your-data-lives)). This includes the OAuth sign-in
  session.
- Because data never leaves the device, ApiMan holds no customer data. That simplifies GDPR/DPA
  reviews: ApiMan is not a data processor.

## Managed policies

An administrator can lock settings for everyone on a machine with a **policy file**. ApiMan reads
it at startup, enforces it in the main process (not in the window, so it can't be switched off
from the interface), and marks the affected controls **Managed by your organisation**. Users see
the policies in force at the top of **Settings**.

### Where the policy goes

| OS | Location |
|---|---|
| macOS | `/Library/Application Support/ApiMan/policy.json`, and/or a configuration profile for the `dev.apiman.app` domain (see below) |
| Windows | `%ProgramData%\ApiMan\policy.json` (usually `C:\ProgramData\ApiMan\policy.json`) |
| Linux | `/etc/apiman/policy.json` |

Make the file **writable by administrators only** (for example `root:wheel 644` on macOS,
`root:root 644` on Linux, and on Windows the default `ProgramData` permissions with write
access removed from Users). ApiMan doesn't check the file's permissions; a user who can edit it
can change the policy.

Deploy it with the same tooling as the app: a Jamf or Munki payload, an Intune or Group Policy
file copy, or your configuration management.

### Example

```json
{
  "disableScripts": false,
  "disableSendRequest": true,
  "allowedHosts": ["*.example.com", "localhost", "127.0.0.1"],
  "blockedHosts": ["payments.example.com"],
  "forbidInsecureTls": true,
  "enforcedProxy": { "url": "http://proxy.example.com:3128", "bypass": "localhost,127.0.0.1" },
  "enforcedCaPath": "/Library/Application Support/ApiMan/corp-ca.pem",
  "disableMockServers": true,
  "historyRetentionDays": 30
}
```

Every key is optional. A missing key leaves that setting to the user.

### Policy reference

| Key | Type | Effect |
|---|---|---|
| `disableScripts` | `true` / `false` | Pre-request and post-response scripts don't run, in requests, the collection runner and monitors. The request is still sent; the console notes that its scripts were skipped. Script editors become read-only. |
| `disableSendRequest` | `true` / `false` | `pm.sendRequest()` fails with an error inside scripts, so scripts can't make extra requests. Scripts otherwise run. |
| `allowedHosts` | list of host patterns | Only these destination hosts can be contacted. An empty list allows none. |
| `blockedHosts` | list of host patterns | These hosts can never be contacted. Checked before `allowedHosts`. |
| `forbidInsecureTls` | `true` / `false` | TLS certificates are always verified. The per-request **Verify SSL certificates** option is locked on. |
| `enforcedProxy` | URL, or `{ "url": ..., "bypass": ... }` | Every request goes through this HTTP proxy. The user's proxy settings are ignored. `bypass` is a comma-separated list (or JSON list) of hosts that go direct, in the same format as **Settings → Proxy**. |
| `enforcedCaPath` | file path | This PEM bundle is trusted in addition to the system roots, replacing the user's **Extra CA certificates** setting. |
| `disableMockServers` | `true` / `false` | Mock servers can't be started. |
| `historyRetentionDays` | number (`0` or more) | History older than this many days is deleted, on disk and in the app. `0` keeps no history. |

**Host patterns** are host names with optional wildcards and port:

- `api.example.com` matches that host only;
- `*.example.com` matches `example.com` and any subdomain;
- `*` matches any run of characters, so `api-*.internal` matches `api-eu.internal`;
- `localhost:8080` matches only port 8080; without a port, any port matches;
- IPv6 addresses go in brackets: `[::1]`.

Host rules apply to everything ApiMan sends: HTTP requests and **every redirect hop**, WebSocket
(including its redirects), Server-Sent Events, gRPC, `pm.sendRequest`, OAuth 2.0 token requests,
and requests sent for `{{ $response() }}` references. They match the host name as written, after
URL normalisation (so `http://2130706433/` is checked as `127.0.0.1`). They don't resolve DNS,
so a name that resolves to a blocked address isn't caught. Pair them with your proxy or firewall
for network-level control.

For the OAuth 2.0 sign-in window, the host rules check the provider's authorization URL; pages
the provider loads after that (its own redirects and assets) aren't checked.

The enforced proxy applies to HTTP, WebSocket, SSE and gRPC traffic, and to the OAuth sign-in
window. For gRPC, ApiMan sets `grpc_proxy` for the app process.

### How the policy is read

- **Invalid policy stops the app.** If the file isn't valid JSON, or a key has the wrong type
  (for example `"disableScripts": "yes"`), ApiMan shows an error naming the problem and quits.
  It doesn't start without restrictions the organisation asked for.
- **Unknown keys are ignored** and logged as a warning, so a policy written for a newer version
  still works.
- **Changes apply at the next launch.**

### macOS configuration profiles

On macOS, ApiMan also reads managed preferences for the `dev.apiman.app` domain, which an MDM
(Jamf, Intune, Kandji…) installs from a configuration profile. They land in
`/Library/Managed Preferences/dev.apiman.app.plist` (machine-wide) or
`/Library/Managed Preferences/<user>/dev.apiman.app.plist` (per user). Use the same keys as the
JSON file. For `enforcedProxy`, use a string or a dictionary with `url` and `bypass`.

When a profile and `policy.json` are both present, they are combined:

- a switch is on if either source turns it on;
- block lists are added together;
- the shorter history retention wins;
- for `allowedHosts`, `enforcedProxy` and `enforcedCaPath`, the profile replaces the file.

### The CLI

The `apiman` CLI doesn't read the machine policy automatically. To apply the same restrictions in
CI, pass the file explicitly:

```bash
apiman run collection.json --policy /etc/apiman/policy.json
```

`--insecure` is ignored (with a warning) when the policy sets `forbidInsecureTls`. An invalid
policy file is a usage error (exit code `2`). `disableMockServers` and `historyRetentionDays` have
no effect in the CLI.

### Limits

Managed policies are **guard rails for a managed install**, not a sandbox against a determined
user with administrator rights. A local administrator can edit or delete the policy file, and
anyone can run an unmanaged copy of an open-source app. Use them together with your usual endpoint
controls (application allow-listing, MDM, network egress rules).

Still on the roadmap: allowing only signed or allow-listed collections. If your organisation needs
it, please open a discussion or issue on GitHub.
