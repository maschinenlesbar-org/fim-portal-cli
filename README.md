# fim-portal-cli

A TypeScript **API client** and **command-line interface** for the open endpoints of the
[FIM Portal API](https://fimportal.de/docs) (`fimportal.de`) — the central catalogue for
**XDatenfelder** (Datenschemata, Datenfeldgruppen, Datenfelder, Dokumentsteckbriefe),
**XZuFi** (Leistungen) and **XProzess** (Prozesse) FIM building blocks.

- **Zero runtime HTTP dependencies** — built on Node's built-in `http`/`https` (no axios, no fetch polyfill).
- **One small dependency** for the CLI: [`commander`](https://github.com/tj/commander.js).
- **Strongly typed** — every search filter and enum from the OpenAPI spec is a TypeScript type.
- **Well tested** — unit tests on Node's built-in test runner (`node --test`), every HTTP response mocked.
- **Read-only scope** — only the endpoints that need **no authentication** are implemented. Uploads,
  converters, quality-check tools and token introspection (all `Access-Token`-protected) are intentionally omitted.

New to FIM, XDatenfelder/XZuFi/XProzess, or terms like *Nummernkreis* and *Freigabestatus*?
See **[GLOSSARY.md](GLOSSARY.md)** for the domain concepts and the project's own vocabulary.

## Requirements

- Node.js **>= 20** (uses the stable built-in test runner, ESM and top-level `await`).

## Install

```bash
npm install
npm run build        # compiles TypeScript to dist/
```

Run the CLI without a global install:

```bash
node dist/src/cli/index.js --help
# or, after `npm link` / global install:
fim-portal --help
```

---

## CLI usage

The CLI mirrors the API resources. Every search command prints pretty JSON to stdout; download
commands stream raw bytes (XML/PDF/CSV) to stdout or to a file via `-o/--output`.

### Global options

| Option | Description |
| --- | --- |
| `--base-url <url>` | API base URL (default `https://fimportal.de`; `https://schema.fim.fitko.net` also works) |
| `--timeout <ms>` | Per-request timeout (default `30000`) |
| `--user-agent <ua>` | `User-Agent` header value |
| `--max-retries <n>` | Retries for transient `429`/`503` responses (default `2`) |
| `--max-response-bytes <n>` | Cap response body size in bytes (`0` = unlimited; default 100 MiB) |
| `--compact` | Print JSON on a single line |
| `-o, --output <file>` | For downloads: write bytes to a file instead of stdout |

Global options go **before** the command, e.g. `fim-portal --compact schemas get S07000009`.

### Commands

```text
schemas            search | versions | get | xdf | quality-report
document-profiles  search | versions | get | xdf
fields             search | versions | get | xdf
groups             search | versions | get | xdf
service-profiles   search | get | xzufi | pdf            (Leistungsteckbriefe)
service-texts      search | get | xzufi | pdf | parsed-xzufi   (Leistungsstammtexte)
organizational-units  list | xzufi
specializations       list | xzufi
online-services       list | xzufi
process-classes    search | get | xprozess
processes          search | get | xprozess | report | visualization | visualization-display
code-lists
search-csv         (tools/search-csv-download)
```

### Examples

```bash
# Full-text search schemas, latest versions only, as compact JSON
fim-portal --compact schemas search --fts-query "Geburt" --is-latest --limit 5

# Filter fields by Feldart and Datentyp, two Freigabestatus values
fim-portal fields search --feldart input --datentyp text \
  --freigabe-status 5 --freigabe-status 6

# Fetch a full schema (version defaults to "latest")
fim-portal schemas get S07000009
fim-portal schemas get S07000009 1.0

# Download the XDatenfelder XML to a file
fim-portal -o geburt.xml schemas xdf S07000009 1.0

# Quality report
fim-portal schemas quality-report S07000009 latest

# Leistungen (XZuFi)
fim-portal service-profiles search --fts-query "Personalausweis" --sprache Deutsch
fim-portal service-texts get L100001 L1 leika
fim-portal -o service.pdf service-profiles pdf 99050048262000 de

# XZuFi entities (cursor paginated)
fim-portal organizational-units list --limit 50
fim-portal organizational-units list --cursor 50

# Prozesse (XProzess)
fim-portal processes search --detaillierungsstufe 101 --is-musterprozess
fim-portal -o vis.bpmn processes visualization PROC1 1.0 101

# Code lists & CSV export
fim-portal code-lists --limit 20
fim-portal -o fields.csv search-csv --resource fields --term Name
```

Exit codes: `0` success, `4` on a `404` from the API, `1` for any other error, non-zero for usage errors.

---

## Library usage

```ts
import { FimPortalClient, FimApiError } from "fim-portal-cli";

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
  maxRetries: 3,             // 429 / 503 are retried with linear backoff
  maxResponseBytes: 50 << 20, // abort responses larger than 50 MiB (0 = unlimited)
  userAgent: "my-app/1.0",
  transport: customTransport, // inject your own HTTP transport (see below)
});
```

### Resource groups

`client.schemas`, `.documentProfiles`, `.fields`, `.groups`, `.serviceProfiles`, `.serviceTexts`,
`.organizationalUnits`, `.specializations`, `.onlineServices`, `.processClasses`, `.processes`,
`.codeLists`, `.tools`.

---

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

- The HTTP layer is a single `Transport` function (`(req) => Promise<HttpResponse>`). The default
  uses `node:http`/`node:https`; tests inject a mock. This keeps the client free of any HTTP framework.
- The CLI is built around injectable `CliDeps` (client factory + I/O), so the whole program can be
  driven in-process by tests with a mocked client and captured output — no subprocesses.
- Full single-resource payloads (e.g. `FullSchemaOut`, process trees) are deeply nested and
  standard-specific, so they are returned as faithful raw `JsonObject`s rather than partially-guessed types.

---

## Testing

```bash
npm test          # builds, then runs `node --test` over dist/test
```

- **`query.test.ts`** — query-string serialisation (arrays, dates, booleans, encoding).
- **`http.test.ts`** — the default transport against a real loopback `http.createServer`.
- **`engine.test.ts`** — URL building, JSON/raw decoding, error mapping, 429/503 retry — mocked transport.
- **`client.test.ts`** — every endpoint's method/URL mapping + query serialisation — mocked transport.
- **`cli.test.ts`** — end-to-end command parsing, rendering, file output and exit codes — mocked client.

All HTTP is mocked with Node's built-in `node:test` `mock` facility (`test/helpers.ts`); only
`http.test.ts` touches a socket, and only on localhost.

## Continuous integration

GitHub Actions workflows under `.github/workflows/`:

- **ci.yml** — type-check, build and test on Node 20/22/24 for every push and PR.
- **release.yml** — on a `v*` tag: verify the tag matches `package.json`, test, `npm pack`, and create a GitHub Release with the tarball.
- **publish.yml** — manual dispatch: publish to npm via OIDC **Trusted Publishing** (no stored `NPM_TOKEN`) with provenance.
- **docs.yml** — build TypeDoc API docs and deploy to GitHub Pages on each `v*` tag.

## License

**Dual-licensed** — use it under **either**:

- **[AGPL-3.0-or-later](LICENSE)** (default, free). Note the AGPL's §13 network
  clause: if you run a modified version as a network service, you must offer that
  modified source to the service's users.
- **Commercial license** (paid), for closed-source / proprietary or SaaS use
  without the AGPL's obligations.

See **[LICENSING.md](LICENSING.md)** for details, and **[CONTRIBUTING.md](CONTRIBUTING.md)**
for the contribution policy (this project does not accept external code
contributions). Commercial enquiries: **sebs@2xs.org**.
