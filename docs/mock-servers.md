# Examples and mock servers

## Saved examples

An **example** is a saved response attached to a request: status, headers and body. Examples document
what an endpoint returns, and mock servers serve them.

- Send a request, then click **Save as example** above the response and give it a name
  (e.g. "Admin user", "Not found").
- The request's **Examples** tab lists them; select one to view its body, or delete it.
- Examples on a saved collection request are stored with it immediately. On an unsaved request,
  save the request to a collection to keep them.
- Examples are included when you export to Postman format and imported from Postman collections
  (Postman calls them "responses").

## Mock servers

A mock server serves a collection's examples over HTTP on your machine, so a front end or another
service can develop against an API that isn't built yet (or isn't reachable).

![Mock server](images/mock-server.png)

1. Hover the collection, **⋯ → Mock server…**.
2. Choose a port (default 4010) and click **Start mock server**.
3. Point your app at `http://127.0.0.1:4010`.

The collection row shows a `mock :4010` badge while it runs. It keeps running when you close the
dialog; open it again to see requests or **Stop**.

### How requests are matched

1. **Method** must match. `HEAD` falls back to a `GET` route.
2. **Path** is taken from each request's saved URL, ignoring the base: `{{baseUrl}}/users/{{id}}`
   becomes `/users/{{id}}`. `{{variables}}` and `:params` match any single segment.
3. Literal segments beat wildcards: `/users/me` wins over `/users/{{id}}` for `GET /users/me`.
4. Query strings are ignored for matching.

### Which example is returned

| Request header | Picks |
|---|---|
| `x-mock-response-name: Not found` | The example with that name |
| `x-mock-response-code: 404` | The first example with that status |
| *(neither)* | The first 2xx example, else the first example |

The response has the example's status, headers and body, plus `X-Mock-Matched: <request> / <example>`.
[Dynamic variables](reference/dynamic-variables.md) in example bodies are filled per response, so
`{"id": "{{$guid}}"}` returns a new id each time.

No match returns `404` with JSON listing the available routes, which makes typos obvious.

### Good to know

- CORS is open (`Access-Control-Allow-Origin` echoes the caller, preflight `OPTIONS` answered), so
  browser apps on another port can call the mock directly.
- Edits apply while it runs: add an example or change a URL and the next request sees it.
- It listens on `127.0.0.1` only, so it isn't reachable from other machines.
- Request bodies are ignored; matching is by method and path.
