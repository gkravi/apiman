# Collection runner

The runner sends every request in a collection or folder in order, runs their scripts and tests,
and reports the results — the same thing the [CLI](cli.md) does in CI.

![Collection runner](images/collection-runner.png)

## Starting a run

Hover a collection (or folder) and click **⋯ → Run collection** (**Run folder**). Then:

| Option | Meaning |
|---|---|
| **Run order** | Untick requests to skip them. Order follows the sidebar |
| **Iterations** | How many times to run the whole set |
| **Delay (ms)** | Pause between requests |
| **Data file** | CSV or JSON; one row per iteration (see below) |
| **Keep variable values set by scripts** | When on, environment/collection/global changes made by scripts are saved after the run |
| **Stop run on first error or failed test** | Stop at the first failure instead of continuing |

The run uses the **active environment**, the collection's variables and your globals. Requests run
one at a time; variables a script sets in one request are visible to the next.

WebSocket, SSE and gRPC requests are left out of runs — they need a live session.

## Results

Each request shows its status, time, size and a passed/total badge; click it to see each test and
any error. The summary shows totals and duration. **Only failures** hides the noise, **Export** saves
the full results as JSON, and **Stop run** cancels a run in progress.

Script `console` output from the run goes to the [console](scripting.md#the-console).

## Data-driven runs

Give the runner a data file and each row becomes one iteration, with its columns available as
`{{column}}` variables and through `pm.iterationData`.

**CSV** (first row is the header; quoted fields and newlines inside quotes are fine):

```csv
userId,expectedRole
1,admin
2,editor
3,viewer
```

**JSON** (an array of objects; non-string values are passed as JSON text):

```json
[
  { "userId": 1, "expectedRole": "admin" },
  { "userId": 2, "expectedRole": "editor" }
]
```

```js
// Test using the row's data
pm.test('Has the expected role', () => {
  pm.expect(pm.response.json().role).to.equal(pm.iterationData.get('expectedRole'))
})
```

Choosing a data file sets **Iterations** to the number of rows. If you set more iterations than rows,
the last row is reused.

## Controlling the flow

From any script:

```js
pm.execution.setNextRequest('Get user')  // continue with the request named "Get user"
pm.execution.setNextRequest(null)        // end the whole run after this request
pm.execution.skipRequest()               // (pre-request) don't send this request
```

A name that doesn't exist ends the current iteration. To protect against accidental infinite loops,
an iteration stops after 1000 requests.
