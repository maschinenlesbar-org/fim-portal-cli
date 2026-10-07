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
  maxRetries: 3,               // 429 / 503 are retried (Retry-After, else linear backoff)
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
`downloadXprozess()`, `exportPdf()` (service profiles and texts), `parsedXzufi()`
(service texts), `list()` (cursor resources and `codeLists`), `qualityReport()`
(schemas), `downloadReport()` / `downloadVisualization()` /
`downloadVisualizationDisplay()` (processes) and `searchCsvDownload()` (`tools`).
`test/client.test.ts` checks that every method named here exists.

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
    validate.ts  # the library's input rules (Problem functions + assertValid)
    filters.ts   # each endpoint's query parameters (tables) + assertParams / assertSearchCsvParams
    http.ts      # the Transport interface + default node:http/https transport
    engine.ts    # URL building, retry/backoff, JSON/raw decoding, error mapping
    errors.ts    # FimError / FimApiError / FimNetworkError / FimParseError / FimValidationError
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
built-in `http`/`https`; tests inject a mock. This is the only HTTP seam. The engine
holds every transport to the same contract, so a custom one (a `fetch` adapter, a test
double) needs none of it itself: each call runs under the overall `timeoutMs` deadline
(the request carries an `AbortSignal`, `HttpRequest.signal`, that fires then, and the
call rejects at the deadline whether the transport stops or not); `maxResponseBytes` is
checked on the body it returns; headers may come as a plain record in any case, a
`Headers` object or a `Map`; the body may be a `Buffer`, any `ArrayBuffer` view or an
`ArrayBuffer` (from any realm). Whatever else a transport throws or returns — a plain
`Error`, a string, `null`, a response without a valid status — becomes a
`FimNetworkError` (URL redacted, the original as `cause`).

**Decoding.** A JSON body is decoded by the charset its `Content-Type` declares
(UTF-8 when it names none) with `TextDecoder`, which also drops a leading byte order
mark; an unknown charset label is a `FimParseError`. Downloads stay raw bytes.

**RawResponse.** The result of a download method: `{ data: Buffer, contentType,
status }` — raw bytes, never lossily decoded.

**Retry / backoff.** Transient `429` (rate limit) and `503` responses are retried
automatically, up to `maxRetries` (`--max-retries`, `0`–`MAX_RETRIES` = 10 in the CLI and
the library). Each retry waits `retryDelayMs * attempt` (`retryDelayMs` 0..30 000,
default 200), or the response's `Retry-After` — delay-seconds or an IMF-fixdate
HTTP-date, parsed by `parseRetryAfter` — when that is longer: the header can lengthen a
wait, never shorten it, so `Retry-After: 0` or a past date doesn't turn the retries into a
burst. A `Retry-After` longer than `MAX_RETRY_AFTER_MS` (30 s) is not retried: the
`FimApiError` surfaces at once, with `retryAfterMs` set and a message that names the
wait (`…; the server asked to retry after 3600 s, longer than the 30 s the client waits;
not retried — try again after that`). `FimApiError` is raised after all retries are
exhausted; its `retries` field and the message's `(after N retries)` say how many ran. A connection reset
(`ECONNRESET`, `EPIPE`, `ECONNABORTED`, undici's `UND_ERR_SOCKET`, anywhere in the
error's `cause` chain, from any transport) is retried the same way, with the linear
backoff; a timeout, a refused connection or a DNS failure is not.

**Redirects.** Not followed, by design. A 3xx surfaces as a `FimApiError` (exit `1`)
whose message and `location` field name the redirect target (resolved, userinfo
redacted, sanitised), e.g. `HTTP 301 for GET http://fimportal.de/...: redirect to
https://fimportal.de/... not followed`.

**maxResponseBytes.** A cap on the response body size in bytes (`0` = unlimited;
default 100 MiB), guarding against unbounded responses. A non-negative integer: the
engine rejects anything else rather than silently dropping the cap. The default
transport aborts as soon as the cap is passed; for any transport the engine rejects a
larger body with `FimNetworkError` (`Response exceeded the size limit of N bytes
(maxResponseBytes; --max-response-bytes on the CLI)`).

**Query builder.** [`buildQueryString`](src/client/query.ts) — a dependency-free
serialiser: omits `undefined`/`null`, repeats keys for arrays, renders booleans as
`true`/`false`, dates as ISO-8601, and encodes spaces as `%20` (not `+`).

**CliDeps / CliIO.** The dependency-injection seam for the CLI
([`io.ts`](src/cli/io.ts)): a client factory plus an I/O object
(`out`/`err`/`writeFile`/`outBinary`). Lets the whole CLI run in tests with a
mocked client and captured output — no subprocess.

**Error types.** [`errors.ts`](src/client/errors.ts): `FimApiError` (non-2xx,
carries `status`/`detail`; the `detail` and a redirect target are cut at 500 characters,
`MAX_DETAIL_LENGTH`, and the URL in the message at 500, `cutForMessage`, while `body`
and `url` keep the full text), `FimNetworkError` (transport failure/timeout),
`FimParseError` (bad JSON), `FimValidationError` (an input refused before any
request, including a bad client option such as the base URL), all extending
`FimError`. The CLI maps a `404` to exit code `4`, a
`FimValidationError` to the usage-error code `1` (`Error: <message>`), other
errors to `1`.

**Input validation.** The library owns every rule about what a request may
contain. The rules are pure functions in [`validate.ts`](src/client/validate.ts):
a `Problem` returns the reason a value is invalid, or `undefined`, and
`assertValid(name, value, problem)` turns a reason into a `FimValidationError`
with the message `Invalid <name>: <reason>`. Client methods call it before any
request (an async method rejects rather than throwing synchronously), so a
rejected input sends nothing. The CLI's commander parsers call the same `Problem`
functions and report the reason as a usage error, so the CLI and the library
cannot drift apart. `test/helpers.ts` has a `parity()` helper that drives one
input through `run()` and through the library on one recording mock transport.

What the library rejects with `FimValidationError`, before any request:

- **Blank query values.** A blank string (`""` or whitespace only), a blank
  element of an array filter, an empty array, a blank parameter name or an invalid
  `Date` (`new Date("garbage")`, which used to throw a raw `RangeError`), in any
  search, list or `tools.searchCsvDownload` call (`assertNonBlankParams`, run by
  `RequestEngine.buildUrl`). The API treats an empty parameter as no filter and
  would answer with the unfiltered result. `undefined`/`null` still mean "omitted".
- **Blank path ids.** A blank id, version, namespace, Leistungsschlüssel, language
  code or Kodierung (`pathSegment`/`pathSegmentProblem`): an empty last segment
  would turn `schemas.versions("")` into the search collection and
  `schemas.get("S1", "")` into the versions list, returned as the requested object.
  `RequestEngine.buildUrl` also rejects `.`/`..` and any empty segment.
- **Unknown parameters and wrong value types.** Every search and list call checks
  its parameters against its table in [`filters.ts`](src/client/filters.ts)
  (`assertParams`, tables such as `SCHEMA_SEARCH_PARAMS`, read from `openapi.json`):
  the parameters must be an object (`schemas.search("Geburt")` used to send
  `?0=G&1=e…`), every key one of the endpoint's (own keys only, so `__proto__` and
  `constructor` count as unknown), and every value what its parameter takes — a
  string, a date string or valid `Date`, an integer, a boolean, one of the enum
  values, and a list only where the API takes one. The portal ignores a key it does
  not know and answers with the whole catalogue: `fts_querry`, `ftsQuery` and the
  pre-0.1.0 `versionshinweis` returned 1890 schemas instead of 0. The error names the
  likely key (`did you mean fts_query?`). `specializations.list` takes no `fts_query`
  (the endpoint ignored it). A parameter added upstream after the table was written can
  still be sent with `{ allowUnknownFilters: true }` as the call's second argument (the
  shape dip-bundestag-cli uses); its value must still be a scalar or a list of them.
- **A missing or unknown `search-csv` resource, and filters the export would ignore.**
  `tools.searchCsvDownload` takes `SearchCsvParams` and requires `resource` to be one
  of `SearchCsvResourceValues`: the server answers any other value, or none, with a
  CSV of Leistungen and status 200. It ignores filters in the same way, exporting the
  unfiltered result byte for byte, so `assertSearchCsvParams` also refuses a key that
  is not one of the spec's parameters (`SEARCH_CSV_FILTERS`), a filter for another
  resource (`feldart` on `schema`, `sprache` on anything but `leistung-steckbriefe`),
  a value outside a filter's domain (`feldart: "SELECT"`, `dokumentart: "1"`,
  `detaillierungsstufe: "999"`; the domains are those of the matching JSON search,
  confirmed live for `xdf_version` and `datentyp` on 2026-10-06 — except `sdg_relevant`,
  which the export reads as `Ja`/`Nein` (`CSV_SDG_RELEVANT_VALUES`, from the portal's
  source and confirmed live: `true` is ignored, `Nein` filters)) and an `order_by`
  outside the resource's JSON sort orders (`CSV_ORDER_VALUES`; refused for `process` and
  `processclass`, which the portal never sorts by it). `abstraktionsstufe` filters
  `document-profile` only, as `Abstrakt`/`Konkret` (`CSV_ABSTRAKTIONSSTUFE_VALUES`). These
  three domains come from the portal's source (gitlab.opencode.de/fitko/fim/portal,
  `fimportal/routers/ui_search.py`, `get_ui_filters`), as the OpenAPI spec types every
  parameter as a free string. `allowUnknownFilters` lets all of
  these through. The CLI's `search-csv` offers the domains as choices.
- **A single-value CLI option given twice** (`forbidRepeatedOptions` in
  `cli/shared.ts`): commander kept the last value silently, so `--name A --name B`
  searched for `B` alone. It is a usage error now; the repeatable options
  (`--nummernkreis`, `--freigabe-status`, the service lists) still collect.
- **Out-of-domain enum values.** Each search method checks its enumerated
  parameters against the `*Values` arrays of `enums.ts` (`assertParams` with the
  endpoint's table; the older `assertEnumParams` stays exported): `freigabe_status`, `xdf_version`, `order_by`,
  `suche_nur_in`, `feldart`, `datentyp`, `dokumentart`, `sprache`,
  `vollzugsbehoerde`, `source`, `operatives_ziel`, `verfahrensart`,
  `handlungsform`, `detaillierungsstufe` and `anwendungsgebiet` (the `enum` entries of
  the tables in `filters.ts`). The `stufe` of a
  process path must be one of `DetaillierungsstufeValues`
  (`detaillierungsstufeProblem`) and the `source` of a service-text path one of
  `XzufiSourceValues` (`xzufiSourceProblem`); `openapi.json` also lists a path
  source `primary`, which neither the CLI nor the library accepts. The lists the
  CLI forwards as given (`leistungstyp`, `typisierung`, `sdg`,
  `leistungsadressat`, `ozg_themenfeld`) are not checked against a value list: the
  API answers an unknown value there with a 422 naming the allowed ones.
- **Out-of-range paging.** Every search and list method (and `codeLists.list`)
  runs `assertPagination`: `limit` an integer in `LIMIT_MIN`..`LIMIT_MAX`
  (1..200, exported from `params.ts`), `offset` and `cursor` a non-negative safe
  integer. NaN, Infinity, fractions and `1e21` are refused rather than sent as
  text. (`openapi.json` gives `cursor` no minimum; the library keeps the CLI's
  `>= 0`, since a cursor is always a previous page's `next_cursor`.) The CLI's
  `--limit`, `--offset` and `--cursor` parsers use the same rules and constants.
- **Out-of-range engine options** (thrown by the constructor, `intOption`):
  `timeoutMs` an integer 0..`MAX_TIMEOUT_MS` (2^31 − 1 ms), `maxRetries` 0..`MAX_RETRIES`
  (10), `retryDelayMs` and `maxResponseBytes` non-negative safe integers. `0` keeps
  its meaning (no timeout, no retries, no backoff, no cap); a negative or NaN value
  would silently have disabled the timeout or the cap. The default transport still
  caps a `timeoutMs` it is handed directly at `MAX_TIMEOUT_MS`. The CLI's
  `--timeout`, `--max-retries` and `--max-response-bytes` parsers use the same
  constants.
- **An unsendable User-Agent** (thrown by the constructor, `assertHeaderValue` /
  `headerValueProblem`): a blank `userAgent`, a C0 control character or DEL (tab is
  allowed) or a character above U+00FF. Only `undefined` selects the default
  `fim-portal-cli`. The CLI's `--user-agent` parser applies the same rule. Should
  an injected header still be one Node refuses, the default transport rejects with
  `FimNetworkError` ("Invalid request: ...") rather than a raw `TypeError`.
- **An invalid base URL** (thrown by the constructor, `validateBaseUrl` /
  `baseUrlProblem`): one `new URL()` cannot parse, a scheme other than `http:` or
  `https:`, a query or fragment (request paths are appended as a string, so
  `http://h/?x=1` would request `/?x=1/api/...`), a `%` in the user name or password
  that doesn't start an escape (Node decodes the userinfo for the Authorization header
  and failed at request time with "URI malformed"; a literal `%` is `%25`),
  surrounding whitespace, or
  whitespace or a control character anywhere inside (`baseUrlWhitespaceProblem`:
  `new URL()` trims and strips those silently, but the engine concatenates request
  paths onto the raw string, so `"https://h/ "` would request `/%20/api/...`). The
  check runs on the raw `baseUrl`, before trailing slashes are stripped, and the
  reasons never echo the value. A bad base URL is a configuration error, not a
  transport failure, so it is a `FimValidationError`, no longer a
  `FimNetworkError`; the default transport's per-hop scheme check, which runs at
  request time, still throws `FimNetworkError`. The CLI's `--base-url` parser
  calls `baseUrlProblem` and has no rules of its own.

**Credential redaction.** A credential in the base URL never reaches the output. The CLI redacts on output: `run.ts`
(`withRedactedOutput`) takes the exact userinfo of every argument (`credentialsIn`,
exported) and replaces it with `***` in everything it prints — commander's usage
errors, which echo rejected values (`argument '<url>' is invalid`, `unknown command
'<url>'`), and the help that follows them — so a password with spaces, quotes, `#`,
`?` or `/` is caught as well as an ordinary one. `redactUrl` falls back to the same
text-based cut (`redactCredentials`) for a value that doesn't parse as a URL. In the
library, the engine keeps the base URL in a real `#private` field, so
`console.log(client)`, `util.inspect` and `JSON.stringify` never show it, and it
scrubs the base URL's userinfo (raw and percent-decoded) from error bodies and
details, transport error text and the `cause` chain it attaches.

**Response shape (2xx).** `getJson` checks the documented envelope of every JSON
answer (`responseShapeProblem`): a search or `codeLists.list` must return an object
with an `items` array and a numeric `total_count`, a cursor listing an object with an
`items` array, a `versions` call an array, and a single record a non-empty object.
Anything else — `null`, `{}`, an error envelope, a bare string — is a `FimParseError`
(`Unexpected response from <path> (HTTP 200): …`), never printed as data or read as
"nothing found". `getRaw` refuses an HTML page (by Content-Type, or a body that starts
`<!doctype html`/`<html`) answered to a download, so `-o` doesn't save a maintenance
page over the user's file.

**Security invariant — response data is render-only.** The JSON body is decoded
with `JSON.parse(text) as T`; only its envelope is checked (above), the records
themselves are deliberately *not* runtime-schema-validated.
That cast is only safe because every parsed value flows into exactly two sinks:
`JSON.stringify` re-rendering (stdout) and the human-readable error `detail`
string (sanitised of control characters in `engine.ts` before it reaches stderr).
No parsed value is ever used to build a path, URL, header, file operation or a
follow-up request. Preserve this: if a future feature makes a response value drive
control flow (auto-pagination that follows a response cursor, response-driven
downloads, writing a server-supplied filename), add runtime validation *first* —
the current `as T` cast trusts the shape and must not gate anything security-
relevant. The only sensitive data flow in this keyless repo is the user-chosen
`-o` output path, which is self-trusted.

## Testing

```bash
npm test          # builds, then runs `node --test` over dist/test
```

- **`query.test.ts`** — query-string serialisation (arrays, dates, booleans, encoding).
- **`http.test.ts`** — the default transport against a real loopback `http.createServer`.
- **`engine.test.ts`** — URL building, JSON/raw decoding, error mapping, 429/503 retry — mocked transport.
- **`client.test.ts`** — every endpoint's method/URL mapping + query serialisation — mocked transport.
- **`validate.test.ts`** — the input rules, `assertValid`, and how `run()` reports a `FimValidationError`.
- **`filters.test.ts`** — unknown and misspelled parameters, value types, the CSV export's filter checks,
  `allowUnknownFilters`, and repeated CLI options (P10).
- **`conformance-*.test.ts`** — the checks shared across the maschinenlesbar.org CLIs (fix plan
  2026-10-06), copied from autobahn-cli with a per-repo adapter block; P12 (`-o -`) was piloted here.
  The follow-up round of 2026-10-06 added P20 (`conformance-p20-cleartext-warning`: a remote plain
  `http:` base URL gets one `warning:` line on stderr from `cleartextProblem`; this CLI has no
  base-URL variable and no secret, so those two cases are skipped) and P21
  (`conformance-p21-readme-links`: README.md ships in the npm tarball, so a relative link in it
  must point to a file `package.json` `files` ships; any other document is linked by its absolute
  `https://github.com/maschinenlesbar-org/fim-portal-cli/blob/main/<path>` URL).
- **`parity.test.ts`** — the same input through the CLI and the library (`parity()`): both reject
  without a request, or both send the identical request.
- **`cli.test.ts`** — end-to-end command parsing, rendering, file output and exit codes — mocked client.

All HTTP is mocked with Node's built-in `node:test` `mock` facility (`test/helpers.ts`);
only `http.test.ts` touches a socket, and only on localhost.

## Continuous integration

GitHub Actions workflows under `.github/workflows/`:

- **ci.yml** — type-check, build and test on Node 22/24 for every push and PR.
- **release.yml** — on a `v*` tag: verify the tag matches `package.json`, test, `npm pack`, and create a GitHub Release with the tarball.
- **publish.yml** — manual dispatch from the release tag (`gh workflow run publish.yml --ref vX.Y.Z`; the version is the tag's): publish to npm via OIDC **Trusted Publishing** (no stored `NPM_TOKEN`) with provenance.
- **docs.yml** — build the project website (`site/`, English and German) with the TypeDoc API docs
  under `/api/`, and deploy both to GitHub Pages on each `v*` tag.
  TypeDoc runs from the isolated, lockfile-pinned `tools/docs/` toolchain because it
  needs the TypeScript 6 compiler API, which TypeScript 7 no longer ships; locally,
  run `npm ci --prefix tools/docs` once before `npm run docs`.

## Website

The project website — <https://maschinenlesbar-org.github.io/fim-portal-cli/> in English and
<https://maschinenlesbar-org.github.io/fim-portal-cli/de/> in German — is built from `site/`
with [Jekyll](https://jekyllrb.com/), [banira](https://sebs.github.io/banira/) web components
and [Fylgja](https://fylgja.dev/) CSS, and deployed by `docs.yml` together with the TypeDoc API
reference under `/api/`. Its content comes from this repository: the README intro and quick
start, the command tree of the built CLI (`site/scripts/cli-reference.mjs`), `Usage.md`,
`GLOSSARY.md` and its German version `GLOSSARY.de.md`, the skills, and the skill examples in
`EXAMPLE.md` and `EXAMPLE.de.md`. The only repo-specific files are `site/_config.yml` and
`site/_data/project.yml` (the German intro and the access requirements); the rest of `site/` is
identical in every maschinenlesbar.org CLI, so change it in all of them together. When the
README intro changes, update the German intro in `site/_data/project.yml`.

```bash
npm run build                        # the CLI, for the command reference
cd site && npm ci && bundle install  # once (Node >= 22.12, Ruby 3.4, Bundler)
npm run serve                        # http://127.0.0.1:4000/fim-portal-cli/
```

## License

Dual-licensed under **[AGPL-3.0-or-later](LICENSE)** or a commercial license — see
**[LICENSING.md](LICENSING.md)**. This project does **not** accept external code
contributions; see **[CONTRIBUTING.md](CONTRIBUTING.md)**.
