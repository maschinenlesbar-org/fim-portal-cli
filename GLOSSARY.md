# Glossary

A reference for the domain concepts and project-specific terms used throughout
`fim-portal-cli`. The FIM domain is German; this glossary gives the English term
used in the CLI/API (where one exists) alongside the original German.

> **Translation table** (from the API description). The CLI follows these:
>
> | German | English / API term |
> | --- | --- |
> | Datenschema | schema |
> | Datenfeldgruppe | data group / group |
> | Datenfeld | data field / field |
> | Dokumentsteckbrief | document profile |
> | Leistung | service |
> | Leistungsbeschreibung | xzufi-service |
> | Prozess | process |
> | Codelisten | code lists |

---

## The FIM programme

**FIM — Föderales Informationsmanagement** ("Federal Information Management").
A German government programme that standardises the information behind public
administrative services so they can be described once and reused everywhere
(forms, processes, online services). FIM is organised into three *Bausteine*
(building blocks), each backed by an XÖV data exchange standard.

**FIM Portal.** The central catalogue (`fimportal.de`) that collects all FIM
building blocks and exposes them through the REST API this tool wraps. Formerly
hosted at `schema.fim.fitko.net`, which still resolves to the same API.

**FITKO — Föderale IT-Kooperation.** The public-sector body that operates the
FIM Portal. The source lives on [OpenCoDE](https://gitlab.opencode.de/fitko/fim).

**XÖV.** The family of XML-based standards for data exchange in German public
administration. XDatenfelder, XZuFi and XProzess are all XÖV standards.

---

## The three standards (Bausteine)

**XDatenfelder.** The standard for *data definitions* — schemas, data groups,
data fields and document profiles. Two relevant versions exist: **XDF2** (`2.0`)
and **XDF3** (`3.0.0`); see `xdf_version`. CLI command groups: `schemas`,
`groups`, `fields`, `document-profiles`.

**XZuFi — XML für Zuständigkeitsfinder.** The standard for *services*
(Leistungen): what a service is, who is responsible, master texts, online
services and the organisations that provide them. CLI command groups:
`service-profiles`, `service-texts`, `organizational-units`, `specializations`,
`online-services`.

**XProzess.** The standard for *processes* — how an administrative procedure
runs, at varying levels of detail. CLI command groups: `processes`,
`process-classes`.

---

## XDatenfelder building blocks

**Datenschema (schema).** The top-level container describing the data needed for
a service. References data groups and data fields. Has a `steckbrief_id` linking
it to a document profile. CLI: `schemas`.

**Datenfeldgruppe (data group / group).** A reusable, named grouping of data
fields (and nested groups) — e.g. "Name of a natural person" bundling the first
name, surname, etc. fields. CLI: `groups`.

**Datenfeld (data field / field).** The atomic unit of data capture — a single
input, e.g. "Familienname". Carries a **Feldart** and a **Datentyp** (below) and
may reference a **code list**. CLI: `fields`.

**Dokumentsteckbrief (document profile).** A profile describing a *document* in a
process — what role it plays (trigger, result, incoming/outgoing data) and which
schema realises it. Carries a **Dokumentart**. Can be *abstract* (`ist_abstrakt`).
CLI: `document-profiles`.

**Feldart.** The *kind* of a data field: `input`, `select`, `label`, `hidden`,
`locked`. (Filter: `fields search --feldart`.)

**Datentyp.** The *data type* of a field: `text`, `text_latin`, `date`, `time`,
`datetime`, `bool`, `num`, `num_int`, `num_currency`, `file`, `obj`. (Filter:
`fields search --datentyp`.)

**Dokumentart.** The classification of a document profile (a numeric code list
`001`…`014`, `999`). See the
[code list](https://www.xrepository.de/details/urn:xoev-de:fim-datenfelder:codeliste:dokumentart).

**Code list (Codeliste).** An enumerated set of allowed values referenced by a
data field (e.g. country codes). The portal serves these behind immutable URLs.
CLI: `code-lists`.

---

## XZuFi building blocks

**Leistung (service).** An administrative service offered to citizens or
businesses (e.g. "apply for a passport").

**Leistungsteckbrief (service profile).** The descriptive profile of a service —
the searchable, structured summary. Identified by a **Leistungsschlüssel**.
CLI: `service-profiles`.

**Leistungsstammtext (service master text / xzufi-service).** The reusable
textual content of a service (short text, full text, legal bases), maintained by
an editorial office. Identified by `redaktion_id` + `leistung_id` + **source**.
CLI: `service-texts`.

**Leistungsschlüssel.** The key identifying a service (often a LeiKa key such as
`99050048262000`).

**LeiKa — Leistungskatalog.** The national catalogue of administrative services;
the origin of many service keys and classifications.

**source (XzufiSource).** Where a service text originates: `leika`,
`landesredaktion` (a federal-state editorial office) or `pvog` (the
Portalverbund Online-Gateway).

**Redaktion / redaktion_id.** The editorial office that maintains a record, and
its identifier.

**Organisationseinheit (organizational unit).** An administrative organisation
(authority/office) in XZuFi. CLI: `organizational-units`.

**Spezialisierung (specialization).** An XZuFi specialization record.
CLI: `specializations`.

**Onlinedienst (online service).** A digital service offering in XZuFi.
CLI: `online-services`.

**Einheitlicher Ansprechpartner (EA).** "Single point of contact" — an EU-driven
concept; some services are flagged as EA-relevant
(`--einheitlicher-ansprechpartner`).

**SDG — Single Digital Gateway.** EU regulation; services can be flagged
SDG-relevant and tagged with an SDG information area (`--sdg`, `--sdg-relevant`).

**OZG — Onlinezugangsgesetz.** The German Online Access Act. Services carry an
`ozg_id` and an **OZG-Themenfeld** (thematic field, e.g. `familie_kind`).

**Lagen / Portalverbund.** Life/business "situations" used to organise services
in the federal portal network (`--lagen-portalverbund`).

**Vollzugsbehörde.** The executing authority for a service (`BAMF`, `BLE`, `DRV`).

---

## XProzess building blocks

**Prozess (process).** A modelled administrative procedure. Identified by
`process_id` + `process_version` + **Detaillierungsstufe**. CLI: `processes`.

**Prozessklasse (process class).** A higher-level, reusable process template,
identified by id + version. CLI: `process-classes`.

**Detaillierungsstufe.** The level of detail of a process model: `101`–`105`
(coarse → fine). Required to address a specific process.

**Anwendungsgebiet.** The application domain of a process (`01`–`17`).

**Musterprozess.** A reference/template process (`--is-musterprozess`).

**Operatives Ziel, Verfahrensart, Handlungsform.** XProzess classification
dimensions used to filter process classes.

**Visualization / Report.** Generated artefacts for a process: a visual model
(BPMN-like) and a quality/structure report. CLI: `processes visualization`,
`processes visualization-display`, `processes report`.

---

## Identifiers, versioning & metadata

**FIM ID (`fim_id`).** The stable identifier of a building block, prefixed by
type: `S…` schema, `D…` document profile, `F…` field, `G…` group. Example:
`S07000009`.

**FIM version (`fim_version`).** The version of a specific FIM ID, e.g. `1.0`,
`3.0.0`. The special value **`latest`** resolves to the newest version — the
default in every CLI `get`/`xdf` command when you omit the version.

**namespace.** For fields and groups, a URN namespace that, together with the
FIM ID, identifies the element (e.g. `urn:xoev-de:fim:standard:xdatenfelder`).
Required as a path argument for `fields`/`groups` `get`/`versions`/`xdf`.

**Nummernkreis.** The numeric "number range" a building block belongs to,
roughly an owning organisation/domain. Filtering is a **prefix match**: `01`
matches all of `01000`. Repeatable (`--nummernkreis`).

**Freigabestatus (`freigabe_status`).** The release/approval status, an integer
`1`–`8` (e.g. `3` = draft/Entwurf, `6` = technically released). See the
[status code list](https://www.xrepository.de/details/urn:xoev-de:xprozess:codeliste:status).
Repeatable filter (`--freigabe-status`). `freigabe_status_label` is the
human-readable form.

**status_gesetzt_durch / _am / _seit / _bis.** Who set the current status and
when; the `seit`/`bis` variants are date-range filters.

**gültig ab / bis (`gueltig_ab` / `gueltig_bis`).** Validity period of a record;
`--gueltig-am <date>` returns records valid on that date.

**Bezug.** A free-text "reference/relation" field (e.g. a legal basis);
`bezug_unterelemente` searches the references of a schema's sub-elements.

**Versionshinweis.** A note describing what changed in a version.

**Stichwort.** Keyword/tag (XDF3 only), e.g. `Anwendungsgebiet::Bundesrepublik`.

**is_latest.** Whether a record is the newest version of its kind
(`--is-latest`).

**fts_match.** When a full-text search matches, the snippet/field that matched.

---

## Search & API concepts

**Full-Text-Search (`fts_query`).** Free-text search across a resource;
`suche_nur_in` (`--suche-nur-in`) restricts it to one module (e.g.
`Rechtsgrundlagen`). Allowed modules differ per resource (schemas additionally
allow `Stichwort`).

**order_by.** Result ordering. The allowed values differ by resource —
Datenfelder resources share one set (`id_asc`, `name_asc`, …); services have
their own sets (including `relevance`, `titel_asc`).

**Offset pagination.** The v1/XDatenfelder and most v0 search endpoints page with
`offset` + `limit` (limit `1`–`200`, default `200`) and return a
**PaginatedResult** envelope (`items`, `offset`, `limit`, `count`,
`total_count`).

**Cursor pagination.** The XZuFi entity listings (`organizational-units`,
`specializations`, `online-services`) page with `cursor` + `limit` and return a
**CursorPaginationResult** envelope (`items`, `limit`, `count`, `next_cursor`).
Pass the returned `next_cursor` as the next `--cursor`.

**Immutable URLs.** The portal serves code lists, JSON Schema and XSD files
behind constant URLs intended for stable production use; the full URLs are
included in API responses.

**Rate limiting.** The API rate-limits by IP and returns **429** when exceeded;
the client retries 429/503 automatically with linear backoff (`--max-retries`).

**Authenticated endpoints (out of scope).** Uploads, the `/tools/*` converters
and quality-checks, and token introspection require an `Access-Token`. This tool
implements **only** the open, no-auth (read-only `GET`) endpoints, plus the
public CSV export.

---

## Download formats

**XDF / XML download (`xdf`).** The native XDatenfelder XML for a schema, group,
field or document profile.

**XZuFi download (`xzufi`).** The native XZuFi XML for a service text or XZuFi
entity.

**XProzess download (`xprozess`).** The native XProzess XML for a process; a
process class serves its XProzess representation as JSON.

**PDF export (`pdf`).** A rendered PDF of a service profile/text in a given
**language code** (see `Sprache`, e.g. `Deutsch`, `Englisch`).

**search-csv.** A tools endpoint that streams a search result as CSV.

---

## Project / technical terms

**API client.** [`FimPortalClient`](src/client/client.ts) — the typed,
resource-grouped wrapper over the API. Usable as a library independently of the
CLI.

**Resource group.** A cohesive set of client methods for one part of the API
(`client.schemas`, `client.processes`, …), and the matching top-level CLI
command.

**Transport.** A single function `(HttpRequest) => Promise<HttpResponse>`
([`http.ts`](src/client/http.ts)). The default uses Node's built-in
`http`/`https`; tests inject a mock. This is the only HTTP seam.

**Request engine.** [`RequestEngine`](src/client/engine.ts) — builds URLs,
serialises queries, applies retry/backoff, decodes JSON/raw responses and maps
errors. Sits between the client's resource methods and the transport.

**RawResponse.** The result of a download method: `{ data: Buffer, contentType,
status }` — raw bytes, never lossily decoded.

**CliDeps / CliIO.** The dependency-injection seam for the CLI
([`io.ts`](src/cli/io.ts)): a client factory plus an I/O object
(`out`/`err`/`writeFile`/`outBinary`). Lets the whole CLI run in tests with a
mocked client and captured output — no subprocess.

**Error types.** [`errors.ts`](src/client/errors.ts): `FimApiError` (non-2xx,
carries `status`/`detail`), `FimNetworkError` (transport failure/timeout),
`FimParseError` (bad JSON), all extending `FimError`. The CLI maps a `404` to
exit code `4`, other errors to `1`.
