# gRPC

Choose **gRPC** in the protocol dropdown. ApiMan calls services with `@grpc/grpc-js`, sending and
receiving messages as JSON.

![gRPC server-streaming call](images/grpc.png)

## 1. Point at the server

Enter the address in the URL bar:

| URL | Connection |
|---|---|
| `grpc://localhost:50051` | Plain text (no TLS) |
| `grpcs://api.example.com` | TLS, port 443 by default |
| `localhost:50051` | Plain text |

For TLS servers, the [extra CA and client certificates](network.md#certificates) from Settings are
used, and **Verify SSL certificates** can be turned off for development.

## 2. Load the service definition

Open the **Service** tab and pick a source.

**Server reflection** — if the server has gRPC reflection enabled, choose **Server reflection** and
click **Fetch services from server**. ApiMan downloads the service definitions, including imported
files and well-known types such as `google.protobuf.Timestamp`. Both `grpc.reflection.v1` and the
older `v1alpha` are supported. Reflection uses the request's URL, metadata, auth and TLS settings.

**Proto files** — otherwise choose **Proto files** and **+ Add .proto files**. Imports are resolved
relative to each file's own folder; add more folders under **Extra import paths** if your protos import
from elsewhere (for example a `third_party` directory).

Then choose the **Service** and **Method**. Each method shows its kind: unary, server stream,
client stream or bidirectional stream.

## 3. Write the message

On the **Message** tab, write the request as JSON. **Use example message** fills in every field with
a sample value (first enum value, one field per `oneof`, `"0"` for 64-bit integers). When you pick a
method and the composer is empty, the example is filled in for you.

JSON mapping notes:

- 64-bit integers (`int64`, `uint64`, …) are strings: `"count": "42"`.
- Enums use their names: `"mood": "HAPPY"`.
- `bytes` fields are base64 strings.
- Field names are as written in the `.proto` (no camelCase conversion).

## 4. Call it

| Method kind | What to click |
|---|---|
| Unary | **Invoke** — sends the message, shows the reply and the status |
| Server streaming | **Invoke** — sends the message, then every reply arrives in the log |
| Client streaming | **Connect**, then **Send** as many messages as you like, then **End stream** to get the single reply |
| Bidirectional | **Connect**, **Send** messages and read replies as they arrive, **End stream** when done |

The log shows response headers, each message, and the final status (`Status 0 OK`, or e.g.
`INVALID_ARGUMENT: name is required` on failure, with trailers).

## Metadata and auth

The **Metadata** tab is the headers table: each row is sent as gRPC metadata (keys lower-cased).
Auth from the **Authorization** tab is sent as `authorization` metadata, so a collection's Bearer or
OAuth 2.0 token works for gRPC too.

## Deadlines

Unary calls use the request timeout (Settings tab) as their deadline. Streaming calls have no
deadline; end them with **End stream** or **Disconnect**.
