# Developing & integrating

This document covers `fim-portal-cli` as a **TypeScript library**, plus its
architecture, testing and release setup. If you just want to use the
command-line tool, start with the **[README](README.md)** and
**[Usage.md](Usage.md)** instead.

The package ships both a CLI (`fim-portal`) and a typed API client
(`FimPortalClient`) for the [FIM Portal REST API](https://fimportal.de/docs)
(`fimportal.de`).

**Design goals**

- **Zero runtime HTTP dependencies** — built on Node's built-in `http`/`https` (no axios, no fetch polyfill).
- **One small dependency** for the CLI: [`commander`](https://github.com/tj/commander.js).
- **Strongly typed** — every search filter and enum from the OpenAPI spec is a TypeScript type.
- **Well tested** — unit tests on Node's built-in test runner (`node --test`), every HTTP response mocked.
- **Read-only scope** — only the endpoints that need no authentication are implemented. Uploads,
  converters, quality-check tools and token introspection (all `Access-Token`-protected) are intentionally omitted.

## Build from source

```bash
npm install
npm run build        # compiles TypeScript to dist/
```

Run the locally built CLI without a global install:

```bash
node dist/src/cli/index.js --help
# or, after `npm link`:
fim-portal --help
```

## Library usage

```ts
import { FimPortalClient, FimApiError } from "@maschinenlesbar.org/fim-portal-cli";

const client = new FimPortalClient(); // defaults to https://fimportal.de

// Typed search with auto-serialised filters
const page = await client.schemas.search({
  fts_query: "Geburt",
  freigabe_status: [5, 6],   // -> ?freigabe_status=5&freigabe_status=6
  is_latest: true,
  limit: 10,
});
console.log(page.total_count, page.items[0]?.name);

// Single resource ("latest" is the default version)
const full = await client.schemas.get("S07000009");

// Raw downloads return the bytes + content-type
const xdf = await client.schemas.downloadXdf("S07000009", "1.0");
await import("node:fs/promises").then((fs) => fs.writeFile("schema.xml", xdf.data));

try {
  await client.fields.get("ns", "DOES-NOT-EXIST");
} catch (err) {
  if (err instanceof FimApiError) console.error(err.status, err.detail);
}
```

### Client options

```ts
new FimPortalClient({
  baseUrl: "https://schema.fim.fitko.net",
  timeoutMs: 15_000,
  maxRetries: 3,               // 429 / 503 are retried with linear backoff
  maxResponseBytes: 50 << 20,  // abort responses larger than 50 MiB (0 = unlimited)
  userAgent: "my-app/1.0",
  transport: customTransport,  // inject your own HTTP transport (see below)
});
```

### Resource groups

`client.schemas`, `.documentProfiles`, `.fields`, `.groups`, `.serviceProfiles`,
`.serviceTexts`, `.organizationalUnits`, `.specializations`, `.onlineServices`,
`.processClasses`, `.processes`, `.codeLists`, `.tools`.

### Methods

Each resource group exposes the methods that correspond to its CLI sub-commands:
`search()`, `get()`, `versions()`, `downloadXdf()`, `downloadXzufi()`,
`downloadXprozess()`, `downloadPdf()`, `list()` (cursor resources), and
`qualityReport()` / `visualization()` / `report()` (processes/schemas).

## Authentication internals

The FIM Portal's read-only (`GET`) endpoints require **no authentication** — the
CLI works with no configuration. The client sends no API key or token.

Uploads, the `/tools/*` converters and quality-checks, and token introspection
require an `Access-Token` and are intentionally out of scope; the client has no
support for `Access-Token`-protected endpoints.

## Architecture

```
src/
  client/
    enums.ts     # union types + runtime value arrays generated from the OpenAPI enums
    types.ts     # response interfaces (typed *Out summaries; full payloads as JsonObject)
    params.ts    # typed search-parameter objects per endpoint
    query.ts     # dependency-free query-string builder (repeated keys for arrays)
    http.ts      # the Transport interface + default node:http/https transport
    engine.ts    # URL building, retry/backoff, JSON/raw decoding, error mapping
    errors.ts    # FimError / FimApiError / FimNetworkError / FimParseError
    client.ts    # FimPortalClient — resource groups over the engine
  cli/
    io.ts        # injectable I/O seam (stdout/stderr/file)
    shared.ts    # option parsers, global-option resolver, JSON/raw renderers
    commands/    # one module per resource group
    program.ts   # assembles the commander program from injectable deps
    run.ts       # parses argv -> exit code (no process.exit; testable)
    index.ts     # #! bin shim
```

**Design notes**

- The HTTP layer is a single `Transport` function (`(req) => Promise<HttpResponse>`).
  The default uses `node:http`/`node:https`; tests inject a mock. This keeps the
  client free of any HTTP framework.
- The CLI is built around injectable `CliDeps` (client factory + I/O), so the whole
  program can be driven in-process by tests with a mocked client and captured output
  — no subprocesses.
- Full single-resource payloads (e.g. `FullSchemaOut`, process trees) are deeply
  nested and standard-specific, so they are returned as faithful raw `JsonObject`s
  rather than partially-guessed types.

### Library / technical terms

**API client.** [`FimPortalClient`](src/client/client.ts) — the typed,
resource-grouped wrapper over the API. Usable as a library independently of the CLI.

**Resource group.** A cohesive set of client methods for one part of the API
(`client.schemas`, `client.processes`, …), and the matching top-level CLI command.

**Request engine.** [`RequestEngine`](src/client/engine.ts) — builds URLs,
serialises queries, applies retry/backoff, decodes JSON/raw responses and maps
errors. Sits between the client's resource methods and the transport.
`DEFAULT_BASE_URL` is `https://fimportal.de`.

**Transport.** A single function `(HttpRequest) => Promise<HttpResponse>`
([`http.ts`](src/client/http.ts)). The default (`nodeHttpTransport`) uses Node's
built-in `http`/`https`; tests inject a mock. This is the only HTTP seam.

**RawResponse.** The result of a download method: `{ data: Buffer, contentType,
status }` — raw bytes, never lossily decoded.

**Retry / backoff.** Transient `429` (rate limit) and `503` responses are retried
automatically with linear backoff, up to `--max-retries`. `FimApiError` is raised
after all retries are exhausted.

**maxResponseBytes.** A cap on the response body size in bytes (`0` = unlimited;
default 100 MiB), guarding against unbounded responses.

**Query builder.** [`buildQueryString`](src/client/query.ts) — a dependency-free
serialiser: omits `undefined`/`null`, repeats keys for arrays, renders booleans as
`true`/`false`, dates as ISO-8601, and encodes spaces as `%20` (not `+`).

**CliDeps / CliIO.** The dependency-injection seam for the CLI
([`io.ts`](src/cli/io.ts)): a client factory plus an I/O object
(`out`/`err`/`writeFile`/`outBinary`). Lets the whole CLI run in tests with a
mocked client and captured output — no subprocess.

**Error types.** [`errors.ts`](src/client/errors.ts): `FimApiError` (non-2xx,
carries `status`/`detail`), `FimNetworkError` (transport failure/timeout),
`FimParseError` (bad JSON), all extending `FimError`. The CLI maps a `404` to exit
code `4`, other errors to `1`.

## Testing

```bash
npm test          # builds, then runs `node --test` over dist/test
```

- **`query.test.ts`** — query-string serialisation (arrays, dates, booleans, encoding).
- **`http.test.ts`** — the default transport against a real loopback `http.createServer`.
- **`engine.test.ts`** — URL building, JSON/raw decoding, error mapping, 429/503 retry — mocked transport.
- **`client.test.ts`** — every endpoint's method/URL mapping + query serialisation — mocked transport.
- **`cli.test.ts`** — end-to-end command parsing, rendering, file output and exit codes — mocked client.

All HTTP is mocked with Node's built-in `node:test` `mock` facility (`test/helpers.ts`);
only `http.test.ts` touches a socket, and only on localhost.

## Continuous integration

GitHub Actions workflows under `.github/workflows/`:

- **ci.yml** — type-check, build and test on Node 20/22/24 for every push and PR.
- **release.yml** — on a `v*` tag: verify the tag matches `package.json`, test, `npm pack`, and create a GitHub Release with the tarball.
- **publish.yml** — manual dispatch: publish to npm via OIDC **Trusted Publishing** (no stored `NPM_TOKEN`) with provenance.
- **docs.yml** — build TypeDoc API docs and deploy to GitHub Pages on each `v*` tag.

## License

Dual-licensed under **[AGPL-3.0-or-later](LICENSE)** or a commercial license — see
**[LICENSING.md](LICENSING.md)**. This project does **not** accept external code
contributions; see **[CONTRIBUTING.md](CONTRIBUTING.md)**.
