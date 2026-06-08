# Usage

Use-case-driven recipes for the `fim-portal` CLI, which talks to the open (no-auth)
endpoints of the **FIM Portal REST API** (https://fimportal.de) — the data schemas,
data fields, document/service profiles and process models of the German federal
"Föderales Informationsmanagement" (FIM).

JSON commands print to stdout (pretty by default); download commands (`xdf`,
`xzufi`, `pdf`, `report`, `visualization*`, `search-csv`) stream raw bytes to
stdout or to a file via `-o/--output`.

> The identifiers in the examples (e.g. `S07000009`, `L100001`, `99050048262000`)
> are **illustrative** — substitute real ones from a search/list result.

## Install

```bash
npm i -g @maschinenlesbar.org/fim-portal-cli
```

This installs the binary **`fim-portal`** (run `fim-portal --help`). All examples
below assume it is on your `PATH`. If you have not installed globally, replace
`fim-portal` with `node dist/src/cli/index.js`.

Many examples pipe JSON to [`jq`](https://jqlang.github.io/jq/) for filtering;
`jq` is optional.

## Use cases

### Schemas & document profiles (XDatenfelder)

#### 1. Find a data schema by topic, newest version only

You are looking for the form schema that covers a life event (e.g. a birth) and
only want the current versions.

```bash
fim-portal schemas search --fts-query "Geburt" --is-latest --limit 5
```

Returns a JSON search result (a paged list of schema summaries). Add `--compact`
for one-line JSON, or pipe to `jq` to pull just the IDs and names:

```bash
fim-portal --compact schemas search --fts-query "Geburt" --is-latest --limit 5 \
  | jq '.items[] | {id: .fim_id, name, version: .fim_version}'
```

(Adjust the `jq` path to the actual response keys.)

#### 2. Inspect one schema and check its data quality

Before reusing a schema, look at the full definition and FITKO's quality report.

```bash
# Full schema, latest version
fim-portal schemas get S07000009

# A specific version
fim-portal schemas get S07000009 1.0

# Quality report (completeness/consistency findings) for that version
fim-portal schemas quality-report S07000009 latest

# List every published version of the schema
fim-portal schemas versions S07000009
```

All four print JSON.

#### 3. Download the official XDatenfelder XML for offline use / a validator

You need the machine-readable XML artefact, not the JSON view.

```bash
fim-portal -o geburt.xml schemas xdf S07000009 1.0
```

Writes the raw XML to `geburt.xml` and prints a confirmation (with the server's
`Content-Type`) to stderr, keeping stdout clean. Omit `-o` to stream the XML to
stdout for piping.

The same `xdf` download exists for document profiles, fields and groups:

```bash
fim-portal -o profil.xml document-profiles xdf D00000003
fim-portal -o feld.xml   fields xdf baukasten F00000000008
fim-portal -o gruppe.xml groups xdf baukasten G00000000046
```

Note that `fields` and `groups` take a `<namespace>` argument before the FIM id.

#### 4. Search reusable data fields by type and approval status

You are modelling a form and want only released (`Freigabestatus`) text input
fields. `--freigabe-status` is repeatable.

```bash
fim-portal fields search \
  --feldart input --datentyp text \
  --freigabe-status 5 --freigabe-status 6 \
  --limit 20
```

`--feldart` accepts `input|select|label|hidden|locked`; `--datentyp` accepts
`text|text_latin|date|time|datetime|bool|num|num_int|num_currency|file|obj`.
Use `fim-portal groups search ...` for data-field groups (same shared filters
like `--name`, `--nummernkreis`, `--xdf-version`, `--order-by`).

#### 5. Search document profiles (Dokumentsteckbriefe) by Dokumentart

You want document profiles of a specific document kind, sorted by last change.

```bash
fim-portal document-profiles search \
  --dokumentart 001 \
  --order-by geaendert_datum_zeit_desc \
  --is-latest --limit 10
```

`--dokumentart` is a fixed code (`001`..`014`, `999`); `--order-by` choices
include `name_asc`, `id_asc`, `geaendert_datum_zeit_desc`, etc.

### Services (XZuFi)

#### 6. Find a public service (Leistung) and export its citizen-facing PDF

Look up a Leistungsteckbrief by keyword in a given language, then export the PDF
a portal would show.

```bash
# Search service descriptions, German, full text "Personalausweis"
fim-portal service-profiles search --fts-query "Personalausweis" --sprache Deutsch

# Fetch one by its Leistungsschlüssel
fim-portal service-profiles get 99008001012012

# Export it as a PDF (second arg is the language code, e.g. de-DE)
fim-portal -o leistung.pdf service-profiles pdf 99008001012012 de-DE
```

`--sprache` choices include `Deutsch`, `Deutsch (leichte Sprache)`, `Englisch`,
`Polnisch`, `Sorbisch`, `Ukrainisch`, `Französisch`. `search` returns JSON; `pdf`
streams bytes (use `-o`).

#### 7. List SDG-relevant services for a Themenfeld

For Single-Digital-Gateway (SDG) reporting you need only SDG-relevant services in
one OZG Themenfeld, newest first.

```bash
fim-portal service-profiles search \
  --sdg-relevant \
  --ozg-themenfeld familie_kind \
  --order-by geaendert_datum_zeit_desc \
  --limit 50
```

`--ozg-themenfeld` is repeatable; valid values include `familie_kind`,
`bauen_wohnen`, `gesundheit`, `mobilitaet_reisen`, `steuern_zoll`, etc. Other
useful filters: `--leistungsadressat` (repeatable), `--einheitlicher-ansprechpartner`,
`--vollzugsbehoerde BAMF|BLE|DRV`, `--updated-since <iso>`.

#### 8. Get a service master text (Leistungsstammtext) and its XZuFi XML

Master texts are keyed by `redaktionId`, `leistungId` and a `source`
(`leika|landesredaktion|pvog`).

```bash
# Search master texts (e.g. all from one Redaktion)
fim-portal service-texts search --source leika --fts-query "Reisepass"

# Get one specific master text as JSON
fim-portal service-texts get B100019 574621 leika

# Download its XZuFi XML
fim-portal -o stammtext.xml service-texts xzufi B100019 574621 leika

# Export as PDF (last arg is the language code, e.g. de-DE)
fim-portal -o stammtext.pdf service-texts pdf B100019 574621 leika de-DE
```

#### 9. Page through XZuFi organisational units (cursor pagination)

You need a full export of organisational units; these endpoints use a cursor
rather than offset.

```bash
# First page
fim-portal organizational-units list --limit 50

# Next page: pass the cursor returned by the previous response
fim-portal organizational-units list --cursor 50 --limit 50

# Download the XZuFi XML for one unit (by redaktionId + id)
fim-portal -o ou.xml organizational-units xzufi L100038 368512
```

The same `list` / `xzufi` shape applies to `specializations` and `online-services`.

### Processes (XProzess)

#### 10. Find Musterprozesse at a given detail level and export a diagram

You want template processes (`Musterprozesse`) at detail level `105`, then export
one as a visualization PDF.

```bash
# Search processes
fim-portal processes search --detaillierungsstufe 105 --is-musterprozess --limit 20

# Get one process (id, version, stufe 101..105)
fim-portal processes get 99146014080000 01.00.00 105

# Download the visualization PDF
fim-portal -o vis.pdf processes visualization 99146014080000 01.00.00 105
```

`--detaillierungsstufe` and the `<stufe>` argument are `101`..`105`. Process
downloads: `xprozess` (XML), `report`, `visualization`, `visualization-display`
(all PDFs except `xprozess`). For higher-level classes use `process-classes search`
(filters: `--operatives-ziel`, `--verfahrensart`, `--handlungsform`) and
`process-classes get <id> <version>` / `xprozess`.

### Cross-cutting tools

#### 11. Bulk export a search result as CSV

For a spreadsheet of search hits, use the CSV tool endpoint instead of paging JSON.

```bash
fim-portal -o fields.csv search-csv --resource fields --term Name
```

`--resource` (required) accepts e.g. `schemas`, `fields`, `groups`, `steckbriefe`,
`leistungen`, `processes`. Additional pass-through filters: `--xdf-version`,
`--order-by`, `--feldart`, `--datentyp`, `--dokumentart`, `--sprache`. These are
forwarded verbatim and validated by the server.

#### 12. List the referenced code lists

Discover which code lists the data fields reference (paged with offset/limit).

```bash
fim-portal code-lists --limit 20
fim-portal code-lists --offset 20 --limit 20
```

Prints JSON.

## Global options

These go **before** the command, e.g. `fim-portal --compact schemas get S07000009`:

| Flag | Purpose |
| --- | --- |
| `--base-url <url>` | API base URL (default `https://fimportal.de`; `https://schema.fim.fitko.net` also works) |
| `--timeout <ms>` | Per-request timeout in milliseconds |
| `--max-retries <n>` | Retries for transient `429`/`503` responses |
| `--max-response-bytes <n>` | Cap response body size in bytes (`0` = unlimited; default 100 MiB) |
| `--user-agent <ua>` | `User-Agent` header value |
| `--compact` | Print JSON on a single line instead of pretty-printed |
| `-o, --output <file>` | For downloads: write bytes to this file instead of stdout |
| `-V, --version` / `-h, --help` | Version / help |

Examples:

```bash
# Hit the alternate base URL with a longer timeout and more retries
fim-portal --base-url https://schema.fim.fitko.net --timeout 60000 --max-retries 4 \
  schemas search --fts-query "Geburt" --limit 5

# Compact JSON straight into jq
fim-portal --compact fields search --feldart select --limit 100 | jq '.items | length'
```
