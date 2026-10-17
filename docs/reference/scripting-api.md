# Scripting API reference

Everything available inside pre-request and post-response scripts. Scripts run as `async` functions,
so top-level `await` and `return` both work. See [Scripts and tests](../scripting.md) for a guided
introduction.

**Contents:** [pm.test](#pmtest) · [pm.expect](#pmexpect) · [pm.response](#pmresponse) ·
[pm.request](#pmrequest) · [Variables](#variables) · [pm.sendRequest](#pmsendrequest) ·
[pm.cookies](#pmcookies) · [pm.info](#pminfo) · [pm.execution](#pmexecution) ·
[Globals and libraries](#globals-and-libraries) · [Legacy postman.*](#legacy-postman)

---

## pm.test

```ts
pm.test(name: string, fn: () => void | Promise<void>): pm
pm.test.skip(name: string): pm      // logs "Skipped test: <name>", records nothing
```

A test passes if `fn` returns without throwing (or its promise resolves). Any thrown error — usually a
failed `pm.expect` — fails it with that error's message. Tests run in the order written.

## pm.expect

```ts
pm.expect(value: any, message?: string): Assertion
```

`message` is prefixed to the failure message.

**Chain words** (readability only): `to` `be` `been` `is` `that` `which` `and` `has` `have` `with` `at` `of` `same` `but` `does` `still` `also`

**Flags:** `.not` (negate), `.deep` (deep equality for `equal`/`property`), `.nested` (`property('a.b[0]')`), `.any` / `.all` (for `keys`)

| Assertion | Passes when |
|---|---|
| `.equal(v)` / `.equals` / `.eq` | `value === v` (deep with `.deep`) |
| `.eql(v)` / `.eqls` | deep equal |
| `.a(type)` / `.an(type)` | type is `string`, `number`, `boolean`, `object`, `array`, `null`, `undefined`, `function`, `regexp`, `date` |
| `.include(v)` / `.includes` / `.contain` / `.contains` | string contains, array contains (deep for objects), or object has these key/values |
| `.string(s)` | string contains `s` |
| `.match(re)` / `.matches` | regular expression matches |
| `.property(name[, value])` | has the property (optionally equal to `value`); dotted names and `[i]` work; **changes the subject** to the property's value |
| `.ownProperty(name)` / `.haveOwnProperty` | own (not inherited) property |
| `.lengthOf(n)` / `.length(n)` | `.length === n` |
| `.above(n)` `.gt` `.greaterThan` | `> n` |
| `.below(n)` `.lt` `.lessThan` | `< n` |
| `.least(n)` `.gte` | `>= n` |
| `.most(n)` `.lte` | `<= n` |
| `.within(lo, hi)` | `lo <= value <= hi` |
| `.oneOf(list)` | value is in `list` (deep) |
| `.keys(...k)` / `.key` | has all keys (any with `.any`) |
| `.members(list)` | same members in any order |
| `.instanceOf(C)` | `value instanceof C` |
| `.satisfy(fn)` / `.satisfies` | `fn(value)` is truthy |
| `.throw([match])` / `.throws` | calling `value()` throws (optionally matching a string, RegExp or class) |
| `.ok` `.true` `.false` `.null` `.undefined` `.NaN` `.exist` `.empty` | property assertions — no parentheses |

```js
pm.expect(json.items).to.be.an('array').with.lengthOf(3).and.not.empty
pm.expect(json).to.have.nested.property('user.address.city', 'London')
pm.expect(json).to.have.property('user').that.has.property('id')   // subject is now json.user
pm.expect.fail('should not get here')
```

## pm.response

Available in post-response scripts. (`undefined` in pre-request scripts.)

| Member | Type / returns |
|---|---|
| `code` | `number` — status code |
| `status` | `string` — reason phrase, e.g. `"OK"` |
| `responseTime` | `number` — total ms |
| `responseSize` | `number` — body bytes |
| `headers` | read-only [header list](#header-lists) |
| `text()` | body as a string (empty for binary bodies) |
| `json()` | parsed body; throws `Response body is not valid JSON: …` otherwise |

**Response assertions** (throw on failure, so use inside `pm.test`):

| Assertion | Passes when |
|---|---|
| `to.have.status(200)` / `to.have.status('Created')` | status code or reason phrase matches |
| `to.have.header(name[, value])` | header present (case-insensitive), optionally with this value |
| `to.have.body()` / `to.have.body(text \| RegExp)` | non-empty / equal / matches |
| `to.have.jsonBody([path[, value]])` | body is JSON (optionally with this nested path / value) |
| `to.have.responseTime.below(ms)` | faster than `ms` |
| `to.be.ok` / `to.be.success` | 2xx |
| `to.be.redirection` | 3xx |
| `to.be.clientError` | 4xx |
| `to.be.serverError` | 5xx |
| `to.be.error` | 4xx or 5xx |
| `to.be.notFound` | 404 |
| `to.be.json` | body parses as JSON |

## pm.request

The request about to be sent (pre-request) or that was sent (post-response). Changes made in
pre-request scripts are applied before sending. Values are as written in the editor, before
`{{variables}}` are resolved.

| Member | Notes |
|---|---|
| `url` | Object with `toString()`, `update(str)`, `getHost()`, `getPath()`, `getQueryString()`, `addQueryParams(str \| [{key, value}])`. Assigning a string also works: `pm.request.url = '…'` |
| `method` | Get or set, e.g. `pm.request.method = 'POST'` |
| `headers` | Editable [header list](#header-lists) |
| `body` | For **raw** bodies: `{ mode, raw, update(v), toString() }`; `pm.request.body.raw = '…'` sets it. `undefined` for other body modes |
| `addHeader({key, value})`, `removeHeader(name)` | Shortcuts |

### Header lists

| Method | Notes |
|---|---|
| `get(name)` | Value of the first match (case-insensitive) or `undefined` |
| `has(name[, value])` | |
| `toObject()` | `{ name: value }` |
| `all()` | `[{ key, value }]` |
| `each(fn)` | Calls `fn({ key, value })` |
| `count()` | |
| `add({key, value})` or `add(key, value)` | Request headers only |
| `upsert({key, value})` | Replace or add (request only) |
| `remove(name)` | Remove all with that name (request only) |

## Variables

Five objects share the same shape:

| Object | Scope | Writable |
|---|---|---|
| `pm.environment` | Active environment | ✓ |
| `pm.collectionVariables` | The request's collection | ✓ |
| `pm.globals` | Globals | ✓ |
| `pm.iterationData` | Current data-file row (runner) | ✗ |
| `pm.variables` | All scopes, highest priority first; `set` writes a **local** variable for this request | ✓ (local) |

| Method | Notes |
|---|---|
| `get(name)` | Value or `undefined`. On `pm.variables`, the highest-priority match |
| `has(name)` | |
| `set(name, value)` | Stored as a string; objects become JSON |
| `unset(name)` | |
| `clear()` | Not on `pm.variables` / `pm.iterationData` |
| `toObject()` | All values. On `pm.variables`, merged with priority applied |
| `replaceIn(text)` | Resolve `{{variables}}` and [dynamic variables](dynamic-variables.md) in a string |

Priority: local → data → environment → collection → globals. Changes are saved when the request
(or run) finishes; see [Variables](../variables.md#setting-variables-from-scripts).

## pm.sendRequest

```ts
pm.sendRequest(request: string | RequestSpec, callback?: (err: Error | null, res: Response | null) => void): Promise<Response>
```

```ts
interface RequestSpec {
  url: string
  method?: string                                     // default GET
  header?: { key: string; value: string }[] | Record<string, string>
  body?: { mode: 'raw'; raw: string }
       | { mode: 'urlencoded'; urlencoded: { key: string; value: string }[] }
}
```

The response has the same API as [`pm.response`](#pmresponse), including `to.*` assertions.

- Use `await` or the callback — both work. Network errors reject the promise / call back with `err`.
- Variables aren't resolved automatically: use `pm.variables.replaceIn('{{baseUrl}}/token')`.
- It shares the request's cookie jar, proxy and certificate settings.
- Limit: 25 calls per script.

## pm.cookies

Cookies the jar holds for the request URL (in post-response scripts, for the final URL after redirects).

| Method | |
|---|---|
| `get(name)` | value or `undefined` |
| `has(name)` | |
| `toObject()` | `{ name: value }` |
| `all()` | `[{ name, value }]` |
| `count()` | |

## pm.info

| Field | |
|---|---|
| `eventName` | `"prerequest"` or `"test"` |
| `requestName`, `requestId` | |
| `iteration` | 0-based iteration index (runner) |
| `iterationCount` | total iterations |

## pm.execution

| Method | Effect |
|---|---|
| `setNextRequest(name)` | In the runner, continue with the request that has this name |
| `setNextRequest(null)` | End the run after this request |
| `skipRequest()` | In a pre-request script: don't send this request |

`pm.setNextRequest` is an alias of `pm.execution.setNextRequest`.

## Globals and libraries

| Name | |
|---|---|
| `console.log / info / warn / error / debug` | Printed in the app's console (objects as JSON) and the CLI's output |
| `btoa(str)`, `atob(str)` | Base64 for Latin-1 strings |
| `crypto.getRandomValues(typedArray)`, `crypto.randomUUID()` | Backed by the operating system's secure random generator |
| `CryptoJS` | [crypto-js](https://github.com/brix/crypto-js) — `CryptoJS.HmacSHA256(msg, key).toString()`, `CryptoJS.AES.encrypt(…)`, encoders… |
| `_` | [Lodash](https://lodash.com) |
| `require(name)` | `'crypto-js'`, `'lodash'`, `'uuid'` (`v4()`), `'atob'`, `'btoa'`. Anything else throws `Cannot find module` |

Not available: Node.js modules, `fetch`, `XMLHttpRequest`, `setTimeout`/`setInterval`, the DOM.

## Legacy postman.*

For older scripts:

| Function | Equivalent |
|---|---|
| `postman.setEnvironmentVariable(k, v)` | `pm.environment.set(k, v)` |
| `postman.getEnvironmentVariable(k)` | `pm.environment.get(k)` |
| `postman.clearEnvironmentVariable(k)` | `pm.environment.unset(k)` |
| `postman.setGlobalVariable(k, v)` | `pm.globals.set(k, v)` |
| `postman.getGlobalVariable(k)` | `pm.globals.get(k)` |
| `postman.clearGlobalVariable(k)` | `pm.globals.unset(k)` |
| `postman.setNextRequest(name)` | `pm.execution.setNextRequest(name)` |

The legacy `tests["name"] = boolean` syntax and `responseBody` / `responseCode` globals aren't supported;
use `pm.test` and `pm.response`.
