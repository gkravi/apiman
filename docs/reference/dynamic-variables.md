# Dynamic variables

Dynamic variables produce a new value every time they're used. Write them like any variable —
`{{$guid}}` — in URLs, headers, bodies, auth fields, mock example bodies, and in scripts with
`pm.variables.replaceIn('{{$guid}}')`.

| Variable | Example value |
|---|---|
| `{{$guid}}` | `3fa85f64-5717-4562-b3fc-2c963f66afa6` (random UUID v4) |
| `{{$randomUUID}}` | Same as `$guid` |
| `{{$timestamp}}` | `1792195200` (Unix time, seconds) |
| `{{$isoTimestamp}}` | `2026-10-17T09:30:00.000Z` |
| `{{$randomInt}}` | `0` to `1000` |
| `{{$randomBoolean}}` | `true` or `false` |
| `{{$randomWord}}` | `charlie` |
| `{{$randomFirstName}}` | `Grace` |
| `{{$randomLastName}}` | `Hopper` |
| `{{$randomFullName}}` | `Grace Hopper` |
| `{{$randomEmail}}` | `grace.hopper42@example.com` |
| `{{$randomColor}}` | `blue` |

A regular variable with the same name (e.g. an environment variable called `$timestamp`) takes
precedence.

```json
{
  "requestId": "{{$guid}}",
  "createdAt": "{{$isoTimestamp}}",
  "name": "{{$randomFullName}}",
  "email": "{{$randomEmail}}"
}
```
