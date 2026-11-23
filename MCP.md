# fim-portal-mcp

An [MCP](https://modelcontextprotocol.io/) server for the [FIM Portal](https://fimportal.de) of
FITKO (Föderales Informationsmanagement): the catalogue of German administrative services
(Leistungen, XZuFi), the data fields, groups and schemas of their forms (XDatenfelder) and their
processes (XProzess), as tools for AI agents. Read-only, no API key. The portal publishes no
licence for the catalogue data (see Licence).

It is the MCP side of [fim-portal-cli](https://github.com/maschinenlesbar-org/fim-portal-cli),
built on the same typed client, and released with it.

## Install

```bash
npm i -g @maschinenlesbar.org/fim-portal-mcp
```

This installs the **`fim-portal-mcp`** command (Node.js 22.12+). Or run the container
image, for linux/amd64 and linux/arm64, which needs no Node.js:

```bash
docker run -i --rm ghcr.io/maschinenlesbar-org/fim-portal-mcp:latest
```

## Connect a client

The server speaks MCP on stdio by default.

**Claude Code**

```bash
claude mcp add fim-portal -- fim-portal-mcp
# or with the image:
claude mcp add fim-portal -- docker run -i --rm ghcr.io/maschinenlesbar-org/fim-portal-mcp:latest
```

**Claude Desktop** (`claude_desktop_config.json`)

```json
{ "mcpServers": { "fim-portal": { "command": "fim-portal-mcp" } } }
```

**VS Code** (`.vscode/mcp.json`)

```json
{ "servers": { "fim-portal": { "type": "stdio", "command": "fim-portal-mcp" } } }
```

**Over HTTP** (Streamable HTTP, one endpoint `POST /mcp`):

```bash
fim-portal-mcp --transport http            # http://127.0.0.1:3000/mcp
claude mcp add --transport http fim-portal http://127.0.0.1:3000/mcp
```

In a container, publish the port on loopback only:
`docker run --rm -p 127.0.0.1:3000:3000 ghcr.io/maschinenlesbar-org/fim-portal-mcp:latest --transport http --host 0.0.0.0 --allowed-hosts localhost,127.0.0.1`.

For scripts and shared configs, pin a release and its digest from the
[release notes](https://github.com/maschinenlesbar-org/fim-portal-cli/releases) instead of
`latest`: `…/fim-portal-mcp:<version>@sha256:<digest>`. Check an image's provenance with
`gh attestation verify oci://ghcr.io/maschinenlesbar-org/fim-portal-mcp:<version> --repo maschinenlesbar-org/fim-portal-cli`.

## Tools

| Tool | What it answers |
|---|---|
| `findReusableFields` | Released, reusable data fields or groups for a form, latest versions, ranked: the namesake first, then gold before silber, the central Baukasten before domain copies; never inaktiv ones. |
| `auditSchemaQuality` | A schema's quality report by severity (critical first) and by recurring check, the flagged elements named, with a verdict. |
| `getSchemaBlueprint` | A schema as a form outline: groups and fields nested, with cardinality, type and code list, the totals, legal bases and element statuses; a page at a time. |
| `getServiceDossier` | A public service (Leistung) by key or name: citizen name, addressees, status, OZG, SDG, legal bases, the linked process, and every office's text with its source. |
| `searchCatalogue` | A page of a search in one catalogue: schemas, fields, groups, document profiles, service profiles, service texts, process classes or processes. |
| `getElement` | One schema, document profile, field (with its code list and use count), group or process class, or its versions. |
| `getServiceText` | One office's master text of a service in full, as plain text, a page of paragraphs at a time. |

Every tool only reads. An answer is JSON (`structuredContent` and the same as text), with the
`source` it came from (whole, never cut like the data) and the data licence. A schema or service
name that fits several is answered as `ambiguous`, with the candidates, never one picked; a
full-text hit that only mentions the name inside its elements is not taken for it. A text over 2000
characters is cut and ends in `…[cut, N characters in all]`, and the answer says `truncated`. An
answer over `--max-result-chars` loses entries from the end of its lists, each down to its first
entry (so a page's `nextOffset` always moves on), then has its longest texts cut further (each with
that mark), and says `truncated`; one that can't be cut down so far is a tool error that says to ask
for less. A failure is a tool error that says what to change (one over 5000 characters loses its
middle, never its end, where the reason is).

## Options

```
--transport <stdio|http>   stdio (default), or Streamable HTTP on POST /mcp
--host <address>           HTTP: the address to listen on (default 127.0.0.1)
--port <n>                 HTTP: the port (default 3000)
--allowed-hosts <list>     HTTP: Host header names to answer (default localhost,127.0.0.1,[::1])
--allowed-origins <list>   HTTP: browser origins allowed to call, exactly (https://app.example.org); none by default
--auth-token-file <path>   HTTP: a file with the bearer token every request must send (mode 600, 32+ characters)
--base-url <url>           API base URL (default https://fimportal.de)
--timeout <ms>             per upstream request (default 30000)
--call-timeout <ms>        per tool call, retries included (default 45000)
--max-result-chars <n>     cap on one tool result's JSON (default 25000)
--max-pages <n>            pages a tool reads per list and call (default 10)
--user-agent <ua>          User-Agent header value (Latin-1, one line)
--log-format <text|jsonl>  the log records on stderr (default text)
```

## What it does and doesn't do

- **Read-only.** No tool changes anything, here or upstream.
- **No authentication** on HTTP unless you give one. It listens on loopback by default; it checks
  the `Host` header and, from a browser, the `Origin` (only the origins given with
  `--allowed-origins`, matched exactly) against DNS rebinding and other web pages; a page on one of
  those origins gets CORS (its preflight answered, the answers readable). With `--auth-token-file
  <path>` every request must send `Authorization: Bearer <token>` (the file holds one token of at
  least 32 characters, mode 600, owned by the user the server runs as, a regular file (a FIFO is
  refused at once, never waited on); read once at start; `(umask 077; openssl rand -hex 32 >
  mcp-token)` makes one); anything else is answered 401. Exposed beyond localhost (it logs a warning
  then), it belongs behind a proxy that authenticates or at least terminates TLS.
- **Gentle with the upstream.** One server process sends at most 2 requests at a time and 120 a
  minute to the API, pauses on HTTP 429 (as long as its Retry-After asks, at most 30 s), and stops a
  tool call after its deadline (a tool that has read part of its answer by then may answer with that
  part, and says so). A request those limits would hold longer than it or its call may wait is not
  sent: the call fails at once, naming the limit and when to ask again (and the log says so).
- **Results are data.** Text from the API, keys included, is cleaned (control, bidi, zero-width, tag
  and other invisible characters removed, but an emoji keeps its joiners; a key that cleaning makes
  equal to another stays, as `name~2`), but it is still other people's text: a model can be told
  things in it. The server can't act on that (it has no tool that writes), but other tools in the
  same session could.
- **Stops cleanly.** On `docker stop` (SIGTERM) or Ctrl-C the HTTP server takes no new connection
  and lets calls in flight answer for up to 5 s, then exits 143 (130); a second signal ends it at
  once. On stdio a signal ends it at once; when stdin ends, it first answers the requests it has
  read (each within its call deadline), then exits.
- **In a container** it needs at least 12 processes and threads (`--pids-limit`) and about
  256 MB of memory. The largest answers it reads, a widely used field with every schema version
  that uses it and a large schema, are a few MB.
- **Logs** go to stderr, one record per line; stdout carries only the protocol. A call that fails
  upstream or reaches its deadline leaves a WARN record naming the tool.
- **Never installs anything.**

## Licence

Code: AGPL-3.0-or-later or commercial
([LICENSING.md](https://github.com/maschinenlesbar-org/fim-portal-cli/blob/main/LICENSING.md)).
Data: the catalogue is FITKO's (Föderale IT-Kooperation), on behalf of the IT-Planungsrat, and
the portal publishes no licence for it: `dl-de/zero-2-0` is plausible but not confirmed, and the
FIM documentation (not the data) is CC BY 4.0
([DATA_LICENSE.md](https://github.com/maschinenlesbar-org/fim-portal-cli/blob/main/DATA_LICENSE.md)).
Every result carries this note in its `licence` field: name the source ("Quelle: FIM Portal,
FITKO, https://fimportal.de"), and ask FITKO (fim@fitko.de) before redistributing the data or
reusing it commercially. We provide the tool, not the data: running the server as a service for
others may need FITKO's permission.
