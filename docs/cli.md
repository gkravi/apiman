# Command-line runner

`apiman` runs collections from a terminal or CI pipeline — the same engine as the desktop app: the
same executor, script sandbox, cookie jar, auth and runner. It also generates HTML documentation.

```text
$ apiman run store.postman_collection.json -e local.postman_environment.json -d users.csv

Demo Store API  (environment: Local)

Iteration 1/3

→ Login
  POST http://localhost:4560/login [200 OK, 6ms, 44B]
  ✓ Got a token

→ Get user
  GET http://localhost:4560/users/1 [200 OK, 2ms, 106B]
  │ Fetched Ada Lovelace
  ✓ Status is 200
  ✓ Has an email
  ✓ Is an admin
…
              executed  failed
  iterations         3       0
  requests           6       0
  assertions        12       1

  1 failed assertion(s), 0 error(s)
```

## Installing

The CLI ships with the source code (it isn't part of the desktop installers). It needs
[Node.js](https://nodejs.org) 20 or later.

```bash
git clone https://github.com/gkravi/apiman.git
cd apiman
npm ci
npm run build
npm link          # puts `apiman` on your PATH
```

Without `npm link`, run it as `node out/cli/apiman.cjs …` from the repository folder.

## Input files

`apiman` reads files exported from the app (or from Postman):

- **Collection** — a Postman v2.0/v2.1 collection (**⋯ → Export (Postman v2.1)** in ApiMan), or an
  OpenAPI 3 / Swagger 2 spec in JSON or YAML.
- **Environment / globals** — Postman environment files (**Environments → ⋯ → Export**).
- **Data** — CSV or JSON, one row per iteration, as in the [runner](collection-runner.md#data-driven-runs).

Files that requests upload (form-data files, binary bodies) are resolved against the collection
file's folder, and must be inside it, so a collection someone else wrote can't make your CI job
upload `~/.ssh` or cloud credentials. Use `--working-dir <dir>` to point elsewhere, or
`--insecure-file-read` to lift the restriction.

On a managed machine, `--policy <file>` applies the organisation's
[policy file](security/enterprise.md#managed-policies) to the run, with the same host, script, TLS
and proxy rules as the desktop app.

## Common commands

```bash
# Run everything with an environment
apiman run api.postman_collection.json -e staging.postman_environment.json

# Three iterations driven by a data file, stop at the first failure
apiman run api.postman_collection.json -d users.csv --bail

# Only one folder, override a variable, skip TLS checks for a dev server
apiman run api.postman_collection.json --folder Users --env-var baseUrl=https://localhost:8443 -k

# Reports for CI: terminal output + JUnit XML + JSON
apiman run api.postman_collection.json -r cli,junit,json \
  --reporter-junit-export results/junit.xml --reporter-json-export results/run.json

# Save variables scripts set (e.g. a fresh token) back to a file
apiman run api.postman_collection.json -e dev.postman_environment.json --export-environment dev.after.json

# Generate HTML docs
apiman docs api.postman_collection.json -o api-docs.html
```

All options: [CLI options reference](reference/cli-options.md).

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Every request succeeded and every test passed |
| `1` | A test failed, a request errored, or the run was stopped (`--bail`, Ctrl+C) |
| `2` | Bad input: missing file, unknown option, unreadable data file, nothing to run |

`--suppress-exit-code` (`-x`) always exits `0` after a run, for pipelines that only want the reports.

## Reports

| Reporter | Output |
|---|---|
| `cli` | Human-readable progress and summary (colour when the terminal supports it; set `NO_COLOR` to disable) |
| `json` | The full run — summary plus every request, test and console line |
| `junit` | One `<testsuite>` per request execution, one `<testcase>` per test; request errors as `<error>`. Understood by GitHub Actions, GitLab, Jenkins, Azure DevOps and most CI systems |

## In CI

GitHub Actions example, assuming your collection and environment live in your repository and the
ApiMan repository is reachable from the workflow:

```yaml
name: API tests
on: [push]
jobs:
  api:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/checkout@v7
        with:
          repository: gkravi/apiman
          path: .apiman
          token: ${{ secrets.APIMAN_REPO_TOKEN }}   # needed while the repository is private
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: cd .apiman && npm ci && npm run build:cli
      - run: >
          node .apiman/out/cli/apiman.cjs run api/collection.json
          -e api/ci.postman_environment.json
          --env-var token=${{ secrets.API_TOKEN }}
          -r cli,junit --reporter-junit-export reports/api.xml
      - uses: actions/upload-artifact@v7
        if: always()
        with:
          name: api-test-report
          path: reports/
```

Keep secrets out of committed environment files and pass them with `--env-var` / `--global-var`
from your CI's secret store.

## Differences from the desktop app

- The CLI starts with an empty cookie jar for each run.
- Network settings come from flags: `--proxy`, `--ca-cert`, `--ssl-client-cert`/`--ssl-client-key`
  or `--ssl-client-pfx` (with `--ssl-client-passphrase`). A client certificate given on the command line
  is used for every host.
- WebSocket, SSE and gRPC requests are skipped.
- OAuth 2.0 tokens stored on requests are used as-is; the CLI doesn't sign in. Fetch a token in a
  pre-request script with `pm.sendRequest` (client credentials) or pass one with `--env-var`.
