# fim-portal-cli

[![CI](https://github.com/maschinenlesbar-org/fim-portal-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/maschinenlesbar-org/fim-portal-cli/actions/workflows/ci.yml)
[![Release](https://github.com/maschinenlesbar-org/fim-portal-cli/actions/workflows/release.yml/badge.svg)](https://github.com/maschinenlesbar-org/fim-portal-cli/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/@maschinenlesbar.org/fim-portal-cli)](https://www.npmjs.com/package/@maschinenlesbar.org/fim-portal-cli)

Browse Germany's **FIM Portal** — the authoritative catalogue of XDatenfelder schemas,
XZuFi services and XProzess processes — from your terminal. `fim-portal` is a
command-line tool over the [FIM Portal REST API](https://fimportal.de/docs) (`fimportal.de`):
search and download data schemas, data fields, document profiles, service profiles,
service texts and process models — as clean JSON or native XML/PDF you can pipe
straight into [`jq`](https://jqlang.github.io/jq/) or save to a file.

- **Works out of the box** — no account, no API key, no configuration. Install and query.
- **Clean JSON output** — pretty-printed by default, `--compact` for one-line/scripting.
- **Download native artefacts** — XDatenfelder XML, XZuFi XML, XProzess XML and PDF
  exports with a single flag.
- **Covers the whole catalogue** — XDatenfelder (`schemas`, `fields`, `groups`,
  `document-profiles`), XZuFi (`service-profiles`, `service-texts`,
  `organizational-units`, `specializations`, `online-services`) and XProzess
  (`processes`, `process-classes`).
- **Safe to script** — errors go to stderr, structured exit codes, optional file
  output with `-o`.

> Want to use this as a TypeScript library or understand how it's built?
> See **[DEVELOPING.md](DEVELOPING.md)**.

## Install

```bash
npm i -g @maschinenlesbar.org/fim-portal-cli
```

This installs the **`fim-portal`** command. Requires **Node.js 20+**.

Check it works:

```bash
fim-portal --help
```

## Quickstart

No setup needed — the FIM Portal's open endpoints require no authentication. Your first search:

```bash
fim-portal schemas search --fts-query "Geburt" --is-latest --limit 5
```

The result is a JSON envelope; the matching schemas live under `items`. Pull out just ids and names with `jq`:

```bash
fim-portal schemas search --fts-query "Geburt" --is-latest --limit 5 \
  | jq '.items[] | {id: .fim_id, name, version: .fim_version}'
```

Take a `fim_id` from those results and fetch its full record:

```bash
fim-portal schemas get S07000009
```

## Commands

```text
schemas            search | versions | get | xdf | quality-report
document-profiles  search | versions | get | xdf
fields             search | versions | get | xdf
groups             search | versions | get | xdf
service-profiles   search | get | xzufi | pdf
service-texts      search | get | xzufi | pdf | parsed-xzufi
organizational-units  list | xzufi
specializations       list | xzufi
online-services       list | xzufi
process-classes    search | get | xprozess
processes          search | get | xprozess | report | visualization | visualization-display
code-lists
search-csv
```

`get`, `versions`, `xdf`, `xzufi`, `xprozess`, `pdf`, `report`, `visualization`,
and `visualization-display` take a `<fim_id>` (and optionally a version, defaulting
to `latest`). For `fields` and `groups`, a `<namespace>` argument comes before the
FIM id.

### `schemas search` filters

| Flag | Meaning |
| --- | --- |
| `--fts-query <text>` | free-text search |
| `--suche-nur-in <module>` | restrict FTS to one module (e.g. `Rechtsgrundlagen`) |
| `--name <text>` | name contains |
| `--nummernkreis <prefix>` | owning number range, repeatable, prefix match |
| `--xdf-version <v>` | XDF version: `2.0`, `2.0.0`, or `3.0.0` |
| `--freigabe-status <n>` | approval status `1`–`8`, repeatable |
| `--is-latest` | newest version per id only |
| `--order-by <field>` | sort field (`id_asc`, `name_asc`, `geaendert_datum_zeit_desc`, …) |
| `--limit <n>` | page size (`1`–`200`, default `200`) |
| `--offset <n>` | page offset (0-based) |

The table lists the most-used filters. Each `search` command also accepts more
specialised ones (date windows like `--gueltig-am` / `--updated-since`, status
filters, `--bezeichnung`, `--stichwort`, and others) — run
`fim-portal <group> search --help` for the complete, authoritative list.

The same core filters (`--fts-query`, `--name`, `--nummernkreis`, `--xdf-version`,
`--freigabe-status`, `--is-latest`, `--order-by`, `--limit`, `--offset`) are shared
across `document-profiles search`, `fields search` and `groups search`.

### `fields search` extra filters

| Flag | Meaning |
| --- | --- |
| `--feldart <kind>` | field kind: `input`, `select`, `label`, `hidden`, `locked` |
| `--datentyp <type>` | data type: `text`, `text_latin`, `date`, `time`, `datetime`, `bool`, `num`, `num_int`, `num_currency`, `file`, `obj` |

### `document-profiles search` extra filter

| Flag | Meaning |
| --- | --- |
| `--dokumentart <code>` | document kind code `001`–`014`, `999` |

### `service-profiles search` filters

| Flag | Meaning |
| --- | --- |
| `--fts-query <text>` | free-text search |
| `--sprache <lang>` | language: `Deutsch`, `Englisch`, `Polnisch`, etc. |
| `--sdg-relevant` | only SDG-relevant services |
| `--ozg-themenfeld <field>` | OZG thematic field, repeatable |
| `--leistungsadressat <a>` | service addressee, repeatable |
| `--vollzugsbehoerde <v>` | executing authority: `BAMF`, `BLE`, `DRV` |
| `--einheitlicher-ansprechpartner` | EA-relevant only |
| `--updated-since <iso>` | changed after ISO date |
| `--order-by <field>` | sort field (`relevance`, `titel_asc`, `geaendert_datum_zeit_desc`, …) |
| `--limit <n>` | page size |
| `--offset <n>` | page offset |

### `service-texts search` filters

| Flag | Meaning |
| --- | --- |
| `--fts-query <text>` | free-text search |
| `--source <src>` | `leika`, `landesredaktion`, or `pvog` |
| `--limit <n>` | page size |
| `--offset <n>` | page offset |

`service-texts search` additionally accepts many structured filters
(`--leistungsschluessel`, `--title`, `--leistungstyp`, `--ozg-id`,
`--vollzugsbehoerde`, `--updated-since`, `--order-by`, and more) — run
`fim-portal service-texts search --help` for the full list.

### `processes search` filters

| Flag | Meaning |
| --- | --- |
| `--fts-query <text>` | free-text search |
| `--detaillierungsstufe <n>` | detail level `101`–`105` |
| `--is-musterprozess` | template processes only |
| `--anwendungsgebiet <code>` | application domain `01`–`17` |
| `--freigabe-status <n>` | approval status, repeatable |
| `--limit <n>` | page size |
| `--offset <n>` | page offset |

### `organizational-units list`, `specializations list`, `online-services list` (cursor pagination)

| Flag | Meaning |
| --- | --- |
| `--limit <n>` | page size |
| `--cursor <n>` | cursor from previous response's `next_cursor` |

### `code-lists` filters

| Flag | Meaning |
| --- | --- |
| `--limit <n>` | page size |
| `--offset <n>` | page offset |

### `search-csv` filters

| Flag | Meaning |
| --- | --- |
| `--resource <name>` | required — e.g. `schemas`, `fields`, `groups`, `leistungen`, `processes` |
| `--term <text>` | search term |
| `--xdf-version <v>` | XDF version |
| `--feldart <kind>` | field kind |
| `--datentyp <type>` | data type |
| `--dokumentart <code>` | document kind |
| `--sprache <lang>` | language |
| `--order-by <field>` | sort field |

`search-csv` is a pass-through to `tools/search-csv-download` — values are
forwarded verbatim and validated by the server.

## Common tasks

A few recipes to get going — see **[Usage.md](Usage.md)** for the full,
use-case-driven set.

```bash
# Find schemas matching a topic, latest versions only
fim-portal schemas search --fts-query "Geburt" --is-latest --limit 5

# Full schema at a specific version
fim-portal schemas get S07000009 1.0

# Quality report for a schema
fim-portal schemas quality-report S07000009 latest

# Download the XDatenfelder XML to a file
fim-portal -o geburt.xml schemas xdf S07000009 1.0

# Search released text-input fields
fim-portal fields search --feldart input --datentyp text \
  --freigabe-status 5 --freigabe-status 6 --limit 20

# Look up a service profile by keyword
fim-portal service-profiles search --fts-query "Personalausweis" --sprache Deutsch

# Export a service profile as PDF
fim-portal -o leistung.pdf service-profiles pdf 99008001012012 de-DE

# Find template processes at detail level 105
fim-portal processes search --detaillierungsstufe 105 --is-musterprozess --limit 20

# Download a process visualization PDF
fim-portal -o vis.pdf processes visualization 99146014080000 01.00.00 105

# Bulk CSV export of field search results
fim-portal -o fields.csv search-csv --resource fields --term Name

# Page through organizational units (cursor pagination)
fim-portal organizational-units list --limit 50
fim-portal organizational-units list --cursor 50 --limit 50
```

> The identifiers above (`S07000009`, `99008001012012`, `99146014080000`, etc.) are
> illustrative — substitute ids from a real `search` or `list` result.

## Output & scripting

Every JSON command prints **pretty JSON to stdout**. Download commands (`xdf`,
`xzufi`, `xprozess`, `pdf`, `report`, `visualization`, `visualization-display`,
`search-csv`) stream raw bytes to stdout or to a file with `-o/--output`. Errors
and diagnostics go to stderr, so piping stdout into `jq` stays clean.

```bash
# How many schemas match a query?
fim-portal schemas search --fts-query "Meldung" | jq '.total_count'

# Pull item summaries from a paginated result
fim-portal --compact fields search --feldart select --limit 50 \
  | jq '.items | length'

# Reshape a service profile (title + service key)
fim-portal service-profiles get 99008001012012 \
  | jq '{titel: .titel, schluessel: .leistungsschluessel}'
```

Use `--compact` for single-line JSON in pipelines and logs:

```bash
fim-portal --compact schemas search --fts-query "Geburt" --is-latest | jq '.items[0]'
```

`--compact` (and every global option) works **before or after** the command —
both `fim-portal --compact schemas search …` and `fim-portal schemas search … --compact`
do the same thing.

**Exit codes** make the CLI easy to use in scripts:

| Code | Meaning |
| --- | --- |
| `0` | success (also `--help` / `--version`) |
| `4` | resource not found (`404`) |
| `1` | any other error (bad usage / invalid arguments, network failure, server error, unexpected) |

## Troubleshooting

- **`command not found: fim-portal`** — the global npm bin directory isn't on your
  `PATH`. Run `npm bin -g` to find it and add it, or run via
  `npx @maschinenlesbar.org/fim-portal-cli …`.
- **Exit `4` / "not found"** — the id doesn't exist in the portal. Re-fetch it
  from a fresh `search` result; ids and versions can change as the catalogue updates.
- **Exit `1` / network error** — connectivity, DNS, or a timeout. Try again, or raise
  the limit with `--timeout 60000`.
- **`429` / too many requests** — the portal rate-limits by IP. The CLI retries
  automatically (up to `--max-retries`, default `2`); if it still fails, wait a
  moment and retry.
- **Empty `items` / `total_count: 0`** — the search matched nothing; broaden
  `--fts-query`, drop a filter, or try a different keyword.
- **`-o` write error** — the parent directory must exist and be writable; the path
  is used verbatim with no auto-creation.
- **XML/PDF to stdout by accident** — download commands (`xdf`, `pdf`, `xprozess`,
  …) stream binary/XML. Always use `-o <file>` unless you intend to pipe the bytes.

## Global options

These apply to every command and may be given **before or after** it:

| Option | Description |
| --- | --- |
| `-V, --version` | Print the version number |
| `-h, --help` | Show help for the program or a command |
| `--compact` | Print JSON on a single line instead of pretty-printed |
| `-o, --output <file>` | For downloads: write bytes to a file instead of stdout |
| `--base-url <url>` | API base URL (default `https://fimportal.de`; `https://schema.fim.fitko.net` also works) |
| `--timeout <ms>` | Per-request timeout (default `30000`) |
| `--user-agent <ua>` | `User-Agent` header value |
| `--max-retries <n>` | Retries for transient `429`/`503` responses (default `2`) |
| `--max-response-bytes <n>` | Cap response body size in bytes (`0` = unlimited; default 100 MiB) |

## Learn more

- **[SKILLS.md](SKILLS.md)** — Claude Code Agent Skills that drive this CLI for real-world tasks.
- **[Usage.md](Usage.md)** — full use-case-driven cookbook.
- **[GLOSSARY.md](GLOSSARY.md)** — every domain term and flag explained.
- **[DEVELOPING.md](DEVELOPING.md)** — TypeScript library usage, architecture, testing, CI.

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
