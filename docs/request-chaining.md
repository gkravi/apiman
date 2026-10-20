# Request chaining and template functions

Use one request's response in another, without writing a script. A header like this:

```text
Authorization: Bearer {{ $response('Login', '$.token') }}
```

sends **Login** first if it hasn't been sent yet, then puts the `token` from its JSON body into
the header. This works in the URL, params, headers, every body type, auth fields, and WebSocket,
SSE and gRPC messages.

Template functions look like variables with a call inside: `{{ $name(arguments) }}`. Plain
`{{variables}}` and dynamic variables like `{{$guid}}` work exactly as before.

## Referencing another response

```text
{{ $response('Request name', 'path', 'when to send') }}
```

**Request name** is the name of a request in the same collection. If two requests share a name,
add their folders: `'Auth/Login'`. The first match in sidebar order wins.

**Path** picks what to insert:

| Path | Inserts |
|---|---|
| *(omitted)* or `'body'` | The whole response body |
| `'$.data[0].id'`, `'$..token'`, `'.user.email'` | A [JSONPath](requests.md#filtering-json-responses) match. Text values are inserted as-is; anything else as JSON |
| `'status'` | The status code, e.g. `201` |
| `'header:Location'` | A response header (case-insensitive) |

A path that matches nothing stops the send with an error, rather than sending an empty value.

**When to send** decides whether the referenced request is sent again:

| Value | Behaviour |
|---|---|
| `'if-missing'` *(default)* | Send it only if it hasn't been sent since ApiMan started |
| `'always'` | Send it every time |
| `'never'` | Never send it; fail if there's no response yet |
| A number, e.g. `300` | Send it if the last response is older than this many seconds — handy for tokens that expire |

The referenced request runs as if you sent it yourself: with its folder and collection auth, its
pre-request and test scripts, the current environment and the cookie jar. Variables and cookies
it sets (say, `pm.environment.set('token', …)` in Login's tests) carry over to the request that
referenced it. A line in the console shows each chained send.

References can nest (Login can reference another request), up to five deep. A loop such as
**A → B → A** is caught and reported instead of sending forever.

!!! tip "Copy a reference"
    Send a saved request, type a JSONPath in the response's filter box, and click **Copy
    reference**. You get `{{ $response('Name', '$.your.path') }}`, ready to paste anywhere.

## Asking for a value: `$prompt`

```text
X-OTP: {{ $prompt('One-time code') }}
Region: {{ $prompt('Region', 'eu-west-1') }}
```

Before sending, ApiMan asks for each prompt in a small dialog, pre-filled with the default (or with
what you typed last time this session). The collection runner, monitors and the CLI don't ask:
they use the defaults.

## All functions

Arguments are `'single'` or `"double"` quoted text, numbers, `true`/`false`, or other calls.
Quoted text can contain `{{variables}}` and other templates:
`{{ $hmac('sha256', '{{secret}}', $now('unix')) }}`.

| Function | Result |
|---|---|
| `$response(name, path?, send?)` | Part of another request's response (see above) |
| `$prompt(label, default?)` | A value you type before sending |
| `$base64(text)` / `$base64Decode(text)` | Base64 encode / decode (UTF-8) |
| `$urlEncode(text)` / `$urlDecode(text)` | Percent-encode / decode |
| `$hash(algorithm, text, encoding?)` | `md5`, `sha1`, `sha256`, `sha384` or `sha512` digest; `'hex'` (default) or `'base64'` |
| `$hmac(algorithm, key, text, encoding?)` | HMAC with the same algorithms and encodings |
| `$uuid()` | A random UUID v4 |
| `$now(format?, offset?)` | The time in UTC. Formats: `'iso'` (default), `'unix'`, `'unixms'`, or tokens `YYYY MM DD HH mm ss SSS`. Offsets like `'+1h'`, `'-30m'`, `'+7d'` (`s m h d w`) |
| `$random(min?, max?)` | A whole number from `min` to `max` inclusive (default 0–100) |
| `$jsonPath(json, path)` | A JSONPath match from JSON text |
| `$lower(text)` / `$upper(text)` / `$trim(text)` | Change case / remove surrounding spaces |

### Examples

```text
# Signed request
X-Signature: {{ $hmac('sha256', '{{apiSecret}}', '{{ $now('unix') }}{{path}}', 'base64') }}

# Basic auth by hand
Authorization: Basic {{ $base64('{{user}}:{{password}}') }}

# Follow a redirect target from a create call
{{ $response('Create order', 'header:Location') }}/items

# Expire a cached token after 10 minutes
Authorization: Bearer {{ $response('Get token', '$.access_token', 600) }}
```

## When templates run

1. Pre-request scripts run, so variables they set are visible to templates.
2. Template functions are rendered, sending referenced requests as needed.
3. Variables are substituted and auth is applied.
4. The request is sent; then test scripts run.

If a template fails (a syntax error, an unknown function, a referenced request that failed), the
request isn't sent and the error is shown in the response pane and the console.

## Security

Template functions can't read files, environment variables or anything else on your computer.
That's deliberate: templates arrive with imported collections, and a collection someone else wrote
mustn't be able to send your local secrets anywhere. `$response()` only references requests in the
same collection.
