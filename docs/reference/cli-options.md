# CLI options

```text
apiman run <collection> [options]
apiman docs <collection> [-o docs.html]
apiman --help | --version
```

`<collection>` is a Postman collection (v2.0/v2.1) or an OpenAPI 3 / Swagger 2 spec, in JSON or YAML.
See [Command-line runner](../cli.md) for installation and examples.

## `apiman docs`

| Option | Description |
|---|---|
| `-o, --output <file>` | Where to write the HTML page. Default: `<collection name>.html`. Folders are created as needed |

## `apiman run`

### Inputs

| Option | Description |
|---|---|
| `-e, --environment <file>` | Postman environment file to use |
| `-g, --globals <file>` | Postman globals file (same format as an environment) |
| `-d, --iteration-data <file>` | CSV or JSON data file; one iteration per row |
| `-n, --iteration-count <n>` | Number of iterations. Default: the number of data rows, or 1 |
| `--folder <name>` | Run only the folder with this name (searched at any depth) |
| `--env-var <key=value>` | Set or override an environment variable. Repeatable |
| `--global-var <key=value>` | Set or override a global variable. Repeatable |

### Behaviour

| Option | Description |
|---|---|
| `--delay-request <ms>` | Wait this long between requests |
| `--timeout-request <ms>` | Idle timeout for every request, overriding each request's own setting |
| `-k, --insecure` | Don't verify TLS certificates |
| `--ignore-redirects` | Don't follow redirects |
| `--bail` | Stop at the first failed test or request error |
| `-x, --suppress-exit-code` | Exit `0` after a run even if tests failed |

### Network

| Option | Description |
|---|---|
| `--proxy <url>` | Send requests through this HTTP proxy, e.g. `http://user:pass@proxy:8080` |
| `--ca-cert <file>` | Extra CA certificates (PEM) to trust, in addition to the system roots |
| `--ssl-client-cert <file>` | Client certificate (PEM)… |
| `--ssl-client-key <file>` | …and its private key |
| `--ssl-client-pfx <file>` | Client certificate as a PKCS#12 bundle (instead of cert + key) |
| `--ssl-client-passphrase <p>` | Passphrase for the key or PFX |

A client certificate given on the command line is used for every host.

### File uploads

| Option | Description |
|---|---|
| `--working-dir <dir>` | Folder that relative file paths (form-data files, binary bodies) are resolved against. Default: the collection file's folder |
| `--insecure-file-read` | Allow uploads from outside the working directory. Without it, a run that would upload such a file stops with exit code `2` before sending anything |

### Managed policy

| Option | Description |
|---|---|
| `--policy <file>` | Enforce an administrator policy file (the same JSON as the desktop app's `policy.json`): blocked or allowed hosts, scripts or `pm.sendRequest` turned off, required TLS verification, an enforced proxy and CA. An invalid file stops the run with exit code `2`. See [managed policies](../security/enterprise.md#managed-policies) |

### Output

| Option | Description |
|---|---|
| `-r, --reporters <list>` | Comma-separated: `cli`, `json`, `junit`. Default: `cli` |
| `--reporter-json-export <file>` | JSON report path. Default: `apiman-report.json` |
| `--reporter-junit-export <file>` | JUnit XML path. Default: `apiman-report.xml` |
| `--export-environment <file>` | After the run, write the environment — including values scripts set — as a Postman environment file |
| `--export-globals <file>` | Same for globals |

Output folders are created if they don't exist. Set `NO_COLOR=1` to disable colours in the `cli` reporter.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | All requests succeeded and all tests passed (or `--suppress-exit-code`) |
| `1` | A test failed, a request errored, or the run stopped early |
| `2` | Usage or input error: unknown option, missing or invalid file, folder not found, nothing to run |

Pressing **Ctrl+C** cancels the run, including the request in progress, and still writes the reports
(exit code `1`).
